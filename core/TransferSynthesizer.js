// ═══════════════════════════════════════════════════════════════════════════
// TransferSynthesizer.js — Cross-Domain Intelligence Transfer
//
// SOMA has 121 domain-specific arbiters but they don't share learnings.
// A strategy learned in trading doesn't flow to coding, and vice versa.
//
// This module:
//   1. Monitors successful strategies across ALL domains
//   2. Abstracts them into domain-independent patterns via brain call
//   3. Probes whether the abstract pattern applies to a different domain
//   4. Commits successful transfers to the AbstractionArbiter / memory
//   5. Compounds: transfers become new inputs for future synthesis
//
// Example:
//   Trading: "reduce position size when uncertainty is high"
//   → Code: "reduce scope of change when requirements are unclear"
//   → Memory: "lower confidence threshold for recalls older than 7 days"
//
// Persists to server/.soma/transfers.json
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const TRANSFERS_FILE  = path.join(__dirname, '..', 'server', '.soma', 'transfers.json');
const MAX_TRANSFERS   = 200;
const MAX_PATTERNS    = 100;

// Known domains SOMA operates in — used for cross-domain probing
const DOMAINS = ['trading', 'coding', 'research', 'memory', 'reasoning', 'planning', 'learning'];

export class TransferSynthesizer {
    constructor({ system, brain } = {}) {
        this.system    = system || null;
        this.brain     = brain  || null;
        this._patterns  = [];   // abstract patterns extracted from successes
        this._transfers = [];   // successful cross-domain transfers
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        try {
            await fs.mkdir(path.dirname(TRANSFERS_FILE), { recursive: true });
            const raw  = await fs.readFile(TRANSFERS_FILE, 'utf8').catch(() => '{}');
            const data = JSON.parse(raw);
            this._patterns  = data.patterns  || [];
            this._transfers = data.transfers || [];
        } catch {
            this._patterns  = [];
            this._transfers = [];
        }
        console.log(`[TransferSynthesizer] 🔀 Ready — ${this._patterns.length} patterns, ${this._transfers.length} transfers`);
        return this;
    }

    // ─── Extract an abstract pattern from a domain success ────────────────
    /**
     * @param {string} domain - e.g. 'trading', 'coding'
     * @param {object} successRecord - { description, outcome, context }
     * @returns {object|null} the extracted pattern, or null
     */
    async extractPattern(domain, successRecord) {
        if (!this.brain) return null;

        const prompt = `A strategy succeeded in the "${domain}" domain. Extract the abstract, domain-independent principle.

SUCCESS RECORD:
Domain: ${domain}
Description: ${(successRecord.description || '').slice(0, 300)}
Outcome: ${(successRecord.outcome || '').slice(0, 200)}

Extract the ABSTRACT principle — the universal rule that made this work, not the domain-specific details.
Return ONLY JSON:
{
  "principle": "one sentence: the universal rule",
  "trigger": "when to apply this principle (domain-agnostic)",
  "anti_trigger": "when NOT to apply this principle",
  "confidence": 0.0-1.0
}`;

        try {
            const result = await this.brain.reason(prompt, {
                localModel: true,
                systemOverride: 'You are a meta-learning system extracting transferable principles. Be concise and abstract.',
            });

            const match = (result.text || '').match(/\{[\s\S]*?\}/);
            if (!match) return null;

            const pattern = JSON.parse(match[0]);
            if (!pattern.principle || pattern.confidence < 0.5) return null;

            const entry = {
                id:         `pat_${Date.now()}`,
                sourceDomain: domain,
                principle:  pattern.principle,
                trigger:    pattern.trigger || '',
                anti_trigger: pattern.anti_trigger || '',
                confidence: pattern.confidence,
                successRecord: { description: (successRecord.description || '').slice(0, 200) },
                createdAt:  Date.now(),
                usedCount:  0,
            };

            // Upsert by principle similarity (simple: exact principle match)
            const existing = this._patterns.find(p => p.principle === entry.principle);
            if (existing) {
                existing.usedCount++;
                existing.confidence = Math.min(1, existing.confidence + 0.05);
            } else {
                this._patterns.push(entry);
                if (this._patterns.length > MAX_PATTERNS) {
                    // Drop lowest-confidence pattern
                    this._patterns.sort((a, b) => b.confidence - a.confidence);
                    this._patterns.pop();
                }
            }

            this._persist().catch(() => {});
            return existing || entry;

        } catch { return null; }
    }

    // ─── Probe whether a pattern applies to a target domain ───────────────

