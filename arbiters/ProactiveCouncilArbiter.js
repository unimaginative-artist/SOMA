// ═══════════════════════════════════════════════════════════════════════════
// ProactiveCouncilArbiter.js — SOMA's Executive Function
//
// Fills the agentic gap MAX identified: SOMA has reactive specialists but no
// proactive brain asking "What should we work on next?"
//
// The Council surveys system state every 30 min, uses PROMETHEUS (strategic
// brain) to choose the 3 highest-value goals, creates them in GoalPlannerArbiter,
// and delegates them to the right specialists.
//
// Council Members (injected at boot):
//   steve     — EngineeringSwarm / ExecutiveCortex (code + execution)
//   kevin     — KevinArbiter (security + research)
//   goalPlanner — GoalPlannerArbiter (goal ledger)
//   pulse     — AutonomousHeartbeat (drive + curiosity execution)
//
// Signal reactions (immediate, not waiting for next cycle):
//   health.warning            → create fix goal → assign steve/kevin
//   swarm.optimization.needed → create optimization goal → assign steve
//   swarm.discovery.ideas     → create exploration goals → assign pulse
// ═══════════════════════════════════════════════════════════════════════════

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.cjs';
import crypto from 'crypto';

// ── Council Arbiter ────────────────────────────────────────────────────────

export class ProactiveCouncilArbiter extends BaseArbiterV4 {

