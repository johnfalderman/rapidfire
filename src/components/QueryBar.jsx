import { forwardRef, useState } from 'react'

// Always-visible input at the bottom of the right column. Parent owns the
// request lifecycle; we just collect text and hand it up on Enter.
const QueryBar = forwardRef(function QueryBar(
  { onSubmit, loading, disabled },
  ref,
) {
  const [value, setValue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const q = value.trim()
    if (!q || loading || disabled) return
    onSubmit(q)
    // Keep the text so the user can tweak and resubmit; parent clears if
    // they want a fresh slate.
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-zinc-800 bg-zinc-900 px-8 py-3 flex items-center gap-3"
    >
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask Claude about this chart or the whole S&P 100..."
        disabled={disabled || loading}
        className={[
          'flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2',
          'text-sm text-zinc-100 placeholder:text-zinc-500',
          'focus:outline-none focus:border-zinc-600',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        ].join(' ')}
      />
      <button
        type="submit"
        disabled={disabled || loading || !value.trim()}
        className={[
          'px-3 py-2 rounded-md text-sm font-medium border',
          'border-zinc-700 bg-zinc-800 text-zinc-200',
          'hover:bg-zinc-700 hover:border-zinc-600',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        ].join(' ')}
      >
        {loading ? 'Asking…' : 'Ask'}
      </button>
      <span className="hidden md:inline text-[11px] text-zinc-500">
        Press <kbd className="px-1 py-0.5 border border-zinc-700 rounded bg-zinc-800 text-zinc-300">?</kbd> to focus
      </span>
    </form>
  )
})

export default QueryBar
