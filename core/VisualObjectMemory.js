import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

function boxOf(object) {
    const box = object?.bbox;
    if (!Array.isArray(box) || box.length < 4 || box.some(value => !Number.isFinite(Number(value)))) return null;
    return box.slice(0, 4).map(Number);
}

function iou(a, b) {
    if (!a || !b) return 0;
    const [ax, ay, aw, ah] = a, [bx, by, bw, bh] = b;
    const left = Math.max(ax, bx), top = Math.max(ay, by);
    const right = Math.min(ax + aw, bx + bw), bottom = Math.min(ay + ah, by + bh);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = aw * ah + bw * bh - intersection;
    return union > 0 ? intersection / union : 0;
}

function centerDistance(a, b) {
    if (!a || !b) return Infinity;
    return Math.hypot((a[0] + a[2] / 2) - (b[0] + b[2] / 2), (a[1] + a[3] / 2) - (b[1] + b[3] / 2));
}

/** Persistent, privacy-conservative tracking across vision frames. */
export class VisualObjectMemory {
    constructor({ dbPath = 'data/vision/object-memory.db', maxTrackAgeMs = 15_000 } = {}) {
        this.dbPath = path.resolve(dbPath);
        this.maxTrackAgeMs = maxTrackAgeMs;
        this.db = null;
        this.active = new Map();
    }

