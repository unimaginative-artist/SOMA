/**
 * BeePrometheusBridge.js
 *
 * Strategy research and paper-evidence bridge between Market Lab, BeeBots,
 * and the primary reconciliation report.
 *
 * Features:
 * BeeBots use public OKX quotes for paper fills. These are not exchange fills
 * or measured slippage. Only validated Market Lab entries can supply tuning;
 * paper outcomes remain tied to the exact BeeBot strategy and symbol.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import tradeLogger from '../finance/TradeLogger.js';
import simToLiveDaemon from '../finance/SimToLiveDaemon.js';
import { summarizePaperTrades, paperVerdict, strategyKey, eligiblePaperTrade } from '../../core/signals/generator/SimToLiveReconciler.js';
import { compileMarketLabEntry } from '../finance/MarketStrategyCompiler.js';

const ROOT = process.cwd();
const SHARED_PARAMS_PATH = path.join(ROOT, 'data', 'trading', 'beebots_shared_strategy_tuning.json');
const MARKET_LEDGER_PATH = path.join(ROOT, 'data', 'market-lab', 'strategy-ledger.json');

export const BEEBOT_STRATEGY_DEFINITIONS = Object.freeze({
    bizzy: {
        id: 'beebots_bizzy',
        beeKey: 'bizzy',
        name: 'Bizzy Dual Thrust Breakout',
        symbol: 'BTC-USD',
        nativePair: 'BTC-USDT-SWAP',
        assetClass: 'crypto',
        premise: 'High-conviction volatility breakout triggered by Larry Williams Dual Thrust channels with Laya System 1 ModernBERT validation.',
        defaultParameters: {
            k1: 0.5,
            k2: 0.5,
            stopAtr: 1.5,
            targetAtr: 3.0,
            minConviction: 2,
            riskPerTradePct: 0.02
        }
    },
    boozy: {
        id: 'beebots_boozy',
        beeKey: 'boozy',
        name: 'Boozy Bollinger Mean Reversion',
        symbol: 'ETH-USD',
        nativePair: 'ETH-USDT-SWAP',
        assetClass: 'crypto',
        premise: 'Statistical Bollinger Bands and RSI mean-reversion fading overbought and oversold micro-structure extremes.',
        defaultParameters: {
            rsiOversold: 30,
            rsiOverbought: 70,
            bollingerStdDev: 2.0,
            stopAtr: 1.5,
            targetAtr: 2.0,
            minConviction: 2,
            riskPerTradePct: 0.02
        }
    },
    breezy: {
        id: 'beebots_breezy',
        beeKey: 'breezy',
        name: 'Breezy Multi-Factor Trend & Carry',
        symbol: 'SOL-USD',
        nativePair: 'SOL-USDT-SWAP',
        assetClass: 'crypto',
        premise: 'Multi-factor 24h trend momentum combined with OKX funding rate carry alignment and Laya conviction filtering.',
        defaultParameters: {
            trendLookbackBars: 24,
            stopAtr: 1.5,
            targetAtr: 2.5,
            minConviction: 2,
            riskPerTradePct: 0.02
        }
    }
});

const TUNING_BOUNDS = Object.freeze({
    k1: [0.1, 1.5], k2: [0.1, 1.5],
    rsiOversold: [10, 40], rsiOverbought: [60, 90],
    bollingerStdDev: [1, 3], stopAtr: [1, 5], targetAtr: [1, 8],
    trendLookbackBars: [12, 40], minConviction: [2, 3],
    riskPerTradePct: [0.002, 0.02]
});

export function validateSharedTuning(tuning) {
    if (!tuning || typeof tuning !== 'object' || Array.isArray(tuning)) throw new Error('Tuning must be an object');
    const validated = {};
    for (const [beeKey, params] of Object.entries(tuning)) {
        if (!BEEBOT_STRATEGY_DEFINITIONS[beeKey] || !params || typeof params !== 'object' || Array.isArray(params)) {
            throw new Error(`Invalid BeeBot tuning group: ${beeKey}`);
        }
        validated[beeKey] = {};
        for (const [key, raw] of Object.entries(params)) {
            const bounds = TUNING_BOUNDS[key];
            if (!bounds || !Object.hasOwn(BEEBOT_STRATEGY_DEFINITIONS[beeKey].defaultParameters, key)
                || typeof raw !== 'number' || !Number.isFinite(raw) || raw < bounds[0] || raw > bounds[1]
                || (['trendLookbackBars', 'minConviction'].includes(key) && !Number.isInteger(raw))) {
                throw new Error(`Invalid ${beeKey}.${key} tuning value`);
            }
            validated[beeKey][key] = raw;
        }
    }
    const boozy = validated.boozy;
    if (boozy?.rsiOversold != null && boozy?.rsiOverbought != null && boozy.rsiOversold >= boozy.rsiOverbought) {
        throw new Error('Boozy RSI thresholds must be ordered');
    }
    return validated;
}

export class BeePrometheusBridge {
    constructor(options = {}) {
        this.sharedParamsPath = options.sharedParamsPath || SHARED_PARAMS_PATH;
        this.marketLedgerPath = options.marketLedgerPath || MARKET_LEDGER_PATH;
        this.tradeLogger = options.tradeLogger || tradeLogger;
        this.simDaemon = options.simDaemon || simToLiveDaemon;
        this.performanceGuard = options.performanceGuard;
    }

    /**
     * Load current shared strategy parameters
     */
    loadSharedParameters() {
        try {
            if (fs.existsSync(this.sharedParamsPath)) {
                const saved = JSON.parse(fs.readFileSync(this.sharedParamsPath, 'utf8'));
                return { ...saved, tuning: validateSharedTuning(saved.tuning) };
            }
        } catch (e) {
            console.warn('[BeePrometheusBridge] Could not read shared params:', e.message);
        }

        const defaults = {
            updatedAt: new Date().toISOString(),
            source: 'prometheus_market_lab_default',
            tuning: {
                bizzy: { ...BEEBOT_STRATEGY_DEFINITIONS.bizzy.defaultParameters },
                boozy: { ...BEEBOT_STRATEGY_DEFINITIONS.boozy.defaultParameters },
                breezy: { ...BEEBOT_STRATEGY_DEFINITIONS.breezy.defaultParameters }
            }
        };
        return defaults;
    }

    /**
     * Persist shared strategy parameters
     */
    saveSharedParameters(data) {
        try {
            const payload = { ...data, tuning: validateSharedTuning(data?.tuning) };
            fs.mkdirSync(path.dirname(this.sharedParamsPath), { recursive: true });
            const temporary = `${this.sharedParamsPath}.${crypto.randomUUID()}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
            fs.renameSync(temporary, this.sharedParamsPath);
            return true;
        } catch (e) {
            console.error('[BeePrometheusBridge] Failed to save shared params:', e.message);
            return false;
        }
    }

    /**
     * Apply shared parameters to BeeBots autonomic tuner and engine
     */
    applyParametersToSwarm(engine) {
        if (!engine) return false;
        const shared = this.loadSharedParameters();
        if (shared?.tuning && engine.autonomicTuner) {
            const safe = structuredClone(shared.tuning);
            for (const [beeKey, params] of Object.entries(safe)) {
                const current = engine.autonomicTuner.getBeeAdjustments(beeKey);
                if (params.riskPerTradePct != null) {
                    params.baseRiskPerTradePct = params.riskPerTradePct;
                    params.riskPerTradePct = Math.min(params.riskPerTradePct, current.riskPerTradePct);
                }
                if (params.minConviction != null) {
                    params.baseMinConviction = params.minConviction;
                    params.minConviction = Math.max(params.minConviction, current.minConviction);
                }
                if (beeKey === 'boozy') {
                    if (params.rsiOversold != null) params.baseRsiOversold = params.rsiOversold;
                    if (params.rsiOverbought != null) params.baseRsiOverbought = params.rsiOverbought;
                    if (current.status === 'DEFENSIVE') {
                        params.rsiOversold = Math.min(params.rsiOversold ?? 30, current.rsiOversold);
                        params.rsiOverbought = Math.max(params.rsiOverbought ?? 70, current.rsiOverbought);
                    }
                }
            }
            engine.autonomicTuner.loadState(safe);
            console.log('[BeePrometheusBridge] 🔄 Applied Prometheus shared parameters to BeeBots Swarm.');
            return true;
        }
        return false;
    }

    /**
     * Ensure Market Lab Strategy Ledger contains qualified research entries for BeeBot strategies
     */
    ensurePrometheusResearchEntries() {
        try {
            let entries = [];
            let parsedLedger = null;
            const initialStat = fs.existsSync(this.marketLedgerPath) ? fs.statSync(this.marketLedgerPath) : null;
            if (fs.existsSync(this.marketLedgerPath)) {
                const raw = fs.readFileSync(this.marketLedgerPath, 'utf8');
                parsedLedger = JSON.parse(raw);
                if (!Array.isArray(parsedLedger) && !Array.isArray(parsedLedger?.entries)) {
                    throw new Error('Market Lab ledger has an unsupported schema');
                }
                entries = Array.isArray(parsedLedger) ? parsedLedger : parsedLedger.entries;
            }

            const existingKeys = new Set(entries.map(e => strategyKey(e.strategy?.id || e.strategyId, e.asset?.symbol || e.symbol)));

            let addedCount = 0;
            const now = new Date().toISOString();

            for (const def of Object.values(BEEBOT_STRATEGY_DEFINITIONS)) {
                const key = strategyKey(def.id, def.symbol);
                if (!existingKeys.has(key)) {
                    const entry = {
                        id: `market-beebot-${def.beeKey}-${Date.now()}`,
                        source: 'prometheus-beebots-bridge-registration',
                        paperOnly: true,
                        executionVenue: 'okx_perpetual_paper',
                        createdAt: now,
                        updatedAt: now,
                        status: 'research_pending',
                        asset: {
                            symbol: def.symbol,
                            label: `${def.symbol.split('-')[0]} Perpetual Proxy`,
                            assetClass: def.assetClass,
                            allowShort: true
                        },
                        strategy: {
                            id: def.id,
                            name: def.name,
                            premise: def.premise
                        },
                        metrics: {},
                        dataSource: 'unverified',
                        realDataBars: 0,
                        walkForward: null
                    };
                    entries.unshift(entry);
                    addedCount++;
                }
            }

            // Older bridge versions inserted invented backtest numbers. Revoke
            // only those bridge-generated rows; preserve independent lab work.
            let revokedCount = 0;
            for (const entry of entries) {
                if (entry.source !== 'prometheus-beebots-bridge' || !String(entry.id || '').startsWith('market-beebot-')) continue;
                entry.source = 'prometheus-beebots-bridge-registration';
                entry.status = 'research_pending';
                entry.metrics = {};
                entry.paperAccount = {};
                entry.prometheusScore = 0;
                entry.dataSource = 'unverified';
                entry.realDataBars = 0;
                entry.walkForward = null;
                entry.missionCouncil = null;
                revokedCount++;
            }

            if (addedCount > 0 || revokedCount > 0) {
                fs.mkdirSync(path.dirname(this.marketLedgerPath), { recursive: true });
                const currentStat = fs.existsSync(this.marketLedgerPath) ? fs.statSync(this.marketLedgerPath) : null;
                if (initialStat?.mtimeMs !== currentStat?.mtimeMs || initialStat?.size !== currentStat?.size) {
                    throw new Error('Market Lab ledger changed during BeeBot registration');
                }
                const temporary = `${this.marketLedgerPath}.${crypto.randomUUID()}.tmp`;
                const payload = Array.isArray(parsedLedger) || !parsedLedger ? entries : { ...parsedLedger, entries };
                fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
                fs.renameSync(temporary, this.marketLedgerPath);
            }
            return { success: true, addedCount, revokedCount, totalEntries: entries.length };
        } catch (e) {
            console.error('[BeePrometheusBridge] Failed to ensure research entries:', e.message);
            return { success: false, error: e.message };
        }
    }

    syncValidatedResearchParameters() {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(this.marketLedgerPath, 'utf8'));
        } catch {
            return { updated: false, reason: 'market_lab_ledger_unavailable' };
        }
        const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : []);
        const tuning = {};
        const researchEntryIds = {};
        for (const [beeKey, def] of Object.entries(BEEBOT_STRATEGY_DEFINITIONS)) {
            const candidates = entries.filter(entry =>
                entry.source !== 'prometheus-beebots-bridge-registration'
                && strategyKey(entry.strategy?.id || entry.strategyId, entry.asset?.symbol || entry.symbol)
                    === strategyKey(def.id, def.symbol)
                && (entry.strategy?.parameters || entry.tuning)
                && compileMarketLabEntry(entry,
                    this.performanceGuard ? { performanceGuard: this.performanceGuard } : {}).graduation.canPromoteToPaper);
            candidates.sort((a, b) => Number(b.prometheusScore || 0) - Number(a.prometheusScore || 0));
            for (const entry of candidates) {
                try {
                    tuning[beeKey] = validateSharedTuning({ [beeKey]: entry.strategy?.parameters || entry.tuning })[beeKey];
                    researchEntryIds[beeKey] = entry.id;
                    break;
                } catch { /* An invalid parameter set cannot reach the swarm. */ }
            }
        }
        if (!Object.keys(tuning).length) return { updated: false, reason: 'no_validated_parameter_results' };
        const current = this.loadSharedParameters();
        const next = {
            ...current,
            source: 'prometheus_market_lab_validated',
            updatedAt: new Date().toISOString(),
            researchEntryIds: { ...(current.researchEntryIds || {}), ...researchEntryIds },
            tuning: Object.fromEntries(Object.entries(current.tuning).map(([key, params]) =>
                [key, { ...params, ...(tuning[key] || {}) }]))
        };
        if (!this.saveSharedParameters(next)) throw new Error('Validated research parameters could not be persisted');
        return { updated: true, researchEntryIds };
    }

    /**
     * Get live promotion status for all 3 BeeBot strategies
     */
    getPromotionStatus() {
        if (!this.tradeLogger.db) {
            try { this.tradeLogger.initialize(); } catch (_) {}
        }

        const closedTrades = this.tradeLogger.getClosedTrades ? this.tradeLogger.getClosedTrades() : [];
        const simReport = this.simDaemon.readReport() || {};
        let researchEntries = [];
        try {
            const parsed = JSON.parse(fs.readFileSync(this.marketLedgerPath, 'utf8'));
            researchEntries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.entries) ? parsed.entries : []);
        } catch { /* No verified research yet. */ }
        const policy = simReport.policy || {
            minPaperTrades: 100,
            minPaperWinRate: 60,
            minPaperProfitFactor: 1.4,
            maxPaperDrawdownPct: 12
        };

        const result = {
            timestamp: new Date().toISOString(),
            policy,
            lastReconciledAt: simReport.generatedAt || null,
            sharedTuning: this.loadSharedParameters().tuning,
            bees: {}
        };

        for (const [key, def] of Object.entries(BEEBOT_STRATEGY_DEFINITIONS)) {
            const canonicalKey = strategyKey(def.id, def.symbol);
            const beeTrades = closedTrades.filter(t => eligiblePaperTrade(t) && strategyKey(t.strategy, t.symbol) === canonicalKey);
            const matchingResearch = researchEntries.filter(entry => strategyKey(entry.strategy?.id || entry.strategyId, entry.asset?.symbol || entry.symbol) === canonicalKey);
            const readyEntries = matchingResearch.filter(entry => entry.source !== 'prometheus-beebots-bridge-registration'
                && compileMarketLabEntry(entry,
                this.performanceGuard ? { performanceGuard: this.performanceGuard } : {}).graduation.canPromoteToPaper);
            const researchReady = readyEntries.length > 0;
            const primaryCandidate = (simReport.liveCandidates || []).some(item =>
                item.key === canonicalKey && readyEntries.some(entry => entry.id === item.id));

            const stats = summarizePaperTrades(beeTrades, { baseCapital: 333.34 });
            const verdict = paperVerdict(stats, policy);

            // Determine promotion ladder tier
            let tier = 'RESEARCH_PENDING';
            let tierLabel = 'Research validation pending';
            let liveEligible = false;

            if (researchReady && stats.trades >= policy.minPaperTrades) {
                if (verdict.passed) {
                    tier = primaryCandidate ? 'LIVE_CANDIDATE' : 'AWAITING_RECONCILIATION';
                    tierLabel = primaryCandidate ? 'Live candidate (requires human approval)' : 'Awaiting primary reconciliation';
                    liveEligible = primaryCandidate;
                } else {
                    tier = 'QUARANTINED';
                    tierLabel = 'Quarantined (Paper Metrics Diverged)';
                }
            } else if (researchReady && stats.trades > 0) {
                tier = 'PAPER_TESTING';
                tierLabel = 'Paper Validation in Progress';
            }

            result.bees[key] = {
                strategyId: def.id,
                strategyName: def.name,
                symbol: def.symbol,
                nativePair: def.nativePair,
                researchReady,
                paperStats: stats,
                gates: {
                    tradesPassed: stats.trades >= policy.minPaperTrades,
                    tradesProgressPct: Math.min(100, Number(((stats.trades / policy.minPaperTrades) * 100).toFixed(1))),
                    tradesRemaining: Math.max(0, policy.minPaperTrades - stats.trades),
                    winRatePassed: stats.winRate >= policy.minPaperWinRate,
                    profitFactorPassed: stats.profitFactor >= policy.minPaperProfitFactor,
                    drawdownPassed: stats.maxDrawdownPct <= policy.maxPaperDrawdownPct
                },
                verdict,
                tier,
                tierLabel,
                liveEligible
            };
        }

        return result;
    }

    /**
     * Run full two-way synchronization and Sim-to-Live reconciliation
     */
    async syncAndReconcile() {
        // 1. Ensure Prometheus ledger has BeeBot strategies
        const registration = this.ensurePrometheusResearchEntries();
        if (!registration.success) throw new Error(registration.error || 'BeeBot research registration failed');
        const parameterSync = this.syncValidatedResearchParameters();

        // 2. Run Sim-to-Live Reconciler
        const report = await this.simDaemon.runNow();
        if (!report?.success) throw new Error(report?.reason || 'Sim-to-live reconciliation did not complete');

        // 3. Return updated promotion status
        const promotion = this.getPromotionStatus();

        return {
            success: true,
            synchronizedAt: new Date().toISOString(),
            parameterSync,
            reportSummary: report.summary,
            promotion
        };
    }
}

const beePrometheusBridge = new BeePrometheusBridge();
export default beePrometheusBridge;
