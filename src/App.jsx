import { useCallback, useEffect, useState } from 'react'
import TickerSidebar from './components/TickerSidebar.jsx'
import ChartPane from './components/ChartPane.jsx'
import { TICKERS } from './lib/mockData.js'

const SYMBOLS = TICKERS.map((t) => t.symbol)

export default function App() {
  const [selected, setSelected] = useState(SYMBOLS[0])

  const step = useCallback((delta) => {
    setSelected((curr) => {
      const i = SYMBOLS.indexOf(curr)
      if (i === -1) return SYMBOLS[0]
      const next = (i + delta + SYMBOLS.length) % SYMBOLS.length
      return SYMBOLS[next]
    })
  }, [])

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

  return (
    <div className="h-full w-full flex bg-zinc-900 text-zinc-100">
      <TickerSidebar selected={selected} onSelect={setSelected} />
      <ChartPane symbol={selected} />
    </div>
  )
}
