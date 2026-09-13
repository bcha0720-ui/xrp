import { api } from '../api.js';
import { esc, fmtNum, fmtUsdM, fmtMillions, venueLabel, isNum } from '../format.js';

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
    <td>${esc(fmtNum(r.total))}</td>
    <td><details><summary>wallets</summary><div class="wallet-list">${walletBits || '—'}</div></details></td>
  </tr>`;
}

function rankHtml(list) {
  const top = list.slice(0, 8);
  const peak = top[0]?.total || 1;
  return top.map((r, i) => `
    <div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div>
        <div class="rank-name">${esc(r.name)}</div>
        <div class="rank-meta">${r.successCount}/${r.walletCount} wallets</div>
      </div>
      <div class="rank-val">${esc(fmtMillions(r.total))}</div>
      <div class="rank-bar"><i style="width:${Math.max(4, (r.total / peak) * 100)}%"></i></div>
    </div>`).join('');
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

  root.innerHTML = `
    <div class="page-head">
      <div class="hero-pill${running || !full ? ' warn' : ''}">${running ? 'Scanning XRPL' : full ? 'Live XRPL scan' : 'Waiting for scan'}</div>
      <h1>Exchange Balances</h1>
      <p>Full XRPL account_info over exchanges.json — not a thin sample.</p>
    </div>
    <div class="metric-board">
      <section class="card metric-stack">
        <div class="metric-block">
          <div class="k-label">Total XRP</div>
          <div class="k-value blue">${full ? esc(fmtMillions(grand)) : '—'}</div>
        </div>
        <div class="metric-block">
          <div class="k-label">USD value</div>
          <div class="k-value">${usd != null ? esc(fmtUsdM(usd)) : '—'}</div>
          <div class="k-sub">${usd != null ? 'total × live XRP price' : 'needs full scan + price'}</div>
        </div>
        <div class="metric-block">
          <div class="k-label">Venues tracked</div>
          <div class="k-value">${venues || '—'}</div>
        </div>
        <div class="metric-block">
          <div class="k-label">Wallets</div>
          <div class="k-value">${ok} / ${wallets || '—'}</div>
          <div class="k-sub">${running && scan ? `scan ${scan.done}/${scan.total}` : 'XRPL account_info'}</div>
        </div>
        <div class="metric-block">
          <div class="k-label">Data status</div>
          <div class="k-value" style="font-size:22px">${esc(payload.source || 'unknown')}</div>
        </div>
      </section>
      <section class="card">
        <div class="k-label">Largest venues</div>
        <div class="rank-list">${full ? rankHtml(list) : '<div class="k-sub">Ranked list appears after xrpl-full-scan.</div>'}</div>
      </section>
    </div>
    <div class="toolbar">
      <input id="exFilter" class="search" type="search" placeholder="Filter venue" value="${esc(filterVal)}">
      <button id="exRefresh" class="btn btn-blue" type="button">Refresh scan</button>
    </div>
    <div class="card table-card">
      <div class="table-head">
        <strong>Venue balances</strong>
        <span class="foot">${venues} venues</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Venue</th><th>XRP</th><th>Wallets</th></tr></thead>
          <tbody id="exBody">${list.map(rowHtml).join('') || '<tr><td colspan="4">No venues</td></tr>'}</tbody>
        </table>
      </div>
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
  root.innerHTML = `<div class="page-head"><div class="hero-pill warn">Scanning</div><h1>Exchange Balances</h1></div>
    <div class="banner">Starting XRPL full scan…</div>`;
  setStatus('load', 'Scanning');

  let payload;
  let priceUsd = null;

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
    root.innerHTML = `<div class="page-head"><div class="hero-pill err">Error</div><h1>Exchange Balances</h1></div>
      <div class="banner error">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}
