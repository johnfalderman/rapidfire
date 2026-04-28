You're picking up an existing project at `/Users/johnalderman/Projects/rapidfire`. Phases 1–4 are done and pushed to `origin/main`. Latest commit: `0348010 Task 5 complete: pattern match chart markers` (an earlier follow-up that bundled chart markers onto Phase 4 — the "Phase 5" below is separate). Start by requesting access to that folder, then `ls` it to orient yourself.

## Current state

- Vite + React + Tailwind + lightweight-charts (4.2.x), JavaScript only.
- `src/`
    - `App.jsx` — fetches `/.netlify/functions/get-data` once on load, holds the ticker map in `state.data`, owns the selected ticker and the Claude query lifecycle (question / answer / error / loading / patternName / matches). Keyboard: `←/→/J/K` to navigate tickers, `?` to focus the query bar, `Esc` to dismiss the answer and clear pattern markers. Switching tickers clears any stale answer + markers via a request-id guard. Runs `detectForQuery(question, ticker.bars)` locally before the Claude round-trip so markers paint instantly.
    - `main.jsx`
    - `index.css` — Tailwind + `.num` helper class
    - `components/`
        - `TickerSidebar.jsx` — reads `state.data`, shows 6M %. No filtering yet.
        - `ChartPane.jsx` — header + lightweight-charts candlestick + crosshair OHLC footer. Accepts `{ symbol, ticker, markers }`. Markers are filtered to visible candle times and sorted ascending before `series.setMarkers(...)`. No volume pane yet. No timeframe control yet.
        - `QueryBar.jsx` — always-visible input at the bottom of the right column. `forwardRef` for the `?` shortcut. Placeholder: "Ask Claude about this chart or the whole S&P 100..."
        - `ResultPanel.jsx` — collapses to null when empty, caps at 300px with internal scroll, renders markdown via react-markdown, shows the question above in muted text, `×` dismiss.
    - `data/tickers.js` — `{ symbol, name, sector } × 101` (S&P 100, both GOOG + GOOGL share classes)
    - `lib/`
        - `series.js` — `barsToCandles`, `sixMonthBars` (126 trading days), `sixMonthChangePct`, `lastClose`
        - `summary.js` — `computeSummaries(data, symbols)` → per-ticker `{ symbol, name, sector, last, high, low, vol }`
        - `claude.js` — `askClaude({ query, ticker, name, sector, bars, fullBars, summaries, patternName, patternMatches })`. Two-path: free-form sends `bars` (6M slice), pattern path sends `{ patternName, patternMatches, matchCount, lastBar }`. Detection does NOT run here anymore — callers pass pre-computed matches.
        - `patterns.js` — nine detectors (`detectHammers`, `detectShootingStars`, `detectBullishEngulfing`, `detectBearishEngulfing`, `detectDojis`, `detectGoldenCross`, `detectDeathCross`, `detect52WeekHigh`, `detect52WeekLow`), each `(bars) → [{ date, index, description, significance }]`. Exported as a `detectors` registry. Runs on the FULL bar series (needs 200+ bars for SMA crosses and 252 for 52-week rules).
        - `queryRouter.js` — `routeQuery(query)` returns a detector name or null; `detectForQuery(query, fullBars)` combines routing + dispatch.
        - `patternMarkers.js` — `matchesToMarkers(patternName, matches)` maps detector hits to lightweight-charts marker objects (per-pattern shape/color/position; size scales with significance 0.8–1.6).
        - `mockData.js` — legacy, unused.
- `netlify/functions/`
    - `get-data.js` — returns sp100 blob as `{ status, updated, tickers }`
    - `refresh-data-background.js` — scheduled `0 2,3,4 * * *`, 40 tickers per batch, writes sp100 + sp100-progress to `rapidfire` blob store
    - `claude-query.js` — accepts either free-form (`bars` required) or pattern (`patternName + patternMatches` required) payloads. Uses `claude-sonnet-4-6`, `max_tokens: 500`. System prompt explains both context streams.
