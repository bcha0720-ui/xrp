# XRP Insights

Small Express + modular frontend for XRP ETF holdings, a **full XRPL exchange wallet scan**, and Yahoo ETF volumes.

v1 is four tabs only: **Overview**, **Holdings**, **Exchanges**, **ETF Trading**.

This is a from-scratch redesign. The old ~20k-line `index.html` monolith is gone. A Render **Static Site** (no Node) cannot run the ETF proxy or the full exchange scan.

## Run locally

```bash
cd server
npm install
npm start
```

Open [http://127.0.0.1:3000/](http://127.0.0.1:3000/) (or `http://127.0.0.1:$PORT/` if `PORT` is set). The UI and APIs are same-origin.

```bash
curl -sS http://127.0.0.1:3000/api/health
curl -sS http://127.0.0.1:3000/api/holdings-cached
curl -sS http://127.0.0.1:3000/api/exchange-balances-cached
curl -sS http://127.0.0.1:3000/api/etf-data
curl -sS 'http://127.0.0.1:3000/api/historical?period=1mo'
```

Unknown `/api/*` routes return **JSON 404**, not HTML.

## Render (Free Web Service)

Use a **Web Service**, not a Static Site.

| Setting | Value |
|---|---|
| Root Directory | `server` |
| Runtime | Node 18+ |
| Build | `npm install` |
| Start | `npm start` |
| Health check | `/api/health` |

`PORT` is set by Render. Optional: `SHEET_CSV_URL`, `XRPL_CONCURRENCY` (default 20), `CACHE_TTL_MS`, `EXCHANGE_CACHE_TTL_MS`, `RIPPLED_URLS`.

## APIs

| Route | Source |
|---|---|
| `GET /api/health` | Process + cache + scan status |
| `GET /api/price` | XRP/USD (CoinGecko, Yahoo `XRP-USD` fallback) |
| `GET /api/holdings-cached` | Published Google Sheet CSV, cache ~5 minutes. Sparse rows only — empty cells stay `null`. Column **labels are the Sheet header**. Never invents numbers. |
| `GET /api/exchange-balances-cached` | Full XRPL `account_info` over `exchanges.json`. `source` is `xrpl-full-scan`. Includes `walletStats`. `?refresh=1` forces a rescan. |
| `GET /api/exchange-balances-cached/status` | In-flight scan progress |
| `GET /api/etf-data` | Yahoo chart for Spot / Futures / Canada / Index XRP ETF symbols |
| `GET /api/historical?period=1mo` | Yahoo historical series (`1mo`, `3mo`, `6mo`, `1y`). Empty object if Yahoo is blocked — no sample series. |

Holdings sheet:

`https://docs.google.com/spreadsheets/d/e/2PACX-1vS8ITdmh4kpKrfc714wtsXfzPhw9m5NC4gfD-vaVuBeA5dDeANcJwQJ-TK-eUJqlTRD1gsxP9rkiTod/pub?gid=1565352037&single=true&output=csv`

XRPL nodes (override with `RIPPLED_URLS`): `s1.ripple.com:51234`, `s2.ripple.com:51234`, `xrplcluster.com`. Concurrency ~20.

## `exchanges.json`

This repo already ships the full map: **62 venues / 766 wallets**, shape `{ "binance": { "rXXXX": "Label" }, ... }`.

To replace it, overwrite `server/exchanges.json` with the same shape and restart. Do not put balances in that file — only addresses and labels. The server never invents balances; it only sums XRPL `account_info` results.

The Exchanges tab status is `venues · wallets` from the live full scan. The old thin ~15-venue trend feed is **not** the primary total.

## Layout

```
/
  README.md
  server/
    index.js           Express APIs + static UI
    package.json
    exchanges.json     62 venues / 766 wallets
    public/
      index.html
      css/app.css
      js/api.js
      js/format.js
      js/app.js
      js/tabs/*.js
```

## Notes

- Holdings table is **sparse** (no forward-fill). Overview “ETF holdings” is the sum of each issuer’s **latest published** XRP figure from that sparse sheet.
- Exchange total is shown only when `source === "xrpl-full-scan"`.
- First full scan of ~766 wallets can take a couple of minutes; the UI polls `/status` / re-fetches while `scan.running` is true.
