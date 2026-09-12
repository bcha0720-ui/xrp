'use strict';

/**
 * XRP Insights — Express cache + static server
 *
 * - /api/holdings-cached: Google Sheet CSV (cached)
 * - /api/exchange-balances-cached: FULL XRPL account_info scan of all
 *   exchange wallets in exchanges.json (parallel, multi-node), cached
 * - /api/exchange/trend: thin proxy to upstream trend API
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000; // ~5 min
const EXCHANGE_CACHE_TTL_MS =
  Number(process.env.EXCHANGE_CACHE_TTL_MS) || 8 * 60 * 1000; // ~8 min
const UPSTREAM_API =
  process.env.UPSTREAM_API || 'https://xrp-gtve.onrender.com';

const SHEET_CSV_URL =
  process.env.SHEET_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vS8ITdmh4kpKrfc714wtsXfzPhw9m5NC4gfD-vaVuBeA5dDeANcJwQJ-TK-eUJqlTRD1gsxP9rkiTod/pub?gid=1565352037&single=true&output=csv';

const RIPPLED_URLS = (
  process.env.RIPPLED_URLS ||
  'https://s1.ripple.com:51234/,https://s2.ripple.com:51234/,https://xrplcluster.com/'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const XRPL_CONCURRENCY = Math.max(
  1,
  Number(process.env.XRPL_CONCURRENCY) || 20
);
const XRPL_REQ_TIMEOUT_MS = Number(process.env.XRPL_REQ_TIMEOUT_MS) || 8000;
const COLD_WAIT_MS = Number(process.env.EXCHANGE_COLD_WAIT_MS) || 60000;

const ROOT_DIR = path.join(__dirname, '..');
const CACHE_DIR = path.join(__dirname, 'cache');
const HOLDINGS_CACHE_FILE = path.join(CACHE_DIR, 'holdings.json');
const EXCHANGE_CACHE_FILE = path.join(CACHE_DIR, 'exchange-balances.json');
const EXCHANGES_FILE = path.join(__dirname, 'exchanges.json');

ensureDir(CACHE_DIR);

/** @type {Record<string, Record<string, string>>} */
let EXCHANGES = {};
try {
  EXCHANGES = JSON.parse(fs.readFileSync(EXCHANGES_FILE, 'utf8'));
  const venueCount = Object.keys(EXCHANGES).length;
  let walletCount = 0;
  for (const w of Object.values(EXCHANGES)) walletCount += Object.keys(w).length;
  console.log(`[exchanges] loaded ${venueCount} venues / ${walletCount} wallets from exchanges.json`);
} catch (e) {
  console.error('[exchanges] failed to load exchanges.json:', e.message);
  EXCHANGES = {};
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------
const holdingsCache = {
  data: null,
  updatedAt: 0,
  fetching: null,
};

const exchangeCache = {
  data: null,
  updatedAt: 0,
  source: null,
  walletStats: null,
  fetching: null,
  /** Live scan progress (null when idle) */
  scan: null,
};

loadFileCache(HOLDINGS_CACHE_FILE, holdingsCache);
loadExchangeFileCache();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* ignore */
  }
}

function loadFileCache(file, target) {
  try {
    if (!fs.existsSync(file)) return;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && raw.data != null && raw.updatedAt) {
      target.data = raw.data;
      target.updatedAt = raw.updatedAt;
      console.log(
        `[cache] hydrated ${path.basename(file)} age=${Math.round((Date.now() - raw.updatedAt) / 1000)}s`
      );
    }
  } catch (e) {
    console.warn(`[cache] failed to load ${file}:`, e.message);
  }
}

