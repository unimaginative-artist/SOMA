/**
 * daemons/GoalExecutorDaemon.js
 *
 * Closes the loop between goal creation and goal execution.
 * Every 5 minutes: picks the highest-priority pending goal, dispatches
 * it to the right arbiter or brain, stores results to memory, marks done.
 *
 * Safety rules:
 * - Only one goal executes at a time (no thrashing)
 * - Engineering swarm writes are NOT triggered from here (read-only analysis only)
 * - Goals with _executorSkip=true in metadata are skipped
 * - Brain calls use __SOMA_FINANCE_ANALYSIS flag for internal tasks
 */

import { BaseDaemon } from './BaseDaemon.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const workLedger = require('../core/AutonomousWorkLedger.cjs');
const { isHumanGoal } = require('../core/GoalLifecycle.cjs');

const RESEARCH_CATEGORIES = new Set([
    'learning', 'research', 'knowledge_synthesis', 'github_discovery',
    'task', 'self_evolution', 'nutrient_synthesis', 'integration'
]);
const ANALYSIS_CATEGORIES = new Set([
    'improvement', 'self_repair', 'self_improvement', 'capability'
]);
const AUDIT_CATEGORIES    = new Set(['audit', 'financial']);

const MAX_RETRIES = 3;

export class GoalExecutorDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({ name: 'GoalExecutorDaemon', intervalMs: 5 * 60_000, ...config });
        this.system      = config.system;
        this._executing  = false;
        this._retryMap   = new Map(); // goalId → attempt count
    }

    async tick() {
        if (this._executing) return;
        if (this.system?.autonomousHeartbeat?.isRunning) return;

        const goal = this._pickGoal();
        if (!goal) return;

        this._executing = true;
        try {
            await this._execute(goal);
        } catch (e) {
            this.logger.warn(`[GoalExecutorDaemon] Goal "${goal.title}" failed:`, e.message);
            await this._failGoal(goal, e.message);
        } finally {
            this._executing = false;
        }
    }

    _pickGoal() {
        const planner = this.system?.goalPlanner;
        if (!planner?.goals) return null;

        let best = null;
        for (const [, goal] of planner.goals) {
            if (goal.status !== 'pending' && goal.status !== 'proposed') continue;
            if (goal.metadata?._executorSkip) continue;
            if ((this._retryMap.get(goal.id) || 0) >= MAX_RETRIES) continue;
            const score = (goal.priority || 0) + (isHumanGoal(goal) ? 100 : 0);
            const bestScore = best ? (best.priority || 0) + (isHumanGoal(best) ? 100 : 0) : -Infinity;
            if (!best || score > bestScore) best = goal;
        }
        return best;
    }

    async _execute(goal) {
        const planner  = this.system?.goalPlanner;
        const brain    = this.system?.quadBrain;
        const memory   = this.system?.mnemonicArbiter;
        const category = (goal.category || 'research').toLowerCase();

        this.logger.info(`[GoalExecutorDaemon] → "${goal.title}" [${category}] priority=${goal.priority}`);

        // Activate the goal
        if (planner?.approveGoal) await planner.approveGoal(goal.id).catch(() => { goal.status = 'active'; });
        else goal.status = 'active';

        this._activity('goal_started', goal.title, `${category} / priority ${goal.priority}`);
        workLedger.record({
            type: 'goal_started',
            title: goal.title,
            summary: `Started ${category} goal with priority ${goal.priority}`,
            evidence: { goalId: goal.id, category, priority: goal.priority },
            nextStep: 'Execute and verify goal result',
            status: 'active',
            source: 'GoalExecutorDaemon',
        });

        let result;

        // ── Audit goals ─────────────────────────────────────────────────────
        if (AUDIT_CATEGORIES.has(category) && this.system?.concieveArbiter?._engineReady) {
            const target = goal.metadata?.targetPath
                || process.env.CONCIEVE_SHARED_PATH
                || './shared_office_data';
            this.system.concieveArbiter.runMission(target).catch(() => {});
            result = `Audit mission started → ${target}`;

        // ── Research / analysis / task goals (brain) ────────────────────────
        } else if (brain) {
            const prompt = this._buildPrompt(goal);

            // Internal tasks stay local via Sovereign gate
            global.__SOMA_FINANCE_ANALYSIS = ANALYSIS_CATEGORIES.has(category);
            try {
                const response = await brain.reason(prompt, {
                    quickResponse: false,
                    source:        'goal_executor',
                    timeout:       90_000
                });
                result = response?.text || response?.response || '(no output)';
            } finally {
                global.__SOMA_FINANCE_ANALYSIS = false;
            }

            // Store result to memory
            if (memory?.remember) {
                await memory.remember(
                    `[Goal Result: ${goal.title}]\n${result.substring(0, 600)}`,
                    { type: 'goal_result', importance: 0.75, goalId: goal.id }
                ).catch(() => {});
            }

        } else {
            // No brain available — defer
            if (planner?.deferGoal) await planner.deferGoal(goal.id, 'no_brain').catch(() => {});
            else goal.status = 'pending';
            this.logger.warn('[GoalExecutorDaemon] No brain available — goal deferred');
            return;
        }

        // ── Complete ────────────────────────────────────────────────────────
        if (planner?.completeGoal) {
            const completion = await planner.completeGoal(goal.id, {
                result:      result.substring(0, 300),
                completedBy: 'GoalExecutorDaemon',
                summary:     result.substring(0, 600),
                evidence:    {
                    [`GoalExecutorDaemon result for ${goal.title}`]: true
                }
            });
            if (!completion?.success) {
                throw new Error(completion?.error || 'Goal completion verification failed');
            }
        } else {
            goal.status = 'completed';
        }

        const snippet = result.substring(0, 200).replace(/\n/g, ' ');

        // Update working memory with what SOMA just accomplished
        const wm = this.system?.workingMemory;
        wm?.addAction(`Completed goal: ${goal.title}`, snippet);
        wm?.addDiscovery(goal.title, snippet, 'goal_execution');
        if (category !== 'task') wm?.setPreoccupation(`Just finished: ${goal.title}`);

        this._activity('goal_completed', goal.title, snippet);
        workLedger.record({
            type: 'goal_completed',
            title: goal.title,
            summary: snippet,
            evidence: { goalId: goal.id, verifier: 'GoalPlannerArbiter' },
            nextStep: category === 'task' ? 'Monitor for follow-up work' : 'Promote useful findings into memory or a new goal',
            status: 'verified',
            source: 'GoalExecutorDaemon',
        });
        this.emitSignal('soma.activity', {
            type:      'goal_completed',
            title:     `Goal complete: ${goal.title}`,
            summary:   snippet,
            timestamp: Date.now(),
            source:    'GoalExecutorDaemon'
        });

        this.logger.info(`[GoalExecutorDaemon] ✅ "${goal.title}" complete`);
    }

    _buildPrompt(goal) {
        const cat = (goal.category || 'research').toLowerCase();

        const intros = {
            learning:             'You are SOMA\'s learning engine. Research this topic and return structured key findings.',
            research:             'You are SOMA\'s research engine. Investigate thoroughly and return a structured analysis.',
            task:                 'You are SOMA\'s task executor. Complete this task and report what you did.',
            improvement:          'You are SOMA\'s self-analysis engine. Analyse this improvement opportunity (read-only, no code changes). Report concrete findings.',
            self_improvement:     'Analyse this self-improvement opportunity. Identify the root cause and propose 3 concrete steps.',
            capability:           'Analyse this capability gap. What specifically is missing and what\'s the simplest path to closing it?',
            self_repair:          'Analyse this system issue. Identify the root cause and describe the precise fix needed.',
            knowledge_synthesis:  'Synthesize knowledge on this topic. Find non-obvious connections and generate a novel insight.',
            github_discovery:     'Evaluate this technology/library for SOMA integration. Focus on: fit, complexity, value.',
            nutrient_synthesis:   'Generate a high-signal cognitive nutrient (knowledge fragment) on the specified topic.',
            integration:          'Plan and describe the integration steps for this system or capability.',
        };

        const intro = intros[cat] || 'You are SOMA\'s autonomous execution engine. Work on the following goal:';

        return `${intro}

GOAL: ${goal.title}

${goal.description ? `DESCRIPTION:\n${goal.description.substring(0, 1000)}` : ''}

${goal.rationale ? `RATIONALE: ${goal.rationale}` : ''}

INSTRUCTIONS:
- Be specific and concrete — no vague answers
- Identify the 3 most important takeaways or action items
- If follow-up work is needed, describe it precisely
- Keep your response under 600 words

Your findings:`;
    }

    async _failGoal(goal, reason) {
        const attempts = (this._retryMap.get(goal.id) || 0) + 1;
        this._retryMap.set(goal.id, attempts);

        const permanent = attempts >= MAX_RETRIES;
        const planner   = this.system?.goalPlanner;

        if (permanent) {
            const finalReason = `${reason} (failed ${attempts}× — giving up)`;
            if (planner?.failGoal) {
                await planner.failGoal(goal.id, finalReason).catch(() => { goal.status = 'failed'; });
            } else {
                goal.status = 'failed';
                if (goal.metadata) goal.metadata.failureReason = finalReason;
            }
            this._retryMap.delete(goal.id); // clean up
            this.logger.warn(`[GoalExecutorDaemon] ❌ "${goal.title}" permanently failed after ${attempts} attempts`);
        } else {
            // Reset to pending for retry on next tick
            goal.status = 'pending';
            if (goal.metadata) goal.metadata.lastFailure = reason;
            this.logger.warn(`[GoalExecutorDaemon] ⚠️ "${goal.title}" attempt ${attempts}/${MAX_RETRIES} — will retry`);
        }

        this._activity('goal_failed', goal.title, `${reason} (attempt ${attempts}/${MAX_RETRIES})`);
        workLedger.record({
            type: 'goal_failed',
            title: goal.title,
            summary: String(reason).slice(0, 400),
            evidence: { goalId: goal.id, attempts },
            nextStep: permanent ? 'Needs human review or a revised goal' : 'Retry goal execution',
            status: permanent ? 'failed' : 'retrying',
            source: 'GoalExecutorDaemon',
        });
        if (permanent) {
            this.emitSignal('soma.activity', {
                type:      'goal_failed',
                title:     `Goal failed: ${goal.title}`,
                summary:   reason,
                timestamp: Date.now(),
                source:    'GoalExecutorDaemon'
            });
        }
    }

    _activity(type, title, summary) {
        if (!this.system) return;
        if (!this.system.activityFeed) this.system.activityFeed = [];
        this.system.activityFeed.unshift({
            type, title, summary: String(summary).substring(0, 300),
            timestamp: Date.now(), source: 'GoalExecutorDaemon'
        });
        if (this.system.activityFeed.length > 100) this.system.activityFeed.length = 100;
    }
}

export default GoalExecutorDaemon;
