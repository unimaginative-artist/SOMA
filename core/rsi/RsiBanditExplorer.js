/**
 * core/rsi/RsiBanditExplorer.js
 *
 * Multi-Armed Bandit Explorer for the SOMA-RSI Engine.
 * Implements the Upper Confidence Bound (UCB1) algorithm.
 * Inspired by Weco AI's AIDE² (arXiv:2609.26457):
 * Replaces greedy local optimization with principled exploration-exploitation across
 * candidate scaffolding mutation branches.
 */

import fs from 'node:fs';
import path from 'node:path';

export const RSI_MUTATION_ARMS = Object.freeze({
    SEARCH_AND_RETRY: 'search_and_retry',
    PROMPT_COMPRESSION: 'prompt_compression',
    TOOL_DISPATCH: 'tool_dispatch',
    MEMORY_INDEXING: 'memory_indexing',
    DEFENSIVE_GUARDS: 'defensive_guards',
});

export class RsiBanditExplorer {
    constructor(opts = {}) {
        this.rootPath = opts.rootPath || process.cwd();
        this.stateFile = opts.stateFile || path.join(this.rootPath, 'data', 'rsi_bandit_state.json');
        this.explorationConstant = opts.explorationConstant || Math.SQRT2; // ~1.414
        this.arms = {};
        this.totalTrials = 0;
        this._initState();
    }

    _initState() {
        try {
            const dir = path.dirname(this.stateFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            if (fs.existsSync(this.stateFile)) {
                const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.arms = data.arms || {};
                this.totalTrials = data.totalTrials || 0;
            }
        } catch {}

        // Ensure all defined arms exist in state
        for (const arm of Object.values(RSI_MUTATION_ARMS)) {
            if (!this.arms[arm]) {
                this.arms[arm] = {
                    id: arm,
                    trials: 0,
                    rewards: 0,
                    avgReward: 0,
                    lastSelected: null,
                };
            }
        }
    }

    _saveState() {
        try {
            const dir = path.dirname(this.stateFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.stateFile, JSON.stringify({
                totalTrials: this.totalTrials,
                arms: this.arms,
                updatedAt: new Date().toISOString(),
            }, null, 2));
        } catch {}
    }

    /**
     * Select the best arm according to UCB1 policy.
     * Arms with 0 trials are prioritized unconditionally (cold start guarantee).
     */
    selectArm() {
        // 1. Try any untested arms first
        for (const arm of Object.values(this.arms)) {
            if (arm.trials === 0) {
                arm.lastSelected = new Date().toISOString();
                this._saveState();
                return arm.id;
            }
        }

        // 2. Compute UCB1 for all arms: UCB1_i = avgReward_i + c * sqrt(ln(N) / n_i)
        let bestArm = null;
        let bestScore = -Infinity;

        const lnTotal = Math.log(Math.max(1, this.totalTrials));

        for (const arm of Object.values(this.arms)) {
            const exploitation = arm.avgReward;
            const exploration = this.explorationConstant * Math.sqrt(lnTotal / arm.trials);
            const ucbScore = exploitation + exploration;

            if (ucbScore > bestScore) {
                bestScore = ucbScore;
                bestArm = arm.id;
            }
        }

        const chosen = bestArm || RSI_MUTATION_ARMS.SEARCH_AND_RETRY;
        this.arms[chosen].lastSelected = new Date().toISOString();
        this._saveState();
        return chosen;
    }

    /**
     * Record the empirical reward for a selected arm.
     * @param {string} armId - The arm identifier.
     * @param {number} reward - 1.0 for empirical improvement, 0.0 for regression/rejection.
     */
    recordReward(armId, reward) {
        const cleanReward = Math.max(0, Math.min(1, Number(reward) || 0));
        const arm = this.arms[armId];
        if (!arm) return;

        arm.trials += 1;
        arm.rewards += cleanReward;
        arm.avgReward = Math.round((arm.rewards / arm.trials) * 1000) / 1000;
        this.totalTrials += 1;

        this._saveState();
        return arm;
    }

    getStats() {
        return {
            totalTrials: this.totalTrials,
            arms: Object.values(this.arms).map(a => ({
                id: a.id,
                trials: a.trials,
                rewards: a.rewards,
                winRate: a.trials > 0 ? Math.round((a.rewards / a.trials) * 100) + '%' : '0%',
                avgReward: a.avgReward,
                lastSelected: a.lastSelected,
            })),
        };
    }
}
