import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TickerSidebar from './components/TickerSidebar.jsx'
import ChartPane from './components/ChartPane.jsx'
import QueryBar from './components/QueryBar.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { barsForTimeframe, changePctForTimeframe, TIMEFRAMES } from './lib/series.js'
import { askClaude } from './lib/claude.js'
import { computeSummaries } from './lib/summary.js'
import { detectForQuery } from './lib/queryRouter.js'
import { matchesToMarkers } from './lib/patternMarkers.js'
import { momentumFlags } from './lib/momentum.js'
import {
  fetchConfig,
  saveConfig,
  addTicker as apiAddTicker,
  removeTicker as apiRemoveTicker,
} from './lib/config.js'

const WATCHLIST_KEY = 'sp100-watchlist' // legacy localStorage key — read once for migration
const DEFAULT_TIMEFRAME = '6M'

// Read any pre-server-config localStorage watchlist so existing users don't
// lose their stars when we flip persistence to the server. Once seeded into
// the config blob the local copy is purged.
function loadLegacyWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Sort symbols by the chosen dimension. 'default' preserves whatever order
// the caller passed in (i.e. the canonical tickers.js order). Tickers missing
// metrics fall to the bottom so a half-loaded data state doesn't crash sort.
function sortSymbols(symbols, sort, metrics) {
  if (!sort || sort === 'default') return symbols
  const arr = symbols.slice()
  const get = (sym) => metrics?.[sym]
  const valueOr = (n, fallback) => (Number.isFinite(n) ? n : fallback)
  switch (sort) {
    case 'alpha':
      return arr.sort((a, b) => a.localeCompare(b))
    case 'gainers':
      return arr.sort(
        (a, b) =>
          valueOr(get(b)?.pct, -Infinity) - valueOr(get(a)?.pct, -Infinity),
      )
    case 'losers':
      return arr.sort(
        (a, b) =>
          valueOr(get(a)?.pct, Infinity) - valueOr(get(b)?.pct, Infinity),
      )
    case 'volume':
      return arr.sort(
        (a, b) =>
          valueOr(get(b)?.volume, -Infinity) -
          valueOr(get(a)?.volume, -Infinity),
      )
    default:
      return arr
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
  const [config, setConfig] = useState(null)

  // Refetch helper — used after add/remove ticker so the chart sees fresh
  // bars without a full page reload.
  const refetchData = useCallback(async () => {
    const r = await fetch('/.netlify/functions/get-data')
    const json = await r.json()
    if (json.status === 'ok') {
      setState({
        status: 'ready',
        data: json.tickers,
        updated: json.updated,
        message: null,
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    // Parallel fetch — config + data. Both are required for first paint.
    const dataPromise = fetch('/.netlify/functions/get-data').then((r) => r.json())
    const configPromise = fetchConfig().catch((err) => ({ __err: err }))

    Promise.all([dataPromise, configPromise])
      .then(async ([dataJson, cfg]) => {
        if (cancelled) return

        // Config first — failure is fatal because the universe is unknown.
        if (cfg?.__err) {
          setState({
            status: 'error',
            data: null,
            updated: null,
            message: `Config: ${cfg.__err.message || 'unreachable'}`,
          })
          return
        }

        // One-time migration of the localStorage watchlist into the server
        // config. Only runs if server is empty AND local has entries — once
        // the server "wins" we drop the local copy.
        const legacy = loadLegacyWatchlist()
        let live = cfg
        if ((!cfg.watchlist || cfg.watchlist.length === 0) && legacy.length) {
          try {
            live = await saveConfig({ watchlist: legacy })
          } catch {
            // Server save failed — keep using returned cfg, retry next session.
          }
          try {
            localStorage.removeItem(WATCHLIST_KEY)
          } catch {}
        }
        setConfig(live)

        // Now data.
        if (dataJson.status === 'ok') {
          setState({
            status: 'ready',
            data: dataJson.tickers,
            updated: dataJson.updated,
            message: null,
          })
        } else if (dataJson.status === 'empty') {
          setState({
            status: 'empty',
            data: null,
            updated: null,
            message: dataJson.message,
          })
        } else {
          setState({
            status: 'error',
            data: null,
            updated: null,
            message: dataJson.message || 'Unknown error',
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

  // Tracked universe is whatever the user has curated in config.trackedTickers
  // (server-side, persistent across sessions and devices). Skip rows that
  // don't have bars yet — a freshly-added ticker shows up immediately because
  // add-ticker writes its bars before returning.
  const trackedTickers = config?.trackedTickers ?? []

  const symbols = useMemo(() => {
    if (!state.data) return []
    return trackedTickers
      .map((t) => t.symbol)
      .filter((sym) => state.data[sym]?.bars?.length > 1)
  }, [state.data, trackedTickers])

  // Quick lookup for sector filter + sidebar rows that need `name`/`sector`
  // independent of the loaded bar data.
  const meta = useMemo(() => {
    const out = {}
    for (const t of trackedTickers) {
      out[t.symbol] = { name: t.name, sector: t.sector }
    }
    return out
  }, [trackedTickers])

  const sectors = useMemo(() => {
    const set = new Set(trackedTickers.map((t) => t.sector).filter(Boolean))
    return Array.from(set).sort()
  }, [trackedTickers])

  // Cross-ticker context for Claude — computed once per data load and reused
  // across every query so market-wide questions ("which sectors held up?")
  // have the full list available without bloating the per-request payload.
  const summaries = useMemo(
    () => computeSummaries(state.data, symbols),
    [state.data, symbols],
  )

  // ---- Filters ----
  // Search is intentionally local-only — typing shouldn't pulse the server.
  const [search, setSearch] = useState('')
  // Other filters seed from the server config when it lands. We use a single
  // hydration effect (below) so we don't re-init when the server config
  // updates from our own writes.
  const [sector, setSector] = useState('All')
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [watchlist, setWatchlist] = useState(() => new Set())
  const [sort, setSort] = useState('default')
  // Momentum chip filters held as a Set of keys ('above50', 'below50', 'high52', 'low52').
  // Multi-select with OR semantics — any chip on means "at least one qualifies".
  const [momentum, setMomentum] = useState(() => new Set())

  // Hydrate from server config on first arrival. The `hydratedRef` guard
  // means subsequent saves (which return updated configs) don't blow away
  // user's in-flight UI changes.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!config || hydratedRef.current) return
    hydratedRef.current = true
    setWatchlist(new Set(config.watchlist || []))
    const p = config.preferences || {}
    if (p.sector) setSector(p.sector)
    if (typeof p.watchlistOnly === 'boolean') setWatchlistOnly(p.watchlistOnly)
    if (p.sort) setSort(p.sort)
    if (p.timeframe) setTimeframe(p.timeframe)
    if (p.lastSelected) setSelected(p.lastSelected)
  }, [config])

  const toggleMomentum = useCallback((key) => {
    setMomentum((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Optimistic toggle — UI updates immediately, server save runs in background.
  // A failed save logs but doesn't roll back; the user's intent is what matters
  // and they'll see the corrected state next session.
  const toggleStar = useCallback((sym) => {
    setWatchlist((prev) => {
      const next = new Set(prev)
      if (next.has(sym)) next.delete(sym)
      else next.add(sym)
      saveConfig({ watchlist: Array.from(next) }).catch((err) =>
        console.warn('saveConfig watchlist failed', err),
      )
      return next
    })
  }, [])

  // ---- Timeframe ----
  // Hoisted above visibleSymbols because metrics uses it.
  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME)

  // Per-ticker derived numbers used by both the sidebar and the keyboard nav
  // filter. Recomputed when data or timeframe changes — momentum + volume
  // don't actually depend on timeframe but the cost is trivial (~100 tickers
  // × 252 bars) and keeping one memo simplifies prop wiring.
  const metrics = useMemo(() => {
    const out = {}
    if (!state.data) return out
    for (const sym of symbols) {
      const bars = state.data[sym]?.bars
      if (!bars?.length) continue
      out[sym] = {
        pct: changePctForTimeframe(bars, timeframe),
        volume: bars[bars.length - 1].v ?? 0,
        flags: momentumFlags(bars),
      }
    }
    return out
  }, [state.data, symbols, timeframe])

  // Same filter logic the sidebar applies internally. Reproduced here so
  // J/K/←/→ keyboard nav walks the filtered list, not the raw symbol set —
  // otherwise the user could "navigate" onto a hidden row.
  const visibleSymbols = useMemo(() => {
    const q = search.trim().toLowerCase()
    const momentumActive = momentum.size > 0
    const filtered = symbols.filter((sym) => {
      const m = meta[sym]
      if (sector && sector !== 'All' && m?.sector !== sector) return false
      if (watchlistOnly && !watchlist.has(sym)) return false
      if (momentumActive) {
        const flags = metrics[sym]?.flags
        if (!flags) return false
        let any = false
        for (const k of momentum) {
          if (flags[k]) {
            any = true
            break
          }
        }
        if (!any) return false
      }
      if (!q) return true
      const name = m?.name?.toLowerCase() || ''
      return sym.toLowerCase().includes(q) || name.includes(q)
    })
    return sortSymbols(filtered, sort, metrics)
  }, [
    symbols,
    meta,
    search,
    sector,
    watchlistOnly,
    watchlist,
    momentum,
    metrics,
    sort,
  ])

  const [selected, setSelected] = useState(null)

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

  // Persist preference changes back to the server. Debounced so a fast click
  // through timeframes or sectors doesn't fire a request per click. Skipped
  // until hydration completes to avoid echoing the just-loaded values back.
  useEffect(() => {
    if (!hydratedRef.current) return
    const t = setTimeout(() => {
      saveConfig({
        preferences: {
          sort,
          sector,
          watchlistOnly,
          timeframe,
          lastSelected: selected,
        },
      }).catch((err) => console.warn('saveConfig prefs failed', err))
    }, 800)
    return () => clearTimeout(t)
  }, [sort, sector, watchlistOnly, timeframe, selected])

  // Add-ticker UX state. The sidebar opens an inline input that submits to
  // this handler; we surface its loading + error states back so the input can
  // show feedback without owning the network call.
  const [addState, setAddState] = useState({ loading: false, error: null })
  const addNewTicker = useCallback(
    async (rawSymbol) => {
      const sym = (rawSymbol || '').trim().toUpperCase()
      if (!sym) return
      setAddState({ loading: true, error: null })
      try {
        const json = await apiAddTicker(sym)
        setConfig(json.config)
        // Pull fresh bars so the new ticker has data on its first paint.
        await refetchData()
        setSelected(json.ticker.symbol)
        clearQuery()
        setAddState({ loading: false, error: null })
        return true
      } catch (err) {
        setAddState({
          loading: false,
          error: err?.message || 'Add failed',
        })
        return false
      }
    },
    [refetchData, clearQuery],
  )

  const removeFromList = useCallback(
    async (sym) => {
      try {
        const json = await apiRemoveTicker(sym)
        setConfig(json.config)
        await refetchData()
        // The selection-recovery effect will jump to a still-visible ticker
        // automatically — no need to setSelected here.
      } catch (err) {
        console.warn('removeTicker failed', err)
      }
    },
    [refetchData],
  )

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
        updated={state.updated}
        loading={loading}
      />

      <div className="hidden md:flex h-full">
        <TickerSidebar
          ref={searchInputRef}
          symbols={visibleSymbols}
          metrics={metrics}
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
          sort={sort}
          onSortChange={setSort}
          momentum={momentum}
          onToggleMomentum={toggleMomentum}
          onAddTicker={addNewTicker}
          onRemoveTicker={removeFromList}
          addState={addState}
          updated={state.updated}
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
  updated,
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
      {updated && (
        <p className="text-[10px] text-zinc-500 num">
          Data as of{' '}
          {new Date(updated).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
      )}
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
