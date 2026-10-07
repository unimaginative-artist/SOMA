// ═══════════════════════════════════════════════════════════════════════════
// LongHorizonPlanner.js — Vision-Level Planning (7d / 30d)
//
// GoalPlannerArbiter decomposes goals into hourly tasks.
// SOMA needs to plan at week/month level to become genuinely goal-directed.
//
// Three planning horizons:
//   IMMEDIATE  (0-24h)  → GoalPlannerArbiter owns this (unchanged)
//   TACTICAL   (1-7d)   → LongHorizonPlanner milestone tracking
//   STRATEGIC  (7-30d)  → LongHorizonPlanner vision goals
//
// Flow:
//   setVision("become better at X over 30 days")
//   → brain decomposes into weekly milestones
//   → each tick, alignGoals() ensures GoalPlanner works toward current milestone
//   → tickProgress() updates milestone completion status daily
//
// Persists to server/.soma/long_horizon.json
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const HORIZON_FILE = path.join(__dirname, '..', 'server', '.soma', 'long_horizon.json');

// Default vision if none is set
const DEFAULT_VISION = {
    description: 'Improve reasoning accuracy and task completion across all domains',
    horizon:     '30d',
    createdAt:   Date.now(),
};

export class LongHorizonPlanner {
    constructor({ system, brain } = {}) {
        this.system     = system || null;
        this.brain      = brain  || null;
        this._vision    = null;
        this._milestones = [];   // [{ id, week, description, status, createdAt, completedAt? }]
        this._lastAlign  = 0;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        try {
            await fs.mkdir(path.dirname(HORIZON_FILE), { recursive: true });
            const raw  = await fs.readFile(HORIZON_FILE, 'utf8').catch(() => '{}');
            const data = JSON.parse(raw);
            this._vision     = data.vision     || null;
            this._milestones = data.milestones || [];
        } catch {
            this._vision     = null;
            this._milestones = [];
        }

        // Set default vision if none exists
        if (!this._vision) {
            await this.setVision(DEFAULT_VISION.description, DEFAULT_VISION.horizon);
        }

        console.log(`[LongHorizonPlanner] 🔭 Ready — vision: "${(this._vision?.description || '').slice(0, 60)}" | ${this._milestones.length} milestones`);
        return this;
    }

    // ─── Set a new strategic vision ───────────────────────────────────────

    async setVision(description, horizon = '30d') {
        this._vision = {
            description,
            horizon,
            createdAt:   Date.now(),
            expiresAt:   Date.now() + this._horizonToMs(horizon),
        };
        this._milestones = [];

        // Decompose vision into milestones
        if (this.brain) {
            await this.decomposeToMilestones(this._vision);
        } else {
            // Fallback: single milestone
            this._milestones = [{
                id:          `ms_${Date.now()}`,
                week:        1,
                description: description,
                status:      'active',
                createdAt:   Date.now(),
            }];
        }

        await this._persist();
        console.log(`[LongHorizonPlanner] 🎯 Vision set: "${description.slice(0, 80)}" (${horizon})`);
        return this._vision;
    }

    // ─── Decompose a vision into weekly milestones via brain ─────────────

    async decomposeToMilestones(vision) {
        if (!this.brain) return;

        const weeks = vision.horizon === '7d' ? 1
                    : vision.horizon === '14d' ? 2
                    : vision.horizon === '30d' ? 4
                    : 4;

        const prompt = `You are SOMA's long-horizon planner. Break down this strategic vision into ${weeks} weekly milestones.

VISION: ${vision.description}
HORIZON: ${vision.horizon}

Each milestone should be:
- Measurable (you can check if it's done)
- Sequential (each one builds on the previous)
- Concrete (specific enough to create tasks from)

Return ONLY a JSON array of ${weeks} milestone objects:
[
  { "week": 1, "description": "By end of week 1: ...", "success_criteria": "..." },
  ...
]`;

        try {
            const result = await this.brain.reason(prompt, {
                localModel: true,
                systemOverride: 'You are a strategic planning system. Return clean JSON only.',
            });

            const match = (result.text || '').match(/\[[\s\S]*?\]/);
            if (!match) throw new Error('No JSON array found');

            const parsed = JSON.parse(match[0]);
            this._milestones = parsed.map((m, i) => ({
                id:              `ms_${Date.now()}_${i}`,
                week:            m.week || (i + 1),
                description:     m.description || `Milestone ${i + 1}`,
                success_criteria: m.success_criteria || '',
                status:          i === 0 ? 'active' : 'pending',
                createdAt:       Date.now(),
                completedAt:     null,
            }));

        } catch {
            // Fallback: divide vision into N equal milestones
            this._milestones = Array.from({ length: weeks }, (_, i) => ({
                id:          `ms_${Date.now()}_${i}`,
                week:        i + 1,
                description: `${vision.description} — Phase ${i + 1} of ${weeks}`,
                status:      i === 0 ? 'active' : 'pending',
                createdAt:   Date.now(),
                completedAt: null,
            }));
        }

        await this._persist();
    }

    // ─── Get what SOMA should focus on this week ─────────────────────────

    async getNextMilestone() {
        const active = this._milestones.find(m => m.status === 'active');
        if (active) return active;

        const pending = this._milestones.find(m => m.status === 'pending');
        if (pending) {
            pending.status = 'active';
            await this._persist();
            return pending;
        }

        // All milestones done — vision complete, reset with evolved vision
        if (this._milestones.length > 0 && this._milestones.every(m => m.status === 'completed')) {
            console.log('[LongHorizonPlanner] 🏆 All milestones completed — evolving vision');
            const oldVision = this._vision?.description || DEFAULT_VISION.description;
            await this.setVision(`Advanced: ${oldVision}`, '30d');
            return this._milestones[0] || null;
        }

        return null;
    }

