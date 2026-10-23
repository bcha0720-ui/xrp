const DEFAULT_TIMEOUT = 25000;

export class ApiError extends Error {
  constructor(message, { status, path, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export async function getJson(path, { timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const res = await fetch(path, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) {
      const preview = (await res.text()).slice(0, 80);
      throw new ApiError(`Expected JSON from ${path}, got ${ct || 'unknown'}: ${preview}`, {
        status: res.status,
        path,
      });
    }
    const body = await res.json();
    if (!res.ok) {
      throw new ApiError(body.message || body.error || `HTTP ${res.status}`, {
        status: res.status,
        path,
        body,
      });
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(`Request timed out: ${path}`, { path });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export const api = {
  health: () => getJson('/api/health', { timeout: 8000 }),
  price: () => getJson('/api/price', { timeout: 15000 }),
  holdings: () => getJson('/api/holdings-cached', { timeout: 30000 }),
  exchanges: ({ refresh = false } = {}) =>
    getJson(`/api/exchange-balances-cached${refresh ? '?refresh=1' : ''}`, { timeout: 90000 }),
  exchangeStatus: () => getJson('/api/exchange-balances-cached/status', { timeout: 8000 }),
  etf: () => getJson('/api/etf-data', { timeout: 45000 }),
  historical: (period = '1mo') =>
    getJson(`/api/historical?period=${encodeURIComponent(period)}`, { timeout: 45000 }),
};