function loadExchangeFileCache() {
  try {
    if (!fs.existsSync(EXCHANGE_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(EXCHANGE_CACHE_FILE, 'utf8'));
    if (raw && raw.data != null && raw.updatedAt) {
      exchangeCache.data = raw.data;
      exchangeCache.updatedAt = raw.updatedAt;
      exchangeCache.source = raw.source || null;
      exchangeCache.walletStats = raw.walletStats || null;
      console.log(
        `[cache] hydrated exchange-balances.json age=${Math.round((Date.now() - raw.updatedAt) / 1000)}s source=${exchangeCache.source || '?'} venues=${Object.keys(raw.data).length}`
      );
    }
  } catch (e) {
    console.warn(`[cache] failed to load exchange-balances.json:`, e.message);
  }
}

function saveExchangeFileCache() {
  try {
    fs.writeFileSync(
      EXCHANGE_CACHE_FILE,
      JSON.stringify({
        data: exchangeCache.data,
        updatedAt: exchangeCache.updatedAt,
        source: exchangeCache.source,
        walletStats: exchangeCache.walletStats,
      }),
      'utf8'
    );
  } catch (e) {
    console.warn(`[cache] failed to write exchange-balances.json:`, e.message);
  }
}

function saveFileCache(file, data, updatedAt) {
  try {
    fs.writeFileSync(file, JSON.stringify({ data, updatedAt }), 'utf8');
  } catch (e) {
    console.warn(`[cache] failed to write ${file}:`, e.message);
  }
}

function isFresh(updatedAt, ttl = CACHE_TTL_MS) {
  return updatedAt && Date.now() - updatedAt < ttl;
}

function sendJson(res, status, body) {
  res.status(status).type('application/json').json(body);
}

function parseNum(val) {
  if (val == null || val === '' || val === '-' || val === '—') return null;
  const cleaned = String(val).replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? null : num;
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function parseHoldingsCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Error('CSV has no data rows');
  }
  const header = lines[0].toLowerCase();
  if (!header.includes('date') || !header.includes('canary')) {
    throw new Error('CSV does not look like holdings sheet (missing Date/Canary header)');
  }

  return lines
    .slice(1)
    .map((line) => {
      const values = parseCSVLine(line);
      return {
        date: values[0] || '',
        canary: { xrp: parseNum(values[1]), value: parseNum(values[2]) },
        bitwise: { xrp: parseNum(values[3]), value: parseNum(values[4]) },
        franklin: { xrp: parseNum(values[5]), value: parseNum(values[6]) },
        grayscale: { xrp: parseNum(values[7]), value: parseNum(values[8]) },
        shares21: { xrp: parseNum(values[9]), value: parseNum(values[10]) },
        rex: { xrp: parseNum(values[11]), value: parseNum(values[12]) },
        nciq: { xrp: parseNum(values[13]), value: null },
        bitw: { xrp: parseNum(values[14]), value: null },
        gdlc: { xrp: parseNum(values[15]), value: null },
        ezpz: { xrp: parseNum(values[16]), value: parseNum(values[17]) },
        btgo: { xrp: parseNum(values[18]), value: null },
        tknz: { xrp: parseNum(values[19]), value: null },
        xxx: { xrp: parseNum(values[20]), value: null },
      };
    })
    .filter((entry) => entry.date && entry.date !== 'Date');
}

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'xrp-insights-server/1.0',
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'xrp-insights-server/1.0',
      },
    });
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${url}`);
    }
    if (!ct.includes('json')) {
      const preview = (await resp.text()).slice(0, 80);
      throw new Error(`Expected JSON from ${url}, got ${ct || 'unknown'}: ${preview}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

async function refreshHoldings() {
  if (holdingsCache.fetching) return holdingsCache.fetching;
  holdingsCache.fetching = (async () => {
    console.log('[holdings] fetching Google Sheet CSV…');
    const csv = await fetchText(SHEET_CSV_URL, 25000);
    const data = parseHoldingsCsv(csv);
    if (!data.length) throw new Error('Parsed zero holdings rows');
    holdingsCache.data = data;
    holdingsCache.updatedAt = Date.now();
    saveFileCache(HOLDINGS_CACHE_FILE, data, holdingsCache.updatedAt);
    console.log(`[holdings] cached ${data.length} rows`);
    return data;
  })()
    .catch((err) => {
      console.error('[holdings] refresh failed:', err.message);
      throw err;
    })
    .finally(() => {
      holdingsCache.fetching = null;
    });
  return holdingsCache.fetching;
}

function trendLatestToExchangeData(latest) {
  const exchanges = (latest && latest.exchanges) || {};
  const out = {};
  for (const [name, total] of Object.entries(exchanges)) {
    const n = Number(total) || 0;
    const walletMap = EXCHANGES[name] || {};
    out[name] = {
      total: n,
      walletCount: Object.keys(walletMap).length,
      successCount: n > 0 ? 1 : 0,
      staleCount: 0,
      wallets: {},
      fromTrendApi: true,
    };
  }
  return out;
}

