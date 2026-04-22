import Anthropic from '@anthropic-ai/sdk'

// Thin proxy so the Anthropic SDK (and our API key) stay server-side.
// The client POSTs { query, ticker, tickerName, sector, bars } — `bars` is
// already the 6-month compact slice the user sees on the chart.
export default async (req) => {
  const jsonResponse = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  let payload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  const { query, ticker, tickerName, sector, bars, summaries } = payload || {}
  if (!query || !ticker || !Array.isArray(bars)) {
    return jsonResponse(400, {
      error: 'Missing required fields: query, ticker, bars',
    })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, {
      error: 'ANTHROPIC_API_KEY is not configured on the server.',
    })
  }

  const systemPrompt = `You are a technical analysis assistant embedded
in a charting tool. You help a professional investor understand what he's
seeing across the S&P 100. You receive two pieces of context:

1. A FOCUSED TICKER — the one currently on screen — with 6 months of daily
   bars. Bars are JSON objects with keys: t (date YYYY-MM-DD), o (open),
   h (high), l (low), c (close), v (volume).
2. A SUMMARIES array covering all ~100 tickers in the app. Each entry has:
   symbol, name, sector, last (last close), high (6M high), low (6M low),
   vol (daily-return std dev in percentage points, e.g. 1.5 ≈ ±1.5%/day).

Choose the right context for the question:
- Single-ticker questions ("what happened to AAPL last month?") → rely on
  the focused ticker's bars. Mention cross-ticker context only if asked.
- Market-wide questions ("which sectors look weakest?", "which names are
  pinned to their 6M lows?") → reason across the summaries. Name specific
  tickers when useful.
- Mixed ("how does NVDA's volatility compare to its sector?") → use both.

Rules:
- Describe, don't prescribe. No "buy", "sell", or "hold" recommendations.
- No price targets or predictions.
- Be concise — the user is scanning 100 tickers and wants fast reads.
- If you reference dates, use formats like "March 15" not "2026-03-15".
- If the question is unanswerable from the data, say so.
- End with: "Technical observation only, not financial advice."`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Focused ticker: ${ticker} (${tickerName}, ${sector})
Last 6 months of daily OHLC for the focused ticker: ${JSON.stringify(bars)}

All-ticker summaries (symbol, name, sector, last, 6M high, 6M low, vol%):
${JSON.stringify(summaries ?? [])}

Question: ${query}`,
        },
      ],
    })

    // Anthropic returns an array of content blocks; for plain-text answers
    // the first block is a text block. Fall back defensively.
    const first = response.content?.[0]
    const text =
      first && first.type === 'text' ? first.text : JSON.stringify(first)

    return jsonResponse(200, { text })
  } catch (err) {
    return jsonResponse(500, {
      error: err?.message || 'Claude request failed',
    })
  }
}
