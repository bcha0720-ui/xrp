import { api } from '../api.js';
import { esc, fmtNum, fmtUsd, fmtMillions, fmtUsdM, isNum, latestReportedHoldings, derivedAum } from '../format.js';

export async function renderHoldings(root, { setStatus }) {
  root.innerHTML = `<div class="page-head">
    <div class="hero-pill warn">Loading sheet</div>
    <h1>ETF Holdings</h1>
    <p>Google Sheet · sparse published changes only</p>
  </div>
  <div class="card"><div class="skeleton" style="height:220px"></div></div>`;
  setStatus('load', 'Loading');
  try {
    const [payload, price] = await Promise.all([
      api.holdings(),
      api.price().catch(() => null),
    ]);
    const rows = payload.data || [];
    const columns = payload.columns || [];
    const { totalXrp, issuersWithData, latest } = latestReportedHoldings(rows, columns);
    const { aum } = derivedAum(latest, price?.usd);

    const group = [];
    const sub = [];
    for (const col of columns) {
      group.push(`<th class="etf-header" colspan="2">${esc(col.label)}</th>`);
      sub.push(`<th>XRP</th><th>Value</th>`);
    }

    const body = rows.map((row) => {
      const tds = [`<td>${esc(row.date)}</td>`];
      for (const col of columns) {
        const cell = row[col.key] || {};
        tds.push(`<td>${isNum(cell.xrp) ? esc(fmtNum(cell.xrp)) : '<span class="no-data">—</span>'}</td>`);
        tds.push(`<td>${isNum(cell.value) ? esc(fmtUsd(cell.value)) : '<span class="no-data">—</span>'}</td>`);
      }
      return `<tr>${tds.join('')}</tr>`;
    }).join('');

    root.innerHTML = `
      <div class="page-head">
        <div class="hero-pill${payload.stale ? ' warn' : ''}">${payload.stale ? 'Stale sheet' : 'Live sheet'}</div>
        <h1>ETF Holdings</h1>
        <p>Sparse published changes only — blank cells were not reported that day.</p>
      </div>
      <div class="stats-row">
        <div class="stat"><div class="k-label">XRP locked</div><div class="k-value blue">${esc(fmtMillions(totalXrp))}</div></div>
        <div class="stat"><div class="k-label">Reported AUM</div><div class="k-value">${esc(fmtUsdM(aum))}</div></div>
        <div class="stat"><div class="k-label">Issuers</div><div class="k-value">${issuersWithData}</div></div>
        <div class="stat"><div class="k-label">Sheet rows</div><div class="k-value">${rows.length}</div></div>
      </div>
      <div class="card table-card">
        <div class="table-head">
          <strong>Daily holdings data</strong>
          <span class="foot">${rows.length} rows · ${esc(payload.source || 'google-sheet-csv')}</span>
        </div>
        <div class="table-wrap">
          <table class="holdings-table">
            <thead>
              <tr><th rowspan="2">Date</th>${group.join('')}</tr>
              <tr>${sub.join('')}</tr>
            </thead>
            <tbody>${body || '<tr><td>No rows</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <p class="hint">Labels come from the Sheet header. Empty cells stay empty — no forward-fill.</p>`;
    setStatus(payload.stale ? 'load' : 'live', payload.stale ? 'Stale' : 'Live');
  } catch (err) {
    root.innerHTML = `<div class="page-head"><div class="hero-pill err">Error</div><h1>ETF Holdings</h1></div>
      <div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
