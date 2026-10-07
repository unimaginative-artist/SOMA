/**
 * arbiters/KnowledgeCuratorArbiter.js
 *
 * Auto-files structured knowledge into lobe-specific MD libraries.
 * These libraries are SOMA's training dataset for future LoRA fine-tuning.
 *
 * Subscribes to signals and classifies each into a lobe:
 *   LOGOS     — engineering, code, architecture, debugging
 *   AURORA    — voice, tone, creativity, personality
 *   PROMETHEUS — goals, strategy, plans, outcomes
 *   THALAMUS  — security, risk, anomalies, policy
 *
 * Emits:
 *   knowledge.filed         — whenever a new entry is written
 *   training.threshold.approaching — when a lobe hits 75% of threshold
 *   training.threshold.ready — when a lobe hits 100 entries (training can begin)
 */

import { promises as fs } from 'fs';
import path from 'path';

const KNOWLEDGE_ROOT = path.join(process.cwd(), 'knowledge');
const TRAINING_THRESHOLDS = {
    logos: Number(process.env.SOMA_TRAINING_THRESHOLD_LOGOS || 120),
    aurora: Number(process.env.SOMA_TRAINING_THRESHOLD_AURORA || 180),
    prometheus: Number(process.env.SOMA_TRAINING_THRESHOLD_PROMETHEUS || 140),
    thalamus: Number(process.env.SOMA_TRAINING_THRESHOLD_THALAMUS || 75),
};
const TRAINING_THRESHOLD = 100;

// ── Routing table: signal type → lobe + entry type ──────────────────────────
const SIGNAL_ROUTES = {
    'swarm.experience':           { lobe: 'logos',      type: 'swarm_outcome' },
    'insight.generated':          { lobe: 'logos',      type: 'insight' },      // reclassified below by content
    'swarm.optimization.needed':  { lobe: 'logos',      type: 'swarm_outcome' },
    'swarm.discovery.ideas':      { lobe: 'logos',      type: 'architecture_decision' },
    'goal.created':               { lobe: 'prometheus',  type: 'goal_outcome' },
    'goal.completed':             { lobe: 'prometheus',  type: 'goal_outcome' },
    'goal.failed':                { lobe: 'prometheus',  type: 'goal_outcome' },
    'experiment.result':          { lobe: 'prometheus',  type: 'plan_retrospective' },
    'health.warning':             { lobe: 'thalamus',    type: 'health_event' },
    'diagnostic.anomaly':         { lobe: 'thalamus',    type: 'anomaly' },
    'capability.degraded':        { lobe: 'thalamus',    type: 'anomaly' },
    'capability.restored':        { lobe: 'thalamus',    type: 'anomaly' },
    'context_primed':             { lobe: 'logos',       type: 'insight' },
    'location_changed':           { lobe: 'aurora',      type: 'narrative_frame' },
    'person_recognized':          { lobe: 'aurora',      type: 'voice_sample' },
};

// Keywords that override lobe classification for `insight.generated`
const LOBE_KEYWORDS = {
    logos:      ['code', 'bug', 'refactor', 'architecture', 'api', 'function', 'module', 'file', 'debug', 'error', 'fix', 'build', 'deploy', 'test', 'import', 'class', 'method', 'arbiter'],
    aurora:     ['feel', 'tone', 'voice', 'creative', 'emotion', 'personality', 'vibe', 'style', 'narrative', 'soul', 'beautiful', 'aesthetic', 'art', 'music', 'city', 'dream'],
    prometheus: ['goal', 'plan', 'strategy', 'decision', 'risk', 'reward', 'priority', 'tradeoff', 'outcome', 'milestone', 'roadmap', 'launch', 'market', 'business', 'growth'],
    thalamus:   ['security', 'threat', 'anomaly', 'warning', 'policy', 'breach', 'token', 'key', 'auth', 'permission', 'attack', 'vulnerability', 'incident', 'block', 'deny'],
};

