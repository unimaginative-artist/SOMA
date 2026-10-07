/**
 * server/scrapers/SimulationEvaluator.js
 *
 * SOMA's autonomous strategy evolution engine.
 *
 * Runs thousands of accelerated strategy simulations across a large asset
 * universe (crypto, stocks, futures) and all protocol variants. Scores
 * each combination, promotes winners to the PROMETHEUS knowledge library
 * via KnowledgeCuratorArbiter, and maintains a graduated playbook that
 * Mission Control will eventually use as its starting configuration.
 *
 * This runs in background — the real-time zoo window is just one window
 * into what SOMA is doing. The evaluator never stops.
 *
 * Scoring:
 *   - Win rate (profitable trades / total)
 *   - Sharpe ratio (mean return / std dev of returns)
 *   - Max drawdown
 *   - Profit factor (gross profit / gross loss)
 *   - Composite score = winRate*0.35 + sharpe*0.35 + (1-maxDD)*0.2 + pf*0.1
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getCachedMarketData, fetchHistoricalOHLCV } from './MarketDataScraper.js';
import marketEvidenceStore from '../finance/MarketEvidenceStore.js';

// ── Asset universe ─────────────────────────────────────────────────────────

const ASSETS = [
  // Crypto
  { id: 'BTC',  class: 'crypto',  base: 65000, vol: 0.018 },
  { id: 'ETH',  class: 'crypto',  base: 3200,  vol: 0.022 },
  { id: 'SOL',  class: 'crypto',  base: 142,   vol: 0.030 },
  { id: 'AVAX', class: 'crypto',  base: 38,    vol: 0.035 },
  { id: 'LINK', class: 'crypto',  base: 18,    vol: 0.038 },
  { id: 'DOT',  class: 'crypto',  base: 9,     vol: 0.040 },
  { id: 'UNI',  class: 'crypto',  base: 12,    vol: 0.042 },
  { id: 'AAVE', class: 'crypto',  base: 110,   vol: 0.036 },
  // Stocks
  { id: 'NVDA', class: 'stocks',  base: 875,   vol: 0.025 },
  { id: 'MSFT', class: 'stocks',  base: 420,   vol: 0.014 },
  { id: 'AAPL', class: 'stocks',  base: 192,   vol: 0.012 },
  { id: 'META', class: 'stocks',  base: 510,   vol: 0.022 },
  { id: 'GOOGL',class: 'stocks',  base: 175,   vol: 0.016 },
  { id: 'AMZN', class: 'stocks',  base: 195,   vol: 0.018 },
  { id: 'TSLA', class: 'stocks',  base: 175,   vol: 0.040 },
  { id: 'AMD',  class: 'stocks',  base: 170,   vol: 0.030 },
  // Futures
  { id: 'ES',   class: 'futures', base: 5280,  vol: 0.008 },
  { id: 'NQ',   class: 'futures', base: 18500, vol: 0.012 },
  { id: 'CL',   class: 'futures', base: 82,    vol: 0.020 },
  { id: 'GC',   class: 'futures', base: 2340,  vol: 0.009 },
  { id: 'SI',   class: 'futures', base: 28,    vol: 0.018 },
  { id: 'ZB',   class: 'futures', base: 115,   vol: 0.007 },
];

const PROTOCOLS = [
  { id: 'momentum',   sizePct: 0.15, minConf: 0.62, takeProfit: 0.025, stopLoss: 0.015 },
  { id: 'aggressive', sizePct: 0.22, minConf: 0.50, takeProfit: 0.035, stopLoss: 0.020 },
  { id: 'swing',      sizePct: 0.12, minConf: 0.70, takeProfit: 0.040, stopLoss: 0.025 },
  { id: 'defensive',  sizePct: 0.07, minConf: 0.80, takeProfit: 0.015, stopLoss: 0.008 },
  { id: 'scalp',      sizePct: 0.18, minConf: 0.55, takeProfit: 0.008, stopLoss: 0.005 },
  { id: 'trend',      sizePct: 0.14, minConf: 0.65, takeProfit: 0.060, stopLoss: 0.030 },
];

// ── Episode lengths per protocol type ────────────────────────────────────
// Scalp = short windows (2-3 day equiv), Trend = long windows (months equiv)

const EPISODE_LENGTHS = {
  scalp:      150,
  aggressive: 280,
  momentum:   350,
  defensive:  420,
  swing:      500,
  trend:      700,
};

// ── Tiny synthetic engine ─────────────────────────────────────────────────

function gaussian(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pearsonCorr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const xs = a.slice(-n), ys = b.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; sx += dx * dx; sy += dy * dy;
  }
  return (sx * sy) === 0 ? 0 : num / Math.sqrt(sx * sy);
}

function generatePriceSeries(asset, length = 300, anchorPrice = null, realOHLCV = null) {
  // If real historical data available, use actual closing prices
  if (realOHLCV && realOHLCV.length >= 30) {
    const closes = realOHLCV
      .map(r => r.close)
      .filter(p => p && p > 0);
    if (closes.length >= 30) return closes;
  }
  // Synthetic fallback — anchored to real price if available
  const start = anchorPrice || asset.base;
  const prices = [start];
  for (let i = 1; i < length; i++) {
    const prev = prices[prices.length - 1];
    prices.push(Math.max(0.01, prev * (1 + gaussian(0.00003, asset.vol))));
  }
  return prices;
}

function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const changes = prices.slice(-period - 1).map((p, i, arr) => i === 0 ? 0 : p - arr[i - 1]).slice(1);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function computeMomentum(prices, period = 10) {
  if (prices.length < period + 1) return 0;
  const old = prices[prices.length - period - 1];
  const cur = prices[prices.length - 1];
  return ((cur - old) / old) * 100;
}

function getSignal(prices) {
  const rsi = computeRSI(prices);
  const ma10 = computeMA(prices, 10);
  const ma20 = computeMA(prices, 20);
  const ma10prev = computeMA(prices.slice(0, -1), 10);
  const ma20prev = computeMA(prices.slice(0, -1), 20);
  const momentum = computeMomentum(prices);

  let bullScore = 0, bearScore = 0;
  if (rsi < 30) bullScore += 0.8;
  if (rsi > 70) bearScore += 0.7;
  if (ma10prev <= ma20prev && ma10 > ma20) bullScore += 0.75;
  if (ma10prev >= ma20prev && ma10 < ma20) bearScore += 0.75;
  if (momentum > 2) bullScore += 0.6;
  if (momentum < -2) bearScore += 0.6;

  const confidence = Math.max(bullScore, bearScore) / 1.5;
  const direction = bullScore > bearScore ? 'buy' : bearScore > bullScore ? 'sell' : 'hold';
  return { direction, confidence: Math.min(0.95, confidence) };
}

// ── Run a single episode ───────────────────────────────────────────────────
// Returns trade-level stats for scoring

function runEpisode(asset, protocol, anchorPrice = null, realOHLCV = null) {
  const length = EPISODE_LENGTHS[protocol.id] || EPISODE_LENGTHS[protocol._parent] || 350;
  const prices = generatePriceSeries(asset, length, anchorPrice, realOHLCV);
  let cash = 100000;
  let position = null;
  const trades = [];

  for (let i = 30; i < prices.length; i++) {
    const window = prices.slice(0, i + 1);
    const cur = prices[i];

    // Check exit
    if (position) {
      const pnlPct = (cur - position.entry) / position.entry * (position.side === 'long' ? 1 : -1);
      if (pnlPct >= protocol.takeProfit || pnlPct <= -protocol.stopLoss) {
        const realised = pnlPct * position.entry * position.qty;
        cash += position.qty * cur;
        trades.push({ entry: position.entry, exit: cur, side: position.side, pnl: realised, pnlPct });
        position = null;
      }
    }

    // Check entry (every 20 bars)
    if (!position && i % 20 === 0) {
      const { direction, confidence } = getSignal(window);
      if (direction !== 'hold' && confidence >= protocol.minConf) {
        const alloc = cash * protocol.sizePct;
        const qty = alloc / cur;
        cash -= alloc;
        position = { side: direction === 'buy' ? 'long' : 'short', entry: cur, qty };
      }
    }
  }

  // Close any open position at end
  if (position) {
    const cur = prices[prices.length - 1];
    const pnlPct = (cur - position.entry) / position.entry * (position.side === 'long' ? 1 : -1);
    const realised = pnlPct * position.entry * position.qty;
    cash += position.qty * cur;
    trades.push({ entry: position.entry, exit: cur, side: position.side, pnl: realised, pnlPct });
  }

  return { trades, finalCash: cash };
}

// ── Scoring ────────────────────────────────────────────────────────────────

function scoreRuns(allTrades) {
  if (!allTrades.length) return { score: 0, winRate: 0, sharpe: 0, maxDrawdown: 0, profitFactor: 1, totalPnL: 0 };

  const winRate = allTrades.filter(t => t.pnl > 0).length / allTrades.length;
  const returns = allTrades.map(t => t.pnlPct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 0;

  // Max drawdown from cumulative returns
  let peak = 100000, trough = 100000, equity = 100000, maxDD = 0;
  for (const t of allTrades) {
    equity += t.pnl;
    if (equity > peak) { peak = equity; trough = equity; }
    if (equity < trough) { trough = equity; maxDD = Math.max(maxDD, (peak - trough) / peak); }
  }

  const grossProfit = allTrades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(allTrades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 3 : 1;
  const totalPnL = allTrades.reduce((a, t) => a + t.pnl, 0);

  // Composite score
  const score = (
    winRate * 0.35 +
    Math.max(0, Math.min(1, (sharpe + 1) / 2)) * 0.35 +
    (1 - Math.min(1, maxDD)) * 0.20 +
    Math.min(1, profitFactor / 3) * 0.10
  );

  return { score, winRate, sharpe: +sharpe.toFixed(4), maxDrawdown: +maxDD.toFixed(4), profitFactor: +profitFactor.toFixed(2), totalPnL: +totalPnL.toFixed(2) };
}

function evaluateReportCard({ assetId, protocolId, entry, correlatedWith = [], isEvolved = false, parentId = null }) {
  const trades = Array.isArray(entry?.allTrades) ? entry.allTrades : [];
  const scores = entry?.scores || scoreRuns(trades);
  const splitIndex = Math.max(1, Math.floor(trades.length * 0.7));
  const inSample = scoreRuns(trades.slice(0, splitIndex));
  const outOfSample = scoreRuns(trades.slice(splitIndex));
  const oosTrades = Math.max(0, trades.length - splitIndex);
  const oosDrawdownOk = outOfSample.maxDrawdown <= Math.min(MAX_DRAWDOWN_TO_GRADUATE, (scores.maxDrawdown || 0) + 0.08);

  const gates = [
    {
      id: 'episodes',
      label: 'Episode count',
      passed: (entry?.episodes || 0) >= EPISODES_TO_GRADUATE,
      value: entry?.episodes || 0,
      threshold: EPISODES_TO_GRADUATE,
      detail: `${entry?.episodes || 0}/${EPISODES_TO_GRADUATE} episodes`
    },
    {
      id: 'sample_size',
      label: 'Closed trades',
      passed: trades.length >= MIN_TRADES_TO_GRADUATE,
      value: trades.length,
      threshold: MIN_TRADES_TO_GRADUATE,
      detail: `${trades.length}/${MIN_TRADES_TO_GRADUATE} closed trades`
    },
    {
      id: 'score',
      label: 'Composite score',
      passed: (scores.score || 0) >= GRADUATION_THRESHOLD,
      value: +(scores.score || 0).toFixed(3),
      threshold: GRADUATION_THRESHOLD,
      detail: `${(scores.score || 0).toFixed(3)} score`
    },
    {
      id: 'win_rate',
      label: 'Win rate',
      passed: (scores.winRate || 0) >= MIN_WIN_RATE_TO_GRADUATE,
      value: +(scores.winRate || 0).toFixed(3),
      threshold: MIN_WIN_RATE_TO_GRADUATE,
      detail: `${((scores.winRate || 0) * 100).toFixed(1)}% wins`
    },
    {
      id: 'profit_factor',
      label: 'Profit factor',
      passed: (scores.profitFactor || 0) >= MIN_PROFIT_FACTOR_TO_GRADUATE,
      value: +(scores.profitFactor || 0).toFixed(2),
      threshold: MIN_PROFIT_FACTOR_TO_GRADUATE,
      detail: `${(scores.profitFactor || 0).toFixed(2)} PF`
    },
    {
      id: 'drawdown',
      label: 'Drawdown',
      passed: (scores.maxDrawdown || 0) <= MAX_DRAWDOWN_TO_GRADUATE,
      value: +(scores.maxDrawdown || 0).toFixed(4),
      threshold: MAX_DRAWDOWN_TO_GRADUATE,
      detail: `${((scores.maxDrawdown || 0) * 100).toFixed(1)}% max DD`
    },
    {
      id: 'out_of_sample',
      label: 'Out-of-sample holdout',
      passed: oosTrades >= Math.max(20, Math.floor(MIN_TRADES_TO_GRADUATE * 0.25)) && outOfSample.score >= MIN_OUT_OF_SAMPLE_SCORE && oosDrawdownOk,
      value: +outOfSample.score.toFixed(3),
      threshold: MIN_OUT_OF_SAMPLE_SCORE,
      detail: `${oosTrades} holdout trades, ${outOfSample.score.toFixed(3)} score`
    }
  ];

  const passed = gates.filter(g => g.passed).length;
  const failed = gates.filter(g => !g.passed);
  const grade = passed === gates.length ? 'A'
    : passed >= gates.length - 1 ? 'B'
    : passed >= Math.ceil(gates.length * 0.6) ? 'C'
    : 'D';
  const graduateEligible = failed.length === 0;
  const weakestGate = failed[0] || null;
  const nextAction = weakestGate
    ? weakestGate.id === 'sample_size' || weakestGate.id === 'episodes'
      ? 'Keep paper simulation running until the sample is large enough.'
      : weakestGate.id === 'out_of_sample'
        ? 'Run more holdout testing before trusting the edge.'
        : `Improve ${weakestGate.label.toLowerCase()} before promotion.`
    : 'Eligible for paper deployment in Mission Control. Keep live trading disabled until broker risk gates pass.';

  return {
    assetId,
    protocolId,
    grade,
    graduateEligible,
    passedGates: passed,
    totalGates: gates.length,
    gates,
    weakestGate,
    nextAction,
    evidence: {
      episodes: entry?.episodes || 0,
      trades: trades.length,
      inSample,
      outOfSample,
      correlatedWith,
      evolved: isEvolved,
      evolvedFrom: parentId
    },
    summary: graduateEligible
      ? `${assetId} ${protocolId} passed ${passed}/${gates.length} promotion gates.`
      : `${assetId} ${protocolId} passed ${passed}/${gates.length} gates; blocked by ${weakestGate?.label || 'unknown gate'}.`
  };
}

// ── Evaluator class ────────────────────────────────────────────────────────

const LEDGER_PATH = path.join(process.cwd(), 'SOMA', 'strategy-ledger.json');
const PLAYBOOK_PATH = path.join(process.cwd(), 'SOMA', 'mission-control-playbook.json');
const GRADUATION_THRESHOLD = 0.70; // composite score to graduate to Mission Control
const EPISODES_TO_GRADUATE = 20;   // min episodes before eligible
const MIN_TRADES_TO_GRADUATE = 80;  // require a real sample, not a lucky handful
const MAX_DRAWDOWN_TO_GRADUATE = 0.18;
const MIN_PROFIT_FACTOR_TO_GRADUATE = 1.25;
const MIN_WIN_RATE_TO_GRADUATE = 0.52;
const MIN_OUT_OF_SAMPLE_SCORE = 0.55;

export class SimulationEvaluator {
  constructor(opts = {}) {
    this.messageBroker = opts.messageBroker || null;
    this.knowledgeCurator = opts.knowledgeCurator || null;
    this._realHistory = new Map();   // assetId → OHLCV rows

    // All combos: asset × protocol
    this._combos = [];
    for (const asset of ASSETS) {
      for (const protocol of PROTOCOLS) {
        this._combos.push({ assetId: asset.id, protocolId: protocol.id, key: `${asset.id}::${protocol.id}` });
      }
    }

    // In-memory ledger: key → { episodes, allTrades, scores, graduated }
    this._ledger = {};
    this._playbook = [];
    this._running = false;
    this._batchSize = 8;    // combos evaluated per tick
    this._tickMs = 3000;    // ms between evaluation batches
    this._comboIdx = 0;     // round-robin pointer

    // Genetic evolution
    this._evolvedProtocols = [];
    this._evolverId = 1;
    this._lastEvolveAt = 0;  // total episodes at last evolution step

    // Correlation matrix (built after history prefetch)
    this._correlationMatrix = {};

    // Live status for frontend
    this._status = {
      totalEpisodes: 0,
      totalTrades: 0,
      graduated: 0,
      lastBatch: [],
      leaderboard: [],
      startedAt: Date.now(),
    };

    this._loadLedger();
    console.log(`[SimulationEvaluator] Strategy evaluation engine online — ${this._combos.length} combos queued`);
  }

  async _loadLedger() {
    try {
      const raw = await fs.readFile(LEDGER_PATH, 'utf8');
      this._ledger = JSON.parse(raw);
      const playRaw = await fs.readFile(PLAYBOOK_PATH, 'utf8');
      this._playbook = JSON.parse(playRaw);
      this._rebuildStatus();
      console.log(`[SimulationEvaluator] Loaded ledger: ${Object.keys(this._ledger).length} combos, ${this._playbook.length} graduated`);
    } catch {
      // Fresh start
    }
  }

  async _saveLedger() {
    try {
      await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
      await fs.writeFile(LEDGER_PATH, JSON.stringify(this._ledger, null, 2));
      await fs.writeFile(PLAYBOOK_PATH, JSON.stringify(this._playbook, null, 2));
    } catch (e) {
      console.warn('[SimulationEvaluator] Failed to save ledger:', e.message);
    }
  }

  _rebuildStatus() {
    const entries = Object.entries(this._ledger)
      .map(([key, v]) => ({
        key, ...v.scores, episodes: v.episodes, trades: v.allTrades.length,
        assetId: v.assetId, protocolId: v.protocolId, graduated: v.graduated,
        evolved: !!(PROTOCOLS.find(p => p.id === v.protocolId) === undefined && v.protocolId),
        reportCard: v.reportCard || this._entryReportCard(v.assetId, v.protocolId, v),
      }))
      .sort((a, b) => b.score - a.score);

    this._status.leaderboard = entries.slice(0, 30);
    this._status.graduated = this._playbook.length;
    this._status.totalEpisodes = Object.values(this._ledger).reduce((a, v) => a + v.episodes, 0);
    this._status.totalTrades = Object.values(this._ledger).reduce((a, v) => a + v.allTrades.length, 0);
    this._status.evolvedProtocols = this._evolvedProtocols.length;
    this._status.combos = this._combos.length;
  }

  _correlatedAssets(assetId) {
    return Object.entries(this._correlationMatrix[assetId] || {})
      .filter(([, c]) => Math.abs(c) > 0.75)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3)
      .map(([id, c]) => ({ id, correlation: c }));
  }

  _entryReportCard(assetId, protocolId, entry) {
    const evolvedProtocol = this._evolvedProtocols.find(p => p.id === protocolId);
    return evaluateReportCard({
      assetId,
      protocolId,
      entry,
      correlatedWith: this._correlatedAssets(assetId),
      isEvolved: !!evolvedProtocol,
      parentId: evolvedProtocol?._parent || null
    });
  }

  start() {
    if (this._running) return;
    this._running = true;
    // Pre-fetch real history for all assets in background
    this._prefetchHistory();
    this._tick();
    console.log('[SimulationEvaluator] Evaluation loop started');
  }

  async _prefetchHistory() {
    const assetIds = [...new Set(ASSETS.map(a => a.id))];
    console.log(`[SimulationEvaluator] Pre-fetching real OHLCV history for ${assetIds.length} assets...`);
    let fetched = 0;
    for (const assetId of assetIds) {
      if (!this._running) break;
      try {
        const rows = await fetchHistoricalOHLCV(assetId);
        if (rows?.length) {
          this._realHistory.set(assetId, rows);
          fetched++;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 800));
    }
    console.log(`[SimulationEvaluator] Real history loaded for ${fetched}/${assetIds.length} assets`);
    // Build correlation matrix from real closes
    this._buildCorrelationMatrix();
  }

  _buildCorrelationMatrix() {
    const ids = [...this._realHistory.keys()];
    const closes = {};
    for (const id of ids) {
      closes[id] = this._realHistory.get(id).map(r => r.close).filter(v => v > 0);
    }
    const matrix = {};
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const corr = +(pearsonCorr(closes[a] || [], closes[b] || [])).toFixed(3);
        if (!matrix[a]) matrix[a] = {};
        if (!matrix[b]) matrix[b] = {};
        matrix[a][b] = corr;
        matrix[b][a] = corr;
      }
    }
    this._correlationMatrix = matrix;
    console.log(`[SimulationEvaluator] Correlation matrix built for ${ids.length} assets`);
  }

  // ── Genetic evolution — mutate top performers every 100 episodes ──────────

  _evolveStep() {
    const top = Object.values(this._ledger)
      .filter(e => !e.graduated && e.episodes >= 15 && (e.scores?.score || 0) > 0.55)
      .sort((a, b) => (b.scores?.score || 0) - (a.scores?.score || 0))
      .slice(0, 3);

    if (top.length === 0) return;

    // Cap evolved pool at 12 — prune the worst first
    if (this._evolvedProtocols.length >= 12) {
      const worstCombos = Object.values(this._ledger)
        .filter(e => e.protocolId && e.protocolId.includes('_ev'))
        .sort((a, b) => (a.scores?.score || 0) - (b.scores?.score || 0))
        .slice(0, 3);
      for (const wc of worstCombos) {
        this._evolvedProtocols = this._evolvedProtocols.filter(p => p.id !== wc.protocolId);
        const baseIdx = this._combos.findIndex(c => c.protocolId === wc.protocolId);
        if (baseIdx >= 0) this._combos.splice(baseIdx, 1);
        delete this._ledger[wc.assetId + '::' + wc.protocolId];
      }
    }

    let newCount = 0;
    for (const entry of top) {
      const baseProto = PROTOCOLS.find(p => p.id === entry.protocolId)
        || this._evolvedProtocols.find(p => p.id === entry.protocolId);
      if (!baseProto) continue;

      // Create one mutant offspring
      const mutant = {
        id: `${baseProto._parent || baseProto.id}_ev${this._evolverId++}`,
        _parent: baseProto._parent || baseProto.id,
        _evolved: true,
        sizePct:     clamp(baseProto.sizePct    * (1 + gaussian(0, 0.15)), 0.04, 0.28),
        minConf:     clamp(baseProto.minConf    * (1 + gaussian(0, 0.08)), 0.42, 0.90),
        takeProfit:  clamp(baseProto.takeProfit * (1 + gaussian(0, 0.15)), 0.005, 0.10),
        stopLoss:    clamp(baseProto.stopLoss   * (1 + gaussian(0, 0.15)), 0.003, 0.05),
      };

      this._evolvedProtocols.push(mutant);
      // Wire it against the asset that scored best with the parent protocol
      const assetId = entry.assetId;
      const key = `${assetId}::${mutant.id}`;
      if (!this._ledger[key]) {
        this._combos.push({ assetId, protocolId: mutant.id, key });
        newCount++;
      }
    }

    if (newCount > 0) {
      console.log(`[SimulationEvaluator] Evolved ${newCount} new protocol variants — pool: ${this._combos.length} combos`);
    }
  }

  stop() {
    this._running = false;
  }

  _tick() {
    if (!this._running) return;
    try {
      this._runBatch();
    } catch (e) {
      console.warn('[SimulationEvaluator] Batch error:', e.message);
    }
    setTimeout(() => this._tick(), this._tickMs);
  }

  _runBatch() {
    // Get real anchor prices if available
    const realData = getCachedMarketData();
    const anchorPrices = {};
    if (realData?.crypto) {
      for (const [id, info] of Object.entries(realData.crypto)) {
        if (info?.price) anchorPrices[id] = info.price;
      }
    }
    if (realData?.stocks) {
      for (const [id, info] of Object.entries(realData.stocks)) {
        if (info?.price) anchorPrices[id] = info.price;
      }
    }
    if (realData?.futures) {
      for (const [id, info] of Object.entries(realData.futures)) {
        if (info?.price) anchorPrices[id] = info.price;
      }
    }

    // Use Thompson sampling: prefer under-explored combos but weight toward
    // high-scoring combos that haven't graduated yet
    const batch = this._selectBatch();
    const batchResults = [];

    for (const { assetId, protocolId, key } of batch) {
      const asset = ASSETS.find(a => a.id === assetId);
      const protocol = PROTOCOLS.find(p => p.id === protocolId)
        || this._evolvedProtocols.find(p => p.id === protocolId);
      if (!asset || !protocol) continue;

      const anchorPrice = anchorPrices[assetId] || null;
      const realOHLCV = this._realHistory.get(assetId) || null;
      const { trades } = runEpisode(asset, protocol, anchorPrice, realOHLCV);

      // Accumulate into ledger
      if (!this._ledger[key]) {
        this._ledger[key] = { assetId, protocolId, episodes: 0, allTrades: [], scores: {}, graduated: false };
      }
      const entry = this._ledger[key];
      entry.episodes++;
      entry.allTrades.push(...trades);

      // Keep last 500 trades per combo to avoid unbounded memory
      if (entry.allTrades.length > 500) {
        entry.allTrades = entry.allTrades.slice(-500);
      }

      entry.scores = scoreRuns(entry.allTrades);
      batchResults.push({ key, assetId, protocolId, ...entry.scores, episodes: entry.episodes });

      // Check graduation
      entry.reportCard = this._entryReportCard(assetId, protocolId, entry);

      if (!entry.graduated && entry.reportCard.graduateEligible) {
        this._graduate(assetId, protocolId, entry);
      }
    }

    this._status.lastBatch = batchResults;
    this._rebuildStatus();

    // Genetic evolution: every 100 total episodes
    const total = this._status.totalEpisodes;
    if (total - this._lastEvolveAt >= 100 && total >= 100) {
      this._lastEvolveAt = total;
      this._evolveStep();
    }

    // Save every 10 batches
    if (total % 10 === 0) {
      this._saveLedger().catch(() => {});
    }
  }

  _selectBatch() {
    const batch = [];
    const n = this._batchSize;

    // Mix: 50% exploration (round-robin), 50% exploitation (highest score, non-graduated)
    const exploitPool = Object.values(this._ledger)
      .filter(e => !e.graduated && e.episodes >= 5)
      .sort((a, b) => b.scores.score - a.scores.score)
      .slice(0, 20);

    for (let i = 0; i < n; i++) {
      if (i % 2 === 0 || exploitPool.length === 0) {
        // Explore: round-robin
        batch.push(this._combos[this._comboIdx % this._combos.length]);
        this._comboIdx++;
      } else {
        // Exploit: pick from top scorers with some randomness
        const pick = exploitPool[Math.floor(Math.random() * Math.min(5, exploitPool.length))];
        batch.push({ assetId: pick.assetId, protocolId: pick.protocolId, key: `${pick.assetId}::${pick.protocolId}` });
      }
    }

    return batch;
  }

  _graduate(assetId, protocolId, entry) {
    entry.graduated = true;

    const playbookEntry = {
      assetId,
      protocolId,
      assetClass: ASSETS.find(a => a.id === assetId)?.class,
      ...entry.scores,
      episodes: entry.episodes,
      trades: entry.allTrades.length,
      graduatedAt: Date.now(),
    };

    // Attach correlation context before saving
    const correlatedWith = this._correlatedAssets(assetId);
    if (correlatedWith.length) playbookEntry.correlatedWith = correlatedWith;

    const isEvolved = !!this._evolvedProtocols.find(p => p.id === protocolId);
    const parentId = isEvolved ? (this._evolvedProtocols.find(p => p.id === protocolId)?._parent) : null;
    if (isEvolved) { playbookEntry.evolved = true; playbookEntry.evolvedFrom = parentId; }

    playbookEntry.reportCard = entry.reportCard || evaluateReportCard({
      assetId,
      protocolId,
      entry,
      correlatedWith,
      isEvolved,
      parentId
    });

    this._playbook.push(playbookEntry);
    this._playbook.sort((a, b) => b.score - a.score);
    try {
      const evidence = marketEvidenceStore.append('simulation', {
        action: 'strategy_graduated',
        assetId,
        protocolId,
        playbookEntry
      }, { source: 'SimulationEvaluator', symbol: assetId, strategyId: protocolId });
      playbookEntry.evidenceId = evidence.evidenceId;
    } catch {
      // Do not block simulation graduation on evidence mirroring.
    }

    console.log(`[SimulationEvaluator] GRADUATED: ${assetId} + ${protocolId}${isEvolved ? ` (evolved from ${parentId})` : ''} — score ${entry.scores.score.toFixed(3)}, winRate ${(entry.scores.winRate * 100).toFixed(1)}%`);

    // Publish to CNS
    if (this.messageBroker) {
      this.messageBroker.publish('simulation.strategy.graduated', playbookEntry).catch(() => {});
    }

    // File to PROMETHEUS knowledge library
    if (this.knowledgeCurator) {
      const corrNote = correlatedWith.length
        ? `\n**Correlated Assets (>0.75):** ${correlatedWith.map(c => `${c.id} (${c.correlation > 0 ? '+' : ''}${c.correlation})`).join(', ')}`
        : '';
      const evolvedNote = isEvolved ? `\n**Evolution:** Mutated from ${parentId} protocol` : '';

      const content = [
        `**Asset:** ${assetId} (${ASSETS.find(a => a.id === assetId)?.class})`,
        `**Protocol:** ${protocolId}${evolvedNote}`,
        `**Win Rate:** ${(entry.scores.winRate * 100).toFixed(1)}%`,
        `**Sharpe Ratio:** ${entry.scores.sharpe}`,
        `**Max Drawdown:** ${(entry.scores.maxDrawdown * 100).toFixed(1)}%`,
        `**Profit Factor:** ${entry.scores.profitFactor}`,
        `**Composite Score:** ${entry.scores.score.toFixed(3)}`,
        `**Episodes:** ${entry.episodes} (${entry.allTrades.length} trades)`,
        `**Total P&L:** $${entry.scores.totalPnL.toFixed(2)}${corrNote}`,
        `**Report Card:** ${playbookEntry.reportCard.grade} (${playbookEntry.reportCard.passedGates}/${playbookEntry.reportCard.totalGates} gates)`,
        `**Status:** GRADUATED — paper deployment candidate for Mission Control`,
      ].join('\n');

      this.knowledgeCurator.file('prometheus', 'strategy_validated', content, 'SimulationEvaluator')
        .catch(e => console.warn('[SimulationEvaluator] Knowledge filing failed:', e.message));
    }
  }

  getStatus() {
    return { ...this._status };
  }

  getPlaybook() {
    return this._playbook.map(entry => ({
      ...entry,
      reportCard: entry.reportCard || evaluateReportCard({
        assetId: entry.assetId,
        protocolId: entry.protocolId,
        entry: {
          episodes: entry.episodes,
          allTrades: Array.from({ length: entry.trades || 0 }, () => ({ pnl: 0, pnlPct: 0 })),
          scores: {
            score: entry.score || 0,
            winRate: entry.winRate || 0,
            sharpe: entry.sharpe || 0,
            maxDrawdown: entry.maxDrawdown || 0,
            profitFactor: entry.profitFactor || 0,
            totalPnL: entry.totalPnL || 0
          }
        },
        correlatedWith: entry.correlatedWith || [],
        isEvolved: !!entry.evolved,
        parentId: entry.evolvedFrom || null
      })
    }));
  }

  getLedger() {
    return Object.values(this._ledger)
      .map(e => ({
        assetId: e.assetId, protocolId: e.protocolId, ...e.scores,
        episodes: e.episodes, trades: e.allTrades.length, graduated: e.graduated,
        evolved: !!this._evolvedProtocols.find(p => p.id === e.protocolId),
        reportCard: e.reportCard || this._entryReportCard(e.assetId, e.protocolId, e),
      }))
      .sort((a, b) => b.score - a.score);
  }

  getCorrelationMatrix() {
    return this._correlationMatrix;
  }

  getEvolvedProtocols() {
    return this._evolvedProtocols.map(p => ({
      id: p.id, parent: p._parent,
      sizePct: +p.sizePct.toFixed(3), minConf: +p.minConf.toFixed(3),
      takeProfit: +p.takeProfit.toFixed(4), stopLoss: +p.stopLoss.toFixed(4),
    }));
  }
}

export default SimulationEvaluator;
