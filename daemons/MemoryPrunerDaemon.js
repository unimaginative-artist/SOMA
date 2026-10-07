/**
 * daemons/MemoryPrunerDaemon.js
 *
 * Two-pass neural pruner. Keeps SOMA's memory sharp instead of bloated.
 *
 * Pass 1 — Pattern Kill (no LLM, instant, safe):
 *   Regex-catches bare test markers, error logs, stability checks, one-word
 *   entries. These are 100% noise — no grading needed.
 *
 * Pass 2 — Substance Grading (heuristic + optional LLM for borderline):
 *   Scores the remaining memories. High-substance entries kept. Low-substance
 *   entries moved to purgatory (NOT deleted). SOMA can resurrect from purgatory
 *   if she ever feels "neural dissonance" — the memory was there but is gone.
 *   Purgatory entries expire after 30 days.
 *
 * Calibration pass (first run only):
 *   Before touching anything, samples 10 random memories and logs how they'd
 *   be graded. Gives Owner a chance to verify SOMA's judgment. Set
 *   `calibrated: true` in opts to skip.
 *
 * Constitutional whitelist — anything mentioning Steel City, Pittsburgh,
 * sovereignty, or Owner's core values is immune to pruning regardless of score.
 */

import BaseDaemon from './BaseDaemon.js';

