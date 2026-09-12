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

function lineChart(seriesMap) {
  const keys = Object.keys(seriesMap);
  if (!keys.length) {
    return `<div class="banner">No historical series from Yahoo for this period. Nothing is invented.</div>`;
  }
  const dates = new Set();
  for (const k of keys) for (const p of seriesMap[k]) dates.add(p.date);
  const x = [...dates].sort();
  const w = 1000;
  const h = 220;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const paths = keys.map((k, i) => {
    const byDate = Object.fromEntries(seriesMap[k].map((p) => [p.date, p.volume]));
    const ys = x.map((d) => byDate[d]).filter(isNum);
    const max = Math.max(...ys, 1);
    const pts = x.map((d, idx) => {
      const v = byDate[d];
      if (!isNum(v)) return null;
      const px = pad.l + (idx / Math.max(x.length - 1, 1)) * (w - pad.l - pad.r);
      const py = pad.t + (1 - v / max) * (h - pad.t - pad.b);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).filter(Boolean);
    return `<polyline fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2" points="${pts.join(' ')}" />`;
  }).join('');
  const legend = keys.map((k, i) => `<span><i class="swatch" style="background:${COLORS[i % COLORS.length]}"></i>${esc(k)}</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths}</svg></div>
    <div class="legend">${legend}</div>`;
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
      <section class="card">
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
