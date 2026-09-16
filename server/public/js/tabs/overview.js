import { api } from '../api.js';
import {
  esc, fmtPct, fmtUsd, fmtUsdM, fmtMillions, fmtCompact, fmtTime, supplyPct,
  latestReportedHoldings, derivedAum, flattenEtf, volumeField, issuerMeta,
  exchangeTotal, isNum,
} from '../format.js';

function yahooBySymbol(etf) {
  const map = {};
  for (const row of flattenEtf(etf)) {
    if (row.symbol) map[row.symbol.toUpperCase()] = row;
  }
  return map;
}

function rankRows(items, max) {
  const top = items.filter((x) => isNum(x.dollars)).sort((a, b) => b.dollars - a.dollars).slice(0, 8);
  const peak = top[0]?.dollars || 1;
  return top.map((item, i) => `
    <div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div>
        <div class="rank-name">${esc(item.name)}</div>
        <div class="rank-meta">${esc(item.meta || '')}</div>
      </div>
      <div class="rank-val">${esc(fmtUsdM(item.dollars))}</div>
      <div class="rank-bar"><i style="width:${Math.max(4, (item.dollars / peak) * 100)}%"></i></div>
    </div>`).join('');
}

export async function renderOverview(root, { setStatus, switchTab }) {
  root.innerHTML = `<div class="hero">
    <div class="hero-pill warn">Loading live data</div>
    <h1>XRP ETF Tracker</h1>
    <p>Holdings, vault totals, and volume from our sheet, XRPL scan, and Yahoo APIs.</p>
  </div>
  <div class="metric-board">
    <div class="card"><div class="skeleton" style="height:220px"></div></div>
    <div class="card"><div class="skeleton" style="height:220px"></div></div>
  </div>`;
  setStatus('load', 'Loading');

  const settled = await Promise.allSettled([
    api.price(),
    api.holdings(),
    api.exchanges(),
    api.etf(),
  ]);
  const [priceR, holdR, exR, etfR] = settled;
  const errors = settled.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));

  const price = priceR.status === 'fulfilled' ? priceR.value : null;
  const holdings = holdR.status === 'fulfilled' ? holdR.value : null;
  const exchanges = exR.status === 'fulfilled' ? exR.value : null;
  const etf = etfR.status === 'fulfilled' ? etfR.value : null;

  const cols = holdings?.columns || [];
  const { latest, totalXrp, issuersWithData } = latestReportedHoldings(holdings?.data || [], cols);
  const { aum, usedPrice } = derivedAum(latest, price?.usd);
  const yahoo = etf ? yahooBySymbol(etf) : {};
  const spot = ((etf && etf.data && etf.data['Spot ETFs']) || []).map((r) => ({
    name: r.description || r.symbol,
    meta: `${r.symbol}${isNum(r.daily?.shares) ? ` · ${fmtCompact(r.daily.shares)} shares` : ''}`,
    dollars: volumeField(r, 'daily').dollars,
  }));
  const spotVol = spot.reduce((s, r) => s + (isNum(r.dollars) ? r.dollars : 0), 0);

  const up = isNum(price?.change24h) && price.change24h >= 0;
  const chgAbs = isNum(price?.usd) && isNum(price?.change24h)
    ? price.usd * (price.change24h / 100)
    : null;

  const vaultItems = cols
    .map((col) => {
      const cell = latest[col.key] || {};
      return {
        key: col.key,
        name: col.label,
        xrp: cell.xrp,
        value: cell.value,
        date: cell.date,
      };
    })
    .filter((x) => isNum(x.xrp))
    .sort((a, b) => b.xrp - a.xrp);

  const issuerCards = cols.map((col) => {
    const meta = issuerMeta(col.key);
    const cell = latest[col.key] || {};
    const y = yahoo[meta.ticker];
    const vol = y ? volumeField(y, 'daily') : { dollars: null, shares: null };
    const cardAum = isNum(cell.value)
      ? cell.value
      : (isNum(cell.xrp) && isNum(price?.usd) ? cell.xrp * price.usd : null);
    if (!isNum(cell.xrp) && !y) return '';
    return `<article class="issuer-card">
      <div class="issuer-top">
        <div>
          <div class="issuer-ticker" style="color:${meta.color}">${esc(meta.ticker)}</div>
          <div class="issuer-name">${esc(col.label)}</div>
        </div>
        <div class="issuer-px">
          ${y && isNum(y.price) ? esc(fmtUsd(y.price)) : '—'}
        </div>
      </div>
      <div class="issuer-stats">
        <div>
          <div class="k-label">AUM</div>
          <div class="k-value" style="font-size:22px">${esc(fmtUsdM(cardAum))}</div>
        </div>
        <div>
          <div class="k-label">XRP locked</div>
          <div class="k-value blue" style="font-size:22px">${isNum(cell.xrp) ? esc(fmtMillions(cell.xrp)) : '—'}</div>
        </div>
      </div>
      <div class="issuer-vol">
        <div class="k-label">Daily volume</div>
        <div class="k-value" style="font-size:20px">${vol.dollars != null ? esc(fmtUsdM(vol.dollars)) : '—'}</div>
      </div>
    </article>`;
  }).join('');

  const vaultPeak = vaultItems[0]?.xrp || 1;
  const vaultRank = vaultItems.map((item, i) => {
    const meta = issuerMeta(item.key);
    return `<div class="rank-row">
      <div class="rank-num">${i + 1}</div>
      <div>
        <div class="rank-name">${esc(item.name)}</div>
        <div class="rank-meta">${esc(meta.ticker)}${item.date ? ` · ${esc(item.date)}` : ''}</div>
      </div>
      <div class="rank-val" style="color:${meta.color}">${esc(fmtMillions(item.xrp))}</div>
      <div class="rank-bar"><i style="width:${Math.max(4, (item.xrp / vaultPeak) * 100)}%;background:${meta.color}"></i></div>
    </div>`;
  }).join('');

  const fullScan = exchanges && exchanges.source === 'xrpl-full-scan';
  const ex = exchanges ? exchangeTotal(exchanges) : { total: null, venues: 0 };
  const notes = [];
  if (holdings?.stale) notes.push('Holdings cache is stale.');
  if (exchanges?.stale) notes.push('Exchange scan is still running or cache is stale.');
  if (exchanges) notes.push(`Exchanges updated ${fmtTime(exchanges.updatedAt)}.`);
  if (usedPrice) notes.push('Some AUM figures use latest XRP × live price when the sheet value cell is empty.');

  const errBanner = errors.length ? `<div class="banner error">${errors.map(esc).join(' · ')}</div>` : '';
  const info = notes.length ? `<div class="banner">${notes.map(esc).join(' ')}</div>` : '';

  root.innerHTML = `
    <div class="hero">
      <div class="hero-pill${errors.length ? ' warn' : ''}">${errors.length ? 'Partial live data' : 'Live ETF data'}</div>
      <h1>XRP ETF Tracker</h1>
      <p>Sheet holdings, XRPL exchange balances, and Yahoo volume — published figures only.</p>
    </div>
    ${errBanner}
    <div class="metric-board">
      <section class="card metric-stack">
        <div class="metric-block">
          <div class="k-label">XRP price</div>
          <div class="k-value">${price && isNum(price.usd) ? esc(fmtUsd(price.usd)) : '—'}
            ${isNum(price?.change24h) ? `<span class="k-delta ${up ? 'up' : 'down'}">${esc(fmtPct(price.change24h))}</span>` : ''}
          </div>
          <div class="k-sub">24h change: ${chgAbs != null ? `${chgAbs >= 0 ? '+' : ''}${esc(fmtUsd(chgAbs))}` : '—'} · ${esc(price?.source || 'unavailable')}</div>
        </div>
        <div class="metric-block" data-goto="holdings">
          <div class="k-label">Total AUM</div>
          <div class="k-value">${aum ? esc(fmtUsdM(aum)) : '—'}</div>
          <div class="k-sub">${issuersWithData} issuers with latest sheet figures</div>
        </div>
        <div class="metric-block" data-goto="holdings">
          <div class="k-label">XRP locked</div>
          <div class="k-value blue">${totalXrp ? esc(fmtMillions(totalXrp)) : '—'}</div>
          <div class="k-sub">Latest reported XRP in vaults · sparse sheet</div>
        </div>
        <div class="metric-block">
          <div class="k-label">% of total supply</div>
          <div class="k-value">${esc(supplyPct(totalXrp))}</div>
          <div class="k-sub">of 100B XRP · locked in reported ETF holdings</div>
        </div>
        <div class="metric-block" data-goto="exchanges">
          <div class="k-label">XRP on exchanges</div>
          <div class="k-value">${fullScan && isNum(ex.total) ? esc(fmtMillions(ex.total)) : '—'}</div>
          <div class="k-sub">${fullScan ? `${ex.venues} venues · full XRPL scan` : 'Waiting for xrpl-full-scan'}</div>
        </div>
      </section>
      <section class="card">
        <div class="volume-head">
          <div>
            <div class="k-label">Daily volume</div>
            <div class="k-value lg blue">${spotVol ? esc(fmtUsdM(spotVol)) : '—'}</div>
            <div class="k-sub">Spot ETF volume · Yahoo</div>
          </div>
          <button class="seg active" type="button" data-goto="etf">Spot ETFs</button>
        </div>
        <div class="rank-list">${rankRows(spot) || '<div class="k-sub">No Yahoo volume yet.</div>'}</div>
      </section>
    </div>
    ${info}
    <section class="section">
      <div class="section-title">XRP locked in ETF vaults</div>
      <div class="section-sub">Latest published XRP per issuer from the Google Sheet. Empty days stay empty.</div>
      <div class="card"><div class="rank-list">${vaultRank || '<div class="k-sub">No holdings rows.</div>'}</div></div>
    </section>
    <section class="section">
      <div class="section-title">Issuer cards</div>
      <div class="section-sub">Ticker, AUM, locked XRP, and Yahoo daily volume — no invented fills.</div>
      <div class="issuer-grid">${issuerCards || '<div class="banner">No issuer rows from the sheet or Yahoo.</div>'}</div>
    </section>
    <p class="foot">Overview joins the same three APIs as the other tabs. Holdings never forward-fill.</p>`;

  root.querySelectorAll('[data-goto]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => switchTab(el.dataset.goto));
  });

  if (errors.length === settled.length) setStatus('error', 'Error');
  else if (errors.length) setStatus('error', 'Partial');
  else if (exchanges?.scan?.running) setStatus('load', 'Scanning');
  else setStatus('live', 'Live');
}
