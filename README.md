# Rapidfire

Personal stock-charting web app. Phase 2: real market data from Polygon.io,
cached in Netlify Blobs via a nightly scheduled background function.

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
- `?` — focus the Claude query bar
- `Esc` — dismiss the answer panel and unfocus the query bar

## Data pipeline

```
Polygon /v2/aggs  →  refresh-data-background (cron, 3 batches)  →  Netlify Blobs  →  get-data  →  client
```

- `netlify/functions/refresh-data-background.js` — scheduled background
  function. Each invocation processes a batch of 40 S&P 100 tickers (400
  calendar days of daily bars each), with a 13-second sleep between Polygon
  calls to respect the free-tier 5-req/min limit. Progress is checkpointed
  to Blobs under `sp100-progress` so the next run resumes where the prior
  one stopped. Once all 101 tickers are fetched, the result is published to
  `sp100` and the progress key is cleared.
- `netlify/functions/get-data.js` — thin read-through endpoint. Returns
  `{ status: 'ok' | 'empty' | 'error', ... }`.
- `src/data/tickers.js` — canonical S&P 100 list (symbol + name + sector).

### Environment

Set on Netlify (Site settings → Environment variables):

| Var                 | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `POLYGON_API_KEY`   | Polygon.io API key used by `refresh-data-background`   |
| `ANTHROPIC_API_KEY` | Anthropic API key used by `claude-query` (phase 3)     |

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

The nightly cron runs `refresh-data-background` three times in a row
(02:00, 03:00, 04:00 UTC) — each invocation handles one batch, so every
night the whole index refreshes. After the first deploy the cache will be
empty until the first full cycle completes.

To seed immediately, invoke the endpoint three times (wait ~9 min between
each so the previous batch finishes):

```
curl -X POST https://<your-site>.netlify.app/.netlify/functions/refresh-data-background
```

Or use the Netlify CLI:

```
netlify functions:invoke refresh-data-background --no-identity
```

Background functions return `202 Accepted` immediately and continue running
server-side. Watch the Function log in the Netlify UI for per-ticker
progress and a final `batch complete, cursor N/101` line.

When the third batch finishes, logs will say
`done: 101 tickers, 0 failed` and the site starts serving real data.

> **Failed tickers** show up in the response body's `failed` array — they
> render as empty-bar rows in the cache and are filtered out of the
> sidebar. The next night's cron will retry them.