export class KnowledgeCuratorArbiter {
    constructor(opts = {}) {
        this.name = 'KnowledgeCuratorArbiter';
        this.messageBroker = opts.messageBroker || null;

        // Track entry counts per lobe (kept in memory; re-synced from disk on init)
        this._counts = { logos: 0, aurora: 0, prometheus: 0, thalamus: 0 };
        // Track which thresholds already fired so we don't spam signals
        this._thresholdFired = { logos: new Set(), aurora: new Set(), prometheus: new Set(), thalamus: new Set() };

        // Debounce: don't file duplicate entries within 5s for the same signal type
        this._lastFiled = new Map();   // signalType → timestamp
        this._dedupWindowMs = 5000;

        if (this.messageBroker) {
            this._subscribe();
        }

        console.log('[KnowledgeCuratorArbiter] 📚 Knowledge library curator online');
        this._syncCountsFromDisk().catch(() => {});
    }

    _subscribe() {
        for (const signalType of Object.keys(SIGNAL_ROUTES)) {
            try {
                this.messageBroker.subscribe(signalType, (envelope) => {
                    const payload = envelope?.payload || envelope || {};
                    this._onSignal(signalType, payload).catch(e =>
                        console.warn(`[KnowledgeCuratorArbiter] Error filing ${signalType}:`, e.message)
                    );
                });
            } catch (e) {
                console.warn(`[KnowledgeCuratorArbiter] Could not subscribe to ${signalType}:`, e.message);
            }
        }
    }

    // ── Signal Handler ────────────────────────────────────────────────────────

    async _onSignal(signalType, payload) {
        // Deduplicate rapid-fire signals — key on signalType + unique identifier
        // so multiple real events of the same type within 5s aren't dropped
        const now = Date.now();
        const dedupId = payload.filepath || payload.goalId || payload.experimentId
            || payload.insight?.substring(0, 40) || payload.issue || signalType;
        const dedupKey = `${signalType}::${dedupId}`;
        const lastAt = this._lastFiled.get(dedupKey) || 0;
        if (now - lastAt < this._dedupWindowMs) return;
        this._lastFiled.set(dedupKey, now);

        const route = SIGNAL_ROUTES[signalType];
        if (!route) return;

        let { lobe, type } = route;

        // For insight.generated, reclassify by content keywords
        if (signalType === 'insight.generated') {
            const text = (payload.insight || payload.content || '').toLowerCase();
            lobe = this._classifyByContent(text) || lobe;
        }

        const content = this._buildContent(signalType, payload);
        if (!content) return;

        await this._fileEntry(lobe, type, content, signalType, now);
    }

    // ── Content Builder ───────────────────────────────────────────────────────

