// Ephemeral PUBLIC exchanges only. Never a substitute for private memory.
export class TwitchConversation {
    constructor({ now = Date.now } = {}) {
        this.now = now;
        this.windowMs = 120000;
        this.maxFollowups = 3;
        this.sessions = new Map();
    }

    key(channel, viewerId) { return /^\d+$/.test(viewerId || '') ? `${channel}:${viewerId}` : null; }

    sweep() {
        for (const [key, session] of this.sessions) {
            if (session.expiresAt <= this.now()) this.sessions.delete(key);
        }
    }

    clearChannel(channel) {
        for (const [key] of this.sessions) if (key.startsWith(`${channel}:`)) this.sessions.delete(key);
    }

    match(text, { channel, viewerId, tenantId, botUsername, tags = {}, dryRun = false }) {
        this.sweep();
        const key = this.key(channel, viewerId);
        const session = !dryRun && key ? this.sessions.get(key) : null;
        const previous = session?.tenantId === tenantId ? session : null;
        const mention = new RegExp(`@${botUsername}(?![a-z0-9_])`, 'i');
        const address = new RegExp(`^(?:(?:hey|hi|hello|yo|okay|ok)[,\\s]+)?(?:soma|${botUsername})(?=$|[\\s,:!?])[,\\s:!?]*`, 'i');
        const command = /^!soma(?=\s|$)/i.test(text);
        const directed = command || mention.test(text) || address.test(text)
            || String(tags['reply-parent-user-login'] || '').toLowerCase() === botUsername;
        // Do not capture other bot commands, mentions or replies to other viewers.
        const elsewhere = /^[!/]/.test(text) || /@[a-z0-9_]+/i.test(text)
            || Boolean(tags['reply-parent-user-login']);
        const followup = !directed && !elsewhere && previous?.followupsLeft > 0;
        if (!directed && !followup) return null;
        const prompt = text.replace(/^!soma(?=\s|$)\s*/i, '').replace(mention, '').replace(address, '').trim();
        const closed = /^(?:bye|goodbye|stop(?:\s+(?:talking|chatting|responding))?|leave me alone|that's all)[.!\s]*$/i.test(prompt);
        if (closed && !dryRun && key) this.sessions.delete(key);
        return { key, directed, closed, prompt, tenantId, history: previous?.exchanges || [] };
    }

    delivered(turn, message, reply) {
        if (!turn?.key || turn.closed) return;
        this.sweep();
        const previous = this.sessions.get(turn.key);
        const same = previous?.tenantId === turn.tenantId ? previous : null;
        const exchanges = [...(same?.exchanges || []), { viewer: message, soma: reply }].slice(-3);
        // Drop exhausted sessions; fresh direct address opens another short window.
        const followupsLeft = turn.directed ? this.maxFollowups : Math.max(0, (same?.followupsLeft || 0) - 1);
        this.sessions.delete(turn.key);
        if (followupsLeft) this.sessions.set(turn.key, { tenantId: turn.tenantId, exchanges, followupsLeft, expiresAt: this.now() + this.windowMs });
        while (this.sessions.size > 500) this.sessions.delete(this.sessions.keys().next().value);
    }
}
