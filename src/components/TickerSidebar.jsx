import { forwardRef, useEffect, useRef } from 'react'
import { MOMENTUM_FILTERS } from '../lib/momentum.js'

const SORT_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'alpha', label: 'A → Z' },
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
  { value: 'volume', label: 'Volume' },
]

// `symbols` arrives already filtered + sorted by App. The sidebar is purely
// presentational now: it renders rows, exposes the toolbar controls, and
// emits change events upward.
const TickerSidebar = forwardRef(function TickerSidebar(
  {
    symbols,
    metrics,
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
    sort,
    onSortChange,
    momentum,
    onToggleMomentum,
    updated,
    loading,
  },
  searchRef,
) {
  const listRef = useRef(null)
  const itemRefs = useRef({})

  // Auto-scroll the selected row into view (center-ish), e.g. on J/K nav.
  useEffect(() => {
    const el = itemRefs.current[selected]
    if (el && listRef.current) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selected])

  const showVolume = sort === 'volume'

  return (
    <aside className="w-[220px] shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
        <h2 className="text-[11px] tracking-[0.15em] uppercase text-zinc-500 font-medium">
          Tickers
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
        <select
          value={sort || 'default'}
          onChange={(e) => onSortChange?.(e.target.value)}
          aria-label="Sort"
          className={[
            'w-full bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5',
            'text-xs text-zinc-200 focus:outline-none focus:border-zinc-600',
          ].join(' ')}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>

        {/* Momentum chips: multi-select OR. */}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {MOMENTUM_FILTERS.map(({ key, label, title }) => {
            const on = momentum?.has(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleMomentum?.(key)}
                title={title}
                className={[
                  'px-1.5 py-0.5 text-[10px] rounded-md border transition-colors',
                  on
                    ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-200'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
                ].join(' ')}
              >
                {label}
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-2 text-[11px] text-zinc-400 select-none cursor-pointer pt-0.5">
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

      <div ref={listRef} className="sidebar-scroll flex-1 overflow-y-auto py-1">
        {loading ? (
          <SidebarSkeleton />
        ) : symbols.length === 0 ? (
          <p className="px-4 py-6 text-xs text-zinc-500 italic">
            {watchlistOnly
              ? 'No starred tickers yet. Click the star next to a row.'
              : momentum?.size
                ? 'No tickers match the current momentum filters.'
                : 'No matches.'}
          </p>
        ) : (
          symbols.map((symbol) => {
            const m = metrics?.[symbol]
            const pct = m?.pct ?? 0
            const volume = m?.volume ?? 0
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
                  {showVolume ? (
                    <span className="num text-xs shrink-0 text-zinc-400">
                      {fmtVolume(volume)}
                    </span>
                  ) : (
                    <span
                      className={[
                        'num text-xs shrink-0',
                        up ? 'text-green-500' : 'text-red-500',
                      ].join(' ')}
                    >
                      {up ? '+' : ''}
                      {pct.toFixed(1)}%
                    </span>
                  )}
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

      {updated && (
        <div className="px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-500 num">
          Data as of {formatUpdated(updated)}
        </div>
      )}
    </aside>
  )
})

export default TickerSidebar

function fmtVolume(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(n)
}

// Compact ISO → "Apr 27, 2026 · 3:14 AM" style. Falls back to the raw string
// if Date can't parse it so the user always sees *something*.
function formatUpdated(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

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