    constructor(config = {}) {
        super({
            name: config.name || 'ProactiveCouncil',
            role: ArbiterRole.EXECUTIVE_CORTEX,
            capabilities: [
                ArbiterCapability.HIGH_LEVEL_PLANNING,
                ArbiterCapability.CAUSAL_REASONING,
                ArbiterCapability.COORDINATE_ASI,
                ArbiterCapability.ANALYSIS,
            ],
            lobe: 'EXECUTIVE',
            tier: 'strategic',
            ...config,
        });

        // Council members — injected after boot
        this.quadBrain       = config.quadBrain       || null;
        this.goalPlanner     = config.goalPlanner     || null;
        this.engineeringSwarm = config.engineeringSwarm || null;
        this.kevinArbiter    = config.kevinArbiter    || null;
        this.mnemonicArbiter = config.mnemonicArbiter || null;
        this.autonomousHeartbeat = config.autonomousHeartbeat || null;
        this.steveArbiter    = config.steveArbiter    || null;
        this.system          = config.system          || null; // for ArbiterLoader fallback

        // Configuration
        this.cycleIntervalMs  = config.cycleIntervalMs  || 30 * 60 * 1000; // 30 min
        this.maxGoalsPerCycle = config.maxGoalsPerCycle || 3;
        this.minTimeBetweenGoalsSec = config.minTimeBetweenGoalsSec || 60;

        // State
        this._cycleTimer   = null;
        this._lastCycleAt  = 0;
        this._lastGoalAt   = 0;
        this._cycleCount   = 0;
        this._pendingSignals = []; // buffered signals waiting for next think

        this.councilStats = {
            cycles:          0,
            goalsProposed:   0,
            goalsDelegated:  0,
            signalsProcessed: 0,
            lastCycleAt:     null,
            lastGoalTitle:   null,
        };
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    async onInitialize() {
        this._registerWithBroker();
        this._subscribeSignals();
        this._startProactiveLoop();
        console.log(`[ProactiveCouncil] ✅ Executive function active — cycle every ${this.cycleIntervalMs / 60000}min`);
    }

    _registerWithBroker() {
        try {
            messageBroker.registerArbiter(this.name, {
                instance:     this,
                handleMessage: (envelope) => this.handleMessage(envelope),
                role:         this.role || ArbiterRole.EXECUTIVE_CORTEX,
                lobe:         'EXECUTIVE',
                tier:         'strategic',
                type:         'proactive-council',
                capabilities: [ArbiterCapability.HIGH_LEVEL_PLANNING, ArbiterCapability.COORDINATE_ASI],
            });
        } catch (err) {
            console.warn(`[ProactiveCouncil] Broker registration failed: ${err.message}`);
        }
    }

    _subscribeSignals() {
        // Strategic-tier subscriptions — these handlers run BEFORE cognitive/operational
        // arbiters see the same signal, so the Council can set goal context first.
        const react = (topic) => (envelope) => {
            this._pendingSignals.push({ topic, payload: envelope?.payload ?? envelope });
            this._reactToSignal(topic, envelope?.payload ?? envelope);
        };

        messageBroker.subscribeTiered('strategic', 'health.warning',            react('health.warning'));
        messageBroker.subscribeTiered('strategic', 'swarm.optimization.needed', react('swarm.optimization.needed'));
        messageBroker.subscribeTiered('strategic', 'swarm.discovery.ideas',     react('swarm.discovery.ideas'));
        messageBroker.subscribeTiered('strategic', 'forensics.critical_finding', react('forensics.critical_finding'));
    }

    _startProactiveLoop() {
        // First cycle after 5 minutes (let everything boot)
        setTimeout(() => this._runCycle(), 5 * 60 * 1000);

        // Then every cycleIntervalMs
        this._cycleTimer = setInterval(() => this._runCycle(), this.cycleIntervalMs);
    }

    // ── Proactive Cycle ────────────────────────────────────────────────────

    async _runCycle() {
        this._cycleCount++;
        this._lastCycleAt = Date.now();
        this.councilStats.cycles++;
        this.councilStats.lastCycleAt = new Date().toISOString();

        console.log(`[ProactiveCouncil] 🔄 Council cycle #${this._cycleCount}`);

        try {
            // 1. Gather system context
            const context = await this._gatherContext();

            // 2. Ask PROMETHEUS: what should SOMA do next?
            const proposals = await this._thinkNextMove(context);

            // 3. Create goals and delegate
            for (const proposal of proposals.slice(0, this.maxGoalsPerCycle)) {
                await this._proposeGoal(proposal);
            }

            // Clear processed signals
            this._pendingSignals = [];

        } catch (err) {
            console.warn(`[ProactiveCouncil] Cycle error: ${err.message}`);
        }
    }

    async _gatherContext() {
        const context = {
            systemHealth: {},
            activeGoals:  [],
            recentSignals: this._pendingSignals.slice(-10),
            memoryHighlights: [],
            heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            trackRecord: null,
        };

        // Active goals snapshot
        if (this.goalPlanner?.goals) {
            const goals = [...this.goalPlanner.goals.values()];
            context.activeGoals = goals
                .filter(g => g.status === 'active' || g.status === 'pending')
                .slice(0, 10)
                .map(g => ({ title: g.title, category: g.category, priority: g.priority, status: g.status }));

            context.trackRecord = this._goalTrackRecord(goals);
        }

        // Recent memories (what has SOMA been focused on?)
        if (this.mnemonicArbiter?.search) {
            try {
                const recent = await Promise.race([
                    this.mnemonicArbiter.search('system goals progress', { limit: 5 }),
                    new Promise(r => setTimeout(() => r([]), 2000)),
                ]);
                context.memoryHighlights = (recent || []).map(m => m.content || m.text || '').filter(Boolean).slice(0, 3);
            } catch { /* optional */ }
        }

        return context;
    }

    async _thinkNextMove(context) {
        if (!this.quadBrain) {
            // Fallback: generate basic maintenance goals without AI reasoning
            return this._fallbackGoals(context);
        }

        const prompt = this._buildStrategyPrompt(context);

        try {
            const result = await Promise.race([
                this.quadBrain.reason(prompt, {
                    persona: 'PROMETHEUS',
                    temperature: 0.7,
                    maxTokens: 800,
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('strategy timeout')), 15_000)),
            ]);

            const text = result?.text || result?.response || '';
            return this._parseProposals(text, context);

        } catch (err) {
            console.warn(`[ProactiveCouncil] Brain unavailable (${err.message}) — using fallback`);
            return this._fallbackGoals(context);
        }
    }

    // ── Outcome feedback (the selection-pressure wire) ──────────────────────
    // Goal generation used to be blind to the graveyard: broken goals taught
    // the proposer nothing, so it re-spawned the same dead ideas (17 robot-body
    // variants). This digest feeds real outcomes back into every proposal.

