import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import {
  barsForTimeframe,
  barsToCandles,
  barsToVolume,
  changePctForTimeframe,
  smaSeries,
  TIMEFRAMES,
} from '../lib/series.js'

// Shared greens/reds — keep candles and volume visually in sync.
const UP = '#22c55e' // green-500
const DOWN = '#ef4444' // red-500
// MA line palette — chosen to read against dark bg without competing with
// red/green candles. Amber for the faster line (50d) keeps the warm/fast vs.
// cool/slow convention many traders are used to.
const MA50 = '#fbbf24' // amber-400
const MA200 = '#38bdf8' // sky-400

// Helpers for formatting numbers across the header / footer.
const fmtPrice = (n) =>
  n == null || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

const fmtPct = (n) =>
  n == null || Number.isNaN(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

const fmtVol = (n) => {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export default function ChartPane({
  symbol,
  ticker,
  markers,
  timeframe,
  onTimeframeChange,
  starred,
  onToggleStar,
}) {
  const tf = timeframe || '6M'
  const candles = useMemo(() => {
    if (!ticker?.bars) return []
    return barsToCandles(barsForTimeframe(ticker.bars, tf))
  }, [ticker, tf])

  const volumes = useMemo(() => {
    if (!ticker?.bars) return []
    return barsToVolume(barsForTimeframe(ticker.bars, tf), UP, DOWN)
  }, [ticker, tf])

  // SMAs computed on the FULL bar series so values are honest, then clipped
  // to the visible timeframe window. Without the clip, lightweight-charts'
  // fitContent stretches the time axis to span the whole MA range — squashing
  // the candles into a sliver on the right when the user picks 1M / 3M.
  const sma50 = useMemo(
    () => clipToWindow(smaSeries(ticker?.bars ?? [], 50), ticker?.bars, tf),
    [ticker, tf],
  )
  const sma200 = useMemo(
    () => clipToWindow(smaSeries(ticker?.bars ?? [], 200), ticker?.bars, tf),
    [ticker, tf],
  )

  const pct = useMemo(
    () => changePctForTimeframe(ticker?.bars ?? [], tf),
    [ticker, tf],
  )
  const last = candles[candles.length - 1]

  // Hover OHLC from the crosshair — defaults to last candle when not hovered.
  const [hovered, setHovered] = useState(null)
  const [hoveredVol, setHoveredVol] = useState(null)
  const shown = hovered || last
  const shownVol =
    hoveredVol != null ? hoveredVol : volumes[volumes.length - 1]?.value

  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const volumeRef = useRef(null)
  const sma50Ref = useRef(null)
  const sma200Ref = useRef(null)

  // Create chart once. Volume histogram lives on its own overlay price scale
  // so the candles keep their full vertical range, with the volume bars
  // compressed into the bottom 25% of the pane.
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: '#18181b' }, // zinc-900
        textColor: '#a1a1aa', // zinc-400
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: '#27272a' }, // zinc-800
        horzLines: { color: '#27272a' },
      },
      rightPriceScale: {
        borderColor: '#3f3f46',
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: '#3f3f46',
        rightOffset: 2,
        fixLeftEdge: true,
      },
      crosshair: { mode: CrosshairMode.Magnet },
      autoSize: true,
    })

    const series = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    })

    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      // Colours come per-bar from barsToVolume so up/down days split.
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
      borderVisible: false,
    })

    // Moving averages. Both lines share the candles' price scale (no overlay)
    // and stay subtle: thin stroke, no last-value badge, no crosshair label —
    // those would all clutter the chart and steal attention from the candles.
    const sma50Line = chart.addLineSeries({
      color: MA50,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const sma200Line = chart.addLineSeries({
      color: MA200,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })

    chartRef.current = chart
    seriesRef.current = series
    volumeRef.current = volume
    sma50Ref.current = sma50Line
    sma200Ref.current = sma200Line

    const handleCrosshair = (param) => {
      if (!param || !param.time) {
        setHovered(null)
        setHoveredVol(null)
        return
      }
      const data = param.seriesData.get(series)
      const vol = param.seriesData.get(volume)
      setHovered(data || null)
      setHoveredVol(vol?.value ?? null)
    }
    chart.subscribeCrosshairMove(handleCrosshair)

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      volumeRef.current = null
      sma50Ref.current = null
      sma200Ref.current = null
    }
  }, [])

  // Push data whenever candles change (symbol OR timeframe).
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData(candles)
    }
    if (volumeRef.current) {
      volumeRef.current.setData(volumes)
    }
    chartRef.current?.timeScale().fitContent()
    setHovered(null)
    setHoveredVol(null)
  }, [candles, volumes])

  // MAs only refresh when the ticker changes — the line is precomputed on
  // the full bar series, and lightweight-charts handles clipping for whatever
  // window is visible.
  useEffect(() => {
    if (sma50Ref.current) sma50Ref.current.setData(sma50)
    if (sma200Ref.current) sma200Ref.current.setData(sma200)
  }, [sma50, sma200])

  // Pattern markers. lightweight-charts wants them sorted ascending
  // by time and matched to existing bar times — anything outside the
  // visible slice is dropped silently (so Phase 4 matches from
  // outside the window just don't render). An empty array clears markers.
  useEffect(() => {
    if (!seriesRef.current) return
    const series = seriesRef.current
    if (!markers || markers.length === 0) {
      series.setMarkers([])
      return
    }
    const visible = new Set(candles.map((c) => c.time))
    const filtered = markers
      .filter((m) => visible.has(m.time))
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    series.setMarkers(filtered)
  }, [markers, candles])

  const up = pct >= 0

  return (
    <section className="flex-1 min-w-0 flex flex-col h-full">
      {/* Header strip — price/perf on the left, ticker on the right so it
          sits over the recent candles where the eye lands first. */}
      <header className="px-4 md:px-8 py-4 md:py-6 border-b border-zinc-800 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-4 md:gap-6">
          <span className="num text-xl md:text-2xl font-semibold text-zinc-50">
            ${fmtPrice(last?.close)}
          </span>
          <span
            className={[
              'num text-sm font-medium',
              up ? 'text-green-500' : 'text-red-500',
            ].join(' ')}
          >
            {fmtPct(pct)}{' '}
            <span className="text-zinc-500 font-normal">{tf}</span>
          </span>
        </div>
        <div className="ml-auto flex items-baseline gap-2">
          <span className="text-sm text-zinc-400 hidden sm:inline mr-2">
            {ticker?.name}
          </span>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-zinc-50">
            {symbol}
          </h1>
          <button
            onClick={() => onToggleStar?.(symbol)}
            aria-label={
              starred ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`
            }
            className={[
              'text-lg leading-none -mb-0.5 transition-colors',
              starred
                ? 'text-yellow-400 hover:text-yellow-300'
                : 'text-zinc-600 hover:text-zinc-300',
            ].join(' ')}
          >
            {starred ? '★' : '☆'}
          </button>
        </div>
      </header>

      {/* Timeframe toggle */}
      <div className="px-4 md:px-8 py-2 border-b border-zinc-800 flex items-center gap-1">
        {TIMEFRAMES.map((t) => {
          const active = t === tf
          return (
            <button
              key={t}
              onClick={() => onTimeframeChange?.(t)}
              className={[
                'px-2.5 py-1 text-xs rounded-md border transition-colors',
                active
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-50'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60',
              ].join(' ')}
            >
              {t}
            </button>
          )
        })}
        <span className="ml-3 hidden sm:flex items-center gap-3 text-[11px] text-zinc-500">
          <MaSwatch color={MA50} label="50d MA" />
          <MaSwatch color={MA200} label="200d MA" />
        </span>
        <span className="ml-auto hidden md:inline text-[11px] text-zinc-500">
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to cycle
        </span>
      </div>

      {/* Chart fills remaining space */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      {/* Footer: crosshair OHLC + keyboard hints */}
      <footer className="px-4 md:px-8 py-2 border-t border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
        <div className="flex items-center gap-4 num flex-wrap">
          <span className="text-zinc-500">{shown?.time ?? '—'}</span>
          <OhlcCell label="O" value={shown?.open} />
          <OhlcCell label="H" value={shown?.high} />
          <OhlcCell label="L" value={shown?.low} />
          <OhlcCell label="C" value={shown?.close} />
          <span className="flex items-baseline gap-1">
            <span className="text-zinc-500">V</span>
            <span className="text-zinc-200">{fmtVol(shownVol)}</span>
          </span>
        </div>
        <div className="ml-auto hidden md:flex items-center gap-3 text-[11px] text-zinc-500">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span>or</span>
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
          <span>to navigate</span>
        </div>
      </footer>
    </section>
  )
}

function OhlcCell({ label, value }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200">{fmtPrice(value)}</span>
    </span>
  )
}

// Trim an SMA point list down to the timeframe window. Points use ISO
// 'YYYY-MM-DD' strings so a lexical compare against the slice's first bar
// time is enough — no Date construction needed.
function clipToWindow(points, fullBars, tf) {
  if (!points?.length || !fullBars?.length) return points || []
  const slice = barsForTimeframe(fullBars, tf)
  if (!slice.length) return points
  const startTime = slice[0].t
  return points.filter((p) => p.time >= startTime)
}

function MaSwatch({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block w-3 h-[2px] rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </span>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 text-[10px] leading-none">
      {children}
    </kbd>
  )
}
