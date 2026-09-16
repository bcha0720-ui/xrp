import { api } from '../api.js';
import { esc, fmtNum, fmtUsd, fmtUsdM, fmtCompact, flattenEtf, volumeField, issuerMeta, isNum } from '../format.js';

const COLORS = ['#3b82f6', '#22c55e', '#eab308', '#a855f7', '#ef4444', '#94a3b8'];
const PERIODS = {
  daily: { label: 'Daily', hist: '1mo', field: 'daily' },
  weekly: { label: 'Weekly', hist: '3mo', field: 'weekly' },
  monthly: { label: 'Monthly', hist: '6mo', field: 'monthly' },
};

function ranked(rows, field) {
  return rows
    .map((r) => ({ ...r, vol: volumeField(r, field) }))
    .filter((r) => isNum(r.vol.dollars))
    .sort((a, b) => b.vol.dollars - a.vol.dollars);
}

function rankList(rows) {
  const peak = rows[0]?.vol.dollars || 1;
  return rows.map((r, i) => {
    const meta = issuerMeta(r.symbol);
    return `<div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div>
        <div class="rank-name">${esc(r.description || r.symbol)}</div>
        <div class="rank-meta">${esc(r.symbol)}${r.vol.shares != null ? ` · ${esc(fmtCompact(r.vol.shares))} shares` : ''}</div>
      </div>
      <div class="rank-val">${esc(fmtUsdM(r.vol.dollars))}</div>
      <div class="rank-bar"><i style="width:${Math.max(4, (r.vol.dollars / peak) * 100)}%;background:${meta.color}"></i></div>
    </div>`;
  }).join('');
}

function cards(rows) {
  return rows.map((r) => {
    const meta = issuerMeta(r.symbol);
    return `<article class="issuer-card">
      <div class="issuer-top">
        <div>
          <div class="issuer-ticker" style="color:${meta.color}">${esc(r.symbol)}</div>
          <div class="issuer-name">${esc(r.description || r.group || '')}</div>
        </div>
        <div class="issuer-px">${isNum(r.price) ? esc(fmtUsd(r.price)) : '—'}</div>
      </div>
      <div class="issuer-stats">
        <div>
          <div class="k-label">Volume</div>
          <div class="k-value blue" style="font-size:22px">${r.vol.dollars != null ? esc(fmtUsdM(r.vol.dollars)) : '—'}</div>
        </div>
        <div>
          <div class="k-label">Shares</div>
          <div class="k-value" style="font-size:22px">${r.vol.shares != null ? esc(fmtNum(r.vol.shares)) : '—'}</div>
        </div>
      </div>
    </article>`;
  }).join('');
}

function niceCeil(max) {
  if (!isNum(max) || max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const n = max / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * exp;
}

function fmtAxisVol(v) {
  if (!isNum(v)) return '';
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(v));
}

