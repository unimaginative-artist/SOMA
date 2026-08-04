// ═══════════════════════════════════════════════════════════════════════════
// ASIKernel.js — The Intelligence Explosion Loop
//
// This is the master orchestrator that closes the recursive self-improvement
// cycle. It coordinates all existing SOMA systems into a compound loop:
//
//   MEASURE  (CapabilityBenchmark)
//     ↓
//   IDENTIFY BOTTLENECK  (MetaCortexArbiter + benchmark comparison)
//     ↓
//   FIND CHEAPEST WIN  (TransferSynthesizer — cross-domain patterns first)
//     ↓
//   GENERATE IMPROVEMENT GOAL  (SelfEvolvingGoalEngine / GoalPlannerArbiter)
//     ↓
//   EXECUTE  (EngineeringSwarmArbiter + SomaAgenticExecutor)
//     ↓
//   VERIFY  (CapabilityBenchmark before/after comparison)
//     ↓
//   COMMIT or ROLLBACK  (ConstitutionalCore gate)
//     ↓
//   REPEAT (faster each cycle as velocity grows)
//
// Each cycle makes the next cycle faster. That's the intelligence explosion.
// Emits 'improvement' events for dashboard / frontend consumption.
// Persists cycle history to server/.soma/asi_cycles.json
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { writeMonologue } = require('./InternalMonologue.cjs');

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const CYCLES_FILE  = path.join(__dirname, '..', 'server', '.soma', 'asi_cycles.json');
const MAX_CYCLES   = 50;

export class ASIKernel extends EventEmitter {
    constructor({ system, orphanGraceMs } = {}) {
        super();
        this.system   = system || {};
        this._busy    = false;
        this._cycles  = [];   // history of completed improvement cycles
        this._running = false;
        this._reconcileTimer = null;
        const configuredGrace = Number(orphanGraceMs ?? process.env.SOMA_ASI_ORPHAN_GRACE_MS);
        this._orphanGraceMs = Number.isFinite(configuredGrace) ? Math.max(0, configuredGrace) : 5 * 60_000;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        let migrated = false;
        try {
            await fs.mkdir(path.dirname(CYCLES_FILE), { recursive: true });
            const raw = await fs.readFile(CYCLES_FILE, 'utf8').catch(() => '[]');
            this._cycles = JSON.parse(raw);
            if (!Array.isArray(this._cycles)) this._cycles = [];
            for (const legacy of this._cycles) {
                if (legacy.result === 'ok' && !legacy.phases?.verify?.comparison) {
                    legacy.result = 'legacy_unverified';
                    legacy.migrationNote = 'Historical cycle claimed success without a linked verified goal and before/after evidence.';
                    migrated = true;
                }
            }
        } catch {
            this._cycles = [];
        }

        this._running = true;
        if (migrated) await this._persist();
        this._reconcileTimer = setInterval(() => {
            this.reconcilePendingCycles().catch(error => console.warn(`[ASIKernel] Reconciliation failed: ${error.message}`));
        }, Math.max(30_000, Number(process.env.SOMA_ASI_RECONCILE_MS || 60_000)));
        this._reconcileTimer.unref?.();
        await this.reconcilePendingCycles().catch(() => {});
        const velocity = this.getVelocity();
        console.log(`[ASIKernel] 🧠 Online — ${this._cycles.length} cycles completed | velocity: ${velocity > 0 ? '+' : ''}${velocity}`);
        return this;
    }

    // ─── Main improvement cycle ───────────────────────────────────────────

