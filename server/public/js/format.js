const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function fmtNum(v, { empty = '—' } = {}) {
  return isNum(v) ? num.format(v) : empty;
}

export function fmtCompact(v, { empty = '—' } = {}) {
  return isNum(v) ? compact.format(v) : empty;
}

export function fmtUsd(v, { empty = '—' } = {}) {
  return isNum(v) ? usd.format(v) : empty;
}

export function fmtUsdCompact(v, { empty = '—' } = {}) {
  if (!isNum(v)) return empty;
  return `$${compact.format(v)}`;
}

export function fmtXrp(v, { compact: useCompact = false, empty = '—' } = {}) {
  if (!isNum(v)) return empty;
  return `${useCompact ? compact.format(v) : num.format(v)} XRP`;
}

export function fmtPct(v) {
  if (!isNum(v)) return '';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export function fmtTime(ms) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

export function venueLabel(key) {
  if (!key) return '';
  const special = {
    'crypto.com': 'Crypto.com',
    'gate.io': 'Gate.io',
    'BTC Markes': 'BTC Markets',
    'Independant Reserve': 'Independent Reserve',
  };
  if (special[key]) return special[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sheetDateTs(s) {
  const parts = String(s || '').split('/').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  const [m, d, y] = parts;
  return Date.UTC(y, m - 1, d);
}

/** Latest non-null XRP per issuer from a sparse sheet (no invented fill for missing issuers). */
export const XRP_TOTAL_SUPPLY = 100_000_000_000;

export const ISSUER_META = {
  canary: { ticker: 'XRPC', color: '#94a3b8' },
  bitwise: { ticker: 'XRP', color: '#22c55e' },
  franklin: { ticker: 'XRPZ', color: '#3b82f6' },
  grayscale: { ticker: 'GXRP', color: '#a855f7' },
  shares21: { ticker: 'TOXR', color: '#eab308' },
  rex: { ticker: 'XRPR', color: '#ef4444' },
  nciq: { ticker: 'NCIQ', color: '#64748b' },
  bitw: { ticker: 'BITW', color: '#22c55e' },
  gdlc: { ticker: 'GDLC', color: '#a855f7' },
  ezpz: { ticker: 'EZPZ', color: '#3b82f6' },
  btgo: { ticker: 'BTGO', color: '#06b6d4' },
  tknz: { ticker: 'TKNZ', color: '#f97316' },
  xxx: { ticker: 'XXX', color: '#78716c' },
};

export function issuerMeta(keyOrTicker) {
  const k = String(keyOrTicker || '').toLowerCase();
  if (ISSUER_META[k]) return ISSUER_META[k];
  for (const meta of Object.values(ISSUER_META)) {
    if (meta.ticker.toLowerCase() === k) return meta;
  }
  return { ticker: String(keyOrTicker || '').toUpperCase(), color: '#3b82f6' };
}

export function fmtMillions(v, { prefix = '', empty = '—' } = {}) {
  if (!isNum(v)) return empty;
  if (Math.abs(v) >= 1e10) return `${prefix}${(v / 1e9).toFixed(2)}B`;
  return `${prefix}${(v / 1e6).toFixed(2)}M`;
}

export function fmtUsdM(v, { empty = '—' } = {}) {
  return fmtMillions(v, { prefix: '$', empty });
}

export function supplyPct(xrp) {
  if (!isNum(xrp) || xrp <= 0) return '—';
  return `${((xrp / XRP_TOTAL_SUPPLY) * 100).toFixed(4)}%`;
}

export function flattenEtf(payload) {
  const groups = (payload && payload.data) || {};
  const rows = [];
  for (const [group, list] of Object.entries(groups)) {
    for (const row of list || []) rows.push({ ...row, group });
  }
  return rows;
}

export function volumeField(row, field = 'daily') {
  const block = row?.[field] || {};
  return {
    shares: isNum(block.shares) ? block.shares : null,
    dollars: isNum(block.dollars) ? block.dollars : null,
  };
}

export function derivedAum(latest, priceUsd) {
  let aum = 0;
  let usedPrice = false;
  for (const v of Object.values(latest || {})) {
    if (isNum(v.value)) aum += v.value;
    else if (isNum(v.xrp) && isNum(priceUsd)) {
      aum += v.xrp * priceUsd;
      usedPrice = true;
    }
  }
  return { aum, usedPrice };
}

export function latestReportedHoldings(rows, columns) {
  const latest = {};
  for (const col of columns) latest[col.key] = { xrp: null, value: null, date: null, ts: -1 };
  for (const row of rows || []) {
    const ts = sheetDateTs(row.date);
    for (const col of columns) {
      const cell = row[col.key] || {};
      if (isNum(cell.xrp) && ts >= latest[col.key].ts) {
        latest[col.key] = {
          xrp: cell.xrp,
          value: isNum(cell.value) ? cell.value : null,
          date: row.date,
          ts,
        };
      }
    }
  }
  const totalXrp = Object.values(latest).reduce((s, v) => s + (isNum(v.xrp) ? v.xrp : 0), 0);
  const totalValue = Object.values(latest).reduce((s, v) => s + (isNum(v.value) ? v.value : 0), 0);
  const issuersWithData = Object.values(latest).filter((v) => isNum(v.xrp)).length;
  return { latest, totalXrp, totalValue, issuersWithData };
}


export function exchangeTotal(payload) {
  const data = (payload && payload.data) || {};
  let total = 0;
  let venues = 0;
  for (const venue of Object.values(data)) {
    if (isNum(venue.total)) {
      total += venue.total;
      venues += 1;
    }
  }
  return { total, venues };
}

export function etfDailyVolume(payload) {
  const groups = (payload && payload.data) || {};
  let dollars = 0;
  let shares = 0;
  let count = 0;
  for (const list of Object.values(groups)) {
    for (const row of list || []) {
      if (isNum(row?.daily?.dollars)) dollars += row.daily.dollars;
      if (isNum(row?.daily?.shares)) shares += row.daily.shares;
      count += 1;
    }
  }
  return { dollars, shares, count };
}
