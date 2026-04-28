import { getRapidfireStore, jsonResponse, readConfig, writeConfig } from './_lib.js'

// Partial-merge update for watchlist and preferences. trackedTickers is
// managed exclusively by add-ticker / remove-ticker so accidental client
// payloads can't drop the universe.
export default async (req) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return jsonResponse(405, { status: 'error', message: 'Method not allowed' })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { status: 'error', message: 'Invalid JSON' })
  }

  try {
    const store = getRapidfireStore()
    const current = await readConfig(store)
    const next = {
      ...current,
      // Whitelist the editable keys so a client bug can't widen the schema.
      ...(Array.isArray(body.watchlist) ? { watchlist: body.watchlist } : {}),
      ...(body.preferences && typeof body.preferences === 'object'
        ? { preferences: { ...current.preferences, ...body.preferences } }
        : {}),
    }
    const stamped = await writeConfig(store, next)
    return jsonResponse(200, { status: 'ok', config: stamped })
  } catch (err) {
    return jsonResponse(500, {
      status: 'error',
      message: err?.message || String(err),
    })
  }
}
