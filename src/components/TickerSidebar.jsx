import { useEffect, useMemo, useRef } from 'react'
import { sixMonthChangePct } from '../lib/series.js'

export default function TickerSidebar({ symbols, data, selected, onSelect }) {
  const listRef = useRef(null)
  const itemRefs = useRef({})

  // Compute % changes once per data/symbols update — cheap but enough rows
  // that it's worth memoizing.
  const rows = useMemo(
    () =>
      symbols.map((sym) => ({
        symbol: sym,
        pct: sixMonthChangePct(data[sym]?.bars ?? []),
      })),
    [symbols, data],
  )

  // Auto-scroll the selected row into view (center-ish), e.g. on J/K nav.
  useEffect(() => {
    const el = itemRefs.current[selected]
    if (el && listRef.current) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selected])

  return (
    <aside className="w-[200px] shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="text-[11px] tracking-[0.15em] uppercase text-zinc-500 font-medium">
          S&amp;P 100
        </h2>
      </div>
      <div
        ref={listRef}
        className="sidebar-scroll flex-1 overflow-y-auto py-1"
      >
        {rows.map(({ symbol, pct }) => {
          const active = symbol === selected
          const up = pct >= 0
          return (
            <button
              key={symbol}
              ref={(el) => (itemRefs.current[symbol] = el)}
              onClick={() => onSelect(symbol)}
              className={[
                'w-full text-left px-4 py-1.5 flex items-center justify-between',
                'text-sm transition-colors',
                'border-l-2',
                active
                  ? 'border-zinc-100 bg-zinc-900 text-zinc-50'
                  : 'border-transparent hover:bg-zinc-900/60 text-zinc-300',
              ].join(' ')}
            >
              <span className="font-semibold tracking-tight">{symbol}</span>
              <span
                className={[
                  'num text-xs',
                  up ? 'text-green-500' : 'text-red-500',
                ].join(' ')}
              >
                {up ? '+' : ''}
                {pct.toFixed(1)}%
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
