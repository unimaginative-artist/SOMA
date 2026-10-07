/**
 * ABTestFramework — Parallel Strategy Parameter Testing
 *
 * Runs two arms simultaneously against live market data:
 *   CONTROL  — current champion parameters
 *   CHALLENGER — perturbed variant looking for a better edge
 *
 * Assignment: new trades alternate arms. After MIN_TRIALS_PER_ARM closed trades
 * on each arm, runs a 2-proportion z-test (p < 0.05).
 *   Challenger wins → challenger params become new control, generate new challenger
 *   Challenger loses/ties → discard challenger, generate fresh variant
 *
 * After MAX_ARM_TRADES total, auto-reset regardless of result to prevent arm lock.
 *
 * Parameters mutated per challenger generation (bounded):
 *   rsiOversold             [20, 40]  ±3
 *   requiredSignals         [1, 4]    ±1
 *   stopLossATRMultiplier   [0.5, 3]  ±0.25
 *   minProfitTarget         [0.01, 0.20] ±0.015
 *   cooldownMs              [1000, 15000] ±1000
 *
 * All decisions are logged to TradeLogger learning_events.
 */

import tradeLogger from './TradeLogger.js';
import scalpingEngine from './scalpingEngine.js';
import fs from 'fs';
import path from 'path';

const STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'abtest-state.json');
const MIN_TRIALS_PER_ARM = 30;
const MAX_ARM_TRADES = 200;
const SIGNIFICANCE_LEVEL = 0.05;

const PARAM_BOUNDS = {
    rsiOversold:           { min: 20,   max: 40,    step: 3 },
    requiredSignals:       { min: 1,    max: 4,     step: 1, integer: true },
    stopLossATRMultiplier: { min: 0.5,  max: 3.0,   step: 0.25 },
    minProfitTarget:       { min: 0.01, max: 0.20,  step: 0.015 },
    cooldownMs:            { min: 1000, max: 15000, step: 1000, integer: true }
};

class ABTestFramework {
    constructor() {
        this.state = {
            testId: null,
            totalTestsRun: 0,
            promotions: 0,
            control: {
                params: null,
                trades: [],     // [{tradeId, won, pnlPct}]
                wins: 0,
                total: 0
            },
            challenger: {
                params: null,
                trades: [],
                wins: 0,
                total: 0
            },
            nextArm: 'control',  // alternating assignment
            decisions: [],       // last 20 test decisions
            lastDecidedAt: null
        };
        this._loadState();
        this._ensureArms();
    }

    /**
     * Called by autonomousTrader on trade open — returns which arm this trade should use.
     * The caller applies the returned params snapshot before entering position.
     */
    assignArm() {
        const arm = this.state.nextArm;
        this.state.nextArm = arm === 'control' ? 'challenger' : 'control';
        return {
            arm,
            params: { ...this.state[arm].params }
        };
    }

    /**
     * Record a closed trade outcome for an arm.
     * @param {string} arm - 'control' | 'challenger'
     * @param {string} tradeId
     * @param {number} pnlPct - raw % (e.g. 1.2 for +1.2%)
     */
    recordOutcome(arm, tradeId, pnlPct) {
        if (arm !== 'control' && arm !== 'challenger') return;
        const entry = this.state[arm];
        const won = pnlPct > 0;
        entry.trades.push({ tradeId, won, pnlPct });
        if (won) entry.wins++;
        entry.total++;
        if (entry.trades.length > MAX_ARM_TRADES) {
            const removed = entry.trades.shift();
            if (removed.won) entry.wins = Math.max(0, entry.wins - 1);
            entry.total = entry.trades.length;
        }

        // Check if we have enough to decide
        const c = this.state.control;
        const ch = this.state.challenger;
        if (c.total >= MIN_TRIALS_PER_ARM && ch.total >= MIN_TRIALS_PER_ARM) {
            this._evaluateTest();
        }

        // Force reset if max arm trades reached
        if (c.total >= MAX_ARM_TRADES || ch.total >= MAX_ARM_TRADES) {
            this._evaluateTest(true);
        }

        this._saveState();
    }

    _evaluateTest(forced = false) {
        const c = this.state.control;
        const ch = this.state.challenger;

        const controlWR = c.total > 0 ? c.wins / c.total : 0;
        const challengerWR = ch.total > 0 ? ch.wins / ch.total : 0;
        const pValue = this._proportionZTest(c.wins, c.total, ch.wins, ch.total);

        const challengerWins = challengerWR > controlWR && pValue < SIGNIFICANCE_LEVEL;
        const verdict = challengerWins ? 'CHALLENGER_PROMOTED' : (forced ? 'FORCED_RESET' : 'CONTROL_RETAINED');

        const msg = `A/B Test ${this.state.testId}: Control WR=${(controlWR * 100).toFixed(1)}% (n=${c.total}), Challenger WR=${(challengerWR * 100).toFixed(1)}% (n=${ch.total}), p=${pValue.toFixed(3)} → ${verdict}`;
        console.log(`[ABTest] ${msg}`);

        if (challengerWins) {
            // Promote challenger to control, apply params to scalpingEngine
            this._applyParams(ch.params);
            this.state.control.params = { ...ch.params };
            this.state.promotions++;

            tradeLogger.logLearningEvent({
                eventType: 'AB_PROMOTION',
                description: msg,
                strategy: 'ab_test',
                metricName: 'winRateDelta',
                oldValue: parseFloat((controlWR * 100).toFixed(2)),
                newValue: parseFloat((challengerWR * 100).toFixed(2)),
                triggerReason: this.state.testId
            });
        } else {
            tradeLogger.logLearningEvent({
                eventType: 'AB_RESULT',
                description: msg,
                strategy: 'ab_test',
                metricName: 'pValue',
                oldValue: parseFloat((controlWR * 100).toFixed(2)),
                newValue: parseFloat((challengerWR * 100).toFixed(2)),
                triggerReason: this.state.testId
            });
        }

        this.state.decisions.unshift({
            testId: this.state.testId,
            verdict,
            controlWR: parseFloat((controlWR * 100).toFixed(2)),
            challengerWR: parseFloat((challengerWR * 100).toFixed(2)),
            pValue: parseFloat(pValue.toFixed(4)),
            decidedAt: new Date().toISOString()
        });
        if (this.state.decisions.length > 20) this.state.decisions = this.state.decisions.slice(0, 20);

        this.state.lastDecidedAt = new Date().toISOString();
        this.state.totalTestsRun++;

        // Reset arms for next round
        this._resetArms();
        this._saveState();
    }

