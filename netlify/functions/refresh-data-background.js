import {
  CACHE_KEY,
  aggregateWindow,
  getRapidfireStore,
  normalizeBars,
  readConfig,
} from './_lib.js'

// Netlify background functions get a 15-minute ceiling. Polygon free tier is
// 5 req/min → 13s/call with headroom → ~40 tickers per batch comfortably
// fits in 15 min (40 * 13s = 520s) and leaves room for slow responses and
// cold-start overhead. Three batches cover 100+ tickers; if the user adds
// many custom symbols and pushes past the limit, we'll bump batch count or
// add a fourth scheduled run.
const BATCH_SIZE = 40
const DELAY_MS = 13_000
const PROGRESS_KEY = 'sp100-progress' // legacy key name; stays put for resume continuity
// A partial seed older than a day means something went wrong — don't resume,
// start over so we don't accumulate stale half-runs.
const PROGRESS_STALE_MS = 24 * 60 * 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchTicker(symbol, from, to, apiKey) {
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/1/day/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Polygon ${symbol} HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = await res.json()
  return normalizeBars(json.results)
}

export default async () => {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    console.error('[refresh-data-background] POLYGON_API_KEY not set')
    return new Response('POLYGON_API_KEY not set', { status: 500 })
  }

  const store = getRapidfireStore()
  const { from, to } = aggregateWindow(400)

  // Universe = whatever the user has curated in user-config. readConfig seeds
  // from S&P 100 on first run, so this still works on a fresh deploy.
  const config = await readConfig(store)
  const tickers = config.trackedTickers
  if (!Array.isArray(tickers) || !tickers.length) {
    console.warn('[refresh-data-background] tracked list empty; nothing to do')
    return new Response('Tracked list empty', { status: 200 })
  }

  // Resume-or-restart: progress from a previous run gets picked back up
  // unless it's too old to trust.
  let progress = await store.get(PROGRESS_KEY, { type: 'json' })
  const stale =
    progress?.startedAt &&
    Date.now() - Date.parse(progress.startedAt) > PROGRESS_STALE_MS
  if (!progress || stale) {
    progress = {
      startedAt: new Date().toISOString(),
      cursor: 0,
      tickers: {},
      failed: [],
    }
  }

  const start = progress.cursor
  const end = Math.min(start + BATCH_SIZE, tickers.length)
  console.log(
    `[refresh-data-background] batch ${start}..${end} of ${tickers.length}`,
  )

  for (let i = start; i < end; i++) {
    const t = tickers[i]
    try {
      const bars = await fetchTicker(t.symbol, from, to, apiKey)
      progress.tickers[t.symbol] = {
        name: t.name,
        sector: t.sector,
        bars,
      }
      console.log(
        `[refresh-data-background] ${t.symbol} ok (${bars.length} bars)`,
      )
    } catch (err) {
      // Keep the row with an empty bars array so a single bad ticker doesn't
      // poison the next night's resume logic.
      console.warn(`[refresh-data-background] ${t.symbol}: ${err.message}`)
      progress.tickers[t.symbol] = {
        name: t.name,
        sector: t.sector,
        bars: [],
      }
      progress.failed.push(t.symbol)
    }
    progress.cursor = i + 1
    if (i < end - 1) await sleep(DELAY_MS)
  }

  const done = progress.cursor >= tickers.length

  if (done) {
    // Atomic-ish swap: only write the live cache once the full run finishes,
    // so mid-refresh the client keeps seeing yesterday's complete snapshot
    // rather than a half-filled one.
    await store.setJSON(CACHE_KEY, {
      updated: new Date().toISOString(),
      tickers: progress.tickers,
    })
    await store.delete(PROGRESS_KEY)
    const summary = {
      ok: true,
      done: true,
      count: Object.keys(progress.tickers).length,
      failed: progress.failed,
    }
    console.log(
      `[refresh-data-background] done: ${summary.count} tickers, ${summary.failed.length} failed`,
    )
    return new Response(JSON.stringify(summary), {
      headers: { 'content-type': 'application/json' },
    })
  }

  await store.setJSON(PROGRESS_KEY, progress)
  console.log(
    `[refresh-data-background] batch complete, cursor ${progress.cursor}/${tickers.length}`,
  )
  return new Response(
    JSON.stringify({
      ok: true,
      done: false,
      cursor: progress.cursor,
      total: tickers.length,
      failedSoFar: progress.failed,
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

export const config = {
  // Three tight runs overnight (02:00, 03:00, 04:00 UTC) — one batch each —
  // covers up to 120 tickers per night.
  schedule: '0 2,3,4 * * *',
}
