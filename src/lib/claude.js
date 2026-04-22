// Client-side wrapper around the claude-query Netlify function.
// Two-path design as of Task 4:
//   - Free-form path: ship the 6-month bar slice for open-ended
//     questions Claude has to interpret from raw OHLC.
//   - Pattern path: when routeQuery recognises a well-known pattern
//     keyword ("hammer", "golden cross", "52-week high", …) we run
//     the detector locally over the full bar series and send Claude
//     just the matches. Saves tokens and is noticeably faster.
// The API key still lives exclusively on the server function.

import { routeQuery } from './queryRouter.js'
import { detectors } from './patterns.js'

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
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // Decide which path we're on before touching the network so errors
  // from detectors surface immediately rather than after a round-trip.
  const patternName = routeQuery(query)
  const body = buildRequestBody({
    query,
    ticker,
    name,
    sector,
    bars,
    fullBars,
    summaries,
    patternName,
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
  if (!patternName) {
    return { ...base, bars }
  }

  // Pattern path — detect locally on the full series (golden cross
  // and 52-week rules need >6 months) and ship only the matches.
  const detector = detectors[patternName]
  const series = Array.isArray(fullBars) && fullBars.length ? fullBars : bars
  const allMatches = detector ? detector(series) : []

  // Most recent first so the server can truncate without losing signal.
  const recent = [...allMatches]
    .sort((a, b) => b.index - a.index)
    .slice(0, MAX_MATCHES_IN_PAYLOAD)

  const lastBar = series?.length ? series[series.length - 1] : null

  return {
    ...base,
    patternName,
    patternMatches: recent,
    matchCount: allMatches.length,
    lastBar,
  }
}
