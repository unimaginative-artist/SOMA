// ═══════════════════════════════════════════════════════════════════════════
// CapabilityBenchmark.js — Measuring SOMA's Intelligence Growth
//
// SOMA can't improve what she can't measure. This tracks 6 capability
// dimensions over time so the ASIKernel can see what's actually getting better.
//
// Dimensions:
//   reasoning_accuracy   — quality of ReasoningChamber outputs (0–1)
//   task_completion_rate — % of goals completed vs attempted
//   memory_precision     — relevance score of memory recalls (0–1)
//   tool_efficiency      — avg steps to complete an agentic goal
//   knowledge_coverage   — unique domains in recent memory (normalized)
//   response_latency     — avg brain response time in ms (inverted for score)
//
// Probes are cheap: no LLM calls for collection, only for interpretation.
// Persists to server/.soma/benchmarks.json
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_FILE = path.join(__dirname, '..', 'server', '.soma', 'benchmarks.json');
const MAX_HISTORY    = 100;
const BENCHMARK_SCHEMA_VERSION = 2;

const DIMENSIONS = [
    'reasoning_accuracy',
    'task_completion_rate',
    'memory_precision',
    'tool_efficiency',
    'knowledge_coverage',
    'response_latency_score',
];

export class CapabilityBenchmark {
    constructor({ system } = {}) {
        this.system   = system || null;
        this._history = [];  // [{ timestamp, scores: { dim: 0-1, ... }, composite: 0-1 }]
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        try {
            await fs.mkdir(path.dirname(BENCHMARK_FILE), { recursive: true });
            const raw = await fs.readFile(BENCHMARK_FILE, 'utf8').catch(() => '[]');
            this._history = JSON.parse(raw);
            if (!Array.isArray(this._history)) this._history = [];
        } catch {
            this._history = [];
        }
        console.log(`[CapabilityBenchmark] 📊 Ready — ${this._history.length} historical snapshots`);
        return this;
    }

    // ─── Snapshot — capture all 6 dimensions right now ───────────────────

    async snapshot() {
        const scores = {};

        // 1. Task completion rate — from GoalPlannerArbiter stats
        try {
            const gp = this.system?.goalPlanner;
            if (gp?.goals) {
                const all       = [...(gp.goals.values ? gp.goals.values() : Object.values(gp.goals))];
                const completedIds = new Set([
                    ...(Array.isArray(gp.completedGoals) ? gp.completedGoals.map(goal => goal?.id).filter(Boolean) : []),
                    ...all.filter(goal => goal.status === 'completed').map(goal => goal.id)
                ]);
                const failedIds = new Set([
                    ...(Array.isArray(gp.failedGoals) ? gp.failedGoals.map(goal => goal?.id).filter(Boolean) : []),
                    ...all.filter(goal => ['failed', 'broken', 'verification_failed', 'rejected', 'abandoned'].includes(goal.status)).map(goal => goal.id)
                ]);
                const completed = completedIds.size;
                const attempted = completed + failedIds.size;
                scores.task_completion_rate = attempted > 0 ? completed / attempted : 0.5;
            } else {
                scores.task_completion_rate = 0.5;
            }
        } catch { scores.task_completion_rate = 0.5; }

        // 2. Memory precision — from MnemonicArbiter recent recall quality
        try {
            const mn = this.system?.mnemonicArbiter || this.system?.mnemonic;
            if (mn?.getStats) {
                const stats = await mn.getStats();
                scores.memory_precision = Math.min(1, (stats.avgScore || stats.avgRelevance || 0.6));
            } else if (mn?.recentRecalls) {
                const recalls = mn.recentRecalls.slice(-20);
                const avg = recalls.length > 0
                    ? recalls.reduce((s, r) => s + (r.score || 0.6), 0) / recalls.length
                    : 0.6;
                scores.memory_precision = Math.min(1, avg);
            } else {
                scores.memory_precision = 0.6;
            }
        } catch { scores.memory_precision = 0.6; }

        // 3. Tool efficiency — from SomaAgenticExecutor recent runs
        try {
            const ae = this.system?.agenticExecutor;
            if (ae?.stats) {
                const { totalRuns, totalSteps } = ae.stats;
                const avgSteps = totalRuns > 0 ? totalSteps / totalRuns : 5;
                // Score: 1 step = 1.0, 10 steps = 0.1, interpolate
                scores.tool_efficiency = Math.max(0.1, Math.min(1, 1 - (avgSteps - 1) / 9));
            } else {
                scores.tool_efficiency = 0.5;
            }
        } catch { scores.tool_efficiency = 0.5; }

        // 4. Knowledge coverage — unique memory domains/tags
        try {
            const mn = this.system?.mnemonicArbiter || this.system?.mnemonic;
            if (mn?.getMemoryStats) {
                const stats = await mn.getMemoryStats();
                const domains = stats.uniqueDomains || stats.uniqueTypes || 5;
                scores.knowledge_coverage = Math.min(1, domains / 20); // 20 domains = full score
            } else {
                scores.knowledge_coverage = 0.5;
            }
        } catch { scores.knowledge_coverage = 0.5; }

        // 5. Response latency score — from quadBrain recent latency
        try {
            const qb = this.system?.quadBrain;
            if (qb?.getStats) {
                const stats = qb.getStats();
                const avgMs = stats.avgLatency || stats.averageLatencyMs || 3000;
                // < 500ms = 1.0, > 10s = 0.0
                scores.response_latency_score = Math.max(0, Math.min(1, 1 - (avgMs - 500) / 9500));
            } else {
                scores.response_latency_score = 0.5;
            }
        } catch { scores.response_latency_score = 0.5; }

        // 6. Reasoning accuracy — from ReasoningChamber or MetaCortex
        try {
            const rc = this.system?.reasoningChamber;
            if (rc?.getStats) {
                const stats = rc.getStats();
                scores.reasoning_accuracy = Math.min(1, stats.avgConfidence || stats.avgQuality || 0.6);
            } else {
                // Proxy: use task completion as reasoning proxy if no direct signal
                scores.reasoning_accuracy = scores.task_completion_rate * 0.8 + 0.2;
            }
        } catch { scores.reasoning_accuracy = 0.6; }

        // Composite score (equal-weighted)
        const composite = DIMENSIONS.reduce((sum, d) => sum + (scores[d] || 0), 0) / DIMENSIONS.length;

        const entry = {
            schemaVersion: BENCHMARK_SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
            scores,
            composite: Math.round(composite * 1000) / 1000,
        };

        this._history.push(entry);
        if (this._history.length > MAX_HISTORY) this._history.shift();
        this._persist().catch(() => {});

        return entry;
    }

