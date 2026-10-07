import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { twitchName, twitchChannels } from './TwitchSafety.js';

// Operator-managed private pilot only. Payments never grant access here.
// Keep this entitlement ledger separate from execution tools and personal data.
export class TwitchPilotAccess {
    constructor({ filename, ownerChannels = ['owner'], now = Date.now } = {}) {
        this.ownerChannels = new Set(twitchChannels(ownerChannels));
        this.now = now;
        this.db = null;
        try {
            if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
            this.db = new Database(filename);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('busy_timeout = 1000');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS pilot_channels (
                    channel TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL, expires_at INTEGER NOT NULL,
                    daily_limit INTEGER NOT NULL, updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS pilot_usage (
                    tenant_id TEXT NOT NULL, day TEXT NOT NULL, attempts INTEGER NOT NULL,
                    PRIMARY KEY (tenant_id, day)
                );
            `);
        } catch {
            this.db?.close(); this.db = null;
        }
    }

    check(value) {
        const channel = twitchName(value);
        if (!this.db?.open) return { allowed: false, reason: 'pilot_access_unavailable' };
        if (this.ownerChannels.has(channel)) return { allowed: true, tenantId: `owner:${channel}`, dailyLimit: 500, owner: true };
        const row = this.db.prepare('SELECT * FROM pilot_channels WHERE channel = ?').get(channel);
        if (!row || row.state !== 'active') return { allowed: false, reason: 'channel_not_invited' };
        if (row.expires_at <= this.now()) return { allowed: false, reason: 'pilot_invite_expired' };
        return { allowed: true, tenantId: row.tenant_id, dailyLimit: row.daily_limit, owner: false };
    }

    grant({ channel: value, days = 7, dailyLimit = 100, consentConfirmed } = {}) {
        const channel = twitchName(value);
        if (consentConfirmed !== true) throw new Error('Confirm the channel owner consented to this private pilot');
        if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error('Pilot duration must be 1–31 days');
        if (!Number.isInteger(dailyLimit) || dailyLimit < 10 || dailyLimit > 500) throw new Error('Daily model-attempt limit must be 10–500');
        if (!this.db?.open) throw new Error('Pilot access store unavailable');
        if (this.ownerChannels.has(channel)) throw new Error('Owner channels are not subscriber invites');
        return this.db.transaction(() => {
            const previous = this.db.prepare('SELECT * FROM pilot_channels WHERE channel = ?').get(channel);
            const active = this.db.prepare("SELECT COUNT(*) AS n FROM pilot_channels WHERE state = 'active' AND expires_at > ?").get(this.now()).n;
            if ((!previous || previous.state !== 'active' || previous.expires_at <= this.now()) && active >= 9) throw new Error('Private pilot is limited to nine subscriber channels');
            // A reissued/reassigned invite gets a fresh isolation identity.
            const tenantId = previous?.state === 'active' && previous.expires_at > this.now() ? previous.tenant_id : randomUUID();
            this.db.prepare(`INSERT INTO pilot_channels VALUES (?, ?, 'active', ?, ?, ?)
                ON CONFLICT(channel) DO UPDATE SET tenant_id=excluded.tenant_id, state='active',
                expires_at=excluded.expires_at, daily_limit=excluded.daily_limit, updated_at=excluded.updated_at`)
                .run(channel, tenantId, this.now() + days * 86400000, dailyLimit, this.now());
            return this.list().find(item => item.channel === channel);
        })();
    }

    revoke(value) {
        const channel = twitchName(value);
        if (!this.db?.open) throw new Error('Pilot access store unavailable');
        this.db.prepare("UPDATE pilot_channels SET state='revoked', updated_at=? WHERE channel=?").run(this.now(), channel);
        return { channel, state: 'revoked' };
    }

    reserve(value) {
        try {
            if (!this.db?.open) return { allowed: false, reason: 'pilot_access_unavailable' };
            return this.db.transaction(() => {
                const access = this.check(value);
                if (!access.allowed) return access;
                const day = new Date(this.now()).toISOString().slice(0, 10);
                const used = this.db.prepare('SELECT attempts FROM pilot_usage WHERE tenant_id=? AND day=?').get(access.tenantId, day)?.attempts || 0;
                if (used >= access.dailyLimit) return { allowed: false, reason: 'daily_model_quota_exhausted' };
                this.db.prepare(`INSERT INTO pilot_usage VALUES (?, ?, 1)
                    ON CONFLICT(tenant_id, day) DO UPDATE SET attempts=attempts+1`).run(access.tenantId, day);
                this.db.prepare('DELETE FROM pilot_usage WHERE day < ?').run(new Date(this.now() - 31 * 86400000).toISOString().slice(0, 10));
                return { ...access, attemptsToday: used + 1 };
            })();
        } catch { return { allowed: false, reason: 'pilot_access_unavailable' }; }
    }

    list() {
        if (!this.db?.open) return [];
        const day = new Date(this.now()).toISOString().slice(0, 10);
        return this.db.prepare(`SELECT channel, tenant_id AS tenantId, state, expires_at AS expiresAt,
            daily_limit AS dailyLimit, updated_at AS updatedAt,
            COALESCE((SELECT attempts FROM pilot_usage u WHERE u.tenant_id=c.tenant_id AND u.day=?), 0) AS attemptsToday
            FROM pilot_channels c ORDER BY channel`).all(day);
    }

    status() {
        return { mode: 'private_pilot', available: Boolean(this.db?.open), billingEnabled: false,
            paidLaunchReady: false, subscriberMemoryEnabled: false,
            channelOwnershipVerification: 'manual_pilot_consent; Twitch OAuth onboarding not implemented',
            ownerChannels: [...this.ownerChannels], invites: this.list() };
    }
    close() { if (this.db?.open) this.db.close(); }
}
