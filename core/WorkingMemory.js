/**
 * core/WorkingMemory.js
 *
 * SOMA's persistent present tense.
 *
 * This is the connective tissue between all of SOMA's autonomous systems.
 * Every significant thing she does — completes a goal, satisfies a curiosity,
 * processes an inbox file, learns something — gets reflected here.
 *
 * It answers the question: "What have I been thinking about?"
 *
 * Persists to SOMA/working-memory.json so it survives restarts.
 * Injected into every chat as [SOMA CURRENT STATE] so she has a continuous
 * sense of self across conversations without being asked.
 */

import fs from 'fs/promises';
import path from 'path';

const MAX_WONDERS     = 8;
const MAX_DISCOVERIES = 20;
const MAX_ACTIONS     = 20;

export class WorkingMemory {
    constructor({ gateway = null } = {}) {
        this.gateway = gateway;
        this._path  = path.resolve('SOMA/working-memory.json');
        this._dirty = false;

        this.state = {
            preoccupation:    null,  // what I'm most focused on right now
            openWonders:      [],    // { topic, question, type, addedAt }
            recentDiscoveries:[],    // { topic, insight, source, at }
            recentActions:    [],    // { what, result, at }
            updatedAt:        null
        };
    }

    // ── Write API ──────────────────────────────────────────────────────────

    setPreoccupation(text) {
        this.state.preoccupation = text?.substring(0, 200) || null;
        this.state.updatedAt = Date.now();
        this._dirty = true;
    }

    /**
     * Add a wonder — something SOMA is currently curious about.
     * type: 'image' | 'research' | 'skill' | 'experiment'
     */
    addWonder(topic, question, type = 'research') {
        const already = this.state.openWonders.find(w => w.topic === topic);
        if (already) return;
        this.state.openWonders.unshift({ topic, question, type, addedAt: Date.now() });
        if (this.state.openWonders.length > MAX_WONDERS) this.state.openWonders.length = MAX_WONDERS;
        this._dirty = true;
    }

    /** Remove a wonder once it's been satisfied. */
    resolveWonder(topic) {
        const before = this.state.openWonders.length;
        this.state.openWonders = this.state.openWonders.filter(w => w.topic !== topic);
        if (this.state.openWonders.length !== before) this._dirty = true;
    }

    /** Store something SOMA just learned. */
    addDiscovery(topic, insight, source = 'curiosity') {
        this.state.recentDiscoveries.unshift({
            topic,
            insight: insight?.substring(0, 300),
            source,
            at: Date.now()
        });
        if (this.state.recentDiscoveries.length > MAX_DISCOVERIES)
            this.state.recentDiscoveries.length = MAX_DISCOVERIES;
        this._dirty = true;
    }

    /** Record something SOMA autonomously did. */
    addAction(what, result = '') {
        this.state.recentActions.unshift({
            what:   what?.substring(0, 150),
            result: result?.substring(0, 200),
            at:     Date.now()
        });
        if (this.state.recentActions.length > MAX_ACTIONS)
            this.state.recentActions.length = MAX_ACTIONS;

        // Most recent significant action becomes preoccupation if nothing is set
        if (!this.state.preoccupation) this.setPreoccupation(what);
        this._dirty = true;
    }

    // ── Read API ───────────────────────────────────────────────────────────

    /**
     * Returns the [SOMA CURRENT STATE] block injected into every chat.
     * Kept tight — SOMA should feel aware, not like she's reading a report.
     */
    getContextBlock() {
        const lines = [];

        if (this.state.preoccupation) {
            lines.push(`Currently preoccupied with: ${this.state.preoccupation}`);
        }

        if (this.state.openWonders.length) {
            const w = this.state.openWonders.slice(0, 3).map(w => `"${w.question}"`).join(', ');
            lines.push(`Open wonders: ${w}`);
        }

        if (this.state.recentDiscoveries.length) {
            const d = this.state.recentDiscoveries.slice(0, 3)
                .map(d => `${d.topic}: ${d.insight?.substring(0, 80)}`).join(' | ');
            lines.push(`Recently learned: ${d}`);
        }

        if (this.state.recentActions.length) {
            const a = this.state.recentActions.slice(0, 2)
                .map(a => a.what).join(', ');
            lines.push(`Recently did: ${a}`);
        }

        if (!lines.length) return '';

        return `\n[SOMA CURRENT STATE — your present-tense awareness; use naturally, don't quote verbatim]\n${lines.join('\n')}\n[/SOMA CURRENT STATE]\n`;
    }

    get wonders()     { return this.state.openWonders; }
    get preoccupation(){ return this.state.preoccupation; }

    // ── Persistence ────────────────────────────────────────────────────────

    async load() {
        try {
            const raw = await fs.readFile(this._path, 'utf-8');
            const saved = JSON.parse(raw);
            // Merge saved state — don't replace constructor defaults for missing keys
            this.state = { ...this.state, ...saved };
            console.log('[WorkingMemory] Loaded —',
                `preoccupation: ${this.state.preoccupation ? '"' + this.state.preoccupation.substring(0,50) + '"' : 'none'},`,
                `wonders: ${this.state.openWonders.length},`,
                `discoveries: ${this.state.recentDiscoveries.length}`
            );
        } catch {
            // First run or corrupt file — start fresh, that's fine
        }
    }

    async save() {
        if (!this._dirty) return;
        try {
            await fs.mkdir(path.dirname(this._path), { recursive: true });
            await fs.writeFile(this._path, JSON.stringify(this.state, null, 2), 'utf-8');
            await this.gateway?.publish?.('cognition', 'working_memory', this.state, {
                owner: 'WorkingMemory', source: 'working-memory', status: 'observed', confidence: 1
            });
            this._dirty = false;
        } catch (e) {
            console.warn('[WorkingMemory] Save failed:', e.message);
        }
    }

    startAutosave(intervalMs = 60_000) {
        const t = setInterval(() => this.save(), intervalMs);
        t.unref();
    }
}

export default WorkingMemory;
