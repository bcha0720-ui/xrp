import { api } from '../api.js';
import {
  esc, fmtCompact, fmtPct, fmtUsd, fmtUsdCompact, fmtXrp, fmtTime,
  latestReportedHoldings, exchangeTotal, etfDailyVolume, isNum,
} from '../format.js';

function kpi({ icon, badge, badgeClass, value, valueClass, label, sub, tab }) {
  return `<article class="kpi-card" data-goto="${esc(tab || '')}">
    <div class="kpi-top">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-trend-badge ${badgeClass || ''}">${esc(badge)}</div>
    </div>
    <div class="kpi-value ${valueClass || ''}">${value}</div>
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-sub">${sub}</div>
  </article>`;
}

function loadingGrid() {
  return `<div class="kpi-row">${Array.from({ length: 4 }, () =>
    `<article class="kpi-card"><div class="skeleton"></div><div class="skeleton" style="margin-top:18px;width:70%"></div><div class="skeleton" style="margin-top:10px;width:40%"></div></article>`
  ).join('')}</div>`;
}

export async function renderOverview(root, { setStatus, switchTab }) {
  root.innerHTML = `<div class="page-hero">
    <div class="page-hero-badge">Dashboard</div>
    <div class="page-hero-title">Overview</div>
    <div class="page-hero-subtitle">Live sheet, XRPL scan, and Yahoo ETF volume — no invented figures</div>
  </div>${loadingGrid()}`;
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

  let priceHtml = kpi({
    icon: '💲', badge: '—', value: '—', valueClass: 'purple',
    label: 'XRP Price', sub: 'Unavailable',
  });
  if (priceR.status === 'fulfilled') {
    const p = priceR.value;
    const up = isNum(p.change24h) && p.change24h >= 0;
    const change = isNum(p.change24h)
      ? `<span class="${up ? 'delta-up' : 'delta-down'}">${esc(fmtPct(p.change24h))}</span> 24h · ${esc(p.source || 'live')}`
      : esc(p.source || 'live');
    priceHtml = kpi({
      icon: '💲',
      badge: 'Live',
      badgeClass: 'positive',
      value: esc(fmtUsd(p.usd)),
      valueClass: 'purple',
      label: 'XRP Price',
      sub: change,
    });
  }

  let holdHtml = kpi({
    icon: '💎', badge: '—', value: '—', valueClass: 'xrp',
    label: 'Total XRP in Spot ETFs', sub: 'Sheet unavailable', tab: 'holdings',
  });
  if (holdR.status === 'fulfilled') {
    const h = holdR.value;
    const cols = h.columns || [];
    const { totalXrp, issuersWithData } = latestReportedHoldings(h.data || [], cols);
    holdHtml = kpi({
      icon: '💎',
      badge: h.stale ? 'Stale' : 'Live',
      badgeClass: h.stale ? 'warn' : 'positive',
      value: esc(fmtXrp(totalXrp, { compact: true })),
      valueClass: 'xrp',
      label: 'Total XRP in Spot ETFs',
      sub: `${issuersWithData} issuers · latest reported (sparse) · ${esc(h.source || 'google-sheet-csv')}`,
      tab: 'holdings',
    });
    const badge = document.getElementById('badgeHoldings');
    if (badge) {
      badge.textContent = h.stale ? 'Stale' : 'Live';
      badge.className = `sidebar-badge ${h.stale ? 'amber' : 'live'}`;
    }
  }

  let exHtml = kpi({
    icon: '🏦', badge: '—', value: '—', valueClass: 'blue',
    label: 'XRP on Exchanges', sub: 'XRPL scan unavailable', tab: 'exchanges',
  });
  if (exR.status === 'fulfilled') {
    const e = exR.value;
    const full = e.source === 'xrpl-full-scan';
    const { total, venues } = exchangeTotal(e);
    const ws = e.walletStats || {};
    const scan = e.scan;
    const running = scan && scan.running;
    const statusLine = full
      ? `${venues} venues · ${ws.success ?? '—'} / ${ws.total ?? '—'} wallets`
      : `Waiting for full XRPL scan`;
    const extra = running ? ` · scanning ${scan.done}/${scan.total}` : '';
    exHtml = kpi({
      icon: '🏦',
      badge: running ? 'Scan' : full ? 'Live' : 'Wait',
      badgeClass: running ? 'warn' : full ? 'positive' : 'warn',
      value: full ? esc(fmtXrp(total, { compact: true })) : 'Scanning…',
      valueClass: 'blue',
      label: 'XRP on Exchanges',
      sub: `${statusLine}${extra}`,
      tab: 'exchanges',
    });
    const badge = document.getElementById('badgeExchanges');
    if (badge) badge.textContent = String(venues || 62);
  }

  let etfHtml = kpi({
    icon: '📈', badge: '—', value: '—', valueClass: 'green',
    label: 'ETF Trading Volume', sub: 'Yahoo unavailable', tab: 'etf',
  });
  if (etfR.status === 'fulfilled') {
    const vol = etfDailyVolume(etfR.value);
    etfHtml = kpi({
      icon: '📈',
      badge: 'Today',
      badgeClass: 'positive',
      value: esc(fmtUsdCompact(vol.dollars)),
      valueClass: 'green',
      label: 'ETF Trading Volume',
      sub: `${esc(fmtCompact(vol.shares))} shares · ${vol.count} symbols · Yahoo`,
      tab: 'etf',
    });
  }

  const notes = [];
  if (holdR.status === 'fulfilled' && holdR.value.stale) notes.push('Holdings cache is stale.');
  if (exR.status === 'fulfilled' && exR.value.stale) notes.push('Exchange scan is still running or cache is stale.');
  if (exR.status === 'fulfilled') notes.push(`Exchanges updated ${fmtTime(exR.value.updatedAt)}.`);

  const errBanner = errors.length
    ? `<div class="banner error">${errors.map(esc).join(' · ')}</div>`
    : '';
  const info = notes.length ? `<div class="banner">${notes.map(esc).join(' ')}</div>` : '';

  root.innerHTML = `<div class="page-hero">
      <div class="page-hero-badge">Dashboard</div>
      <div class="page-hero-title">Overview</div>
      <div class="page-hero-subtitle">Live sheet, XRPL scan, and Yahoo ETF volume — no invented figures</div>
    </div>
    ${errBanner}${info}
    <div class="kpi-row">${holdHtml}${exHtml}${etfHtml}${priceHtml}</div>
    <p class="hint">Overview totals use the same APIs as the other tabs. Holdings total is the sum of each issuer’s most recent published XRP figure — empty sheet cells stay empty (no forward-fill).</p>`;

  root.querySelectorAll('.kpi-card[data-goto]').forEach((card) => {
    const tab = card.dataset.goto;
    if (!tab || typeof switchTab !== 'function') return;
    card.addEventListener('click', () => switchTab(tab));
  });

  if (errors.length === settled.length) setStatus('error', 'Error');
  else if (errors.length) setStatus('error', 'Partial');
  else if (exR.status === 'fulfilled' && exR.value.scan && exR.value.scan.running) setStatus('load', 'Scanning');
  else setStatus('live', 'Live');
}