- Cached blob shape: `{ updated: ISO, tickers: { AAPL: { name, sector, bars: [...] } } }`
- Bar shape (compact, single-letter keys): `{ t: 'YYYY-MM-DD', o, h, l, c, v }`
- State.data holds ~400 days per ticker. The chart currently slices via `sixMonthBars(ticker.bars)` for rendering.
- Env vars on Netlify: `POLYGON_API_KEY` (set), `ANTHROPIC_API_KEY` (set).
- Dependencies already in `package.json`: `@anthropic-ai/sdk`, `react-markdown`, `@netlify/blobs`, `lightweight-charts`, `react`, `react-dom`. No server-side SDK in client code.

## Working conventions

- DO NOT run `npm install` inside your sandbox. The Linux package-lock breaks `npm run dev` on my Mac (rollup native binary mismatch). If you add a dependency, edit `package.json` only and tell me to run install locally.
- Never touch or recreate the `.git` folder. Commit with message format `"Task N complete: <summary>"`. I'll push to GitHub myself. The sandbox often can't acquire `git`'s `index.lock` / `HEAD.lock` on the bind-mounted `.git` folder — if so, stage what you can and hand off with the exact commands I should run (including `rm -f .git/index.lock .git/HEAD.lock` if needed).
- Keep comment style consistent: short, explain *why* not *what*.
- Parse-check JS/JSX files with `@babel/parser` (already in `node_modules`) as a cheap substitute for `npm run build` when you can't install.
- Do not regress the Phase 4 pattern path: keep `detectForQuery` as the single source of truth; keep markers flowing App → ChartPane; keep `claude.js` free of detection logic.

----- PHASE 5 -----

Continuing the stock-charting app. Phases 1–4 done. This is phase 5 of 5 — polish. These features are independent — build them in order, but each can ship on its own.

## Context

The app has 100 S&P tickers, real data, keyboard scrubbing, a Claude query bar, pattern detectors, and chart markers. Now we add quality-of-life features.

## Features to build (in order)

### 1. Search
Add a search input at the top of the sidebar. Filters the ticker list live as the user types. Match on symbol OR company name, case-insensitive. Keyboard shortcut `/` focuses it. `Esc` clears and refocuses chart.

### 2. Sector filter
Dropdown above the ticker list: "All sectors" plus each GICS sector. Filters the list. Combines with search.

### 3. Timeframe toggle
Segmented control above the chart: 1M / 3M / 6M / 1Y / YTD.
- Clicking a timeframe re-renders the chart with only that window of data
- Up/Down arrow keys cycle timeframes
- Header price change updates to match the selected timeframe
- Default is 6M

Note: the data pipeline already caches 400 days, so 1Y works without a new fetch. You'll probably want to generalize `sixMonthBars` / `sixMonthChangePct` in `src/lib/series.js` into timeframe-parameterized helpers rather than add new siblings.

### 4. Volume bars
Add a volume pane below the main chart (~25% of chart height). Green bars for up days, red for down days. lightweight-charts supports this via `addHistogramSeries()` with a separate price scale.

### 5. Watchlist
Star icon in the header next to the ticker symbol. Clicking it toggles the ticker's starred state. Starred tickers persist in `localStorage` (key: `sp100-watchlist`). Add "Watchlist only" checkbox to the sidebar filter area.

### 6. Mobile-friendly layout
The main use case is desktop, but make sure the app is readable on a phone:
- Below 768px width, sidebar collapses to a top-bar dropdown
- Chart scales to full width
- Query bar stays at bottom
- Keyboard shortcuts become irrelevant — that's fine

### 7. Nicer loading and error states
- Skeleton shimmer in the sidebar while data loads
- Friendly error message if the data fetch fails ("Couldn't load market data. Try refreshing.")
- Friendly error if Claude query fails

## Done when
All 7 features work without breaking anything from earlier phases. Build succeeds. Deploy to Netlify succeeds.

## Do NOT do
- No feature beyond this list
- No refactors that touch phase 1–4 code unless necessary (timeframe generalization in `series.js` is the expected exception)
