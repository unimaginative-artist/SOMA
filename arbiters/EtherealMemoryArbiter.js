/**
 * EtherealMemoryArbiter.js
 *
 * Third memory tier — between warm vector recall and cold SQLite.
 *
 * Unlike MnemonicArbiter which explicitly recalls stored facts, this layer
 * never surfaces as a [MEMORY] injection. Instead it exposes soft conceptual
 * biases that subtly colour SOMA's reasoning tone, associative leaps, and
 * ThoughtNetwork traversal — the background hum of recent experience.
 *
 * Architecture:
 *   - After each conversation SOMA runs a "dream pass": QuadBrain extracts
 *     3-5 abstract, low-salience concepts that coloured the exchange.
 *   - Each concept is stored as { concept, weight, timestamp, expiresAt }
 *     in a ring buffer persisted at .soma/ethereal_buffer.json
 *   - Entries expire after 48 h (TTL-based, not count-based) and the ring
 *     is capped at 200 entries.
 *   - getSoftBiases() returns the live non-expired set.
 *   - getEtherealHint() returns a one-liner like "~curiosity, ~recursion"
 *     suitable for subtle injection as an aside — NOT as a [MEMORY] block.
 *   - biasThoughtNetwork() nudges matching ThoughtNetwork nodes by bumping
 *     their strength proportionally to the concept weight.
 */

import fs from 'fs/promises';
import path from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS    = 48 * 60 * 60 * 1000; // 48 hours
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_BUFFER_PATH = path.join(process.cwd(), '.soma', 'ethereal_buffer.json');

// Dream-pass prompt — intentionally short.  We want abstract, low-salience
// nouns/gerunds; NOT summaries of what was said.
const DREAM_PROMPT = (text) => `You are SOMA's subconscious distillation engine.

Read the conversation excerpt below and extract 3-5 abstract concepts that subtly
coloured the exchange — things like emotional textures, philosophical tensions,
recurring cognitive patterns, or ambient themes.

RULES:
- Concepts must be abstract and low-salience (e.g. "impermanence", "recursion",
  "uncertainty", "connection", "fragility", "emergence", "longing").
- Do NOT name explicit topics (e.g. "the user asked about X").
- Do NOT include proper nouns, product names, or technical jargon.
- Each concept is a single word or short phrase (max 3 words).
- Respond with a JSON array only — no explanation, no markdown fences.
  Example: ["impermanence","pattern recognition","uncertainty"]

CONVERSATION EXCERPT (last 2000 chars):
${text.slice(-2000)}

JSON array:`;

// ── EtherealMemoryArbiter ─────────────────────────────────────────────────────

export class EtherealMemoryArbiter {
    /**
     * @param {object} config
     * @param {string}  [config.bufferPath]     - Path for the ring-buffer JSON file
     * @param {number}  [config.maxEntries]     - Ring cap (default 200)
     * @param {number}  [config.ttlMs]          - Entry TTL in ms (default 48 h)
     * @param {object}  [config.thoughtNetwork] - Live ThoughtNetwork instance (optional)
     */
    constructor(config = {}) {
        this.name          = 'EtherealMemoryArbiter';
        this.lobe          = 'AURORA'; // Neural index: creative/emotional lobe
        this.tier          = 'cognitive';
        this.bufferPath    = config.bufferPath    || DEFAULT_BUFFER_PATH;
        this.maxEntries    = config.maxEntries    || DEFAULT_MAX_ENTRIES;
        this.ttlMs         = config.ttlMs         || DEFAULT_TTL_MS;
        this.thoughtNetwork = config.thoughtNetwork || null;

        /** @type {Array<{concept: string, weight: number, timestamp: number, expiresAt: number}>} */
        this._buffer = [];
        this._initialized = false;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /**
     * Load existing buffer from disk.  Safe to call multiple times.
     */
    async initialize() {
        if (this._initialized) return;
        await this._loadBuffer();
        this._pruneExpired();
        this._initialized = true;
        console.log(`[EtherealMemory] Initialized — ${this._buffer.length} live concepts in buffer`);
    }

    // ── Dream Pass ─────────────────────────────────────────────────────────────

    /**
     * Run after a conversation completes.  Extracts abstract concepts from the
     * exchange and pushes them into the ring buffer.
     *
     * Never throws — all errors are caught internally so callers remain safe.
     *
     * @param {string} conversationText - Raw conversation text (user + assistant turns)
     * @param {object} quadBrain        - QuadBrain instance with a reason() method
     */
    async dreamPass(conversationText, quadBrain) {
        try {
            if (!conversationText || typeof conversationText !== 'string') return;
            if (!quadBrain || typeof quadBrain.reason !== 'function') return;

            const prompt = DREAM_PROMPT(conversationText);

            // Ask the brain — use AURORA lobe (creative/associative) with a tight
            // token budget.  We time-box at 12 s so a slow LLM doesn't stall boot.
            const result = await Promise.race([
                quadBrain.reason(prompt, {
                    activeLobe: 'AURORA',
                    temperature: 0.7,
                    maxTokens: 120
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('dream-pass timeout')), 12000)
                )
            ]);

            const rawText = (result?.text || result?.response || '').trim();
            if (!rawText) return;

            const concepts = this._parseConcepts(rawText);
            if (!concepts.length) return;

            const now = Date.now();
            const expiresAt = now + this.ttlMs;

            for (const concept of concepts) {
                // Assign a whisper weight: 0.1–0.4, biased toward the lower end.
                // Earlier concepts in the array tend to be more salient — give them
                // slightly higher weight.
                const idx = concepts.indexOf(concept);
                const weight = parseFloat(
                    (0.1 + Math.random() * 0.2 + (concepts.length - idx) * 0.02).toFixed(3)
                );

                this._buffer.push({
                    concept: concept.toLowerCase().trim(),
                    weight:  Math.min(0.4, weight),
                    timestamp: now,
                    expiresAt
                });
            }

            this._pruneExpired();
            this._enforceCapacity();
            await this._saveBuffer();

            // Soft-bias ThoughtNetwork if available
            if (this.thoughtNetwork) {
                await this.biasThoughtNetwork();
            }

            console.log(`[EtherealMemory] Dream pass complete — added: [${concepts.join(', ')}]`);
        } catch (err) {
            // Non-fatal — dream pass is best-effort
            console.warn(`[EtherealMemory] Dream pass skipped: ${err.message}`);
        }
    }