async function seedFromTrend() {
  console.log('[exchange] seeding trend snapshot (fast paint)…');
  const trend = await fetchJson(
    `${UPSTREAM_API}/api/exchange/trend?days=90`,
    25000
  );
  const latest =
    trend.latest ||
    (Array.isArray(trend.trend) && trend.trend.length
      ? trend.trend[trend.trend.length - 1]
      : null);
  if (!latest || !latest.exchanges) {
    throw new Error('Upstream trend missing latest.exchanges');
  }
  return trendLatestToExchangeData(latest);
}

/** Bounded-concurrency map over items. */
async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency || 8, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}

/**
 * account_info via public rippled HTTP JSON-RPC.
 * Tries each node; returns XRP (drops/1e6) or null.
 * Never invents a balance.
 */
async function fetchAccountBalanceXrp(address) {
  const body = JSON.stringify({
    method: 'account_info',
    params: [
      {
        account: address,
        ledger_index: 'validated',
        strict: true,
      },
    ],
  });

  for (const url of RIPPLED_URLS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), XRPL_REQ_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'xrp-insights-server/1.0',
        },
        body,
        signal: ctrl.signal,
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const bal = data && data.result && data.result.account_data
        ? data.result.account_data.Balance
        : null;
      if (bal == null) {
        // actNotFound / missing account → treat as 0 XRP (real XRPL result)
        if (
          data &&
          data.result &&
          (data.result.error === 'actNotFound' ||
            data.result.status === 'error')
        ) {
          return 0;
        }
        continue;
      }
      const drops = Number(bal);
      if (!Number.isFinite(drops)) continue;
      return drops / 1e6;
    } catch (_) {
      // try next node
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function buildJobsFromExchanges() {
  const jobs = [];
  for (const [exchangeName, wallets] of Object.entries(EXCHANGES)) {
    for (const [address, walletName] of Object.entries(wallets || {})) {
      jobs.push({ exchangeName, address, walletName });
    }
  }
  return jobs;
}

function emptyBuckets() {
  const buckets = {};
  for (const [exchangeName, wallets] of Object.entries(EXCHANGES)) {
    buckets[exchangeName] = {
      total: 0,
      walletCount: Object.keys(wallets || {}).length,
      successCount: 0,
      staleCount: 0,
      wallets: {},
    };
  }
  return buckets;
}

function snapshotFromBuckets(buckets, walletStats, partial) {
  const data = {};
  for (const [name, b] of Object.entries(buckets)) {
    data[name] = {
      total: b.total,
      walletCount: b.walletCount,
      successCount: b.successCount,
      staleCount: b.staleCount,
      wallets: { ...b.wallets },
    };
  }
  return {
    data,
    updatedAt: Date.now(),
    source: 'xrpl-full-scan',
    walletStats,
    partial: !!partial,
  };
}

/**
 * Full XRPL scan of every wallet in exchanges.json.
 * Updates exchangeCache progressively; never invents balances.
 */
async function runFullXrplScan() {
  const jobs = buildJobsFromExchanges();
  const total = jobs.length;
  if (!total) {
    throw new Error('No wallets in exchanges.json');
  }

  const buckets = emptyBuckets();
  const startedAt = Date.now();
  let success = 0;
  let failed = 0;
  let done = 0;

  exchangeCache.scan = {
    running: true,
    startedAt,
    total,
    done: 0,
    success: 0,
    failed: 0,
    concurrency: XRPL_CONCURRENCY,
  };

  console.log(
    `[exchange] XRPL full scan starting: ${total} wallets, concurrency=${XRPL_CONCURRENCY}, nodes=${RIPPLED_URLS.length}`
  );

  // Preserve prior venue totals (trend or previous full scan) until that
  // venue's wallets have all been attempted in this run.
  const priorData = exchangeCache.data && typeof exchangeCache.data === 'object'
    ? exchangeCache.data
    : {};

  const publishPartial = () => {
    const walletStats = { total, success, failed };
    const merged = {};
    for (const [name, b] of Object.entries(buckets)) {
      const attempted = Object.keys(b.wallets).length;
      const complete = attempted >= b.walletCount && b.walletCount > 0;
      const prior = priorData[name];
      if (complete || b.successCount > 0) {
        merged[name] = {
          total: b.total,
          walletCount: b.walletCount,
          successCount: b.successCount,
          staleCount: b.staleCount,
          wallets: { ...b.wallets },
        };
      } else if (prior) {
        merged[name] = {
          ...prior,
          walletCount: b.walletCount || prior.walletCount || 0,
        };
      } else {
        merged[name] = {
          total: 0,
          walletCount: b.walletCount,
          successCount: 0,
          staleCount: 0,
          wallets: {},
        };
      }
    }
    // Keep any prior venues not in EXCHANGES (shouldn't happen) 
    for (const [name, prior] of Object.entries(priorData)) {
      if (!merged[name]) merged[name] = prior;
    }
    exchangeCache.data = merged;
    exchangeCache.updatedAt = Date.now();
    exchangeCache.source = 'xrpl-full-scan';
    exchangeCache.walletStats = walletStats;
  };

  let lastPublish = 0;
  await mapPool(jobs, XRPL_CONCURRENCY, async (job) => {
    const { exchangeName, address, walletName } = job;
    const balance = await fetchAccountBalanceXrp(address);
    const bucket = buckets[exchangeName];
    if (!bucket) return;

    if (balance !== null) {
      bucket.wallets[address] = { name: walletName, balance, stale: false };
      bucket.successCount += 1;
      bucket.total += balance;
      success += 1;
    } else {
      bucket.wallets[address] = { name: walletName, balance: null, stale: false };
      failed += 1;
    }
    done += 1;
    if (exchangeCache.scan) {
      exchangeCache.scan.done = done;
      exchangeCache.scan.success = success;
      exchangeCache.scan.failed = failed;
    }
    const now = Date.now();
    if (done === total || done % 40 === 0 || now - lastPublish > 5000) {
      lastPublish = now;
      publishPartial();
      console.log(
        `[exchange] scan progress ${done}/${total} (ok=${success} fail=${failed}) ${(
          (done / total) *
          100
        ).toFixed(1)}%`
      );
    }
  });

  const walletStats = { total, success, failed };
  const snap = snapshotFromBuckets(buckets, walletStats, false);
  exchangeCache.data = snap.data;
  exchangeCache.updatedAt = snap.updatedAt;
  exchangeCache.source = 'xrpl-full-scan';
  exchangeCache.walletStats = walletStats;
  exchangeCache.scan = {
    running: false,
    startedAt,
    finishedAt: Date.now(),
    total,
    done,
    success,
    failed,
    concurrency: XRPL_CONCURRENCY,
    durationMs: Date.now() - startedAt,
  };
  saveExchangeFileCache();

  const venueWithBal = Object.values(snap.data).filter((d) => (d.total || 0) > 0)
    .length;
  console.log(
    `[exchange] XRPL full scan done in ${Math.round(
      (Date.now() - startedAt) / 1000
    )}s — venues=${Object.keys(snap.data).length} withBal=${venueWithBal} wallets ok=${success}/${total}`
  );
  return snap;
}

/**
 * Start (or join) a full XRPL scan. Optionally seed trend first for cold paint.
 */
function startExchangeScan({ force = false, seedTrend = true } = {}) {
  if (exchangeCache.fetching) return exchangeCache.fetching;

  exchangeCache.fetching = (async () => {
    // Optional trend seed only when we have nothing usable yet
    if (
      seedTrend &&
      (!exchangeCache.data || !Object.keys(exchangeCache.data).length)
    ) {
      try {
        const seeded = await seedFromTrend();
        exchangeCache.data = seeded;
        exchangeCache.updatedAt = Date.now();
        exchangeCache.source = 'upstream-exchange-trend';
        exchangeCache.walletStats = null;
        // Do not persist trend-only as xrpl cache file overwrite of a prior full scan
        // unless no prior full-scan file exists
        if (
          !fs.existsSync(EXCHANGE_CACHE_FILE) ||
          !(exchangeCache.source === 'xrpl-full-scan')
        ) {
          // leave disk alone for trend seed; full scan will write
        }
        console.log(
          `[exchange] trend-seeded ${Object.keys(seeded).length} venues while XRPL scan starts`
        );
      } catch (e) {
        console.warn('[exchange] trend seed failed (continuing XRPL scan):', e.message);
      }
    }

    try {
      return await runFullXrplScan();
    } finally {
      exchangeCache.fetching = null;
    }
  })().catch((err) => {
    console.error('[exchange] full scan failed:', err.message);
    exchangeCache.fetching = null;
    if (exchangeCache.scan && exchangeCache.scan.running) {
      exchangeCache.scan.running = false;
      exchangeCache.scan.error = err.message;
    }
    throw err;
  });

  return exchangeCache.fetching;
}

function exchangeResponseBody({ stale = false, error = undefined } = {}) {
  const data = exchangeCache.data || {};
  const body = {
    data,
    updatedAt: exchangeCache.updatedAt || Date.now(),
    stale: !!stale,
    count: Object.keys(data).length,
    source: exchangeCache.source || 'unknown',
  };
  if (exchangeCache.walletStats) {
    body.walletStats = exchangeCache.walletStats;
  }
  if (exchangeCache.scan && exchangeCache.scan.running) {
    body.scan = {
      running: true,
      done: exchangeCache.scan.done,
      total: exchangeCache.scan.total,
      success: exchangeCache.scan.success,
      failed: exchangeCache.scan.failed,
    };
    body.stale = true;
  }
  if (error) body.error = error;
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  sendJson(res, 200, {
    ok: true,
    cacheTtlMs: CACHE_TTL_MS,
    exchangeCacheTtlMs: EXCHANGE_CACHE_TTL_MS,
    holdingsCached: Boolean(holdingsCache.data),
    holdingsAgeMs: holdingsCache.updatedAt
      ? Date.now() - holdingsCache.updatedAt
      : null,
    exchangeCached: Boolean(exchangeCache.data),
    exchangeAgeMs: exchangeCache.updatedAt
      ? Date.now() - exchangeCache.updatedAt
      : null,
    exchangeSource: exchangeCache.source,
    exchangeWalletStats: exchangeCache.walletStats,
    exchangeScan: exchangeCache.scan,
    exchangesConfigured: {
      venues: Object.keys(EXCHANGES).length,
      wallets: Object.values(EXCHANGES).reduce(
        (n, w) => n + Object.keys(w || {}).length,
        0
      ),
    },
  });
});

