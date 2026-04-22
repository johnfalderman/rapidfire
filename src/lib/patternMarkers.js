// Pattern match → lightweight-charts marker mapping. Kept separate
// from patterns.js so the detectors stay pure math with no UI tie-in,
// and separate from ChartPane so the component stays a renderer.
//
// Each entry picks a shape / position / color that matches investor
// intuition: bullish signals point up from below the bar in green,
// bearish signals point down from above in red, dojis are neutral.
// Size scales with the detector's significance so a textbook hammer
// draws a larger arrow than a borderline one.

const tailwind = {
  green: '#22c55e', // green-500
  red: '#ef4444', // red-500
  amber: '#eab308', // yellow-500 — neutral/indecision
}

const styleByPattern = {
  detectHammers: {
    shape: 'arrowUp',
    position: 'belowBar',
    color: tailwind.green,
    labelShort: 'H',
  },
  detectBullishEngulfing: {
    shape: 'arrowUp',
    position: 'belowBar',
    color: tailwind.green,
    labelShort: 'BE',
  },
  detectGoldenCross: {
    shape: 'circle',
    position: 'aboveBar',
    color: tailwind.green,
    labelShort: 'GC',
  },
  detect52WeekHigh: {
    shape: 'arrowUp',
    position: 'aboveBar',
    color: tailwind.green,
    labelShort: '52H',
  },
  detectShootingStars: {
    shape: 'arrowDown',
    position: 'aboveBar',
    color: tailwind.red,
    labelShort: 'SS',
  },
  detectBearishEngulfing: {
    shape: 'arrowDown',
    position: 'aboveBar',
    color: tailwind.red,
    labelShort: 'Be',
  },
  detectDeathCross: {
    shape: 'circle',
    position: 'belowBar',
    color: tailwind.red,
    labelShort: 'DC',
  },
  detect52WeekLow: {
    shape: 'arrowDown',
    position: 'belowBar',
    color: tailwind.red,
    labelShort: '52L',
  },
  detectDojis: {
    shape: 'circle',
    position: 'aboveBar',
    color: tailwind.amber,
    labelShort: 'D',
  },
}

// Maps the clamped 0–1 significance to a lightweight-charts `size`
// multiplier. 0.8 baseline so even weak matches stay visible; 1.6 top
// end keeps strong matches from swamping the chart.
function sizeFor(significance) {
  const s = Number.isFinite(significance) ? significance : 0
  return 0.8 + 0.8 * Math.max(0, Math.min(1, s))
}

export function matchesToMarkers(patternName, matches) {
  if (!patternName || !Array.isArray(matches) || matches.length === 0) {
    return []
  }
  const style = styleByPattern[patternName]
  if (!style) return []

  return matches.map((m) => ({
    time: m.date,
    position: style.position,
    color: style.color,
    shape: style.shape,
    text: style.labelShort,
    size: sizeFor(m.significance),
  }))
}

// Exposed for tests and in case a future sidebar wants to show the
// same legend colors.
export { styleByPattern }
