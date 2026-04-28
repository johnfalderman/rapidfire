// Shared helpers used across the netlify functions. Kept tiny so each
// function file stays focused on its endpoint shape.

import { getStore } from '@netlify/blobs'
import { tickers as SP100 } from '../../src/data/tickers.js'

export const STORE_NAME = 'rapidfire'
export const CACHE_KEY = 'sp100' // legacy name; the blob holds tracked-ticker bars now
export const CONFIG_KEY = 'user-config'

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

export function getRapidfireStore() {
  return getStore(STORE_NAME)
}

// First-touch seed. We keep S&P 100 as the implicit starting list so the user
// has a useful universe out of the gate; from there they add/remove freely.
export function defaultConfig() {
  return {
    trackedTickers: SP100.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      sector: t.sector,
      source: 'sp100',
    })),
    watchlist: [],
    preferences: {
      sort: 'default',
      timeframe: '6M',
      sector: 'All',
      watchlistOnly: false,
      lastSelected: null,
    },
    updated: new Date().toISOString(),
  }
}

// Read config; if missing, seed and persist so subsequent reads (and the
// nightly refresh job) all see the same starting list.
export async function readConfig(store) {
  const existing = await store.get(CONFIG_KEY, { type: 'json' })
  if (existing && Array.isArray(existing.trackedTickers)) return existing
  const seeded = defaultConfig()
  await store.setJSON(CONFIG_KEY, seeded)
  return seeded
}

export async function writeConfig(store, config) {
  const stamped = { ...config, updated: new Date().toISOString() }
  await store.setJSON(CONFIG_KEY, stamped)
  return stamped
}

// Coarse SIC-code → GICS-ish sector mapping for newly-added tickers. SIC and
// GICS aren't 1:1, but the chunkiest ranges line up well enough that the
// sector filter dropdown stays useful. Anything unmapped falls to "Other".
const SIC_RANGES = [
  { lo: 100, hi: 999, sector: 'Consumer Staples' }, // ag
  { lo: 1000, hi: 1499, sector: 'Energy' },
  { lo: 1500, hi: 1799, sector: 'Industrials' },
  { lo: 2000, hi: 2199, sector: 'Consumer Staples' }, // food
  { lo: 2200, hi: 2399, sector: 'Consumer Discretionary' }, // textiles/apparel
  { lo: 2400, hi: 2599, sector: 'Industrials' }, // wood/furniture
  { lo: 2600, hi: 2699, sector: 'Materials' }, // paper
  { lo: 2700, hi: 2799, sector: 'Communication Services' }, // publishing
  { lo: 2800, hi: 2899, sector: 'Health Care' }, // chemicals + pharma
  { lo: 2900, hi: 2999, sector: 'Energy' }, // petroleum
  { lo: 3000, hi: 3299, sector: 'Materials' }, // rubber/glass/concrete
  { lo: 3300, hi: 3399, sector: 'Materials' }, // primary metal
  { lo: 3400, hi: 3499, sector: 'Industrials' }, // fabricated metal
  { lo: 3500, hi: 3569, sector: 'Industrials' }, // machinery
  { lo: 3570, hi: 3579, sector: 'Information Technology' }, // computer hardware
  { lo: 3580, hi: 3599, sector: 'Industrials' },
  { lo: 3600, hi: 3669, sector: 'Information Technology' }, // electronics
  { lo: 3670, hi: 3679, sector: 'Information Technology' }, // semiconductors
  { lo: 3680, hi: 3699, sector: 'Information Technology' },
  { lo: 3700, hi: 3799, sector: 'Industrials' }, // transport equipment
  { lo: 3800, hi: 3829, sector: 'Health Care' }, // medical instruments
  { lo: 3830, hi: 3899, sector: 'Industrials' },
  { lo: 3900, hi: 3999, sector: 'Consumer Discretionary' },
  { lo: 4000, hi: 4799, sector: 'Industrials' }, // transportation
  { lo: 4800, hi: 4829, sector: 'Communication Services' },
  { lo: 4830, hi: 4899, sector: 'Communication Services' },
  { lo: 4900, hi: 4999, sector: 'Utilities' },
  { lo: 5000, hi: 5199, sector: 'Industrials' }, // wholesale
  { lo: 5200, hi: 5399, sector: 'Consumer Discretionary' },
  { lo: 5400, hi: 5499, sector: 'Consumer Staples' }, // food retail
  { lo: 5500, hi: 5799, sector: 'Consumer Discretionary' },
  { lo: 5800, hi: 5899, sector: 'Consumer Discretionary' }, // restaurants
  { lo: 5900, hi: 5999, sector: 'Consumer Discretionary' },
  { lo: 6000, hi: 6199, sector: 'Financials' }, // banks
  { lo: 6200, hi: 6299, sector: 'Financials' }, // securities
  { lo: 6300, hi: 6499, sector: 'Financials' }, // insurance
  { lo: 6500, hi: 6799, sector: 'Real Estate' },
  { lo: 7000, hi: 7299, sector: 'Consumer Discretionary' }, // hotels/personal services
  { lo: 7300, hi: 7389, sector: 'Industrials' }, // business services
  { lo: 7370, hi: 7379, sector: 'Information Technology' }, // computer services
  { lo: 7800, hi: 7899, sector: 'Communication Services' }, // motion pictures
  { lo: 7900, hi: 7999, sector: 'Communication Services' }, // amusement/recreation
  { lo: 8000, hi: 8099, sector: 'Health Care' }, // health services
  { lo: 8200, hi: 8299, sector: 'Consumer Discretionary' }, // education
  { lo: 8700, hi: 8799, sector: 'Industrials' }, // engineering/management services
]

export function sectorFromSic(sicCode) {
  if (!sicCode) return 'Other'
  const n = parseInt(sicCode, 10)
  if (!Number.isFinite(n)) return 'Other'
  // Walk in order — earlier entries win on overlap (semiconductors before the
  // generic "electronics" bucket, etc.).
  for (const r of SIC_RANGES) {
    if (n >= r.lo && n <= r.hi) return r.sector
  }
  return 'Other'
}

// US trading-day window for Polygon aggregates fetches.
export function aggregateWindow(lookbackDays = 400) {
  const ymd = (d) => d.toISOString().slice(0, 10)
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - lookbackDays)
  return { from: ymd(from), to: ymd(to) }
}

export function normalizeBars(results) {
  const ymd = (d) => d.toISOString().slice(0, 10)
  return (results || []).map((r) => ({
    t: ymd(new Date(r.t)),
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    v: r.v,
  }))
}