function fmtAxisDate(iso) {
  const parts = String(iso || '').split('-');
  if (parts.length < 3) return String(iso || '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(parts[1]) - 1] || ''} ${Number(parts[2])}`;
}

function pickIndices(len, count) {
  if (len <= 0) return [];
  const n = Math.min(Math.max(count, 2), len);
  const idx = [];
  for (let t = 0; t < n; t++) idx.push(Math.round((t * (len - 1)) / (n - 1)));
  return [...new Set(idx)];
}

function lineChart(seriesMap) {
  const keys = Object.keys(seriesMap);
  if (!keys.length) {
    return `<div class="banner">No historical series from Yahoo for this period. Nothing is invented.</div>`;
  }
  const dates = new Set();
  const vols = [];
  for (const k of keys) {
    for (const p of seriesMap[k]) {
      dates.add(p.date);
      if (isNum(p.volume)) vols.push(p.volume);
    }
  }
  const x = [...dates].sort();
  const yMax = niceCeil(Math.max(...vols, 1));
  const yTicks = [0, 1, 2, 3, 4].map((i) => (yMax * i) / 4);
  const xTickCount = x.length <= 25 ? 5 : x.length <= 80 ? 6 : 7;
  const xIdx = pickIndices(x.length, xTickCount);

  const w = 1000;
  const h = 400;
  const xAt = (idx) => (idx / Math.max(x.length - 1, 1)) * w;
  const yAt = (v) => (1 - v / yMax) * h;

  const grid = yTicks.map((v) => {
    const y = yAt(v);
    return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" vector-effect="non-scaling-stroke" />`;
  }).join('');
  const vGrid = xIdx.map((i) => {
    const px = xAt(i);
    return `<line x1="${px}" y1="0" x2="${px}" y2="${h}" stroke="rgba(255,255,255,0.05)" stroke-width="1" vector-effect="non-scaling-stroke" />`;
  }).join('');

  const paths = keys.map((k, i) => {
    const byDate = Object.fromEntries(seriesMap[k].map((p) => [p.date, p.volume]));
    const pts = x.map((d, idx) => {
      const v = byDate[d];
      if (!isNum(v)) return null;
      return `${xAt(idx).toFixed(1)},${yAt(v).toFixed(1)}`;
    }).filter(Boolean);
    return `<polyline fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.join(' ')}" />`;
  }).join('');

  const yLabels = [...yTicks].reverse().map((v) => `<span>${esc(fmtAxisVol(v))}</span>`).join('');
  const xLabels = xIdx.map((i) => `<span>${esc(fmtAxisDate(x[i]))}</span>`).join('');
  const legend = keys.map((k, i) => `<span><i class="swatch" style="background:${COLORS[i % COLORS.length]}"></i>${esc(k)}</span>`).join('');

  return `<div class="chart-body">
      <div class="chart chart-axes">
        <div class="chart-y" aria-hidden="true">${yLabels}</div>
        <div class="chart-plot">
          <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Historical share volume">
            ${grid}${vGrid}${paths}
          </svg>
        </div>
        <div class="chart-x" aria-hidden="true">${xLabels}</div>
      </div>
      <div class="legend">${legend}<span class="legend-unit">Y: share volume · X: date</span></div>
    </div>`;
}

function paint(root, { etf, hist, period }) {
  const spec = PERIODS[period] || PERIODS.daily;
  const rows = ranked(flattenEtf(etf), spec.field);
  const total = rows.reduce((s, r) => s + r.vol.dollars, 0);
  const toggles = Object.entries(PERIODS).map(([key, p]) =>
    `<button class="seg${key === period ? ' active' : ''}" type="button" data-period="${key}">${p.label}</button>`
  ).join('');

  root.innerHTML = `
    <div class="page-head">
      <div class="hero-pill">${etf.cached ? 'Cached Yahoo' : 'Live Yahoo'}</div>
      <h1>ETF Trading</h1>
      <p>Volume ranking from Yahoo Finance · ${esc(etf.timestamp || '')}</p>
    </div>
    <div class="toolbar">
      <div class="volume-tabs">${toggles}</div>
      <button id="etfRefresh" class="btn btn-blue" type="button">Refresh</button>
    </div>
    <div class="metric-board">
      <section class="card">
        <div class="k-label">${esc(spec.label)} volume</div>
        <div class="k-value lg blue">${total ? esc(fmtUsdM(total)) : '—'}</div>
        <div class="k-sub">${rows.length} symbols with Yahoo volume</div>
        <div class="rank-list">${rankList(rows.slice(0, 10)) || '<div class="k-sub">No volume rows.</div>'}</div>
      </section>
      <section class="card chart-fill">
        <div class="k-label">Historical volume · ${esc(spec.hist)}</div>
        ${lineChart(hist.data || {})}
      </section>
    </div>
    <section class="section">
      <div class="section-title">All symbols</div>
      <div class="issuer-grid">${cards(rows) || '<div class="banner">Yahoo returned no ETF rows.</div>'}</div>
    </section>
    <p class="hint">Period toggle uses Yahoo daily / weekly / monthly fields and the matching historical window.</p>`;
}

export async function renderEtf(root, { setStatus }) {
  root.innerHTML = `<div class="page-head"><div class="hero-pill warn">Loading</div><h1>ETF Trading</h1></div>
    <div class="banner">Loading Yahoo ETF data via /api/etf-data…</div>`;
  setStatus('load', 'Loading');

  let period = 'daily';
  let etf;

  async function load(nextPeriod, { refresh = false } = {}) {
    period = nextPeriod;
    setStatus('load', 'Loading');
    try {
      if (refresh || !etf) etf = await api.etf();
      const hist = await api.historical(PERIODS[period].hist).catch(() => ({ data: {}, count: 0 }));
      paint(root, { etf, hist, period });
      root.querySelectorAll('.seg[data-period]').forEach((btn) => {
        btn.addEventListener('click', () => load(btn.dataset.period));
      });
      root.querySelector('#etfRefresh')?.addEventListener('click', () => load(period, { refresh: true }));
      const groups = etf.data || {};
      setStatus(Object.keys(groups).length ? 'live' : 'error', Object.keys(groups).length ? 'Live' : 'Error');
    } catch (err) {
      root.innerHTML = `<div class="page-head"><div class="hero-pill err">Error</div><h1>ETF Trading</h1></div>
        <div class="banner error">${esc(err.message)}</div>`;
      setStatus('error', 'Error');
    }
  }

  await load('daily');
}
