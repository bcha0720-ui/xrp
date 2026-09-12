import { api } from '../api.js';
import { esc, fmtNum, fmtUsd, isNum } from '../format.js';

export async function renderHoldings(root, { setStatus }) {
  root.innerHTML = `<div class="banner">Loading Google Sheet…</div><div class="table-wrap"><div class="skeleton" style="height:220px;margin:16px"></div></div>`;
  setStatus('load', 'Loading');
  try {
    const payload = await api.holdings();
    const rows = payload.data || [];
    const columns = payload.columns || [];
    const cells = [];
    cells.push(`<th class="left" rowspan="2">Date</th>`);
    const sub = [];
    for (const col of columns) {
      cells.push(`<th colspan="2">${esc(col.label)}${col.ticker ? `<div class="venue-meta">${esc(col.ticker)}</div>` : ''}</th>`);
      sub.push(`<th>XRP</th><th>Value</th>`);
    }

    const body = rows.map((row) => {
      const tds = [`<td class="left">${esc(row.date)}</td>`];
      for (const col of columns) {
        const cell = row[col.key] || {};
        tds.push(`<td>${isNum(cell.xrp) ? esc(fmtNum(cell.xrp)) : '<span class="empty">—</span>'}</td>`);
        tds.push(`<td>${isNum(cell.value) ? esc(fmtUsd(cell.value)) : '<span class="empty">—</span>'}</td>`);
      }
      return `<tr class="row-hover">${tds.join('')}</tr>`;
    }).join('');

    root.innerHTML = `
      <div class="toolbar">
        <p class="hint">Sparse sheet only — a blank cell means that issuer did not publish a change that day. Labels from the Google Sheet header. ${rows.length} rows · ${esc(payload.source || 'google-sheet-csv')}</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${cells.join('')}</tr><tr>${sub.join('')}</tr></thead>
          <tbody>${body || '<tr><td class="left">No rows</td></tr>'}</tbody>
        </table>
      </div>`;
    setStatus(payload.stale ? 'load' : 'live', payload.stale ? 'Stale' : 'Live');
  } catch (err) {
    root.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
