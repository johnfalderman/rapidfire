import { getStore } from '@netlify/blobs'

// Thin read-through endpoint. All heavy work happens in refresh-data; this
// just surfaces whatever is in the blob store. The client is built to handle
// `empty` and `error` states explicitly.
export default async () => {
  const jsonResponse = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        // Browsers can keep this for a minute — cache refreshes once a day
        // anyway, so aggressive freshness isn't useful.
        'cache-control': 'public, max-age=60',
      },
    })

  try {
    const store = getStore('rapidfire')
    const data = await store.get('sp100', { type: 'json' })

    if (!data) {
      return jsonResponse(200, {
        status: 'empty',
        message:
          'Cache not yet populated. Trigger refresh-data once to seed it.',
      })
    }

    return jsonResponse(200, {
      status: 'ok',
      updated: data.updated,
      tickers: data.tickers,
    })
  } catch (err) {
    return jsonResponse(500, {
      status: 'error',
      message: err.message || String(err),
    })
  }
}
