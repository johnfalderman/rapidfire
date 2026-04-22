import { forwardRef, useEffect, useMemo, useRef } from 'react'
import { sixMonthChangePct } from '../lib/series.js'

// Sidebar owns search, sector filter, and watchlist toggle. Parent owns the
// state so the same filters can be reused by the mobile top-bar.
const TickerSidebar = forwardRef(function TickerSidebar(
  {
    symbols,
    data,
    meta,
    selected,
    onSelect,
    search,
    onSearchChange,
    sector,
    onSectorChange,
    sectors,
    watchlist,
    onToggleStar,
    watchlistOnly,
    onWatchlistOnlyChange,
    loading,
  },
  searchRef,
) {
  const listRef = useRef(null)
  const itemRefs = useRef({})

  // Compute % changes once per data/symbols update — cheap but enough rows
  // that it's worth memoizing.
  const rows = useMemo(
    () =>
      symbols.map((sym) => ({
        symbol: sym,
        name: meta?.[sym]?.name ?? '',
        sector: meta?.[sym]?.sector ?? '',
        pct: sixMonthChangePct(data?.[sym]?.bars ?? []),
      })),
    [symbols, data, meta],
  )

  const q = (search || '').trim().toLowerCase()
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (sector && sector !== 'All' && r.sector !== sector) return false
      if (watchlistOnly && !watchlist?.has(r.symbol)) return false
      if (!q) return true
      return (
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
      )
    })
  }, [rows, q, sector, watchlistOnly, watchlist])

  // Auto-scroll the selected row into view (center-ish), e.g. on J/K nav.
  useEffect(() => {
    const el = itemRefs.current[selected]
    if (el && listRef.current) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selected])

  return (
    <aside className="w-[220px] shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
        <h2 className="text-[11px] tracking-[0.15em] uppercase text-zinc-500 font-medium">
          S&amp;P 100
        </h2>
        <input
          ref={searchRef}
          type="text"
          value={search || ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder="Search…"
          aria-label="Search tickers"
          className={[
            'w-full bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5',
            'text-xs text-zinc-100 placeholder:text-zinc-500',
            'focus:outline-none focus:border-zinc-600',
          ].join(' ')}
        />
        <select
          value={sector || 'All'}
          onChange={(e) => onSectorChange?.(e.target.value)}
          aria-label="Filter by sector"
          className={[
            'w-full bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5',
            'text-xs text-zinc-200 focus:outline-none focus:border-zinc-600',
          ].join(' ')}
        >
          <option value="All">All sectors</option>
          {sectors?.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={!!watchlistOnly}
            onChange={(e) => onWatchlistOnlyChange?.(e.target.checked)}
            className="accent-yellow-400"
          />
          Watchlist only
          {watchlist && watchlist.size > 0 && (
            <span className="ml-auto text-zinc-500">{watchlist.size}</span>
          )}
        </label>
      </div>

      <div
        ref={listRef}
        className="sidebar-scroll flex-1 overflow-y-auto py-1"
      >
        {loading ? (
          <SidebarSkeleton />
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-xs text-zinc-500 italic">
            {watchlistOnly
              ? 'No starred tickers yet. Click the star in the chart header.'
              : 'No matches.'}
          </p>
        ) : (
          filtered.map(({ symbol, pct }) => {
            const active = symbol === selected
            const up = pct >= 0
            const starred = watchlist?.has(symbol)
            return (
              <div
                key={symbol}
                ref={(el) => (itemRefs.current[symbol] = el)}
                className={[
                  'w-full flex items-center',
                  'border-l-2 transition-colors',
                  active
                    ? 'border-zinc-100 bg-zinc-900'
                    : 'border-transparent hover:bg-zinc-900/60',
                ].join(' ')}
              >
                <button
                  onClick={() => onSelect?.(symbol)}
                  className={[
                    'flex-1 min-w-0 text-left pl-4 pr-2 py-1.5 flex items-center justify-between gap-2',
                    'text-sm',
                    active ? 'text-zinc-50' : 'text-zinc-300',
                  ].join(' ')}
                >
                  <span className="font-semibold tracking-tight truncate">
                    {symbol}
                  </span>
                  <span
                    className={[
                      'num text-xs shrink-0',
                      up ? 'text-green-500' : 'text-red-500',
                    ].join(' ')}
                  >
                    {up ? '+' : ''}
                    {pct.toFixed(1)}%
                  </span>
                </button>
                <button
                  onClick={() => onToggleStar?.(symbol)}
                  aria-label={
                    starred
                      ? `Remove ${symbol} from watchlist`
                      : `Add ${symbol} to watchlist`
                  }
                  className={[
                    'w-7 h-7 mr-1 rounded flex items-center justify-center',
                    'text-sm leading-none',
                    starred
                      ? 'text-yellow-400 hover:text-yellow-300'
                      : 'text-zinc-700 hover:text-zinc-400',
                  ].join(' ')}
                >
                  {starred ? '★' : '☆'}
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
})

export default TickerSidebar

function SidebarSkeleton() {
  // 14 shimmering rows — roughly fills the viewport, and the repeating
  // pattern reads as "loading" without needing an icon.
  const rows = Array.from({ length: 14 })
  return (
    <div className="py-1">
      {rows.map((_, i) => (
        <div
          key={i}
          className="px-4 py-1.5 flex items-center justify-between"
        >
          <div className="h-3 w-10 rounded bg-zinc-800 shimmer" />
          <div className="h-3 w-8 rounded bg-zinc-800/80 shimmer" />
        </div>
      ))}
    </div>
  )
}
