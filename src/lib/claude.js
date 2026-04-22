// Client-side wrapper around the claude-query Netlify function.
// Kept thin on purpose — the function does the real work so the API key
// never ships in the bundle.

const ENDPOINT = '/.netlify/functions/claude-query'
// Sonnet normally answers in ~2-4s for this prompt size; give it generous
// headroom so slow networks don't surface as "ask Claude" errors.
const TIMEOUT_MS = 20000

export async function askClaude({ query, ticker, name, sector, bars, summaries }) {
  // AbortController gives us a real cancel rather than leaving the request
  // dangling in the tab when we time out.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        ticker,
        tickerName: name,
        sector,
        bars,
        summaries,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Claude took too long to respond. Try again?')
    }
    throw new Error(`Network error: ${err?.message || 'unknown'}`)
  } finally {
    clearTimeout(timer)
  }

  let body
  try {
    body = await res.json()
  } catch {
    throw new Error(`Claude returned an unreadable response (HTTP ${res.status})`)
  }

  if (!res.ok) {
    throw new Error(body?.error || `Claude request failed (HTTP ${res.status})`)
  }

  if (!body?.text) {
    throw new Error('Claude returned an empty answer.')
  }

  return body.text
}
