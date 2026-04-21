import { getStore } from '@netlify/blobs'
import { tickers } from '../../src/data/tickers.js'

// Netlify background functions get a 15-minute ceiling. Polygon free tier is
// 5 req/min → 13s/call with headroom → ~40 tickers per batch comfortably
// fits in 15 min (40 * 13s = 520s) and leaves room for slow responses and
// cold-start overhead. Three batches cover all 101 S&P 100 tickers.
const BATCH_SIZE = 40
const DELAY_MS = 13_000
const LOOKBACK_DAYS = 400
const PROGRESS_KEY = 'sp100-progress'
const CACHE_KEY = 'sp100'
// A partial seed older than a day means something went wrong — don't resume,
// start over so we don't accumulate stale half-runs.
const PROGRESS_STALE_MS = 24 * 60 * 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ymd = (d) => d.toISOString().slice(0, 10)

function windowDates() {
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS)
  return { from: ymd(from), to: ymd(to) }
}

// Compact single-letter keys keep the cached JSON small — sp100.json is the
// hot path for the client.
function normalizeBars(results) {
  return (results || []).map((r) => ({
    t: ymd(new Date(r.t)),
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    v: r.v,
  }))
}

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

  const store = getStore('rapidfire')
  const { from, to } = windowDates()

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
  // so all 101 tickers refresh every day even if a single run hiccups.
  schedule: '0 2,3,4 * * *',
}
