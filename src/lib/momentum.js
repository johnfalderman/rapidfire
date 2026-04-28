// Per-ticker momentum flags used by the sidebar's filter chips. We compute
// once per data load (cheap) instead of leaning on the pattern detectors,
// which are full-history scanners and overkill for a "does this qualify
// right now?" boolean.
//
// All four flags require an N-day lookback that's only checked at the tail of
// the series, so the work is constant per ticker.

// "Recent" window for crossover detection. Five trading days mirrors what a
// trader would consider a fresh break — anything older has already cooled.
const RECENT = 5

function smaAt(bars, i, n) {
  if (i + 1 < n) return null
  let sum = 0
  for (let k = i - n + 1; k <= i; k++) sum += bars[k].c
  return sum / n
}

// Today's close is above SMA(50) and was BELOW SMA(50) at any point in the
// last RECENT bars. Catches a fresh upside cross without permanently flagging
// every stock that's been in an uptrend for months.
export function aboveSMA50Cross(bars) {
  if (!bars || bars.length < 50) return false
  const last = bars.length - 1
  const sToday = smaAt(bars, last, 50)
  if (sToday == null || bars[last].c <= sToday) return false
  const start = Math.max(0, last - RECENT)
  for (let i = last - 1; i >= start; i--) {
    const s = smaAt(bars, i, 50)
    if (s != null && bars[i].c <= s) return true
  }
  return false
}

// Mirror of aboveSMA50Cross — today below SMA(50), was above at some point in
// the last RECENT bars.
export function belowSMA50Cross(bars) {
  if (!bars || bars.length < 50) return false
  const last = bars.length - 1
  const sToday = smaAt(bars, last, 50)
  if (sToday == null || bars[last].c >= sToday) return false
  const start = Math.max(0, last - RECENT)
  for (let i = last - 1; i >= start; i--) {
    const s = smaAt(bars, i, 50)
    if (s != null && bars[i].c >= s) return true
  }
  return false
}

// New 52-week high in the last RECENT days. We use bar high (not close) so a
// stock that printed a fresh high intraday but closed off the top still
// qualifies — feels closer to how traders actually read it.
export function isNew52WeekHigh(bars) {
  if (!bars || bars.length < 252) return false
  const last = bars.length - 1
  let maxHigh = -Infinity
  for (let i = last - 251; i <= last; i++) {
    if (bars[i].h > maxHigh) maxHigh = bars[i].h
  }
  const start = Math.max(0, last - RECENT + 1)
  for (let i = start; i <= last; i++) {
    if (bars[i].h >= maxHigh) return true
  }
  return false
}

export function isNew52WeekLow(bars) {
  if (!bars || bars.length < 252) return false
  const last = bars.length - 1
  let minLow = Infinity
  for (let i = last - 251; i <= last; i++) {
    if (bars[i].l < minLow) minLow = bars[i].l
  }
  const start = Math.max(0, last - RECENT + 1)
  for (let i = start; i <= last; i++) {
    if (bars[i].l <= minLow) return true
  }
  return false
}

// Single pass that returns all four flags. Used by App to build a metrics
// map shared with the sidebar — saves four loops per ticker.
export function momentumFlags(bars) {
  return {
    above50: aboveSMA50Cross(bars),
    below50: belowSMA50Cross(bars),
    high52: isNew52WeekHigh(bars),
    low52: isNew52WeekLow(bars),
  }
}

export const MOMENTUM_FILTERS = [
  { key: 'above50', label: '↑ 50d', title: 'Crossed above 50-day SMA in last 5 days' },
  { key: 'below50', label: '↓ 50d', title: 'Crossed below 50-day SMA in last 5 days' },
  { key: 'high52', label: '52w hi', title: 'New 52-week high within last 5 days' },
  { key: 'low52', label: '52w lo', title: 'New 52-week low within last 5 days' },
]