app.get('/api/holdings-cached', async (_req, res) => {
  try {
    const fresh = isFresh(holdingsCache.updatedAt) && holdingsCache.data;
    if (!fresh) {
      try {
        await refreshHoldings();
      } catch (err) {
        if (holdingsCache.data && holdingsCache.data.length) {
          return sendJson(res, 200, {
            data: holdingsCache.data,
            updatedAt: holdingsCache.updatedAt,
            stale: true,
            error: err.message,
          });
        }
        return sendJson(res, 502, {
          error: 'Failed to fetch holdings',
          message: err.message,
        });
      }
    }

    return sendJson(res, 200, {
      data: holdingsCache.data,
      updatedAt: holdingsCache.updatedAt,
      stale: !isFresh(holdingsCache.updatedAt),
      count: holdingsCache.data.length,
      source: 'google-sheet-csv',
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: 'holdings-cached failed',
      message: err.message,
    });
  }
});

app.get('/api/exchange-balances-cached/status', (_req, res) => {
  const scan = exchangeCache.scan;
  sendJson(res, 200, {
    running: !!(scan && scan.running) || !!exchangeCache.fetching,
    scan: scan || null,
    source: exchangeCache.source,
    updatedAt: exchangeCache.updatedAt,
    count: exchangeCache.data ? Object.keys(exchangeCache.data).length : 0,
    walletStats: exchangeCache.walletStats,
    fresh: isFresh(exchangeCache.updatedAt, EXCHANGE_CACHE_TTL_MS),
  });
});

