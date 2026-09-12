import { api } from '../api.js';
import { esc, fmtNum, fmtUsd, isNum } from '../format.js';

const COLORS = ['#2de3cb', '#4f7df9', '#f5a623', '#a374f7'];

function tableFor(groupName, rows) {
  const body = (rows || []).map((r) => `<tr class="row-hover">
    <td class="left">${esc(r.symbol)}<div class="venue-meta">${esc(r.description || '')}</div></td>
    <td>${isNum(r.price) ? esc(fmtUsd(r.price)) : '—'}</td>
    <td>${esc(fmtNum(r.daily?.shares))}</td>
    <td>${esc(fmtUsd(r.daily?.dollars))}</td>
    <td>${esc(fmtUsd(r.weekly?.dollars))}</td>
    <td>${esc(fmtUsd(r.monthly?.dollars))}</td>
  </tr>`).join('');
  return `<section class="group">
    <h2>${esc(groupName)}</h2>
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="left">Symbol</th><th>Price</th><th>Daily shares</th><th>Daily $</th><th>5d $</th><th>21d $</th>
      </tr></thead>
      <tbody>${body || '<tr><td class="left">No Yahoo rows</td></tr>'}</tbody>
    </table></div>
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

export async function renderEtf(root, { setStatus }) {
  root.innerHTML = `<div class="banner">Loading Yahoo ETF data via /api/etf-data…</div>`;
  setStatus('load', 'Loading');
  try {
    const [etf, hist] = await Promise.all([
      api.etf(),
      api.historical('1mo').catch(() => ({ data: {}, count: 0 })),
    ]);
    const groups = etf.data || {};
    const sections = Object.entries(groups).map(([name, rows]) => tableFor(name, rows)).join('');
    root.innerHTML = `
      <div class="toolbar">
        <p class="hint">Server-side Yahoo Finance (browser CORS blocks a direct call). ${etf.cached ? 'Cached' : 'Fresh'} · ${esc(etf.timestamp || '')}</p>
      </div>
      ${sections || '<div class="banner error">Yahoo returned no ETF groups.</div>'}
      <section class="group">
        <h2>Historical volume (1 month)</h2>
        ${lineChart(hist.data || {})}
      </section>`;
    setStatus(Object.keys(groups).length ? 'live' : 'error', Object.keys(groups).length ? 'Live' : 'Error');
  } catch (err) {
    root.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
