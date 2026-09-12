# XRP Insights Server

Small Node.js Express backend that implements the cache APIs the frontend expects, plus optional static serving of `../index.html` for a unified deploy.

## What it provides

| Route | Behavior |
|-------|----------|
| `GET /api/health` | `{ ok: true, … }` health + cache age + XRPL scan status |
| `GET /api/holdings-cached` | Fetches the **Google Sheet CSV** server-side (no CORS), parses rows, caches ~5 min in memory (+ `cache/holdings.json`) |
| `GET /api/exchange-balances-cached` | **Full XRPL scan** of all wallets in `exchanges.json` (~62 venues / ~766 addresses) via public rippled `account_info`, aggregates per venue, caches ~5–10 min |
| `GET /api/exchange-balances-cached?refresh=1` | Force a fresh XRPL rescan (joins in-flight scan if already running) |
| `GET /api/exchange-balances-cached/status` | Progress while a scan is in flight (`done` / `total` / `success` / `failed`) |
| `GET /api/exchange/trend?days=90` | Thin JSON proxy to `UPSTREAM_API` (default `https://xrp-gtve.onrender.com`) — used only as a cold-start seed while XRPL scan starts |
| `GET /api/*` (unknown) | **JSON 404** — never SPA HTML |
| `GET /` and static assets | Serves `../index.html` and sibling files from the repo root |

All `/api/*` responses use `Content-Type: application/json`.

**Important:** The old static host `https://xrp-gtve.onrender.com` does **not** implement the XRPL full-scan balances API. For reliable ~800-wallet sums you must **deploy this server** (or run it locally) and serve the frontend from the same origin (or point `window.API_URL` at it).

## Exchange balances — full XRPL scan

On startup (and on cache miss / `?refresh=1`), the server:

1. Loads `exchanges.json` (62 venues, 766 wallet addresses).
2. Optionally seeds a thin trend snapshot so the UI is not empty while scanning.
3. Queries each address with HTTP JSON-RPC `account_info` against public nodes:
   - `https://s1.ripple.com:51234/`
   - `https://s2.ripple.com:51234/`
   - `https://xrplcluster.com/`
4. Runs with bounded concurrency (default **20**), ~8s per-request timeout, failover to the next node.
5. Converts drops → XRP, sums per venue, and caches in memory + `cache/exchange-balances.json`.

**Never invents balances** — only XRPL responses (or a prior on-disk/memory cache).

Cold first request: the handler waits up to ~60s for useful scan progress, then returns a partial payload with `"stale": true` / `scan.running` while the background scan continues. Poll `/api/exchange-balances-cached/status` or re-fetch the main route.

### Exchange balances response shape

```json
{
  "data": {
    "binance": {
      "total": 2702941359.12,
      "walletCount": 149,
      "successCount": 149,
      "staleCount": 0,
      "wallets": {
        "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh": {
          "name": "Binance",
          "balance": 123456.78,
          "stale": false
        }
      }
    }
  },
  "updatedAt": 1726100000000,
  "stale": false,
  "count": 62,
  "source": "xrpl-full-scan",
  "walletStats": { "total": 766, "success": 766, "failed": 0 }
}
```

`source` is `"xrpl-full-scan"` after a real wallet scan. A cold trend seed may briefly use `"upstream-exchange-trend"` until XRPL results replace it.

## Google Sheet (holdings source of truth)

Extracted from `index.html` (`SHEET_CSV_URL_RAW`):

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vS8ITdmh4kpKrfc714wtsXfzPhw9m5NC4gfD-vaVuBeA5dDeANcJwQJ-TK-eUJqlTRD1gsxP9rkiTod/pub?gid=1565352037&single=true&output=csv
```

`/api/holdings-cached` **always** uses this published CSV (or `SHEET_CSV_URL` env override). It does **not** invent holdings numbers.

### Holdings response shape

```json
{
  "data": [ { "date": "9/10/2026", "franklin": { "xrp": 278490139.54, "value": 376941973.67 } } ],
  "updatedAt": 1726100000000,
  "stale": false,
  "count": 130,
  "source": "google-sheet-csv"
}
```

If a refresh fails but a prior cache exists, the API still returns that data with `"stale": true`.

## Run locally (full scan)

```bash
cd /workspace/xrp-insights/server
npm install
npm start
# listens on PORT (default 3000)
```

Then open the app from the **same origin** so the frontend uses `API_URL = ''`:

```bash
# already served by this process:
open http://127.0.0.1:3000/
```

### curl examples

```bash
# Health (includes exchangesConfigured + scan)
curl -sS http://127.0.0.1:3000/api/health | jq .

