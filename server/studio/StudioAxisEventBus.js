import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_EVENTS = 50_000;

function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
}

function cleanType(value) {
    return String(value || 'studio.event')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 120) || 'studio.event';
}

function cleanId(value, max = 200) {
    return String(value || '').trim().slice(0, max);
}

function normalizeAudience(value) {
    return Array.isArray(value) ? [...new Set(value.map(item => cleanId(item, 160)).filter(Boolean))].slice(0, 200) : [];
}

function schemaForType(type) {
    if (type.startsWith('studio.live.')) return 'studio.live.event.v1';
    if (type.startsWith('studio.feed.') || type.startsWith('studio.comment.') || type.startsWith('studio.saved.')) return 'studio.social.event.v1';
    if (type.startsWith('studio.signal.')) return 'studio.signal.event.v1';
    if (type.startsWith('studio.moderation.') || type.startsWith('moderation.')) return 'studio.moderation.event.v1';
    if (type.startsWith('axis.') || type.startsWith('studio.axis.')) return 'axis.activity.event.v1';
    return 'studio.axis.envelope.v1';
}

function validatePayload(type, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('Studio/Axis event payload must be an object');
    }
    if (type.startsWith('studio.live.') && !cleanId(payload.roomId || payload.room?.id, 200)) {
        throw new TypeError(`${schemaForType(type)} requires roomId`);
    }
    if (type.startsWith('studio.live.webrtc_')) {
        const kind = String(payload.signal?.kind || '').toLowerCase();
        if (!['offer', 'answer', 'ice', 'leave'].includes(kind)) {
            throw new TypeError('studio.live.event.v1 requires a supported WebRTC signal kind');
        }
    }
}

function publicEvent(row) {
    if (!row) return null;
    return {
        id: row.id,
        schemaVersion: Number(row.schema_version || SCHEMA_VERSION),
        schemaId: row.schema_id || schemaForType(row.type),
        type: row.type,
        source: row.source,
        actorId: row.actor_id || '',
        targetId: row.target_id || '',
        audience: safeJson(row.audience_json, []),
        payload: safeJson(row.payload_json, {}),
        idempotencyKey: row.idempotency_key || '',
        createdAt: Number(row.created_at || 0),
    };
}