    _buildContent(signalType, payload) {
        switch (signalType) {
            case 'swarm.experience': {
                const { filepath, success, summary, error } = payload;
                if (!filepath) return null;
                return [
                    `**File:** ${filepath}`,
                    `**Result:** ${success ? 'SUCCESS' : 'FAILURE'}`,
                    summary ? `**Summary:** ${summary}` : null,
                    error ? `**Error:** ${error}` : null,
                ].filter(Boolean).join('\n');
            }

            case 'insight.generated': {
                const insight = payload.insight || payload.content;
                if (!insight || insight.length < 20) return null;
                return `**Insight:** ${insight}\n\n**Source:** ${payload.source || 'synthesis'}`;
            }

            case 'goal.created':
            case 'goal.completed':
            case 'goal.failed': {
                const { title, category, priority, outcome, reason } = payload;
                if (!title) return null;
                const lines = [`**Goal:** ${title}`];
                if (category) lines.push(`**Category:** ${category}`);
                if (priority) lines.push(`**Priority:** ${priority}`);
                if (outcome) lines.push(`**Outcome:** ${outcome}`);
                if (reason) lines.push(`**Reason:** ${reason}`);
                return lines.join('\n');
            }

            case 'experiment.result': {
                const { experimentId, success, filepath, note } = payload;
                if (!experimentId) return null;
                return [
                    `**Experiment:** ${experimentId}`,
                    `**Result:** ${success ? 'SUCCESS' : 'FAILURE'}`,
                    filepath ? `**File:** ${filepath}` : null,
                    note ? `**Note:** ${note}` : null,
                ].filter(Boolean).join('\n');
            }

            case 'health.warning': {
                const { issue, details } = payload;
                if (!issue) return null;
                return `**Issue:** ${issue}\n\n**Details:** ${JSON.stringify(details || {})}`;
            }

            case 'diagnostic.anomaly': {
                const { component, issue, severity } = payload;
                if (!component && !issue) return null;
                return `**Component:** ${component || 'unknown'}\n**Issue:** ${issue || 'unknown'}\n**Severity:** ${severity || 'unknown'}`;
            }

            case 'capability.degraded':
            case 'capability.restored': {
                const { capability, note, recommendation } = payload;
                if (!capability) return null;
                const status = signalType === 'capability.restored' ? 'RESTORED' : 'DEGRADED';
                return [
                    `**Capability:** ${capability}`,
                    `**Status:** ${status}`,
                    note ? `**Note:** ${note}` : null,
                    recommendation ? `**Fix:** ${recommendation}` : null,
                ].filter(Boolean).join('\n');
            }

            case 'swarm.discovery.ideas': {
                const ideas = payload.ideas || [];
                if (!ideas.length) return null;
                return `**Discovery Ideas:**\n${ideas.map(i => `- ${i.name || i.title || JSON.stringify(i)}`).join('\n')}`;
            }

            case 'context_primed': {
                const { contextType, triggerLabel } = payload;
                if (!contextType) return null;
                return `**Context:** ${contextType}\n**Trigger:** ${triggerLabel}`;
            }

            case 'location_changed': {
                const { location, oldLocation, type } = payload;
                if (!location?.name) return null;
                return `**Location ${type || 'change'}:** ${oldLocation?.name || 'unknown'} → ${location.name}`;
            }

            case 'person_recognized': {
                const { name, confidence } = payload;
                if (!name) return null;
                return `**Person recognized:** ${name} (confidence: ${(confidence || 0).toFixed(2)})`;
            }

            default:
                return null;
        }
    }

    // ── Lobe Classifier (content-based) ──────────────────────────────────────

    _classifyByContent(text) {
        const scores = {};
        for (const [lobe, keywords] of Object.entries(LOBE_KEYWORDS)) {
            scores[lobe] = keywords.filter(kw => text.includes(kw)).length;
        }
        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        return best[1] > 0 ? best[0] : null;
    }

    // ── File Entry ────────────────────────────────────────────────────────────

