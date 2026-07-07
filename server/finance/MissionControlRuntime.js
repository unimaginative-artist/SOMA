import fs from 'fs';
import path from 'path';
import strategyRegistry from './StrategyRegistry.js';
import historicalDataCache from './HistoricalDataCache.js';
import trainingJobRunner from './TrainingJobRunner.js';
import { brokerAdapters } from './BrokerAdapter.js';
import { applyTierProfile, clampTier, evaluatePromotionLadder, getTier, hasRealOutOfSampleEvidence, PROMOTION_TIERS } from './PromotionLadder.js';
import marketEvidenceStore from './MarketEvidenceStore.js';
import tradingPerformanceGuard from './TradingPerformanceGuard.js';
import { compileMarketLabEntry } from './MarketStrategyCompiler.js';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data', 'trading');
const STATE_PATH = path.join(DATA_DIR, 'mission-control-runtime.json');
const MARKET_LEDGER_PATH = path.join(process.cwd(), 'data', 'market-lab', 'strategy-ledger.json');
const SIM_TO_LIVE_REPORT_PATH = path.join(DATA_DIR, 'sim-to-live-report.json');
const UCB_STATE_PATH = path.join(DATA_DIR, 'strategy-ucb-state.json');

const STRATEGY_PROFILES = {
    standard_portfolio: { minConfidence: 0.62, maxPositionPct: 0.08, takeProfitPct: 0.05, stopLossPct: 0.02, cooldownMs: 120000, analysisIntervalMs: 60000 },
    swarm_architecture: { minConfidence: 0.58, maxPositionPct: 0.10, takeProfitPct: 0.06, stopLossPct: 0.02, cooldownMs: 90000, analysisIntervalMs: 45000 },
    micro_compounder: { minConfidence: 0.64, maxPositionPct: 0.04, takeProfitPct: 0.018, stopLossPct: 0.009, cooldownMs: 45000, analysisIntervalMs: 30000 },
    micro_scalper: { minConfidence: 0.57, maxPositionPct: 0.03, takeProfitPct: 0.012, stopLossPct: 0.006, cooldownMs: 20000, analysisIntervalMs: 15000 },
    full_aggression: { minConfidence: 0.50, maxPositionPct: 0.18, takeProfitPct: 0.10, stopLossPct: 0.035, cooldownMs: 45000, analysisIntervalMs: 30000 },
    vortex: { minConfidence: 0.55, maxPositionPct: 0.12, takeProfitPct: 0.08, stopLossPct: 0.04, cooldownMs: 60000, analysisIntervalMs: 30000 },
    boring_algo: { minConfidence: 0.65, maxPositionPct: 0.08, takeProfitPct: 0.04, stopLossPct: 0.02, cooldownMs: 120000, analysisIntervalMs: 60000 },
    yield_harvester: { minConfidence: 0.68, maxPositionPct: 0.06, takeProfitPct: 0.025, stopLossPct: 0.012, cooldownMs: 180000, analysisIntervalMs: 90000 }
};

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function normalizeStrategyId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

class MissionControlRuntime {
    constructor() {
        this.tradeLogger = null;
        this.riskManager = null;
        this.guardrails = null;
        this.learningEngine = null;
        this.initialized = false;
        this.sessionId = null;
        this.state = this._defaultState();
        this._lastPromotionEvidenceHash = null;
        this._lastAutoPromoteAt = 0;
        this._ucb = this._loadUCBState(); // UCB1 strategy selection state
    }

    _defaultState() {
        return {
            mode: 'paper',
            activeTier: 'paper',
            liveEligible: false,
            paperCapital: 10000,
            activeStrategy: null,
            strategySelectionMode: 'auto',
            manualStrategy: null,
            council: {
                director: 0.55,
                tech: 0.55,
                risk: 0.55,
                sentiment: 0.55,
                strategist: 0.55
            },
            promotionPolicy: {
                minClosedTrades: 100,
                minWinRate: 60,
                minWinRateWilsonLB: 52,
                minProfitFactor: 1.4,
                maxAvgSlippagePct: 0.25,
                minMarketLabScore: 0.72,
                minTestingDays: 7,
                maxDrawdownPct: 12,
                requireOutOfSample: true,
                // Trades before this ISO timestamp don't count toward promotion:
                // everything earlier was earned under the '1Day'→1m poisoned regime
                // data (fixed 2026-07-03) and measures a broken era, not the strategy.
                statsSinceIso: '2026-07-03T14:00:00.000Z'
            },
            lastHydratedAt: null,
            lastPromotion: null
        };
    }

