import { twitchName, publicTwitchText } from './TwitchSafety.js';

// Fixed, read-only Helix endpoints. No model-controlled URLs or token output.
export class TwitchStreamContext {
    constructor({ getCredential, fetchImpl = fetch, now = Date.now } = {}) {
        this.getCredential = getCredential; this.fetchImpl = fetchImpl; this.now = now;
        this.cache = new Map(); this.pending = new Map();
    }
    async request(endpoint, params, credential) {
        if (!['users', 'channels', 'streams', 'polls'].includes(endpoint)) throw new Error('Unknown Twitch metadata endpoint');
        if (!credential?.clientId || !credential?.accessToken) throw new Error('Twitch API credential unavailable');
        try {
            const response = await this.fetchImpl(`https://api.twitch.tv/helix/${endpoint}?${new URLSearchParams(params)}`, {
                headers: { 'Client-Id': credential.clientId, Authorization: `Bearer ${credential.accessToken.replace(/^oauth:/, '')}` },
                signal: AbortSignal.timeout(2500), redirect: 'error'
            });
            if (!response.ok) throw new Error('unavailable');
            const data = await response.json();
            if (!Array.isArray(data.data)) throw new Error('invalid');
            return data.data;
        } catch { throw new Error('Twitch metadata unavailable'); }
    }
    async get(value) {
        const channel = twitchName(value);
        const cached = this.cache.get(channel);
        if (cached && this.now() - cached.at < 60000) return cached.value;
        if (this.pending.has(channel)) return this.pending.get(channel);
        const work = this.load(channel).then(value => {
            this.cache.set(channel, { at: this.now(), value });
            while (this.cache.size > 10) this.cache.delete(this.cache.keys().next().value);
            return value;
        }).finally(() => this.pending.delete(channel));
        this.pending.set(channel, work); return work;
    }
    async load(channel) {
        try {
            const credential = await this.getCredential();
            const users = await this.request('users', { login: channel }, credential);
            const user = users.find(u => u.login === channel && /^\d+$/.test(u.id));
            if (!user) throw new Error('invalid');
            const [channels, streams] = await Promise.all([
                this.request('channels', { broadcaster_id: user.id }, credential),
                this.request('streams', { user_id: user.id }, credential)
            ]);
            const info = channels.find(c => c.broadcaster_id === user.id);
            if (!info || typeof info.title !== 'string' || typeof info.game_name !== 'string'
                || streams.some(s => s.user_id !== user.id)) throw new Error('invalid');
            return { state: 'verified', source: 'twitch_helix', channel, broadcasterId: user.id,
                title: publicTwitchText(info.title).slice(0, 140), category: publicTwitchText(info.game_name).slice(0, 80),
                live: streams.some(s => s.type === 'live'), asOf: new Date(this.now()).toISOString(), screenAvailable: false };
        } catch { return { state: 'unavailable', source: 'twitch_helix', channel, asOf: null, screenAvailable: false }; }
    }
    clear(channel) { if (channel) this.cache.delete(channel); else this.cache.clear(); }
}
