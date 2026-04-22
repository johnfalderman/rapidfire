// Keyword → detector router. When a query obviously asks about a
// single well-known pattern we can skip shipping all 126 bars to
// Claude and send pre-computed matches instead. Free-form prompts
// (where routeQuery returns null) keep going through the full-bars
// path.
//
// Order matters inside each keyword list — the first hit wins, so
// more specific phrases should come before generic ones.
import { detectors } from './patterns.js'

const patternKeywords = {
  detectGoldenCross: ['golden cross'],
  detectDeathCross: ['death cross'],
  detectBullishEngulfing: ['bullish engulfing', 'engulfing bullish'],
  detectBearishEngulfing: ['bearish engulfing', 'engulfing bearish'],
  detectShootingStars: ['shooting star'],
  detect52WeekHigh: ['52-week high', '52 week high', 'new high'],
  detect52WeekLow: ['52-week low', '52 week low', 'new low'],
  detectHammers: ['hammer', 'hammers'],
  detectDojis: ['doji', 'dojis'],
}

export function routeQuery(query) {
  if (!query || typeof query !== 'string') return null
  const lower = query.toLowerCase()
  for (const [fn, keywords] of Object.entries(patternKeywords)) {
    if (keywords.some((k) => lower.includes(k))) return fn
  }
  return null
}

// Combined helper: route + run the detector. Single source of truth
// so App.jsx (for markers) and claude.js (for the prompt payload) don't
// each independently re-derive matches from the same query.
//
// Returns { patternName, matches } when a keyword hits, or null for
// free-form queries. `matches` comes from the detector as-is — caller
// is responsible for any sorting / truncation it needs.
export function detectForQuery(query, fullBars) {
  const patternName = routeQuery(query)
  if (!patternName) return null
  const detector = detectors[patternName]
  if (!detector) return { patternName, matches: [] }
  return { patternName, matches: detector(fullBars || []) }
}

// Exposed so tests (and future debugging UIs) can reuse the same map
// without duplicating the list.
export { patternKeywords }
