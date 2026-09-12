import { api } from '../api.js';
import { esc, fmtCompact, fmtPct, fmtUsd, fmtXrp, fmtTime, latestReportedHoldings, exchangeTotal, etfDailyVolume, isNum } from '../format.js';

function kpi(title, value, sub) {
  return `<article class="card"><h3>${esc(title)}</h3><div class="metric">${value}</div><div class="sub">${sub}</div></article>`;
}

function loadingGrid() {
  return `<div class="kpis">${Array.from({ length: 4 }, () => `<article class="card"><div class="skeleton"></div><div class="skeleton" style="margin-top:16px;width:70%"></div></article>`).join('')}</div>`;
}

export async function renderOverview(root, { setStatus }) {
  root.innerHTML = loadingGrid();
  setStatus('load', 'Loading');

  const settled = await Promise.allSettled([
    api.price(),
    api.holdings(),
    api.exchanges(),
    api.etf(),
  ]);

  const [priceR, holdR, exR, etfR] = settled;
  const errors = settled
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));

  let priceHtml = kpi('XRP price', '—', 'Unavailable');
  if (priceR.status === 'fulfilled') {
    const p = priceR.value;
    const change = isNum(p.change24h) ? `<span class="${p.change24h >= 0 ? 'delta-up' : 'delta-down'}">${esc(fmtPct(p.change24h))}</span> 24h` : '';
    priceHtml = kpi('XRP price', esc(fmtUsd(p.usd)), `${change} · ${esc(p.source || 'live')}`);
  }

  let holdHtml = kpi('ETF holdings', '—', 'Sheet unavailable');
  if (holdR.status === 'fulfilled') {
    const h = holdR.value;
    const cols = h.columns || [];
    const { totalXrp, issuersWithData } = latestReportedHoldings(h.data || [], cols);
    holdHtml = kpi(
      'ETF holdings',
      esc(fmtXrp(totalXrp, { compact: true })),
      `${issuersWithData} issuers · latest reported (sparse, no fill) · ${esc(h.source || 'google-sheet-csv')}`
    );
  }

  let exHtml = kpi('Exchange total', '—', 'XRPL scan unavailable');
  if (exR.status === 'fulfilled') {
    const e = exR.value;
    const full = e.source === 'xrpl-full-scan';
    const { total, venues } = exchangeTotal(e);
    const ws = e.walletStats || {};
    const scan = e.scan;
    const statusLine = full
      ? `${venues} venues · ${ws.success ?? '—'} / ${ws.total ?? '—'} wallets`
      : `Waiting for full XRPL scan (source=${e.source || 'unknown'})`;
    const extra = scan && scan.running ? ` · scanning ${scan.done}/${scan.total}` : '';
    exHtml = kpi(
      'Exchange total',
      full ? esc(fmtXrp(total, { compact: true })) : 'Scanning…',
      `${statusLine}${extra}`
    );
  }

  let etfHtml = kpi('ETF volume', '—', 'Yahoo unavailable');
  if (etfR.status === 'fulfilled') {
    const vol = etfDailyVolume(etfR.value);
    etfHtml = kpi(
      'ETF daily volume',
      esc(fmtUsd(vol.dollars)),
      `${esc(fmtCompact(vol.shares))} shares · ${vol.count} symbols · Yahoo`
    );
  }

  const notes = [];
  if (holdR.status === 'fulfilled' && holdR.value.stale) notes.push('Holdings cache is stale.');
  if (exR.status === 'fulfilled' && exR.value.stale) notes.push('Exchange scan is still running or cache is stale.');
  if (exR.status === 'fulfilled') {
    notes.push(`Exchanges updated ${fmtTime(exR.value.updatedAt)}.`);
  }

  const errBanner = errors.length
    ? `<div class="banner error">${errors.map(esc).join(' · ')}</div>`
    : '';
  const info = notes.length ? `<div class="banner">${notes.map(esc).join(' ')}</div>` : '';

  root.innerHTML = `${errBanner}${info}<div class="kpis">${priceHtml}${holdHtml}${exHtml}${etfHtml}</div>
    <p class="hint" style="margin-top:16px">Overview totals use the same APIs as the other tabs. Holdings total is the sum of each issuer’s most recent published XRP figure — empty sheet cells stay empty (no forward-fill).</p>`;

  if (errors.length === settled.length) setStatus('error', 'Error');
  else if (errors.length) setStatus('error', 'Partial');
  else if (exR.status === 'fulfilled' && exR.value.scan && exR.value.scan.running) setStatus('load', 'Scanning');
  else setStatus('live', 'Live');
}
