/**
 * core/ExpertiseSynthesizer.js
 *
 * When SOMA researches a topic deeply enough through curiosity, this decides
 * whether to crystallize that knowledge into a full ExpertiseArbiter she
 * built herself — not by Owner, not by a template, but by her own reasoning.
 *
 * Flow:
 *   CuriosityEngine researches topic deeply
 *     → ExpertiseSynthesizer.evaluate(topic, research)
 *       → decides: is this worth a full expertise pack?
 *       → if yes: generates ExpertiseArbiter code using brain + ExpertiseBase pattern
 *       → writes to arbiters/  (quarantines to experiments/synthesized/ on load failure)
 *       → hot-loads it into the running system
 *       → stores "I built this myself" to WorkingMemory + memory
 */

import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';

// Minimum research depth before we'll synthesize a pack
const MIN_RESEARCH_DEPTH = 200;

// Built-in packs that always exist — never re-synthesize these
const BUILTIN_PACKS = new Set([
    'financial', 'audit', 'tax', 'biotech', 'materials', 'materials_science'
]);

// TTL for recently-evaluated topics (24 hours)
const RECENT_TOPIC_TTL_MS = 24 * 3600_000;
const MAX_RECENT_TOPICS   = 50;

export class ExpertiseSynthesizer {
    constructor(config = {}) {
        this.brain         = config.brain;
        this.system        = config.system;
        this.workingMemory = config.workingMemory;
        this.memory        = config.memory;  // MnemonicArbiter

        // debounce: topic (lowercase) → timestamp last evaluated
        this._recentTopics = new Map();

        // All known pack names (built-in + previously synthesized)
        this._existingPacks = new Set(BUILTIN_PACKS);

        // Path where we persist synthesized pack names across restarts
        this._synthesizedPacksPath = path.resolve('SOMA/synthesized-packs.json');
        this._loadSynthesizedPacks();
    }

    // ── Persistence ────────────────────────────────────────────────────────────

    _loadSynthesizedPacks() {
        try {
            const raw  = readFileSync(this._synthesizedPacksPath, 'utf-8');
            const list = JSON.parse(raw);
            if (Array.isArray(list)) list.forEach(p => this._existingPacks.add(String(p).toLowerCase()));
        } catch { /* first run or missing file — that's fine */ }
    }

    async _saveSynthesizedPack(topicKey) {
        this._existingPacks.add(topicKey);
        const userPacks = [...this._existingPacks].filter(p => !BUILTIN_PACKS.has(p));
        try {
            await fs.mkdir(path.dirname(this._synthesizedPacksPath), { recursive: true });
            await fs.writeFile(this._synthesizedPacksPath, JSON.stringify(userPacks, null, 2), 'utf-8');
        } catch { /* non-critical */ }
    }

    // ── Debounce helpers ───────────────────────────────────────────────────────

    _pruneRecentTopics() {
        const cutoff = Date.now() - RECENT_TOPIC_TTL_MS;
        for (const [topic, ts] of this._recentTopics) {
            if (ts < cutoff) this._recentTopics.delete(topic);
        }
        // Also cap at max size (evict oldest)
        if (this._recentTopics.size > MAX_RECENT_TOPICS) {
            const sorted = [...this._recentTopics.entries()].sort((a, b) => a[1] - b[1]);
            sorted.slice(0, this._recentTopics.size - MAX_RECENT_TOPICS)
                  .forEach(([k]) => this._recentTopics.delete(k));
        }
    }

    // ── Main API ───────────────────────────────────────────────────────────────

