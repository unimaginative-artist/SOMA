/**
 * AuditLedger.js
 *
 * Immutable hash-chained audit log. Every entry seals all prior history
 * via SHA256(prev_hash + entry content). Tampering with any entry breaks
 * every subsequent hash — the chain verifies or it doesn't.
 *
 * Structure mirrors blockchain without distributed consensus:
 *   Genesis (prev_hash = 0x000...0)
 *     → Entry 0 (hash_0 = SHA256(0x000...0 + content_0))
 *     → Entry 1 (hash_1 = SHA256(hash_0 + content_1))
 *     → Entry N (hash_N = SHA256(hash_N-1 + content_N))
 *
 * Anyone can verify the full chain by recomputing every hash from 0 → N.
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const GENESIS_HASH = '0'.repeat(64);

export class AuditLedger {
    constructor(dbPath) {
        this.dbPath = dbPath || path.join(process.cwd(), 'soma_audit_ledger.db');

        // Ensure directory exists
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

        const Database = require('better-sqlite3');
        this.db = new Database(this.dbPath);
        this._init();
    }

    _init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS audit_chain (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                idx         INTEGER NOT NULL UNIQUE,
                timestamp   TEXT    NOT NULL,
                actor       TEXT    NOT NULL,
                action      TEXT    NOT NULL,
                file_path   TEXT,
                metadata    TEXT    NOT NULL DEFAULT '{}',
                prev_hash   TEXT    NOT NULL,
                entry_hash  TEXT    NOT NULL UNIQUE
            );
            CREATE INDEX IF NOT EXISTS audit_file_idx ON audit_chain(file_path);
            CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_chain(actor);
            CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_chain(action);
        `);
    }

    // ── Core: compute the deterministic hash for an entry ───────────────────
    _hash(entry) {
        const canonical = JSON.stringify([
            entry.idx,
            entry.timestamp,
            entry.actor,
            entry.action,
            entry.file_path ?? null,
            entry.metadata,
            entry.prev_hash
        ]);
        return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    }

    // ── Append: add a new entry to the chain ────────────────────────────────
    append({ actor = 'SOMA', action, filePath = null, metadata = {} }) {
        const last = this.db
            .prepare('SELECT idx, entry_hash FROM audit_chain ORDER BY idx DESC LIMIT 1')
            .get();

        const prev_hash  = last?.entry_hash ?? GENESIS_HASH;
        const idx        = (last?.idx ?? -1) + 1;
        const timestamp  = new Date().toISOString();
        const meta_str   = JSON.stringify(metadata);

        const entry = { idx, timestamp, actor, action, file_path: filePath, metadata: meta_str, prev_hash };
        const entry_hash = this._hash(entry);

        this.db.prepare(`
            INSERT INTO audit_chain (idx, timestamp, actor, action, file_path, metadata, prev_hash, entry_hash)
            VALUES (@idx, @timestamp, @actor, @action, @file_path, @metadata, @prev_hash, @entry_hash)
        `).run({ idx, timestamp, actor, action, file_path: filePath, metadata: meta_str, prev_hash, entry_hash });

        return { idx, entry_hash, timestamp };
    }

    // ── Verify: walk the full chain and recompute every hash ────────────────
    verify() {
        const entries = this.db
            .prepare('SELECT * FROM audit_chain ORDER BY idx ASC')
            .all();

        if (entries.length === 0) return { valid: true, entries: 0, tip: GENESIS_HASH };

        let prevHash = GENESIS_HASH;

        for (const row of entries) {
            // Check the link
            if (row.prev_hash !== prevHash) {
                return {
                    valid: false,
                    tampered_at_idx: row.idx,
                    reason: `prev_hash mismatch at entry ${row.idx}`,
                    expected_prev: prevHash,
                    stored_prev: row.prev_hash
                };
            }

            // Recompute this entry's hash
            const computed = this._hash({
                idx:       row.idx,
                timestamp: row.timestamp,
                actor:     row.actor,
                action:    row.action,
                file_path: row.file_path,
                metadata:  row.metadata,
                prev_hash: row.prev_hash
            });

            if (computed !== row.entry_hash) {
                return {
                    valid: false,
                    tampered_at_idx: row.idx,
                    reason: `hash mismatch at entry ${row.idx} — content was altered`,
                    computed,
                    stored: row.entry_hash
                };
            }

            prevHash = row.entry_hash;
        }

        return { valid: true, entries: entries.length, tip: prevHash };
    }

    // ── Query: history for a specific file ──────────────────────────────────
    getFileHistory(filePath) {
        return this.db
            .prepare('SELECT * FROM audit_chain WHERE file_path = ? ORDER BY idx ASC')
            .all(filePath)
            .map(this._deserialize);
    }

    // ── Query: recent entries across all files ──────────────────────────────
    getRecent(limit = 100) {
        return this.db
            .prepare('SELECT * FROM audit_chain ORDER BY idx DESC LIMIT ?')
            .all(limit)
            .map(this._deserialize);
    }

    // ── Query: entries by actor ──────────────────────────────────────────────
    getByActor(actor, limit = 100) {
        return this.db
            .prepare('SELECT * FROM audit_chain WHERE actor = ? ORDER BY idx DESC LIMIT ?')
            .all(actor, limit)
            .map(this._deserialize);
    }

    // ── Query: tip hash (latest entry hash — proves current state) ──────────
    getTip() {
        const last = this.db
            .prepare('SELECT entry_hash, idx, timestamp FROM audit_chain ORDER BY idx DESC LIMIT 1')
            .get();
        return last ?? { entry_hash: GENESIS_HASH, idx: -1, timestamp: null };
    }

    // ── Stats ────────────────────────────────────────────────────────────────
    getStats() {
        const total    = this.db.prepare('SELECT COUNT(*) as n FROM audit_chain').get().n;
        const files    = this.db.prepare('SELECT COUNT(DISTINCT file_path) as n FROM audit_chain WHERE file_path IS NOT NULL').get().n;
        const actors   = this.db.prepare('SELECT COUNT(DISTINCT actor) as n FROM audit_chain').get().n;
        const tip      = this.getTip();
        return { total, files, actors, tip_hash: tip.entry_hash, tip_idx: tip.idx };
    }

    _deserialize(row) {
        return {
            ...row,
            metadata: (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })()
        };
    }
}

export default AuditLedger;