# Full XRPL exchange balances (may wait up to ~60s on cold start)
curl -sS http://127.0.0.1:3000/api/exchange-balances-cached \
  | jq '{source, count, stale, walletStats, venues: (.data|keys|length)}'

# Force rescan
curl -sS 'http://127.0.0.1:3000/api/exchange-balances-cached?refresh=1' \
  | jq '{source, walletStats, top: [.data|to_entries|sort_by(-.value.total)[:3][]|{key,.value.total}]}'

# Scan progress
curl -sS http://127.0.0.1:3000/api/exchange-balances-cached/status | jq .

# Holdings
curl -sS http://127.0.0.1:3000/api/holdings-cached | jq '{count, updatedAt, stale, first: .data[0]}'

# Trend proxy (thin seed / charts)
curl -sS 'http://127.0.0.1:3000/api/exchange/trend?days=90' | jq '{count, latestDate: .latest.date}'
```

Optional env:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Listen port |
| `CACHE_TTL_MS` | `300000` (5 min) | Holdings cache TTL |
| `EXCHANGE_CACHE_TTL_MS` | `480000` (8 min) | XRPL exchange balances TTL |
| `XRPL_CONCURRENCY` | `20` | Parallel `account_info` requests |
| `XRPL_REQ_TIMEOUT_MS` | `8000` | Per-node timeout |
| `EXCHANGE_COLD_WAIT_MS` | `60000` | Max wait on cold `/api/exchange-balances-cached` |
| `RIPPLED_URLS` | s1,s2,xrplcluster | Comma-separated JSON-RPC endpoints |
| `SHEET_CSV_URL` | (Sheet URL above) | Holdings CSV source of truth |
| `UPSTREAM_API` | `https://xrp-gtve.onrender.com` | Trend seed / proxy upstream |

## Deploy on Render (Web Service) — required for production full scan

Browser-side XRPL expand is flaky/rate-limited for ~800 wallets. **Deploy this server** so the full scan runs server-side:

1. Create a **Web Service** from the repo (or this folder).
2. **Root Directory:** `server` (if the repo root is `xrp-insights`).
3. **Runtime:** Node 18+
4. **Build command:** `npm install`
5. **Start command:** `npm start` (`node index.js`)
6. **Environment:** `PORT` (Render sets this); optional `XRPL_CONCURRENCY`, `EXCHANGE_CACHE_TTL_MS`, `SHEET_CSV_URL`, `UPSTREAM_API`, `RIPPLED_URLS`
7. Ensure parent `index.html` is available as `../index.html` (deploy whole `xrp-insights` tree with Root Directory = `server`).

Health check path: `/api/health`

After deploy:

```bash
curl -sS https://YOUR-SERVICE.onrender.com/api/exchange-balances-cached \
  | jq '{source, count, walletStats}'
# expect: source=xrpl-full-scan, count≈62, walletStats.success high (hundreds)
```

Point the frontend at this service (same-origin static serve is ideal). The fallback `https://xrp-gtve.onrender.com` alone will **not** give full-scan totals.

## Dependencies

Minimal: `express`, `cors`. Uses Node 18+ native `fetch` (no `node-fetch`).

## Cache files

Under `server/cache/`:

- `holdings.json` — Sheet snapshot
- `exchange-balances.json` — last XRPL full-scan (or trend seed) snapshot

Used to warm memory after restart; refreshed from live Sheet / XRPL within TTL.