    // ─── Compare two snapshots ────────────────────────────────────────────

    compare(before, after) {
        if (!before || !after) return { improved: [], regressed: [], unchanged: [], delta: 0 };
        if (before.schemaVersion !== BENCHMARK_SCHEMA_VERSION || after.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
            return {
                valid: false,
                reason: 'Benchmark schema changed; collect a fresh baseline before evaluating improvement.',
                improved: [], regressed: [], unchanged: [], delta: 0
            };
        }

        const improved   = [];
        const regressed  = [];
        const unchanged  = [];

        for (const dim of DIMENSIONS) {
            const b = before.scores?.[dim] ?? 0;
            const a = after.scores?.[dim]  ?? 0;
            const d = a - b;
            if (d >  0.02) improved.push({ dim, before: b, after: a, delta: d });
            else if (d < -0.02) regressed.push({ dim, before: b, after: a, delta: d });
            else unchanged.push(dim);
        }

        const delta = (after.composite || 0) - (before.composite || 0);
        return { valid: true, improved, regressed, unchanged, delta };
    }

    // ─── Get velocity — improvement rate over last N snapshots ───────────

    getVelocity(n = 10) {
        const recent = this._history.filter(entry => entry.schemaVersion === BENCHMARK_SCHEMA_VERSION).slice(-n);
        if (recent.length < 2) return 0;
        const oldest = recent[0].composite;
        const newest = recent[recent.length - 1].composite;
        return Math.round((newest - oldest) * 1000) / 1000;
    }

    // ─── History ──────────────────────────────────────────────────────────

    getHistory(n = 20) {
        return this._history.slice(-n);
    }

    getLast() {
        return this._history.at(-1) || null;
    }

    // ─── Dashboard data — chart-ready time series ─────────────────────────

    getDashboardData() {
        const history = this._history.slice(-30);
        return {
            labels:     history.map(h => h.timestamp),
            composite:  history.map(h => h.composite),
            dimensions: DIMENSIONS.reduce((acc, d) => {
                acc[d] = history.map(h => h.scores?.[d] ?? 0);
                return acc;
            }, {}),
            velocity:   this.getVelocity(),
            current:    this.getLast(),
        };
    }

    getStatus() {
        const last    = this.getLast();
        const velocity = this.getVelocity();
        return {
            snapshots:  this._history.length,
            composite:  last?.composite ?? null,
            velocity,
            trend:      velocity > 0.01 ? 'improving' : velocity < -0.01 ? 'declining' : 'stable',
            dimensions: last?.scores ?? {},
        };
    }

    // ─── Persistence ──────────────────────────────────────────────────────

    async _persist() {
        try {
            await fs.writeFile(BENCHMARK_FILE, JSON.stringify(this._history, null, 2));
        } catch { /* non-fatal */ }
    }
}
