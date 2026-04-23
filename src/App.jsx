import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TickerSidebar from './components/TickerSidebar.jsx'
import ChartPane from './components/ChartPane.jsx'
import QueryBar from './components/QueryBar.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { tickers as TICKERS_META } from './data/tickers.js'
import { barsForTimeframe, TIMEFRAMES } from './lib/series.js'
import { askClaude } from './lib/claude.js'
import { computeSummaries } from './lib/summary.js'
import { detectForQuery } from './lib/queryRouter.js'
import { matchesToMarkers } from './lib/patternMarkers.js'

const WATCHLIST_KEY = 'sp100-watchlist'
const DEFAULT_TIMEFRAME = '6M'

// Hydrate synchronously so the first render already has the starred set —
// avoids a flicker where stars briefly look empty. Any localStorage error
// just falls back to an empty set.
function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export default function App() {
  // One fetch on load, held in memory for the rest of the session. The
  // backing data only refreshes nightly so there's no need to re-poll.
  const [state, setState] = useState({
    status: 'loading',
    data: null,
    updated: null,
    message: null,
  })

  useEffect(() => {
    let cancelled = false
    fetch('/.netlify/functions/get-data')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.status === 'ok') {
          setState({
            status: 'ready',
            data: json.tickers,
            updated: json.updated,
            message: null,
          })
        } else if (json.status === 'empty') {
          setState({
            status: 'empty',
            data: null,
            updated: null,
            message: json.message,
          })
        } else {
          setState({
            status: 'error',
            data: null,
            updated: null,
            message: json.message || 'Unknown error',
          })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: 'error',
            data: null,
            updated: null,
            message: err.message,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Canonical sidebar order — preserves tickers.js ordering across reloads,
  // and skips any symbol that came back empty from Polygon.
  const symbols = useMemo(() => {
    if (!state.data) return []
    return TICKERS_META.map((t) => t.symbol).filter(
      (sym) => state.data[sym]?.bars?.length > 1,
    )
  }, [state.data])

  // Quick lookup for sector filter + sidebar rows that need `name`/`sector`
  // independent of the loaded bar data.
  const meta = useMemo(() => {
    const out = {}
    for (const t of TICKERS_META) out[t.symbol] = { name: t.name, sector: t.sector }
    return out
  }, [])

  const sectors = useMemo(() => {
    const set = new Set(TICKERS_META.map((t) => t.sector).filter(Boolean))
    return Array.from(set).sort()
  }, [])

  // Cross-ticker context for Claude — computed once per data load and reused
  // across every query so market-wide questions ("which sectors held up?")
  // have the full list available without bloating the per-request payload.
  const summaries = useMemo(
    () => computeSummaries(state.data, symbols),
    [state.data, symbols],
  )

  // ---- Filters ----
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('All')
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [watchlist, setWatchlist] = useState(loadWatchlist)

  const toggleStar = useCallback((sym) => {
    setWatchlist((prev) => {
      const next = new Set(prev)
      if (next.has(sym)) next.delete(sym)
      else next.add(sym)
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(Array.from(next)))
      } catch {
        // localStorage blocked — keep the in-memory state working anyway.
      }
      return next
    })
  }, [])

  // Same filter logic the sidebar applies internally. Reproduced here so
  // J/K/←/→ keyboard nav walks the filtered list, not the raw symbol set —
  // otherwise the user could "navigate" onto a hidden row.
  const visibleSymbols = useMemo(() => {
    const q = search.trim().toLowerCase()
    return symbols.filter((sym) => {
      const m = meta[sym]
      if (sector && sector !== 'All' && m?.sector !== sector) return false
      if (watchlistOnly && !watchlist.has(sym)) return false
      if (!q) return true
      const name = m?.name?.toLowerCase() || ''
      return sym.toLowerCase().includes(q) || name.includes(q)
    })
  }, [symbols, meta, search, sector, watchlistOnly, watchlist])

  const [selected, setSelected] = useState(null)

  // ---- Timeframe ----
  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME)

  // ---- Claude query state ----
  // Declared BEFORE the selection-recovery effect so `clearQuery` exists
  // when that effect closes over it — otherwise prod builds trip a
  // temporal-dead-zone error on the minified const.
  const [query, setQuery] = useState({
    question: null,
    answer: null,
    error: null,
    loading: false,
    patternName: null,
    matches: [],
  })
  const queryInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const reqIdRef = useRef(0)

  const clearQuery = useCallback(() => {
    reqIdRef.current += 1
    setQuery({
      question: null,
      answer: null,
      error: null,
      loading: false,
      patternName: null,
      matches: [],
    })
  }, [])

  // Default / recover selection whenever the visible list changes. Prefer the
  // current selection if it's still visible; otherwise fall back to the first
  // visible row. If nothing is visible we leave `selected` alone so flipping
  // filters off restores the prior chart.
  useEffect(() => {
    if (!visibleSymbols.length) return
    if (!selected || !visibleSymbols.includes(selected)) {
      setSelected(visibleSymbols[0])
      // A filter-driven switch ought to clear stale markers the same way an
      // explicit click does — marker indices only make sense for their ticker.
      clearQuery()
    }
  }, [visibleSymbols, selected, clearQuery])

  const submitQuery = useCallback(
    async (question) => {
      if (!selected || !state.data?.[selected]) return
      const ticker = state.data[selected]
      // Send the currently-visible window to Claude so its answer aligns
      // with what the user is looking at. Full series still goes separately
      // for detectors that need 200+ bars.
      const bars = barsForTimeframe(ticker.bars, timeframe)
      const fullBars = ticker.bars
      const myId = ++reqIdRef.current

      const detection = detectForQuery(question, fullBars)
      const patternName = detection?.patternName ?? null
      const matches = detection?.matches ?? []

      setQuery({
        question,
        answer: null,
        error: null,
        loading: true,
        patternName,
        matches,
      })

      try {
        const text = await askClaude({
          query: question,
          ticker: selected,
          name: ticker.name,
          sector: ticker.sector,
          bars,
          fullBars,
          summaries,
          patternName,
          patternMatches: patternName ? matches : null,
        })
        if (reqIdRef.current !== myId) return
        setQuery((prev) => ({
          ...prev,
          answer: text,
          error: null,
          loading: false,
        }))
      } catch (err) {
        if (reqIdRef.current !== myId) return
        setQuery((prev) => ({
          ...prev,
          answer: null,
          // Friendly wrapper — the raw message ("Request failed", "Network
          // error: …") lands as the tooltip/context, but the headline reads
          // like a real-product error.
          error:
            err?.message && /claude took too long/i.test(err.message)
              ? err.message
              : `Couldn't reach Claude. ${err?.message || 'Try again in a moment.'}`,
          loading: false,
        }))
      }
    },
    [selected, state.data, summaries, timeframe],
  )

  const markers = useMemo(
    () => matchesToMarkers(query.patternName, query.matches),
    [query.patternName, query.matches],
  )

  const selectTicker = useCallback(
    (sym) => {
      setSelected(sym)
      clearQuery()
    },
    [clearQuery],
  )

  const step = useCallback(
    (delta) => {
      if (!visibleSymbols.length) return
      setSelected((curr) => {
        const i = visibleSymbols.indexOf(curr)
        if (i === -1) return visibleSymbols[0]
        const next = (i + delta + visibleSymbols.length) % visibleSymbols.length
        return visibleSymbols[next]
      })
      clearQuery()
    },
    [visibleSymbols, clearQuery],
  )

  const stepTimeframe = useCallback((delta) => {
    setTimeframe((curr) => {
      const i = TIMEFRAMES.indexOf(curr)
      const base = i === -1 ? TIMEFRAMES.indexOf(DEFAULT_TIMEFRAME) : i
      const next = (base + delta + TIMEFRAMES.length) % TIMEFRAMES.length
      return TIMEFRAMES[next]
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const typing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      const inSearch = typing && t === searchInputRef.current

      if (e.key === 'Escape') {
        e.preventDefault()
        // In the search box, Esc clears the filter and refocuses the chart
        // area (blur → body). Elsewhere it dismisses the query answer.
        if (inSearch) {
          setSearch('')
          searchInputRef.current?.blur()
          return
        }
        clearQuery()
        if (queryInputRef.current) queryInputRef.current.blur()
        return
      }

      // `/` focuses search. Skip while typing so the user can still type a
      // slash in their question.
      if (!typing && e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select?.()
        return
      }

      if (!typing && e.key === '?') {
        e.preventDefault()
        queryInputRef.current?.focus()
        return
      }

      if (typing) return

      switch (e.key) {
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault()
          step(-1)
          break
        case 'ArrowRight':
        case 'k':
        case 'K':
          e.preventDefault()
          step(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          stepTimeframe(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          stepTimeframe(1)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, stepTimeframe, clearQuery])

  // Early-return status screens. Loading still shows the real layout so the
  // skeleton sidebar replaces the list in place, which feels snappier than
  // a centered spinner.
  if (state.status === 'empty') {
    return <StatusScreen>{state.message ?? 'No data yet.'}</StatusScreen>
  }
  if (state.status === 'error') {
    return (
      <StatusScreen error>
        Couldn&rsquo;t load market data. Try refreshing.
        {state.message && (
          <span className="block mt-1 text-[11px] text-zinc-500">
            {state.message}
          </span>
        )}
      </StatusScreen>
    )
  }

  const loading = state.status === 'loading'
  const activeTicker = !loading && selected ? state.data?.[selected] : null

  return (
    <div className="h-full w-full flex flex-col md:flex-row bg-zinc-900 text-zinc-100">
      {/* Mobile top-bar. Hidden on md+ where the full sidebar takes over. */}
      <MobileTopBar
        symbols={symbols}
        visibleSymbols={visibleSymbols}
        meta={meta}
        selected={selected}
        onSelect={selectTicker}
        search={search}
        onSearchChange={setSearch}
        sector={sector}
        onSectorChange={setSector}
        sectors={sectors}
        watchlist={watchlist}
        watchlistOnly={watchlistOnly}
        onWatchlistOnlyChange={setWatchlistOnly}
        loading={loading}
      />

      <div className="hidden md:flex h-full">
        <TickerSidebar
          ref={searchInputRef}
          symbols={symbols}
          data={state.data}
          meta={meta}
          selected={selected}
          onSelect={selectTicker}
          search={search}
          onSearchChange={setSearch}
          sector={sector}
          onSectorChange={setSector}
          sectors={sectors}
          watchlist={watchlist}
          onToggleStar={toggleStar}
          watchlistOnly={watchlistOnly}
          onWatchlistOnlyChange={setWatchlistOnly}
          loading={loading}
        />
      </div>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {loading ? (
          <ChartLoadingShell />
        ) : !selected || !activeTicker ? (
          <StatusScreen>No tickers match your filters.</StatusScreen>
        ) : (
          <ChartPane
            symbol={selected}
            ticker={activeTicker}
            markers={markers}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            starred={watchlist.has(selected)}
            onToggleStar={toggleStar}
          />
        )}
        <ResultPanel
          question={query.question}
          answer={query.answer}
          error={query.error}
          onDismiss={clearQuery}
        />
        <QueryBar
          ref={queryInputRef}
          onSubmit={submitQuery}
          loading={query.loading}
          disabled={loading}
        />
      </div>
    </div>
  )
}

// Mobile-only controls. A simple <select> is a better tap target on a phone
// than a scrolling list, and it inherits the native picker for free.
function MobileTopBar({
  symbols,
  visibleSymbols,
  meta,
  selected,
  onSelect,
  search,
  onSearchChange,
  sector,
  onSectorChange,
  sectors,
  watchlist,
  watchlistOnly,
  onWatchlistOnlyChange,
  loading,
}) {
  const tickerOptions = visibleSymbols.length ? visibleSymbols : symbols
  return (
    <div className="md:hidden border-b border-zinc-800 bg-zinc-950 px-3 py-2 space-y-2">
      <div className="flex gap-2">
        <select
          value={selected || ''}
          onChange={(e) => onSelect(e.target.value)}
          disabled={loading}
          aria-label="Select ticker"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        >
          {loading && <option>Loading…</option>}
          {!loading &&
            tickerOptions.map((sym) => (
              <option key={sym} value={sym}>
                {watchlist?.has(sym) ? '★ ' : ''}
                {sym} — {meta[sym]?.name || sym}
              </option>
            ))}
        </select>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
        />
        <select
          value={sector}
          onChange={(e) => onSectorChange(e.target.value)}
          aria-label="Filter by sector"
          className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          <option value="All">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-zinc-400 select-none">
        <input
          type="checkbox"
          checked={watchlistOnly}
          onChange={(e) => onWatchlistOnlyChange(e.target.checked)}
          className="accent-yellow-400"
        />
        Watchlist only
        {watchlist && watchlist.size > 0 && (
          <span className="ml-auto text-zinc-500">{watchlist.size}</span>
        )}
      </label>
    </div>
  )
}

function ChartLoadingShell() {
  // Mirrors the real chart's structural rhythm (header → toolbar → body)
  // so the layout doesn't jump when real data arrives.
  return (
    <section className="flex-1 min-w-0 flex flex-col h-full">
      <header className="px-4 md:px-8 py-4 md:py-6 border-b border-zinc-800 flex items-baseline gap-6">
        <div className="h-6 w-24 rounded bg-zinc-800 shimmer" />
        <div className="ml-auto h-6 w-32 rounded bg-zinc-800 shimmer" />
      </header>
      <div className="px-4 md:px-8 py-2 border-b border-zinc-800 flex items-center gap-2">
        <div className="h-6 w-10 rounded bg-zinc-800 shimmer" />
        <div className="h-6 w-10 rounded bg-zinc-800 shimmer" />
        <div className="h-6 w-10 rounded bg-zinc-800 shimmer" />
      </div>
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-4 rounded bg-zinc-900/40 shimmer" />
      </div>
    </section>
  )
}

function StatusScreen({ children, error }) {
  return (
    <div className="flex-1 w-full flex items-center justify-center bg-zinc-900 text-zinc-100 p-6">
      <p
        className={[
          'text-sm text-center max-w-md',
          error ? 'text-red-400' : 'text-zinc-400',
        ].join(' ')}
      >
        {children}
      </p>
    </div>
  )
}
