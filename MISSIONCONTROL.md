# MissionControl — Platform Roadmap & Audit

## Current State (assessed 2026-03-25)

The backend is legitimately production-grade. The frontend has components that are "designed to look like" a trading platform rather than fully wired to one. Estimated ratio: **~65% real data / 35% fake-or-placeholder**, up from ~30% at project start.

The remaining gaps are all **wiring problems, not architecture problems.** The infrastructure exists.

---

## Backend Infrastructure (what exists and works)

- Real multi-provider market data — circuit breakers, fallback chains, stale-while-revalidate caching
- Broker integrations: Alpaca paper/live, Binance spot + futures, Hyperliquid perps
- BacktestEngine — Sharpe/Sortino, max drawdown, slippage, real Binance historical klines
- AutonomousTrader — 60s loop, trailing stops, take-profit, position sizing, guardrails, paper mode
- Multi-AI debate engine wired to SOMA QuadBrain
- SQLite trade log + PerformanceCalculator
- Price alert system — WebSocket real-time delivery, in-memory (needs SQLite persistence)
- LowLatencyEngine — Alpaca + Binance WebSocket streams
- 38 backend service files total

If deployed today it **actually trades** (within guardrails). Most retail dashboards are pure demo. This is not that.

---

## Component Reality Matrix

| Component | Data Source | Status | Notes |
|-----------|-------------|--------|-------|
| GlobalControls | `/api/finance/search` + local state | MIXED | Search real; sentiment calculated locally |
| TradeStream | Parent state (AutonomousTrader decisions) | REAL | Decision log from backend loop |
| StrategyBrain | `/api/autonomous/status` positions | **REAL** | Live allocation %, unrealized P&L per strategy ✓ |
| MainChart | Parent chartData + backend | MIXED | Candles real; ghost projections synthetic |
| RiskPanel | `/api/alpaca/account` 5s poll | **REAL** | Live equity, drawdown, exposure from broker ✓ |
| MarketRadar | `/api/scalping/stats`, `/api/scalping/realtime`, orderbook | MIXED | Real API; synthetic fallback when scalping inactive |
| BacktestPanel | `/api/backtest/run` + Binance historical data | REAL | Full engine wired |
| DebateArena | `/api/debate/start` (SSE) | REAL | Multi-AI backend reasoning |
| LearningDashboard | `/api/performance/summary`, `/api/learning/events`, equity-curve | REAL | Requires session activity to populate |
| DemoTrainingPanel | `/api/autonomous/start`, `/api/scalping/stats` | REAL | Paper trading loop wired |
| ManualWorkstation | `/api/trading/position-size`, `/api/finance/analyze`, `/api/finance/news` | **REAL** | Position sizing + AI analysis + live news feed ✓ |
| AIAnalysisModal | `/api/finance/analyze` | REAL | SOMA brain analysis |
| CommandPanel | `/api/finance/search` + constants | MIXED | Autocomplete real; futures hardcoded |
| AlertsPanel | `/api/alerts` CRUD + WebSocket | REAL | In-memory (no persistence yet) |
| SettingsModal | `/api/exchange/credentials-status` + broker APIs | REAL | Encrypted credential storage |
| CustomMarketView | Market data services + fallback analysis | MIXED | Gemini cancelled → SOMA chat wired in |

---

## Gap vs Billion-Dollar Platforms

