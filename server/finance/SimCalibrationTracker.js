/**
 * SimCalibrationTracker — measures whether the simulator tells the truth.
 *
 * The pipeline is "sim nominates → paper validates → live pays". In Jul 2026 the
 * sim predicted a 60% win rate for a candidate that delivered 24% in paper, and
 * nothing measured that gap. This tracker records predicted-vs-realized win rate
 * and profit factor for every candidate with enough paper evidence, aggregates
 * the over-promise per strategy, and exposes a discount factor that the
 * SimToLiveReconciler applies to sim priority scores. Strategies whose sim
 * scores consistently over-promise get down-weighted until the sim earns
 * back trust.
 *
 * Persisted to data/trading/sim-calibration.json.
 */

import fs from 'fs';
import path from 'path';

const STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'sim-calibration.json');
const MIN_PAPER_TRADES = 20;   // observations need real paper evidence
const MIN_OBSERVATIONS = 2;    // don't discount on a single data point

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

class SimCalibrationTracker {
    constructor(statePath = STATE_PATH) {
        this.statePath = statePath;
        this.state = { observations: {}, byStrategy: {}, updatedAt: null };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.statePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    this.state = {
                        observations: parsed.observations || {},
                        byStrategy: parsed.byStrategy || {},
                        updatedAt: parsed.updatedAt || null
                    };
                }
            }
        } catch (e) {
            console.warn('[SimCalibration] Failed to load state, starting fresh:', e.message);
        }
    }

    save() {
        try {
            this.state.updatedAt = new Date().toISOString();
            fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
        } catch (e) {
            console.warn('[SimCalibration] Failed to save state:', e.message);
        }
    }

    /**
     * Record one predicted-vs-realized observation for a candidate.
     * Skipped when paper evidence is too thin to mean anything.
     */
    observe({ key, strategyId, symbol, predicted = {}, realized = {} }) {
        const trades = finite(realized.trades, 0);
        if (!key || !strategyId || trades < MIN_PAPER_TRADES) return null;

        const predictedWinRate = finite(predicted.winRate, 0);
        const realizedWinRate = finite(realized.winRate, 0);
        const predictedPF = finite(predicted.profitFactor, 0);
        const realizedPF = Number.isFinite(Number(realized.profitFactor)) ? Number(realized.profitFactor) : 0;

        const observation = {
            key,
            strategyId,
            symbol,
            predictedWinRate,
            realizedWinRate,
            winRateGap: Number((predictedWinRate - realizedWinRate).toFixed(2)),
            predictedProfitFactor: predictedPF,
            realizedProfitFactor: realizedPF,
            paperTrades: trades,
            observedAt: new Date().toISOString()
        };
        // One live observation per candidate key; re-observing updates in place
        // (the paper stats only grow, so the newest snapshot supersedes).
        this.state.observations[key] = observation;
        this._rebuildStrategyAggregates();
        return observation;
    }

    _rebuildStrategyAggregates() {
        const byStrategy = {};
        for (const obs of Object.values(this.state.observations)) {
            const id = obs.strategyId;
            if (!byStrategy[id]) byStrategy[id] = { n: 0, winRateGapSum: 0, pfGapSum: 0 };
            byStrategy[id].n += 1;
            byStrategy[id].winRateGapSum += finite(obs.winRateGap, 0);
            byStrategy[id].pfGapSum += finite(obs.predictedProfitFactor, 0) - finite(obs.realizedProfitFactor, 0);
        }
        for (const [id, agg] of Object.entries(byStrategy)) {
            agg.meanWinRateGap = Number((agg.winRateGapSum / agg.n).toFixed(2));
            agg.meanProfitFactorGap = Number((agg.pfGapSum / agg.n).toFixed(3));
            agg.discount = this._discountFromGap(agg.meanWinRateGap, agg.n);
            delete agg.winRateGapSum;
            delete agg.pfGapSum;
        }
        this.state.byStrategy = byStrategy;
    }

    _discountFromGap(meanWinRateGap, n) {
        if (n < MIN_OBSERVATIONS) return 1;
        // A persistent over-promise shrinks trust: 10-point gap → 0.85,
        // 36-point gap (the Jul 2026 lie) → 0.46. Under-promising is not rewarded
        // above 1 — the sim's job is accuracy, not pessimism.
        const overPromise = Math.max(0, finite(meanWinRateGap, 0));
        return Number(Math.min(1, Math.max(0.25, 1 - (overPromise / 100) * 1.5)).toFixed(3));
    }

    /** Multiplier in [0.25, 1] applied to sim priority scores for this strategy. */
    discountFor(strategyId) {
        const agg = this.state.byStrategy?.[strategyId];
        if (!agg) return 1;
        return finite(agg.discount, 1) || 1;
    }

    summary() {
        return {
            observations: Object.keys(this.state.observations).length,
            byStrategy: this.state.byStrategy,
            updatedAt: this.state.updatedAt
        };
    }
}

const simCalibrationTracker = new SimCalibrationTracker();
export { SimCalibrationTracker };
export default simCalibrationTracker;
