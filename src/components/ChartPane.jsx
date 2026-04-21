import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import { getCandles, getTicker, sixMonthChange } from '../lib/mockData.js'

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

export default function ChartPane({ symbol }) {
  const ticker = getTicker(symbol)
  const candles = useMemo(() => getCandles(symbol), [symbol])

  const pct = useMemo(() => sixMonthChange(symbol), [symbol])
  const last = candles[candles.length - 1]

  // Hover OHLC from the crosshair — defaults to last candle when not hovered.
  const [hovered, setHovered] = useState(null)
  const shown = hovered || last

  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  // Create chart once.
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
      rightPriceScale: { borderColor: '#3f3f46' },
      timeScale: {
        borderColor: '#3f3f46',
        rightOffset: 2,
        fixLeftEdge: true,
      },
      crosshair: { mode: CrosshairMode.Magnet },
      autoSize: true,
    })

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', // green-500
      downColor: '#ef4444', // red-500
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    chartRef.current = chart
    seriesRef.current = series

    const handleCrosshair = (param) => {
      if (!param || !param.time || !seriesRef.current) {
        setHovered(null)
        return
      }
      const data = param.seriesData.get(seriesRef.current)
      if (data) setHovered(data)
      else setHovered(null)
    }
    chart.subscribeCrosshairMove(handleCrosshair)

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // Push data whenever symbol (and therefore candles) changes.
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData(candles)
      chartRef.current?.timeScale().fitContent()
    }
    setHovered(null)
  }, [candles])

  const up = pct >= 0

  return (
    <section className="flex-1 min-w-0 flex flex-col h-full">
      {/* Header strip */}
      <header className="px-8 py-6 border-b border-zinc-800 flex items-baseline gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            {ticker?.symbol}
          </h1>
          <span className="text-sm text-zinc-400">{ticker?.name}</span>
        </div>
        <div className="ml-auto flex items-baseline gap-6">
          <span className="num text-2xl font-semibold text-zinc-50">
            ${fmtPrice(last?.close)}
          </span>
          <span
            className={[
              'num text-sm font-medium',
              up ? 'text-green-500' : 'text-red-500',
            ].join(' ')}
          >
            {fmtPct(pct)} <span className="text-zinc-500 font-normal">6M</span>
          </span>
        </div>
      </header>

      {/* Chart fills remaining space */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      {/* Footer: crosshair OHLC + keyboard hints */}
      <footer className="px-8 py-2 border-t border-zinc-800 flex items-center text-xs text-zinc-400">
        <div className="flex items-center gap-4 num">
          <span className="text-zinc-500">{shown?.time ?? '—'}</span>
          <OhlcCell label="O" value={shown?.open} />
          <OhlcCell label="H" value={shown?.high} />
          <OhlcCell label="L" value={shown?.low} />
          <OhlcCell label="C" value={shown?.close} />
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
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

function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 text-[10px] leading-none">
      {children}
    </kbd>
  )
}
