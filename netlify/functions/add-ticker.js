import {
  CACHE_KEY,
  aggregateWindow,
  getRapidfireStore,
  jsonResponse,
  normalizeBars,
  readConfig,
  sectorFromSic,
  writeConfig,
} from './_lib.js'

// Adds an arbitrary ticker to the tracked universe:
//   1. Validate symbol via Polygon ticker reference (also gives us name+SIC).
//   2. Fetch ~400 days of bars.
//   3. Append to the cached bars blob so the client sees data immediately.
//   4. Append to user-config.trackedTickers so the nightly refresh keeps it.
//
// On any failure the blob writes are skipped — partial state would be worse
// than a failed add.
export default async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { status: 'error', message: 'Method not allowed' })
  }

  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    return jsonResponse(500, {
      status: 'error',
      message: 'POLYGON_API_KEY not set',
    })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { status: 'error', message: 'Invalid JSON' })
  }

  const raw = (body?.symbol || '').toString().trim().toUpperCase()
  if (!raw || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(raw)) {
    return jsonResponse(400, {
      status: 'error',
      message: 'Provide a valid ticker symbol (e.g. NFLX).',
    })
  }

  try {
    const store = getRapidfireStore()
    const config = await readConfig(store)

    // Idempotent add — if it's already tracked, just return current state.
    const existing = config.trackedTickers.find((t) => t.symbol === raw)
    if (existing) {
      return jsonResponse(200, {
        status: 'ok',
        config,
        ticker: existing,
        already: true,
      })
    }

    // 1. Reference details (name + sector via SIC).
    const refRes = await fetch(
      `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(raw)}?apiKey=${apiKey}`,
    )
    if (!refRes.ok) {
      const txt = await refRes.text().catch(() => '')
      const looks404 = refRes.status === 404 || /not found/i.test(txt)
      return jsonResponse(looks404 ? 404 : 502, {
        status: 'error',
        message: looks404
          ? `Symbol "${raw}" not found on Polygon.`
          : `Polygon reference lookup failed (HTTP ${refRes.status}).`,
      })
    }
    const refJson = await refRes.json()
    const ref = refJson?.results
    if (!ref || !ref.ticker) {
      return jsonResponse(404, {
        status: 'error',
        message: `Symbol "${raw}" not found on Polygon.`,
      })
    }

    const symbol = ref.ticker.toUpperCase()
    const name = ref.name || symbol
    const sector = sectorFromSic(ref.sic_code)

    // 2. Bars window — match the nightly refresh's lookback so the client
    //    sees a comparable shape on day one.
    const { from, to } = aggregateWindow(400)
    const aggUrl =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`
    const aggRes = await fetch(aggUrl)
    if (!aggRes.ok) {
      const txt = await aggRes.text().catch(() => '')
      return jsonResponse(502, {
        status: 'error',
        message: `Polygon aggregates failed (HTTP ${aggRes.status}): ${txt.slice(0, 160)}`,
      })
    }
    const aggJson = await aggRes.json()
    const bars = normalizeBars(aggJson.results)
    if (!bars.length) {
      return jsonResponse(404, {
        status: 'error',
        message: `No price history returned for "${symbol}". It may be too new or delisted.`,
      })
    }

    // 3. Update the cached bars blob in-place. The client refetches /get-data
    //    after a successful add so we don't need to return bars in this body.
    const cache = (await store.get(CACHE_KEY, { type: 'json' })) || {
      updated: new Date().toISOString(),
      tickers: {},
    }
    cache.tickers[symbol] = { name, sector, bars }
    cache.updated = new Date().toISOString()
    await store.setJSON(CACHE_KEY, cache)

    // 4. Update config last so a partial failure earlier never adds a ticker
    //    that doesn't have data backing it.
    const ticker = { symbol, name, sector, source: 'custom' }
    const nextConfig = {
      ...config,
      trackedTickers: [...config.trackedTickers, ticker],
    }
    const stamped = await writeConfig(store, nextConfig)

    return jsonResponse(200, {
      status: 'ok',
      config: stamped,
      ticker,
      bars: bars.length,
    })
  } catch (err) {
    console.error('[add-ticker]', err)
    return jsonResponse(500, {
      status: 'error',
      message: err?.message || String(err),
    })
  }
}