    _resetArms() {
        this.state.control.trades = [];
        this.state.control.wins = 0;
        this.state.control.total = 0;
        this.state.challenger.params = this._generateChallenger(this.state.control.params);
        this.state.challenger.trades = [];
        this.state.challenger.wins = 0;
        this.state.challenger.total = 0;
        this.state.nextArm = 'control';
        this.state.testId = `ab_${Date.now()}`;
    }

    _generateChallenger(baseParams) {
        const config = baseParams || { ...scalpingEngine.config };
        const challenger = { ...config };

        // Pick 1-3 parameters to mutate this round
        const keys = Object.keys(PARAM_BOUNDS);
        const numMutations = 1 + Math.floor(Math.random() * Math.min(3, keys.length));
        const shuffled = keys.sort(() => Math.random() - 0.5).slice(0, numMutations);

        for (const key of shuffled) {
            const b = PARAM_BOUNDS[key];
            const dir = Math.random() < 0.5 ? 1 : -1;
            let newVal = (config[key] || 0) + dir * b.step;
            newVal = Math.max(b.min, Math.min(b.max, newVal));
            if (b.integer) newVal = Math.round(newVal);
            challenger[key] = parseFloat(newVal.toFixed(b.integer ? 0 : 3));
        }

        console.log(`[ABTest] Generated challenger: ${JSON.stringify(
            Object.fromEntries(shuffled.map(k => [k, challenger[k]]))
        )}`);

        return challenger;
    }

    _applyParams(params) {
        const config = scalpingEngine.config;
        for (const [key, bounds] of Object.entries(PARAM_BOUNDS)) {
            if (params[key] !== undefined) {
                const val = Math.max(bounds.min, Math.min(bounds.max, params[key]));
                config[key] = bounds.integer ? Math.round(val) : parseFloat(val.toFixed(3));
            }
        }
        console.log('[ABTest] Applied promoted params to scalpingEngine');
    }

    _ensureArms() {
        // On startup, initialize from current scalpingEngine config if no saved state
        if (!this.state.control.params) {
            this.state.control.params = { ...scalpingEngine.config };
        }
        if (!this.state.challenger.params) {
            this.state.challenger.params = this._generateChallenger(this.state.control.params);
        }
        if (!this.state.testId) {
            this.state.testId = `ab_${Date.now()}`;
        }
    }

    /**
     * 2-proportion z-test (one-tailed: challenger > control)
     * Returns p-value.
     */
    _proportionZTest(wins1, n1, wins2, n2) {
        if (n1 < 5 || n2 < 5) return 1.0;
        const p1 = wins1 / n1;
        const p2 = wins2 / n2;
        const pPool = (wins1 + wins2) / (n1 + n2);
        const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
        if (se === 0) return p2 > p1 ? 0.001 : 1.0;
        const z = (p2 - p1) / se;
        // One-tailed p-value using normal CDF approximation
        return 1 - this._normalCDF(z);
    }

    _normalCDF(z) {
        // Abramowitz & Stegun approximation
        const t = 1 / (1 + 0.2316419 * Math.abs(z));
        const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
        const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
        const p = 1 - phi * poly;
        return z >= 0 ? p : 1 - p;
    }

    getState() {
        const c = this.state.control;
        const ch = this.state.challenger;
        return {
            testId: this.state.testId,
            totalTestsRun: this.state.totalTestsRun,
            promotions: this.state.promotions,
            minTrialsPerArm: MIN_TRIALS_PER_ARM,
            maxArmTrades: MAX_ARM_TRADES,
            control: {
                params: c.params,
                wins: c.wins,
                total: c.total,
                winRate: c.total > 0 ? parseFloat(((c.wins / c.total) * 100).toFixed(1)) : null
            },
            challenger: {
                params: ch.params,
                wins: ch.wins,
                total: ch.total,
                winRate: ch.total > 0 ? parseFloat(((ch.wins / ch.total) * 100).toFixed(1)) : null
            },
            nextArm: this.state.nextArm,
            trialsUntilDecision: Math.max(0, MIN_TRIALS_PER_ARM - Math.min(c.total, ch.total)),
            decisions: this.state.decisions,
            lastDecidedAt: this.state.lastDecidedAt
        };
    }

    /** Force evaluate now (for API testing) */
    forceEvaluate() {
        if (this.state.control.total >= 5 && this.state.challenger.total >= 5) {
            this._evaluateTest(true);
        }
        return this.getState();
    }

    _loadState() {
        try {
            if (fs.existsSync(STATE_PATH)) {
                const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
                this.state = { ...this.state, ...saved };
            }
        } catch { /* fresh start */ }
    }

    _saveState() {
        try {
            const dir = path.dirname(STATE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.warn('[ABTest] State save failed:', err.message);
        }
    }
}

const abTestFramework = new ABTestFramework();
export default abTestFramework;
