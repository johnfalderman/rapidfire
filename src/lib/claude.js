// Client-side wrapper around the claude-query Netlify function.
// Two-path contract (detection happens in the caller now so App.jsx
// can also render markers from the same match list):
//   - Free-form path: ship the 6-month bar slice. Claude interprets
//     raw OHLC.
//   - Pattern path: caller passes patternName + patternMatches from
//     detectForQuery(). We forward only the matches plus the most
//     recent bar for price context — no raw bars needed.
// The API key still lives exclusively on the server function.

const ENDPOINT = '/.netlify/functions/claude-query'
const TIMEOUT_MS = 20000

// Keep the payload compact even when a detector surfaces dozens of
// historical matches — the most recent 20 are plenty for the prompt
// and keep the request well under typical body-size limits.
const MAX_MATCHES_IN_PAYLOAD = 20

export async function askClaude({
  query,
  ticker,
  name,
  sector,
  bars,
  fullBars,
  summaries,
  patternName,
  patternMatches,
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  const body = buildRequestBody({
    query,
    ticker,
    name,
    sector,
    bars,
    fullBars,
    summaries,
    patternName,
    patternMatches,
  })

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Claude took too long to respond. Try again?')
    }
    throw new Error(`Network error: ${err?.message || 'unknown'}`)
  } finally {
    clearTimeout(timer)
  }

  let parsed
  try {
    parsed = await res.json()
  } catch {
    throw new Error(`Claude returned an unreadable response (HTTP ${res.status})`)
  }

  if (!res.ok) {
    throw new Error(parsed?.error || `Claude request failed (HTTP ${res.status})`)
  }

  if (!parsed?.text) {
    throw new Error('Claude returned an empty answer.')
  }

  return parsed.text
}

function buildRequestBody({
  query,
  ticker,
  name,
  sector,
  bars,
  fullBars,
  summaries,
  patternName,
  patternMatches,
}) {
  const base = {
    query,
    ticker,
    tickerName: name,
    sector,
    summaries,
  }

  // Free-form path — unchanged from Task 3. The server still expects
  // `bars` to be the 6-month slice.
  if (!patternName || !Array.isArray(patternMatches)) {
    return { ...base, bars }
  }

  // Pattern path. Detection already ran in the caller; just sort and
  // truncate. Most recent first so a server-side cap still keeps the
  // signal users care about most.
  const recent = [...patternMatches]
    .sort((a, b) => b.index - a.index)
    .slice(0, MAX_MATCHES_IN_PAYLOAD)

  const series = Array.isArray(fullBars) && fullBars.length ? fullBars : bars
  const lastBar = series?.length ? series[series.length - 1] : null

  return {
    ...base,
    patternName,
    patternMatches: recent,
    matchCount: patternMatches.length,
    lastBar,
  }
}