app.get('/api/exchange-balances-cached', async (req, res) => {
  try {
    const forceRefresh =
      req.query.refresh === '1' ||
      req.query.refresh === 'true' ||
      req.query.force === '1';

    const hasFullScan =
      exchangeCache.data &&
      exchangeCache.source === 'xrpl-full-scan' &&
      exchangeCache.walletStats &&
      exchangeCache.walletStats.success > 0;

    const freshFull =
      hasFullScan &&
      isFresh(exchangeCache.updatedAt, EXCHANGE_CACHE_TTL_MS) &&
      !(exchangeCache.scan && exchangeCache.scan.running);

    if (freshFull && !forceRefresh) {
      return sendJson(res, 200, exchangeResponseBody({ stale: false }));
    }

    // Kick off / join a scan
    const alreadyRunning = !!exchangeCache.fetching;
    if (!alreadyRunning && (forceRefresh || !freshFull)) {
      startExchangeScan({
        force: forceRefresh,
        seedTrend: !hasFullScan && !exchangeCache.data,
      });
    }

    // If we already have a usable full-scan (even stale), return it immediately
    // while background refresh continues.
    if (hasFullScan && !forceRefresh) {
      return sendJson(
        res,
        200,
        exchangeResponseBody({
          stale:
            !isFresh(exchangeCache.updatedAt, EXCHANGE_CACHE_TTL_MS) ||
            !!(exchangeCache.scan && exchangeCache.scan.running),
        })
      );
    }

    // Cold start: wait up to COLD_WAIT_MS for progress, then return whatever we have
    const deadline = Date.now() + COLD_WAIT_MS;
    while (Date.now() < deadline) {
      if (
        exchangeCache.source === 'xrpl-full-scan' &&
        exchangeCache.walletStats &&
        exchangeCache.walletStats.success > 50
      ) {
        // Enough wallets for a useful partial
        break;
      }
      if (
        exchangeCache.source === 'xrpl-full-scan' &&
        exchangeCache.scan &&
        !exchangeCache.scan.running
      ) {
        break;
      }
      await sleep(1500);
    }

    if (exchangeCache.data && Object.keys(exchangeCache.data).length) {
      const stillRunning = !!(
        exchangeCache.scan && exchangeCache.scan.running
      );
      return sendJson(
        res,
        200,
        exchangeResponseBody({
          stale:
            stillRunning ||
            exchangeCache.source !== 'xrpl-full-scan' ||
            !isFresh(exchangeCache.updatedAt, EXCHANGE_CACHE_TTL_MS),
        })
      );
    }

    return sendJson(res, 503, {
      error: 'Exchange balances not ready',
      message: 'XRPL scan in progress; retry shortly',
      scan: exchangeCache.scan,
    });
  } catch (err) {
    if (exchangeCache.data && Object.keys(exchangeCache.data).length) {
      return sendJson(
        res,
        200,
        exchangeResponseBody({ stale: true, error: err.message })
      );
    }
    return sendJson(res, 500, {
      error: 'exchange-balances-cached failed',
      message: err.message,
    });
  }
});

