import { renderOverview } from './tabs/overview.js';
import { renderHoldings } from './tabs/holdings.js';
import { renderExchanges } from './tabs/exchanges.js';
import { renderEtf } from './tabs/etf.js';
import { api } from './api.js';
import { fmtUsd, fmtPct, isNum } from './format.js';

const tabs = {
  overview: renderOverview,
  holdings: renderHoldings,
  exchanges: renderExchanges,
  etf: renderEtf,
};

const pill = document.getElementById('statusPill');
const retryBtn = document.getElementById('retryBtn');
const priceEl = document.getElementById('xrpPriceTopbar');
const toggle = document.getElementById('mobileNavToggle');
const backdrop = document.getElementById('mobileNavBackdrop');
const mobileNav = document.getElementById('mobileNav');

let current = 'overview';
const rendered = new Set();

function setStatus(kind, label) {
  const cls = kind === 'live' ? 'live' : kind === 'error' ? 'error' : 'load';
  if (pill) {
    pill.className = `live-chip ${cls}`;
    pill.textContent = label;
  }
}

function closeMobileNav() {
  toggle?.classList.remove('open');
  mobileNav?.classList.remove('open');
  if (mobileNav) mobileNav.hidden = true;
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.hidden = true;
  }
}

function openMobileNav() {
  toggle?.classList.add('open');
  if (mobileNav) {
    mobileNav.hidden = false;
    mobileNav.classList.add('open');
  }
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.add('open');
  }
}

function showTab(name) {
  current = name;
  document.querySelectorAll('.nav-link[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach((panel) => {
    const on = panel.id === `tab-${name}`;
    panel.classList.toggle('active', on);
    panel.hidden = !on;
  });
  closeMobileNav();
}

async function load(name, { force = false } = {}) {
  showTab(name);
  if (rendered.has(name) && !force) return;
  const root = document.getElementById(`tab-${name}`);
  await tabs[name](root, { setStatus, switchTab: load });
  rendered.add(name);
}

async function loadPrice() {
  try {
    const p = await api.price();
    if (!priceEl) return;
    const change = isNum(p.change24h) ? ` ${fmtPct(p.change24h)}` : '';
    priceEl.textContent = `${fmtUsd(p.usd)}${change}`;
    priceEl.className = `price-chip-value ${isNum(p.change24h) && p.change24h < 0 ? 'down' : 'up'}`;
  } catch {
    if (priceEl) priceEl.textContent = '—';
  }
}

document.querySelectorAll('.nav-link[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => load(btn.dataset.tab));
});

retryBtn?.addEventListener('click', () => {
  rendered.delete(current);
  load(current, { force: true });
  loadPrice();
});

toggle?.addEventListener('click', () => {
  if (mobileNav?.classList.contains('open')) closeMobileNav();
  else openMobileNav();
});
backdrop?.addEventListener('click', closeMobileNav);

loadPrice();
load('overview');