    initialize() {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS visual_entities (
                track_id TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL,
                identity_label TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
                observation_count INTEGER NOT NULL DEFAULT 0, last_channel TEXT,
                last_bbox TEXT, confidence REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS visual_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL,
                observed_at INTEGER NOT NULL, channel TEXT NOT NULL, label TEXT NOT NULL,
                confidence REAL NOT NULL, bbox TEXT, frame_path TEXT,
                FOREIGN KEY(track_id) REFERENCES visual_entities(track_id)
            );
            CREATE INDEX IF NOT EXISTS idx_visual_observations_track_time
                ON visual_observations(track_id, observed_at DESC);
            CREATE TABLE IF NOT EXISTS social_profiles (
                profile_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
                consent_source TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS visual_identity_links (
                track_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, linked_at INTEGER NOT NULL,
                evidence TEXT NOT NULL,
                FOREIGN KEY(track_id) REFERENCES visual_entities(track_id),
                FOREIGN KEY(profile_id) REFERENCES social_profiles(profile_id)
            );
        `);
        return this;
    }

    ingest({ objects = [], timestamp = Date.now(), channel = 'unknown', imagePath = null } = {}) {
        if (!this.db) this.initialize();
        const candidates = (Array.isArray(objects) ? objects : [])
            .filter(object => object?.label)
            .map(object => ({ ...object, label: String(object.label).toLowerCase(), bbox: boxOf(object) }));
        const used = new Set();
        const tracked = [];

        for (const object of candidates) {
            let best = null;
            for (const track of this.active.values()) {
                if (used.has(track.trackId) || track.label !== object.label || timestamp - track.lastSeen > this.maxTrackAgeMs) continue;
                const overlap = iou(track.bbox, object.bbox);
                const distance = centerDistance(track.bbox, object.bbox);
                const score = overlap > 0 ? overlap : Math.max(0, 0.35 - distance);
                if ((overlap >= 0.2 || distance <= 0.18) && (!best || score > best.score)) best = { track, score };
            }
            const trackId = best?.track.trackId || `visual-${crypto.randomUUID()}`;
            const track = {
                trackId, label: object.label,
                category: object.label === 'person' ? 'person' : 'object',
                identityLabel: best?.track.identityLabel || null,
                firstSeen: best?.track.firstSeen || timestamp,
                lastSeen: timestamp,
                bbox: object.bbox,
                confidence: Number(object.score ?? object.confidence ?? 0.5),
                channel,
                motion: best?.track?.bbox && object.bbox ? {
                    dx: (object.bbox[0] + object.bbox[2] / 2) - (best.track.bbox[0] + best.track.bbox[2] / 2),
                    dy: (object.bbox[1] + object.bbox[3] / 2) - (best.track.bbox[1] + best.track.bbox[3] / 2),
                    elapsedMs: Math.max(1, timestamp - best.track.lastSeen),
                } : null,
            };
            this.active.set(trackId, track);
            used.add(trackId);
            this._store(track, imagePath);
            tracked.push({ ...object, trackId, category: track.category, identityLabel: track.identityLabel, motion: track.motion });
        }
        for (const [id, track] of this.active) if (timestamp - track.lastSeen > this.maxTrackAgeMs) this.active.delete(id);
        return tracked;
    }

    _store(track, imagePath) {
        const bbox = track.bbox ? JSON.stringify(track.bbox) : null;
        this.db.prepare(`INSERT INTO visual_entities
            (track_id,label,category,identity_label,first_seen,last_seen,observation_count,last_channel,last_bbox,confidence)
            VALUES (@trackId,@label,@category,NULL,@firstSeen,@lastSeen,1,@channel,@bbox,@confidence)
            ON CONFLICT(track_id) DO UPDATE SET last_seen=excluded.last_seen,
            observation_count=visual_entities.observation_count+1,last_channel=excluded.last_channel,
            last_bbox=excluded.last_bbox,confidence=excluded.confidence`).run({ ...track, bbox });
        this.db.prepare(`INSERT INTO visual_observations
            (track_id,observed_at,channel,label,confidence,bbox,frame_path)
            VALUES (?,?,?,?,?,?,?)`).run(track.trackId, track.lastSeen, track.channel, track.label, track.confidence, bbox, imagePath);
    }

    getEntity(trackId) {
        const row = this.db?.prepare('SELECT * FROM visual_entities WHERE track_id = ?').get(trackId);
        if (!row) return null;
        return { ...row, last_bbox: row.last_bbox ? JSON.parse(row.last_bbox) : null };
    }

    enrollIdentity(trackId, displayName, { evidence, consentSource = 'spoken_self_introduction', timestamp = Date.now() } = {}) {
        if (!this.db) this.initialize();
        const entity = this.getEntity(trackId);
        if (!entity || entity.category !== 'person') throw new Error('A current person track is required for identity enrollment');
        if (!evidence) throw new Error('Identity enrollment requires consent evidence');
        const name = String(displayName || '').trim().replace(/\s+/g, ' ');
        if (!/^[\p{L}][\p{L}' -]{0,49}$/u.test(name)) throw new Error('Introduction did not contain a safe display name');
        const profileId = `person-${crypto.createHash('sha256').update(name.toLocaleLowerCase()).digest('hex').slice(0, 16)}`;
        const transaction = this.db.transaction(() => {
            this.db.prepare(`INSERT INTO social_profiles(profile_id,display_name,consent_source,created_at,last_seen)
                VALUES (?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET display_name=excluded.display_name,last_seen=excluded.last_seen`)
                .run(profileId, name, consentSource, timestamp, timestamp);
            this.db.prepare(`INSERT INTO visual_identity_links(track_id,profile_id,linked_at,evidence)
                VALUES (?,?,?,?) ON CONFLICT(track_id) DO UPDATE SET profile_id=excluded.profile_id,linked_at=excluded.linked_at,evidence=excluded.evidence`)
                .run(trackId, profileId, timestamp, JSON.stringify(evidence));
            this.db.prepare('UPDATE visual_entities SET identity_label = ? WHERE track_id = ?').run(name, trackId);
        });
        transaction();
        const active = this.active.get(trackId);
        if (active) active.identityLabel = name;
        return { profileId, trackId, displayName: name, consentSource, enrolledAt: timestamp };
    }

    getProfileForTrack(trackId) {
        return this.db?.prepare(`SELECT p.*, l.track_id, l.linked_at FROM visual_identity_links l
            JOIN social_profiles p ON p.profile_id=l.profile_id WHERE l.track_id=?`).get(trackId) || null;
    }

    revokeIdentity(profileId) {
        if (!this.db) this.initialize();
        const transaction = this.db.transaction(() => {
            const tracks = this.db.prepare('SELECT track_id FROM visual_identity_links WHERE profile_id=?').all(profileId);
            this.db.prepare('DELETE FROM visual_identity_links WHERE profile_id=?').run(profileId);
            this.db.prepare('DELETE FROM social_profiles WHERE profile_id=?').run(profileId);
            for (const { track_id } of tracks) {
                this.db.prepare('UPDATE visual_entities SET identity_label=NULL WHERE track_id=?').run(track_id);
                const active = this.active.get(track_id);
                if (active) active.identityLabel = null;
            }
            return tracks.length;
        });
        return { profileId, revokedLinks: transaction() };
    }

    getActive() { return [...this.active.values()].map(track => ({ ...track })); }
    close() { this.db?.close(); this.db = null; }
}

export default VisualObjectMemory;
