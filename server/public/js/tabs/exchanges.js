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

function rowHtml(r, i) {
  const walletBits = Object.entries(r.wallets)
    .sort((a, b) => (b[1]?.balance || 0) - (a[1]?.balance || 0))
    .slice(0, 8)
    .map(([addr, w]) => `${esc(w.name || addr)} · ${isNum(w.balance) ? fmtNum(w.balance) : '—'}`)
    .join('<br>');
  return `<tr class="row-hover" data-name="${esc((r.name + ' ' + r.key).toLowerCase())}">
    <td class="left">${i + 1}</td>
    <td class="left">${esc(r.name)}<div class="venue-meta">${r.successCount}/${r.walletCount} wallets</div></td>
    <td>${esc(fmtNum(r.total))}</td>
    <td class="left"><details><summary>wallets</summary><div class="wallet-list">${walletBits || '—'}</div></details></td>
  </tr>`;
}

function paint(root, payload) {
  const full = payload.source === 'xrpl-full-scan';
  const ws = payload.walletStats || {};
  const scan = payload.scan;
  const venues = Object.keys(payload.data || {}).length;
  const list = rowsFrom(payload);
  const grand = list.reduce((s, r) => s + r.total, 0);
  const status = full
    ? `${venues} venues · ${ws.total ?? '—'} wallets`
    : `Source ${payload.source || 'unknown'} — waiting for xrpl-full-scan`;
  const progress = scan && scan.running ? ` · scan ${scan.done}/${scan.total} (ok ${scan.success}, fail ${scan.failed})` : '';
  const filterVal = root.querySelector('#exFilter')?.value || '';

  root.innerHTML = `
    <div class="toolbar">
      <p class="hint">${esc(status)}${esc(progress)}. Primary total is the full XRPL scan of exchanges.json — not the thin trend seed.</p>
      <div>
        <input id="exFilter" class="search" type="search" placeholder="Filter venue" value="${esc(filterVal)}">
        <button id="exRefresh" class="btn" type="button">Rescan</button>
      </div>
    </div>
    <div id="exBanner" class="banner">${full ? `Full-scan total ${esc(fmtXrp(grand, { compact: true }))}` : 'Scan in progress — totals appear as wallets return.'}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th class="left">#</th><th class="left">Venue</th><th>XRP</th><th class="left">Wallets</th></tr></thead>
        <tbody id="exBody">${list.map(rowHtml).join('') || '<tr><td class="left" colspan="4">No venues</td></tr>'}</tbody>
      </table>
    </div>`;
  applyFilter(root);
}

function applyFilter(root) {
  const q = (root.querySelector('#exFilter')?.value || '').trim().toLowerCase();
  const rows = root.querySelectorAll('#exBody tr[data-name]');
  let n = 0;
  rows.forEach((tr) => {
    const show = !q || (tr.dataset.name || '').includes(q);
    tr.hidden = !show;
    if (show) n += 1;
  });
}

export async function renderExchanges(root, { setStatus }) {
  root.innerHTML = `<div class="banner">Starting XRPL full scan…</div>`;
  setStatus('load', 'Scanning');

  let payload;

  const onFilter = () => applyFilter(root);
  const onRefresh = async () => {
    const btn = root.querySelector('#exRefresh');
    if (btn) btn.disabled = true;
    setStatus('load', 'Scanning');
    try {
      payload = await api.exchanges({ refresh: true });
      paint(root, payload);
      bind();
      const running = payload.scan && payload.scan.running;
      setStatus(payload.source === 'xrpl-full-scan' && !running ? 'live' : running ? 'load' : 'error',
        running ? 'Scanning' : payload.source === 'xrpl-full-scan' ? 'Live' : 'Error');
    } catch (err) {
      root.insertAdjacentHTML('afterbegin', `<div class="banner error">${esc(err.message)}</div>`);
      setStatus('error', 'Error');
    }
  };

  function bind() {
    root.querySelector('#exFilter')?.addEventListener('input', onFilter);
    root.querySelector('#exRefresh')?.addEventListener('click', onRefresh);
  }

  try {
    payload = await api.exchanges();
    paint(root, payload);
    bind();

    if (payload.scan && payload.scan.running) {
      const poll = async () => {
        try {
          payload = await api.exchanges();
          const keep = root.querySelector('#exFilter')?.value || '';
          paint(root, payload);
          const input = root.querySelector('#exFilter');
          if (input) input.value = keep;
          applyFilter(root);
          bind();
          if (payload.scan && payload.scan.running) {
            setStatus('load', 'Scanning');
            setTimeout(poll, 4000);
          } else {
            setStatus(payload.source === 'xrpl-full-scan' ? 'live' : 'error',
              payload.source === 'xrpl-full-scan' ? 'Live' : 'Error');
          }
        } catch {
          setTimeout(poll, 6000);
        }
      };
      setTimeout(poll, 4000);
    } else {
      setStatus(payload.source === 'xrpl-full-scan' ? 'live' : 'error',
        payload.source === 'xrpl-full-scan' ? 'Live' : 'Error');
    }
  } catch (err) {
    root.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
