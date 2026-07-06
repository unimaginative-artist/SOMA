import tradeLogger from '../finance/TradeLogger.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { deriveGoalState, compileEvidencePreflight } = require('../../core/GoalLifecycle.cjs');

/**
 * Builds a [VERIFIED OPERATIONAL TRUTH] block from real measured state so
 * EVERY one of SOMA's voices (Discord, proactive, CT, command bridge) grounds
 * its trading and goal claims in the same facts.
 *
 * Two confabulation classes this kills:
 *  - quoting a strategy's SIMULATION win rate (e.g. 70% on TLT) as live results
 *  - inventing goal-completion percentages (e.g. "82%, almost done")
 *
 * Every read is defensive; a failure returns '' rather than breaking a reply.
 */
export function buildOperationalTruthBlock(system = null) {
    const lines = [];

    // Real live-paper trading performance (closed trades aggregate)
    try {
        if (tradeLogger && !tradeLogger.db) { try { tradeLogger.initialize(); } catch { /* ignore */ } }
        if (tradeLogger?.getStats) {
            const s = tradeLogger.getStats();
            if ((s?.totalTrades || 0) > 0) {
                const pf = s.profitFactor === Infinity ? 'inf' : (s.profitFactor || 0).toFixed(2);
                lines.push(
                    `Trading (REAL live-paper results — quote ONLY these, never a strategy's simulation record): ` +
                    `${(s.winRate || 0).toFixed(1)}% win rate over ${s.totalTrades} closed trades, ` +
                    `net PnL $${(s.totalPnl || 0).toFixed(2)}, profit factor ${pf}.`
                );
            } else {
                lines.push('Trading: no closed live-paper trades recorded yet.');
            }
        }
    } catch { /* non-fatal */ }

    // Real active goals with measured progress + verification state
    try {
        const planner = system?.goalPlanner || system?.goalPlannerArbiter;
        if (planner?.getActiveGoals) {
            const res = planner.getActiveGoals();
            const goals = Array.isArray(res) ? res : (res?.goals || []);
            if (goals.length > 0) {
                const formatted = goals.slice(0, 5).map(g => {
                    const state = deriveGoalState(g);
                    const profile = compileEvidencePreflight(g).profile;
                    return `"${String(g.title || 'goal').slice(0, 70)}" — ${state}, proof profile: ${profile}`;
                }).join('; ');
                lines.push(`Active goals (report progress ONLY from here, never invent a percentage): ${formatted}.`);
            } else {
                lines.push('Active goals: none currently executing.');
            }
        }
    } catch { /* non-fatal */ }

    if (lines.length === 0) return '';
    return `[VERIFIED OPERATIONAL TRUTH]\n${lines.join('\n')}\n` +
        `Do not state any trading result, goal progress, or "I built/finished X" claim that contradicts the above. ` +
        `If something is not confirmed here or in the work ledger, say you have not verified it yet.`;
}

export default { buildOperationalTruthBlock };
