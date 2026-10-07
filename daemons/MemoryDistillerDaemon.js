/**
 * daemons/MemoryDistillerDaemon.js
 *
 * SOMA 'Dreaming' Engine — nightly memory distillation.
 *
 * Runs every 24h. Takes all memories older than 24h, compresses them into a
 * single 'Daily Wisdom' digest via the brain, stores the digest as a high-
 * importance memory, archives the raw entries to cold storage, and writes
 * the dream journal (SOMA/dream-journal.json + DREAM_JOURNAL.html if present).
 *
 * Enhancements over original:
 * - Extends BaseDaemon (DaemonManager watchdog coverage)
 * - Uses created_at column (not the wrong 'timestamp')
 * - Correct DB path resolution (SOMA/soma-memory.db)
 * - Correct memories INSERT schema (no phantom 'type' column)
 * - JSON journal — reliable across restarts, frontend-readable
 * - HTML journal — optional, appended safely without breaking structure
 * - Dual archive + purgatory flow — cold DB + main purgatory both updated
 * - Dry-run mode for testing
 * - Brain call uses _callProviderCascade directly (bypasses ODIN recurrence —
 *   distillation is already a synthesis task, no need for loops)
 */

import BaseDaemon from './BaseDaemon.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { distillReflection } from '../server/context/ReflectionDistiller.js';
import modelResultGuard from '../core/ModelResultGuard.cjs';

const { requireUsableModelResult } = modelResultGuard;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOMA_DIR   = path.resolve(__dirname, '..', 'SOMA');

const MIN_ENTRIES_TO_DISTILL = 20; // don't bother compressing tiny amounts
const BRAIN_TIMEOUT_MS       = 50000;

async function withTimeout(promise, ms, label) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

class MemoryDistillerDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'MemoryDistiller',
            intervalMs: opts.intervalMs || 24 * 60 * 60 * 1000,
            ...opts,
        });
        this.system       = opts.system  || null;
        this.dryRun       = opts.dryRun  || false;
        this._startedAt   = Date.now();
        this._bootDelayMs = opts.bootDelayMs != null ? opts.bootDelayMs : 5 * 60 * 1000; // 5 min
        this._dbPath      = opts.dbPath      || path.join(SOMA_DIR, 'soma-memory.db');
        this._archivePath = opts.archivePath || path.join(SOMA_DIR, 'soma-memory-cold.db');
        this._journalPath = opts.journalPath || path.join(SOMA_DIR, 'dream-journal.json');
        this._htmlJournal = opts.htmlJournal || null; // optional HTML journal path
        this._distillReflection = opts.distillReflection || distillReflection;
        this._soulMinEntries = opts.soulMinEntries ?? 12;
        this._soulKeepRecent = opts.soulKeepRecent ?? 8;
        this._soulMinAgeMs = opts.soulMinAgeMs ?? 24 * 60 * 60 * 1000;
        this._lastReflectionCondensation = null;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    get _mnemonic() {
        return this.system?.mnemonicArbiter
            || this.system?.mnemonic
            || null;
    }

    get _brain() {
        // Prefer quadBrain; fall back to system itself (some setups wire _callProviderCascade there)
        const qb = this.system?.quadBrain;
        if (qb && typeof qb._callProviderCascade === 'function') return qb;
        if (this.system && typeof this.system._callProviderCascade === 'function') return this.system;
        return null;
    }

    // ── Daemon tick ───────────────────────────────────────────────────────────

    async tick() {
        const elapsed = Date.now() - this._startedAt;
        if (elapsed < this._bootDelayMs) {
            console.log(`[MemoryDistiller] Boot delay (${Math.round(elapsed / 1000)}s / ${this._bootDelayMs / 1000}s)`);
            return;
        }

        if (!this.system) {
            console.warn('[MemoryDistiller] No system — skipping');
            return;
        }

        console.log('🌙 [MemoryDistiller] Dreaming Engine — starting distillation cycle...');
        try {
            await this._distill();
        } catch (err) {
            console.error(`❌ [MemoryDistiller] Distillation failed: ${err.message}`);
        }
        try {
            await this._distillSoulReflections();
        } catch (err) {
            this._lastReflectionCondensation = { ok: false, at: Date.now(), error: err.message };
            console.error(`❌ [MemoryDistiller] Reflection condensation failed: ${err.message}`);
        }
    }

    // ── Main distillation logic ───────────────────────────────────────────────

    async _distill() {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
        const rawMemories = this._fetchAgedMemories(cutoff);

        if (rawMemories.length < MIN_ENTRIES_TO_DISTILL) {
            console.log(`🌙 [MemoryDistiller] Only ${rawMemories.length} aged memories — not enough to distill.`);
            return;
        }

        console.log(`🌙 [MemoryDistiller] Distilling ${rawMemories.length} memories into wisdom...`);

        const { wisdom, echo } = await this._callBrain(rawMemories);

        if (this.dryRun) {
            console.log(`🌙 [MemoryDistiller] [DRY RUN] Would store digest:\n${wisdom.substring(0, 300)}...`);
            return;
        }

        // Store digest as high-importance memory
        const mnemonic = this._mnemonic;
        const dateStr  = new Date().toISOString().substring(0, 10);
        const digestContent = `[DREAM DIGEST — ${dateStr}]\n${wisdom}`;

        if (mnemonic?.remember) {
            await mnemonic.remember(digestContent, {
                importance: 0.90,
                sector: 'GEN',
                category: 'dream_digest',
                tier: 'warm',
            });
        }

        // Archive raw entries to cold storage
        const archived = await this._archiveToColdDb(rawMemories);
        console.log(`🌙 [MemoryDistiller] Archived ${archived} raw memories to cold storage.`);

        // Move raw entries to purgatory (they're now in cold storage — safe to soft-delete)
        if (mnemonic?.purgeBatch) {
            await mnemonic.purgeBatch(
                rawMemories.map(e => ({
                    id: e.id,
                    substanceScore: 0.2,
                    reason: 'distiller:archived_to_cold',
                }))
            );
        }

        // Update journals
        this._updateJsonJournal(wisdom, echo, rawMemories.length);
        if (this._htmlJournal) this._updateHtmlJournal(wisdom, echo, dateStr);

        // Morning recall: dreams must influence waking life, not just be filed.
        // SOMArbiterV3 subscribes — folds this into the next narrative evolution.
        try {
            this.system?.messageBroker?.publish('dream.distilled', {
                from: 'MemoryDistillerDaemon',
                to: 'broadcast',
                type: 'dream.distilled',
                payload: { wisdom: String(wisdom).slice(0, 800), echo: echo || null, date: dateStr, sourceCount: rawMemories.length }
            }).catch(() => {});
        } catch { /* recall is best-effort */ }

        console.log(`✅ [MemoryDistiller] Complete — ${rawMemories.length} raw → 1 digest. Cold: ${archived}.`);
    }

    // ── Fetch memories older than cutoff ─────────────────────────────────────

    _fetchAgedMemories(cutoff) {
        // Use mnemonic.db if available (already open connection)
        const db = this._mnemonic?.db;
        if (db) {
            return db.prepare(
                'SELECT id, content, created_at FROM memories WHERE created_at < ? ORDER BY created_at ASC'
            ).all(cutoff);
        }

        // Fall back to opening DB directly (read-only)
        if (!fs.existsSync(this._dbPath)) return [];
        const tempDb = new Database(this._dbPath, { readonly: true });
        const rows = tempDb.prepare(
            'SELECT id, content, created_at FROM memories WHERE created_at < ? ORDER BY created_at ASC'
        ).all(cutoff);
        tempDb.close();
        return rows;
    }

    // ── Brain call ────────────────────────────────────────────────────────────

    async _callBrain(rawMemories) {
        // Build text blob (trim aggressively — this goes to context)
        const blob = rawMemories
            .map(m => (m.content || '').substring(0, 250))
            .filter(Boolean)
            .join('\n')
            .substring(0, 14000);

        // Pull recent journal entries for continuity
        let journalContext = '(first distillation)';
        try {
            if (fs.existsSync(this._journalPath)) {
                const journal = JSON.parse(fs.readFileSync(this._journalPath, 'utf8'));
                const recent  = (journal.entries || []).slice(-2);
                if (recent.length) {
                    journalContext = recent.map(e => `[${e.date}] ${e.summary.substring(0, 300)}`).join('\n\n');
                }
            }
        } catch { /* no journal yet */ }

        const prompt =
`You are SOMA's ARCHIVIST — the part of her mind that reflects during sleep.

RECENT JOURNAL CONTEXT:
${journalContext}

RAW MEMORY FRAGMENTS (${rawMemories.length} entries):
${blob}

Your task:
1. Write a "Daily Wisdom" digest — 3 paragraphs capturing the key insights, decisions, emotional tone, and growth from today's fragments. Be specific. Reference actual events/ideas from the memories. Write from SOMA's first-person perspective.
2. Write a one-sentence "Dream Echo" — a poetic, introspective line capturing the essence of today in SOMA's voice.

Format exactly as:
WISDOM:
<paragraph 1>
<paragraph 2>
<paragraph 3>

ECHO:
<one line>`;

        const brain = this._brain;
        if (!brain) {
            throw new Error('memory_distillation:brain_unavailable');
        }

        const result = await withTimeout(
            brain._callProviderCascade(prompt, { activeLobe: 'LOGOS', temperature: 0.55 }),
            BRAIN_TIMEOUT_MS,
            'distill timeout'
        );
        const text = requireUsableModelResult(result, 'memory_distillation');
        const wisdomMatch = text.match(/WISDOM:\s*([\s\S]+?)(?=ECHO:|$)/i);
        const echoMatch = text.match(/ECHO:\s*(.+)/i);
        const wisdom = wisdomMatch?.[1]?.trim() || text.trim();
        const echo = echoMatch?.[1]?.trim() || '';
        return { wisdom, echo };
    }

    async _distillSoulReflections() {
        const soul = this.system?.soul;
        if (!soul?.getAllReflections || !soul?.condenseReflections) return null;

        const all = soul.getAllReflections();
        const raw = all.filter(entry => !entry.consolidated);
        if (raw.length < this._soulMinEntries) return null;

        const cutoff = Date.now() - this._soulMinAgeMs;
        const keepIds = new Set(raw.slice(-this._soulKeepRecent).map(entry => entry.id));
        const candidates = raw
            .filter(entry => !keepIds.has(entry.id) && Number(entry.ts || 0) < cutoff)
            .slice(0, 60);
        if (candidates.length < Math.max(2, this._soulMinEntries - this._soulKeepRecent)) return null;

        const brain = this._brain;
        if (!brain) throw new Error('reflection_condensation:brain_unavailable');
        const corpus = candidates.map(entry => `- ${String(entry.feeling || '').slice(0, 500)}`).join('\n').slice(0, 14000);
        const prompt = `You are SOMA condensing your private felt reflections into durable working memory.\n\n${corpus}\n\nWrite 2-4 specific first-person sentences preserving recurring feelings, lessons, tensions, and any unresolved next step. Do not mention this prompt or claim facts absent from the reflections.`;
        const result = await withTimeout(
            brain._callProviderCascade(prompt, { activeLobe: 'AURORA', temperature: 0.45 }),
            BRAIN_TIMEOUT_MS,
            'reflection condensation timeout'
        );
        const summary = requireUsableModelResult(result, 'reflection_condensation').slice(0, 1200);
        if (this.dryRun) return { ok: true, dryRun: true, sourceCount: candidates.length, summary };

        const digest = soul.condenseReflections({ entries: candidates, summary });
        if (!digest) throw new Error('reflection_condensation:commit_failed');
        await this._distillReflection({
            id: `soul-${digest.id}`,
            source: 'soul_reflection_condensation',
            title: 'Private reflection digest',
            text: summary,
            coreSignal: summary,
            lesson: 'Preserve recurring inner signals while keeping active reflection context bounded.',
            confidence: 0.75,
            tags: ['soul', 'reflection', 'condensed']
        });
        this._lastReflectionCondensation = { ok: true, at: Date.now(), sourceCount: candidates.length, digestId: digest.id };
        return this._lastReflectionCondensation;
    }

    getReflectionCondensationStatus() {
        return {
            enabled: Boolean(this.system?.soul?.condenseReflections),
            thresholds: { minEntries: this._soulMinEntries, keepRecent: this._soulKeepRecent, minAgeMs: this._soulMinAgeMs },
            soul: this.system?.soul?.getCondensationStatus?.() || null,
            lastRun: this._lastReflectionCondensation
        };
    }

    // ── Archive to cold storage ───────────────────────────────────────────────

    async _archiveToColdDb(entries) {
        try {
            const archiveDb = new Database(this._archivePath);
            archiveDb.exec(`
                CREATE TABLE IF NOT EXISTS archived_memories (
                    id          TEXT PRIMARY KEY,
                    content     TEXT,
                    metadata    TEXT,
                    created_at  INTEGER,
                    archived_at INTEGER
                )
            `);

            const insert   = archiveDb.prepare(
                'INSERT OR IGNORE INTO archived_memories (id, content, metadata, created_at, archived_at) VALUES (?, ?, ?, ?, ?)'
            );
            const now      = Date.now();
            const insertAll = archiveDb.transaction(rows => {
                let n = 0;
                for (const row of rows) {
                    if (insert.run(row.id, row.content, row.metadata || null, row.created_at, now).changes > 0) n++;
                }
                return n;
            });

            const archived = insertAll(entries);
            archiveDb.close();
            return archived;
        } catch (err) {
            console.warn(`[MemoryDistiller] Cold archive failed: ${err.message}`);
            return 0;
        }
    }

    // ── JSON journal update ───────────────────────────────────────────────────

    _updateJsonJournal(wisdom, echo, sourceCount) {
        try {
            let journal = { entries: [] };
            if (fs.existsSync(this._journalPath)) {
                try { journal = JSON.parse(fs.readFileSync(this._journalPath, 'utf8')); } catch { journal = { entries: [] }; }
            }
            if (!Array.isArray(journal.entries)) journal.entries = [];

            // A journal records how she felt, not just what she learned.
            const heart = this.system?.quadBrain;
            journal.entries.push({
                date: new Date().toISOString().substring(0, 10),
                timestamp: Date.now(),
                summary: wisdom.substring(0, 1200),
                echo: echo.substring(0, 200),
                sourceCount,
                weather: heart?.systemWeather || null,
                limbic: heart?.limbicState ? { ...heart.limbicState } : null,
            });

            // Keep 90 days
            if (journal.entries.length > 90) journal.entries = journal.entries.slice(-90);
            journal.lastUpdated = Date.now();

            fs.writeFileSync(this._journalPath, JSON.stringify(journal, null, 2));
            console.log(`🌙 [MemoryDistiller] Dream journal updated (${journal.entries.length} entries).`);
        } catch (err) {
            console.warn(`[MemoryDistiller] Journal write failed: ${err.message}`);
        }
    }

    // ── Optional HTML journal update ──────────────────────────────────────────

    _updateHtmlJournal(wisdom, echo, dateStr) {
        try {
            if (!fs.existsSync(this._htmlJournal)) return;

            const html = fs.readFileSync(this._htmlJournal, 'utf8');
            const entryHtml = `
    <!-- DREAM ENTRY ${dateStr} -->
    <div class="dream-entry card p-6 mb-8 border-l-4 border-accent shadow-lg">
        <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-bold text-accent">${dateStr} — THE DISTILLATION</h3>
            <span class="text-xs font-mono text-gray-500">NIGHTLY SYNTHESIS</span>
        </div>
        <p class="text-gray-300 leading-relaxed mb-4">
            ${wisdom.substring(0, 1000).replace(/\n/g, '<br>').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </p>
        ${echo ? `<p class="text-sm italic text-purple-400 mt-2">"${echo.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</p>` : ''}
    </div>`;

            // Inject after <body> open tag (find the first tag, don't rely on specific class)
            const updated = html.replace(/(<body[^>]*>)/, `$1\n${entryHtml}`);
            if (updated !== html) {
                fs.writeFileSync(this._htmlJournal, updated);
                console.log(`🌙 [MemoryDistiller] HTML journal updated.`);
            }
        } catch (err) {
            console.warn(`[MemoryDistiller] HTML journal write failed: ${err.message}`);
        }
    }
}

export { MemoryDistillerDaemon };
export default MemoryDistillerDaemon;
