import fs from 'fs/promises';
import path from 'path';
import tradeLogger from '../../../server/finance/TradeLogger.js';
import { compileMarketLabLedger, normalizeSymbol } from '../../../server/finance/MarketStrategyCompiler.js';
import { normalizeStrategyId } from '../../../server/finance/TradingPerformanceGuard.js';
import simCalibrationTracker from '../../../server/finance/SimCalibrationTracker.js';

const ROOT = process.cwd();
const DEFAULT_MARKET_LEDGER_PATH = path.join(ROOT, 'data', 'market-lab', 'strategy-ledger.json');
const DEFAULT_REPORT_PATH = path.join(ROOT, 'data', 'trading', 'sim-to-live-report.json');

const DEFAULT_POLICY = Object.freeze({
    minPaperTrades: 100,
    minPaperWinRate: 60,
    minPaperProfitFactor: 1.4,
    minPaperPnlUsd: 0,
    maxPaperDrawdownPct: 12,
    paperQueueLimit: 10,
    incumbentLimit: 5,
    liveRequiresHumanApproval: true
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function strategyKey(strategyId, symbol) {
    return `${normalizeStrategyId(strategyId)}:${canonicalSymbol(symbol)}`;
}

function canonicalSymbol(symbol) {
    const normalized = normalizeSymbol(symbol);
    if (['BTC', 'ETH', 'SOL'].includes(normalized)) return `${normalized}-USD`;
    return normalized;
}

function pct(value) {
    const n = finite(value, 0);
    return n <= 1 ? n * 100 : n;
}

function extractStrategyId(entry = {}) {
    return normalizeStrategyId(
        entry.compiledStrategy?.strategyId
        || entry.strategy?.id
        || entry.strategyId
        || entry.strategy?.name
    );
}

function extractSymbol(entry = {}) {
    return normalizeSymbol(
        entry.compiledStrategy?.symbol
        || entry.asset?.symbol
        || entry.symbol
    );
}

function readLedgerArray(parsed) {
    if (Array.isArray(parsed?.entries)) return parsed.entries;
    if (Array.isArray(parsed)) return parsed;
    return [];
}

function summarizePaperTrades(trades = [], { baseCapital = 10000 } = {}) {
    const closed = trades.filter(trade => String(trade.status || 'closed').toLowerCase() === 'closed');
    const wins = closed.filter(trade => finite(trade.pnl, 0) > 0);
    const losses = closed.filter(trade => finite(trade.pnl, 0) <= 0);
    const totalPnl = closed.reduce((sum, trade) => sum + finite(trade.pnl, 0), 0);
    const grossProfit = wins.reduce((sum, trade) => sum + finite(trade.pnl, 0), 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + finite(trade.pnl, 0), 0));

    let equity = 0;
    let peak = 0;
    let maxDrawdownUsd = 0;
    for (const trade of closed) {
        equity += finite(trade.pnl, 0);
        peak = Math.max(peak, equity);
        maxDrawdownUsd = Math.min(maxDrawdownUsd, equity - peak);
    }

    return {
        trades: closed.length,
        wins: wins.length,
        losses: losses.length,
        totalPnl: Number(totalPnl.toFixed(2)),
        winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(2)) : 0,
        profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : (grossProfit > 0 ? Infinity : 0),
        grossProfit: Number(grossProfit.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        avgPnl: closed.length ? Number((totalPnl / closed.length).toFixed(4)) : 0,
        maxDrawdownUsd: Number(Math.abs(maxDrawdownUsd).toFixed(2)),
        maxDrawdownPct: Number(((Math.abs(maxDrawdownUsd) / Math.max(1, baseCapital)) * 100).toFixed(2))
    };
}

function paperVerdict(stats, policy) {
    const reasons = [];
    if (stats.trades < policy.minPaperTrades) {
        reasons.push(`paper trades ${stats.trades} < ${policy.minPaperTrades}`);
    }
    if (stats.winRate < policy.minPaperWinRate) {
        reasons.push(`paper win rate ${stats.winRate}% < ${policy.minPaperWinRate}%`);
    }
    if (stats.profitFactor < policy.minPaperProfitFactor) {
        reasons.push(`paper profit factor ${stats.profitFactor} < ${policy.minPaperProfitFactor}`);
    }
    if (stats.totalPnl <= policy.minPaperPnlUsd) {
        reasons.push(`paper P&L ${stats.totalPnl} <= ${policy.minPaperPnlUsd}`);
    }
    if (stats.maxDrawdownPct > policy.maxPaperDrawdownPct) {
        reasons.push(`paper drawdown ${stats.maxDrawdownPct}% > ${policy.maxPaperDrawdownPct}%`);
    }
    return {
        passed: reasons.length === 0,
        reasons
    };
}

function simScore(entry = {}) {
    const metrics = entry.metrics || {};
    const score = finite(entry.prometheusScore ?? metrics.prometheusScore, 0);
    const pf = finite(metrics.profitFactor, 0);
    const wr = pct(metrics.winRate);
    const avg = finite(entry.paperAccount?.averageDollarPnl ?? metrics.averageDollarPnl, 0);
    return Number((score * 100 + pf * 10 + wr + avg).toFixed(4));
}

function paperScore(stats = {}) {
    return Number((
        finite(stats.totalPnl, 0)
        + finite(stats.profitFactor, 0) * 25
        + finite(stats.winRate, 0)
        - finite(stats.maxDrawdownPct, 0) * 2
    ).toFixed(4));
}

export class SimToLiveReconciler {
    constructor(options = {}, maybeLiveLogsPath = null) {
        if (typeof options === 'string') {
            this.marketLedgerPath = options;
            this.reportPath = maybeLiveLogsPath || DEFAULT_REPORT_PATH;
            this.policy = { ...DEFAULT_POLICY };
        } else {
            this.marketLedgerPath = options.marketLedgerPath || DEFAULT_MARKET_LEDGER_PATH;
            this.reportPath = options.reportPath || DEFAULT_REPORT_PATH;
            this.policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
            this.closedTrades = Array.isArray(options.closedTrades) ? options.closedTrades : null;
            this.baseCapital = finite(options.baseCapital, 10000);
        }
        this.lastReport = null;
    }

    async _readMarketLedger() {
        try {
            const raw = await fs.readFile(this.marketLedgerPath, 'utf8');
            return readLedgerArray(JSON.parse(raw));
        } catch {
            return [];
        }
    }

    _readClosedTrades() {
        if (Array.isArray(this.closedTrades)) return this.closedTrades;
        try {
            if (!tradeLogger.db) tradeLogger.initialize();
            return tradeLogger.getClosedTrades();
        } catch {
            return [];
        }
    }

    _groupTrades(trades) {
        const byPair = new Map();
        for (const trade of trades) {
            const key = strategyKey(trade.strategy, trade.symbol);
            if (!byPair.has(key)) byPair.set(key, []);
            byPair.get(key).push(trade);
        }
        return byPair;
    }

    _bestEntryPerPair(entries) {
        const byPair = new Map();
        for (const entry of entries) {
            const key = strategyKey(extractStrategyId(entry), extractSymbol(entry));
            const current = byPair.get(key);
            if (!current || simScore(entry) > simScore(current)) {
                byPair.set(key, entry);
            }
        }
        return Array.from(byPair.values());
    }

    async runReconciliation() {
        const generatedAt = new Date().toISOString();
        const rawEntries = await this._readMarketLedger();
        const compiled = compileMarketLabLedger(rawEntries);
        const uniqueEntries = this._bestEntryPerPair(compiled.entries);
        const closedTrades = this._readClosedTrades();
        const tradesByPair = this._groupTrades(closedTrades);

        const paperQueue = [];
        const paperIncumbents = [];
        const liveCandidates = [];
        const quarantined = [];
        const rejected = [];
        const gapAnalysis = [];

        for (const entry of uniqueEntries) {
            const strategyId = extractStrategyId(entry);
            const symbol = extractSymbol(entry);
            const key = strategyKey(strategyId, symbol);
            const stats = summarizePaperTrades(tradesByPair.get(key) || [], { baseCapital: this.baseCapital });
            const sim = entry.validation?.simulation || {};
            const base = {
                key,
                id: entry.id || entry.compiledStrategy?.id || key,
                strategyId,
                symbol,
                assetClass: entry.asset?.assetClass || entry.assetClass || entry.compiledStrategy?.assetClass || 'unknown',
                simulation: {
                    status: entry.graduation?.status || entry.status || 'candidate',
                    passed: !!sim.passed,
                    score: finite(entry.prometheusScore ?? entry.metrics?.prometheusScore, 0),
                    trades: finite(entry.metrics?.trades, 0),
                    winRate: pct(entry.metrics?.winRate),
                    profitFactor: finite(entry.metrics?.profitFactor, 0),
                    maxDrawdownPct: pct(entry.metrics?.maxDrawdown),
                    averageDollarPnl: finite(entry.paperAccount?.averageDollarPnl ?? entry.metrics?.averageDollarPnl, 0),
                    reasons: sim.reasons || []
                },
                paper: stats,
                compiledStrategy: entry.compiledStrategy || null
            };

            // Calibration: log predicted-vs-realized whenever paper evidence exists,
            // so sim configs that over-promise lose priority weight over time.
            simCalibrationTracker.observe({
                key,
                strategyId,
                symbol,
                predicted: { winRate: base.simulation.winRate, profitFactor: base.simulation.profitFactor },
                realized: { winRate: stats.winRate, profitFactor: stats.profitFactor, trades: stats.trades }
            });

            if (!entry.graduation?.canPromoteToPaper) {
                rejected.push({
                    ...base,
                    state: entry.status === 'blocked_by_live_paper' ? 'blocked_by_paper_guard' : 'rejected_in_simulation',
                    reasons: entry.graduation?.reasons || entry.validation?.simulation?.reasons || ['not eligible for paper promotion']
                });
                continue;
            }

            if (stats.trades < this.policy.minPaperTrades) {
                const calibrationDiscount = simCalibrationTracker.discountFor(strategyId);
                const item = {
                    ...base,
                    state: 'paper_candidate',
                    action: 'run_more_paper_trades',
                    priorityScore: Number((simScore(entry) * calibrationDiscount).toFixed(4)),
                    calibrationDiscount,
                    neededTrades: Math.max(0, this.policy.minPaperTrades - stats.trades),
                    reasons: [`simulation passed; needs exact ${strategyId}/${symbol} paper evidence`]
                };
                paperQueue.push(item);
                gapAnalysis.push({
                    key,
                    state: 'sim_ready_no_paper_yet',
                    message: `${strategyId}/${symbol} is a sim winner but has only ${stats.trades} paper trades.`
                });
                continue;
            }

            const verdict = paperVerdict(stats, this.policy);
            if (verdict.passed) {
                const item = {
                    ...base,
                    state: 'paper_incumbent',
                    action: 'eligible_for_human_live_review',
                    priorityScore: paperScore(stats),
                    reasons: ['paper evidence supports simulation'],
                    live: {
                        candidate: true,
                        requiresHumanApproval: this.policy.liveRequiresHumanApproval,
                        instruction: 'Do not switch to real-money live trading without explicit human approval.'
                    }
                };
                paperIncumbents.push(item);
                liveCandidates.push(item);
                gapAnalysis.push({
                    key,
                    state: 'paper_supports_sim',
                    message: `${strategyId}/${symbol} passed paper thresholds and can be reviewed for live use.`
                });
            } else {
                const item = {
                    ...base,
                    state: 'paper_contradicts_sim',
                    action: 'quarantine_exact_pair',
                    priorityScore: paperScore(stats),
                    reasons: verdict.reasons
                };
                quarantined.push(item);
                gapAnalysis.push({
                    key,
                    state: 'paper_contradicts_sim',
                    message: `${strategyId}/${symbol} looked good in sim but failed exact paper thresholds.`,
                    reasons: verdict.reasons
                });
            }
        }

        paperQueue.sort((a, b) => b.priorityScore - a.priorityScore);
        paperIncumbents.sort((a, b) => b.priorityScore - a.priorityScore);
        liveCandidates.sort((a, b) => b.priorityScore - a.priorityScore);
        quarantined.sort((a, b) => a.priorityScore - b.priorityScore);

        const report = {
            success: true,
            generatedAt,
            policy: this.policy,
            marketLedgerPath: path.relative(ROOT, this.marketLedgerPath).replace(/\\/g, '/'),
            reportPath: path.relative(ROOT, this.reportPath).replace(/\\/g, '/'),
            summary: {
                simEntries: compiled.summary.total,
                uniqueStrategyPairs: uniqueEntries.length,
                simReadyForPaper: compiled.summary.readyForPaper,
                paperQueue: paperQueue.length,
                paperIncumbents: paperIncumbents.length,
                liveCandidates: liveCandidates.length,
                quarantined: quarantined.length,
                rejected: rejected.length,
                selectedIncumbent: paperIncumbents[0] || null
            },
            selectedIncumbent: paperIncumbents[0] || null,
            paperQueue: paperQueue.slice(0, this.policy.paperQueueLimit),
            paperIncumbents: paperIncumbents.slice(0, this.policy.incumbentLimit),
            liveCandidates: liveCandidates.slice(0, this.policy.incumbentLimit),
            quarantined: quarantined.slice(0, 25),
            rejected: rejected.slice(0, 25),
            gapAnalysis: gapAnalysis.slice(0, 50),
            calibration: simCalibrationTracker.summary(),
            instruction: 'Simulation may nominate strategies. Paper evidence must validate the exact strategy/symbol pair. Live trading requires human approval.'
        };

        simCalibrationTracker.save();
        await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
        await fs.writeFile(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
        this.lastReport = report;
        return report;
    }
}

export { DEFAULT_POLICY, summarizePaperTrades, paperVerdict, strategyKey };

if (process.argv[1] && process.argv[1].endsWith('SimToLiveReconciler.js')) {
    const reconciler = new SimToLiveReconciler();
    reconciler.runReconciliation()
        .then(report => {
            console.log(JSON.stringify({
                success: report.success,
                summary: report.summary,
                reportPath: report.reportPath
            }, null, 2));
        })
        .catch(error => {
            console.error(error);
            process.exitCode = 1;
        });
}