    async runCycle() {
        if (this._busy || !this._running) return null;
        // Resolve terminal and orphaned work before allowing an old receipt to
        // block the only authoritative improvement loop.
        await this.reconcilePendingCycles();
        const pending = this._cycles.find(item => item.result === 'pending_execution');
        if (pending) return { ...pending, skipped: true, reason: 'A prior improvement goal is still unresolved' };
        this._busy = true;

        const cycleStart = Date.now();
        const cycle = {
            id:         `cycle_${Date.now()}`,
            startedAt:  new Date().toISOString(),
            phases:     {},
            result:     null,
            durationMs: 0,
        };

        try {
            console.log('[ASIKernel] ⚡ Starting improvement cycle...');
            writeMonologue('Initiating self-improvement cycle. Analyzing current capability benchmarks to identify operational bottlenecks.', 'ASIKernel');

            // ── Phase 1: Measure current state ──────────────────────────
            const benchmark = this.system.benchmark;
            const goalPlanner = this.system.goalPlanner;
            const constitutional = this.system.constitutional || this.system.constitutionalCore;
            const missing = [
                !benchmark && 'benchmark',
                !goalPlanner?.createGoal && 'goalPlanner',
                !constitutional?.check && 'constitutional'
            ].filter(Boolean);
            if (missing.length) {
                cycle.result = 'blocked_missing_dependencies';
                cycle.error = `Missing required dependencies: ${missing.join(', ')}`;
                cycle.phases.preflight = { passed: false, missing };
                return this._finalize(cycle, cycleStart);
            }
            cycle.phases.preflight = { passed: true };
            let before = null;
            before = await benchmark.snapshot();
            cycle.phases.measure = { baseline: before };
            console.log(`[ASIKernel] 📊 Baseline: ${(before.composite * 100).toFixed(1)}%`);

            // ── Phase 2: Check long-horizon alignment ───────────────────
            const horizon   = this.system.longHorizon;
            let milestone   = null;
            if (horizon) {
                milestone = await horizon.getNextMilestone().catch(() => null);
                if (milestone) {
                    console.log(`[ASIKernel] 🔭 Active milestone: "${milestone.description.slice(0, 60)}"`);
                    cycle.phases.vision = { milestone: milestone.description.slice(0, 100) };
                }
            }

            // ── Phase 3: Try cross-domain transfer (cheapest win first) ─
            const transfer  = this.system.transfer;
            let xferCount   = 0;
            if (transfer) {
                xferCount = await transfer.synthesizeCross().catch(() => 0);
                if (xferCount > 0) {
                    console.log(`[ASIKernel] 🔀 ${xferCount} cross-domain transfer(s) synthesized`);
                    cycle.phases.transfer = { count: xferCount };
                }
            }

            // ── Phase 4: Identify the biggest bottleneck ─────────────────
            let preparation = null;
            if (this.system.selfEvolutionDirector) {
                preparation = await this.system.selfEvolutionDirector.prepareCycle({
                    operationalBaseline: before,
                    milestone,
                });
            }
            const target = preparation?.target || await this._identifyBottleneck(before, milestone);
            cycle.phases.identify = target;
            if (preparation) {
                cycle.phases.scoreboard = {
                    baseline: preparation.baseline,
                    repeatedFailures: preparation.repeatedFailures,
                };
            }
            console.log(`[ASIKernel] 🎯 Improvement target: ${target.dimension} (score: ${(target.score * 100).toFixed(1)}%)`);
            writeMonologue(`Bottleneck identified: ${target.dimension} is currently at ${(target.score * 100).toFixed(1)}%. Devising improvement strategies.`, 'ASIKernel');

            // ── Phase 5: Generate an improvement goal ────────────────────
            const goal = await this._generateGoal(target, milestone, cycle.id, preparation);
            if (goal) {
                cycle.phases.goal = { title: goal.title };
                console.log(`[ASIKernel] 📋 Goal created: "${goal.title}"`);
                writeMonologue(`Self-improvement goal created: "${goal.title}". Delegating execution to AutonomousHeartbeat.`, 'ASIKernel');
            }

            // ── Phase 6: Constitutional check before executing ───────────
            if (constitutional && goal) {
                const check = await constitutional.check({
                    description: goal.title + ' ' + (goal.description || ''),
                    type:        'asi_improvement',
                });
                cycle.phases.constitutional = { ok: check.ok, violations: check.violations };
                if (!check.ok) {
                    console.warn(`[ASIKernel] ❌ Constitutional block: ${check.violations.join(', ')}`);
                    cycle.result = 'blocked';
                    this.emit('blocked', { cycle, check });
                    return this._finalize(cycle, cycleStart);
                }
            }

            // ── Phase 7: Let the goal execute (via GoalPlanner/Heartbeat) ─
            // We don't execute synchronously — we create the goal and let
            // the AutonomousHeartbeat pick it up in the next tick. This avoids
            // blocking the kernel and keeps execution non-blocking.
            if (!goal?.id) {
                cycle.result = 'failed_to_queue';
                const rejection = this._lastGoalRejection;
                cycle.error = rejection
                    ? `Goal rejected by planner: ${rejection.reason}`
                    : 'Goal planner did not return a persisted goal ID';
                cycle.phases.execute = { delegated: false, rejected: true, rejection: rejection || null };
                return this._finalize(cycle, cycleStart);
            }
            cycle.phases.execute = { delegated: true, goalId: goal.id, status: goal.status };

            if (preparation && this.system.selfEvolutionDirector) {
                const experiment = await this.system.selfEvolutionDirector.openExperiment({
                    cycleId: cycle.id,
                    goal,
                    preparation,
                });
                cycle.phases.experiment = { id: experiment.id, state: experiment.state };
            }

            // ── Phase 8: Verify improvement (snapshot after short delay) ─
            // We record the before state and schedule a post-cycle benchmark
            // check. The verify happens on the NEXT cycle's measure phase.
            cycle.phases.verify = { state: 'awaiting_verified_goal', baseline: before };
            cycle.result = 'pending_execution';

            // Emit for dashboard
            this.emit('cycle_queued', {
                cycle:     cycle.id,
                target:    target.dimension,
                milestone: milestone?.description?.slice(0, 80) || null,
                transfers: xferCount,
                score:     before?.composite || null,
            });

        } catch (err) {
            cycle.result = 'error';
            cycle.error  = err.message;
            console.error('[ASIKernel] ❌ Cycle error:', err.message);
        } finally {
            this._busy = false;
        }

        return this._finalize(cycle, cycleStart);
    }

