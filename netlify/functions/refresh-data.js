import { getStore } from '@netlify/blobs'
import { tickers } from '../../src/data/tickers.js'

// Polygon free tier is 5 requests/min. 13s/call gives us a safety margin
// over the 12s/call minimum — worth it because a 429 ruins the whole run.
const DELAY_MS = 13_000
// 400 calendar days is roughly 280 trading days — plenty of headroom for the
// 6-month chart plus any future longer timeframes.
const LOOKBACK_DAYS = 400

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ymd = (d) => d.toISOString().slice(0, 10)

function windowDates() {
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS)
  return { from: ymd(from), to: ymd(to) }
}

// Polygon returns bars as { t (epoch ms), o, h, l, c, v, ... }. We flatten to
// the compact shape the client consumes and convert the timestamp to a
// YYYY-MM-DD string so lightweight-charts can use it directly.
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
    return new Response('POLYGON_API_KEY not set', { status: 500 })
  }

  const { from, to } = windowDates()
  const out = {}
  const failed = []

  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i]
    try {
      const bars = await fetchTicker(t.symbol, from, to, apiKey)
      out[t.symbol] = { name: t.name, sector: t.sector, bars }
    } catch (err) {
      // Keep the row so the client still sees the ticker metadata, but with
      // an empty bars array — the UI treats empties as "skip" and moves on.
      console.warn(`[refresh-data] ${t.symbol}:`, err.message)
      out[t.symbol] = { name: t.name, sector: t.sector, bars: [] }
      failed.push(t.symbol)
    }
    // No need to sleep after the last call.
    if (i < tickers.length - 1) await sleep(DELAY_MS)
  }

  const payload = {
    updated: new Date().toISOString(),
    tickers: out,
  }

  // Single logical cache object — one write per run keeps things simple and
  // makes the client's single-fetch model trivial.
  const store = getStore('rapidfire')
  await store.setJSON('sp100', payload)

  return new Response(
    JSON.stringify({
      ok: true,
      count: Object.keys(out).length,
      failed,
      updated: payload.updated,
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

export const config = {
  // 02:00 UTC daily — after US market close, before European open.
  schedule: '0 2 * * *',
}
