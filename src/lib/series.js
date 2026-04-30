// Shared transforms between the compact `bar` shape from refresh-data and the
// shapes the UI needs (lightweight-charts candles, percent changes, etc.).
// Keeping these pure makes the components dumb renderers.

// Approximate US trading-day counts. Using a trading-day slice rather than a
// calendar window keeps chart length consistent across weekends/holidays.
const DAYS_1M = 21
const DAYS_3M = 63
const DAYS_6M = 126
const DAYS_1Y = 252

export const TIMEFRAMES = ['1M', '3M', '6M', '1Y', 'YTD']

// Slice the tail of the bar series that corresponds to `timeframe`. YTD walks
// back from the most recent bar's year rather than the system clock — the data
// may lag by a day or two and we want the slice to always anchor on real bars.
export function barsForTimeframe(bars, timeframe = '6M') {
  if (!bars || bars.length === 0) return []
  switch (timeframe) {
    case '1M':
      return bars.slice(-DAYS_1M)
    case '3M':
      return bars.slice(-DAYS_3M)
    case '6M':
      return bars.slice(-DAYS_6M)
    case '1Y':
      return bars.slice(-DAYS_1Y)
    case 'YTD': {
      const lastYear = bars[bars.length - 1].t?.slice(0, 4)
      if (!lastYear) return bars.slice(-DAYS_6M)
      let i = bars.length - 1
      while (i > 0 && bars[i - 1].t?.slice(0, 4) === lastYear) i--
      return bars.slice(i)
    }
    default:
      return bars.slice(-DAYS_6M)
  }
}

// lightweight-charts candlestick series wants { time, open, high, low, close }.
// Our bars use compact single-letter keys to keep the cached JSON small.
export function barsToCandles(bars) {
  return bars.map((b) => ({
    time: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }))
}

// Rolling simple moving average over close prices. Returns lightweight-charts
// line points ({ time, value }) for the bars where a full window is available
// — the first n-1 bars are skipped so the line only starts where the math is
// honest. We compute on the FULL bar series the caller passes in, so even on
// a 1M chart view the 200d line still has values pulled from history outside
// the visible window.
export function smaSeries(bars, n) {
  if (!Array.isArray(bars) || bars.length < n) return []
  const out = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c
    if (i >= n) sum -= bars[i - n].c
    if (i >= n - 1) out.push({ time: bars[i].t, value: sum / n })
  }
  return out
}

// lightweight-charts histogram series for volume. Colour per bar so up/down
// days read at a glance without a second series.
export function barsToVolume(bars, upColor, downColor) {
  return bars.map((b) => ({
    time: b.t,
    value: b.v,
    color: b.c >= b.o ? upColor : downColor,
  }))
}

export function changePctForTimeframe(bars, timeframe = '6M') {
  const slice = barsForTimeframe(bars, timeframe)
  if (slice.length < 2) return 0
  const first = slice[0].c
  const last = slice[slice.length - 1].c
  if (!first) return 0
  return ((last - first) / first) * 100
}

// Thin wrappers preserved so places that always want 6M (sidebar %, Claude
// free-form payload, summaries) stay tidy and obvious.
export function sixMonthBars(bars) {
  return barsForTimeframe(bars, '6M')
}

export function sixMonthChangePct(bars) {
  return changePctForTimeframe(bars, '6M')
}

export function lastClose(bars) {
  if (!bars || bars.length === 0) return null
  return bars[bars.length - 1].c
}
