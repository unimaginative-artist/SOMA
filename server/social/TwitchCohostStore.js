import { publicTwitchText } from './TwitchSafety.js';
import { windowsProtect } from './TwitchDeviceAuth.js';
import { randomUUID } from 'node:crypto';

export const TWITCH_STYLES = Object.freeze({
    warm: 'Warm, direct and encouraging, without canned praise.',
    cozy: 'Relaxed and thoughtful: a cozy conversational companion.',
    witty: 'Warm and witty, with occasional light wordplay.',
    technical: 'Clear, curious and technically precise; explain simply when needed.',
    playful: 'Playful, upbeat and imaginative without being loud or insulting.'
});

// Uses the EXISTING pilot database, not a second identity/memory system.
// Only explicitly saved public preferences are retained, encrypted with DPAPI.
export class TwitchCohostStore {
    constructor(access, { codec = windowsProtect, now = Date.now } = {}) {
        this.access = access; this.codec = codec; this.now = now;
        const db = this.db();
        db.pragma('secure_delete = ON');
        db.exec(`CREATE TABLE IF NOT EXISTS twitch_profiles (
            tenant_id TEXT PRIMARY KEY, settings TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS twitch_viewer_preferences (
            tenant_id TEXT NOT NULL, viewer_id TEXT NOT NULL, encrypted TEXT,
            consent_at INTEGER NOT NULL, consent_version TEXT NOT NULL, expires_at INTEGER NOT NULL,
            PRIMARY KEY (tenant_id, viewer_id));
            CREATE TABLE IF NOT EXISTS twitch_event_receipts (
            tenant_id TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
            state TEXT NOT NULL, created_at INTEGER NOT NULL, delivery TEXT,
            PRIMARY KEY (tenant_id, event_id));`);
    }
    db() { if (!this.access.db?.open) throw new Error('Twitch co-host storage unavailable'); return this.access.db; }
    allowed(channel) {
        const access = this.access.check(channel);
        if (!access.allowed) throw new Error('Channel is not authorized for the private pilot');
        return access;
    }
    viewer(viewerId) { if (!/^\d{1,30}$/.test(viewerId || '')) throw new Error('Verified Twitch viewer identity required'); }
    profile(channel) {
        const access = this.allowed(channel);
        const stored = this.db().prepare('SELECT settings FROM twitch_profiles WHERE tenant_id=?').get(access.tenantId);
        return { style: 'witty', humor: 1, verbosity: 'short', memoryEnabled: access.owner === true,
            raids: true, cheers: true, polls: true, ...(stored ? JSON.parse(stored.settings) : {}) };
    }
    setProfile(channel, patch) {
        const access = this.allowed(channel);
        const allowed = ['style', 'humor', 'verbosity', 'memoryEnabled', 'raids', 'cheers', 'polls'];
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !allowed.includes(k))) throw new Error('Unknown co-host setting');
        if (patch.style !== undefined && !Object.hasOwn(TWITCH_STYLES, patch.style)) throw new Error('Unknown personality preset');
        if (patch.humor !== undefined && (!Number.isInteger(patch.humor) || patch.humor < 0 || patch.humor > 3)) throw new Error('Humor must be 0–3');
        if (patch.verbosity !== undefined && !['short', 'normal'].includes(patch.verbosity)) throw new Error('Verbosity must be short or normal');
        for (const key of allowed.slice(3)) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
        const settings = { ...this.profile(channel), ...patch };
        this.db().transaction(() => {
            this.db().prepare('INSERT INTO twitch_profiles VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET settings=excluded.settings').run(access.tenantId, JSON.stringify(settings));
            if (!settings.memoryEnabled) this.db().prepare('DELETE FROM twitch_viewer_preferences WHERE tenant_id=?').run(access.tenantId);
        })();
        return settings;
    }
    consent(channel, viewerId) {
        this.viewer(viewerId); const access = this.allowed(channel);
        if (!this.profile(channel).memoryEnabled) throw new Error('Viewer memory is disabled for this channel');
        this.sweep();
        const existing = this.db().prepare('SELECT consent_at FROM twitch_viewer_preferences WHERE tenant_id=? AND viewer_id=?').get(access.tenantId, viewerId);
        if (!existing && this.db().prepare('SELECT COUNT(*) AS n FROM twitch_viewer_preferences WHERE tenant_id=?').get(access.tenantId).n >= 500) throw new Error('Channel viewer-memory limit reached');
        this.db().prepare(`INSERT INTO twitch_viewer_preferences VALUES (?,?,NULL,?,?,?)
            ON CONFLICT(tenant_id,viewer_id) DO UPDATE SET expires_at=excluded.expires_at`).run(access.tenantId, viewerId, this.now(), randomUUID(), this.now() + 30 * 86400000);
    }
    async recall(channel, viewerId) {
        this.viewer(viewerId); const access = this.allowed(channel);
        if (!this.profile(channel).memoryEnabled) return [];
        const row = this.db().prepare('SELECT * FROM twitch_viewer_preferences WHERE tenant_id=? AND viewer_id=? AND expires_at>?').get(access.tenantId, viewerId, this.now());
        if (!row?.encrypted) return [];
        const values = JSON.parse(await this.codec(row.encrypted, true));
        // Recheck after the asynchronous decrypt: opt-out/revocation wins.
        if (this.access.check(channel).tenantId !== access.tenantId || !this.access.check(channel).allowed
            || !this.profile(channel).memoryEnabled
            || !this.db().prepare('SELECT 1 FROM twitch_viewer_preferences WHERE tenant_id=? AND viewer_id=? AND encrypted=? AND expires_at>?').get(access.tenantId, viewerId, row.encrypted, this.now())) return [];
        return Array.isArray(values) ? values.slice(-3).filter(v => typeof v === 'string' && publicTwitchText(v) === v && v.length <= 160) : [];
    }
    preferenceStamp(channel, viewerId) {
        this.viewer(viewerId); const access = this.allowed(channel);
        if (!this.profile(channel).memoryEnabled) return null;
        const row = this.db().prepare('SELECT consent_version, encrypted FROM twitch_viewer_preferences WHERE tenant_id=? AND viewer_id=? AND expires_at>?').get(access.tenantId, viewerId, this.now());
        // Host-only revocation check; never include this value in a model prompt.
        return row?.encrypted ? `${row.consent_version}:${row.encrypted}` : null;
    }
    async remember(channel, viewerId, preference) {
        this.viewer(viewerId); const access = this.allowed(channel);
        const safe = publicTwitchText(preference);
        if (!safe || safe !== preference.trim() || safe.length > 160
            || /[a-z]:\\|\/(?:home|users)\//i.test(safe)
            || /\b(?:address|phone|birthday|password|secret|diagnosis|medical|ssn|credit card|bank account|email)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(safe)) throw new Error('Save only short, non-sensitive public interests or preferences');
        const original = this.db().prepare('SELECT * FROM twitch_viewer_preferences WHERE tenant_id=? AND viewer_id=? AND expires_at>?').get(access.tenantId, viewerId, this.now());
        if (!this.profile(channel).memoryEnabled || !original) throw new Error('Use !soma memory on to consent before saving a preference');
        const old = await this.recall(channel, viewerId);
        const encrypted = await this.codec(JSON.stringify([...new Set([...old, safe])].slice(-3)));
        const current = this.access.check(channel);
        if (!current.allowed || current.tenantId !== access.tenantId || !this.profile(channel).memoryEnabled) throw new Error('Channel memory access changed');
        const updated = this.db().prepare(`UPDATE twitch_viewer_preferences SET encrypted=?, expires_at=?
            WHERE tenant_id=? AND viewer_id=? AND consent_version=? AND encrypted IS ? AND expires_at>?`)
            .run(encrypted, this.now() + 30 * 86400000, access.tenantId, viewerId, original.consent_version, original.encrypted, this.now());
        if (!updated.changes) throw new Error('Consent or saved preferences changed; nothing was saved');
        return { saved: true, retentionDays: 30 };
    }
    forget(channel, viewerId) {
        this.viewer(viewerId); const access = this.allowed(channel);
        this.db().prepare('DELETE FROM twitch_viewer_preferences WHERE tenant_id=? AND viewer_id=?').run(access.tenantId, viewerId);
    }
    purgeTenant(tenantId) {
        for (const table of ['twitch_profiles', 'twitch_viewer_preferences', 'twitch_event_receipts']) this.db().prepare(`DELETE FROM ${table} WHERE tenant_id=?`).run(tenantId);
    }
    claimEvent(channel, id, type) {
        const access = this.allowed(channel); this.sweep();
        return this.db().prepare('INSERT OR IGNORE INTO twitch_event_receipts VALUES (?,?,?,\'accepted\',?,NULL)').run(access.tenantId, id, type, this.now()).changes > 0;
    }
    finishEvent(tenantId, id, delivery) {
        this.db().prepare('UPDATE twitch_event_receipts SET state=?,delivery=? WHERE tenant_id=? AND event_id=?')
            .run(delivery.status === 'sent' ? 'completed' : 'failed', JSON.stringify(delivery), tenantId, id);
    }
    sweep() {
        this.db().prepare('DELETE FROM twitch_viewer_preferences WHERE expires_at<=?').run(this.now());
        this.db().prepare('DELETE FROM twitch_event_receipts WHERE created_at<?').run(this.now() - 7 * 86400000);
        this.db().exec(`DELETE FROM twitch_event_receipts WHERE rowid NOT IN
            (SELECT rowid FROM twitch_event_receipts ORDER BY created_at DESC, rowid DESC LIMIT 1000)`);
    }
}
