import ReactMarkdown from 'react-markdown'

// Sits between the chart and the query bar. Collapsed (null) when there's
// nothing to show so the chart gets all available vertical space.
export default function ResultPanel({ question, answer, error, onDismiss }) {
  if (!question && !answer && !error) return null

  return (
    <section
      className={[
        'relative border-t border-zinc-800 bg-zinc-900',
        // Cap height so a long answer doesn't push the query bar off screen.
        'max-h-[300px] overflow-y-auto',
      ].join(' ')}
    >
      <button
        onClick={onDismiss}
        aria-label="Dismiss answer"
        className={[
          'absolute top-2 right-2 w-6 h-6 rounded-md',
          'flex items-center justify-center',
          'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800',
        ].join(' ')}
      >
        ×
      </button>

      <div className="px-8 py-4 pr-10">
        {question && (
          <p className="text-xs text-zinc-500 mb-2 italic">
            <span className="not-italic text-zinc-600">Q:</span> {question}
          </p>
        )}

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : answer ? (
          // Tight typography — prose-invert alone is too airy for a cramped
          // footer panel. Override a few elements rather than pulling in the
          // full typography plugin.
          <div className="text-sm text-zinc-200 leading-relaxed space-y-2 [&_p]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-zinc-50 [&_code]:text-zinc-100 [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Thinking…</p>
        )}
      </div>
    </section>
  )
}
