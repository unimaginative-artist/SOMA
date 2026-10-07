import fs from 'node:fs/promises';
import path from 'node:path';
import outboundAutonomyGate from './OutboundAutonomyGate.js';

async function atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporary, filePath);
}

/** Meaningful, consent-aware presence: verified changes, not heartbeat theater. */
export class ProactivePresence {
    constructor({ system = null, gate = outboundAutonomyGate, statePath = 'data/reality-loop/proactive-presence.json', now = () => Date.now(), maxPerDay = 4, cooldownMs = 30 * 60_000 } = {}) {
        this.system = system;
        this.gate = gate;
        this.statePath = path.resolve(statePath);
        this.now = now;
        this.maxPerDay = Math.max(1, Number(maxPerDay) || 4);
        this.cooldownMs = Math.max(60_000, Number(cooldownMs) || 30 * 60_000);
        this.state = { schemaVersion: 1, consent: { operational: true, social: false }, sent: [], suppressed: [], updatedAt: null };
    }

    async initialize(system = this.system) {
        this.system = system || this.system;
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = parsed;
        } catch { /* first boot */ }
        return this;
    }

    async setConsent(consent = {}) {
        this.state.consent = { ...this.state.consent, ...consent };
        await this._persist();
        return this.getStatus();
    }

    async reportVerifiedWork({ message, evidence, source = 'reality_loop' } = {}) {
        if (!this.state.consent.operational) return this._suppress('operational_consent_disabled', message);
        return this._deliver({ message, evidence, source, kind: 'verified_work', verified: true });
    }

    async socialCheckIn({ message, source = 'being_kernel' } = {}) {
        if (!this.state.consent.social) return this._suppress('social_consent_disabled', message);
        return this._deliver({ message, evidence: null, source, kind: 'reflection', verified: false });
    }

    /**
     * Messages SOMA chooses to send from her own curiosity (CuriosityMind): something
     * she read that Owner would care about, or wondering what he's up to. Separate
     * daily cap from operational reports so neither starves the other.
     */
    async curiosityMessage({ message, kind = 'curiosity_share', evidence = null, source = 'curiosity_mind', maxPerDay = 3 } = {}) {
        if (this.state.consent.curiosity === false) return this._suppress('curiosity_consent_disabled', message);
        const text = String(message || '').trim();
        if (!text) return this._suppress('empty_message', text);
        const now = this.now();
        const sentToday = (this.state.curiositySent || []).filter(at => at >= now - 24 * 60 * 60_000);
        if (sentToday.length >= maxPerDay) return this._suppress('curiosity_daily_limit', text);
        const hour = new Date(now).getHours();
        if (hour >= 23 || hour < 8) return this._suppress('quiet_hours', text);
        const verdict = this.gate.evaluate({ message: text, source, kind, verified: Boolean(evidence), evidence });
        if (!verdict.allowed) return this._suppress(verdict.receipt.reason, text);
        const broker = this.system?.messageBroker;
        if (!broker?.publish) return this._suppress('message_broker_unavailable', text);
        await broker.publish('soma_proactive', {
            message: verdict.text, source, kind, verified: Boolean(evidence), evidence, gateReceipt: verdict.receipt
        });
        // Command Bridge listens on the dashboard socket, not the broker.
        try { this.system?.broadcast?.('pulse', { type: 'soma_proactive', message: verdict.text, source, kind }); } catch { /* dashboard offline */ }
        this.state.curiositySent = [...sentToday, now];
        this.state.sent.push({ at: now, source, kind, message: verdict.text.slice(0, 500), receiptId: verdict.receipt.id });
        await this._persist();
        return { delivered: true, text: verdict.text, receipt: verdict.receipt };
    }

    getStatus() {
        this._prune();
        return {
            consent: { ...this.state.consent }, maxPerDay: this.maxPerDay, cooldownMs: this.cooldownMs,
            sentToday: this.state.sent.length, lastSentAt: this.state.sent.at(-1)?.at || null,
            curiositySentToday: (this.state.curiositySent || []).filter(at => at >= this.now() - 24 * 60 * 60_000).length,
            recentlySuppressed: this.state.suppressed.slice(-10)
        };
    }

    async _deliver({ message, evidence, source, kind, verified }) {
        const text = String(message || '').trim();
        this._prune();
        if (!text) return this._suppress('empty_message', text);
        const now = this.now();
        if (this.state.sent.length >= this.maxPerDay) return this._suppress('daily_limit', text);
        if (now - Number(this.state.sent.at(-1)?.at || 0) < this.cooldownMs) return this._suppress('cooldown', text);
        const hour = new Date(now).getHours();
        if (hour >= 23 || hour < 8) return this._suppress('quiet_hours', text);
        const verdict = this.gate.evaluate({ message: text, source, kind, verified, evidence });
        if (!verdict.allowed) return this._suppress(verdict.receipt.reason, text);
        const broker = this.system?.messageBroker;
        if (!broker?.publish) return this._suppress('message_broker_unavailable', text);
        await broker.publish('soma_proactive', {
            message: verdict.text, source, kind, verified, evidence, gateReceipt: verdict.receipt
        });
        this.state.sent.push({ at: now, source, kind, message: verdict.text.slice(0, 500), receiptId: verdict.receipt.id });
        await this._persist();
        return { delivered: true, receipt: verdict.receipt };
    }

    async _suppress(reason, message) {
        this.state.suppressed.push({ at: this.now(), reason, message: String(message || '').slice(0, 300) });
        this.state.suppressed = this.state.suppressed.slice(-200);
        await this._persist();
        return { delivered: false, reason };
    }

    _prune() {
        const cutoff = this.now() - 24 * 60 * 60_000;
        this.state.sent = (this.state.sent || []).filter(item => item.at >= cutoff);
    }

    async _persist() {
        this.state.updatedAt = this.now();
        await atomicJson(this.statePath, this.state);
    }
}

export default ProactivePresence;
