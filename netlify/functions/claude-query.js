import Anthropic from '@anthropic-ai/sdk'

// Thin proxy so the Anthropic SDK (and our API key) stay server-side.
// Two payload shapes are accepted:
//   - Free-form: { query, ticker, tickerName, sector, bars, summaries }
//     (bars = 6-month compact slice)
//   - Pattern:   { query, ticker, tickerName, sector, patternName,
//                  patternMatches, matchCount, lastBar, summaries }
// The pattern path skips shipping raw OHLC entirely — detection runs
// on the client and we only send Claude the hits for interpretation.
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

  const {
    query,
    ticker,
    tickerName,
    sector,
    bars,
    summaries,
    patternName,
    patternMatches,
    matchCount,
    lastBar,
  } = payload || {}

  if (!query || !ticker) {
    return jsonResponse(400, {
      error: 'Missing required fields: query, ticker',
    })
  }

  const isPatternPath = patternName && Array.isArray(patternMatches)
  if (!isPatternPath && !Array.isArray(bars)) {
    return jsonResponse(400, {
      error: 'Missing required field: bars (free-form path)',
    })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, {
      error: 'ANTHROPIC_API_KEY is not configured on the server.',
    })
  }

  const systemPrompt = `You are a technical analysis assistant embedded
in a charting tool. You help a professional investor understand what he's
seeing across the S&P 100. The user's question may arrive one of two ways:

A. FREE-FORM — you get 6 months of daily bars for the focused ticker plus
   an all-ticker summaries array. Bars use keys t, o, h, l, c, v. Summaries
   entries have symbol, name, sector, last, high, low, vol (std dev of
   daily returns in percentage points).

B. PATTERN MATCHES — the client already ran a deterministic detector and
   hands you the hits. You will see: patternName, patternMatches (each
   with date, index, description, significance 0–1), total matchCount
   across the full series, and the most recent bar for price context.
   Trust the matches — do not re-derive them. Interpret them: are they
   clustered, recent, strong (high significance), isolated? What might
   that suggest about the ticker's tape?

Choose context based on the question:
- Single-ticker questions → rely on the focused ticker's data.
- Market-wide questions ("which sectors look weakest?") → reason across
  the summaries. Name specific tickers when useful.
- Mixed → use both.

Rules:
- Describe, don't prescribe. No "buy", "sell", or "hold" recommendations.
- No price targets or predictions.
- Be concise — the user is scanning 100 tickers and wants fast reads.
- If you reference dates, use formats like "March 15" not "2026-03-15".
- If the question is unanswerable from the data, say so.
- End with: "Technical observation only, not financial advice."`

  const userMessage = isPatternPath
    ? buildPatternMessage({
        query,
        ticker,
        tickerName,
        sector,
        patternName,
        patternMatches,
        matchCount,
        lastBar,
        summaries,
      })
    : buildFreeFormMessage({
        query,
        ticker,
        tickerName,
        sector,
        bars,
        summaries,
      })

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
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

function buildFreeFormMessage({
  query,
  ticker,
  tickerName,
  sector,
  bars,
  summaries,
}) {
  return `Focused ticker: ${ticker} (${tickerName}, ${sector})
Last 6 months of daily OHLC for the focused ticker: ${JSON.stringify(bars)}

All-ticker summaries (symbol, name, sector, last, 6M high, 6M low, vol%):
${JSON.stringify(summaries ?? [])}

Question: ${query}`
}

function buildPatternMessage({
  query,
  ticker,
  tickerName,
  sector,
  patternName,
  patternMatches,
  matchCount,
  lastBar,
  summaries,
}) {
  const total = Number.isFinite(matchCount) ? matchCount : patternMatches.length
  const shown = patternMatches.length
  const truncatedNote =
    total > shown
      ? ` (showing ${shown} most recent of ${total} total)`
      : ''

  const matchesBlock = patternMatches.length
    ? JSON.stringify(patternMatches)
    : '[] — no matches found in the available history'

  const lastBarBlock = lastBar
    ? `Most recent bar: ${JSON.stringify(lastBar)}`
    : 'Most recent bar: unavailable'

  return `Focused ticker: ${ticker} (${tickerName}, ${sector})
Pattern detector: ${patternName}${truncatedNote}
Matches (date, index, description, significance 0–1):
${matchesBlock}
${lastBarBlock}

All-ticker summaries (symbol, name, sector, last, 6M high, 6M low, vol%):
${JSON.stringify(summaries ?? [])}

Question: ${query}`
}