| What they have | What we have | Gap size |
|----------------|-------------|----------|
| Real-time mark-to-market P&L every tick | RiskPanel hardcoded $100k, no broker sync | Medium |
| Unified position blotter — all brokers, live unrealized P&L | `brokerPositions` initialized empty, no poll | Medium |
| StrategyBrain shows live strategy state (actual exposure, today's P&L per strategy) | Hardcoded STRATEGY_PRESETS constants, allocation % is theater | Large |
| Live news + intel feed | 5 hardcoded fake headlines from 2024 | Easy |
| Market atmosphere from real sentiment | Gemini cancelled → now wired to SOMA chat | Done |
| Order flow visualization | MarketRadar UI exists; works when scalping engaged | Works |
| MACD, Bollinger Bands, Volume Profile | VWAP + RSI only | Medium |
| Position risk heatmap | Nothing | Large |
| Correlation matrix across positions | Nothing | Large |
| Multi-strategy portfolio backtest | Single strategy only | Large |
| Slippage modeled in backtest | Fills at exact price (optimistic ~0.1-0.3%) | Small |
| Alert persistence across restarts | In-memory only | Small |
| Portfolio-level P&L view (not per-symbol) | Nothing | Large |
| Trade journal with annotated chart replays | Nothing | Medium |
| Risk-of-ruin calculator | Nothing | Medium |
| Options chain / Greeks | Nothing | Very Large |

---

## The Big 3 — COMPLETED ✓

All three shipped. Backend serves `frontend/dist` — restart SOMA to apply.

## The Big 3 (do these first — biggest ROI)

### 1. Wire RiskPanel to the broker in real-time
**Estimated effort:** ~2 hours
**What to do:**
- Poll `/api/alpaca/account` every 5s when live mode is active (not demo)
- Update `riskMetrics.walletBalance` and `riskMetrics.equity` from broker account
- Mark-to-market unrealized P&L: sum all open positions from `/api/alpaca/positions`
- `netExposure` = sum of `(qty × currentPrice)` across open positions
- When demo mode: keep the existing manual-input behavior

**Files:** `MissionControlApp.jsx` (add polling useEffect), possibly `RiskPanel.jsx` (display equity curve sparkline)

**Why it matters:** This is the single most "feels like a real trading platform" change. When the balance moves in real-time with the market, the whole dashboard comes alive.

---

### 2. Replace StrategyBrain fake allocations with live AutonomousTrader data
**Estimated effort:** ~3 hours
**What to do:**
- `GET /api/autonomous/status` already returns open positions, per-strategy stats, decisions ring buffer
- Map AutonomousTrader positions → strategy cards: which strategies have open positions, unrealized P&L per strategy, actual allocation % (position value / total equity)
- `winRate` from TradeLogger `getStatsByStrategy()` — already wired in perf poll, just needs the merge logic fixed
- `confidence` from most recent decision for that strategy (decisions ring buffer has `strategy` field)
- `lastExecution` from most recent decision timestamp

**Files:** `MissionControlApp.jsx` (update the autonomous status useEffect to merge into `activeStrategies`), `StrategyBrain.jsx` (already accepts real data — no change needed)

**Why it matters:** Right now the "Neural Architecture" panel is pure theater. After this fix, it shows which strategies are actually holding positions and their real P&L. That's the core of any real trading platform.

---

### 3. Replace hardcoded intel feed with real financial news
**Estimated effort:** ~2 hours
**What to do:**
- Add `GET /api/finance/news?symbol=:symbol&limit=5` route to `financeRoutes.js`
- Pull from free sources in priority order:
  1. Alpaca News API (free with Alpaca account, `/v1beta1/news?symbols=:symbol`)
  2. RSS scrape from Yahoo Finance/MarketWatch (no auth needed)
  3. Keep current hardcoded items as fallback
- ManualWorkstation polls the endpoint every 60s and replaces `intelItems` state
- Format: `{ time, source, headline, impact: HIGH|MED|LOW }` — matches existing card structure exactly

**Files:** `financeRoutes.js` (add route), `ManualWorkstation.jsx` (replace hardcoded array with fetch + poll)

**Why it matters:** Right now every user sees the same 5 fake Reuters/Bloomberg headlines from 2024. Real news per symbol makes ManualWorkstation a genuine pre-trade research tool.

---

## Next Tier — After Big 3

These are sorted by impact vs effort:

### Tier 2 — Medium effort, high visibility

**A. Alert persistence in SQLite**
- AlertEngine.js currently stores alerts in a Map (lost on restart)
- Add a simple `alerts` table to TradeLogger SQLite (or new `alerts.db`)
- Load on startup, save on create/delete
- Files: `AlertEngine.js`

**B. Live position blotter (brokerPositions)**
- `brokerPositions` and `brokerOrders` initialized empty, never polled
- Add 10s poll to `/api/alpaca/positions` and `/api/alpaca/orders/open`
- Show in a dedicated "Positions" tab or below the trade stream
- Files: `MissionControlApp.jsx`, possibly new `PositionBlotter.jsx`

**C. MACD indicator on MainChart**
- MACD already calculated in `debateRoutes.js` (inline helpers)
- Move EMA/MACD helpers to a shared `indicators.js` util
- Add to processedData in MainChart, render as a second sub-chart (like RSI panel)
- Files: `MainChart.jsx`, new `indicators.js`

**D. Backtest multi-strategy comparison**
- Run 2-3 strategies on same symbol/period, render equity curves on one chart
- BacktestEngine already supports this — just need to run multiple sessions and overlay results
- Files: `BacktestPanel.jsx` (add "Compare" mode)

### Tier 3 — Large features

**E. Position risk heatmap**
- Visual grid: rows = open positions, columns = risk factors (delta, vega/vol exposure, correlation, drawdown)
- Color coded: green/amber/red per cell
- Requires: position data + correlation matrix calculation
- New component: `RiskHeatmap.jsx`

**F. Correlation matrix**
- Show correlation between all open positions (rolling 30-day)
- Useful for detecting when you're accidentally concentrated in one sector
- Backend: calculate rolling correlation from market data service bars
- New component: `CorrelationMatrix.jsx`

**G. Portfolio-level view**
- Aggregate P&L across all symbols/strategies as a single equity line
- Today's P&L, MTD, YTD
- Requires: TradeLogger query that groups by day, not symbol

**H. Trade journal with chart replay**
- Click a closed trade in the trade stream → see the chart at that exact time window with entry/exit annotated
- Very high UX value for learning/debugging strategies
- New component: `TradeJournal.jsx` + replay API endpoint

**I. Volume profile on chart**
- Where did most volume trade at each price level? (histogram on Y-axis)
- Institutional traders use this constantly
- Requires: binning OHLCV data by price bucket
- Add to `MainChart.jsx` as optional overlay

**J. Risk-of-ruin calculator**
- Given win rate, avg win/loss, position size, capital — probability of blowing up the account
- Pure math, no new API needed
- New widget in RiskPanel

**K. Slippage modeling in backtest**
- Add bid-ask spread to BacktestEngine fills (0.05% for liquid crypto, configurable)
- Add market impact model for larger positions
- Files: `BacktestEngine.js`

---

## Options (Very Long Term)

- Options chain visualization (calls/puts, strikes, expiry)
- Greeks display (delta, gamma, theta, vega)
- Volatility surface
- These require options data feed (Tradier, CBOE) — separate integration project

---

## Known Bugs / Issues

1. ~~**RiskPanel balance not synced**~~ — **FIXED** (Big #1: polls /api/alpaca/account every 5s, real equity/drawdown/exposure)
2. ~~**StrategyBrain allocations are theater**~~ — **FIXED** (Big #2: merges autonomous positions into strategy cards, real unrealized P&L)
3. ~~**ManualWorkstation intel feed hardcoded**~~ — **FIXED** (Big #3: polls /api/finance/news every 60s, Alpaca News API)
4. **CustomMarketView atmosphere** — Gemini cancelled, now routes to SOMA chat (done)
5. **Alert persistence** — in-memory Map, lost on server restart
6. **Backtest fills at exact price** — no spread/slippage model
7. **CommandPanel futures search** — hardcoded list only, no dynamic search
8. **brokerPositions never polled** — initialized empty, no live sync
9. **Alert WebSocket fallback** — if WS disconnects, alert triggers silently lost

---

## Realistic Platform Comparison

| Platform | Strength | Us vs Them |
|----------|----------|------------|
| **Bloomberg Terminal** | Institutional data ($25k/mo), 30yr codebase | Not a fair comparison; different market |
| **IB Trader Workstation** | Execution + options + margin; complex UI | Behind on data depth; ahead on AI layer |
| **TradingView Pro** | Charting + community; no execution | Ahead on intelligence; behind on charting depth |
| **ThinkOrSwim** | Options + complex orders + paper trading | Behind on options; comparable on paper trading |
| **QuantConnect** | Multi-strategy portfolio backtest, research IDE | Behind on backtest depth; ahead on live AI |
| **Composer / Streak** | Retail quant tools, no-code strategies | **At or ahead** on execution + AI side |

**Bottom line:** The backend is competition-grade. After the Big 3, the frontend will match the backend's quality. After Tier 2-3, this is a serious independent platform.
