import { sixMonthBars } from './series.js'

// Compact per-ticker snapshots we ship to Claude alongside the focused
// ticker's full bars. Keeping this lean (~180 bytes × 100 tickers ≈ 18KB)
// is what lets cross-ticker questions fit in the prompt without bumping
// the focused ticker's detail.
//
// Fields deliberately chosen for cross-ticker reasoning:
// - last / high / low       → position within the 6M range
// - vol                     → daily-return std dev as a stability proxy
// - sector                  → enables sector rollups
export function computeSummaries(data, symbols) {
  if (!data || !symbols?.length) return []

  const out = []
  for (const sym of symbols) {
    const t = data[sym]
    if (!t?.bars?.length || t.bars.length < 2) continue

    const slice = sixMonthBars(t.bars)
    if (slice.length < 2) continue

    const last = slice[slice.length - 1].c
    let high = -Infinity
    let low = Infinity
    for (const b of slice) {
      if (b.h > high) high = b.h
      if (b.l < low) low = b.l
    }

    // Daily % returns → std dev as a volatility proxy. Expressed in
    // percentage points so "1.5" means roughly ±1.5% daily swing.
    const rets = []
    for (let i = 1; i < slice.length; i++) {
      const prev = slice[i - 1].c
      if (prev) rets.push((slice[i].c - prev) / prev)
    }
    const n = rets.length || 1
    const mean = rets.reduce((a, b) => a + b, 0) / n
    const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / n
    const vol = Math.sqrt(variance) * 100

    out.push({
      symbol: sym,
      name: t.name,
      sector: t.sector,
      last: round2(last),
      high: round2(high),
      low: round2(low),
      vol: round2(vol),
    })
  }
  return out
}

function round2(n) {
  if (n == null || !Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}
