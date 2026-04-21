import { useCallback, useEffect, useMemo, useState } from 'react'
import TickerSidebar from './components/TickerSidebar.jsx'
import ChartPane from './components/ChartPane.jsx'
import { tickers as TICKERS_META } from './data/tickers.js'

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

  const step = useCallback(
    (delta) => {
      setSelected((curr) => {
        if (!symbols.length) return curr
        const i = symbols.indexOf(curr)
        if (i === -1) return symbols[0]
        const next = (i + delta + symbols.length) % symbols.length
        return symbols[next]
      })
    },
    [symbols],
  )

  useEffect(() => {
    const onKey = (e) => {
      // Don't hijack keys while the user is typing somewhere.
      const t = e.target
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return
      }

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
  }, [step])

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
        onSelect={setSelected}
      />
      <ChartPane symbol={selected} ticker={state.data[selected]} />
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
