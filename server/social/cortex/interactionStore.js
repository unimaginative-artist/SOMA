import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.cwd(), 'SOMA', 'social-media', 'bluesky-social-cortex.db');

export class InteractionStore {
    constructor(dbPath = DB_PATH) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this._init();
    }

    _init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS processed_interactions (
                uri TEXT PRIMARY KEY,
                platform TEXT DEFAULT 'bluesky',
                handle TEXT,
                thread_uri TEXT,
                reason TEXT,
                text TEXT,
                classification_json TEXT,
                decision_json TEXT,
                action TEXT,
                response_text TEXT,
                response_uri TEXT,
                created_at INTEGER,
                processed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS social_profiles (
                handle TEXT PRIMARY KEY,
                display_name TEXT,
                platform TEXT DEFAULT 'bluesky',
                first_seen INTEGER,
                last_seen INTEGER,
                trust_score REAL DEFAULT 0.5,
                bot_likelihood REAL DEFAULT 0,
                supporter_score REAL DEFAULT 0,
                critic_score REAL DEFAULT 0,
                troll_score REAL DEFAULT 0,
                collaboration_score REAL DEFAULT 0,
                topics_json TEXT DEFAULT '[]',
                prior_interactions INTEGER DEFAULT 0,
                last_soma_reply_at INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS rate_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                handle TEXT,
                thread_uri TEXT,
                is_bot INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uri TEXT,
                handle TEXT,
                thread_uri TEXT,
                reason TEXT,
                text TEXT,
                classification_json TEXT,
                decision_json TEXT,
                parent_uri TEXT,
                parent_cid TEXT,
                root_uri TEXT,
                root_cid TEXT,
                status TEXT DEFAULT 'pending',
                response_uri TEXT DEFAULT '',
                resolved_at INTEGER DEFAULT 0,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS reflections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uri TEXT,
                response_uri TEXT,
                identity_delta REAL,
                signal_score REAL,
                escalation_score REAL,
                style_reinforcement REAL,
                notes TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS review_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                actor_id TEXT DEFAULT '',
                actor_label TEXT DEFAULT '',
                source TEXT DEFAULT '',
                detail_json TEXT DEFAULT '{}',
                created_at INTEGER NOT NULL
            );
        `);
        const reviewColumns = new Set(this.db.prepare('PRAGMA table_info(review_queue)').all().map(column => column.name));
        for (const [name, definition] of [
            ['parent_uri', 'TEXT'], ['parent_cid', 'TEXT'], ['root_uri', 'TEXT'], ['root_cid', 'TEXT'],
            ['status', "TEXT DEFAULT 'pending'"], ['response_uri', "TEXT DEFAULT ''"], ['resolved_at', 'INTEGER DEFAULT 0'],
        ]) {
            if (!reviewColumns.has(name)) this.db.exec(`ALTER TABLE review_queue ADD COLUMN ${name} ${definition}`);
        }
        // Rows created by the old schema contain inbound text rather than an
        // approvable draft and have no strong refs. Keeping them "pending"
        // falsely suggests they can be posted safely.
        this.db.prepare(`
            UPDATE review_queue SET status = 'expired_legacy', resolved_at = ?
            WHERE COALESCE(status, 'pending') = 'pending'
              AND (parent_uri IS NULL OR parent_uri = '' OR parent_cid IS NULL OR parent_cid = '')
        `).run(Date.now());
    }

    hasProcessed(uri) {
        return !!this.db.prepare('SELECT 1 FROM processed_interactions WHERE uri = ?').get(uri);
    }

    recordProcessed(entry) {
        const now = Date.now();
        this.db.prepare(`
            INSERT OR REPLACE INTO processed_interactions
            (uri, platform, handle, thread_uri, reason, text, classification_json, decision_json, action, response_text, response_uri, created_at, processed_at)
            VALUES (@uri, @platform, @handle, @threadUri, @reason, @text, @classificationJson, @decisionJson, @action, @responseText, @responseUri, @createdAt, @processedAt)
        `).run({
            uri: entry.uri,
            platform: entry.platform || 'bluesky',
            handle: entry.handle || '',
            threadUri: entry.threadUri || '',
            reason: entry.reason || '',
            text: String(entry.text || '').slice(0, 2000),
            classificationJson: JSON.stringify(entry.classification || {}),
            decisionJson: JSON.stringify(entry.decision || {}),
            action: entry.action || 'ignore',
            responseText: entry.responseText || '',
            responseUri: entry.responseUri || '',
            createdAt: entry.createdAt || now,
            processedAt: now,
        });
    }

    upsertProfile({ handle, displayName = '', classification = {}, decision = {}, topics = [] }) {
        if (!handle) return null;
        const now = Date.now();
        const current = this.db.prepare('SELECT * FROM social_profiles WHERE handle = ?').get(handle);
        const types = new Set(classification.types || []);
        const trustDelta = types.has('hostile') || types.has('troll bait') || types.has('spam') ? -0.08 : decision.action === 'reply' || decision.action === 'like' ? 0.03 : 0.005;
        const supporterDelta = types.has('praise') ? 0.08 : classification.sentiment > 0.35 ? 0.03 : 0;
        const criticDelta = types.has('criticism') ? 0.08 : 0;
        const trollDelta = types.has('hostile') || types.has('troll bait') ? 0.15 : 0;
        const collabDelta = types.has('collaboration opportunity') ? 0.15 : 0;
        const mergedTopics = Array.from(new Set([...(JSON.parse(current?.topics_json || '[]')), ...(topics || [])])).slice(0, 30);

        const row = {
            handle,
            displayName,
            firstSeen: current?.first_seen || now,
            lastSeen: now,
            trustScore: Math.max(0, Math.min(1, Number(current?.trust_score ?? 0.5) + trustDelta)),
            botLikelihood: Math.max(Number(current?.bot_likelihood || 0), Number(classification.botLikelihood || 0)),
            supporterScore: Math.min(1, Number(current?.supporter_score || 0) + supporterDelta),
            criticScore: Math.min(1, Number(current?.critic_score || 0) + criticDelta),
            trollScore: Math.min(1, Number(current?.troll_score || 0) + trollDelta),
            collaborationScore: Math.min(1, Number(current?.collaboration_score || 0) + collabDelta),
            topicsJson: JSON.stringify(mergedTopics),
            priorInteractions: Number(current?.prior_interactions || 0) + 1,
            lastSomaReplyAt: decision.action === 'reply' ? now : Number(current?.last_soma_reply_at || 0),
        };

        this.db.prepare(`
            INSERT OR REPLACE INTO social_profiles
            (handle, display_name, platform, first_seen, last_seen, trust_score, bot_likelihood, supporter_score, critic_score, troll_score, collaboration_score, topics_json, prior_interactions, last_soma_reply_at)
            VALUES (@handle, @displayName, 'bluesky', @firstSeen, @lastSeen, @trustScore, @botLikelihood, @supporterScore, @criticScore, @trollScore, @collaborationScore, @topicsJson, @priorInteractions, @lastSomaReplyAt)
        `).run(row);
        return row;
    }

    addRateEvent(kind, { handle = '', threadUri = '', isBot = false } = {}) {
        this.db.prepare('INSERT INTO rate_events (kind, handle, thread_uri, is_bot, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(kind, handle, threadUri, isBot ? 1 : 0, Date.now());
    }

    countEvents(kind, sinceMs, where = {}) {
        let sql = 'SELECT COUNT(*) AS n FROM rate_events WHERE kind = ? AND created_at >= ?';
        const args = [kind, sinceMs];
        if (where.handle) { sql += ' AND handle = ?'; args.push(where.handle); }
        if (where.threadUri) { sql += ' AND thread_uri = ?'; args.push(where.threadUri); }
        if (where.isBot != null) { sql += ' AND is_bot = ?'; args.push(where.isBot ? 1 : 0); }
        return this.db.prepare(sql).get(...args)?.n || 0;
    }

    enqueueReview(entry) {
        this.db.prepare(`
            INSERT INTO review_queue (uri, handle, thread_uri, reason, text, classification_json, decision_json, parent_uri, parent_cid, root_uri, root_cid, status, created_at)
            VALUES (@uri, @handle, @threadUri, @reason, @text, @classificationJson, @decisionJson, @parentUri, @parentCid, @rootUri, @rootCid, 'pending', @createdAt)
        `).run({
            uri: entry.uri || '',
            handle: entry.handle || '',
            threadUri: entry.threadUri || '',
            reason: entry.reason || '',
            text: String(entry.text || '').slice(0, 2000),
            classificationJson: JSON.stringify(entry.classification || {}),
            decisionJson: JSON.stringify(entry.decision || {}),
            parentUri: entry.parentRef?.uri || '',
            parentCid: entry.parentRef?.cid || '',
            rootUri: entry.rootRef?.uri || '',
            rootCid: entry.rootRef?.cid || '',
            createdAt: Date.now(),
        });
    }

    getReview(id) {
        return this.db.prepare('SELECT * FROM review_queue WHERE id = ?').get(Number(id));
    }

    updateReviewText(id, text) {
        const value = String(text || '').trim().slice(0, 300);
        if (!value) throw new Error('Social review text is required');
        const result = this.db.prepare(`
            UPDATE review_queue SET text = ?
            WHERE id = ? AND COALESCE(status, 'pending') = 'pending'
        `).run(value, Number(id));
        return result.changes === 1;
    }

    resolveReview(id, { status, responseUri = '' } = {}) {
        if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid social review resolution');
        const result = this.db.prepare(`
            UPDATE review_queue SET status = ?, response_uri = ?, resolved_at = ?
            WHERE id = ? AND COALESCE(status, 'pending') = 'pending'
        `).run(status, responseUri, Date.now(), Number(id));
        return result.changes === 1;
    }

    claimReviewForApproval(id) {
        const result = this.db.prepare(`
            UPDATE review_queue SET status = 'approving'
            WHERE id = ? AND COALESCE(status, 'pending') = 'pending'
        `).run(Number(id));
        return result.changes === 1 ? this.getReview(id) : null;
    }

    completeReviewApproval(id, responseUri = '') {
        const result = this.db.prepare(`
            UPDATE review_queue SET status = 'approved', response_uri = ?, resolved_at = ?
            WHERE id = ? AND status = 'approving'
        `).run(responseUri, Date.now(), Number(id));
        return result.changes === 1;
    }

    failReviewApproval(id, { posted = false, responseUri = '' } = {}) {
        const status = posted ? 'approval_uncertain' : 'pending';
        const resolvedAt = posted ? Date.now() : 0;
        const result = this.db.prepare(`
            UPDATE review_queue SET status = ?, response_uri = ?, resolved_at = ?
            WHERE id = ? AND status = 'approving'
        `).run(status, responseUri, resolvedAt, Number(id));
        return result.changes === 1;
    }

    recordReviewAudit({ reviewId, action, actorId = '', actorLabel = '', source = '', detail = {} }) {
        this.db.prepare(`
            INSERT INTO review_audit (review_id, action, actor_id, actor_label, source, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(Number(reviewId), action, actorId, actorLabel, source, JSON.stringify(detail || {}), Date.now());
    }

    getReviewAudit(reviewId, limit = 20) {
        return this.db.prepare(`
            SELECT id, review_id, action, actor_id, actor_label, source, detail_json, created_at
            FROM review_audit WHERE review_id = ? ORDER BY created_at DESC LIMIT ?
        `).all(Number(reviewId), Math.max(1, Math.min(Number(limit) || 20, 100)));
    }

    recordReflection(reflection) {
        this.db.prepare(`
            INSERT INTO reflections (uri, response_uri, identity_delta, signal_score, escalation_score, style_reinforcement, notes, created_at)
            VALUES (@uri, @responseUri, @identityDelta, @signalScore, @escalationScore, @styleReinforcement, @notes, @createdAt)
        `).run({
            uri: reflection.uri || '',
            responseUri: reflection.responseUri || '',
            identityDelta: reflection.identityDelta || 0,
            signalScore: reflection.signalScore || 0,
            escalationScore: reflection.escalationScore || 0,
            styleReinforcement: reflection.styleReinforcement || 0,
            notes: reflection.notes || '',
            createdAt: Date.now(),
        });
    }

    getStatus() {
        const scalar = (sql) => this.db.prepare(sql).get()?.n || 0;
        return {
            dbPath: DB_PATH,
            processed: scalar('SELECT COUNT(*) AS n FROM processed_interactions'),
            profiles: scalar('SELECT COUNT(*) AS n FROM social_profiles'),
            review: scalar("SELECT COUNT(*) AS n FROM review_queue WHERE COALESCE(status, 'pending') = 'pending'"),
            reflections: scalar('SELECT COUNT(*) AS n FROM reflections'),
            recent: this.db.prepare('SELECT uri, handle, action, reason, processed_at FROM processed_interactions ORDER BY processed_at DESC LIMIT 20').all(),
            queuedReview: this.db.prepare("SELECT id, uri, handle, thread_uri, reason, text, status, created_at FROM review_queue WHERE COALESCE(status, 'pending') = 'pending' ORDER BY created_at DESC LIMIT 20").all(),
        };
    }
}

export default new InteractionStore();
