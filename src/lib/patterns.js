// Candlestick + trend pattern detectors. Each detector accepts the
// compact bar shape ({ t, o, h, l, c, v }) and returns an array of
// { date, index, description, significance } matches.
//
// Detectors run on the caller's FULL bar series — not the 6-month
// chart slice — because 52-week (252 bars) and SMA(200) rules would
// otherwise have nothing to work with. `index` is relative to that
// array so the UI can map matches back to a date on the chart.
//
// Significance is a 0–1 strength score. Textbook examples land near
// 1; softer matches (shorter wicks, modest engulfings) score lower.

// Trend helpers. The spec calls for "3+ consecutive lower lows" — we
// still return the full streak length so the description can read
// "Hammer after 7-day decline" when the decline ran longer.
function lowerLowsStreak(bars, i) {
  let streak = 0
  for (let k = i - 1; k > 0; k--) {
    if (bars[k].l < bars[k - 1].l) streak += 1
    else break
  }
  return streak
}

function higherHighsStreak(bars, i) {
  let streak = 0
  for (let k = i - 1; k > 0; k--) {
    if (bars[k].h > bars[k - 1].h) streak += 1
    else break
  }
  return streak
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function match(bars, i, description, significance) {
  return {
    date: bars[i].t,
    index: i,
    description,
    significance: clamp01(significance),
  }
}

export function detectHammers(bars) {
  if (!Array.isArray(bars) || bars.length < 5) return []
  const out = []
  for (let i = 3; i < bars.length; i++) {
    const b = bars[i]
    const range = b.h - b.l
    if (range <= 0) continue
    const body = Math.abs(b.o - b.c)
    // A zero-body bar is technically a dragonfly doji, not a hammer;
    // requiring body > 0 keeps the two categories clean.
    if (body <= 0) continue
    const bodyLow = Math.min(b.o, b.c)
    const lowerWick = bodyLow - b.l
    // Body in upper third of range
    if (bodyLow < b.l + (range * 2) / 3) continue
    // Lower wick at least 2× the body
    if (lowerWick < 2 * body) continue
    const streak = lowerLowsStreak(bars, i)
    if (streak < 3) continue
    // Ratio of 4× maps to full significance; longer wicks can't exceed 1.
    const significance = lowerWick / body / 4
    out.push(
      match(bars, i, `Hammer after ${streak}-day decline`, significance),
    )
  }
  return out
}

export function detectShootingStars(bars) {
  if (!Array.isArray(bars) || bars.length < 5) return []
  const out = []
  for (let i = 3; i < bars.length; i++) {
    const b = bars[i]
    const range = b.h - b.l
    if (range <= 0) continue
    const body = Math.abs(b.o - b.c)
    if (body <= 0) continue
    const bodyHigh = Math.max(b.o, b.c)
    const upperWick = b.h - bodyHigh
    // Body in lower third of range
    if (bodyHigh > b.l + range / 3) continue
    if (upperWick < 2 * body) continue
    const streak = higherHighsStreak(bars, i)
    if (streak < 3) continue
    const significance = upperWick / body / 4
    out.push(
      match(bars, i, `Shooting star after ${streak}-day rally`, significance),
    )
  }
  return out
}

export function detectBullishEngulfing(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return []
  const out = []
  for (let i = 1; i < bars.length; i++) {
    const prior = bars[i - 1]
    const curr = bars[i]
    // Prior red, current green — body-only engulfing, wicks ignored.
    if (!(prior.c < prior.o)) continue
    if (!(curr.c > curr.o)) continue
    if (curr.o > prior.c) continue
    if (curr.c < prior.o) continue
    const priorBody = Math.abs(prior.o - prior.c) || 1e-9
    const currBody = Math.abs(curr.o - curr.c)
    // 2× the prior body = full-strength engulfing.
    const significance = currBody / priorBody / 2
    out.push(match(bars, i, 'Bullish engulfing', significance))
  }
  return out
}

export function detectBearishEngulfing(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return []
  const out = []
  for (let i = 1; i < bars.length; i++) {
    const prior = bars[i - 1]
    const curr = bars[i]
    if (!(prior.c > prior.o)) continue
    if (!(curr.c < curr.o)) continue
    if (curr.o < prior.c) continue
    if (curr.c > prior.o) continue
    const priorBody = Math.abs(prior.o - prior.c) || 1e-9
    const currBody = Math.abs(curr.o - curr.c)
    const significance = currBody / priorBody / 2
    out.push(match(bars, i, 'Bearish engulfing', significance))
  }
  return out
}

export function detectDojis(bars) {
  if (!Array.isArray(bars) || bars.length < 20) return []
  const out = []
  // Rolling range average over the 19 bars *before* the candidate so
  // the doji itself doesn't influence its own baseline.
  for (let i = 19; i < bars.length; i++) {
    const b = bars[i]
    const range = b.h - b.l
    if (range <= 0) continue
    const bodyRatio = Math.abs(b.o - b.c) / range
    if (bodyRatio >= 0.1) continue
    let sum = 0
    for (let k = i - 19; k < i; k++) sum += bars[k].h - bars[k].l
    const avg = sum / 19
    if (avg <= 0 || range <= avg) continue
    // 2× average range = textbook doji.
    const significance = range / avg - 1
    out.push(match(bars, i, 'Doji (indecision bar)', significance))
  }
  return out
}

// Rolling simple moving average centred on bars[i]. Returns null when
// there aren't enough bars yet so callers don't silently use partial
// windows.
function sma(bars, i, n) {
  if (i + 1 < n) return null
  let sum = 0
  for (let k = i - n + 1; k <= i; k++) sum += bars[k].c
  return sum / n
}

export function detectGoldenCross(bars) {
  if (!Array.isArray(bars) || bars.length < 201) return []
  const out = []
  for (let i = 200; i < bars.length; i++) {
    const fastPrev = sma(bars, i - 1, 50)
    const slowPrev = sma(bars, i - 1, 200)
    const fast = sma(bars, i, 50)
    const slow = sma(bars, i, 200)
    if (fastPrev == null || slowPrev == null) continue
    if (fast == null || slow == null) continue
    if (fastPrev <= slowPrev && fast > slow) {
      out.push(
        match(
          bars,
          i,
          'Golden cross (50-day SMA crossed above 200-day)',
          1,
        ),
      )
    }
  }
  return out
}

export function detectDeathCross(bars) {
  if (!Array.isArray(bars) || bars.length < 201) return []
  const out = []
  for (let i = 200; i < bars.length; i++) {
    const fastPrev = sma(bars, i - 1, 50)
    const slowPrev = sma(bars, i - 1, 200)
    const fast = sma(bars, i, 50)
    const slow = sma(bars, i, 200)
    if (fastPrev == null || slowPrev == null) continue
    if (fast == null || slow == null) continue
    if (fastPrev >= slowPrev && fast < slow) {
      out.push(
        match(
          bars,
          i,
          'Death cross (50-day SMA crossed below 200-day)',
          1,
        ),
      )
    }
  }
  return out
}

export function detect52WeekHigh(bars) {
  if (!Array.isArray(bars) || bars.length < 252) return []
  const out = []
  for (let i = 251; i < bars.length; i++) {
    const c = bars[i].c
    let max = -Infinity
    for (let k = i - 251; k <= i; k++) if (bars[k].c > max) max = bars[k].c
    if (c === max) {
      out.push(match(bars, i, `New 52-week high at $${c.toFixed(2)}`, 1))
    }
  }
  return out
}

export function detect52WeekLow(bars) {
  if (!Array.isArray(bars) || bars.length < 252) return []
  const out = []
  for (let i = 251; i < bars.length; i++) {
    const c = bars[i].c
    let min = Infinity
    for (let k = i - 251; k <= i; k++) if (bars[k].c < min) min = bars[k].c
    if (c === min) {
      out.push(match(bars, i, `New 52-week low at $${c.toFixed(2)}`, 1))
    }
  }
  return out
}

// Registry used by queryRouter so the router doesn't need to import
// each detector by name and callers can dispatch dynamically.
export const detectors = {
  detectHammers,
  detectShootingStars,
  detectBullishEngulfing,
  detectBearishEngulfing,
  detectDojis,
  detectGoldenCross,
  detectDeathCross,
  detect52WeekHigh,
  detect52WeekLow,
}
