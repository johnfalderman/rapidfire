// Keyword → detector router. When a query obviously asks about a
// single well-known pattern we can skip shipping all 126 bars to
// Claude and send pre-computed matches instead. Free-form prompts
// (where routeQuery returns null) keep going through the full-bars
// path.
//
// Order matters inside each keyword list — the first hit wins, so
// more specific phrases should come before generic ones.
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

// Exposed so tests (and future debugging UIs) can reuse the same map
// without duplicating the list.
export { patternKeywords }