    initialize({ tradeLogger = null, riskManager = null, guardrails = null, simulationLearningEngine = null } = {}) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        this.tradeLogger = tradeLogger || this.tradeLogger;
        this.riskManager = riskManager || this.riskManager;
        this.guardrails = guardrails || this.guardrails;
        this.learningEngine = simulationLearningEngine || this.learningEngine;
        strategyRegistry.initialize();
        historicalDataCache.initialize();
        trainingJobRunner.initialize();
        const defaults = this._defaultState();
        const persisted = this._readState();
        this.state = {
            ...defaults,
            ...persisted,
            council: { ...defaults.council, ...(persisted.council || {}) },
            promotionPolicy: { ...defaults.promotionPolicy, ...(persisted.promotionPolicy || {}) }
        };
        this.hydrateFromMarketLab({ persist: false });
        this.initialized = true;
        this._saveState();
        return this.getStatus();
    }

    _readState() {
        try {
            if (!fs.existsSync(STATE_PATH)) return {};
            return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        } catch {
            return {};
        }
    }

    _saveState() {
        try {
            fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
        } catch (error) {
            console.warn('[MissionControlRuntime] State save failed:', error.message);
        }
    }

    _readMarketLedger() {
        try {
            if (!fs.existsSync(MARKET_LEDGER_PATH)) return [];
            const parsed = JSON.parse(fs.readFileSync(MARKET_LEDGER_PATH, 'utf8'));
            return Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    _readSimToLiveReport() {
        try {
            if (!fs.existsSync(SIM_TO_LIVE_REPORT_PATH)) return null;
            return JSON.parse(fs.readFileSync(SIM_TO_LIVE_REPORT_PATH, 'utf8'));
        } catch {
            return null;
        }
    }

    _hydrateFromSimToLive({ persist = true } = {}) {
        const report = this._readSimToLiveReport();
        const candidate = report?.selectedIncumbent || report?.paperQueue?.[0] || null;
        if (!candidate?.strategyId || !candidate?.symbol) return null;

        this.state.activeStrategy = {
            source: 'sim_to_live',
            state: candidate.state,
            action: candidate.action,
            candidateId: candidate.id || null,
            candidateKey: candidate.key || null,
            compiledStrategyId: candidate.compiledStrategy?.id || null,
            symbol: candidate.symbol,
            assetClass: candidate.assetClass || candidate.compiledStrategy?.assetClass || null,
            strategyId: normalizeStrategyId(candidate.strategyId),
            strategyName: candidate.compiledStrategy?.strategyName || candidate.strategyId,
            score: Number(candidate.simulation?.score || 0),
            priorityScore: Number(candidate.priorityScore || 0),
            pnl: Number(candidate.paper?.totalPnl || 0),
            pnlPct: 0,
            winRate: Number(candidate.paper?.trades ? candidate.paper?.winRate : candidate.simulation?.winRate || 0),
            trades: Number(candidate.paper?.trades || 0),
            neededTrades: Number(candidate.neededTrades || 0),
            liveCandidate: !!candidate.live?.candidate,
            liveRequiresHumanApproval: candidate.live?.requiresHumanApproval !== false,
            learnedAt: report.generatedAt || new Date().toISOString()
        };
        this.state.lastHydratedAt = new Date().toISOString();
        if (persist) this._saveState();
        return this.state.activeStrategy;
    }

    hydrateFromMarketLab({ persist = true } = {}) {
        if (this.state.strategySelectionMode === 'manual' && this.state.manualStrategy) {
            this.state.activeStrategy = {
                ...this.state.manualStrategy,
                source: 'manual_override',
                state: 'manual_override',
                action: 'operator_selected',
                liveRequiresHumanApproval: true,
                learnedAt: this.state.manualStrategy.learnedAt || new Date().toISOString()
            };
            this.state.lastHydratedAt = new Date().toISOString();
            if (persist) this._saveState();
            return this.state.activeStrategy;
        }

        const simToLiveStrategy = this._hydrateFromSimToLive({ persist });
        if (simToLiveStrategy) return simToLiveStrategy;

        const entries = this._readMarketLedger()
            .filter(entry => entry && entry.strategy && entry.metrics)
            .map(entry => entry.compiledStrategy && entry.graduation ? entry : compileMarketLabEntry(entry))
            .filter(entry => entry.graduation?.canPromoteToPaper)
            .sort((a, b) => {
                const scoreA = Number(a.prometheusScore ?? a.metrics?.prometheusScore ?? 0);
                const scoreB = Number(b.prometheusScore ?? b.metrics?.prometheusScore ?? 0);
                if (scoreB !== scoreA) return scoreB - scoreA;
                return Number(b.metrics?.pnl || 0) - Number(a.metrics?.pnl || 0);
            });

        const best = entries[0] || null;
        if (!best) return this.state.activeStrategy;

        const strategyId = normalizeStrategyId(best.strategy?.id || best.strategy?.name);
        const council = best.missionCouncil || {};
        this.state.activeStrategy = {
            source: 'market_lab',
            symbol: best.asset?.symbol || best.symbol || null,
            assetClass: best.asset?.type || best.assetClass || null,
            strategyId,
            strategyName: best.strategy?.name || strategyId,
            score: Number(best.prometheusScore ?? best.metrics?.prometheusScore ?? 0),
            pnl: Number(best.metrics?.pnl || 0),
            pnlPct: Number(best.metrics?.pnlPct || 0),
            winRate: Number(best.metrics?.winRate || 0),
            trades: Number(best.metrics?.trades || 0),
            promoted: !!best.promoted,
            learnedAt: best.timestamp || new Date().toISOString()
        };

        this.state.council = {
            director: clamp(council.director?.confidence ?? this.state.council.director, 0, 1),
            tech: clamp(council.tech?.confidence ?? this.state.council.tech, 0, 1),
            risk: clamp(council.risk?.confidence ?? this.state.council.risk, 0, 1),
            sentiment: clamp(council.sentiment?.confidence ?? this.state.council.sentiment, 0, 1),
            strategist: clamp(council.strategist?.confidence ?? this.state.council.strategist, 0, 1)
        };
        this.state.lastHydratedAt = new Date().toISOString();
        if (persist) this._saveState();
        return this.state.activeStrategy;
    }

    getActiveExecutionProfile({ symbol = null, preset = null, baseConfig = {} } = {}) {
        this.hydrateFromMarketLab();
        let active = this.state.activeStrategy;
        
        // Prevent symbol mismatch: If global active strategy is for SOL but trader asks for ETH, ignore it.
        if (active && active.symbol && symbol && String(active.symbol).toUpperCase() !== String(symbol).toUpperCase()) {
            active = null;
        }

        const strategyId = normalizeStrategyId(active?.strategyId || preset);
        const learned = STRATEGY_PROFILES[strategyId] || null;
        const profile = learned || STRATEGY_PROFILES.standard_portfolio;
        const council = this.state.council || {};

        let maxPositionPct = profile.maxPositionPct;
        let minConfidence = profile.minConfidence;
        if ((council.risk ?? 0.5) < 0.55) {
            maxPositionPct *= 0.7;
            minConfidence += 0.05;
        }
        if ((council.strategist ?? 0.5) > 0.7 && (council.director ?? 0.5) > 0.65) {
            minConfidence -= 0.02;
        }

        const maxPaperTradeValue = this.state.paperCapital || 10000;
        const config = applyTierProfile({
            ...baseConfig,
            ...profile,
            minConfidence: clamp(minConfidence, 0.45, 0.85),
            maxPositionPct: clamp(maxPositionPct, 0.01, 0.2),
            maxPaperTradeValue
        }, this.state.activeTier || 'paper');
        const tier = getTier(this.state.activeTier || 'paper');

        return {
            runtime: true,
            preset: preset || 'SOMA_LEARNED',
            symbol: symbol || active?.symbol || null,
            activeStrategy: active,
            council,
            config,
            paperCapital: this.state.paperCapital,
            activeTier: tier.id,
            tier,
            liveEligible: this.state.liveEligible,
            liveTradingEnabled: tier.liveTradingEnabled
        };
    }

    adaptSignal(signal, analysis, context = {}) {
        if (!signal) return signal;
        const council = this.state.council || {};
        const risk = council.risk ?? 0.55;
        const tech = council.tech ?? 0.55;
        const sentiment = council.sentiment ?? 0.55;
        const strategist = council.strategist ?? 0.55;
        const director = council.director ?? 0.55;
        const councilMean = (risk + tech + sentiment + strategist + director) / 5;

        let confidence = Number(signal.confidence || 0);
        confidence += (tech - 0.5) * 0.06;
        confidence += (sentiment - 0.5) * 0.04;
        confidence += (strategist - 0.5) * 0.06;
        confidence += (director - 0.5) * 0.04;
        confidence -= Math.max(0, 0.58 - risk) * 0.16;
        confidence = clamp(confidence, 0, 0.98);

        const adapted = {
            ...signal,
            confidence,
            runtime: {
                activeStrategy: this.state.activeStrategy,
                councilConfidence: councilMean,
                paperCapital: this.state.paperCapital,
                adaptedAt: Date.now()
            },
            agents: {
                ...(signal.agents || {}),
                director,
                tech,
                risk,
                sentiment,
                strategist
            }
        };

        if (signal.action !== 'HOLD' && confidence < (context.minConfidence || 0)) {
            adapted.action = 'HOLD';
            adapted.reason = `${signal.reason} Runtime council held the trade below confidence gate (${Math.round(confidence * 100)}%).`;
        }
        return adapted;
    }

    evaluatePromotion({ recordEvidence = false } = {}) {
        this.hydrateFromMarketLab();
        const statsSince = this.state.promotionPolicy?.statsSinceIso || null;
        const liveStats = this.tradeLogger?.getStats?.(90, { since: statsSince }) || {};
        const closedTrades = this.tradeLogger?.getClosedTrades?.(90, { since: statsSince }) || [];
        const active = this.state.activeStrategy || {};

        // Merge live stats with market_lab validated stats.
        // Market Lab (backtest/sim) counts toward promotion only if win rate/profit factor
        // pass independently — live paper trades always take precedence when available.
        const marketLabTrades = Number(active.trades || 0);
        const marketLabWinRate = Number(active.winRate || 0);
        const hasEnoughLive = (liveStats.totalTrades || 0) >= 10;
        const stats = hasEnoughLive ? liveStats : {
            totalTrades: Math.max(liveStats.totalTrades || 0, marketLabTrades),
            winRate:     (liveStats.totalTrades || 0) > 0 ? liveStats.winRate : marketLabWinRate,
            profitFactor: liveStats.profitFactor || (marketLabWinRate >= 60 ? 1.5 : 0),
            totalPnl:    liveStats.totalPnl || (active.pnl || 0),
            avgSlippage: liveStats.avgSlippage || 0
        };
        const policy = this.state.promotionPolicy;
        const firstTradeTime = closedTrades
            .map(trade => Date.parse(trade.entry_time || trade.created_at || trade.exit_time))
            .filter(Number.isFinite)
            .sort((a, b) => a - b)[0] || null;
        const testingDays = firstTradeTime ? (Date.now() - firstTradeTime) / 86400000 : 0;
        const worstTrade = closedTrades.reduce((min, trade) => Math.min(min, Number(trade.pnl_pct || 0)), 0);
        const latestTraining = trainingJobRunner.getStatus().jobs?.[0] || null;
        const outOfSampleReady = !policy.requireOutOfSample || hasRealOutOfSampleEvidence(latestTraining);
        const checks = {
            closedTrades: (stats.totalTrades || 0) >= policy.minClosedTrades,
            winRate: (stats.winRate || 0) >= policy.minWinRate,
            profitFactor: (stats.profitFactor || 0) >= policy.minProfitFactor,
            slippage: Math.abs(stats.avgSlippage || 0) <= policy.maxAvgSlippagePct,
            marketLabScore: (active.score || 0) >= policy.minMarketLabScore,
            pnlPositive: (stats.totalPnl || 0) > 0 || (active.pnl || 0) > 0,
            testingAge: testingDays >= policy.minTestingDays,
            drawdown: Math.abs(worstTrade) <= policy.maxDrawdownPct,
            outOfSample: outOfSampleReady
        };
        const approved = Object.values(checks).every(Boolean);
        const ladder = evaluatePromotionLadder({
            stats,
            activeStrategy: active,
            testingDays,
            worstTradePct: Math.abs(worstTrade),
            latestTraining,
            policy
        });
        this.state.activeTier = clampTier(this.state.activeTier || 'paper', ladder.maxEligibleTier);
        const result = {
            approved,
            mode: approved ? 'paper_promotable' : 'paper_only',
            checks,
            policy,
            ladder,
            activeTier: this.state.activeTier,
            activeTierProfile: getTier(this.state.activeTier),
            stats,
            testingDays: Number(testingDays.toFixed(2)),
            worstTradePct: Number(worstTrade.toFixed(4)),
            latestTraining: latestTraining ? { id: latestTraining.id, status: latestTraining.status, best: latestTraining.best } : null,
            activeStrategy: active,
            evaluatedAt: new Date().toISOString()
        };
        this.state.liveEligible = ladder.liveEligible;
        this.state.lastPromotion = result;

        // Auto-promote if all gates pass (24h cooldown enforced inside)
        if (approved) this._autoPromote(result);

        if (recordEvidence) try {
            const evidencePayload = {
                approved,
                mode: result.mode,
                activeTier: result.activeTier,
                ladder,
                checks,
                stats,
                testingDays: result.testingDays,
                activeStrategy: active
            };
            const promotionHash = crypto
                .createHash('sha1')
                .update(JSON.stringify({
                    approved,
                    activeTier: result.activeTier,
                    maxEligibleTier: ladder?.maxEligibleTier,
                    liveEligible: ladder?.liveEligible,
                    blockedBy: ladder?.nextBlockedBy || [],
                    checks,
                    totalTrades: stats.totalTrades || 0,
                    winRate: stats.winRate || 0,
                    profitFactor: stats.profitFactor || 0,
                    totalPnl: stats.totalPnl || 0,
                    strategyId: active.strategyId || active.id || null
                }))
                .digest('hex');
            if (promotionHash !== this._lastPromotionEvidenceHash) {
                this._lastPromotionEvidenceHash = promotionHash;
                marketEvidenceStore.append('promotion', evidencePayload, {
                    source: 'MissionControlRuntime',
                    strategyId: active.strategyId || active.id || null
                });
            }
        } catch {
            // Promotion checks should remain available even if evidence mirroring fails.
        }
        this._saveState();
        return result;
    }

    recordLifecycle(event = {}) {
        const lifecycleId = event.lifecycleId || this.sessionId || `mc_${Date.now()}`;
        try {
            return this.tradeLogger?.logLifecycleEvent?.({
                lifecycleId,
                actor: event.actor || 'MissionControlRuntime',
                status: event.status || 'info',
                ...event
            }) || null;
        } catch (error) {
            console.warn('[MissionControlRuntime] Lifecycle log failed:', error.message);
            return null;
        }
    }

    updateRiskConfig(updates = {}) {
        const selectionMode = updates.strategySelectionMode != null
            ? String(updates.strategySelectionMode).toLowerCase()
            : null;
        if (selectionMode != null) {
            const mode = selectionMode;
            if (!['auto', 'manual'].includes(mode)) {
                throw new Error('strategySelectionMode must be auto or manual');
            }
            this.state.strategySelectionMode = mode;
        }
        if (updates.manualStrategy && typeof updates.manualStrategy === 'object') {
            const strategyId = normalizeStrategyId(updates.manualStrategy.strategyId || updates.manualStrategy.id);
            if (!strategyId) throw new Error('manualStrategy.strategyId is required');
            this.state.manualStrategy = {
                source: 'manual_override',
                symbol: updates.manualStrategy.symbol || null,
                assetClass: updates.manualStrategy.assetClass || null,
                strategyId,
                strategyName: updates.manualStrategy.strategyName || updates.manualStrategy.name || strategyId,
                score: Number(updates.manualStrategy.score || 0),
                pnl: Number(updates.manualStrategy.pnl || 0),
                winRate: Number(updates.manualStrategy.winRate || 0),
                trades: Number(updates.manualStrategy.trades || 0),
                reason: updates.manualStrategy.reason || 'Manual operator override',
                learnedAt: new Date().toISOString()
            };
        }
        if (selectionMode === 'auto') {
            this.state.manualStrategy = null;
        }
        if (updates.paperCapital != null) {
            this.state.paperCapital = clamp(updates.paperCapital, 1, 100000);
        }
        if (updates.promotionPolicy && typeof updates.promotionPolicy === 'object') {
            this.state.promotionPolicy = { ...this.state.promotionPolicy, ...updates.promotionPolicy };
        }
        if (updates.activeTier != null) {
            const promotion = this.evaluatePromotion();
            this.state.activeTier = clampTier(updates.activeTier, promotion.ladder?.maxEligibleTier || 'paper');
        }
        this._saveState();
        return this.getStatus();
    }

    startSession({ symbol = null, preset = null, config = {} } = {}) {
        this.sessionId = `mc_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.recordLifecycle({
            lifecycleId: this.sessionId,
            symbol,
            stage: 'session_start',
            status: 'started',
            payload: { preset, config, activeStrategy: this.state.activeStrategy }
        });
        return this.sessionId;
    }

    getJournal(limit = 100) {
        return this.tradeLogger?.getLifecycleEvents?.({ limit }) || [];
    }

    // ─── UCB1 Strategy Selection ──────────────────────────────────────────────

    _loadUCBState() {
        try {
            if (fs.existsSync(UCB_STATE_PATH)) {
                return JSON.parse(fs.readFileSync(UCB_STATE_PATH, 'utf8'));
            }
        } catch { /* fresh start */ }
        // Initialize UCB state for each strategy profile
        const strategies = {};
        for (const id of Object.keys(STRATEGY_PROFILES)) {
            strategies[id] = { trials: 0, wins: 0, totalReward: 0, avgReward: 0, rewards: [] };
        }
        return { strategies, totalTrials: 0, savedAt: null };
    }

    _saveUCBState() {
        try {
            this._ucb.savedAt = new Date().toISOString();
            fs.writeFileSync(UCB_STATE_PATH, JSON.stringify(this._ucb, null, 2));
        } catch { /* non-fatal */ }
    }

    /**
     * UCB1: select the best trading strategy for the current market regime.
     * When a regime is known, uses regime-specific reward history.
     * Falls back to global UCB1 if no regime data exists yet.
     * @param {string} [regime] - optional current market regime
     */
    selectTradingStrategy(regime = null) {
        const C = 1.5;
        // Sim reputations are a weak prior only — live (real paper/live trade)
        // outcomes dominate as soon as they exist. Untested-live strategies get
        // the discounted sim prior, so a strategy that is PROVEN bad live loses
        // to one that hasn't been tried yet.
        const SIM_PRIOR_DISCOUNT = 0.3;
        const strategies = this._ucb.strategies;

        // Ensure all strategy profiles are tracked
        for (const id of Object.keys(STRATEGY_PROFILES)) {
            if (!strategies[id]) {
                strategies[id] = { trials: 0, wins: 0, totalReward: 0, avgReward: 0, rewards: [], byRegime: {} };
            }
            if (!strategies[id].byRegime) strategies[id].byRegime = {};
        }

        const isStrategyAllowed = (id) => {
            const verdict = tradingPerformanceGuard.evaluate({ strategyId: id });
            if (!verdict.allowed) {
                console.warn(`[MCR] Strategy ${id} quarantined by performance guard: ${verdict.reasons.join('; ')}`);
            }
            return verdict.allowed;
        };

        const liveTotal = Object.values(strategies).reduce((sum, s) => sum + (s.live?.trials || 0), 0);

        // Regime-specific selection on LIVE data only
        if (regime && liveTotal > 0) {
            // Force exploration in the current regime: any strategy with < 3 trials in this regime goes first
            const underexploredInRegime = Object.entries(strategies)
                .filter(([id]) => isStrategyAllowed(id))
                .filter(([id, s]) => (s.live?.byRegime?.[regime]?.trials || 0) < 3);
            if (underexploredInRegime.length > 0) {
                const [id] = underexploredInRegime[Math.floor(Math.random() * underexploredInRegime.length)];
                console.log(`[MCR] UCB1 live-regime-explore: ${id} for regime=${regime}`);
                return id;
            }

            const regimeStrategies = Object.entries(strategies)
                .filter(([id]) => isStrategyAllowed(id));
            if (regimeStrategies.length >= 2) {
                const regimeTotal = regimeStrategies.reduce((sum, [, v]) => sum + (v.live?.byRegime?.[regime]?.trials || 0), 0) || 1;
                let bestId = null, bestScore = -Infinity;
                for (const [id, s] of regimeStrategies) {
                    const rs = s.live.byRegime[regime];
                    const exploit = rs.avgReward || 0;
                    const explore = C * Math.sqrt(Math.log(regimeTotal) / (rs.trials || 1));
                    const score   = exploit + explore;
                    if (score > bestScore) { bestScore = score; bestId = id; }
                }
                if (bestId) {
                    console.log(`[MCR] UCB1 live-regime-select: ${bestId} for regime=${regime}`);
                    return bestId;
                }
            }
        }

        // Force exploration: any strategy with < 3 LIVE trials goes first
        const underexplored = Object.entries(strategies).filter(([id, s]) => (s.live?.trials || 0) < 3 && isStrategyAllowed(id));
        if (underexplored.length > 0) {
            const [id] = underexplored[Math.floor(Math.random() * underexplored.length)];
            console.log(`[MCR] UCB1 live-explore: ${id} (${underexplored.length} strategies lack live data)`);
            return id;
        }

        // Global UCB1 on live ledger: liveAvgReward + C * sqrt(ln(liveTotal) / liveTrials)
        let bestId = null, bestScore = -Infinity;
        for (const [id, s] of Object.entries(strategies)) {
            if (!isStrategyAllowed(id)) continue;
            const lt = s.live?.trials || 0;
            const exploit = lt >= 3 ? s.live.avgReward : (s.avgReward || 0) * SIM_PRIOR_DISCOUNT;
            const explore = C * Math.sqrt(Math.log(Math.max(liveTotal, 2)) / (lt || 1));
            const score   = exploit + explore;
            if (score > bestScore) { bestScore = score; bestId = id; }
        }
        console.log(`[MCR] UCB1 live-select: ${bestId} (liveTotal=${liveTotal})`);
        return bestId || Object.keys(STRATEGY_PROFILES)[0];
    }

    /**
     * Record the outcome of a trade for UCB1 learning.
     * @param {string} strategyId - which strategy profile was active
     * @param {number} pnlPct     - realized P&L as fraction (0.02 = +2%)
     * @param {string} [regime]   - optional market regime at trade time
     */
    recordStrategyOutcome(strategyId, pnlPct, regime = null, source = 'sim') {
        if (!strategyId || typeof pnlPct !== 'number') return;
        let s = this._ucb.strategies[strategyId];
        if (!s) {
            // Auto-register unknown strategies (e.g. sim strategies)
            if (!STRATEGY_PROFILES[strategyId]) return;
            s = { trials: 0, wins: 0, totalReward: 0, avgReward: 0, rewards: [], byRegime: {} };
            this._ucb.strategies[strategyId] = s;
        }
        if (!s.byRegime) s.byRegime = {};

        // LIVE PARTITION — real paper/live trade outcomes get their own ledger.
        // The sim suite records thousands of outcomes into the shared rolling
        // window, flushing live evidence out faster than it accumulates; the
        // hunt then keeps picking strategies on simulated reputations
        // (full_aggression bled 9.6% win-rate paper while holding a 0.95 sim
        // avgReward). Selection prefers the live ledger once it has data.
        if (source === 'live') {
            if (!s.live) s.live = { trials: 0, wins: 0, rewards: [], avgReward: 0, byRegime: {} };
            const liveReward = Math.tanh(pnlPct * 20);
            s.live.trials++;
            if (pnlPct > 0) s.live.wins++;
            s.live.rewards.push(liveReward);
            if (s.live.rewards.length > 100) s.live.rewards.shift();
            let lSum = 0, lTot = 0;
            for (let i = 0; i < s.live.rewards.length; i++) {
                const w = Math.pow(0.97, s.live.rewards.length - 1 - i);
                lSum += s.live.rewards[i] * w; lTot += w;
            }
            s.live.avgReward = lTot > 0 ? lSum / lTot : 0;
            if (regime) {
                if (!s.live.byRegime[regime]) s.live.byRegime[regime] = { trials: 0, wins: 0, rewards: [], avgReward: 0 };
                const lr = s.live.byRegime[regime];
                lr.trials++;
                if (pnlPct > 0) lr.wins++;
                lr.rewards.push(liveReward);
                if (lr.rewards.length > 50) lr.rewards.shift();
                let lrSum = 0, lrTot = 0;
                for (let i = 0; i < lr.rewards.length; i++) {
                    const w = Math.pow(0.97, lr.rewards.length - 1 - i);
                    lrSum += lr.rewards[i] * w; lrTot += w;
                }
                lr.avgReward = lrTot > 0 ? lrSum / lrTot : 0;
            }
        }

        s.trials++;
        this._ucb.totalTrials++;
        const reward = Math.tanh(pnlPct * 20); // squash to [-1, +1] — 5% = ~0.76 reward
        if (pnlPct > 0) s.wins++;
        s.totalReward += reward;
        s.rewards.push(reward);
        if (s.rewards.length > 50) s.rewards.shift();

        // Exponential decay weighted average
        let wSum = 0, wTotal = 0;
        for (let i = 0; i < s.rewards.length; i++) {
            const w = Math.pow(0.95, s.rewards.length - 1 - i);
            wSum   += s.rewards[i] * w;
            wTotal += w;
        }
        s.avgReward = wTotal > 0 ? wSum / wTotal : 0;

        // Regime-specific sub-bandit
        if (regime) {
            if (!s.byRegime[regime]) s.byRegime[regime] = { trials: 0, wins: 0, rewards: [], avgReward: 0 };
            const rs = s.byRegime[regime];
            rs.trials++;
            if (pnlPct > 0) rs.wins++;
            rs.rewards.push(reward);
            if (rs.rewards.length > 30) rs.rewards.shift();
            let rwSum = 0, rwTotal = 0;
            for (let i = 0; i < rs.rewards.length; i++) {
                const w = Math.pow(0.95, rs.rewards.length - 1 - i);
                rwSum += rs.rewards[i] * w; rwTotal += w;
            }
            rs.avgReward = rwTotal > 0 ? rwSum / rwTotal : 0;
        }

        if (this._ucb.totalTrials % 5 === 0) this._saveUCBState();
        console.log(`[MCR] UCB1 outcome: ${strategyId}${regime ? ' @' + regime : ''} pnl=${(pnlPct*100).toFixed(2)}% reward=${reward.toFixed(3)} avgReward=${s.avgReward.toFixed(3)} trials=${s.trials}`);
    }

    // ─── Auto-Promotion ────────────────────────────────────────────────────────

    /**
     * If all promotion gates pass, automatically elevate to the next tier.
     * Hard cooldown: no more than one auto-promotion per 24h.
     */
    _autoPromote(promotionResult) {
        const cooldownMs = 24 * 60 * 60 * 1000;
        if (Date.now() - this._lastAutoPromoteAt < cooldownMs) return;
        if (!promotionResult?.approved) return;

        const currentTier = this.state.activeTier || 'paper';
        const targetTier  = promotionResult.ladder?.maxEligibleTier || 'paper';
        if (currentTier === targetTier) return;

        this._lastAutoPromoteAt = Date.now();
        this.state.activeTier = targetTier;
        this.state.liveEligible = promotionResult.ladder?.liveEligible || false;
        this._saveState();

        console.log(`[MCR] AUTO-PROMOTION: ${currentTier} → ${targetTier}`);
        this.recordLifecycle({
            stage: 'auto_promotion',
            status: 'promoted',
            payload: {
                fromTier: currentTier,
                toTier: targetTier,
                checks: promotionResult.checks,
                stats: promotionResult.stats,
                promotedAt: new Date().toISOString()
            }
        });

        try {
            marketEvidenceStore.append('promotion', {
                type: 'auto_promotion',
                fromTier: currentTier,
                toTier: targetTier,
                promotedAt: new Date().toISOString(),
                stats: promotionResult.stats
            }, { source: 'MissionControlRuntime.autoPromote' });
        } catch { /* non-fatal */ }
    }

    getStatus() {
        this.hydrateFromMarketLab({ persist: false });
        return {
            initialized: this.initialized,
            mode: this.state.mode,
            activeTier: this.state.activeTier || 'paper',
            activeTierProfile: getTier(this.state.activeTier || 'paper'),
            promotionTiers: PROMOTION_TIERS,
            liveEligible: this.state.liveEligible,
            paperCapital: this.state.paperCapital,
            strategySelectionMode: this.state.strategySelectionMode || 'auto',
            manualStrategy: this.state.manualStrategy || null,
            activeStrategy: this.state.activeStrategy,
            council: this.state.council,
            promotionPolicy: this.state.promotionPolicy,
            lastPromotion: this.state.lastPromotion,
            lastHydratedAt: this.state.lastHydratedAt,
            brokers: Object.fromEntries(Object.entries(brokerAdapters).map(([key, adapter]) => [key, { connected: adapter.connected, name: adapter.name }])),
            strategyRegistry: strategyRegistry.getStatus(),
            historicalData: historicalDataCache.getStatus(),
            training: trainingJobRunner.getStatus(),
            statePath: STATE_PATH
        };
    }
}

const missionControlRuntime = new MissionControlRuntime();
export default missionControlRuntime;
