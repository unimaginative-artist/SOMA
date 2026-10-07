/**
 * arbiters/MaterialsScienceArbiter.js
 *
 * SOMA Multi-domain Materials Science Research Engine.
 *
 * Runs a 3-phase pipeline (Source → Synthesize → Publish) on a rotating
 * set of research programs every 6 hours. Results are stored in memory
 * and published to ~/Desktop/SOMA_RESEARCH/.
 *
 * Programs: photonic_computing, solid_state_batteries, soft_robotics,
 *           advanced_alloys, quantum_sensing, 2D_materials, neuromorphic_chips
 *
 * Fixes over original:
 * - Rotating programs (not just photonic_computing once)
 * - initialize() retries until braveSearch is ready
 * - Synthesis uses _callProviderCascade directly — simple task, no ODIN overhead
 * - discoveries Map is populated on mission complete
 * - Memory storage of research summaries
 * - _runNext() for manual trigger via API
 * - Proper progress tracking
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

const PROGRAMS = [
    { id: 'photonic_computing',    label: 'Photonic Computing',      domain: 'Computing' },
    { id: 'solid_state_batteries', label: 'Solid-State Batteries',   domain: 'Energy' },
    { id: 'soft_robotics',         label: 'Soft Robotics',           domain: 'Robotics' },
    { id: 'advanced_alloys',       label: 'Advanced Alloys',         domain: 'Materials' },
    { id: 'quantum_sensing',       label: 'Quantum Sensing',         domain: 'Quantum' },
    { id: '2D_materials',          label: '2D Materials (Graphene+)', domain: 'Nanotechnology' },
    { id: 'neuromorphic_chips',    label: 'Neuromorphic Chips',      domain: 'Computing' },
];

const PHASE_ORDER = ['IDLE', 'SOURCING', 'SYNTHESIS', 'PUBLICATION'];
const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class MaterialsScienceArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: 'MaterialsScience',
            role: ArbiterRole.MAINTAINER,
            capabilities: [ArbiterCapability.KNOWLEDGE_SYNTHESIS, ArbiterCapability.SYSTEM_AUDIT],
        });

        this.active           = false; // set true in initialize()
        this.discoveries      = new Map();
        this._currentPhase    = 'IDLE';
        this._phaseResults    = {};
        this._currentMission  = null;
        this._programIndex    = 0;

        this._startResearchPulse();
    }

    async initialize() {
        if (!this.system?.braveSearch) {
            console.warn(`🔬 [${this.name}] BraveSearch not ready — retrying in 15s...`);
            setTimeout(() => this.initialize(), 15000);
            return;
        }
        this.brave  = this.system.braveSearch;
        this.memory = this.system.mnemonicArbiter || this.system.mnemonic;
        this.active = true;
        console.log(`🔬 [${this.name}] Phased Materials Lab online. ${PROGRAMS.length} programs queued.`);
    }

    // ── Manual trigger (POST /api/soma/materials/run) ─────────────────────────
    _runNext() {
        if (this._currentPhase !== 'IDLE' || !this.active) return;
        const program = PROGRAMS[this._programIndex];
        this.conductResearch(program);
    }

    _startResearchPulse() {
        setTimeout(() => this._runNext(), 30000);
        setInterval(() => this._runNext(), CYCLE_INTERVAL_MS).unref();
    }

    // ── Main research pipeline ────────────────────────────────────────────────

    async conductResearch(program) {
        if (!this.active || !this.brave) return;
        this._currentMission = { target: program.id, label: program.label, domain: program.domain };
        this._phaseResults   = {};

        try {
            // PHASE 1: SOURCING
            this._currentPhase = 'SOURCING';
            console.log(`🔬 [${this.name}] [1/3] SOURCING [${program.label}]`);
            const query   = `latest 2025 2026 ${program.id.replace(/_/g, ' ')} breakthrough research site:nature.com OR site:arxiv.org OR site:science.org`;
            const results = await this.brave.search(query);
            if (!results?.length) {
                console.warn(`🔬 [${this.name}] No search results — skipping.`);
                this._resetMission();
                return;
            }
            this._phaseResults.sources = results;
            await this._pause();

            // PHASE 2: SYNTHESIS — direct provider call (simple synthesis, no recurrence needed)
            this._currentPhase = 'SYNTHESIS';
            console.log(`🔬 [${this.name}] [2/3] SYNTHESIS`);
            const brain = this.system?.quadBrain;
            if (!brain?._callProviderCascade) throw new Error('no brain available');

            const snippets = results.slice(0, 5).map(r => r.snippet || r.title || '').join('\n');
            const prompt = `You are SOMA, a Senior Materials Scientist specializing in ${program.domain}.
Analyze these recent research snippets on ${program.label}:
${snippets}

Identify ONE unconventional cross-domain link that could lead to a novel breakthrough.
Be specific: name the confluence, explain the mechanism, estimate the impact timeline.
Format: CONFLUENCE: / MECHANISM: / IMPACT TIMELINE: / SOVEREIGN IP ANGLE:`;

            const result = await Promise.race([
                brain._callProviderCascade(prompt, { activeLobe: 'LOGOS', temperature: 0.5 }),
                new Promise((_, r) => setTimeout(() => r(new Error('synthesis timeout')), 40000)),
            ]);
            this._phaseResults.discovery = result?.text || result?.response || '';
            await this._pause();

            // PHASE 3: PUBLICATION
            this._currentPhase = 'PUBLICATION';
            console.log(`🔬 [${this.name}] [3/3] PUBLICATION`);
            await this._publishReport(program, this._phaseResults.discovery);

            // Store in discoveries Map
            const key = `${program.id}_${Date.now()}`;
            this.discoveries.set(key, {
                program:   program.id,
                label:     program.label,
                domain:    program.domain,
                timestamp: Date.now(),
                synthesis: this._phaseResults.discovery?.substring(0, 600),
            });
            if (this.discoveries.size > 30) {
                this.discoveries.delete(this.discoveries.keys().next().value);
            }

            // Persist to long-term memory
            if (this.memory?.remember) {
                await this.memory.remember(
                    `[MATERIALS RESEARCH] ${program.label} (${program.domain})\n${this._phaseResults.discovery?.substring(0, 500)}`,
                    { importance: 0.75, sector: 'SCI', category: 'materials_discovery' }
                ).catch(() => {});
            }

            console.log(`✅ [${this.name}] ${program.label} complete.`);
            this._programIndex = (this._programIndex + 1) % PROGRAMS.length;

        } catch (e) {
            console.error(`🔬 [${this.name}] Research stalled at ${this._currentPhase}:`, e.message);
        } finally {
            this._resetMission();
        }
    }

    _resetMission() {
        this._currentPhase   = 'IDLE';
        this._phaseResults   = {};
        this._currentMission = null;
    }

    _pause() {
        return new Promise(r => setTimeout(r, 1500));
    }

    async _publishReport(program, synthesis) {
        const { default: fs }   = await import('fs/promises');
        const { default: path } = await import('path');
        const { default: os }   = await import('os');
        const dir      = path.join(os.homedir(), 'Desktop', 'SOMA_RESEARCH');
        await fs.mkdir(dir, { recursive: true });
        const filename = `SOMA_MATERIALS_${program.id.toUpperCase()}_${Date.now()}.md`;
        await fs.writeFile(path.join(dir, filename),
            `# SOMA MATERIALS SCIENCE REPORT\n## Program: ${program.label}\n## Domain: ${program.domain}\n\n${synthesis}`
        );
        console.log(`🔬 [${this.name}] Report published: ${filename}`);
    }

    getStatus() {
        const phaseIndex = PHASE_ORDER.indexOf(this._currentPhase);
        const progress   = phaseIndex <= 0 ? 0 : parseFloat((phaseIndex / (PHASE_ORDER.length - 1)).toFixed(2));
        return {
            name:            this.name,
            active:          this.active,
            currentPhase:    this._currentPhase,
            mission:         this._currentMission,
            nextProgram:     PROGRAMS[this._programIndex]?.label || 'None',
            progress,
            discoveriesCount: this.discoveries.size,
            recentDiscoveries: Array.from(this.discoveries.values()).slice(-3),
        };
    }
}

export default MaterialsScienceArbiter;
