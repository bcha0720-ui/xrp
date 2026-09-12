import { renderOverview } from './tabs/overview.js';
import { renderHoldings } from './tabs/holdings.js';
import { renderExchanges } from './tabs/exchanges.js';
import { renderEtf } from './tabs/etf.js';

const tabs = {
  overview: renderOverview,
  holdings: renderHoldings,
  exchanges: renderExchanges,
  etf: renderEtf,
};

const pill = document.getElementById('statusPill');
const retryBtn = document.getElementById('retryBtn');
let current = 'overview';
let rendered = new Set();

function setStatus(kind, label) {
  pill.className = `pill pill-${kind === 'live' ? 'live' : kind === 'error' ? 'error' : 'load'}`;
  pill.textContent = label;
}

function showTab(name) {
  current = name;
  document.querySelectorAll('.tab').forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const on = panel.id === `tab-${name}`;
    panel.classList.toggle('active', on);
    panel.hidden = !on;
  });
}

async function load(name, { force = false } = {}) {
  showTab(name);
  if (rendered.has(name) && !force) return;
  const root = document.getElementById(`tab-${name}`);
  await tabs[name](root, { setStatus });
  rendered.add(name);
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => load(btn.dataset.tab));
});

retryBtn.addEventListener('click', () => {
  rendered.delete(current);
  load(current, { force: true });
});

load('overview');
