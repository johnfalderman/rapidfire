import { getRapidfireStore, jsonResponse, readConfig } from './_lib.js'

// Read-through endpoint for the user's config blob (tracked tickers,
// watchlist, preferences). Seeds with the S&P 100 on first call so the user
// has a useful universe before they've added anything.
export default async () => {
  try {
    const store = getRapidfireStore()
    const config = await readConfig(store)
    return jsonResponse(200, { status: 'ok', config })
  } catch (err) {
    return jsonResponse(500, {
      status: 'error',
      message: err?.message || String(err),
    })
  }
}
