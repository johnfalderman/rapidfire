// Shared transforms between the compact `bar` shape from refresh-data and the
// shapes the UI needs (lightweight-charts candles, percent changes, etc.).
// Keeping these pure makes the components dumb renderers.

// ~6 months of US trading days. Using a trading-day slice rather than a
// calendar window keeps the chart length consistent across weekends/holidays.
const SIX_MONTH_DAYS = 126

export function sixMonthBars(bars) {
  if (!bars || bars.length === 0) return []
  return bars.slice(-SIX_MONTH_DAYS)
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

export function sixMonthChangePct(bars) {
  const slice = sixMonthBars(bars)
  if (slice.length < 2) return 0
  const first = slice[0].c
  const last = slice[slice.length - 1].c
  if (!first) return 0
  return ((last - first) / first) * 100
}

export function lastClose(bars) {
  if (!bars || bars.length === 0) return null
  return bars[bars.length - 1].c
}
