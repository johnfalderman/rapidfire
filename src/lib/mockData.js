// fallback for local dev
// Deterministic mock OHLC for Phase 1.
//
// Each ticker gets:
//   - a plausible starting price
//   - a drift (annualized-ish) and volatility that give its chart character
//   - a 6-month daily history produced by a seeded random walk
// Seeding the RNG with the ticker symbol means the data is stable across
// reloads without any persistence layer.

export const TICKERS = [
  { symbol: 'AAPL',  name: 'Apple Inc.',                 price: 225, drift:  0.12, vol: 0.22 },
  { symbol: 'MSFT',  name: 'Microsoft Corp.',            price: 420, drift:  0.14, vol: 0.20 },
  { symbol: 'NVDA',  name: 'NVIDIA Corp.',               price: 118, drift:  0.35, vol: 0.55 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',              price: 170, drift:  0.10, vol: 0.24 },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.',            price: 185, drift:  0.15, vol: 0.28 },
  { symbol: 'META',  name: 'Meta Platforms Inc.',        price: 510, drift:  0.22, vol: 0.34 },
  { symbol: 'TSLA',  name: 'Tesla Inc.',                 price: 240, drift:  0.05, vol: 0.60 },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway',         price: 440, drift:  0.08, vol: 0.14 },
  { symbol: 'JPM',   name: 'JPMorgan Chase & Co.',       price: 215, drift:  0.10, vol: 0.22 },
  { symbol: 'V',     name: 'Visa Inc.',                  price: 275, drift:  0.09, vol: 0.18 },
  { symbol: 'WMT',   name: 'Walmart Inc.',               price:  78, drift:  0.12, vol: 0.18 },
  { symbol: 'XOM',   name: 'Exxon Mobil Corp.',          price: 115, drift:  0.04, vol: 0.28 },
  { symbol: 'MA',    name: 'Mastercard Inc.',            price: 485, drift:  0.10, vol: 0.20 },
  { symbol: 'JNJ',   name: 'Johnson & Johnson',          price: 160, drift:  0.03, vol: 0.12 },
  { symbol: 'LLY',   name: 'Eli Lilly and Co.',          price: 820, drift:  0.30, vol: 0.32 },
  { symbol: 'PG',    name: 'Procter & Gamble Co.',       price: 170, drift:  0.05, vol: 0.14 },
  { symbol: 'HD',    name: 'The Home Depot, Inc.',       price: 390, drift:  0.07, vol: 0.22 },
  { symbol: 'COST',  name: 'Costco Wholesale Corp.',     price: 880, drift:  0.18, vol: 0.20 },
  { symbol: 'ORCL',  name: 'Oracle Corp.',               price: 140, drift:  0.16, vol: 0.26 },
  { symbol: 'AVGO',  name: 'Broadcom Inc.',              price: 165, drift:  0.28, vol: 0.38 },
]

// ---- seeded RNG ------------------------------------------------------------

// String → 32-bit seed (xmur3). Classic trick from PractRand / Mulberry notes.
function xmur3(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

// Mulberry32: tiny, fast, good enough for mock data.
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Box-Muller for normally-distributed shocks.
function gaussian(rand) {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

// ---- OHLC generator --------------------------------------------------------

const TRADING_DAYS = 126 // ~6 months
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function dateNDaysAgo(n, refDate) {
  const d = new Date(refDate.getTime() - n * ONE_DAY_MS)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function isWeekday(d) {
  const day = d.getUTCDay()
  return day !== 0 && day !== 6
}

function toBusinessDate(d) {
  // bump weekend dates forward to Monday
  while (!isWeekday(d)) d = new Date(d.getTime() + ONE_DAY_MS)
  return d
}

function ymd(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Build a sequence of business-day dates that ends *today* and has `n` entries.
function businessDaySeries(n, refDate = new Date()) {
  const out = []
  let cursor = new Date(refDate)
  cursor.setUTCHours(0, 0, 0, 0)
  while (out.length < n) {
    if (isWeekday(cursor)) out.push(new Date(cursor))
    cursor = new Date(cursor.getTime() - ONE_DAY_MS)
  }
  return out.reverse()
}

// Generates [{ time: 'YYYY-MM-DD', open, high, low, close }, ...]
// ending at `currentPrice` so the sidebar's "current price" matches the chart.
export function generateCandles({ symbol, price, drift, vol }, refDate = new Date()) {
  const seedFn = xmur3(symbol)
  const rand = mulberry32(seedFn())

  const days = businessDaySeries(TRADING_DAYS, refDate)
  const n = days.length

  // Work backward from current price using the inverse of the log-return, so
  // the *last* close equals the nominal current price.
  const dt = 1 / 252
  const mu = drift - 0.5 * vol * vol

  // First, simulate forward returns.
  const returns = new Array(n)
  for (let i = 0; i < n; i++) {
    returns[i] = mu * dt + vol * Math.sqrt(dt) * gaussian(rand)
  }

  // Compute closes so that close[n-1] === price.
  const closes = new Array(n)
  closes[n - 1] = price
  for (let i = n - 2; i >= 0; i--) {
    closes[i] = closes[i + 1] / Math.exp(returns[i + 1])
  }

  const candles = new Array(n)
  for (let i = 0; i < n; i++) {
    const prevClose = i === 0 ? closes[0] : closes[i - 1]
    const close = closes[i]

    // Open gaps slightly from prev close.
    const gap = 0.25 * vol * Math.sqrt(dt) * gaussian(rand)
    const open = i === 0 ? close : prevClose * Math.exp(gap)

    // Intraday range: roughly vol * sqrt(dt) of the price, plus noise.
    const range = Math.abs(close) * vol * Math.sqrt(dt) * (0.8 + 0.6 * rand())
    const mid = (open + close) / 2
    const high = Math.max(open, close) + range * (0.4 + 0.6 * rand())
    const low = Math.min(open, close) - range * (0.4 + 0.6 * rand())

    candles[i] = {
      time: ymd(toBusinessDate(days[i])),
      open: round2(open),
      high: round2(Math.max(high, open, close)),
      low: round2(Math.min(low, open, close)),
      close: round2(close),
    }
  }

  return candles
}

function round2(x) {
  return Math.round(x * 100) / 100
}

// Cache so we don't regenerate on every render.
const cache = new Map()

export function getCandles(symbol) {
  if (cache.has(symbol)) return cache.get(symbol)
  const t = TICKERS.find((x) => x.symbol === symbol)
  if (!t) return []
  const candles = generateCandles(t)
  cache.set(symbol, candles)
  return candles
}

// 6-month percent change: first close vs last close.
export function sixMonthChange(symbol) {
  const c = getCandles(symbol)
  if (c.length < 2) return 0
  const first = c[0].close
  const last = c[c.length - 1].close
  return ((last - first) / first) * 100
}

export function currentPrice(symbol) {
  const c = getCandles(symbol)
  return c.length ? c[c.length - 1].close : 0
}

export function getTicker(symbol) {
  return TICKERS.find((t) => t.symbol === symbol)
}
