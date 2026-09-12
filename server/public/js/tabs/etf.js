import { api } from '../api.js';
import { esc, fmtNum, fmtUsd, fmtUsdCompact, isNum } from '../format.js';

const COLORS = ['#2DE3CB', '#4F7DF9', '#F5A623', '#A374F7'];
const PERIODS = {
  daily: { label: 'Daily', hist: '1mo', field: 'daily' },
  weekly: { label: 'Weekly', hist: '3mo', field: 'weekly' },
  monthly: { label: 'Monthly', hist: '6mo', field: 'monthly' },
};

function volumeOf(row, field) {
  const block = row?.[field] || {};
  return {
    shares: isNum(block.shares) ? block.shares : null,
    dollars: isNum(block.dollars) ? block.dollars : null,
  };
}

function cardsFor(groupName, rows, field) {
  const cards = (rows || []).map((r) => {
    const vol = volumeOf(r, field);
    return `<article class="etf-card2">
      <div class="etf-card2-top">
        <span class="etf-card2-ticker">${esc(r.symbol)}</span>
        <span class="etf-card2-sub">${isNum(r.price) ? esc(fmtUsd(r.price)) : '—'}</span>
      </div>
      <div class="etf-card2-issuer">${esc(r.description || '')}</div>
      <div class="etf-card2-value">${vol.dollars != null ? esc(fmtUsdCompact(vol.dollars)) : '—'}</div>
      <div class="etf-card2-sub">${vol.shares != null ? `${esc(fmtNum(vol.shares))} shares` : 'no volume'}</div>
    </article>`;
  }).join('');
  return `<section class="etf-group">
    <div class="etf-group-title">${esc(groupName)}</div>
    <div class="etf-cards-grid">${cards || '<div class="banner">No Yahoo rows</div>'}</div>
  </section>`;
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
  const legend = keys.map((k, i) => `<span><i class="swatch" style="background:${COLORS[i % COLORS.length]}"></i>${esc(k)} volume</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths}</svg></div>
    <div class="legend">${legend}</div>`;
}

function paint(root, { etf, hist, period }) {
  const spec = PERIODS[period] || PERIODS.daily;
  const groups = etf.data || {};
  const sections = Object.entries(groups).map(([name, rows]) => cardsFor(name, rows, spec.field)).join('');
  const toggles = Object.entries(PERIODS).map(([key, p]) =>
    `<button class="period-btn${key === period ? ' active' : ''}" type="button" data-period="${key}">${p.label}</button>`
  ).join('');

  root.innerHTML = `
    <div class="page-hero">
      <div class="page-hero-badge">${etf.cached ? 'Cached' : 'Live'}</div>
      <div class="page-hero-title">ETF Trading</div>
      <div class="page-hero-subtitle">Yahoo Finance spot / futures / Canada / index — ${esc(etf.timestamp || '')}</div>
    </div>
    <div class="controls">
      <div class="period-buttons">${toggles}</div>
      <button id="etfRefresh" class="btn btn-refresh" type="button">↻ Refresh</button>
    </div>
    <div class="chart-card">
      <div class="chart-section-header">
        <div class="chart-section-title">Historical volume · ${esc(spec.label)} (${esc(spec.hist)})</div>
      </div>
      ${lineChart(hist.data || {})}
    </div>
    ${sections || '<div class="banner error">Yahoo returned no ETF groups.</div>'}
    <p class="hint">Period toggle switches Yahoo daily / weekly / monthly fields and the matching historical window. Empty Yahoo series stay empty.</p>`;
}

export async function renderEtf(root, { setStatus }) {
  root.innerHTML = `<div class="page-hero">
    <div class="page-hero-badge warn">Loading</div>
    <div class="page-hero-title">ETF Trading</div>
  </div><div class="banner">Loading Yahoo ETF data via /api/etf-data…</div>`;
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
      root.querySelectorAll('.period-btn').forEach((btn) => {
        btn.addEventListener('click', () => load(btn.dataset.period));
      });
      root.querySelector('#etfRefresh')?.addEventListener('click', () => load(period, { refresh: true }));
      const groups = etf.data || {};
      setStatus(Object.keys(groups).length ? 'live' : 'error', Object.keys(groups).length ? 'Live' : 'Error');
    } catch (err) {
      root.innerHTML = `<div class="page-hero"><div class="page-hero-badge err">Error</div><div class="page-hero-title">ETF Trading</div></div>
        <div class="banner error">${esc(err.message)}</div>`;
      setStatus('error', 'Error');
    }
  }

  await load('daily');
}
