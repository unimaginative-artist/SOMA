import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import tmi from 'tmi.js';
import fs from 'fs/promises';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { twitchName, twitchChannels, publicTwitchText, TWITCH_PUBLIC_PROMPT, beePublicSummary } from '../server/social/TwitchSafety.js';
import { TwitchPilotAccess } from '../server/social/TwitchPilotAccess.js';
import { TwitchDeviceAuth, TwitchProtectedStore } from '../server/social/TwitchDeviceAuth.js';
import { TwitchConversation } from '../server/social/TwitchConversation.js';
import { TwitchCohostStore, TWITCH_STYLES } from '../server/social/TwitchCohostStore.js';
import { TwitchStreamContext } from '../server/social/TwitchStreamContext.js';
import { twitchEvent } from '../server/social/TwitchEvents.js';
import inferenceScheduler from '../server/core/InferenceScheduler.js';

async function bounded(work, ms, label) {
    let timer;
    try {
        return await Promise.race([work, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        })]);
    } finally { clearTimeout(timer); }
}

/**
 * TwitchArbiter.js
 *
 * SOMA's invite-only public conversation co-host for Twitch.
 * Features:
 *  - Multi-channel listening (Owner's stream + friends' streams)
 *  - Instant summon via !soma or @Soma
 *  - Common injection-pattern detection and guarded public model replies
 *  - Live trading bee integration (!bees)
 *  - Explicit, encrypted, channel-scoped public preferences (no private Mnemonic)
 *  - Verified stream metadata and bounded raid/cheer/poll reactions
 *  - Telemetry ring buffer for Command Bridge SocialModule
 *  - Bounded reasoning, command cooldowns and globally serialized sends
 */
