import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TickerSidebar from './components/TickerSidebar.jsx'
import ChartPane from './components/ChartPane.jsx'
import QueryBar from './components/QueryBar.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { tickers as TICKERS_META } from './data/tickers.js'
import { sixMonthBars } from './lib/series.js'
import { askClaude } from './lib/claude.js'

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

  // Preserve the canonical ordering from tickers.js — nothing else is sorted
  // and we want reloads to look identical. Skip any ticker that came back
  // empty (bad Polygon response, delisted, etc.) so the UI never exposes a
  // broken row.
  const symbols = useMemo(() => {
    if (!state.data) return []
    return TICKERS_META.map((t) => t.symbol).filter(
      (sym) => state.data[sym]?.bars?.length > 1,
    )
  }, [state.data])

  const [selected, setSelected] = useState(null)

  // Default / recover selection whenever the symbol list changes.
  useEffect(() => {
    if (!symbols.length) return
    if (!selected || !symbols.includes(selected)) {
      setSelected(symbols[0])
    }
  }, [symbols, selected])

  // ---- Claude query state ----
  // `question` is set the moment the user hits Enter; `answer`/`error` land
  // asynchronously. An in-flight request identifier lets us ignore stale
  // responses when the user switches ticker mid-request.
  const [query, setQuery] = useState({
    question: null,
    answer: null,
    error: null,
    loading: false,
  })
  const queryInputRef = useRef(null)
  const reqIdRef = useRef(0)

  const clearQuery = useCallback(() => {
    // Bump the request id so any in-flight response is ignored.
    reqIdRef.current += 1
    setQuery({ question: null, answer: null, error: null, loading: false })
  }, [])

  const submitQuery = useCallback(
    async (question) => {
      if (!selected || !state.data?.[selected]) return
      const ticker = state.data[selected]
      const bars = sixMonthBars(ticker.bars)
      const myId = ++reqIdRef.current

      setQuery({ question, answer: null, error: null, loading: true })

      try {
        const text = await askClaude({
          query: question,
          ticker: selected,
          name: ticker.name,
          sector: ticker.sector,
          bars,
        })
        if (reqIdRef.current !== myId) return // user moved on
        setQuery({ question, answer: text, error: null, loading: false })
      } catch (err) {
        if (reqIdRef.current !== myId) return
        setQuery({
          question,
          answer: null,
          error: err.message || 'Request failed',
          loading: false,
        })
      }
    },
    [selected, state.data],
  )

  // Wrap setSelected so every ticker change clears any stale answer. We use
  // the wrapped setter everywhere the user can change tickers (sidebar clicks
  // and keyboard nav below).
  const selectTicker = useCallback(
    (sym) => {
      setSelected(sym)
      clearQuery()
    },
    [clearQuery],
  )

  const step = useCallback(
    (delta) => {
      setSelected((curr) => {
        if (!symbols.length) return curr
        const i = symbols.indexOf(curr)
        if (i === -1) return symbols[0]
        const next = (i + delta + symbols.length) % symbols.length
        return symbols[next]
      })
      clearQuery()
    },
    [symbols, clearQuery],
  )

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const typing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)

      // Esc always works — even while focused in the input — so the user can
      // dismiss the panel and unfocus in one keystroke.
      if (e.key === 'Escape') {
        e.preventDefault()
        clearQuery()
        if (queryInputRef.current) queryInputRef.current.blur()
        return
      }

      // `?` focuses the query bar. Shift+/ on US layouts; also allow plain
      // `?` for consistency. Skip while typing so we don't steal `?` from
      // the user mid-question.
      if (!typing && e.key === '?') {
        e.preventDefault()
        queryInputRef.current?.focus()
        return
      }

      // Don't hijack nav keys while the user is typing.
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
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, clearQuery])

  if (state.status === 'loading') {
    return <StatusScreen>Loading market data…</StatusScreen>
  }
  if (state.status === 'empty') {
    return <StatusScreen>{state.message ?? 'No data yet.'}</StatusScreen>
  }
  if (state.status === 'error') {
    return (
      <StatusScreen error>Couldn&rsquo;t load data: {state.message}</StatusScreen>
    )
  }
  if (!symbols.length || !selected) {
    return <StatusScreen>No tickers with data.</StatusScreen>
  }

  return (
    <div className="h-full w-full flex bg-zinc-900 text-zinc-100">
      <TickerSidebar
        symbols={symbols}
        data={state.data}
        selected={selected}
        onSelect={selectTicker}
      />
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <ChartPane symbol={selected} ticker={state.data[selected]} />
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
        />
      </div>
    </div>
  )
}

function StatusScreen({ children, error }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-zinc-900 text-zinc-100">
      <p
        className={[
          'text-sm',
          error ? 'text-red-400' : 'text-zinc-400',
        ].join(' ')}
      >
        {children}
      </p>
    </div>
  )
}