/** Thin proxy / passthrough for the working upstream trend endpoint. */
app.get('/api/exchange/trend', async (req, res) => {
  try {
    const days = req.query.days || '90';
    const url = `${UPSTREAM_API}/api/exchange/trend?days=${encodeURIComponent(days)}`;
    const data = await fetchJson(url, 25000);
    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 502, {
      error: 'Failed to proxy exchange/trend',
      message: err.message,
    });
  }
});


// ---------------------------------------------------------------------------
// ETF Trading data (Yahoo Finance) — needed by ETF Trading tab
// Browser cannot call Yahoo directly (CORS); this keeps it free locally + Render.
// ---------------------------------------------------------------------------
const ETF_SYMBOLS = {
  'Spot ETFs': ['GXRP', 'XRP', 'XRPC', 'XRPZ', 'TOXR', 'XRPR', 'TKNZ'],
  'Futures ETFs': ['UXRP', 'XRPI', 'XRPM', 'XRPK', 'XRPT', 'XXRP', 'XXX'],
  'Canada ETFs': ['XRP.TO', 'XRPP-B.TO', 'XRPP-U.TO', 'XRPP.TO', 'XRPQ-U.TO', 'XRPQ.TO', 'XRP.NE', 'XRPP.NE'],
  'Index ETFs': ['GDLC', 'NCIQ', 'BITW', 'EZPZ'],
};