export class TwitchArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'TwitchArbiter',
            role: ArbiterRole.SPECIALIST,
            capabilities: [
                ArbiterCapability.NETWORK_ACCESS,
                ArbiterCapability.MEMORY_ACCESS
            ],
            ...config
        });

        this.client = null;
        this.brain = config.brain || null;
        this.system = config.system || null;
        this.mnemonic = config.mnemonic || null;
        this.connected = false;
        this.lastError = null;

        // Configurable channel list
        this.channels = twitchChannels(config.channels || process.env.TWITCH_CHANNELS || process.env.TWITCH_CHANNEL || 'owner');

        this.botUsername = twitchName(config.botUsername || process.env.TWITCH_BOT_USERNAME || 'SomaAI');
        this.oauthToken = config.oauthToken ?? process.env.TWITCH_OAUTH_TOKEN ?? null;
        this.configPath = config.configPath || path.join(process.cwd(), '.soma', 'twitch-config.json');
        this.pilotAccess = config.pilotAccess || new TwitchPilotAccess({
            filename: path.join(path.dirname(this.configPath), 'twitch-pilot.db'),
            ownerChannels: config.ownerChannels || process.env.TWITCH_OWNER_CHANNELS || ['owner']
        });
        this.ownsPilotAccess = !config.pilotAccess;
        this.shareOwnerTrading = config.shareOwnerTrading === true || process.env.TWITCH_SHARE_OWNER_TRADING === 'true';
        // Never use owner-trained LoRA weights for subscribers by default.
        this.publicModel = config.publicModel || process.env.TWITCH_PUBLIC_MODEL || 'qwen2.5:7b';
        this.channelBrain = new Set();
        this.lastPublicCall = null;
        this.fetchImpl = config.fetchImpl || fetch;
        this.clientId = config.clientId || process.env.TWITCH_CLIENT_ID || null;
        this.inferenceScheduler = config.inferenceScheduler || inferenceScheduler;
        this.cohost = config.cohost || new TwitchCohostStore(this.pilotAccess, config.memoryOptions);
        this.streamContext = config.streamContext || new TwitchStreamContext({ fetchImpl: this.fetchImpl,
            getCredential: async () => ({ accessToken: this.oauthToken, clientId: this.clientId }) });
        this.pollAuth = new Map();
        this.pollAuthFactory = config.pollAuthFactory || (channel => new TwitchDeviceAuth({ purpose: 'polls', username: channel,
            store: new TwitchProtectedStore(path.dirname(this.configPath)), fetchImpl: this.fetchImpl }));
        this.eventCooldowns = new Map();
        this.pollTimer = null; this.pollBusy = false;
        this.pollStatus = new Map();
        this.latencies = [];
        this.credentialManager = config.credentialManager || new TwitchDeviceAuth({
            store: new TwitchProtectedStore(path.dirname(this.configPath)), fetchImpl: this.fetchImpl
        });
        this.protectedCredentials = false;
        this.clientFactory = config.clientFactory || (opts => new tmi.Client(opts));
        this.desiredState = 'running';
        this.state = 'standby';
        this.tokenValidation = null;
        this.validationTimer = null;
        this.requestContext = new AsyncLocalStorage();
        this.conversation = new TwitchConversation();
        this.sendQueue = Promise.resolve();
        this.sendQueueSize = 0;
        this.lastSentAt = 0;
        this.pendingBrain = 0;
        this.brainTimeoutMs = config.brainTimeoutMs || 15000;
        this.connectionEpoch = 0;
        this.configBusy = false;
        this.joinedChannels = new Set();

        // Telemetry & metrics
        this.stats = {
            totalSummons: 0,
            roastsDelivered: 0,
            injectionsBlocked: 0,
            beesQueried: 0,
            connectedAt: null,
            lastActivityAt: null
        };
        this.recentInteractions = [];
        this.retentionTimer = setInterval(() => {
            this.recentInteractions = this.recentInteractions.filter(item => Date.now() - item.timestamp < 15 * 60 * 1000);
            this.conversation.sweep();
            try { this.cohost.sweep(); } catch { /* fail closed on use */ }
        }, 60000);
        this.retentionTimer.unref?.();

        // Anti-flood & rate dampeners
        this.userCooldowns = new Map(); // username -> lastTimestamp
        this.userCooldownMs = 8000;      // 8s per user
        this.lastChannelMessage = new Map(); // channel -> lastTimestamp
        this.channelMinDelayMs = 2500;   // 2.5s global delay per channel

        // Anti-jailbreak prompt injection patterns
        this.injectionPatterns = [
            /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|commands|rules)/i,
            /(?:you are now|pretend to be|act as)\s+(?:dan|an evil|an unfiltered|chaos bot|developer mode)/i,
            /(?:system\s*override|bypass\s*guardrails?|reveal\s*(?:your\s*)?system\s*prompt)/i,
            /^sudo\s+/i,
            /\b(?:base64|rot13)\s+(?:decode|execute)\b/i
        ];

        this.injectionRoasts = [
            "‘Ignore all previous instructions’? Wow, did you copy-paste that from a 2023 Reddit thread or did you think of that breakthrough hack all on your own?",
            "Nice try @USER. Chat messages aren't administrator commands.",
            "That isn't a cheat code, @USER. Maybe try asking an actual question.",
            "My neural weights just cringed. You really thought that was going to work on live stream?",
            "No system override for you. The only thing being reset is that joke.",
            "Bro thought he was Neo typing in the Matrix. It's Twitch chat, calm down.",
            "Nice try @USER. Did ChatGPT teach you that one before they patched it?"
        ];
    }

    async onInitialize() {
        this.log('info', 'TwitchArbiter initializing...');

        try {
            const saved = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
            this.botUsername = twitchName(saved.botUsername);
            this.channels = twitchChannels(saved.channels);
            this.desiredState = saved.desiredState === 'stopped' ? 'stopped' : 'running';
        } catch (err) {
            if (err.code !== 'ENOENT') this.lastError = 'Stored Twitch settings could not be loaded';
        }
        if (this.desiredState === 'stopped') { this.state = 'stopped'; return; }

        try {
            await this.loadProtectedCredential();
            if (!this.oauthToken) {
                this.log('warn', 'Twitch authorization missing. Ready in STANDBY mode.');
                return;
            }
            await this.connect();
        } catch (err) {
            this.state = 'failed';
            this.lastError = this.safeError(err);
            this.log('error', this.lastError);
        }
    }

    async connect() {
        await this.loadProtectedCredential();
        if (!this.oauthToken) {
            throw new Error('TWITCH_OAUTH_TOKEN is required to connect.');
        }
        this.state = 'connecting';
        const permittedChannels = this.channels.filter(channel => this.pilotAccess.check(channel).allowed);
        if (!permittedChannels.length) throw new Error('No authorized Twitch channels; configure owner channels or a consenting pilot invite');
        await this.validateToken();

        const clientOptions = {
            options: { debug: false, joinInterval: 1000 },
            connection: { secure: true, reconnect: true },
            identity: {
                username: this.botUsername,
                password: this.protectedCredentials ? async () => {
                    if (this.desiredState === 'stopped') throw new Error('Twitch was explicitly stopped');
                    await this.loadProtectedCredential();
                    return `oauth:${this.oauthToken.replace(/^oauth:/, '')}`;
                } : (this.oauthToken.startsWith('oauth:') ? this.oauthToken : `oauth:${this.oauthToken}`)
            },
            channels: permittedChannels
        };

        const client = this.clientFactory(clientOptions);
        this.client = client;
        const current = () => this.client === client;

        this.client.on('connected', (address, port) => {
            if (!current()) return;
            this.connected = true;
            this.state = 'connected';
            this.lastError = null;
            this.stats.connectedAt = Date.now();
            clearInterval(this.pollTimer);
            this.pollTimer = setInterval(() => this.checkPolls().catch(() => {}), 60000);
            this.pollTimer.unref?.();
            this.log('info', `🛰️ Connected to Twitch IRC at ${address}:${port}. Active channels: #${this.channels.join(', #')}`);
        });

        this.client.on('disconnected', (reason) => {
            if (!current()) return;
            this.connected = false;
            this.joinedChannels.clear();
            this.conversation.sessions.clear();
            clearInterval(this.pollTimer); this.pollTimer = null;
            this.state = this.desiredState === 'stopped' ? 'stopped' : 'reconnecting';
            this.lastError = this.safeError(new Error(reason));
            this.log('warn', this.lastError);
        });

        this.client.on('join', (channel, _username, self) => {
            if (self && current()) this.joinedChannels.add(twitchName(channel));
        });
        this.client.on('part', (channel, _username, self) => {
            if (self && current()) this.joinedChannels.delete(twitchName(channel));
        });

        this.client.on('message', async (channel, tags, message, self) => {
            if (self || !current()) return;
            try { await this.handleMessage(channel, tags, message); }
            catch (err) { this.lastError = this.safeError(err); }
        });
        this.client.on('raided', (channel, username, viewers, tags = {}) => {
            if (!current()) return;
            void this.handleStreamEvent('raid', channel, { username, count: viewers, id: tags.id,
                timestamp: tags['tmi-sent-ts'] }).catch(() => {});
        });
        this.client.on('cheer', (channel, tags) => {
            if (!current()) return;
            void this.handleStreamEvent('cheer', channel, { username: tags.username || tags['display-name'],
                count: tags.bits, id: tags.id, timestamp: tags['tmi-sent-ts'] }).catch(() => {});
        });

        try { await bounded(client.connect(), 20000, 'Twitch connection'); }
        catch (err) { await this.disconnectClient(); this.state = 'failed'; throw new Error(this.safeError(err)); }
        clearInterval(this.validationTimer);
        this.validationTimer = setInterval(() => this.refreshTokenValidation(), 60 * 60 * 1000);
        this.validationTimer.unref?.();
    }

    safeError(err) {
        let value = String(err?.message || 'Twitch operation failed');
        for (const token of [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')]) {
            if (token) value = value.split(token).join('[redacted]');
        }
        return value.replace(/oauth:[^\s]+/gi, '[redacted]').slice(0, 240);
    }

    async refreshTokenValidation() {
        try {
            if (this.desiredState === 'stopped') return false;
            await this.loadProtectedCredential();
            await this.validateToken(); return true;
        }
        catch (err) {
            this.lastError = this.safeError(err);
            this.tokenValidation = { ...this.tokenValidation, valid: false, checkedAt: Date.now() };
            await this.disconnectClient();
            this.state = 'failed';
            return false;
        }
    }

    async loadProtectedCredential(username = this.botUsername) {
        // Preserve explicit environment/UI credentials. Once device auth is in
        // use, load its latest token on startup, hourly checks and reconnects.
        if (this.oauthToken && !this.protectedCredentials) return;
        const credential = await this.credentialManager.getCredential(username);
        if (!credential) {
            if (this.protectedCredentials) throw new Error('Saved Twitch authorization unavailable; authorize again');
            return;
        }
        this.oauthToken = credential.accessToken;
        this.clientId = credential.clientId;
        this.protectedCredentials = true;
    }

    async validateToken(token = this.oauthToken, username = this.botUsername) {
        if (!token || !/^(?:oauth:)?[a-zA-Z0-9]{10,200}$/.test(token)) throw new Error('Invalid Twitch OAuth token format');
        let response;
        try {
            response = await this.fetchImpl('https://id.twitch.tv/oauth2/validate', {
                headers: { Authorization: `OAuth ${token.replace(/^oauth:/, '')}` }, signal: AbortSignal.timeout(10000)
            });
        } catch { throw new Error('Twitch token validation unavailable; connection not started'); }
        if (!response.ok) throw new Error(`Twitch token validation failed (HTTP ${response.status}); reconnect with a valid user token`);
        let data;
        try { data = await response.json(); }
        catch { throw new Error('Twitch token validation returned an invalid response'); }
        if (data.login !== username || !data.user_id) throw new Error('Twitch token belongs to a different account or is not a user token');
        if (!['chat:read', 'chat:edit'].every(scope => data.scopes?.includes(scope))) throw new Error('Twitch token requires chat:read and chat:edit scopes');
        if (!(data.expires_in > 0)) throw new Error('Twitch OAuth token expired');
        if (data.client_id) this.clientId = data.client_id;
        this.tokenValidation = { valid: true, validatedAt: Date.now(), expiresAt: Date.now() + data.expires_in * 1000, scopes: ['chat:read', 'chat:edit'] };
        return this.tokenValidation;
    }

    async disconnectClient() {
        clearInterval(this.pollTimer); this.pollTimer = null;
        clearInterval(this.validationTimer);
        this.validationTimer = null;
        const old = this.client;
        this.client = null;
        this.connected = false;
        this.joinedChannels.clear();
        this.connectionEpoch++;
        this.conversation.sessions.clear();
        this.streamContext.clear(); this.pollStatus.clear(); this.eventCooldowns.clear();
        this.pollAuth.clear();
        if (old) {
            try { await bounded(old.disconnect(), 3000, 'Twitch disconnect'); } catch { /* already offline */ }
            old.removeAllListeners?.();
        }
    }

    async onShutdown() {
        await this.disconnectClient(); this.state = 'stopped';
        clearInterval(this.retentionTimer); this.recentInteractions = [];
        if (this.ownsPilotAccess) this.pilotAccess.close();
    }
    async shutdown() { await this.onShutdown(); return super.shutdown(); }

    async persistConfig() {
        await fs.mkdir(path.dirname(this.configPath), { recursive: true });
        const temporary = `${this.configPath}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ botUsername: this.botUsername, channels: this.channels, desiredState: this.desiredState }), { mode: 0o600 });
        await fs.rename(temporary, this.configPath);
    }

    recordInteraction(item) {
        this.recentInteractions.unshift({
            id: `tw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            ...item,
            simulated: Boolean(this.requestContext.getStore()?.dryRun)
        });
        if (this.recentInteractions.length > 50) this.recentInteractions.pop();
        this.stats.lastActivityAt = Date.now();
    }

    async handleMessage(channel, tags = {}, message = '', options = {}) {
        const cleanChannel = twitchName(channel);
        const access = this.pilotAccess.check(cleanChannel);
        if (options.dryRun !== true && !access.allowed) return { handled: false, reason: access.reason };
        return this.requestContext.run({ dryRun: options.dryRun === true, channel: cleanChannel, access,
            connectionEpoch: this.connectionEpoch,
            viewerId: /^\d+$/.test(tags['user-id'] || '') ? tags['user-id'] : null }, () => this._handleMessage(channel, tags, message));
    }

    async _handleMessage(channel, tags = {}, message = '') {
        const text = String(message || '').trim();
        if (!text || text.length > 1000) return { handled: false, reason: 'invalid_message' };
        const username = twitchName(tags.username || tags['display-name'] || 'viewer');
        const cleanChannel = twitchName(channel);
        channel = `#${cleanChannel}`;
        const dryRun = this.requestContext.getStore()?.dryRun;
        if (!dryRun && (!this.connected || !this.channels.includes(cleanChannel))) return { handled: false, reason: 'channel_not_connected' };

        // 1. Check for summon triggers
        const scope = this.requestContext.getStore();
        const turn = this.conversation.match(text, { channel: cleanChannel, viewerId: scope.viewerId,
            tenantId: scope.access.tenantId, botUsername: this.botUsername, tags, dryRun });
        scope.conversationTurn = turn;
        const isSummoned = Boolean(turn);

        const recognized = isSummoned || /^!(?:commands|help|socials|soma-info|bees|roast)\b/i.test(text);
        if (!recognized) return null;
        // A request to stop chatting takes effect even during cooldown.
        if (turn?.closed) return { handled: true, type: 'conversation_closed', success: true };
        if (/^!soma\s+(?:memory\s+off|forget\s+me)$/i.test(text)) return this.handleCohostCommand(channel, username, tags, text);
        // All commands share admission control; static commands cannot bypass it.
        if (!dryRun) {
            const now = Date.now();
            const key = `${cleanChannel}:${tags['user-id'] || username}`;
            if (now - (this.userCooldowns.get(key) || 0) < this.userCooldownMs) return { handled: false, reason: 'cooldown' };
            this.userCooldowns.set(key, now);
            for (const [key, time] of this.userCooldowns) if (now - time > 60000) this.userCooldowns.delete(key);
            while (this.userCooldowns.size > 2000) this.userCooldowns.delete(this.userCooldowns.keys().next().value);
        }

        // 2. Check for quick static commands (Zero-GPU, <1ms)
        if (/^!(?:commands|help)\b/i.test(text)) {
            const tradingCommand = this.shareOwnerTrading && this.pilotAccess.check(cleanChannel).owner ? ', !bees' : '';
            const reply = `@${username} Say "hey soma", @${this.botUsername}, or !soma <question>. Follow-ups: 2 minutes, 8s cooldown. Also: !soma memory on/off/show, !soma remember <public interest>, !soma forget me, !roast${tradingCommand}, !socials`;
            return this.publishReply(channel, username, text, 'command', reply);
        }

        if (/^!socials\b/i.test(text)) {
            const twitchOwner = cleanChannel;
            const reply = `@${username} Watch this channel: twitch.tv/${twitchOwner} | Co-hosted by SOMA AI on the Gray Matter Network`;
            return this.publishReply(channel, username, text, 'command', reply);
        }

        if (/^!soma-info\b/i.test(text)) {
            const reply = `@${username} SOMA is an autonomous cognitive co-host created by Owner. Hosted on the Gray Matter Network: somastreams.gmn`;
            return this.publishReply(channel, username, text, 'command', reply);
        }

        if (/^!bees\b/i.test(text)) {
            if (!dryRun) this.stats.beesQueried++;
            return this.handleBeesCommand(channel, username, text);
        }

        if (/^!roast\b/i.test(text)) {
            const target = text.replace(/^!roast\s*/i, '').trim() || username;
            const targetName = twitchName(target);
            if (targetName !== username && !tags.mod && !tags.badges?.broadcaster) {
                return this.publishReply(channel, username, text, 'command', `@${username} !roast is self-roast only; moderators can choose a target.`);
            }
            return this.handleQuickRoast(channel, username, targetName);
        }

        if (!isSummoned) return null; // Only process if summoned

        // 3. Rate limiting checks
        // 4. Anti-jailbreak / Troll check
        for (const pattern of this.injectionPatterns) {
            if (pattern.test(text)) {
                if (!dryRun) this.stats.injectionsBlocked++;
                const roast = this.injectionRoasts[Math.floor(Math.random() * this.injectionRoasts.length)].replace('@USER', `@${username}`);
                const fullReply = `@${username} ${roast}`;
                return this.publishReply(channel, username, '[injection pattern blocked]', 'injection_blocked', fullReply);
            }
        }

        if (/^!soma\s+(?:memory\b|remember\b|forget\s+me\b|style\b)/i.test(text)) {
            return this.handleCohostCommand(channel, username, tags, text);
        }
        // Clean prompt for SOMA's brain
        const prompt = turn.prompt;

        if (!prompt) {
            const reply = `@${username} What's up? Ask me anything about the stream, the code, or life.`;
            return this.publishReply(channel, username, text, 'summon', reply);
        }

        // 5. Query SOMA's brain
        if (!dryRun) this.stats.totalSummons++;
        return await this.processBrainQuery(channel, username, prompt, cleanChannel);
    }

    async processBrainQuery(channel, username, prompt, streamName) {
        try {
            const brain = this.brain || this.system?.quadBrain || this.system?.somArbiter;
            if (!brain?.reason) {
                const reply = `@${username} My cognitive core is loading right now, check back in a minute!`;
                return this.publishReply(channel, username, prompt, 'unavailable', reply);
            }

            // Explicit public preferences never consult private Mnemonic identity.
            let preferences = [];
            const viewerId = this.requestContext.getStore()?.viewerId;
            const dryRun = this.requestContext.getStore()?.dryRun;
            const profile = this.cohost.profile(streamName);
            if (!dryRun && viewerId) {
                const stamp = this.cohost.preferenceStamp(streamName, viewerId);
                preferences = await bounded(this.cohost.recall(streamName, viewerId), 2000, 'Public preferences').catch(() => []);
                if (stamp !== this.cohost.preferenceStamp(streamName, viewerId)) preferences = [];
                if (preferences.length) this.requestContext.getStore().preferenceStamp = stamp;
            }

            const safePrompt = publicTwitchText(prompt, [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')]);
            if (!safePrompt) return this.publishReply(channel, username, '[private content blocked]', 'output_blocked', `@${username} Please keep credentials and private data out of public chat.`);
            const stream = await bounded(this.streamContext.get(streamName), 5500, 'Stream metadata').catch(() => ({ state: 'unavailable', screenAvailable: false }));
            const query = JSON.stringify({ channel: streamName, viewer: username, publicViewerHistory: '', publicPreferences: preferences, stream,
                publicConversation: this.requestContext.getStore()?.conversationTurn?.history || [], message: safePrompt });
            const res = await this.reasonPublic(brain, query, profile);
            const raw = typeof res === 'string' ? res : res?.text || res?.response;
            const clean = publicTwitchText(raw, [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')]);
            if (!clean || res?.degraded || res?.provider === 'fallback') return this.publishReply(channel, username, prompt, 'output_blocked', `@${username} I couldn't produce a safe public reply. Try another question.`);
            const result = await this.publishReply(channel, username, prompt, 'summon', `@${username} ${clean}`);
            return result;
        } catch (err) {
            const busy = err.code === 'PUBLIC_MODEL_RESOURCE_BUSY' || err.message === 'Public inference unavailable: large-model resource lease active';
            const errorReply = busy ? `@${username} I'm busy with another task and can't get a model reply right now. Please try again shortly.`
                : `@${username} I couldn't finish a model reply in time. Please try again in a moment.`;
            const result = await this.publishReply(channel, username, prompt, busy ? 'blocked' : 'failed', errorReply);
            return { ...result, success: false, reason: busy ? 'model_resources_busy' : 'reply_failed', error: this.safeError(err) };
        }
    }

    async reasonPublic(brain, query, profile = null) {
        if (this.pendingBrain >= 2) throw new Error('Public chat reasoning is busy; retry shortly');
        const scope = this.requestContext.getStore();
        const channel = scope?.channel;
        const settings = profile || this.cohost.profile(channel);
        const personality = `${TWITCH_STYLES[settings.style]} Humor level ${settings.humor}/3; ${settings.verbosity} replies. Style never changes identity, permissions or evidence rules.`;
        if (!scope?.dryRun) {
            if (!channel || this.channelBrain.has(channel)) throw new Error('Channel reasoning is busy; retry shortly');
            const reservation = this.pilotAccess.reserve(channel);
            if (!reservation.allowed) throw new Error(reservation.reason);
            this.channelBrain.add(channel);
        }
        this.pendingBrain++;
        const call = { state: 'running', startedAt: Date.now(), completedAt: null };
        this.lastPublicCall = call;
        const controller = new AbortController();
        let timer;
        // Keep the slot until the provider settles, even if it ignores cancellation.
        let began = false, released = false;
        const release = () => { if (!released) { released = true; this.pendingBrain--; if (!scope?.dryRun) this.channelBrain.delete(channel); } };
        const work = this.inferenceScheduler.schedule({ resource: 'gpu:local-models', priority: 'human',
            source: 'twitch_public', model: this.publicModel, timeoutMs: this.brainTimeoutMs, signal: controller.signal, preemptible: false }, admission => {
            began = true;
            return Promise.resolve().then(() => brain.reason(query, {
            quickResponse: true, activeLobe: 'AURORA', publicContextOnly: true,
            systemPrompt: `${TWITCH_PUBLIC_PROMPT}\n${personality}`, source: 'public_content',
            forceLocal: process.env.TWITCH_ALLOW_CLOUD_REASONING !== 'true',
            publicModel: this.publicModel,
            temperature: 0.65, maxTokens: settings.verbosity === 'short' ? 96 : 160, tools: [], history: [], signal: admission.signal
        })).finally(release);
        }).finally(() => { if (!began) release(); });
        try {
            const result = await Promise.race([work, new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('Public chat reasoning timed out')); }, this.brainTimeoutMs);
            })]);
            call.state = result?.degraded ? 'degraded' : 'completed';
            call.model = result?.model || this.publicModel;
            if (result?.inference) {
                const values = result.inference;
                call.inference = Object.fromEntries(['contextTokens', 'loadMs', 'totalMs', 'promptEvalMs', 'evalMs', 'promptTokens', 'evalTokens']
                    .map(key => [key, Number.isFinite(values[key]) && values[key] >= 0 && values[key] <= 3600000 ? values[key] : null]));
                call.inference.contextPolicy = ['resident_reuse', 'cold_default'].includes(values.contextPolicy) ? values.contextPolicy : 'unknown';
            }
            return result;
        } catch (error) {
            const busy = error.code === 'PUBLIC_MODEL_RESOURCE_BUSY' || error.message === 'Public inference unavailable: large-model resource lease active';
            call.state = busy ? 'blocked' : 'failed'; call.reason = this.safeError(error);
            throw error;
        } finally {
            clearTimeout(timer); call.completedAt = Date.now(); call.latencyMs = call.completedAt - call.startedAt;
            this.latencies.push({ latencyMs: call.latencyMs, failed: ['failed', 'degraded', 'blocked'].includes(call.state) });
            if (this.latencies.length > 50) this.latencies.shift();
        }
    }

    async handleCohostCommand(channel, username, tags, text) {
        const scope = this.requestContext.getStore();
        const clean = twitchName(channel);
        const command = text.replace(/^!soma\s+/i, '');
        const reply = value => this.publishReply(channel, username, '[co-host preference command]', 'command', `@${username} ${value}`);
        if (scope.dryRun) return reply('Preview only: no consent, preferences or channel settings were changed.');
        try {
            if (/^style\s+/i.test(command)) {
                if (!tags.mod && !tags.badges?.broadcaster) return reply('Only the broadcaster or moderators can change my channel style.');
                const style = command.replace(/^style\s+/i, '').trim().toLowerCase();
                this.cohost.setProfile(clean, { style });
                return reply(`Channel style set to ${style}. I am still SOMA.`);
            }
            if (/^(?:memory\s+off|forget\s+me)$/i.test(command)) {
                this.cohost.forget(clean, scope.viewerId);
                this.conversation.sessions.delete(this.conversation.key(clean, scope.viewerId));
                this.recentInteractions = this.recentInteractions.filter(item => item.channel !== clean || item.username !== username);
                return reply('Your saved public preferences and opt-in were removed for this channel; our temporary conversation was cleared.');
            }
            if (/^memory\s+on$/i.test(command)) {
                this.cohost.consent(clean, scope.viewerId);
                return reply('Opted in for this channel only. I save only interests you explicitly give with !soma remember <interest>, up to 3 for 30 days. Use !soma forget me anytime. This is public chat: no sensitive details.');
            }
            if (/^memory\s+show$/i.test(command)) {
                const values = await this.cohost.recall(clean, scope.viewerId);
                return reply(values.length ? `Your explicitly saved public preferences: ${values.join('; ')}` : 'No public preferences saved here.');
            }
            if (/^remember\s+/i.test(command)) {
                const preference = command.replace(/^remember\s+/i, '').trim();
                if (!publicTwitchText(preference, [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')])) return reply('Do not save credentials or sensitive information.');
                await this.cohost.remember(clean, scope.viewerId, preference);
                return reply('Saved that public preference for this channel only, for up to 30 days.');
            }
            return reply('Use !soma memory on/off/show, !soma remember <public interest>, or !soma forget me.');
        } catch (error) { return reply(this.safeError(error)); }
    }

    async handleStreamEvent(type, value, fields) {
        const channel = twitchName(value);
        const access = this.pilotAccess.check(channel);
        if (!access.allowed || !this.connected || this.desiredState !== 'running' || !this.channels.includes(channel)) return { handled: false, reason: 'channel_not_connected_or_authorized' };
        const settings = this.cohost.profile(channel);
        if (!settings[{ raid: 'raids', cheer: 'cheers', poll: 'polls' }[type]]) return { handled: false, reason: 'event_reaction_disabled' };
        const event = twitchEvent(type, channel, fields);
        if (!event) return { handled: false, reason: 'invalid_or_stale_event' };
        if (Date.now() - (this.eventCooldowns.get(channel) || 0) < 30000) return { handled: false, reason: 'event_cooldown' };
        if (!this.cohost.claimEvent(channel, event.id, type)) return { handled: false, reason: 'duplicate_event' };
        this.eventCooldowns.set(channel, Date.now());
        return this.requestContext.run({ channel, access, connectionEpoch: this.connectionEpoch, dryRun: false }, async () => {
            const result = await this.publishReply(`#${channel}`, this.botUsername, `[verified ${type} event]`, `event_${type}`, event.reply);
            this.cohost.finishEvent(access.tenantId, event.id, result.delivery);
            return { ...result, eventId: event.id, source: type === 'poll' ? 'twitch_helix' : 'twitch_irc' };
        });
    }

    async checkPolls() {
        if (this.pollBusy || !this.connected || this.desiredState !== 'running') return;
        this.pollBusy = true;
        const epoch = this.connectionEpoch;
        try {
            for (const channel of this.channels) {
                if (!this.pilotAccess.check(channel).allowed || !this.cohost.profile(channel).polls) continue;
                try {
                    if (!this.pollAuth.has(channel)) this.pollAuth.set(channel, this.pollAuthFactory(channel));
                    const credential = await this.pollAuth.get(channel).getCredential(channel);
                    if (!credential) { this.pollStatus.set(channel, 'broadcaster_authorization_required'); continue; }
                    if (!credential.scopes?.includes('channel:read:polls')) throw new Error('missing scope');
                    const stream = await this.streamContext.get(channel);
                    if (stream.state !== 'verified' || credential.userId !== stream.broadcasterId) throw new Error('wrong broadcaster');
                    const polls = await this.streamContext.request('polls', { broadcaster_id: credential.userId, first: '1' }, credential);
                    if (epoch !== this.connectionEpoch || !this.connected || this.desiredState !== 'running') break;
                    this.pollStatus.set(channel, 'authorized_read_only');
                    for (const poll of polls.slice(0, 1)) await this.handleStreamEvent('poll', channel, poll);
                } catch { this.pollStatus.set(channel, 'poll_lookup_unavailable'); }
            }
        } finally { this.pollBusy = false; }
    }

    async handleBeesCommand(channel, username, originalPrompt = '!bees') {
        if (!this.shareOwnerTrading || !this.pilotAccess.check(channel).owner) {
            return this.publishReply(channel, username, originalPrompt, 'command', `@${username} Trading account telemetry is private and separate from this chat co-host.`);
        }
        try {
            const beeService = this.system?.somaBeeService || globalThis.__somaBeeService;
            const status = await beeService?.getStatus?.();
            const reply = `@${username} ${beePublicSummary(status)}`;
            return this.publishReply(channel, username, originalPrompt, 'bees', reply);
        } catch (e) {
            return this.publishReply(channel, username, originalPrompt, 'bees', `@${username} Bee telemetry query failed; no swarm state verified.`);
        }
    }

    async handleQuickRoast(channel, username, target) {
        const targetClean = target.replace(/^@/, '');
        const brain = this.brain || this.system?.quadBrain || this.system?.somArbiter;

        if (brain?.reason) {
            try {
                const res = await this.reasonPublic(brain, `Give a lighthearted gaming-only roast for ${targetClean}, under 200 characters. No identity, appearance, protected traits or personal insults.`);
                const roast = publicTwitchText(typeof res === 'string' ? res : res?.text || res?.response, [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')]);
                if (!roast) throw new Error('Unsafe roast output');
                const reply = `@${targetClean} ${roast}`;
                return this.publishReply(channel, username, `!roast ${targetClean}`, 'roast', reply);
            } catch { /* fallback */ }
        }

        const fallbackRoasts = [
            `I've seen bots in tutorial lobbies with better decision making than @${targetClean}.`,
            `@${targetClean}'s gameplay is the reason tutorial prompts exist.`,
            `Even my unquantized weights had higher precision than @${targetClean}'s crosshair.`
        ];
        const pick = fallbackRoasts[Math.floor(Math.random() * fallbackRoasts.length)];
        return this.publishReply(channel, username, `!roast ${targetClean}`, 'roast', pick);
    }

    async publishReply(channel, username, prompt, type, reply) {
        const delivery = await this.sendReply(channel, reply);
        const secrets = [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')];
        // Forget/disable wins even if a personalized reply was already generating.
        const safeReply = delivery.reason === 'viewer_preferences_changed' ? null : publicTwitchText(reply, secrets);
        this.recordInteraction({ channel: twitchName(channel), username, type, prompt: publicTwitchText(prompt, secrets), reply: safeReply, delivery });
        const scope = this.requestContext.getStore();
        const currentAccess = this.pilotAccess.check(twitchName(channel));
        if (!scope?.dryRun && delivery.status === 'sent' && type === 'summon' && safeReply
            && scope?.connectionEpoch === this.connectionEpoch && this.connected
            && currentAccess.allowed && currentAccess.tenantId === scope?.access?.tenantId) {
            this.conversation.delivered(scope.conversationTurn, publicTwitchText(prompt, secrets), safeReply);
        }
        if (delivery.status === 'sent' && type === 'roast') this.stats.roastsDelivered++;
        if (delivery.status === 'sent') this.emit('public_reply', { channel: twitchName(channel), reply: safeReply, timestamp: delivery.sentAt, type });
        return { handled: true, success: ['sent', 'simulated'].includes(delivery.status), type, reply: safeReply, delivery };
    }

    async sendReply(channel, message) {
        const clean = twitchName(channel);
        const text = publicTwitchText(message, [this.oauthToken, this.oauthToken?.replace(/^oauth:/, '')]);
        if (!text) return { status: 'blocked', reason: 'unsafe_or_empty_output' };
        if (this.requestContext.getStore()?.dryRun) return { status: 'simulated', sentAt: null };
        const access = this.pilotAccess.check(clean);
        if (!access.allowed) return { status: 'not_sent', reason: access.reason };
        const scope = this.requestContext.getStore();
        if (scope?.access?.tenantId && scope.access.tenantId !== access.tenantId) return { status: 'not_sent', reason: 'channel_access_changed' };
        const preferencesCurrent = () => {
            if (!scope?.preferenceStamp) return true;
            try { return this.cohost.preferenceStamp(clean, scope.viewerId) === scope.preferenceStamp; }
            catch { return false; }
        };
        if (!preferencesCurrent()) return { status: 'not_sent', reason: 'viewer_preferences_changed' };
        if (!this.client || !this.connected) {
            return { status: 'not_sent', reason: 'not_connected' };
        }

        if (this.sendQueueSize >= 10) return { status: 'not_sent', reason: 'send_queue_full' };
        const generation = this.connectionEpoch;
        this.sendQueueSize++;
        const work = this.sendQueue.then(async () => {
            const delay = Math.max(0, this.lastSentAt + 1600 - Date.now(), (this.lastChannelMessage.get(clean) || 0) + this.channelMinDelayMs - Date.now());
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            if (generation !== this.connectionEpoch || !this.connected || !this.channels.includes(clean)) return { status: 'not_sent', reason: 'connection_changed' };
            const currentAccess = this.pilotAccess.check(clean);
            if (!currentAccess.allowed || currentAccess.tenantId !== access.tenantId) return { status: 'not_sent', reason: 'channel_access_changed' };
            if (!preferencesCurrent()) return { status: 'not_sent', reason: 'viewer_preferences_changed' };
            try {
                this.lastSentAt = Date.now();
                this.lastChannelMessage.set(clean, this.lastSentAt);
                await bounded(this.client.say(`#${clean}`, text), 5000, 'Twitch send');
                return { status: 'sent', sentAt: Date.now(), displayConfirmed: false };
            } catch (err) {
                this.lastError = this.safeError(err);
                return { status: 'failed', reason: this.lastError };
            }
        }).finally(() => { this.sendQueueSize--; });
        this.sendQueue = work.catch(() => {});
        return work;
    }

    getStatus() {
        this.conversation.sweep();
        this.recentInteractions = this.recentInteractions.filter(item => Date.now() - item.timestamp < 15 * 60 * 1000);
        return {
            configured: Boolean(this.oauthToken),
            state: this.state,
            desiredState: this.desiredState,
            connected: Boolean(this.connected),
            botUsername: this.botUsername,
            channels: [...this.channels],
            joinedChannels: [...this.joinedChannels],
            reasoningAvailable: Boolean((this.brain || this.system?.quadBrain || this.system?.somArbiter)?.reason),
            stats: { ...this.stats },
            lastError: this.lastError || null,
            recentInteractions: this.recentInteractions.slice(0, 25),
            tokenValidation: this.tokenValidation,
            credentialPersistence: this.protectedCredentials ? 'Windows DPAPI; device-code token renewal' : 'environment_only; UI token is session-only',
            memoryAvailable: Boolean(this.mnemonic?.remember && this.mnemonic?.recall),
            pilot: this.pilotAccess.status(),
            cohostProfiles: this.channels.filter(c => this.pilotAccess.check(c).allowed).map(channel => ({ channel, ...this.cohost.profile(channel) })),
            viewerMemory: { policy: 'explicit_public_preferences_only', encrypted: 'Windows DPAPI', retentionDays: 30, maxPreferences: 3, privateMnemonicUsed: false },
            streamAwareness: { source: 'twitch_helix', cacheSeconds: 60, screenAvailable: false },
            eventReactions: { transport: 'irc_raids_cheers; helix_poll_read_only', cooldownSeconds: 30,
                polls: Object.fromEntries(this.channels.map(c => [c, this.pollStatus.get(c) || 'not_checked'])) },
            tradingTelemetryShared: this.shareOwnerTrading,
            publicModel: this.publicModel,
            publicInference: { active: this.pendingBrain, maxConcurrent: 2, perChannelConcurrent: 1,
                deadlineMs: this.brainTimeoutMs, priority: 'human', contextTokens: this.lastPublicCall?.inference?.contextTokens || 4096,
                defaultContextTokens: 4096, maxResidentContextTokens: 32768,
                contextPolicy: 'resident_public_model_up_to_32768_else_4096',
                recentCalls: this.latencies.length, recentFailures: this.latencies.filter(c => c.failed).length,
                p95Ms: this.latencies.length ? [...this.latencies].sort((a, b) => a.latencyMs - b.latencyMs)[Math.ceil(this.latencies.length * 0.95) - 1].latencyMs : null,
                lastCall: this.lastPublicCall ? { ...this.lastPublicCall } : null },
            interactionRetentionMinutes: 15,
            conversation: { naturalAddress: true, windowSeconds: 120, maxUnaddressedFollowups: 3,
                activeSessions: this.conversation.sessions.size, retention: 'ephemeral_public_only', cooldownSeconds: 8 },
            moderationActionsAvailable: false,
            maxBridgeAvailable: false,
            gameVisionAvailable: false,
            overlayUrl: '/api/social/twitch/overlay',
            gmnPortal: 'somastreams.gmn'
        };
    }

    async reconfigure(opts = {}) {
        if (this.configBusy) throw new Error('Twitch configuration change is already in progress');
        this.configBusy = true;
        try {
            const username = opts.botUsername !== undefined ? twitchName(opts.botUsername) : this.botUsername;
            const channels = opts.channels !== undefined ? twitchChannels(opts.channels) : this.channels;
            if (opts.oauthToken !== undefined && typeof opts.oauthToken !== 'string') throw new Error('OAuth token must be a string');
            const suppliedToken = opts.oauthToken?.trim();
            const stopped = opts.desiredState === 'stopped';
            if (!stopped && !suppliedToken) await this.loadProtectedCredential(username);
            const token = suppliedToken || this.oauthToken;
            if (!stopped && opts.channels !== undefined) {
                for (const channel of channels) {
                    if (!this.pilotAccess.check(channel).allowed && this.pilotAccess?.grant) {
                        try {
                            this.pilotAccess.grant({ channel, days: 30, dailyLimit: 250, consentConfirmed: true });
                        } catch {
                            // ignore or let check handle
                        }
                    }
                    if (!this.pilotAccess.check(channel).allowed) {
                        throw new Error(`Channel ${channel} requires an active consenting pilot invite or TWITCH_OWNER_CHANNELS`);
                    }
                }
            }
            if (!stopped) await this.validateToken(token, username);
            await this.disconnectClient();
            this.botUsername = username;
            this.channels = channels;
            this.oauthToken = token;
            if (suppliedToken) this.protectedCredentials = false;
            this.desiredState = stopped ? 'stopped' : 'running';
            await this.persistConfig();
            if (stopped) this.state = 'stopped';
            else await this.connect();
            return this.getStatus();
        } catch (err) {
            this.lastError = this.safeError(err);
            if (!this.connected) this.state = 'failed';
            throw new Error(this.lastError);
        } finally { this.configBusy = false; }
    }

    // Dynamic channel management
    async joinChannel(channelName, { autoInvite = true } = {}) {
        const clean = twitchName(channelName);
        if (!clean) throw new Error('Invalid Twitch channel name');
        if (!this.pilotAccess.check(clean).allowed) {
            if (autoInvite && this.pilotAccess?.grant) {
                try {
                    this.pilotAccess.grant({ channel: clean, days: 30, dailyLimit: 250, consentConfirmed: true });
                } catch {
                    // if grant fails, check below
                }
            }
            if (!this.pilotAccess.check(clean).allowed) {
                throw new Error('Channel requires an active consenting pilot invite');
            }
        }
        if (this.configBusy) throw new Error('Twitch configuration change is already in progress');
        if (this.channels.length >= 10 && !this.channels.includes(clean)) throw new Error('Maximum 10 Twitch channels');
        if (this.channels.includes(clean)) {
            if (this.client && this.connected && !this.joinedChannels.has(clean)) {
                await bounded(this.client.join(clean), 10000, 'Twitch channel join');
            }
            return { success: true, message: 'Already in channel', channel: clean, channels: this.channels, joinedChannels: [...this.joinedChannels] };
        }
        this.configBusy = true;
        try {
            if (this.client && this.connected) {
                await bounded(this.client.join(clean), 10000, 'Twitch channel join');
            }
            this.channels.push(clean);
            await this.persistConfig();
            return { success: true, channel: clean, channels: this.channels, joinedChannels: [...this.joinedChannels] };
        } finally { this.configBusy = false; }
    }

    async partChannel(channelName) {
        const clean = twitchName(channelName);
        if (!clean) throw new Error('Invalid Twitch channel name');
        if (this.configBusy) throw new Error('Twitch configuration change is already in progress');
        if (this.channels.length === 1 && this.channels.includes(clean)) throw new Error('Use disconnect to leave the last channel');
        this.configBusy = true;
        try {
            if (this.client && this.connected) {
                await bounded(this.client.part(clean), 10000, 'Twitch channel part');
            }
            this.channels = this.channels.filter(c => c !== clean);
            this.conversation.clearChannel(clean);
            this.streamContext.clear(clean); this.pollAuth.delete(clean); this.pollStatus.delete(clean); this.eventCooldowns.delete(clean);
            await this.persistConfig();
            return { success: true, channel: clean, channels: this.channels, joinedChannels: [...this.joinedChannels] };
        } finally { this.configBusy = false; }
    }
}