    async _fileEntry(lobe, type, content, signalType, timestamp) {
        const dir = path.join(KNOWLEDGE_ROOT, lobe);
        await fs.mkdir(dir, { recursive: true });

        const ts = new Date(timestamp);
        const dateStr = ts.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${dateStr}_${type}.md`;
        const filepath = path.join(dir, filename);

        const frontmatter = [
            '---',
            `lobe: ${lobe}`,
            `type: ${type}`,
            `source: ${signalType}`,
            `timestamp: ${ts.toISOString()}`,
            '---',
            '',
        ].join('\n');

        await fs.writeFile(filepath, frontmatter + content + '\n');

        // Update count
        this._counts[lobe] = (this._counts[lobe] || 0) + 1;
        const count = this._counts[lobe];

        // Emit filed signal
        if (this.messageBroker) {
            this.messageBroker.publish('knowledge.filed', {
                lobe,
                type,
                filepath: filename,
                count,
            }).catch(() => {});
        }

        // Check thresholds
        this._checkThresholds(lobe, count);

        console.log(`[KnowledgeCuratorArbiter] 📝 Filed → ${lobe}/${filename} (${count} entries)`);
    }

    // ── Threshold Signals ─────────────────────────────────────────────────────

    _checkThresholds(lobe, count) {
        if (!this.messageBroker) return;
        const threshold = TRAINING_THRESHOLDS[lobe] || TRAINING_THRESHOLD;
        const approachThreshold = Math.floor(threshold * 0.75);

        if (count >= threshold && !this._thresholdFired[lobe].has('ready')) {
            this._thresholdFired[lobe].add('ready');
            console.log(`[KnowledgeCuratorArbiter] 🎓 ${lobe.toUpperCase()} training dataset READY (${count} entries)`);
            this.messageBroker.publish('training.threshold.ready', {
                lobe,
                count,
                threshold,
                knowledgeDir: path.join(KNOWLEDGE_ROOT, lobe),
                message: `${lobe.toUpperCase()} lobe has ${count} training entries — LoRA fine-tune can begin`,
            }).catch(() => {});
        } else if (count >= approachThreshold && !this._thresholdFired[lobe].has('approaching')) {
            this._thresholdFired[lobe].add('approaching');
            const remaining = threshold - count;
            console.log(`[KnowledgeCuratorArbiter] 📊 ${lobe.toUpperCase()} approaching training threshold (${count}/${threshold})`);
            this.messageBroker.publish('training.threshold.approaching', {
                lobe,
                count,
                threshold,
                remaining,
                message: `${lobe.toUpperCase()} needs ${remaining} more entries before LoRA training`,
            }).catch(() => {});
        }
    }

    // ── Disk Sync ─────────────────────────────────────────────────────────────

    async _syncCountsFromDisk() {
        for (const lobe of Object.keys(this._counts)) {
            try {
                const dir = path.join(KNOWLEDGE_ROOT, lobe);
                // Recurse into subdirectories (e.g. yumyums/) so sprouts are counted
                const files = await fs.readdir(dir, { recursive: true });
                this._counts[lobe] = files.filter(f => f.endsWith('.md') && !f.endsWith('README.md')).length;
            } catch {
                this._counts[lobe] = 0;
            }
        }
        console.log('[KnowledgeCuratorArbiter] 📚 Entry counts synced from disk:', this._counts);
        for (const [lobe, count] of Object.entries(this._counts)) {
            this._checkThresholds(lobe, count);
        }
    }

    // ── Manual Filing (for ThoughtNetwork migration + external use) ──────────

    /**
     * Manually file a knowledge entry into a lobe.
     * Used by the ThoughtNetwork migration script and other arbiters that want
     * to explicitly curate knowledge.
     *
     * @param {string} lobe - 'logos' | 'aurora' | 'prometheus' | 'thalamus'
     * @param {string} type - entry type string
     * @param {string} content - markdown body
     * @param {string} [sourceLabel] - what generated this (for frontmatter)
     */
    async file(lobe, type, content, sourceLabel = 'manual') {
        if (!['logos', 'aurora', 'prometheus', 'thalamus'].includes(lobe)) {
            throw new Error(`Invalid lobe: ${lobe}`);
        }
        await this._fileEntry(lobe, type, content, sourceLabel, Date.now());
    }

    getStatus() {
        return {
            name: this.name,
            counts: { ...this._counts },
            threshold: TRAINING_THRESHOLD,
            thresholds: { ...TRAINING_THRESHOLDS },
            approachThresholds: Object.fromEntries(
                Object.entries(TRAINING_THRESHOLDS).map(([lobe, threshold]) => [lobe, Math.floor(threshold * 0.75)])
            ),
            progress: Object.fromEntries(
                Object.entries(this._counts).map(([lobe, count]) => [
                    lobe,
                    `${count}/${TRAINING_THRESHOLDS[lobe] || TRAINING_THRESHOLD} (${Math.round(count / (TRAINING_THRESHOLDS[lobe] || TRAINING_THRESHOLD) * 100)}%)`
                ])
            )
        };
    }
}

export default KnowledgeCuratorArbiter;
