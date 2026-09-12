import { api } from '../api.js';
import { esc, fmtNum, fmtUsd, fmtXrp, isNum, latestReportedHoldings } from '../format.js';

export async function renderHoldings(root, { setStatus }) {
  root.innerHTML = `<div class="page-hero">
    <div class="page-hero-badge">Holdings</div>
    <div class="page-hero-title">ETF Holdings</div>
    <div class="page-hero-subtitle">Google Sheet · sparse published changes only</div>
  </div>
  <div class="banner">Loading Google Sheet…</div>
  <div class="holdings-table-container"><div class="skeleton" style="height:220px;margin:16px"></div></div>`;
  setStatus('load', 'Loading');
  try {
    const payload = await api.holdings();
    const rows = payload.data || [];
    const columns = payload.columns || [];
    const { totalXrp, issuersWithData } = latestReportedHoldings(rows, columns);

    const group = [];
    const sub = [];
    for (const col of columns) {
      group.push(`<th class="etf-header etf-column-group" colspan="2">${esc(col.label)}${col.ticker ? `<div class="venue-meta">${esc(col.ticker)}</div>` : ''}</th>`);
      sub.push(`<th class="sub-header etf-column-group">XRP</th><th class="sub-header">VALUE</th>`);
    }

    const body = rows.map((row) => {
      const tds = [`<td>${esc(row.date)}</td>`];
      for (const col of columns) {
        const cell = row[col.key] || {};
        tds.push(`<td class="xrp-cell etf-column-group">${isNum(cell.xrp) ? esc(fmtNum(cell.xrp)) : '<span class="no-data">—</span>'}</td>`);
        tds.push(`<td class="value-cell">${isNum(cell.value) ? esc(fmtUsd(cell.value)) : '<span class="no-data">—</span>'}</td>`);
      }
      return `<tr>${tds.join('')}</tr>`;
    }).join('');

    root.innerHTML = `
      <div class="page-hero">
        <div class="page-hero-badge${payload.stale ? ' warn' : ''}">${payload.stale ? 'Stale cache' : 'Live sheet'}</div>
        <div class="page-hero-title">ETF Holdings</div>
        <div class="page-hero-subtitle">Sparse published changes only — blank cells were not reported that day</div>
      </div>
      <div class="holdings-summary">
        <div class="summary-card highlight">
          <div class="summary-label">Latest reported XRP</div>
          <div class="summary-value accent">${esc(fmtXrp(totalXrp, { compact: true }))}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Issuers with data</div>
          <div class="summary-value">${issuersWithData}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Sheet rows</div>
          <div class="summary-value">${rows.length}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Source</div>
          <div class="summary-value" style="font-size:12px">${esc(payload.source || 'google-sheet-csv')}</div>
        </div>
      </div>
      <div class="holdings-table-container">
        <div class="holdings-table-header">
          <div class="holdings-table-title"><span>📋</span> Daily Holdings Data</div>
          <span class="holdings-table-meta">${rows.length} rows · Google Sheet (changes only)</span>
        </div>
        <div class="holdings-table-wrapper">
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
    root.innerHTML = `<div class="page-hero"><div class="page-hero-badge err">Error</div><div class="page-hero-title">ETF Holdings</div></div>
      <div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