const ETF_DESCRIPTIONS = {
  EZPZ: 'Franklin Templeton',
  GDLC: 'Grayscale Digital Large Cap',
  NCIQ: 'Hashdex Nasdaq Crypto Index',
  BITW: 'Bitwise 10 Crypto Index',
  GXRP: 'Grayscale XRP Trust',
  XRP: 'Bitwise XRP ETF',
  XRPC: 'Canary Capital XRP',
  XRPZ: 'Franklin XRP ETF',
  TOXR: '21Shares XRP',
  TKNZ: 'T. Rowe Price ETF',
  UXRP: 'ProShares Ultra XRP',
  XRPI: 'Volatility Shares Trust',
  XRPM: 'Amplify XRP',
  XRPR: 'REX-Osprey XRP',
  XRPK: 'T-REX 2X Long XRP',
  XRPT: 'Volatility Shares 2x XRP',
  XXRP: 'Teucrium 2x Long XRP',
  XXX: 'Cyber Hornet S&P 500/XRP 75/25',
};

let etfDataCache = { data: null, timestamp: 0 };
const ETF_CACHE_DURATION = 60 * 1000;

async function fetchYahooFinanceData(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const result = data.chart && data.chart.result && data.chart.result[0];
    if (!result) return null;
    const meta = result.meta || {};
    const quotes = result.indicators && result.indicators.quote && result.indicators.quote[0];
    const timestamps = result.timestamp || [];
    if (!quotes || !timestamps.length) return null;
    const volumes = quotes.volume || [];
    const price =
      meta.regularMarketPrice ||
      (quotes.close && quotes.close[quotes.close.length - 1]) ||
      0;
    const dailyShares = volumes[volumes.length - 1] || 0;
    const weeklyShares = volumes.slice(-5).reduce((a, b) => a + (b || 0), 0);
    const monthlyShares = volumes.slice(-21).reduce((a, b) => a + (b || 0), 0);
    const yearlyShares = volumes.slice(-252).reduce((a, b) => a + (b || 0), 0);
    return {
      symbol,
      description: ETF_DESCRIPTIONS[symbol] || symbol,
      price,
      daily: { shares: dailyShares, dollars: dailyShares * price },
      weekly: { shares: weeklyShares, dollars: weeklyShares * price },
      monthly: { shares: monthlyShares, dollars: monthlyShares * price },
      yearly: { shares: yearlyShares, dollars: yearlyShares * price },
    };
  } catch (error) {
    console.error(`[etf] ${symbol}:`, error.message || error);
    return null;
  }
}

async function fetchAllETFData() {
  const results = {};
  for (const [groupName, symbols] of Object.entries(ETF_SYMBOLS)) {
    const groupResults = await Promise.all(
      symbols.map((symbol) => fetchYahooFinanceData(symbol))
    );
    const groupData = groupResults.filter(Boolean);
    if (groupData.length) results[groupName] = groupData;
  }
  return results;
}

app.get('/api/etf-data', async (_req, res) => {
  try {
    if (
      etfDataCache.data &&
      Date.now() - etfDataCache.timestamp < ETF_CACHE_DURATION
    ) {
      return sendJson(res, 200, {
        timestamp: new Date(etfDataCache.timestamp).toISOString(),
        cached: true,
        data: etfDataCache.data,
      });
    }
    const data = await fetchAllETFData();
    etfDataCache = { data, timestamp: Date.now() };
    return sendJson(res, 200, {
      timestamp: new Date().toISOString(),
      cached: false,
      data,
    });
  } catch (err) {
    return sendJson(res, 500, { error: 'etf-data failed', message: err.message });
  }
});