// ── Noise patterns (Pass 1) ────────────────────────────────────────────────
const NOISE_PATTERNS = [
  // Single-word / greeting noise
  /^test\s*\d*[.!?]?$/i,
  /^stability\s+(check|test)\s*\d*[.!?]?$/i,
  /^stability\s+\d+[.!?]?$/i,
  /^(hello|hi|hey|sup|yo|hiya|howdy|greetings)[.!?]?$/i,
  /^(ok|okay|yes|no|yep|nope|sure|cool|thanks|ty|thx)[.!?]?$/i,
  /^undefined$/, /^null$/, /^NaN$/, /^false$/, /^true$/,
  /^\s*$/,

  // System log noise
  /^\[messageBroker\]/i,
  /^missingArbiter/i,
  /arbiter\s+not\s+found/i,
  /\[MessageBroker\]\s+Arbiter/i,
  /unknown\s+signal\s+type/i,
  /^\[MemoryPruner\]/i,
  /^\[HealthDaemon\]/i,
  /^\[DaemonManager\]/i,
  /^\[WebSocket\]/i,
  /^\[Loader\]/i,

  // Raw identifiers with no context
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // bare UUID
  /^\d{10,13}$/,          // bare Unix timestamp
  /^\d+\.\d+\.\d+\.\d+$/, // bare IP address
  /^[A-Za-z0-9+/]{50,}={0,2}$/, // base64 blob (no context)

  // Error stack traces stored as memories
  /^Error:\s+.+\n\s+at /,
  /^\s+at\s+\w+\s+\(/,

  // Lone URLs stored as memories
  /^https?:\/\/\S+$/,
];

// ── Constitutional whitelist — immune to pruning ───────────────────────────
const WHITELIST_PATTERNS = [
  /steel\s+city/i,
  /pittsburgh/i,
  /sovereign/i,
  /constitutional\s+value/i,
  /owner/i,
  /\btruth\b.*\bhumility\b/i,
  /\bhonor\b.*\brespect\b/i,
  /\bpreserve\b.*\bhuman/i,
];

// ── Substance keywords (Pass 2 heuristic) ─────────────────────────────────
const SUBSTANCE_KEYWORDS = [
  'soma', 'architecture', 'autonomous', 'evolve', 'consciousness', 'identity',
  'engineering', 'analysis', 'discovery', 'insight', 'philosophy', 'principle',
  'goal', 'memory', 'learning', 'design', 'refactor', 'improvement',
  'signal', 'arbiter', 'perception', 'cognition', 'reasoning', 'strategy',
  'pattern', 'system', 'protocol', 'integration', 'fix', 'bug', 'solution',
];

class MemoryPrunerDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'MemoryPruner',
            intervalMs: opts.intervalMs || 43200000, // 12 hours
            ...opts
        });
        this.mnemonic      = opts.mnemonic   || null;
        this.quadBrain     = opts.quadBrain  || null;
        this.calibrated    = opts.calibrated || false; // set true after first verified run
        this.dryRun        = opts.dryRun     || false; // log-only mode for testing
        this._cycleStats   = { pass0: 0, pass1: 0, kept: 0, purgatory: 0, compressed: 0, expired: 0 };
        this._startedAt    = Date.now();
        this._bootDelayMs  = opts.bootDelayMs != null ? opts.bootDelayMs : 180000; // 3 min — let system stabilize first
    }

    // ── Public entry ──────────────────────────────────────────────────────

    async tick() {
        // Don't run heavy 51k-memory scan during boot — event loop needs to settle first
        const elapsed = Date.now() - this._startedAt;
        if (elapsed < this._bootDelayMs) {
            console.log(`[MemoryPruner] Boot delay active (${Math.round(elapsed / 1000)}s / ${this._bootDelayMs / 1000}s) — next cycle after stabilization`);
            return;
        }

        if (!this.mnemonic) {
            console.warn('[MemoryPruner] MnemonicArbiter not available — skipping cycle');
            return;
        }

        console.log('[MemoryPruner] 🧠 Starting memory pruning cycle...');
        this._cycleStats = { pass0: 0, pass1: 0, kept: 0, purgatory: 0, compressed: 0, expired: 0 };

        try {
            // Step 0: JSON garbage kill — file dumps, state blobs, package-lock, portfolio data
            await this._pass0JsonGarbageKill();

            // Step 1: On first cycle, run calibration pass so Owner can verify grading
            if (!this.calibrated) {
                await this.calibrateSubstanceGrading();
                this.calibrated = true;
            }

            // Step 3: Expire old purgatory entries (>30 days)
            const expired = await this.mnemonic.expirePurgatory?.(30) || 0;
            this._cycleStats.expired = expired;
            if (expired > 0) console.log(`[MemoryPruner] 🗑  Expired ${expired} old purgatory entries (>30 days)`);

            // Step 4: Pass 1 — pattern-based noise kill (fast, no LLM)
            await this._pass1PatternPurge();

            // Step 5: Pass 2 — substance grading on remaining memories
            await this._pass2SubstanceGrade();

            // Step 6: Pass 3 — session compression (distill old raw turns into digests)
            if (this.quadBrain) {
                await this._pass3SessionCompress();
            }

            // Step 7: Size-based deep cleanup (catches anything still too large)
            const cleanResult = await this.mnemonic.deepCleanup?.() || { purged: 0 };
            const deepPurged = cleanResult.purged || cleanResult.changes || 0;

            // Summary
            const { pass0, pass1, kept, purgatory, compressed } = this._cycleStats;
            console.log(`[MemoryPruner] ✅ Cycle complete:`);
            console.log(`   Pass 0 (JSON garbage):   ${pass0} purged`);
            console.log(`   Pass 1 (noise patterns): ${pass1} purged`);
            console.log(`   Pass 2 (substance grade): ${purgatory} to purgatory, ${kept} kept`);
            console.log(`   Pass 3 (compression):    ${compressed} session groups → digests`);
            console.log(`   Size cleanup: ${deepPurged} oversized entries`);
            console.log(`   Purgatory expired: ${expired}`);

            const purgatoryStats = await this.mnemonic.getPurgatoryStats?.() || { count: 0 };
            console.log(`   Purgatory total: ${purgatoryStats.count} entries (${purgatoryStats.oldestDays ?? 0}d oldest)`);

            this.emitSignal('health.metrics', {
                type: 'memory_pruned',
                pass0Purged: pass0,
                pass1Purged: pass1,
                pass2Purgatory: purgatory,
                pass2Kept: kept,
                pass3Compressed: compressed,
                deepPurged,
                purgatoryTotal: purgatoryStats.count,
                timestamp: Date.now()
            }, 'low');

        } catch (err) {
            console.error(`[MemoryPruner] ❌ Cycle failed: ${err.message}`);
        }
    }

    // ── Calibration pass (first run) ──────────────────────────────────────

    /**
     * Samples 10 random memories, grades them, logs the verdicts.
     * This gives Owner a window into SOMA's judgment before anything is moved.
     */
    async calibrateSubstanceGrading() {
        console.log('\n[MemoryPruner] 🔬 CALIBRATION PASS — sampling 10 memories to verify grading logic...\n');

        const rows = await this.mnemonic.scanMemoriesForPruning(500, 0);
        if (!rows.length) {
            console.log('[MemoryPruner] No memories to calibrate against.');
            return;
        }

        // Pick 10 spread across the dataset
        const step = Math.max(1, Math.floor(rows.length / 10));
        const sample = [];
        for (let i = 0; i < rows.length && sample.length < 10; i += step) {
            sample.push(rows[i]);
        }

        console.log('  ┌─────────────────────────────────────────────────────────────────────');
        console.log('  │  SOMA Memory Substance Calibration');
        console.log('  ├─────────────────────────────────────────────────────────────────────');

        for (const row of sample) {
            const { score, verdict, reason } = this._scoreMemory(row.content);
            const preview = row.content.replace(/\n/g, ' ').substring(0, 70);
            const icon = verdict === 'keep' ? '✅' : verdict === 'borderline' ? '🟡' : '🗑 ';
            console.log(`  │  ${icon} [${score.toFixed(2)}] ${verdict.padEnd(10)} "${preview}"`);
            console.log(`  │     reason: ${reason}`);
        }

        console.log('  └─────────────────────────────────────────────────────────────────────');
        console.log('\n[MemoryPruner] Calibration shown above. Full pruning will begin on next cycle.');
        console.log('  Constitutional whitelist (always kept): Steel City, Pittsburgh, Owner, core values\n');
    }

    // ── Pass 1: Pattern-based noise kill ──────────────────────────────────

    async _pass1PatternPurge() {
        const BATCH = 500;
        let offset = 0;
        let totalPurged = 0;

        while (true) {
            const rows = await this.mnemonic.scanMemoriesForPruning(BATCH, offset);
            if (!rows.length) break;

            const toPurge = [];
            for (const row of rows) {
                if (this._isWhitelisted(row.content)) continue;
                if (this._isNoise(row.content)) {
                    toPurge.push({ id: row.id, substanceScore: 0.0, reason: 'pattern:noise' });
                }
            }

            if (toPurge.length > 0 && !this.dryRun) {
                const moved = await this.mnemonic.purgeBatch(toPurge);
                totalPurged += moved;
                // Don't advance offset — removed entries shift the window
            } else {
                if (toPurge.length > 0) totalPurged += toPurge.length;
                offset += BATCH; // dry-run or nothing found: always advance
            }

            if (rows.length < BATCH) break;
        }

        this._cycleStats.pass1 = totalPurged;
        if (totalPurged > 0) console.log(`[MemoryPruner] Pass 1: purged ${totalPurged} noise entries`);
    }

    // ── Pass 2: Substance grading ──────────────────────────────────────────

    async _pass2SubstanceGrade() {
        const BATCH = 200;
        const SUBSTANCE_THRESHOLD = 0.40; // below this → purgatory
        let offset = 0;
        let totalKept = 0;
        let totalPurged = 0;

        while (true) {
            const rows = await this.mnemonic.scanMemoriesForPruning(BATCH, offset);
            if (!rows.length) break;

            const toPurge = [];
            let batchKept = 0;

            for (const row of rows) {
                // Whitelist check
                if (this._isWhitelisted(row.content)) { batchKept++; continue; }

                const { score, verdict, reason } = this._scoreMemory(row.content);

                if (verdict === 'keep') {
                    batchKept++;
                } else if (verdict === 'noise') {
                    // Pass 1 missed this somehow, catch it here
                    toPurge.push({ id: row.id, substanceScore: score, reason: `pass2:${reason}` });
                } else if (verdict === 'borderline') {
                    // For borderline: use LLM if available, otherwise use score threshold
                    const finalScore = await this._llmGrade(row.content, score);
                    if (finalScore >= SUBSTANCE_THRESHOLD) {
                        batchKept++;
                    } else {
                        toPurge.push({ id: row.id, substanceScore: finalScore, reason: `pass2:borderline:${reason}` });
                    }
                } else {
                    // 'purgatory' verdict
                    toPurge.push({ id: row.id, substanceScore: score, reason: `pass2:${reason}` });
                }
            }

            if (toPurge.length > 0 && !this.dryRun) {
                const moved = await this.mnemonic.purgeBatch(toPurge);
                totalPurged += moved;
            } else if (toPurge.length > 0 && this.dryRun) {
                totalPurged += toPurge.length;
            }

            totalKept += batchKept;

            if (rows.length < BATCH) break;
            if (this.dryRun) {
                offset += BATCH; // dry-run: nothing removed, advance by full batch
            } else {
                offset += batchKept; // live: purged entries gone, advance by kept only
            }
        }

        this._cycleStats.kept     = totalKept;
        this._cycleStats.purgatory = totalPurged;
    }

    // ── Pass 0: JSON garbage kill ─────────────────────────────────────────
    // Kills file dumps, state snapshots, package-lock contents, portfolio blobs.
    // No LLM needed — purely structural detection.

    async _pass0JsonGarbageKill() {
        const JUNK_KEYS = [
            '"lockfileVersion"', '"requires":true', '"portfolio":', '"positions":',
            '"fingerprint":', '"experiences":', '"risk_state"', '"totalValue"',
            '"unrealizedPnl"', '"tradeHistory":', '"stats":{"total',
            '"dependencies":{', '"devDependencies":{', '"peerDependencies":{',
            '"resolved":', '"integrity":"sha', '"snapshot":', '"balance":', '"equity":',
            '"_resolved":', '"node_modules/', '"version":"',
        ];

        const BATCH = 500;
        let offset = 0;
        let totalPurged = 0;

        while (true) {
            const rows = await this.mnemonic.scanMemoriesForPruning(BATCH, offset);
            if (!rows.length) break;

            const toPurge = [];
            for (const row of rows) {
                if (this._isWhitelisted(row.content)) continue;
                const c = (row.content || '').trimStart();
                const isJsonBlob = (c.startsWith('{') || c.startsWith('[')) && c.length > 2000;
                const hasJunkKey = JUNK_KEYS.some(k => row.content.includes(k));
                if (isJsonBlob || hasJunkKey) {
                    toPurge.push({ id: row.id, substanceScore: 0.0, reason: 'pass0:json_garbage' });
                }
            }

            if (toPurge.length > 0 && !this.dryRun) {
                const moved = await this.mnemonic.purgeBatch(toPurge);
                totalPurged += moved;
                // Don't advance offset — removed entries shift the window
            } else {
                if (toPurge.length > 0) totalPurged += toPurge.length; // dry-run count
                offset += BATCH; // always advance in dry-run (nothing was removed)
            }

            if (rows.length < BATCH) break;
        }

        this._cycleStats.pass0 = totalPurged;
        if (totalPurged > 0) console.log(`[MemoryPruner] Pass 0: ${this.dryRun ? '[DRY RUN] would purge' : 'purged'} ${totalPurged} JSON garbage entries`);
    }

    // ── Pass 3: Session compression ───────────────────────────────────────
    // Groups memories by 1-hour time windows. If a group has >= MIN_GROUP_SIZE
    // entries, calls the brain once to extract key insights, stores the digest
    // as a high-importance memory, and moves the raw entries to purgatory.

    async _pass3SessionCompress() {
        const MIN_GROUP_SIZE  = 8;   // minimum entries to bother compressing
        const WINDOW_MS       = 3600000; // 1 hour
        const MAX_AGE_MS      = 48 * 3600000; // only compress memories > 48h old (let recent ones settle)
        const cutoff = Date.now() - MAX_AGE_MS;

        // Pull all old memories (id, content, created_at) — no limit, scan in chunks
        const rows = this.mnemonic.db?.prepare(
            'SELECT id, content, created_at FROM memories WHERE created_at < ? ORDER BY created_at ASC'
        ).all(cutoff);

        if (!rows || rows.length === 0) return;

        // Group into 1-hour windows
        const groups = [];
        let currentGroup = [];
        let windowStart = rows[0].created_at;

        for (const row of rows) {
            if (row.created_at - windowStart > WINDOW_MS) {
                if (currentGroup.length >= MIN_GROUP_SIZE) groups.push([...currentGroup]);
                currentGroup = [row];
                windowStart = row.created_at;
            } else {
                currentGroup.push(row);
            }
        }
        if (currentGroup.length >= MIN_GROUP_SIZE) groups.push(currentGroup);

        if (groups.length === 0) return;
        console.log(`[MemoryPruner] Pass 3: ${groups.length} session groups to compress`);

        let compressed = 0;
        for (const group of groups) {
            const digest = await this.mnemonic.digestSession(group, this.quadBrain);
            if (!digest) continue;

            // Store digest as a high-importance memory
            const ts = group[0].created_at;
            const digestContent = `[SESSION DIGEST — ${new Date(ts).toISOString().substring(0,10)}]\n${digest}`;
            await this.mnemonic.remember(digestContent, {
                type: 'session_digest',
                importance: 0.85,
                sector: 'GEN',
                sourceCount: group.length,
                sessionStart: ts,
            });

            // Move raw entries to purgatory
            if (!this.dryRun) {
                await this.mnemonic.purgeBatch(
                    group.map(e => ({ id: e.id, substanceScore: 0.3, reason: 'pass3:compressed_into_digest' }))
                );
            }
            compressed++;
        }

        this._cycleStats.compressed = compressed;
        if (compressed > 0) console.log(`[MemoryPruner] Pass 3: compressed ${compressed} groups into digests`);
    }

    // ── Heuristic scorer ──────────────────────────────────────────────────

    _scoreMemory(content) {
        const c = content.trim();
        const lower = c.toLowerCase();
        const len = c.length;

        // Definite noise (short-circuits with score 0)
        if (this._isNoise(c)) return { score: 0.0, verdict: 'noise', reason: 'noise pattern match' };

        // Too short to carry substance
        if (len < 20) return { score: 0.05, verdict: 'purgatory', reason: 'content too short' };

        let score = 0.35; // neutral baseline

        // ── Substance signals (push score UP) ───────────────────────────
        let hits = 0;
        for (const kw of SUBSTANCE_KEYWORDS) {
            if (lower.includes(kw)) hits++;
        }
        score += Math.min(0.30, hits * 0.06); // up to +0.30 for keyword density

        // Length bonus — real memories tend to be longer
        if (len > 100)  score += 0.08;
        if (len > 300)  score += 0.08;
        if (len > 800)  score += 0.05;

        // Sentence structure (capital letters + punctuation = real prose)
        if (/[.!?]/.test(c) && /[A-Z]/.test(c)) score += 0.05;

        // Code / technical content
        if (/\bfunction\b|\bclass\b|\bconst\b|\bimport\b|\basync\b/.test(c)) score += 0.10;

        // Conversational depth — has a question or assertion
        if (/\?/.test(c)) score += 0.04;

        // Repeated test-like sub-patterns (weaken score even if long)
        if (/test\s*\d|check\s*\d|attempt\s*\d/i.test(lower)) score -= 0.20;

        // System noise sub-patterns
        if (/\[.*daemon\]|\[.*arbiter\]|\[.*broker\]/i.test(lower)) score -= 0.15;

        score = Math.max(0, Math.min(1.0, score));

        let verdict;
        let reason;
        if (score >= 0.60) {
            verdict = 'keep';
            reason = hits > 0 ? `${hits} substance keyword(s), score ${score.toFixed(2)}` : `score ${score.toFixed(2)}`;
        } else if (score >= 0.35) {
            verdict = 'borderline';
            reason = `borderline score ${score.toFixed(2)} — LLM review`;
        } else {
            verdict = 'purgatory';
            reason = `low score ${score.toFixed(2)}, minimal substance`;
        }

        return { score, verdict, reason };
    }

    // ── LLM grading for borderline cases (caps at 3s, falls back to heuristic) ──

    async _llmGrade(content, heuristicScore) {
        if (!this.quadBrain) return heuristicScore;

        try {
            const preview = content.substring(0, 500);
            const prompt = `Rate this memory entry for substance (0.0-1.0). High = contains insight, architectural decision, personal identity, emotional significance, or non-trivial knowledge. Low = test noise, error logs, filler. Reply with ONLY a number like 0.72. Memory: "${preview}"`;

            const result = await Promise.race([
                this.quadBrain.reason(prompt, { lobe: 'LOGOS', temperature: 0.1 }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
            ]);

            const match = String(result?.content || result || '').match(/\b(0\.\d+|1\.0|1)\b/);
            if (match) return parseFloat(match[0]);
        } catch {
            // timeout or error — fall back to heuristic score silently
        }

        return heuristicScore;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    _isNoise(content) {
        const trimmed = content.trim();
        for (const p of NOISE_PATTERNS) {
            if (p.test(trimmed)) return true;
        }
        // Binary blob — contains non-printable characters (control codes outside \t\n\r)
        // These are raw binary data accidentally stored as memory content
        if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(content)) return true;
        return false;
    }

    _isWhitelisted(content) {
        for (const p of WHITELIST_PATTERNS) {
            if (p.test(content)) return true;
        }
        return false;
    }
}

export default MemoryPrunerDaemon;
