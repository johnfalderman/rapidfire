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

  const { query, ticker, tickerName, sector, bars } = payload || {}
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
in a charting tool. You help a professional investor understand what
he's seeing in daily candlestick data. Bars are JSON objects with keys:
t (date YYYY-MM-DD), o (open), h (high), l (low), c (close), v (volume).
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
          content: `Ticker: ${ticker} (${tickerName}, ${sector})
Last 6 months of daily OHLC: ${JSON.stringify(bars)}
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