    // ─── Identify the weakest capability dimension ───────────────────────

    async _identifyBottleneck(snapshot, milestone) {
        if (!snapshot?.scores) {
            return { dimension: 'task_completion_rate', score: 0.5, reason: 'No baseline yet' };
        }

        const scores   = snapshot.scores;
        const dimNames = Object.keys(scores);

        // Pick the dimension with the lowest score
        let worst = dimNames[0];
        for (const d of dimNames) {
            if ((scores[d] || 0) < (scores[worst] || 0)) worst = d;
        }

        // If we have a milestone, prefer the dimension most related to it
        if (milestone && this.system.quadBrain) {
            const prompt = `Given this milestone: "${milestone.description}"

Which capability dimension is most blocking progress toward it?
Dimensions: ${dimNames.join(', ')}
Current scores: ${JSON.stringify(scores, null, 2)}

Return ONLY JSON: {"dimension": "...", "reason": "..."}`;

            try {
                const result = await this.system.quadBrain.reason(prompt, {
                    localModel: true,
                    systemOverride: 'Return clean JSON only.',
                });
                const match = (result.text || '').match(/\{[\s\S]*?\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (dimNames.includes(parsed.dimension)) {
                        return { dimension: parsed.dimension, score: scores[parsed.dimension] || 0, reason: parsed.reason || '' };
                    }
                }
            } catch {}
        }

        return { dimension: worst, score: scores[worst] || 0, reason: 'Lowest scoring dimension' };
    }

    // ─── Generate an improvement goal targeting the bottleneck ───────────

    async _generateGoal(target, milestone, cycleId, preparation = null) {
        const goalPlanner = this.system.goalPlanner;
        if (!goalPlanner?.createGoal) return null;

        const dimensionDescriptions = {
            reasoning_accuracy:    'reasoning quality and logical accuracy',
            task_completion_rate:  'completing goals that are started',
            memory_precision:      'retrieving relevant memories accurately',
            tool_efficiency:       'using fewer steps to complete agentic tasks',
            knowledge_coverage:    'expanding knowledge across more domains',
            response_latency_score: 'reducing brain response time',
        };

        const humanDesc = dimensionDescriptions[target.dimension] || target.dimension;
        const milestoneContext = milestone
            ? ` (in service of milestone: "${milestone.description.slice(0, 60)}")`
            : '';

        this._lastGoalRejection = null;
        try {
            const directed = this.system.selfEvolutionDirector?.buildGoal?.(target, { ...(preparation || {}), cycleId }) || null;
            const response = await goalPlanner.createGoal({
                type:        'self_improvement',
                category:    'asi_kernel',
                title:       directed?.title || `ASI: Improve ${humanDesc}`,
                description: directed?.description || `The ASI Kernel identified "${target.dimension}" as the current capability bottleneck (score: ${(target.score * 100).toFixed(1)}%)${milestoneContext}. Analyze what's causing weak performance in this area and propose a concrete improvement. Look at recent failures, patterns in outcomes, and what systems are responsible for this capability.`,
                priority:    75,
                confidence:  0.85,
                rationale:   `ASI cycle — lowest dimension: ${target.dimension} at ${(target.score * 100).toFixed(1)}%`,
                metadata:    {
                    ...(directed?.metadata || {}),
                    source:      'ASIKernel',
                    dimension:   target.dimension,
                    baselineScore: target.score,
                    asiCycleId: cycleId,
                    milestoneId: milestone?.id || null,
                },
            }, 'asi_kernel');
            if (!response?.success) {
                this._lastGoalRejection = {
                    reason: response?.error || 'unknown rejection',
                    existingGoalId: response?.existingGoalId || null,
                    queueFull: response?.queueFull || false,
                    at: new Date().toISOString(),
                };
                console.warn('[ASIKernel] Goal planner rejected improvement goal:', this._lastGoalRejection.reason);
                return null;
            }
            return response.goal || goalPlanner.goals?.get?.(response.goalId) || (response.goalId ? { id: response.goalId, title: `ASI: Improve ${humanDesc}`, status: 'pending' } : null);
        } catch (err) {
            this._lastGoalRejection = { reason: `exception: ${err.message}`, at: new Date().toISOString() };
            console.warn('[ASIKernel] Could not create improvement goal:', err.message);
            return null;
        }
    }

    async reconcilePendingCycles() {
        if (!this._running || !this.system?.benchmark || !this.system?.goalPlanner) return [];
        const resolved = [];
        for (const cycle of this._cycles.filter(item => item.result === 'pending_execution')) {
            const goalId = cycle.phases?.execute?.goalId;
            const goal = goalId ? this.system.goalPlanner.goals?.get?.(goalId) : null;
            if (!goal) {
                const missingSince = Date.parse(cycle.phases?.execute?.missingSince || cycle.startedAt || 0);
                cycle.phases.execute.missingSince ||= new Date().toISOString();
                cycle.phases.execute.missingChecks = Number(cycle.phases.execute.missingChecks || 0) + 1;
                if (Date.now() - missingSince < this._orphanGraceMs) continue;
                cycle.result = 'execution_orphaned';
                cycle.resolvedAt = new Date().toISOString();
                cycle.phases.verify = {
                    state: 'execution_orphaned',
                    goalId,
                    reason: 'The linked goal is absent from the persistent goal ledger',
                };
                await this.system.selfEvolutionDirector?.recordOrphan?.({
                    cycle,
                    goalId,
                    reason: cycle.phases.verify.reason,
                });
                this.emit('failed', { cycle: cycle.id, goalId, goalStatus: 'missing' });
                resolved.push(cycle);
                continue;
            }
            if (['active', 'pending'].includes(goal.status) && !this.system.goalPlanner.activeGoals?.has?.(goalId)) {
                const activeCount = Number(this.system.goalPlanner.activeGoals?.size || 0);
                const capacity = Number(this.system.goalPlanner.maxActiveGoals || 20);
                if (activeCount < capacity) {
                    this.system.goalPlanner.activeGoals.add(goalId);
                    this.system.goalPlanner._dirty = true;
                    await this.system.goalPlanner._saveToDisk?.();
                    cycle.phases.execute.recoveredToActiveIndexAt = new Date().toISOString();
                } else {
                    cycle.phases.execute.indexRecoveryBlocked = `Active goal capacity reached (${activeCount}/${capacity})`;
                }
            }
            cycle.phases.execute.status = goal.status;
            if (goal.status === 'completed' && goal.metadata?.lastVerification?.passed === true) {
                const after = await this.system.benchmark.snapshot();
                const baseline = cycle.phases.verify?.baseline || cycle.phases.measure?.baseline;
                const comparison = this.system.benchmark.compare(baseline, after);
                const directed = this.system.selfEvolutionDirector
                    ? await this.system.selfEvolutionDirector.evaluateCompleted({
                        cycle,
                        goal,
                        operationalAfter: after,
                        operationalComparison: comparison,
                    })
                    : null;
                cycle.phases.verify = {
                    state: directed
                        ? (directed.accepted ? 'verified_improvement' : 'no_measured_improvement')
                        : (comparison.valid !== false && comparison.delta > 0 && comparison.regressed.length === 0 ? 'verified_improvement' : 'no_measured_improvement'),
                    baseline,
                    after,
                    comparison,
                    goalVerification: goal.metadata.lastVerification,
                    experiment: directed?.experiment || null,
                };
                cycle.result = cycle.phases.verify.state;
                cycle.resolvedAt = new Date().toISOString();
                if (cycle.result === 'verified_improvement') this.emit('improvement', { cycle: cycle.id, goalId, comparison });
                else this.emit('no_improvement', { cycle: cycle.id, goalId, comparison });
                resolved.push(cycle);
            } else if (['failed', 'broken', 'blocked', 'verification_failed', 'rejected', 'abandoned', 'cancelled', 'deferred'].includes(goal.status)) {
                cycle.result = 'execution_failed';
                cycle.resolvedAt = new Date().toISOString();
                cycle.phases.verify = { state: 'execution_failed', goalStatus: goal.status, verification: goal.metadata?.lastVerification || null };
                await this.system.selfEvolutionDirector?.recordExecutionFailure?.({
                    cycle,
                    goal,
                    reason: `Goal terminated with status ${goal.status}`,
                });
                this.emit('failed', { cycle: cycle.id, goalId, goalStatus: goal.status });
                resolved.push(cycle);
            }
        }
        if (resolved.length) await this._persist();
        return resolved;
    }

    // ─── Velocity — composite score improvement rate over last N cycles ───

    getVelocity(n = 10) {
        const benchmark = this.system.benchmark;
        if (benchmark?.getVelocity) return benchmark.getVelocity(n);
        return 0;
    }

    // ─── Inspect ──────────────────────────────────────────────────────────

    getCycles(n = 10) {
        return this._cycles.slice(-n);
    }

    getStatus() {
        const last     = this._cycles.at(-1);
        const velocity = this.getVelocity();
        const success  = this._cycles.filter(c => c.result === 'verified_improvement').length;
        const blocked  = this._cycles.filter(c => ['blocked', 'blocked_missing_dependencies'].includes(c.result)).length;
        return {
            running:      this._running,
            busy:         this._busy,
            totalCycles:  this._cycles.length,
            successCycles: success,
            blockedCycles: blocked,
            velocity,
            trend:         velocity > 0.01 ? 'accelerating' : velocity < -0.01 ? 'decelerating' : 'stable',
            lastCycle:     last?.startedAt || null,
            lastResult:    last?.result    || null,
            lastTarget:    last?.phases?.identify?.dimension || null,
            pendingCycles: this._cycles.filter(c => c.result === 'pending_execution').length,
            experimentDirector: this.system.selfEvolutionDirector?.getStatus?.() || null,
        };
    }

    async shutdown() {
        this._running = false;
        if (this._reconcileTimer) clearInterval(this._reconcileTimer);
        this._reconcileTimer = null;
        await this._persist();
    }

    // ─── Internal ─────────────────────────────────────────────────────────

    _finalize(cycle, startMs) {
        cycle.durationMs = Date.now() - startMs;
        this._cycles.push(cycle);
        if (this._cycles.length > MAX_CYCLES) this._cycles.shift();
        this._persist().catch(() => {});
        console.log(`[ASIKernel] 🔄 Cycle complete (${cycle.durationMs}ms) — result: ${cycle.result}`);
        writeMonologue(`Self-improvement cycle complete. Result: ${cycle.result}. Duration: ${cycle.durationMs}ms.`, 'ASIKernel');
        return cycle;
    }

    async _persist() {
        try {
            await fs.writeFile(CYCLES_FILE, JSON.stringify(this._cycles, null, 2));
        } catch { /* non-fatal */ }
    }
}
