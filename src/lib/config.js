// Thin wrappers around the user-config endpoints. Keeping fetch shapes here
// means components don't need to know URL paths or response envelopes.

const GET = '/.netlify/functions/get-config'
const SET = '/.netlify/functions/set-config'
const ADD = '/.netlify/functions/add-ticker'
const REMOVE = '/.netlify/functions/remove-ticker'

async function asJson(res) {
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`Bad response (HTTP ${res.status})`)
  }
  if (!res.ok || json?.status !== 'ok') {
    throw new Error(json?.message || `Request failed (HTTP ${res.status})`)
  }
  return json
}

export async function fetchConfig() {
  const res = await fetch(GET)
  const json = await asJson(res)
  return json.config
}

// Partial-merge update. Caller passes any of { watchlist, preferences }.
export async function saveConfig(patch) {
  const res = await fetch(SET, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const json = await asJson(res)
  return json.config
}

export async function addTicker(symbol) {
  const res = await fetch(ADD, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol }),
  })
  const json = await asJson(res)
  // { config, ticker, already }
  return json
}

export async function removeTicker(symbol) {
  const res = await fetch(REMOVE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol }),
  })
  const json = await asJson(res)
  return json
}