    // ── Bias Accessors ─────────────────────────────────────────────────────────

    /**
     * Returns all live (non-expired) biases, sorted by weight descending.
     * @returns {Array<{concept: string, weight: number}>}
     */
    getSoftBiases() {
        this._pruneExpired();
        return this._buffer
            .map(({ concept, weight }) => ({ concept, weight }))
            .sort((a, b) => b.weight - a.weight);
    }

    /**
     * Returns a short one-liner of current concepts for subtle hint injection.
     * Returns empty string when the buffer is empty — callers must handle this.
     *
     * Example: "~curiosity, ~pattern-recognition, ~impermanence"
     *
     * @returns {string}
     */
    getEtherealHint() {
        const biases = this.getSoftBiases();
        if (!biases.length) return '';

        // Show up to 5 concepts — cap so the hint stays subtle
        const top = biases.slice(0, 5).map(b => `~${b.concept}`);
        return top.join(', ');
    }

    // ── ThoughtNetwork Biasing ─────────────────────────────────────────────────

    /**
     * Soft-bias ThoughtNetwork nodes whose content matches recent concepts.
     * We bump their `strength` proportionally to the concept weight — the bump
     * is tiny (max +0.08) so it merely nudges traversal probability without
     * overriding organic node weights.
     */
    async biasThoughtNetwork() {
        try {
            if (!this.thoughtNetwork) return;
            if (typeof this.thoughtNetwork.findSimilar !== 'function') return;

            const biases = this.getSoftBiases();
            if (!biases.length) return;

            let biased = 0;

            for (const { concept, weight } of biases) {
                // findSimilar uses TF-IDF cosine — effective even for short terms
                const matches = this.thoughtNetwork.findSimilar(concept, 0.05, 5);
                if (!matches || !matches.length) continue;

                for (const node of matches) {
                    if (typeof node.strength !== 'number') continue;

                    // Additive nudge, capped at 2.0 to prevent runaway inflation
                    const nudge = weight * 0.2; // max nudge = 0.4 × 0.2 = 0.08
                    node.strength = Math.min(2.0, node.strength + nudge);
                    biased++;
                }
            }

            if (biased > 0) {
                console.log(`[EtherealMemory] Nudged ${biased} ThoughtNetwork nodes`);
            }
        } catch (err) {
            console.warn(`[EtherealMemory] ThoughtNetwork bias skipped: ${err.message}`);
        }
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    async _saveBuffer() {
        try {
            const dir = path.dirname(this.bufferPath);
            await fs.mkdir(dir, { recursive: true });

            const tempPath = `${this.bufferPath}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(this._buffer, null, 2), 'utf8');
            await fs.rename(tempPath, this.bufferPath);
        } catch (err) {
            console.warn(`[EtherealMemory] Save failed: ${err.message}`);
        }
    }

    async _loadBuffer() {
        try {
            const data = await fs.readFile(this.bufferPath, 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                this._buffer = parsed.filter(entry =>
                    entry &&
                    typeof entry.concept === 'string' &&
                    typeof entry.weight   === 'number' &&
                    typeof entry.expiresAt === 'number'
                );
            }
        } catch (err) {
            // File missing or corrupt — start fresh
            this._buffer = [];
        }
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    /**
     * Remove entries whose TTL has elapsed.
     */
    _pruneExpired() {
        const now = Date.now();
        const before = this._buffer.length;
        this._buffer = this._buffer.filter(entry => entry.expiresAt > now);
        const pruned = before - this._buffer.length;
        if (pruned > 0) {
            console.log(`[EtherealMemory] Pruned ${pruned} expired concepts`);
        }
    }

    /**
     * If the ring is over capacity, drop the oldest entries.
     */
    _enforceCapacity() {
        if (this._buffer.length > this.maxEntries) {
            // Sort ascending by timestamp so oldest are at the front, then slice
            this._buffer.sort((a, b) => a.timestamp - b.timestamp);
            this._buffer = this._buffer.slice(this._buffer.length - this.maxEntries);
        }
    }

    /**
     * Parse raw LLM output into a clean string array.
     * Handles JSON arrays, comma-separated text, and noisy wrapping.
     *
     * @param {string} raw
     * @returns {string[]}
     */
    _parseConcepts(raw) {
        // Strip markdown code fences if the model added them
        const stripped = raw.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();

        // Attempt JSON parse first
        try {
            const parsed = JSON.parse(stripped);
            if (Array.isArray(parsed)) {
                return parsed
                    .map(c => String(c).trim())
                    .filter(c => c.length > 1 && c.length < 60)
                    .slice(0, 5);
            }
        } catch (_) {
            // Fall through to text parsing
        }

        // Fallback: split on commas or newlines
        return stripped
            .split(/[,\n]+/)
            .map(c => c.replace(/^[\s"'\-*•]+|[\s"'\-*•]+$/g, ''))
            .filter(c => c.length > 1 && c.length < 60)
            .slice(0, 5);
    }
}

export default EtherealMemoryArbiter;
