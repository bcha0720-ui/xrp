import { api } from '../api.js';
import { esc, fmtNum, fmtUsdCompact, fmtXrp, venueLabel, isNum } from '../format.js';

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
  return `<tr data-name="${esc((r.name + ' ' + r.key).toLowerCase())}">
    <td>${i + 1}</td>
    <td>${esc(r.name)}<div class="venue-meta">${r.successCount}/${r.walletCount} wallets</div></td>
    <td class="num">${esc(fmtNum(r.total))}</td>
    <td><details><summary>wallets</summary><div class="wallet-list">${walletBits || '—'}</div></details></td>
  </tr>`;
}

function paint(root, payload, priceUsd) {
  const full = payload.source === 'xrpl-full-scan';
  const ws = payload.walletStats || {};
  const scan = payload.scan;
  const venues = Object.keys(payload.data || {}).length;
  const list = rowsFrom(payload);
  const grand = list.reduce((s, r) => s + r.total, 0);
  const usd = full && isNum(priceUsd) ? grand * priceUsd : null;
  const running = scan && scan.running;
  const wallets = ws.total ?? list.reduce((s, r) => s + r.walletCount, 0);
  const ok = ws.success ?? '—';
  const filterVal = root.querySelector('#exFilter')?.value || '';

  const statusLabel = running ? 'Scanning' : full ? 'Live scan' : 'Waiting';
  const statusClass = running ? 'warn' : full ? '' : 'warn';

  root.innerHTML = `
    <div class="page-hero">
      <div class="page-hero-badge${statusClass ? ` ${statusClass}` : ''}">${statusLabel}</div>
      <div class="page-hero-title">Exchange Balances</div>
      <div class="page-hero-subtitle">Full XRPL account_info over exchanges.json — not a thin sample</div>
    </div>
    <div class="exchange-summary">
      <div class="exchange-stat-card">
        <div class="exchange-stat-label">Total XRP</div>
        <div class="exchange-stat-value accent">${full ? esc(fmtXrp(grand, { compact: true })) : '—'}</div>
      </div>
      <div class="exchange-stat-card">
        <div class="exchange-stat-label">USD value</div>
        <div class="exchange-stat-value">${usd != null ? esc(fmtUsdCompact(usd)) : '—'}</div>
        <div class="exchange-stat-sub">${usd != null ? 'total × live XRP price' : 'needs full scan + price'}</div>
      </div>
      <div class="exchange-stat-card">
        <div class="exchange-stat-label">Venues tracked</div>
        <div class="exchange-stat-value">${venues || '—'}</div>
      </div>
      <div class="exchange-stat-card">
        <div class="exchange-stat-label">Wallets</div>
        <div class="exchange-stat-value">${ok} / ${wallets || '—'}</div>
        <div class="exchange-stat-sub">${running && scan ? `scan ${scan.done}/${scan.total}` : 'XRPL account_info'}</div>
      </div>
      <div class="exchange-stat-card">
        <div class="exchange-stat-label">Data status</div>
        <div class="exchange-stat-value ${full && !running ? 'green' : ''}">${esc(payload.source || 'unknown')}</div>
      </div>
    </div>
    <div class="exchange-controls">
      <input id="exFilter" class="search" type="search" placeholder="Filter venue" value="${esc(filterVal)}">
      <button id="exRefresh" class="btn btn-refresh" type="button">↻ Refresh</button>
    </div>
    <div class="exchange-table-header">
      <div class="exchange-table-title">Venue balances</div>
      <div class="exchange-count">${venues} venues</div>
    </div>
    <div class="exchange-table-wrapper">
      <table class="data-table">
        <thead><tr><th>#</th><th>Venue</th><th>XRP</th><th>Wallets</th></tr></thead>
        <tbody id="exBody">${list.map(rowHtml).join('') || '<tr><td colspan="4">No venues</td></tr>'}</tbody>
      </table>
    </div>`;
  applyFilter(root);
}

function applyFilter(root) {
  const q = (root.querySelector('#exFilter')?.value || '').trim().toLowerCase();
  root.querySelectorAll('#exBody tr[data-name]').forEach((tr) => {
    tr.hidden = !!(q && !(tr.dataset.name || '').includes(q));
  });
}

export async function renderExchanges(root, { setStatus }) {
  root.innerHTML = `<div class="page-hero">
    <div class="page-hero-badge warn">Scanning</div>
    <div class="page-hero-title">Exchange Balances</div>
  </div><div class="banner">Starting XRPL full scan…</div>`;
  setStatus('load', 'Scanning');

  let payload;
  let priceUsd = null;
  api.price().then((p) => { if (isNum(p.usd)) priceUsd = p.usd; }).catch(() => {});

  const onFilter = () => applyFilter(root);
  const onRefresh = async () => {
    const btn = root.querySelector('#exRefresh');
    if (btn) btn.disabled = true;
    setStatus('load', 'Scanning');
    try {
      payload = await api.exchanges({ refresh: true });
      paint(root, payload, priceUsd);
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
    const [ex, price] = await Promise.all([
      api.exchanges(),
      api.price().catch(() => null),
    ]);
    payload = ex;
    if (price && isNum(price.usd)) priceUsd = price.usd;
    paint(root, payload, priceUsd);
    bind();

    if (payload.scan && payload.scan.running) {
      const poll = async () => {
        try {
          payload = await api.exchanges();
          const keep = root.querySelector('#exFilter')?.value || '';
          paint(root, payload, priceUsd);
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
    root.innerHTML = `<div class="page-hero"><div class="page-hero-badge err">Error</div><div class="page-hero-title">Exchange Balances</div></div>
      <div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
