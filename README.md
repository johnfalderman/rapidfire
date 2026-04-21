# Rapidfire

Personal stock-charting web app. Phase 2: real market data from Polygon.io,
cached in Netlify Blobs via a nightly scheduled function.

## Stack

- Vite + React (JavaScript)
- Tailwind CSS
- lightweight-charts (TradingView)
- Netlify Functions + Netlify Blobs (data cache)

## Local dev

```
npm install
npm run dev
```

`npm run dev` will sit on the loading state unless the function layer is
also running — see the Netlify Dev section below if you want real data
locally.

## Keyboard

- `←` / `→` or `J` / `K` — previous / next ticker

## Data pipeline

```
Polygon /v2/aggs  →  refresh-data (cron 02:00 UTC)  →  Netlify Blobs  →  get-data  →  client
```

- `netlify/functions/refresh-data.js` — walks the full S&P 100, calls Polygon
  for the last 400 calendar days of daily bars, and writes the combined
  result to Netlify Blobs as `sp100.json`. A 13-second sleep between calls
  stays safely under Polygon's free-tier 5-req/min limit.
- `netlify/functions/get-data.js` — thin read-through endpoint. Returns
  `{ status: 'ok' | 'empty' | 'error', ... }`.
- `src/data/tickers.js` — canonical S&P 100 list (symbol + name + sector).

### Environment

Set on Netlify (Site settings → Environment variables):

| Var               | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `POLYGON_API_KEY` | Polygon.io API key used by `refresh-data` |

For local runs of the functions: put the same key in a `.env` file or use
`netlify env:set POLYGON_API_KEY ...`.

### Netlify Dev (functions locally)

```
npm install -g netlify-cli          # if you don't have it
netlify link                        # link to the site
netlify dev                         # runs Vite + functions together
```

`netlify dev` proxies `/.netlify/functions/*` to the local function runtime,
so the client's `fetch('/.netlify/functions/get-data')` works against your
dev machine.

### First-time cache seeding

The scheduled function runs every day at 02:00 UTC. After the first deploy
the cache will be empty until the first run — trigger it manually to avoid
waiting:

**Netlify UI:** Site → Functions → `refresh-data` → "Run now".

**CLI:**

```
netlify functions:invoke refresh-data --no-identity
```

A full run takes roughly 22 minutes (101 tickers × 13 s/call). Watch
function logs for Polygon 429s or per-ticker failures — failed symbols show
up in the response body's `failed` array and quietly disappear from the
sidebar.

> **Timeout note:** Netlify's default scheduled-function timeout is shorter
> than the full run. If the manual invoke keeps timing out, rename the file
> to `refresh-data-background.js` (or upgrade the Polygon plan and drop
> `DELAY_MS`) — background functions get 15 minutes.