export class StudioAxisEventBus {
    constructor({
        file = path.join(process.cwd(), 'SOMA', 'studio-axis-events.db'),
        legacyFile = path.join(process.cwd(), 'SOMA', 'studio-axis-events.jsonl'),
        retentionMs = Number(process.env.STUDIO_EVENT_RETENTION_MS) || DEFAULT_RETENTION_MS,
        maxEvents = Number(process.env.STUDIO_EVENT_MAX_ROWS) || DEFAULT_MAX_EVENTS,
    } = {}) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.file = file;
        this.legacyFile = legacyFile;
        this.retentionMs = Math.max(Number(retentionMs) || DEFAULT_RETENTION_MS, 60_000);
        this.maxEvents = Math.max(Number(maxEvents) || DEFAULT_MAX_EVENTS, 1_000);
        this.events = new EventEmitter();
        this.events.setMaxListeners(500);
        this.bridges = new Set();
        this.broadcasters = new Set();
        this.sequence = 0;
        this.recent = [];
        this.lastRetentionAt = 0;
        this.db = new Database(file);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');
        this._init();
        this._migrateJsonl();
        this.lastCreatedAt = Number(this.db.prepare('SELECT MAX(created_at) AS value FROM studio_axis_events').get()?.value || 0);
    }

    _init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS studio_axis_events (
                id TEXT PRIMARY KEY,
                schema_version INTEGER NOT NULL DEFAULT 1,
                schema_id TEXT NOT NULL DEFAULT 'studio.axis.envelope.v1',
                type TEXT NOT NULL,
                source TEXT NOT NULL,
                actor_id TEXT NOT NULL DEFAULT '',
                target_id TEXT NOT NULL DEFAULT '',
                audience_json TEXT NOT NULL DEFAULT '[]',
                payload_json TEXT NOT NULL DEFAULT '{}',
                idempotency_key TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            );
            CREATE UNIQUE INDEX IF NOT EXISTS studio_axis_events_idempotency
                ON studio_axis_events(idempotency_key)
                WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
            CREATE INDEX IF NOT EXISTS studio_axis_events_type_created
                ON studio_axis_events(type, created_at DESC);
            CREATE INDEX IF NOT EXISTS studio_axis_events_target_created
                ON studio_axis_events(target_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS studio_axis_checkpoints (
                consumer_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                event_created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS studio_axis_migrations (
                name TEXT PRIMARY KEY,
                completed_at INTEGER NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}'
            );
        `);
        const columns = new Set(this.db.prepare('PRAGMA table_info(studio_axis_events)').all().map(column => column.name));
        if (!columns.has('schema_id')) {
            this.db.exec("ALTER TABLE studio_axis_events ADD COLUMN schema_id TEXT NOT NULL DEFAULT 'studio.axis.envelope.v1'");
        }
        this.insertEvent = this.db.prepare(`
            INSERT INTO studio_axis_events (
                id, schema_version, schema_id, type, source, actor_id, target_id,
                audience_json, payload_json, idempotency_key, created_at, expires_at
            ) VALUES (
                @id, @schema_version, @schema_id, @type, @source, @actor_id, @target_id,
                @audience_json, @payload_json, @idempotency_key, @created_at, @expires_at
            )
        `);
    }

    attachBroadcaster(broadcaster) {
        if (typeof broadcaster !== 'function' || this.broadcasters.has(broadcaster)) return () => {};
        this.broadcasters.add(broadcaster);
        return () => this.broadcasters.delete(broadcaster);
    }

    bridge(name, subscribe) {
        const key = cleanId(name, 120);
        if (!key || this.bridges.has(key) || typeof subscribe !== 'function') return false;
        const off = subscribe();
        this.bridges.add(key);
        if (typeof off === 'function') this.events.once(`bridge:close:${key}`, off);
        return true;
    }

    publish(type, payload = {}, options = {}) {
        const normalizedType = cleanType(type);
        validatePayload(normalizedType, payload);
        const now = Math.max(Date.now(), this.lastCreatedAt + 1);
        this.lastCreatedAt = now;
        const idempotencyKey = cleanId(options.idempotencyKey, 240);
        if (idempotencyKey && !options.ephemeral) {
            const duplicate = this.db.prepare('SELECT * FROM studio_axis_events WHERE idempotency_key = ?').get(idempotencyKey);
            if (duplicate) return publicEvent(duplicate);
        }
        const event = {
            id: cleanId(options.id, 240) || `sax-${now}-${(++this.sequence).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            schemaVersion: SCHEMA_VERSION,
            schemaId: schemaForType(normalizedType),
            type: normalizedType,
            source: cleanId(options.source || 'studio', 40),
            actorId: cleanId(options.actorId || payload.actorId || payload.userId, 160),
            targetId: cleanId(options.targetId || payload.targetId || payload.roomId || payload.channelId, 200),
            audience: normalizeAudience(options.audience),
            payload,
            idempotencyKey,
            createdAt: now,
        };
        this.recent.push(event);
        this.recent = this.recent
            .filter(item => now - Number(item.createdAt || 0) < 5 * 60 * 1000)
            .slice(-1_000);
        if (!options.ephemeral) {
            try {
                this.insertEvent.run({
                    id: event.id,
                    schema_version: event.schemaVersion,
                    schema_id: event.schemaId,
                    type: event.type,
                    source: event.source,
                    actor_id: event.actorId,
                    target_id: event.targetId,
                    audience_json: JSON.stringify(event.audience),
                    payload_json: JSON.stringify(event.payload),
                    idempotency_key: event.idempotencyKey || null,
                    created_at: event.createdAt,
                    expires_at: options.ttlMs ? now + Math.max(Number(options.ttlMs) || 0, 1_000) : null,
                });
            } catch (error) {
                if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' && idempotencyKey) {
                    return publicEvent(this.db.prepare('SELECT * FROM studio_axis_events WHERE idempotency_key = ?').get(idempotencyKey));
                }
                throw error;
            }
            this._retain(now);
        }
        this.events.emit('event', event);
        for (const broadcast of this.broadcasters) {
            try { broadcast(event.type, event); } catch { /* broadcaster recovery is external */ }
        }
        return event;
    }

    subscribe(listener, filter = {}) {
        const wrapped = event => {
            if (filter.typePrefix && !event.type.startsWith(filter.typePrefix)) return;
            if (filter.targetId && event.targetId !== filter.targetId) return;
            if (filter.userId && event.audience.length && !event.audience.includes(filter.userId)) return;
            listener(event);
        };
        this.events.on('event', wrapped);
        return () => this.events.off('event', wrapped);
    }

    history({ typePrefix = '', targetId = '', userId = '', limit = 100, before = Infinity, after = 0 } = {}) {
        const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const clauses = ['created_at < @before', 'created_at > @after', '(expires_at IS NULL OR expires_at > @now)'];
        const args = {
            before: Number.isFinite(Number(before)) ? Number(before) : Number.MAX_SAFE_INTEGER,
            after: Math.max(Number(after) || 0, 0),
            now: Date.now(),
            limit: Math.min(boundedLimit * 5, 2_500),
        };
        if (typePrefix) {
            clauses.push('type LIKE @typePrefix');
            args.typePrefix = `${cleanType(typePrefix)}%`;
        }
        if (targetId) {
            clauses.push('target_id = @targetId');
            args.targetId = cleanId(targetId);
        }
        const durable = this.db.prepare(`
            SELECT * FROM studio_axis_events
            WHERE ${clauses.join(' AND ')}
            ORDER BY created_at DESC
            LIMIT @limit
        `).all(args).map(publicEvent);
        const byId = new Map([...durable, ...this.recent].map(event => [event.id, event]));
        return [...byId.values()]
            .filter(event => !typePrefix || event.type.startsWith(cleanType(typePrefix)))
            .filter(event => !targetId || event.targetId === targetId)
            .filter(event => !userId || !event.audience.length || event.audience.includes(userId))
            .filter(event => Number(event.createdAt || 0) < args.before && Number(event.createdAt || 0) > args.after)
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .slice(0, boundedLimit);
    }

    checkpoint(consumerId, eventOrId) {
        const id = cleanId(consumerId, 160);
        const eventId = cleanId(typeof eventOrId === 'object' ? eventOrId?.id : eventOrId, 240);
        if (!id || !eventId) throw new Error('Checkpoint requires consumer and event IDs');
        const row = this.db.prepare('SELECT created_at FROM studio_axis_events WHERE id = ?').get(eventId);
        const createdAt = Number(row?.created_at || (typeof eventOrId === 'object' ? eventOrId.createdAt : 0));
        if (!createdAt) throw new Error('Checkpoint event is not available');
        this.db.prepare(`
            INSERT INTO studio_axis_checkpoints (consumer_id, event_id, event_created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(consumer_id) DO UPDATE SET
                event_id = excluded.event_id,
                event_created_at = excluded.event_created_at,
                updated_at = excluded.updated_at
        `).run(id, eventId, createdAt, Date.now());
        return { consumerId: id, eventId, eventCreatedAt: createdAt };
    }

    getCheckpoint(consumerId) {
        const row = this.db.prepare('SELECT * FROM studio_axis_checkpoints WHERE consumer_id = ?').get(cleanId(consumerId, 160));
        return row ? {
            consumerId: row.consumer_id,
            eventId: row.event_id,
            eventCreatedAt: Number(row.event_created_at),
            updatedAt: Number(row.updated_at),
        } : null;
    }

    replay(consumerId, options = {}) {
        const checkpoint = this.getCheckpoint(consumerId);
        return this.history({ ...options, after: checkpoint?.eventCreatedAt || 0 }).reverse();
    }

    close() {
        for (const key of this.bridges) this.events.emit(`bridge:close:${key}`);
        this.bridges.clear();
        this.broadcasters.clear();
        this.events.removeAllListeners();
        this.db.close();
    }

    _retain(now = Date.now()) {
        if (now - this.lastRetentionAt < 60_000) return;
        this.lastRetentionAt = now;
        this.db.prepare('DELETE FROM studio_axis_events WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
        this.db.prepare('DELETE FROM studio_axis_events WHERE created_at < ?').run(now - this.retentionMs);
        this.db.prepare(`
            DELETE FROM studio_axis_events
            WHERE id IN (
                SELECT id FROM studio_axis_events
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?
            )
        `).run(this.maxEvents);
    }

    _migrateJsonl() {
        const migration = 'jsonl-to-sqlite-v1';
        if (this.db.prepare('SELECT 1 FROM studio_axis_migrations WHERE name = ?').get(migration)) return;
        let imported = 0;
        if (fs.existsSync(this.legacyFile)) {
            const insert = this.db.transaction(rows => {
                for (const event of rows) {
                    if (!event?.id || !event?.type) continue;
                    this.insertEvent.run({
                        id: cleanId(event.id, 240),
                        schema_version: Number(event.schemaVersion || SCHEMA_VERSION),
                        schema_id: cleanId(event.schemaId, 120) || schemaForType(cleanType(event.type)),
                        type: cleanType(event.type),
                        source: cleanId(event.source || 'studio', 40),
                        actor_id: cleanId(event.actorId, 160),
                        target_id: cleanId(event.targetId, 200),
                        audience_json: JSON.stringify(normalizeAudience(event.audience)),
                        payload_json: JSON.stringify(event.payload && typeof event.payload === 'object' ? event.payload : {}),
                        idempotency_key: cleanId(event.idempotencyKey, 240) || null,
                        created_at: Number(event.createdAt || Date.now()),
                        expires_at: null,
                    });
                    imported += 1;
                }
            });
            const rows = fs.readFileSync(this.legacyFile, 'utf8')
                .split(/\r?\n/)
                .filter(Boolean)
                .map(line => safeJson(line, null))
                .filter(Boolean);
            try { insert(rows); } catch { /* individual duplicates are safe to ignore on an existing database */ }
        }
        this.db.prepare('INSERT OR REPLACE INTO studio_axis_migrations (name, completed_at, metadata_json) VALUES (?, ?, ?)')
            .run(migration, Date.now(), JSON.stringify({ imported, legacyFile: this.legacyFile }));
    }
}

export default new StudioAxisEventBus();
