import { api } from '../api.js';
import { esc, fmtNum, fmtXrp, venueLabel, isNum } from '../format.js';

function rowsFrom(payload) {
  const data = (payload && payload.data) || {};
  return Object.entries(data)
    .map(([key, v]) => ({
      key,
      name: venueLabel(key),
      total: isNum(v.total) ? v.total : 0,
      walletCount: v.walletCount || 0,
      successCount: v.successCount || 0,
      wallets: v.wallets || {},
    }))
    .sort((a, b) => b.total - a.total);
}

function renderTable(root, payload, filter = '') {
  const full = payload.source === 'xrpl-full-scan';
  const ws = payload.walletStats || {};
  const scan = payload.scan;
  const venues = Object.keys(payload.data || {}).length;
  const q = filter.trim().toLowerCase();
  const list = rowsFrom(payload).filter((r) => !q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
  const grand = list.reduce((s, r) => s + r.total, 0);

  const status = full
    ? `${venues} venues · ${ws.total ?? '—'} wallets`
    : `Source ${payload.source || 'unknown'} — waiting for xrpl-full-scan`;
  const progress = scan && scan.running ? ` · scan ${scan.done}/${scan.total} (ok ${scan.success}, fail ${scan.failed})` : '';

  const body = list.map((r, i) => {
    const walletBits = Object.entries(r.wallets)
      .sort((a, b) => (b[1]?.balance || 0) - (a[1]?.balance || 0))
      .slice(0, 8)
      .map(([addr, w]) => `${esc(w.name || addr)} · ${isNum(w.balance) ? fmtNum(w.balance) : '—'}`)
      .join('<br>');
    return `<tr class="row-hover">
      <td class="left">${i + 1}</td>
      <td class="left">${esc(r.name)}<div class="venue-meta">${r.successCount}/${r.walletCount} wallets</div></td>
      <td>${esc(fmtNum(r.total))}</td>
      <td class="left"><details><summary>wallets</summary><div class="wallet-list">${walletBits || '—'}</div></details></td>
    </tr>`;
  }).join('');

  const existingQ = root.querySelector('#exFilter')?.value || filter;
  root.innerHTML = `
    <div class="toolbar">
      <p class="hint">${esc(status)}${esc(progress)}. Primary total is the full XRPL scan of exchanges.json — not the thin trend seed.</p>
      <div>
        <input id="exFilter" class="search" type="search" placeholder="Filter venue" value="${esc(existingQ)}">
        <button id="exRefresh" class="btn" type="button">Rescan</button>
      </div>
    </div>
    <div class="banner">${full ? `Full-scan total ${esc(fmtXrp(grand, { compact: true }))}` : 'Scan in progress — totals appear as wallets return.'}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th class="left">#</th><th class="left">Venue</th><th>XRP</th><th class="left">Wallets</th></tr></thead>
        <tbody>${body || '<tr><td class="left" colspan="4">No venues</td></tr>'}</tbody>
      </table>
    </div>`;
}

export async function renderExchanges(root, { setStatus }) {
  root.innerHTML = `<div class="banner">Starting XRPL full scan…</div>`;
  setStatus('load', 'Scanning');
  try {
    const payload = await api.exchanges();
    renderTable(root, payload);
    const bind = () => {
      root.querySelector('#exFilter')?.addEventListener('input', (ev) => {
        renderTable(root, payload, ev.target.value);
        bind();
      });
      root.querySelector('#exRefresh')?.addEventListener('click', async () => {
        setStatus('load', 'Scanning');
        root.querySelector('#exRefresh').disabled = true;
        try {
          const fresh = await api.exchanges({ refresh: true });
          renderTable(root, fresh);
          bind();
          setStatus(fresh.source === 'xrpl-full-scan' && !(fresh.scan && fresh.scan.running) ? 'live' : 'load',
            fresh.scan && fresh.scan.running ? 'Scanning' : 'Live');
        } catch (err) {
          root.insertAdjacentHTML('afterbegin', `<div class="banner error">${esc(err.message)}</div>`);
          setStatus('error', 'Error');
        }
      });
    };
    bind();

    if (payload.scan && payload.scan.running) {
      const poll = async () => {
        try {
          const next = await api.exchanges();
          const filter = root.querySelector('#exFilter')?.value || '';
          renderTable(root, next, filter);
          bind();
          if (next.scan && next.scan.running) {
            setStatus('load', 'Scanning');
            setTimeout(poll, 4000);
          } else {
            setStatus(next.source === 'xrpl-full-scan' ? 'live' : 'error', next.source === 'xrpl-full-scan' ? 'Live' : 'Error');
          }
        } catch {
          setTimeout(poll, 6000);
        }
      };
      setTimeout(poll, 4000);
    } else {
      setStatus(payload.source === 'xrpl-full-scan' ? 'live' : 'error', payload.source === 'xrpl-full-scan' ? 'Live' : 'Error');
    }
  } catch (err) {
    root.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