    _goalTrackRecord(goals) {
        const now = Date.now();
        const RECENT = 30 * 86400000; // 30-day window
        const terminalBad = new Set(['broken', 'failed', 'verification_failed']);
        const byCategory = {};
        const recentFailures = [];
        const recentWins = [];

        for (const g of goals) {
            if (!g || !g.title) continue;
            const when = g.completedAt || g.metadata?.lastTransition?.at || g.createdAt || 0;
            const cat = String(g.category || 'uncategorized');
            byCategory[cat] = byCategory[cat] || { completed: 0, dead: 0 };
            if (g.status === 'completed') {
                byCategory[cat].completed++;
                if (now - when < RECENT) recentWins.push({ title: g.title, when });
            } else if (terminalBad.has(String(g.status))) {
                byCategory[cat].dead++;
                if (now - when < RECENT) {
                    recentFailures.push({
                        title: g.title,
                        reason: g.metadata?.lastTransition?.reason || g.status,
                        when,
                    });
                }
            }
        }

        recentFailures.sort((a, b) => b.when - a.when);
        recentWins.sort((a, b) => b.when - a.when);
        const categoryYields = Object.entries(byCategory)
            .map(([cat, s]) => ({ cat, ...s, total: s.completed + s.dead, yield: s.completed + s.dead > 0 ? Math.round((s.completed / (s.completed + s.dead)) * 100) : null }))
            .filter(s => s.total >= 3)
            .sort((a, b) => (a.yield ?? 100) - (b.yield ?? 100));

        return {
            recentFailures: recentFailures.slice(0, 10),
            recentWins: recentWins.slice(0, 5),
            categoryYields,
        };
    }