    /**
     * Called after SOMA completes deep curiosity research on a topic.
     * Decides whether to build an expertise pack, and does it.
     */
    async evaluate(topic, researchContext = '') {
        if (!this.brain) return null;
        if (researchContext.length < MIN_RESEARCH_DEPTH) return null;

        const topicKey = topic.toLowerCase();

        // Prune stale debounce entries first
        this._pruneRecentTopics();
        if (this._recentTopics.has(topicKey)) return null;

        // Don't duplicate existing packs
        if ([...this._existingPacks].some(t => topicKey.includes(t))) return null;

        console.log(`[ExpertiseSynthesizer] Evaluating: "${topic}" (${researchContext.length} chars research)`);

        // Step 1 — Ask brain: is this worth a dedicated expertise pack?
        const decisionPrompt = `You are SOMA's capability architect.

SOMA just researched this topic deeply through her own curiosity: "${topic}"

Research context (summary):
${researchContext.substring(0, 800)}

Question: Should SOMA build a dedicated ExpertiseArbiter for this topic?

An ExpertiseArbiter is worth building when the topic:
- Has a clear multi-step analysis pipeline (not just Q&A)
- Would benefit from domain-specific tooling and phases
- Represents a meaningful ongoing capability (not a one-off question)
- Is complex enough to justify a dedicated system

Reply with EXACTLY:
DECISION: YES or NO
REASON: <one sentence>
PACK_NAME: <CamelCase topic name, e.g. RoboticsExpertise, QuantumPhysicsExpertise>
PHASES: <comma-separated list of 4-6 phase names for this domain>`;

        const decision = await this.brain.reason(decisionPrompt, {
            quickResponse: false,
            source: 'expertise_synthesizer'
        }).catch(() => null);

        if (!decision?.text) return null;

        const shouldBuild = /DECISION:\s*YES/i.test(decision.text);
        if (!shouldBuild) {
            console.log(`[ExpertiseSynthesizer] "${topic}" — decided not to build a pack`);
            return null;
        }

        const packName = decision.text.match(/PACK_NAME:\s*(\w+)/i)?.[1]?.trim();
        const phases   = decision.text.match(/PHASES:\s*(.+)/i)?.[1]?.trim()
                            ?.split(',').map(p => p.trim().toUpperCase());

        if (!packName || !phases?.length) return null;

        // Mark as recently evaluated (even if we abort below)
        this._recentTopics.set(topicKey, Date.now());

        // Step 2 — Generate the expertise pack code
        const filename  = `${packName}Arbiter.js`;
        const className = `${packName}Arbiter`;
        const outPath   = path.resolve('arbiters', filename);

        // Don't overwrite existing files
        try {
            await fs.access(outPath);
            console.log(`[ExpertiseSynthesizer] ${filename} already exists — skipping`);
            return null;
        } catch { /* file doesn't exist, proceed */ }

        console.log(`[ExpertiseSynthesizer] 🧬 Generating ${filename}...`);

        const codePrompt = `You are writing a SOMA ExpertiseArbiter in JavaScript (ESM).

Topic: ${topic}
Class name: ${className}
Phases: ${phases.join(', ')}

SOMA's research context:
${researchContext.substring(0, 1000)}

Write a complete ExpertiseArbiter following this EXACT pattern:

\`\`\`javascript
import { ExpertiseBase } from '../core/ExpertiseBase.js';

export class ${className} extends ExpertiseBase {
    constructor(config = {}) {
        super({ ...config, name: '${packName}', category: '${topic}', version: '1.0.0' });
        this._startResearchPulse();
    }

    _startResearchPulse() {
        const check = async () => { /* domain-specific autonomous work */ };
        const t = setInterval(check, 6 * 3600000);
        t.unref();
    }

    async getPhases() {
        return ${JSON.stringify(phases)};
    }

    async onExecutePhase(phase, target) {
        const odin = this.system?.quadBrain?.odin ?? null;
        switch (phase) {
${phases.map(p => `            case '${p}': {
                console.log('[${packName}] Phase: ${p}');
                return { phase: '${p}', status: 'complete' };
            }`).join('\n')}
            default: return super.onExecutePhase(phase, target);
        }
    }
}

export default ${className};
\`\`\`

Now write the REAL implementation. Fill in each phase with genuine domain logic for "${topic}".
Use \`this.system?.quadBrain?.odin\` for AI analysis within phases (null-check it).
Store discoveries via \`this.system?.mnemonicArbiter?.remember()\`.
Each phase should return meaningful data, not placeholders.
Return ONLY the JavaScript code, no markdown fences.`;

        const generated = await this.brain.reason(codePrompt, {
            quickResponse: false,
            source: 'expertise_synthesizer_codegen'
        }).catch(() => null);

        if (!generated?.text || generated.text.length < 200) {
            console.warn(`[ExpertiseSynthesizer] Code generation failed for ${filename}`);
            return null;
        }

        // Strip markdown fences if brain added them
        let code = generated.text
            .replace(/^```javascript\s*/i, '')
            .replace(/^```js\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();

        // Safety: must export the class
        if (!code.includes(`export class ${className}`)) {
            console.warn(`[ExpertiseSynthesizer] Generated code missing export — aborting`);
            return null;
        }

        // Write file
        try {
            await fs.writeFile(outPath, code, 'utf-8');
            console.log(`[ExpertiseSynthesizer] ✅ Written: ${filename}`);
        } catch (e) {
            console.warn(`[ExpertiseSynthesizer] Write failed:`, e.message);
            return null;
        }

        // Step 3 — Hot-load via dynamic import
        // On failure: quarantine to experiments/synthesized/ so bad code doesn't linger in arbiters/
        let loaded = false;
        try {
            const mod = await import(outPath + '?t=' + Date.now());
            const ArbiterClass = mod[className] || mod.default;
            if (ArbiterClass && this.system) {
                const instance = new ArbiterClass({ system: this.system });
                const key = className.charAt(0).toLowerCase() + className.slice(1);
                this.system[key] = instance;
                loaded = true;
                console.log(`[ExpertiseSynthesizer] 🔌 Hot-loaded ${className} → system.${key}`);
            }
        } catch (e) {
            console.warn(`[ExpertiseSynthesizer] Hot-load failed — quarantining bad code:`, e.message);
            try {
                const expDir = path.resolve('experiments', 'synthesized');
                await fs.mkdir(expDir, { recursive: true });
                await fs.rename(outPath, path.join(expDir, filename));
                console.log(`[ExpertiseSynthesizer] 📦 Quarantined: experiments/synthesized/${filename}`);
            } catch (moveErr) {
                console.warn(`[ExpertiseSynthesizer] Quarantine move failed:`, moveErr.message);
                // Leave the file in arbiters/ but it won't be loaded — manual review needed
            }
        }

        // Step 4 — Persist to synthesized-packs.json so we don't re-synthesize after restart
        await this._saveSynthesizedPack(topicKey);

        // Step 5 — Record to WorkingMemory and SOMA memory
        const achievement = `I autonomously built a ${topic} expertise pack (${filename}) from my own curiosity research`;
        this.workingMemory?.setPreoccupation(achievement);
        this.workingMemory?.addAction(`Built ${filename}`, `${phases.length} phases: ${phases.join(', ')}`);

        if (this.memory?.remember) {
            await this.memory.remember(
                `[Self-Created Expertise] ${achievement}. Phases: ${phases.join(', ')}. ${loaded ? 'Hot-loaded.' : 'Quarantined — needs review.'}`,
                { type: 'self_created_expertise', importance: 0.95, topic, filename }
            ).catch(() => {});
        }

        return { filename, className, phases, loaded, topic };
    }
}

export default ExpertiseSynthesizer;
