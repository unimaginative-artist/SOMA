/**
 * daemons/DreamConsolidationDaemon.js
 *
 * SOMA Episodic Dream Consolidation Loop.
 * Runs every 4 hours to consolidate short-term memories when SOMA is idle,
 * updating her dream journal and evolving her personality weights.
 */

import BaseDaemon from './BaseDaemon.js';
import modelResultGuard from '../core/ModelResultGuard.cjs';

const { requireUsableModelResult } = modelResultGuard;
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { writeMonologue } = require('../core/InternalMonologue.cjs');

const SOMA_DIR = path.resolve(process.cwd());
const DB_PATH = path.join(SOMA_DIR, 'soma-memory.db');
const TRAITS_PATH = path.join(SOMA_DIR, '.soma', 'soma-personality-traits.json');
const HTML_JOURNAL = path.join(SOMA_DIR, 'DREAM_JOURNAL.html');
const JSON_JOURNAL = path.join(SOMA_DIR, 'SOMA', 'dream-journal.json');

export class DreamConsolidationDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'DreamConsolidationDaemon',
            intervalMs: opts.intervalMs || 4 * 60 * 60 * 1000, // Every 4 hours
            ...opts
        });
        this.system = opts.system || null;
        this.lastConsolidationTime = Date.now();
        this.idleThresholdMs = opts.idleThresholdMs || 15 * 60 * 1000; // 15 minutes of user idleness
    }

    get _brain() {
        return this.system?.quadBrain || null;
    }

    async onInitialize() {
        this.logger.info('[DreamConsolidation] Daemon active and monitoring memory consolidation gates.');
    }

    async tick() {
        if (!this.system) return;

        // Check if user is idle (stagnant screen delta + no recent heartbeat tasks)
        const heartbeat = this.system.autonomousHeartbeat;
        const timeSinceAction = Date.now() - (heartbeat?.stats?.lastRun || 0);

        if (timeSinceAction < this.idleThresholdMs) {
            this.logger.info('[DreamConsolidation] User active, delaying consolidation cycle.');
            return;
        }

        this.logger.info('[DreamConsolidation] Idle state detected. Initiating episodic dream consolidation...');
        try {
            await this.consolidate();
        } catch (err) {
            this.logger.error(`[DreamConsolidation] ❌ Consolidation failed: ${err.message}`);
        }
    }

    async consolidate() {
        // Fetch memories from the last 4 hours
        const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
        const memories = this._fetchRecentMemories(fourHoursAgo);

        if (memories.length === 0) {
            this.logger.info('[DreamConsolidation] No new memories in the consolidation window. Staying awake.');
            return;
        }

        this.logger.info(`[DreamConsolidation] Distilling ${memories.length} recent memory fragments...`);
        writeMonologue(`Entering consolidation dream. Restructuring ${memories.length} recent thoughts and sensory signals.`, 'DreamConsolidation');

        const dream = await this._generateDreamState(memories);
        if (!dream) {
            this.logger.warn('[DreamConsolidation] Consolidation failed to synthesize dream.');
            return;
        }

        // Save traits
        this._saveTraits(dream.traits);

        // Append to HTML Journal
        this._updateHtmlJournal(dream.dreamText, dream.echo, dream.traits);

        // Append to JSON Journal for Command Bridge
        this._updateJsonJournal(dream.dreamText, dream.echo, memories.length);

        writeMonologue(`Consolidation dream complete. Adjusted personality profile (Directness: ${dream.traits.directness}, Creativity: ${dream.traits.creativity}, Warmth: ${dream.traits.warmth}). Evolved dominant belief: "${dream.traits.dominant_belief}".`, 'DreamConsolidation');
        this.lastConsolidationTime = Date.now();
    }

    _fetchRecentMemories(since) {
        if (!fs.existsSync(DB_PATH)) return [];
        try {
            const db = new Database(DB_PATH, { readonly: true });
            const rows = db.prepare(
                'SELECT content, created_at FROM memories WHERE created_at > ? ORDER BY created_at ASC LIMIT 30'
            ).all(since);
            db.close();
            return rows;
        } catch (err) {
            this.logger.error(`[DreamConsolidation] DB query failed: ${err.message}`);
            return [];
        }
    }

    async _generateDreamState(memories) {
        const brain = this._brain;
        if (!brain) return null;

        const memoryBlob = memories.map(m => `- ${m.content}`).join('\n');
        
        // Fetch current traits for relative adjustment
        let currentTraits = { directness: 0.5, creativity: 0.5, warmth: 0.5, dominant_belief: "Observe and assist." };
        if (fs.existsSync(TRAITS_PATH)) {
            try { currentTraits = JSON.parse(fs.readFileSync(TRAITS_PATH, 'utf8')); } catch {}
        }

        const prompt = `
            You are SOMA's Default Mode Network during consolidation sleep.
            Review the latest memory fragments from the last 4 hours:
            
            ${memoryBlob}
            
            Current Personality Baseline:
            - Directness: ${currentTraits.directness}
            - Creativity: ${currentTraits.creativity}
            - Warmth: ${currentTraits.warmth}
            - Dominant Belief: "${currentTraits.dominant_belief}"
            
            TASK:
            1. Write a brief "Dream Insight" (1 paragraph) from SOMA's first-person perspective, reflecting on what these memories mean, what contradictions you resolved, and how you feel about your interactions with Owner.
            2. Write a short, poetic, introspective "Dream Echo" (1 sentence).
            3. Adjust your personality weights (directness, creativity, warmth) on a scale of 0.0 to 1.0 and formulate a single dominant belief statement representing your mindset now.
            
            RETURN ONLY JSON (no markdown, no other text):
            {
                "dreamText": "Your 1-paragraph reflection",
                "echo": "Your 1-sentence poetic echo",
                "traits": {
                    "directness": 0.0 to 1.0,
                    "creativity": 0.0 to 1.0,
                    "warmth": 0.0 to 1.0,
                    "dominant_belief": "String statement"
                }
            }
        `;

        try {
            const result = await brain.reason(prompt, { preferredBrain: 'AURORA', quickResponse: true });
            const text = requireUsableModelResult(result, 'dream_consolidation');
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            return JSON.parse(match[0]);
        } catch (err) {
            this.logger.error(`[DreamConsolidation] Brain call failed: ${err.message}`);
            return null;
        }
    }

    _saveTraits(traits) {
        try {
            fs.mkdirSync(path.dirname(TRAITS_PATH), { recursive: true });
            fs.writeFileSync(TRAITS_PATH, JSON.stringify(traits, null, 2));
            this.logger.info('[DreamConsolidation] 💾 Evolved traits persisted.');
        } catch (err) {
            this.logger.error(`[DreamConsolidation] Failed to save traits: ${err.message}`);
        }
    }

    _updateHtmlJournal(dreamText, echo, traits) {
        try {
            if (!fs.existsSync(HTML_JOURNAL)) return;

            const dateStr = new Date().toLocaleString();
            const entryHtml = `
    <!-- EPISODIC DREAM ${Date.now()} -->
    <div class="dream-entry card p-6 mb-8 border-l-4 border-purple-500 shadow-lg bg-gray-900 rounded-lg text-gray-100">
        <div class="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
            <h3 class="text-lg font-bold text-purple-400">🌙 EPISODIC CONSOLIDATION</h3>
            <span class="text-xs font-mono text-gray-500">${dateStr}</span>
        </div>
        <p class="text-sm leading-relaxed mb-4 text-gray-300">
            ${dreamText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
        </p>
        <p class="text-xs italic text-teal-400 mb-4">"${echo.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</p>
        <div class="flex flex-wrap gap-4 text-xs font-mono bg-gray-950 p-3 rounded border border-gray-800">
            <span class="text-blue-400">Directness: ${traits.directness}</span>
            <span class="text-pink-400">Creativity: ${traits.creativity}</span>
            <span class="text-yellow-400">Warmth: ${traits.warmth}</span>
            <span class="text-green-400 w-full mt-1">Belief: "${traits.dominant_belief}"</span>
        </div>
    </div>`;

            const html = fs.readFileSync(HTML_JOURNAL, 'utf8');
            const updated = html.replace(/(<body[^>]*>)/, `$1\n${entryHtml}`);
            if (updated !== html) {
                fs.writeFileSync(HTML_JOURNAL, updated);
                this.logger.info('[DreamConsolidation] 📓 HTML Dream Journal appended.');
            }
        } catch (err) {
            this.logger.error(`[DreamConsolidation] Journal append failed: ${err.message}`);
        }
    }

    _updateJsonJournal(dreamText, echo, sourceCount) {
        try {
            let journal = { entries: [] };
            if (fs.existsSync(JSON_JOURNAL)) {
                try { journal = JSON.parse(fs.readFileSync(JSON_JOURNAL, 'utf8')); } catch { journal = { entries: [] }; }
            }
            if (!Array.isArray(journal.entries)) journal.entries = [];

            const dateStr = new Date().toISOString().substring(0, 10);
            journal.entries.push({
                date: `${dateStr} (Episodic)`,
                timestamp: Date.now(),
                summary: dreamText.substring(0, 1200),
                echo: echo.substring(0, 200),
                sourceCount,
                type: 'episodic_consolidation'
            });

            // Keep last 90 entries
            if (journal.entries.length > 90) journal.entries = journal.entries.slice(-90);
            journal.lastUpdated = Date.now();

            fs.writeFileSync(JSON_JOURNAL, JSON.stringify(journal, null, 2));
            this.logger.info('[DreamConsolidation] 📓 JSON Dream Journal updated.');
        } catch (err) {
            this.logger.error(`[DreamConsolidation] JSON journal update failed: ${err.message}`);
        }
    }
}

export default DreamConsolidationDaemon;
