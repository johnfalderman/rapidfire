import {
  CACHE_KEY,
  getRapidfireStore,
  jsonResponse,
  readConfig,
  writeConfig,
} from './_lib.js'

// Drops a symbol from the tracked-ticker list. We also delete its bars from
// the cached blob to keep payload trim — leaving them around would silently
// inflate /get-data over time as the user churns symbols.
export default async (req) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return jsonResponse(405, { status: 'error', message: 'Method not allowed' })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { status: 'error', message: 'Invalid JSON' })
  }

  const symbol = (body?.symbol || '').toString().trim().toUpperCase()
  if (!symbol) {
    return jsonResponse(400, { status: 'error', message: 'symbol is required' })
  }

  try {
    const store = getRapidfireStore()
    const config = await readConfig(store)

    const before = config.trackedTickers.length
    const trackedTickers = config.trackedTickers.filter(
      (t) => t.symbol !== symbol,
    )
    if (trackedTickers.length === before) {
      // Already gone; treat as success so the UI can resync.
      return jsonResponse(200, { status: 'ok', config, removed: false })
    }

    // Also strip from the watchlist — a starred ticker that doesn't exist in
    // the universe would be a weird limbo state.
    const watchlist = (config.watchlist || []).filter((s) => s !== symbol)

    const stamped = await writeConfig(store, {
      ...config,
      trackedTickers,
      watchlist,
    })

    // Remove cached bars too. Best-effort — a missing key is fine.
    const cache = await store.get(CACHE_KEY, { type: 'json' })
    if (cache?.tickers?.[symbol]) {
      delete cache.tickers[symbol]
      cache.updated = new Date().toISOString()
      await store.setJSON(CACHE_KEY, cache)
    }

    return jsonResponse(200, {
      status: 'ok',
      config: stamped,
      removed: true,
    })
  } catch (err) {
    console.error('[remove-ticker]', err)
    return jsonResponse(500, {
      status: 'error',
      message: err?.message || String(err),
    })
  }
}