app.get('/api/historical', async (req, res) => {
  const period = req.query.period || '1mo';
  const periodMap = {
    '1mo': { range: '1mo', interval: '1d' },
    '3mo': { range: '3mo', interval: '1d' },
    '6mo': { range: '6mo', interval: '1d' },
    '1y': { range: '1y', interval: '1wk' },
  };
  const { range, interval } = periodMap[period] || periodMap['1mo'];
  const symbols = ['GXRP', 'XRP', 'XRPC', 'XXRP'];
  const historicalData = {};
  try {
    for (const symbol of symbols) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!response.ok) continue;
        const data = await response.json();
        const result = data.chart && data.chart.result && data.chart.result[0];
        if (!result || !result.timestamp) continue;
        const quotes =
          result.indicators && result.indicators.quote && result.indicators.quote[0];
        if (!quotes) continue;
        const chartData = [];
        for (let i = 0; i < result.timestamp.length; i++) {
          const close = quotes.close && quotes.close[i];
          if (close == null) continue;
          chartData.push({
            date: new Date(result.timestamp[i] * 1000).toISOString().split('T')[0],
            price: parseFloat(Number(close).toFixed(4)),
            volume: (quotes.volume && quotes.volume[i]) || 0,
          });
        }
        if (chartData.length) historicalData[symbol] = chartData;
      } catch (e) {
        console.error(`[historical] ${symbol}:`, e.message);
      }
    }
    // No invented sample series — empty object if Yahoo blocked
    return sendJson(res, 200, {
      period,
      data: historicalData,
      count: Object.keys(historicalData).length,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: 'historical failed',
      message: err.message,
    });
  }
});


/** Catch-all for unknown /api/* — JSON 404, never SPA HTML. */
app.use('/api', (req, res) => {
  sendJson(res, 404, {
    error: 'Not found',
    path: req.originalUrl,
    message: 'This API route is not implemented on this server.',
  });
});

// ---------------------------------------------------------------------------
// Static SPA
// ---------------------------------------------------------------------------
function resolveIndexHtml() {
  const candidates = [
    path.join(ROOT_DIR, 'index.html'),           // repo root (preferred)
    path.join(__dirname, 'index.html'),          // copied next to server
    path.join(__dirname, 'public', 'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const INDEX_HTML = resolveIndexHtml();
console.log(`[static] ROOT_DIR=${ROOT_DIR}`);
console.log(`[static] index.html=${INDEX_HTML || 'NOT FOUND'}`);

if (INDEX_HTML) {
  app.use(express.static(path.dirname(INDEX_HTML), { index: false, extensions: ['html'] }));
}
app.use(express.static(ROOT_DIR, { index: false, extensions: ['html'] }));
app.use(express.static(__dirname, { index: false }));

function sendIndex(res) {
  const indexPath = resolveIndexHtml();
  if (!indexPath) {
    return res.status(500).type('html').send(`<!doctype html><html><body style="font-family:system-ui;background:#0a0d13;color:#edf1f7;padding:2rem">
      <h1>index.html not found</h1>
      <p>Put <code>index.html</code> next to the <code>server</code> folder (parent directory), then restart.</p>
      <pre>expected: ${path.join(ROOT_DIR, 'index.html')}</pre>
      <p>Or copy index.html into <code>server/</code>.</p>
    </body></html>`);
  }
  return res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('[static] sendFile failed:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to serve index.html',
          message: err.message,
          path: indexPath,
        });
      }
    }
  });
}

app.get('/', (_req, res) => sendIndex(res));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return sendJson(res, 404, { error: 'Not found', path: req.originalUrl });
  }
  return sendIndex(res);
});

// Last-resort error handler so uncaught route errors are JSON, not a blank 500
app.use((err, _req, res, _next) => {
  console.error('[express]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal Server Error', message: err.message || String(err) });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`xrp-insights-server listening on :${PORT}`);
  console.log(`  SHEET_CSV_URL=${SHEET_CSV_URL.slice(0, 80)}…`);
  console.log(`  UPSTREAM_API=${UPSTREAM_API}`);
  console.log(`  CACHE_TTL_MS=${CACHE_TTL_MS}`);
  console.log(`  EXCHANGE_CACHE_TTL_MS=${EXCHANGE_CACHE_TTL_MS}`);
  console.log(`  XRPL_CONCURRENCY=${XRPL_CONCURRENCY}`);
  console.log(`  RIPPLED_URLS=${RIPPLED_URLS.join(' | ')}`);
  refreshHoldings().catch(() => {});
  // Warm with full XRPL scan in background (trend-seed if cold)
  const hasGoodCache =
    exchangeCache.source === 'xrpl-full-scan' &&
    exchangeCache.walletStats &&
    exchangeCache.walletStats.success > 100 &&
    isFresh(exchangeCache.updatedAt, EXCHANGE_CACHE_TTL_MS);
  if (!hasGoodCache) {
    startExchangeScan({ seedTrend: true }).catch(() => {});
  }
});
