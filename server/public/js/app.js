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
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const lastUpdated = document.getElementById('lastUpdated');
const priceEl = document.getElementById('xrpPriceTopbar');
const sidebar = document.getElementById('mainSidebar');
const toggle = document.getElementById('mobileNavToggle');
const backdrop = document.getElementById('mobileNavBackdrop');

let current = 'overview';
const rendered = new Set();

function setStatus(kind, label) {
  const cls = kind === 'live' ? 'live' : kind === 'error' ? 'error' : 'load';
  if (pill) {
    pill.className = `status-chip ${cls}`;
    pill.textContent = label;
  }
  if (statusDot) statusDot.className = `status-dot ${cls}`;
  if (statusText) statusText.textContent = label;
  if (kind === 'live' && lastUpdated) {
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }
}

function closeMobileNav() {
  sidebar?.classList.remove('mobile-open');
  toggle?.classList.remove('open');
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.hidden = true;
  }
}

function openMobileNav() {
  sidebar?.classList.add('mobile-open');
  toggle?.classList.add('open');
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.add('open');
  }
}

function showTab(name) {
  current = name;
  document.querySelectorAll('.sidebar-item[data-tab]').forEach((btn) => {
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
  } catch {
    if (priceEl) priceEl.textContent = '—';
  }
}

document.querySelectorAll('.sidebar-item[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => load(btn.dataset.tab));
});

retryBtn?.addEventListener('click', () => {
  rendered.delete(current);
  load(current, { force: true });
  loadPrice();
});

toggle?.addEventListener('click', () => {
  if (sidebar?.classList.contains('mobile-open')) closeMobileNav();
  else openMobileNav();
});

backdrop?.addEventListener('click', closeMobileNav);

loadPrice();
load('overview');