    // Token-overlap check so the proposer cannot re-spawn a recently dead goal
    // under a lightly reworded title.
    _resemblesRecentFailure(title, trackRecord) {
        if (!trackRecord?.recentFailures?.length) return null;
        const tokenize = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
            .filter(w => w.length > 3 && !['with', 'that', 'this', 'from', 'into', 'soma'].includes(w)));
        const mine = tokenize(title);
        if (mine.size === 0) return null;
        for (const failure of trackRecord.recentFailures) {
            const theirs = tokenize(failure.title);
            if (theirs.size === 0) continue;
            let shared = 0;
            for (const w of mine) if (theirs.has(w)) shared++;
            const overlap = shared / Math.min(mine.size, theirs.size);
            if (overlap >= 0.6) return failure.title;
        }
        return null;
    }

    _buildStrategyPrompt(context) {
        const activeGoalList = context.activeGoals.length > 0
            ? context.activeGoals.map(g => `  - [${g.status}] ${g.title} (${g.category}, p${g.priority})`).join('\n')
            : '  (none)';

        const signalList = context.recentSignals.length > 0
            ? context.recentSignals.map(s => `  - ${s.topic}: ${JSON.stringify(s.payload).slice(0, 80)}`).join('\n')
            : '  (none)';

        const memList = context.memoryHighlights.length > 0
            ? context.memoryHighlights.map(m => `  - ${m.slice(0, 100)}`).join('\n')
            : '  (none)';

        const tr = context.trackRecord;
        const failList = tr?.recentFailures?.length
            ? tr.recentFailures.map(f => `  - FAILED (${f.reason}): ${f.title.slice(0, 90)}`).join('\n')
            : '  (none)';
        const winList = tr?.recentWins?.length
            ? tr.recentWins.map(w => `  - COMPLETED: ${w.title.slice(0, 90)}`).join('\n')
            : '  (none)';
        const yieldList = tr?.categoryYields?.length
            ? tr.categoryYields.map(y => `  - ${y.cat}: ${y.yield}% yield (${y.completed} completed / ${y.dead} dead of ${y.total})`).join('\n')
            : '  (insufficient history)';

        return `You are PROMETHEUS — SOMA's strategic planning brain. Your job is to decide what SOMA should work on next.

CURRENT SYSTEM STATE:
- Heap memory: ${context.heapMB}MB
- Active/pending goals:
${activeGoalList}

TRACK RECORD (real outcomes from the goal ledger — learn from this):
Recent failures (do NOT re-propose these or near-identical variants; their approach is dead until something material changes):
${failList}
Recent verified completions (this is what actually works — propose more like these):
${winList}
Category yield (completed vs dead; starve the low-yield categories, feed the high-yield ones):
${yieldList}

RECENT SIGNALS:
${signalList}

RECENT MEMORY CONTEXT:
${memList}

TASK: Propose up to 3 concrete ideas for SOMA's governed proposal backlog. These are suggestions, not executable jobs. Prefer one high-evidence, bounded proposal over speculative volume. Never manufacture a moonshot merely to fill a quota.

Each goal must be:
1. Specific and actionable (not vague).
2. Different from existing active goals.
3. Genuinely valuable for system improvement OR humanity-scale progress.
4. NOT about designing/building a physical robot body or hardware embodiment for SOMA — Owner owns all physical-embodiment work personally (his standing directive, 2026-07-11). Never propose goals in that domain.

Respond in this exact JSON format (no markdown, no commentary):
[
  {
    "title": "Short goal title",
    "description": "What to do and why (if a Moonshot, describe the massive 20-page dossier/blueprint to be generated)",
    "category": "engineering|security|research|optimization|knowledge|moonshot",
    "priority": 60,
    "delegate": "steve|kevin|pulse|any"
  }
]`;
    }

    _parseProposals(text, context) {
        // Extract JSON array from brain response
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return this._fallbackGoals(context);

        try {
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) return this._fallbackGoals(context);

            return parsed.filter(p => {
                if (!p.title || !p.category) return false;
                // Hard filter: the prompt asks nicely; this enforces it. A proposal
                // that resembles a recently dead goal does not get born again.
                const corpse = this._resemblesRecentFailure(p.title, context.trackRecord);
                if (corpse) {
                    console.log(`[ProactiveCouncil] 🚫 Rejected re-proposal of dead goal: "${p.title}" ≈ "${corpse}"`);
                    return false;
                }
                return true;
            }).map(p => ({
                title:       p.title.slice(0, 120),
                description: p.description || p.title,
                category:    p.category || 'research',
                priority:    Math.min(100, Math.max(10, parseInt(p.priority) || 50)), // Moonshots can hit 100
                delegate:    p.delegate || 'any',
            }));
        } catch {
            return this._fallbackGoals(context);
        }
    }

    _fallbackGoals(context) {
        // When brain is unavailable, generate safe maintenance goals
        const goals = [];
        const heapMB = context.heapMB || 0;

        if (heapMB > 500) {
            goals.push({
                title:       'Reduce memory pressure',
                description: `Heap at ${heapMB}MB — prune low-value arbiter caches`,
                category:    'optimization',
                priority:    75,
                delegate:    'steve',
            });
        }

        if (context.activeGoals.length === 0) {
            goals.push({
                title:       'Synthesize system state summary',
                description: 'No active goals — review system state and propose next priorities',
                category:    'research',
                priority:    50,
                delegate:    'any',
            });
        }

        goals.push({
            title:       'Run background curiosity scan',
            description: 'Explore recent signals and generate knowledge graph connections',
            category:    'knowledge',
            priority:    40,
            delegate:    'pulse',
        });

        return goals.slice(0, 3);
    }

    // ── Goal Proposal & Delegation ──────────────────────────────────────────

    async _proposeGoal(proposal) {
        if (!this.goalPlanner) return;

        // Rate-limit to avoid spamming
        const now = Date.now();
        if (now - this._lastGoalAt < this.minTimeBetweenGoalsSec * 1000) return;

        try {
            const submit = this.goalPlanner.submitProposal?.bind(this.goalPlanner)
                || this.goalPlanner.createGoal.bind(this.goalPlanner);
            const result = await submit({
                title:       proposal.title,
                description: proposal.description,
                category:    proposal.category,
                priority:    proposal.priority,
                type:        'operational',
                rationale:   'ProactiveCouncil strategic planning cycle',
            }, 'proactive_council');

            if (result?.success === false) {
                // Duplicate or cap hit — not an error, just skip
                return;
            }

            this._lastGoalAt = now;
            this.councilStats.goalsProposed++;
            this.councilStats.lastGoalTitle = proposal.title;

            console.log(`[ProactiveCouncil] 🎯 Proposed: "${proposal.title}" → delegate: ${proposal.delegate}`);

            // Work Governor proposals are deliberately not delegated. Promotion
            // into the one authoritative execution loop is a separate decision.

        } catch (err) {
            console.warn(`[ProactiveCouncil] Failed to propose goal "${proposal.title}": ${err.message}`);
        }
    }

    async _delegateGoal(goal, delegateTo) {
        // Auto-route if 'any' or unknown
        if (!delegateTo || delegateTo === 'any') {
            if (goal.category === 'engineering')    delegateTo = 'steve';
            else if (goal.category === 'security')  delegateTo = 'kevin';
            else                                    delegateTo = 'pulse';
        }

        // Map delegate hint → direct arbiter reference (council already holds these)
        const arbiterRef = {
            steve: this.steveArbiter || this.engineeringSwarm,
            kevin: this.kevinArbiter,
            pulse: this.autonomousHeartbeat,
        }[delegateTo];

        const envelope = {
            from:    this.name,
            to:      delegateTo,
            type:    'assigned_goal',
            payload: { goal, source: 'ProactiveCouncil' },
        };

        // Resolve arbiter — direct reference first, then lazy-load via ArbiterLoader
        let resolvedArbiter = arbiterRef;
        if (!resolvedArbiter) {
            const loader = this.system?.arbiterLoader;
            if (loader) {
                const capMap = {
                    steve: 'modify-code',
                    kevin: 'security-audit',
                    pulse: 'execute-task',
                };
                const cap = capMap[delegateTo];
                if (cap) {
                    console.log(`[ProactiveCouncil] 🔍 "${delegateTo}" not live — requesting lazy load (capability: ${cap})`);
                    resolvedArbiter = await loader.loadForCapability(cap).catch(() => null);
                }
            }
        }

        // Deliver directly
        if (resolvedArbiter && typeof resolvedArbiter.handleMessage === 'function') {
            try {
                await resolvedArbiter.handleMessage(envelope);
                this.councilStats.goalsDelegated++;
                console.log(`[ProactiveCouncil] 📬 Delegated "${goal.title}" → ${delegateTo}`);
            } catch (err) {
                console.warn(`[ProactiveCouncil] Direct delegation to ${delegateTo} failed: ${err.message}`);
            }
        } else {
            console.warn(`[ProactiveCouncil] No arbiter available for delegate "${delegateTo}" — goal logged but not dispatched`);
        }

        // Also broadcast so any subscriber (dashboard, logs) can observe
        try {
            messageBroker.publish('goal_assigned', {
                from:       this.name,
                goalId:     goal.id,
                goalTitle:  goal.title,
                assignedTo: delegateTo,
            });
        } catch { /* optional */ }
    }

    // ── Signal Reactions (immediate) ───────────────────────────────────────

    async _reactToSignal(topic, payload) {
        this.councilStats.signalsProcessed++;

        // Debounce — don't create goals too frequently
        if (Date.now() - this._lastGoalAt < 30_000) return;

        const goalMap = {
            'health.warning': {
                title:    `Investigate: ${String(payload?.issue || 'health warning').slice(0, 80)}`,
                category: 'optimization',
                priority: 80,
                delegate: 'steve',
            },
            'swarm.optimization.needed': {
                title:    `Optimize swarm (success rate: ${((payload?.successRate || 0) * 100).toFixed(0)}%)`,
                category: 'engineering',
                priority: 70,
                delegate: 'steve',
            },
            'swarm.discovery.ideas': {
                title:    `Prototype discovery ideas (${(payload?.ideas || []).length} ideas)`,
                category: 'research',
                priority: 55,
                delegate: 'pulse',
            },
            'forensics.critical_finding': {
                title:    `Forensic Audit Required: ${payload?.target || 'discrepancy'} (Verdict: ${payload?.verdict || 'CRITICAL'})`,
                category: 'security',
                priority: 95,
                delegate: 'kevin',
            },
        };

        const proposal = goalMap[topic];
        if (proposal) {
            await this._proposeGoal({ description: proposal.title, ...proposal });
        }
    }

    // ── Message Handler ────────────────────────────────────────────────────

    async handleMessage(envelope) {
        const { type, payload, from } = envelope || {};

        if (type === 'council_status') {
            return { council: this.getCouncilStatus() };
        }

        if (type === 'force_cycle') {
            console.log(`[ProactiveCouncil] Force cycle requested by ${from}`);
            this._runCycle().catch(() => {});
            return { accepted: true };
        }

        if (type === 'propose_goal') {
            await this._proposeGoal(payload);
            return { accepted: true };
        }
    }

    // ── Status ─────────────────────────────────────────────────────────────

    getCouncilStatus() {
        return {
            ...this.councilStats,
            cycleIntervalMin: this.cycleIntervalMs / 60000,
            members: {
                steve:  !!(this.steveArbiter || this.engineeringSwarm),
                kevin:  !!this.kevinArbiter,
                pulse:  !!this.autonomousHeartbeat,
                brain:  !!this.quadBrain,
                memory: !!this.mnemonicArbiter,
            },
            pendingSignals: this._pendingSignals.length,
        };
    }

    async shutdown() {
        if (this._cycleTimer) clearInterval(this._cycleTimer);
        return super.shutdown();
    }
}

export default ProactiveCouncilArbiter;
