import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const clean = (value, max = 1600) => String(value || '').trim().slice(0, max);
const keywords = text => new Set(clean(text, 6000).toLowerCase().match(/[a-z]{4,}/g) || []);
export function continuityKind(text) {
    if (/\b(?:actually|i meant|not what i|correction|instead|no[, ]+i|not a vulnerability)\b/i.test(text)) return 'correction';
    if (/\b(?:i prefer|i want|i like|i love|i miss|please (?:don.t|stop)|we.re partners)\b/i.test(text)) return 'preference';
    if (/\b(?:we decided|let.s (?:do|use|keep)|we.ll use|i agree|go with)\b/i.test(text)) return 'decision';
    if (/\?|\b(?:yet to figure|don.t know how|haven.t decided)\b/i.test(text)) return 'open_question';
    return 'topic';
}

export function continuityScope(actor) {
    if (!actor?.id) return null;
    if (actor.private !== true && !actor.audience) return null;
    return createHash('sha256').update(JSON.stringify([actor.id, actor.private === true ? 'private' : actor.audience])).digest('hex');
}

/** Small quotation-based continuity, alongside Mnemonic/WorkingMemory, not a replacement.
 * Only human statements become landmarks. Neither summaries nor model guesses become facts.
 */
export class ConversationContinuity {
    constructor({ filePath = 'SOMA/conversation-continuity.json', clock = Date.now } = {}) {
        this.filePath = filePath ? path.resolve(filePath) : null;
        this.clock = clock;
        this.profiles = {};
        this.loaded = null;
        this.writeChain = Promise.resolve();
        this.lastError = null;
        this.readOnly = false;
    }
    async load() {
        this.loaded ||= (async () => {
            if (!this.filePath) return;
            try {
                const saved = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
                if (saved.version !== 1 || !saved.profiles || typeof saved.profiles !== 'object' || Array.isArray(saved.profiles)) throw new Error('Invalid continuity store');
                for (const [key, value] of Object.entries(saved.profiles).slice(-128)) {
                    if (!/^[a-f0-9]{64}$/.test(key) || !Array.isArray(value?.turns) || !Array.isArray(value?.landmarks)) continue;
                    const valid = item => item && typeof item.text === 'string' && Number.isFinite(item.at) && Math.abs(item.at) < 8.64e15;
                    this.profiles[key] = { updatedAt: Number(value.updatedAt) || 0,
                        turns: value.turns.filter(valid).slice(-32).map(item => ({ text: clean(item.text), reply: clean(item.reply, 1000), channel: clean(item.channel, 40), at: item.at })),
                        landmarks: value.landmarks.filter(item => valid(item) && ['correction', 'preference', 'decision', 'open_question'].includes(item.kind))
                            .slice(-24).map(item => ({ text: clean(item.text), kind: item.kind, at: item.at })) };
                }
            } catch (error) {
                if (error.code !== 'ENOENT') { this.lastError = 'continuity_read_failed'; this.readOnly = true; }
            }
        })();
        await this.loaded;
    }
    async recall(actor, query) {
        await this.load();
        const record = this.profiles[continuityScope(actor)];
        if (!record) return { turns: [], landmarks: [] };
        const terms = keywords(query);
        // Explicit corrections/preferences survive the rolling message window. Dates preserve updates.
        const landmarks = record.landmarks.filter(item => item.kind !== 'open_question' || this.clock() - item.at < 7 * 86400000)
            .map((item, i) => ({ item, score: [...keywords(item.text)].filter(t => terms.has(t)).length + (item.kind === 'correction' ? 4 : 0) + i / 100 }))
            .sort((a, b) => b.score - a.score).slice(0, 6).map(x => x.item).sort((a, b) => a.at - b.at);
        return { turns: record.turns.slice(-6), landmarks };
    }
    async record({ actor, channel, message, reply, accepted = false }) {
        await this.load();
        const scope = continuityScope(actor);
        if (!scope || !clean(message)) return;
        const now = this.clock();
        const record = this.profiles[scope] ||= { turns: [], landmarks: [], updatedAt: now };
        const userText = clean(message);
        const kind = continuityKind(userText);
        record.turns.push({ text: userText, reply: accepted ? clean(reply, 1000) : '', channel: clean(channel, 40), at: now });
        record.turns = record.turns.slice(-32);
        if (kind !== 'topic') {
            record.landmarks = record.landmarks.filter(item => item.text !== userText);
            record.landmarks.push({ text: userText, kind, at: now });
            record.landmarks = record.landmarks.slice(-24);
        }
        record.updatedAt = now;
        const keys = Object.keys(this.profiles).sort((a, b) => this.profiles[a].updatedAt - this.profiles[b].updatedAt);
        for (const key of keys.slice(0, Math.max(0, keys.length - 128))) delete this.profiles[key];
        if (!this.filePath || this.readOnly) return;
        const snapshot = JSON.stringify({ version: 1, profiles: this.profiles });
        this.writeChain = this.writeChain.catch(() => {}).then(async () => {
            const temp = `${this.filePath}.${randomUUID()}.tmp`;
            try {
                await fs.mkdir(path.dirname(this.filePath), { recursive: true });
                await fs.writeFile(temp, snapshot, { mode: 0o600 });
                await fs.rename(temp, this.filePath);
                this.lastError = null;
            } catch { this.lastError = 'continuity_write_failed'; }
        });
        await this.writeChain;
    }
    status() { return { persistent: Boolean(this.filePath), profileCount: Object.keys(this.profiles).length, lastError: this.lastError, readOnly: this.readOnly }; }
}