    // ─── Daily tick — update milestone progress ───────────────────────────

    async tickProgress() {
        const active = this._milestones.find(m => m.status === 'active');
        if (!active || !this.brain) return;

        // Ask brain to evaluate whether current milestone is complete
        // based on recent GoalEngine outcomes
        const recentGoals = [];
        try {
            const gp = this.system?.goalPlanner;
            if (gp?.goals) {
                const all = [...(gp.goals.values ? gp.goals.values() : Object.values(gp.goals))];
                const recent = all
                    .filter(g => g.status === 'completed' && g.updatedAt > Date.now() - 7 * 24 * 3600_000)
                    .slice(-5)
                    .map(g => g.title);
                recentGoals.push(...recent);
            }
        } catch {}

        if (recentGoals.length === 0) return;

        const prompt = `Evaluate if this milestone has been achieved based on recent completed goals.

MILESTONE: ${active.description}
${active.success_criteria ? `SUCCESS CRITERIA: ${active.success_criteria}` : ''}

RECENT COMPLETED GOALS (last 7 days):
${recentGoals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Return ONLY JSON: {"complete": true/false, "progress": 0-100, "reasoning": "brief"}`;

        try {
            const result = await this.brain.reason(prompt, { localModel: true });
            const match = (result.text || '').match(/\{[\s\S]*?\}/);
            if (!match) return;

            const eval_ = JSON.parse(match[0]);
            active.progress = eval_.progress || active.progress || 0;

            if (eval_.complete) {
                active.status      = 'completed';
                active.completedAt = Date.now();
                console.log(`[LongHorizonPlanner] ✅ Milestone complete: "${active.description.slice(0, 60)}"`);

                // Activate the next milestone
                const next = this._milestones.find(m => m.status === 'pending');
                if (next) {
                    next.status = 'active';
                    console.log(`[LongHorizonPlanner] 🎯 Next milestone: "${next.description.slice(0, 60)}"`);
                }

                await this._persist();
            }
        } catch {}
    }

    // ─── Align GoalEngine goals to the current milestone ─────────────────

    async alignGoals() {
        const milestone = await this.getNextMilestone();
        if (!milestone || !this.system?.goalPlanner) return;

        // Only re-align once per hour max
        if (Date.now() - this._lastAlign < 60 * 60 * 1000) return;
        this._lastAlign = Date.now();

        // Check if there's already an active goal targeting this milestone
        try {
            const gp  = this.system.goalPlanner;
            const all = gp.goals ? [...(gp.goals.values ? gp.goals.values() : Object.values(gp.goals))] : [];
            const exists = all.some(g =>
                g.status !== 'completed' &&
                (g.metadata?.milestoneId === milestone.id || g.title?.includes(milestone.description.slice(0, 40)))
            );

            if (!exists) {
                await gp.createGoal({
                    type:        'strategic',
                    category:    'long_horizon',
                    title:       `Milestone: ${milestone.description.slice(0, 80)}`,
                    description: milestone.description + (milestone.success_criteria ? `\n\nSuccess criteria: ${milestone.success_criteria}` : ''),
                    priority:    60,
                    confidence:  0.8,
                    rationale:   `Long-horizon vision alignment (Week ${milestone.week})`,
                    metadata:    { milestoneId: milestone.id, source: 'LongHorizonPlanner' },
                }).catch(() => {});
                console.log(`[LongHorizonPlanner] 🔗 Aligned GoalEngine to milestone: "${milestone.description.slice(0, 60)}"`);

                // Fire execution — GoalPlannerArbiter only plans, so also route to SOMA's
                // execution brain (QuadBrain ReAct loop) to actually work toward the milestone.
                const executor = this.system?.quadBrain || this.brain;
                if (executor) {
                    const execPrompt = `You are executing a strategic milestone as an autonomous agent. Use available tools to make concrete progress.\n\nMILESTONE: ${milestone.description}${milestone.success_criteria ? `\n\nSUCCESS CRITERIA: ${milestone.success_criteria}` : ''}\n\nBreak this into actionable steps and execute them now using your tools.`;
                    executor.reason(execPrompt, {
                        isAgenticTask:   true,
                        forceComplexity: true,
                        source:          'LongHorizonPlanner',
                        milestoneId:     milestone.id,
                    }).catch(err => console.warn('[LongHorizonPlanner] ⚠️  Execution trigger failed:', err.message));
                }
            }
        } catch {}
    }

    // ─── Inspect ──────────────────────────────────────────────────────────

    getStatus() {
        const active     = this._milestones.find(m => m.status === 'active');
        const completed  = this._milestones.filter(m => m.status === 'completed').length;
        const total      = this._milestones.length;
        const progress   = total > 0 ? Math.round((completed / total) * 100) : 0;

        return {
            vision:      this._vision?.description || null,
            horizon:     this._vision?.horizon || null,
            milestones:  { total, completed, active: active?.description?.slice(0, 80) || null },
            progress,
            expiresAt:   this._vision?.expiresAt || null,
        };
    }

    // ─── Utilities ────────────────────────────────────────────────────────

    _horizonToMs(horizon) {
        const map = { '7d': 7, '14d': 14, '30d': 30, '60d': 60, '90d': 90 };
        return (map[horizon] || 30) * 24 * 3600_000;
    }

    async _persist() {
        try {
            await fs.writeFile(HORIZON_FILE, JSON.stringify({
                vision:     this._vision,
                milestones: this._milestones,
            }, null, 2));
        } catch { /* non-fatal */ }
    }
}