    async probe(pattern, targetDomain) {
        if (!this.brain || !pattern) return { applicable: false };
        if (pattern.sourceDomain === targetDomain) return { applicable: false };

        const prompt = `Does this abstract principle apply in the "${targetDomain}" domain?

PRINCIPLE: ${pattern.principle}
TRIGGER: ${pattern.trigger}
ANTI-TRIGGER: ${pattern.anti_trigger}

Think of a concrete example where this principle would help in "${targetDomain}".
Return ONLY JSON:
{
  "applicable": true/false,
  "example": "concrete example in ${targetDomain}",
  "confidence": 0.0-1.0
}`;

        try {
            const result = await this.brain.reason(prompt, {
                localModel: true,
                systemOverride: 'You are testing if a universal principle transfers across domains.',
            });

            const match = (result.text || '').match(/\{[\s\S]*?\}/);
            if (!match) return { applicable: false };

            const probe = JSON.parse(match[0]);
            return {
                applicable: probe.applicable && probe.confidence >= 0.55,
                example:    probe.example || '',
                confidence: probe.confidence || 0,
            };

        } catch { return { applicable: false }; }
    }

    // ─── Commit a successful transfer ─────────────────────────────────────

    async transfer(pattern, targetDomain, probeResult) {
        const entry = {
            id:           `xfr_${Date.now()}`,
            patternId:    pattern.id,
            sourceDomain: pattern.sourceDomain,
            targetDomain,
            principle:    pattern.principle,
            example:      probeResult.example || '',
            confidence:   probeResult.confidence || 0,
            createdAt:    Date.now(),
        };

        this._transfers.push(entry);
        if (this._transfers.length > MAX_TRANSFERS) this._transfers.shift();

        // Store in SOMA's long-term memory so other arbiters can benefit
        const mn = this.system?.mnemonicArbiter || this.system?.mnemonic;
        if (mn?.remember) {
            await mn.remember(
                `Transfer insight [${pattern.sourceDomain} → ${targetDomain}]: ${pattern.principle}. Example: ${entry.example}`,
                { type: 'transfer_insight', domain: targetDomain, importance: 7 }
            ).catch(() => {});
        }

        console.log(`[TransferSynthesizer] ✅ Transfer: [${pattern.sourceDomain} → ${targetDomain}] "${pattern.principle.slice(0, 60)}"`);
        this._persist().catch(() => {});
        return entry;
    }

    // ─── Run one full cross-domain synthesis pass ─────────────────────────
    /**
     * Picks up to 3 promising patterns and probes them against domains
     * they haven't been transferred to yet. Commits successful probes.
     * Returns the number of new transfers made.
     */
    async synthesizeCross() {
        if (!this.brain || this._patterns.length === 0) return 0;

        // Pick top patterns by confidence × usedCount
        const candidates = [...this._patterns]
            .sort((a, b) => (b.confidence * (b.usedCount + 1)) - (a.confidence * (a.usedCount + 1)))
            .slice(0, 5);

        let newTransfers = 0;

        for (const pattern of candidates) {
            // Find domains this pattern hasn't been transferred to
            const done = new Set(
                this._transfers
                    .filter(t => t.patternId === pattern.id)
                    .map(t => t.targetDomain)
            );
            done.add(pattern.sourceDomain);

            const targets = DOMAINS.filter(d => !done.has(d));
            if (targets.length === 0) continue;

            // Probe the most different domain first
            const target = targets[Math.floor(Math.random() * targets.length)];
            const probe  = await this.probe(pattern, target);

            if (probe.applicable) {
                await this.transfer(pattern, target, probe);
                newTransfers++;
                pattern.usedCount++;
            }

            // Don't flood the brain — max 1 transfer per synthesizeCross() call
            if (newTransfers >= 1) break;
        }

        return newTransfers;
    }

    // ─── Feed a success from any domain into pattern extraction ──────────

    async onSuccess(domain, description, outcome) {
        return this.extractPattern(domain, { description, outcome });
    }

    // ─── Inspect ──────────────────────────────────────────────────────────

    getTransfers() {
        return this._transfers.slice().reverse();
    }

    getPatterns() {
        return [...this._patterns].sort((a, b) => b.confidence - a.confidence);
    }

    getStatus() {
        return {
            patterns:         this._patterns.length,
            transfers:        this._transfers.length,
            topPatterns:      this._patterns.slice(0, 3).map(p => p.principle.slice(0, 80)),
            recentTransfers:  this._transfers.slice(-3).map(t => `${t.sourceDomain}→${t.targetDomain}: ${t.principle.slice(0, 60)}`),
        };
    }

    // ─── Persistence ──────────────────────────────────────────────────────

    async _persist() {
        try {
            await fs.writeFile(TRANSFERS_FILE, JSON.stringify({
                patterns:  this._patterns,
                transfers: this._transfers,
            }, null, 2));
        } catch { /* non-fatal */ }
    }
}
