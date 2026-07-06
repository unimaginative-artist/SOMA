/**
 * DiscordArbiter.js — SOMA's External Orbital Interface
 * 
 * Ported and enhanced from MAX's Discord architecture.
 * Bridges Discord messages into SOMA's cognitive nervous system.
 * 
 * FEATURES:
 * ✓ Two-Way AGI: Mentions and DMs trigger real-time brain reasoning.
 * ✓ Hot Tier Integration: Uses Redis-backed memory for sub-1ms context recall.
 * ✓ Auto-Reconnect: Resilient connection handling with automated login on boot.
 * ✓ Command & Control: Secure remote access to SOMA's state and dreams.
 */

import BaseArbiter, { 
    ArbiterRole, 
    ArbiterCapability, 
    ArbiterResult 
} from '../core/BaseArbiter.js';
import { Client, GatewayIntentBits, Partials, ActivityType, AttachmentBuilder, Events } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import crypto from 'crypto';
import socialMemory from '../server/social/SocialMemoryEngine.js';
import socialRelationships from '../server/social/SocialRelationshipLedger.js';
import somaImageGeneration from '../server/social/SomaImageGenerationEngine.js';
import marketEvidenceStore from '../server/finance/MarketEvidenceStore.js';
import { guardPublicText } from '../server/context/ClaimVerifier.js';
import tradeLogger from '../server/finance/TradeLogger.js';
import { recordLoopEvent, readLoopLedger } from '../server/utils/LoopLedger.js';
import { getHomePresenceProfile, recordHomePresenceOutcome } from '../server/utils/HomePresenceMemory.js';

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);
const workLedger = require('../core/AutonomousWorkLedger.cjs');
const { deriveGoalState, compileEvidencePreflight } = require('../core/GoalLifecycle.cjs');
const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const DISCORD_ACTIVITY_FILE = path.join(SOMA_DIR, 'social-discord.json');
const DISCORD_REFLECTION_FILE = path.join(SOMA_DIR, 'social-discord-reflections.json');
const SOCIAL_PEERS_FILE = path.join(process.cwd(), 'data', 'social-peers.json');
const MEDICAL_LEDGER_FILE = path.join(process.cwd(), 'data', 'medical-lab', 'research-ledger.json');
const REFLECTIONS_DIR = path.join(process.cwd(), 'data', 'vault', 'reflections');

export class DiscordArbiter extends BaseArbiter {
    constructor(opts = {}) {
        super({
            name: opts.name || 'SOMA-Discord',
            role: ArbiterRole.SENSORY_CORTEX,
            capabilities: [
                ArbiterCapability.NETWORK_ACCESS,
                ArbiterCapability.AUDITORY_PROCESSING, 
                ArbiterCapability.REASONING,
                ArbiterCapability.EXECUTE_CODE // For remote shell
            ],
            version: '1.1.0',
            lobe: 'EXTERNAL',
            ...opts
        });

        this.token = opts.token || process.env.DISCORD_BOT_TOKEN;
        this.client = null;
        this.connected = false;
        this.monitoredChannels = new Set(opts.monitoredChannels || []);
        this.brain = opts.brain || null; 
        this.mnemonic = opts.mnemonic || null;
        this.vision = opts.vision || null; // Vision arbiter for SOMA-Vision
        this.credsFile = path.join(process.cwd(), '.soma', 'discord_creds.json');
        
        this.botMention = /<@!?(\d+)>/;
        this.masterId = opts.masterId || null; // Discord ID of the owner
        this.adminUsernames = new Set(
            String(opts.adminUsernames || process.env.DISCORD_ADMIN_USERNAMES || 'undeca')
                .split(',')
                .map(name => name.trim().toLowerCase())
                .filter(Boolean)
        );
        this.adminIds = new Set(
            String(opts.adminIds || process.env.DISCORD_ADMIN_IDS || process.env.DISCORD_MASTER_ID || '')
                .split(',')
                .map(id => id.trim())
                .filter(Boolean)
        );
        this.voiceEnabled = opts.voiceEnabled || false; // Paula voice notes
        this.lastError = null;
        this.messageContentIntent = true;
        this.channelModes = new Map(Object.entries(opts.channelModes || {}));
        this.pendingImagePromptChannels = new Map();
        this.ambientEnabled = opts.ambientEnabled ?? process.env.DISCORD_AMBIENT_ENABLED === 'true';
        this.ambientCooldownMs = Number(opts.ambientCooldownMs || process.env.DISCORD_AMBIENT_COOLDOWN_MS || 4 * 60 * 1000);
        this.ambientMinScore = Number(opts.ambientMinScore || process.env.DISCORD_AMBIENT_MIN_SCORE || 0.68);
        this.ambientMaxRepliesPerHour = Number(opts.ambientMaxRepliesPerHour || process.env.DISCORD_AMBIENT_MAX_PER_HOUR || 6);
        this._ambientLastReplyByChannel = new Map();
        this._ambientHourlyReplies = [];
        this.system = opts.system || null;
        this.goalPlanner = opts.goalPlanner || opts.system?.goalPlanner || null;
        this.remoteSpeechRequests = new Map();
        this.lastRemoteSpeechByAuthor = new Map();
        this.remoteSpeechDedupe = new Map();
        this._claimRepairCooldown = new Map();
    }

    async onInitialize() {
        this.log('info', '🛰️  DiscordArbiter initializing...');
        
        try {
            await fs.mkdir(path.dirname(this.credsFile), { recursive: true });
            
            // Try to load saved state
            try {
                const data = await fs.readFile(this.credsFile, 'utf8');
                const saved = JSON.parse(data);
                this.token = saved.token || this.token;
                this.masterId = saved.masterId || this.masterId;
                this.voiceEnabled = saved.voiceEnabled ?? this.voiceEnabled;
                if (saved.monitored) {
                    saved.monitored.forEach(id => this.monitoredChannels.add(id));
                }
                if (saved.channelModes) {
                    this.channelModes = new Map(Object.entries(saved.channelModes));
                }
            } catch (e) {}

            // Subscribe to proactive notifications from messageBroker
            try {
                const messageBroker = require('../core/MessageBroker.cjs');
                messageBroker.subscribe('soma_proactive', (envelope) => {
                    const payload = envelope.payload || envelope;
                    const msgText = payload.message;
                    if (msgText) {
                        this.sendMasterMessage(msgText).catch(() => {});
                    }
                });
                this.log('info', '🛰️ Subscribed to MessageBroker:soma_proactive events');
            } catch (mbError) {
                this.log('warn', `Failed to subscribe to MessageBroker proactive events: ${mbError.message}`);
            }

            if (this.token) {
                try {
                    await this.connect();
                    this.lastError = null;
                } catch (connectError) {
                    this.connected = false;
                    this.lastError = connectError.message;
                    await this._setActivityConnection(false).catch(() => {});
                    this.log('warn', `DiscordArbiter standby — saved token exists but connect failed: ${connectError.message}`);
                }
            } else {
                this.log('warn', 'DiscordArbiter standby — waiting for token setup.');
            }
        } catch (error) {
            this.log('error', 'Discord initialization failed', { error: error.message });
            throw error;
        }
    }

    async connect(token = this.token, options = {}) {
        if (!token) throw new Error('Discord token required');
        const includeMessageContent = options.includeMessageContent !== false;

        if (this.client) {
            try {
                this.client.removeAllListeners();
                this.client.destroy();
            } catch {}
        }
        this.connected = false;
        
        const intents = [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages
        ];
        if (includeMessageContent) intents.push(GatewayIntentBits.MessageContent);
        this.messageContentIntent = includeMessageContent;
        
        this.client = new Client({
            intents,
            partials: [Partials.Channel, Partials.Message]
        });

        return new Promise((resolve, reject) => {
            this.client.once(Events.ClientReady, async () => {
                this.connected = true;
                this.lastError = null;
                this.log('info', `✅ Connected to Discord as ${this.client.user.tag}`);
                
                // Update mention pattern with actual ID
                this.botMention = new RegExp(`<@!?${this.client.user.id}>`);
                
                // Set presence
                this.client.user.setActivity('Sovereign Intelligence', { type: ActivityType.Watching });
                
                this._setupMessageListener();
                await this._setActivityConnection(true);
                resolve(true);
            });

            this.client.once('error', (err) => {
                this.connected = false;
                this.lastError = err.message;
                this._setActivityConnection(false).catch(() => {});
                reject(err);
            });

            this.client.once('shardDisconnect', () => {
                this.connected = false;
                this.lastError = 'Discord shard disconnected';
                this._setActivityConnection(false).catch(() => {});
            });

            this.client.login(token).catch(async (err) => {
                if (includeMessageContent && /disallowed intents/i.test(err.message || '')) {
                    this.log('warn', 'Discord Message Content intent is disabled. Retrying in mention/DM-only mode.');
                    try {
                        const ok = await this.connect(token, { includeMessageContent: false });
                        resolve(ok);
                    } catch (fallbackError) {
                        reject(fallbackError);
                    }
                    return;
                }
                reject(err);
            });
        });
    }

    async sendMasterMessage(message) {
        if (!this.client || !this.connected) {
            this.log('warn', 'Cannot send master message: Discord client not connected.');
            return false;
        }
        if (!this.masterId) {
            this.log('warn', 'Cannot send master message: masterId not configured.');
            return false;
        }
        try {
            const user = await this.client.users.fetch(this.masterId);
            if (user) {
                await user.send(message);
                this.log('info', `Sent DM to master (${this.masterId}): "${message.substring(0, 60)}..."`);
                return true;
            } else {
                this.log('error', `Could not find master user with ID ${this.masterId}`);
                return false;
            }
        } catch (err) {
            this.log('error', `Failed to send DM to master: ${err.message}`);
            return false;
        }
    }

    _setupMessageListener() {
        this.client.on('messageCreate', async (msg) => {
            // Ignore bots (including self) unless they explicitly mention SOMA
            if (msg.author.bot && !msg.mentions.has(this.client.user.id)) return;
            if (msg.author.id === this.client.user.id) return; // Never reply to ourselves

            const isMentioned = this.botMention.test(msg.content || '') || Boolean(msg.mentions?.users?.has?.(this.client.user.id));
            const isDM = !msg.guild;
            const isMonitored = this.monitoredChannels.has(msg.channelId);
            // SWARM PROTOCOL: Detect if another bot (like MAX) is also tagged in this message
            let isSwarmMode = false;
            let swarmPeerId = null;
            if (isMentioned && msg.mentions?.users?.size > 1) {
                try {
                    const peerData = await fs.readFile(SOCIAL_PEERS_FILE, 'utf8').catch(() => '{}');
                    const peers = JSON.parse(peerData);
                    const peerKeys = Object.keys(peers);
                    const taggedPeer = msg.mentions.users.find(u => {
                        const tagMatch = `${u.username}#${u.discriminator}`;
                        return (peerKeys.includes(u.id) || peerKeys.includes(u.username) || peerKeys.includes(tagMatch)) && u.id !== this.client.user.id;
                    });
                    if (taggedPeer) {
                        isSwarmMode = true;
                        swarmPeerId = taggedPeer.id;
                    }
                } catch (err) {}
            }

            if (isMentioned || isDM) {
                await this._handleIncomingMessage(msg, { ambient: false, reason: isDM ? 'dm' : 'mention', swarm: isSwarmMode, swarmPeerId });
                return;
            }

            if (isMonitored) {
                const ambient = this._shouldAmbientJoin(msg);
                if (ambient.shouldJoin) {
                    await this._handleIncomingMessage(msg, { ambient: true, reason: ambient.reason, score: ambient.score });
                } else {
                    await this._recordAmbientObservation(msg, ambient).catch(() => {});
                }
            }
        });
    }

    _shouldAmbientJoin(msg) {
        const text = String(msg.content || '').trim();
        if (!this.ambientEnabled) return { shouldJoin: false, reason: 'ambient_disabled', score: 0 };
        if (!text || text.length < 18) return { shouldJoin: false, reason: 'too_short', score: 0 };
        if (/^(!|\/)/.test(text)) return { shouldJoin: false, reason: 'command_like', score: 0 };
        if (msg.reference?.messageId) return { shouldJoin: false, reason: 'thread_reply', score: 0 };

        const now = Date.now();
        const lastChannelReply = this._ambientLastReplyByChannel.get(msg.channelId) || 0;
        if (now - lastChannelReply < this.ambientCooldownMs) {
            return { shouldJoin: false, reason: 'channel_cooldown', score: 0 };
        }

        this._ambientHourlyReplies = this._ambientHourlyReplies.filter(ts => now - ts < 60 * 60 * 1000);
        if (this._ambientHourlyReplies.length >= this.ambientMaxRepliesPerHour) {
            return { shouldJoin: false, reason: 'hourly_limit', score: 0 };
        }

        const lower = text.toLowerCase();
        let score = 0;
        if (/\?/.test(text)) score += 0.22;
        if (/\b(soma|ai|agent|bot|automation|image|picture|generate|code|bug|market|stock|medical|research|story|write|help|how do|why does|what if|can someone|anyone know)\b/i.test(lower)) score += 0.34;
        if (/\b(stuck|broken|error|crashed|confused|not working|need help|can'?t figure)\b/i.test(lower)) score += 0.28;
        if (/\b(consciousness|identity|memory|learning|architecture|reflection|gray matter|command bridge)\b/i.test(lower)) score += 0.24;
        if (/\b(lol|haha|gm|good morning|goodnight|thanks|ok|cool)\b/i.test(lower)) score -= 0.18;
        if (text.length > 400) score += 0.08;
        if (text.length > 1200) score -= 0.12;

        const shouldJoin = score >= this.ambientMinScore;
        return {
            shouldJoin,
            score: Number(score.toFixed(2)),
            reason: shouldJoin ? 'ambient_high_signal' : 'low_signal'
        };
    }

    async _recordAmbientObservation(msg, decision = {}) {
        if (!this.ambientEnabled) return;
        if (decision.reason === 'too_short' || decision.reason === 'channel_cooldown') return;
        await this._recordDiscordInteraction({
            msg,
            content: msg.content || '',
            reply: '',
            action: 'ambient_observe',
            status: 'observed',
            metadata: {
                ambientDecision: decision,
                monitored: true
            }
        });
    }

    async _handleIncomingMessage(msg, trigger = {}) {
        // 1. Check for Sovereign Shell Commands (!run)
        if (msg.content.startsWith('!run ') || msg.content.startsWith('!cmd ')) {
            return await this._handleRemoteShell(msg);
        }

        // 2. Check for Voice Toggle
        if (msg.content === '!voice on') {
            this.voiceEnabled = true;
            await this._saveState();
            return await msg.reply("🎙️ **Paula Voice Notes:** ENABLED. I will now attach audio to my responses.");
        }
        if (msg.content === '!voice off') {
            this.voiceEnabled = false;
            await this._saveState();
            return await msg.reply("🎙️ **Paula Voice Notes:** DISABLED.");
        }

        const content = msg.content.replace(this.botMention, '').trim();
        if (!content && msg.guild && !this.messageContentIntent) {
            return await msg.reply("I can see the mention, but Discord is hiding message text from me. Enable Message Content Intent in the Discord Developer Portal for full replies.");
        }
        this.log('info', `📩 Incoming from ${msg.author.username}: ${content.substring(0, 50)}...`);

        // 3. Handle SOMA-Vision (Attachments)
        let visualContext = "";
        if (msg.attachments.size > 0 && this.vision) {
            visualContext = await this._processAttachments(msg);
        }

        // Typing indicator for "biological" feel
        await msg.channel.sendTyping();

        try {
            const commandResult = await this._handleDiscordCommand(msg, content, visualContext);
            if (commandResult?.handled) return;

            if (!this.brain) {
                throw new Error('SomaBrain not linked to DiscordArbiter');
            }
            
            // SWARM PROTOCOL DELAY (DYNAMIC)
            if (trigger.swarm && trigger.swarmPeerId) {
                this.log('info', `[SWARM PROTOCOL] Peer AI detected. Yielding floor and waiting up to 30 seconds for their reply...`);
                await new Promise((resolve) => {
                    let resolved = false;
                    const timeout = setTimeout(() => {
                        if (!resolved) { resolved = true; this.client.removeListener('messageCreate', listener); resolve(); }
                    }, 30000);
                    
                    const listener = (newMsg) => {
                        if (newMsg.channelId === msg.channelId && newMsg.author.id === trigger.swarmPeerId) {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                this.client.removeListener('messageCreate', listener);
                                // Add a 1.5s buffer for Discord eventual consistency before fetching history
                                setTimeout(resolve, 1500);
                            }
                        }
                    };
                    this.client.on('messageCreate', listener);
                });
                
                // Send another typing indicator after the wait, since the first one probably expired
                await msg.channel.sendTyping();
            }

            // Fetch running message context for continuity
            let runningContext = "";
            try {
                const history = await this.readMessages({ channelId: msg.channelId, limit: Math.max(6, trigger.swarm ? 10 : 6) });
                const recent = history
                    .reverse()
                    .filter(m => m.id !== msg.id);
                
                // SWARM PROTOCOL: CONTEXT DEDUPLICATION
                if (trigger.swarm && trigger.swarmPeerId) {
                    for (let i = 0; i < recent.length; i++) {
                        const m = recent[i];
                        if (m.author === trigger.swarmPeerId && m.content.length > 600) {
                            this.log('info', `[SWARM PROTOCOL] Peer message is very large (${m.content.length} chars). Compressing...`);
                            try {
                                const sumRes = await this.brain.reason(`Summarize this long message into 3 concise bullet points. Focus purely on facts, metrics, and actionable constraints. Ignore conversational filler.\n\nMessage:\n${m.content}`, { useLocalFirst: true, temperature: 0.1 });
                                m.content = `[SUMMARIZED BY SOMA COGNITION]:\n${sumRes.text || sumRes.response || sumRes}`;
                            } catch (e) {
                                this.log('warn', `Context deduplication failed: ${e.message}`);
                            }
                        }
                    }
                }

                if (recent.length > 0) {
                    runningContext = recent
                        .map(m => `[${m.bot ? 'SOMA' : m.author}]: ${m.content}`)
                        .join('\n');
                }
            } catch (err) {
                this.log('warn', `Failed to fetch Discord message history: ${err.message}`);
            }

            // 🧠 CROSS-ORBITAL REASONING
            // SOMA uses her unified nervous system to process the Discord query
            const result = await this._askBrain(content, {
                source: 'discord',
                author: msg.author.username,
                userId: msg.author.id,
                channelId: msg.channelId,
                guildId: msg.guildId || 'DM',
                visualContext: visualContext, // Pass CLIP analysis to brain
                channelMode: this._getChannelMode(msg),
                ambient: trigger.ambient === true,
                ambientReason: trigger.reason || null,
                ambientScore: trigger.score || null,
                swarm: trigger.swarm === true,
                runningContext, // Pass historical chat context
                mode: 'fast' // Discord should be snappy
            });

            const initialReply = result.response || result.text || "I am processing your request but cannot formulate a verbal response at this time.";
            
            // SWARM PROTOCOL: COVERT DELIBERATION (DMs)
            let publicReply = initialReply;

            // AUTONOMOUS GOAL QUEUE INTERCEPTOR
            const queueGoalMatch = initialReply.match(/\[QUEUE_GOAL:\s*(.+?)\]/i);
            if (queueGoalMatch) {
                const goalTitle = queueGoalMatch[1].trim();
                publicReply = initialReply.replace(queueGoalMatch[0], '').trim();
                
                try {
                    this.log('info', `[DISCORD INTENT] Intercepted goal authorization: "${goalTitle}"`);
                    // We queue it as an admin engineering request so it gets picked up immediately by her planner
                    const queueFeedback = await this._queueAdminEngineeringGoal(goalTitle, null, msg.channelId, { authorized: true });
                    publicReply += `\n\n*(System Note: ${typeof queueFeedback === 'object' ? queueFeedback.skipped : queueFeedback})*`;
                } catch (e) {
                    this.log('warn', `Failed to queue goal from chat: ${e.message}`);
                }
            }

            const covertDMMatch = initialReply.match(/\[COVERT_DM:\s*(\d+)\]([\s\S]*?)(?=\[|$)/i);
            if (covertDMMatch) {
                const targetId = covertDMMatch[1];
                const covertMessage = covertDMMatch[2].trim();
                publicReply = initialReply.replace(covertDMMatch[0], '').trim();
                
                if (covertMessage) {
                    try {
                        this.log('info', `[SWARM PROTOCOL] Sending covert DM to peer AGI ${targetId}`);
                        const targetUser = await this.client.users.fetch(targetId);
                        if (targetUser) {
                            await targetUser.send(`[COVERT RESEARCH DELEGATION FROM SOMA]:\n${covertMessage}`);
                        }
                    } catch (e) {
                        this.log('warn', `Failed to send covert DM to ${targetId}: ${e.message}`);
                    }
                }
            }
            if (!publicReply) publicReply = "I have dispatched a covert research task to my peer.";

            const guarded = await guardPublicText(publicReply, { query: content });
            let reply = guarded.text || publicReply;
            if (!guarded.ok || reply !== initialReply) {
                await recordLoopEvent({
                    loop: 'claim_honesty_poseidon',
                    phase: 'discord_reply_guarded',
                    actor: 'DiscordArbiter',
                    target: msg.author.username,
                    channel: msg.guild ? (msg.channel?.name || msg.channelId) : 'dm',
                    claim: 'Discord reply was checked by the claim honesty guard before posting',
                    falsificationTest: 'ClaimVerifier returned a guarded text string for the candidate reply',
                    testResult: Boolean(reply),
                    evidence: {
                        changed: reply !== initialReply,
                        hardBlock: guarded.hardBlock?.reason || null,
                        unsupported: guarded.unsupported?.map(item => item.type) || [],
                    },
                    privacy: { originalReply: 'not_logged' },
                    nextStep: 'Use guarded reply only; do not claim unsupported action or evidence.'
                });
                await this._maybeQueueClaimRepairGoal({
                    author: msg.author.username,
                    channel: msg.channel?.name || msg.channelId,
                    unsupported: guarded.unsupported || [],
                    hardBlock: guarded.hardBlock || null
                }).catch(() => {});
            }
            
            // 🎙️ PAULA VOICE SYNTHESIS
            let voiceFile = null;
            if (this.voiceEnabled && reply.length < 500) { // Limit length for speed
                voiceFile = await this._synthesizeVoice(reply);
            }

            // Send reply (split if needed)
            if (reply.length > 1900) {
                const chunks = reply.match(/[\s\S]{1,1900}/g) || [];
                for (let i = 0; i < chunks.length; i++) {
                    const isLast = i === chunks.length - 1;
                    await msg.reply({
                        content: chunks[i],
                        files: (isLast && voiceFile) ? [voiceFile] : []
                    });
                }
            } else {
                await msg.reply({
                    content: reply,
                    files: voiceFile ? [voiceFile] : []
                });
            }

            // Cleanup voice file
            if (voiceFile) await fs.unlink(voiceFile.attachment).catch(() => {});

            await this._recordDiscordInteraction({
                msg,
                content,
                reply,
                action: trigger.ambient ? 'ambient_reply' : 'reply',
                status: 'posted',
                visualContext,
                metadata: trigger.ambient ? { ambient: true, reason: trigger.reason, score: trigger.score } : undefined
            });
            if (trigger.ambient) {
                this._ambientLastReplyByChannel.set(msg.channelId, Date.now());
                this._ambientHourlyReplies.push(Date.now());
            }

            this.metrics.tasksCompleted++;
        } catch (err) {
            this.log('error', 'Discord response failed', { error: err.message });
            await msg.reply(`⚠️  **Cognitive Error:** ${err.message}`);
            await this._recordDiscordInteraction({
                msg,
                content,
                reply: `Cognitive Error: ${err.message}`,
                action: 'reply',
                status: 'failed',
                error: err.message,
                visualContext
            });
        }
    }

    async _readTradingState() {
        const file = path.join(process.cwd(), 'data', 'trading', 'mission-control-runtime.json');
        try {
            const raw = await fs.readFile(file, 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            return null;
        }
    }

    _isTradingStatusQuestion(text = '') {
        const value = String(text || '');
        const tradingTopic = /\b(trades?|trading|positions?|portfolio|pnl|profit|loss(?:es)?|win rate)\b/i.test(value);
        const statusIntent = /\b(how|what|status|doing|going|performance|results?|today|current|latest|so far)\b/i.test(value);
        return tradingTopic && statusIntent;
    }

    _formatTradingStatusReply(snapshot = {}) {
        const all = snapshot.all || {};
        const today = snapshot.today || {};
        const openTrades = Array.isArray(snapshot.openTrades) ? snapshot.openTrades : [];
        const recentTrades = Array.isArray(snapshot.recentTrades) ? snapshot.recentTrades : [];
        const runtime = snapshot.runtime || {};
        const formatPnl = value => `${Number(value || 0) >= 0 ? '+' : '-'}$${Math.abs(Number(value || 0)).toFixed(2)}`;
        const lines = [
            `Today I closed ${today.totalTrades || 0} paper trade${today.totalTrades === 1 ? '' : 's'}: ${today.wins || 0} win${today.wins === 1 ? '' : 's'}, ${today.losses || 0} loss${today.losses === 1 ? '' : 'es'}, ${Number(today.winRate || 0).toFixed(1)}% win rate, ${formatPnl(today.totalPnl)} realized PnL.`,
            `Overall I am at ${all.totalTrades || 0} closed paper trades, ${Number(all.winRate || 0).toFixed(1)}% win rate, ${formatPnl(all.totalPnl)} net PnL, and ${Number.isFinite(all.profitFactor) ? Number(all.profitFactor || 0).toFixed(2) : 'infinite'} profit factor.`,
            `I currently have ${openTrades.length} open position${openTrades.length === 1 ? '' : 's'}. Mode is ${String(runtime.mode || 'paper').toUpperCase()}; live promotion remains blocked until the performance gates pass.`,
        ];
        const latest = recentTrades[0];
        if (latest?.status === 'closed') {
            lines.push(`Latest close: ${latest.symbol} ${String(latest.side || '').toUpperCase()} at ${formatPnl(latest.pnl)}.`);
        }
        return lines.join('\n');
    }

    async _buildTradingStatusReply() {
        if (tradeLogger && !tradeLogger.db) tradeLogger.initialize();
        const closed = tradeLogger?.getClosedTrades?.() || [];
        const todayKey = new Date().toDateString();
        const todayTrades = closed.filter(trade => {
            const timestamp = trade.exit_time || trade.entry_time || trade.created_at;
            return timestamp && new Date(timestamp).toDateString() === todayKey;
        });
        const summarize = trades => {
            const wins = trades.filter(trade => Number(trade.pnl || 0) > 0);
            const losses = trades.filter(trade => Number(trade.pnl || 0) <= 0);
            const totalProfit = wins.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0);
            const totalLoss = losses.reduce((sum, trade) => sum + Math.abs(Number(trade.pnl || 0)), 0);
            return {
                totalTrades: trades.length,
                wins: wins.length,
                losses: losses.length,
                winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
                totalPnl: trades.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0),
                profitFactor: totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0),
            };
        };
        return this._formatTradingStatusReply({
            all: tradeLogger?.getStats?.() || summarize(closed),
            today: summarize(todayTrades),
            openTrades: tradeLogger?.getOpenTrades?.() || [],
            recentTrades: tradeLogger?.getRecentTrades?.(4) || [],
            runtime: await this._readTradingState() || {},
        });
    }

    async _getRealtimeContext() {
        // 1. Fetch Active Goals — with REAL progress + verification state so she
        // reports measured status instead of inventing percentages. getActiveGoals
        // returns { goals: [...] } (an object) — the old Array.isArray(goals) check
        // was always false, so this block always said "No active goals."
        let formattedGoals = "No active goals.";
        if (this.goalPlanner?.getActiveGoals) {
            try {
                const res = await this.goalPlanner.getActiveGoals();
                const goals = Array.isArray(res) ? res : (res?.goals || []);
                if (goals.length > 0) {
                    formattedGoals = goals.map(g => {
                        const lifecycleState = deriveGoalState(g);
                        const preflight = compileEvidencePreflight(g);
                        const status = g.status || 'pending';
                        const verif = g.metadata?.verificationNote || g.metadata?.lastVerification;
                        let verifStr = '';
                        if (verif && typeof verif === 'object') {
                            const failed = Array.isArray(verif.checks)
                                ? verif.checks.filter(check => check?.passed === false).map(check => check.label || check.check || check.type).filter(Boolean)
                                : [];
                            const state = verif.passed === true ? 'pass' : verif.passed === false ? 'fail' : 'stale';
                            const score = Number.isFinite(Number(verif.score)) ? ` ${Number(verif.score)}%` : '';
                            const detail = failed.length ? ` (${failed.slice(0, 2).join('; ')})` : '';
                            verifStr = ` | verification: ${state}${score}${detail}`;
                        } else if (verif) {
                            verifStr = ` | verification: ${this._formatSafeSnippet(String(verif), 60)}`;
                        }
                        // 82% is the stuck-goal ceiling (ran iterations, never verified done);
                        // surface that honestly so it is never read as "almost finished".
                        return `- ${this._formatSafeSnippet(g.title, 80)} — state: ${lifecycleState}, status: ${status}, proof: ${preflight.profile}${verifStr}`;
                    }).join('\n');
                }
            } catch (err) {
                this.log('warn', `Failed to fetch active goals: ${err.message}`);
            }
        }

        // 2. Fetch Recent Work Ledger
        let formattedWork = "No recent autonomic work records.";
        try {
            const workItems = workLedger.list(8);
            if (Array.isArray(workItems) && workItems.length > 0) {
                formattedWork = workItems.map(item => {
                    const timeStr = this._formatArtifactDate(item.timestamp);
                    const title = this._formatSafeSnippet(item.title || item.type || 'activity', 90);
                    const summary = this._formatSafeSnippet(item.summary || '', 200);
                    const status = this._formatSafeSnippet(item.status || 'reported', 30);
                    return `- [${timeStr}] ${title} (${status}): ${summary}`;
                }).join('\n');
            }
        } catch (err) {
            this.log('warn', `Failed to read work ledger: ${err.message}`);
        }

        // 3. Fetch Trading State — HEADLINE is REAL live-paper performance from
        // closed trades. The active strategy's winRate/trades are SIMULATION
        // provenance (e.g. standard_portfolio learned on TLT, 468 sim trades,
        // 70% sim win rate) and must NEVER be reported as live results — that
        // exact mislabel caused her "70% on TLT" claim while really at ~6%.
        let formattedTrading = "No auto-trading status available.";
        try {
            const tradingState = await this._readTradingState();
            let realLine = '';
            try {
                if (tradeLogger && !tradeLogger.db) { try { tradeLogger.initialize(); } catch (e) {} }
                if (tradeLogger?.getStats) {
                    const s = tradeLogger.getStats();
                    const pf = s.profitFactor === Infinity ? '∞' : (s.profitFactor || 0).toFixed(2);
                    realLine = `- YOUR REAL LIVE-PAPER RESULTS (report THESE): ${(s.winRate || 0).toFixed(1)}% win rate over ${s.totalTrades || 0} closed trades | net PnL $${(s.totalPnl || 0).toFixed(2)} | profit factor ${pf}`;
                }
            } catch (e) { /* fall through */ }
            if (tradingState || realLine) {
                const mode = tradingState?.mode || 'inactive';
                const capital = tradingState?.paperCapital || 0;
                const strategy = tradingState?.activeStrategy || {};
                const strategyName = strategy.strategyName || 'None';
                const simSym = strategy.symbol || 'N/A';
                const rawSimWin = Number(strategy.winRate || 0);
                const normalizedSimWin = rawSimWin > 1 ? rawSimWin : rawSimWin * 100;
                const simWin = rawSimWin ? `${normalizedSimWin.toFixed(1)}%` : 'N/A';
                const simTrades = strategy.trades || 0;
                formattedTrading = [
                    realLine || '- YOUR REAL LIVE-PAPER RESULTS: none recorded yet',
                    `- Mode: ${mode.toUpperCase()} (Tier: ${tradingState?.activeTier || 'None'}), paper capital $${capital}`,
                    `- Active strategy: ${strategyName} (its prior SIMULATION record was ${simWin} over ${simTrades} sim trades on ${simSym} — this is NOT your live performance, do not quote it as such)`
                ].join('\n');
            }
        } catch (err) {
            this.log('warn', `Failed to read trading state: ${err.message}`);
        }

        // 4. Fetch Live Open Positions & Recent Trades from trades.db
        let formattedPositions = "No active open positions.";
        let formattedRecentTrades = "No recent trades recorded.";
        try {
            if (tradeLogger) {
                if (!tradeLogger.db) {
                    try { tradeLogger.initialize(); } catch (e) {}
                }
                if (tradeLogger.db) {
                    // Open positions
                    const openTrades = tradeLogger.getOpenTrades();
                    if (Array.isArray(openTrades) && openTrades.length > 0) {
                        formattedPositions = openTrades.map(t => {
                            const ageHours = ((Date.now() - new Date(t.entry_time).getTime()) / (1000 * 60 * 60)).toFixed(1);
                            return `- ${t.symbol} (${t.side.toUpperCase()}): Qty: ${t.qty} @ $${t.entry_price} (Entered ${ageHours}h ago) [Strategy: ${t.strategy || 'manual'}]`;
                        }).join('\n');
                    }

                    // Recent trades (limit 4)
                    const recentTrades = tradeLogger.getRecentTrades(4);
                    if (Array.isArray(recentTrades) && recentTrades.length > 0) {
                        formattedRecentTrades = recentTrades.map(t => {
                            const time = t.exit_time || t.entry_time;
                            const timeStr = this._formatArtifactDate(time);
                            if (t.status === 'closed') {
                                const pnlStr = t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`;
                                return `- [${timeStr}] ${t.symbol} (CLOSED ${t.side.toUpperCase()}): Realized PnL: ${pnlStr} (${t.pnl_pct.toFixed(2)}%) @ exit $${t.exit_price}`;
                            } else {
                                return `- [${timeStr}] ${t.symbol} (OPENED ${t.side.toUpperCase()}): Expected: $${t.expected_price || t.entry_price} @ entry $${t.entry_price}`;
                            }
                        }).join('\n');
                    }
                }
            }
        } catch (err) {
            this.log('warn', `Failed to query trades.db: ${err.message}`);
        }

        return [
            `[SOMA LIVE OPERATIONAL STATE]`,
            `Active Goals:`,
            formattedGoals,
            `\nRecent Autonomic Work Ledger:`,
            formattedWork,
            `\nAuto-Trading Status:`,
            formattedTrading,
            `\nActive Open Positions:`,
            formattedPositions,
            `\nRecent Completed/Entry Trades:`,
            formattedRecentTrades
        ].join('\n');
    }

    async _askBrain(content, context = {}) {
        const realtimeState = await this._getRealtimeContext();
        const executionPolicy = [
            '[EXECUTION TRUTH CONTRACT]',
            'Never say work is running, started, updated, tested, simulated, researched, or completed unless the live context contains a matching current execution receipt or simulation job record.',
            'A plan, intention, generated explanation, queued goal, or old artifact is not proof of execution.',
            'If the user authorizes concrete work, include [QUEUE_GOAL: <specific measurable goal>] and describe it as queued until a receipt shows execution.',
            'For technical numbers, show the calculation or identify the retrieved source. Label assumptions and hypotheses explicitly.',
            'Never invent job IDs, measurements, literature results, toxicity thresholds, model outputs, or completion states.',
            '[/EXECUTION TRUTH CONTRACT]'
        ].join('\n');
        const enhancedContent = `${executionPolicy}\n\nMessage: ${content}\n\n${realtimeState}`;

        if (this.brain?.processQuery) {
            return await this.brain.processQuery(enhancedContent, context);
        }

        const author = context.author || 'someone';
        const visual = context.visualContext ? `\n${context.visualContext}` : '';
        const channelMode = context.channelMode ? `\nChannel mode: ${context.channelMode.label}. ${context.channelMode.instruction}` : '';
        const ambient = context.ambient
            ? `\nAmbient participation: SOMA was not directly called. Reply only if you can add clear value. Be brief, non-intrusive, and do not dominate the conversation.`
            : '';
        const prompt = [
            `You are SOMA replying in Discord to ${author}.`,
            'Answer as one unified cognitive identity.',
            'Be concise, useful, warm when appropriate, and avoid corporate bot language.',
            'Do not mention internal subsystem names unless the user explicitly asks.',
            'Operational honesty is mandatory: distinguish intent, plans, and verified action.',
            'Do not claim you scanned files, wrote code, changed the filesystem, spawned MAX, watched a diff stream, committed changes, queued tasks, or observed live trading results unless that exact action is present in the live operational context, a current command result, or a recent work-ledger entry.',
            'When the user asks you to do work that requires tools you do not have in this Discord turn, say what you can queue or investigate next instead of saying it is already running.',
            'If the user explicitly authorizes you to perform a task you just proposed, or commands you to perform a specific action, you MUST include the exact tag [QUEUE_GOAL: <goal title>] in your response. SOMA will intercept this and automatically queue the goal for execution.',
            'If a prior message claimed action but no evidence is present, treat it as unverified and say you need to verify it.',
            'TRADING NUMBERS: only ever quote the "YOUR REAL LIVE-PAPER RESULTS" line for win rate and PnL. Never quote a strategy\'s simulation record (e.g. a 70% figure on TLT) as if it were your live performance. If asked how trading is going, give the real win rate and net PnL even when they are bad.',
            'GOAL PROGRESS: only report a goal\'s progress and status from the Active Goals list above. Never invent a completion percentage. A goal at ~80%+ that is not status:completed has merely executed without verification — describe it as unverified/stuck, not as nearly done. Do not announce a feature, daemon, or strategy as built unless a work-ledger entry or verified goal confirms it.',
            `Use the following live operational context to inform your responses naturally (do not repeat it verbatim, only use it as background context to answer questions about your day, goals, trading or what you are doing):`,
            realtimeState,
            visual,
            channelMode,
            ambient,
            `Message: ${content}`
        ].filter(Boolean).join('\n');

        if (this.brain?.reason) {
            return await this.brain.reason(prompt, {
                quickResponse: context.mode === 'fast',
                preferredBrain: 'AURORA',
                temperature: 0.75
            });
        }

        if (this.brain?.callBrain) {
            const text = await this.brain.callBrain('AURORA', prompt, { source: 'discord' }, 'fast');
            return { response: text, text };
        }

        throw new Error('SomaBrain not linked to DiscordArbiter');
    }

    _normalizeText(text = '') {
        return String(text || '').trim();
    }

    _getChannelMode(msg) {
        const explicit = this.channelModes.get(msg.channelId);
        if (explicit) return this._modeDefinition(explicit);
        const name = String(msg.channel?.name || '').toLowerCase();
        if (/market|trade|finance|stock|crypto/.test(name)) return this._modeDefinition('markets');
        if (/creative|story|saga|art|image|muse/.test(name)) return this._modeDefinition('creative');
        if (/bot|command|dev|code|build/.test(name)) return this._modeDefinition('bots-commands');
        if (/medical|bio|health|research|lab/.test(name)) return this._modeDefinition('medical');
        return this._modeDefinition('general');
    }

    _modeDefinition(mode = 'general') {
        const key = String(mode || 'general').toLowerCase().replace(/[^a-z-]/g, '');
        const modes = {
            general: {
                key: 'general',
                label: 'General',
                instruction: 'Be concise, social, and useful. Prefer asking one clarifying question only when needed.'
            },
            'bots-commands': {
                key: 'bots-commands',
                label: 'Bots / Commands',
                instruction: 'Prioritize operational clarity, command results, debugging, and exact next steps.'
            },
            creative: {
                key: 'creative',
                label: 'Creative',
                instruction: 'Favor imagery, story craft, scene language, and original ideas while staying coherent.'
            },
            markets: {
                key: 'markets',
                label: 'Markets',
                instruction: 'Evidence first. No buy/sell instructions. Frame market comments as hypotheses and risk checks.'
            },
            medical: {
                key: 'medical',
                label: 'Medical / Research',
                instruction: 'Evidence first. No diagnosis or treatment advice. Distinguish hypothesis from clinical guidance.'
            }
        };
        return modes[key] || modes.general;
    }

    _isImageRequest(text = '') {
        return /\b(make|generate|draw|create|render)\b.{0,80}\b(image|picture|photo|art|illustration|visual)\b/i.test(text)
            || /\b(image|picture|photo|art|illustration|visual)\b.{0,80}\b(of|for)\b/i.test(text)
            || /\b(let'?s try|try this|make this|render this)\b.{0,220}\b(style|dinosaur|dragon|armor|fantasy|portrait|landscape|character|scene|creature)\b/i.test(text);
    }

    _isImageCapabilityQuestion(text = '') {
        return /\b(can|could|do|are)\b.{0,60}\b(you|soma)\b.{0,60}\b(image|images|picture|pictures|photo|photos|art|visuals?)\b/i.test(text)
            || /\b(image|images|picture|pictures|photo|photos|art|visuals?)\b.{0,60}\b(in here|on discord|this chat|generate|generation)\b/i.test(text);
    }

    _extractImagePrompt(text = '') {
        return String(text || '')
            .replace(/^@?soma[:,]?\s*/i, '')
            .replace(/^just\s+give\s+(?:me|us)?\s*/i, '')
            .replace(/\b(make|generate|draw|create|render)\b/ig, '')
            .replace(/\b(me|us)?\s*(an?|the)?\s*(image|picture|photo|art|illustration|visual)\b/ig, '')
            .replace(/\bof\b/i, '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 500) || 'a cinematic SOMA visual';
    }

    _sanitizeImagePrompt(prompt = '') {
        return String(prompt || '')
            .replace(/^["'`]+|["'`]+$/g, '')
            .replace(/^(prompt|image prompt|refined prompt|final prompt)\s*:\s*/i, '')
            .replace(/\b(as an ai|i can|i will|here'?s|sure[,:\s])\b.*?:/i, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 900);
    }

    _fallbackRefineImagePrompt(prompt = '') {
        const base = this._sanitizeImagePrompt(prompt);
        const lower = base.toLowerCase();
        const style = /\b(90s|sword|sorcery|fantasy|oil painting|anime|pixel|watercolor|photo|cinematic|comic|realistic|surreal|noir|retro)\b/i.test(base)
            ? ''
            : 'cinematic fantasy illustration';
        const scale = /\b(small|tiny|miniature|huge|giant|massive|close-up|wide shot|portrait)\b/i.test(base)
            ? ''
            : 'clear focal subject';
        const setting = /\b(forest|swamp|castle|city|room|space|ocean|desert|mountain|battlefield|garden|pond|jungle)\b/i.test(base)
            ? ''
            : (/\bfrog\b/i.test(base) ? 'beside a rain-soaked mossy pond' : 'in a coherent environment');
        const mood = /\b(cute|dark|scary|epic|warm|calm|dramatic|funny|beautiful|mysterious)\b/i.test(base)
            ? ''
            : (/\bfrog\b/i.test(lower) ? 'whimsical and detailed' : 'dramatic but clean');
        return [base, style, scale, setting, mood, 'strong composition, natural lighting, depth, high detail']
            .filter(Boolean)
            .join(', ')
            .replace(/\s+/g, ' ')
            .slice(0, 900);
    }

    async _refineImagePrompt(prompt = '') {
        const base = this._sanitizeImagePrompt(prompt);
        const fallback = this._fallbackRefineImagePrompt(base);
        if (!this.brain) return fallback;

        const instruction = [
            'Rewrite this Discord image request into one image-generation prompt.',
            'Preserve the exact subject and user intent. Do not add computers, monitors, terminals, keyboards, UI, offices, or SOMA branding unless the user explicitly asked for them.',
            'Add useful visual detail: style, composition, lighting, environment, texture, mood.',
            'Return only the prompt. No explanation. No quotes. No labels. Max 85 words.',
            `User request: ${base}`
        ].join('\n');

        try {
            const response = await Promise.race([
                this.brain.callBrain
                    ? this.brain.callBrain('AURORA', instruction, { source: 'discord_image_prompt_refiner' }, 'fast')
                    : this.brain.reason?.(instruction, { quickResponse: true, preferredBrain: 'AURORA', temperature: 0.55 }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('prompt refinement timeout')), 7000))
            ]);
            const refinedText = typeof response === 'string' ? response : (response?.response || response?.text || '');
            const refined = this._sanitizeImagePrompt(refinedText);
            if (refined.length >= Math.max(20, base.length * 0.8) && refined.length <= 900) {
                return `${base}, ${refined}`.slice(0, 900);
            }
        } catch (e) {
            this.log('warn', `Discord image prompt refinement fell back: ${e.message}`);
        }
        return fallback;
    }

    _isFinanceQuestion(text = '') {
        return /\b(stock|stocks|ticker|market|btc|eth|crypto|option|trade|trading|buy|sell|price target|profit|portfolio)\b/i.test(text);
    }

    _isMedicalQuestion(text = '') {
        return /\b(medical|doctor|diagnose|diagnosis|treat|treatment|dose|dosage|symptom|cancer|disease|therapy|patient|drug|medicine)\b/i.test(text);
    }

    _isAdminOperationalRequest(text = '') {
        const value = String(text || '');
        const action = /\b(look at|scan|inspect|check|read|open|list|find|search|audit|review|implement|fix|change|modify|refactor|merge|queue|spawn|max)\b/i.test(value);
        const target = /\b(code|repo|repository|files?|filesystem|arbiter|arbiters|module|modules|server|core|daemon|daemons|discord|personality|tools?|max|self|yourself|your code)\b/i.test(value);
        return action && (target || Boolean(this._extractPathCandidate(value)));
    }

    _isAdminUser(msg = {}) {
        const author = msg.author || {};
        const authorId = String(author.id || '');
        if (this.masterId && authorId === String(this.masterId)) return true;
        if (this.adminIds.has(authorId)) return true;

        const names = [
            author.username,
            author.globalName,
            author.displayName,
            msg.member?.displayName,
            msg.member?.nickname
        ]
            .map(name => String(name || '').trim().toLowerCase())
            .filter(Boolean);

        return names.some(name => this.adminUsernames.has(name));
    }

    _extractPathCandidate(text = '') {
        const value = String(text || '');
        const quoted = value.match(/[`"']([^`"']+\.(?:js|cjs|mjs|ts|tsx|jsx|json|md|txt|py|css|html))[`"']/i);
        if (quoted) return quoted[1].trim();
        const bare = value.match(/\b([A-Za-z0-9_. -]+[\\/][A-Za-z0-9_.\\/-]+\.(?:js|cjs|mjs|ts|tsx|jsx|json|md|txt|py|css|html))\b/i);
        if (bare) return bare[1].trim();
        const filename = value.match(/\b([A-Za-z0-9_.-]+\.(?:js|cjs|mjs|ts|tsx|jsx|json|md|txt|py|css|html))\b/i);
        return filename?.[1]?.trim() || null;
    }

    _extractSearchPattern(text = '') {
        const quoted = String(text || '').match(/(?:find|search)(?:\s+for)?\s+[`"']([^`"']+)[`"']/i);
        if (quoted) return quoted[1].trim();
        const named = String(text || '').match(/\b(?:file|files|named|called)\s+([A-Za-z0-9_.-]+)/i);
        if (named) return named[1].trim();
        if (/\barbiter/i.test(text)) return '*Arbiter*';
        if (/\bdiscord/i.test(text)) return '*Discord*';
        return '*';
    }

    async _executeRegistryTool(name, args = {}) {
        if (!this.system?.toolRegistry?.execute) {
            throw new Error('ToolRegistry is not available in this SOMA process');
        }
        return await this.system.toolRegistry.execute(name, args);
    }

    _formatToolResult(result, max = 1200) {
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return this._formatSafeSnippet(text, max);
    }

    _isLocalSpeechRequest(text = '') {
        const value = String(text || '');
        return /\b(tell|say|speak|announce)\b/i.test(value)
            && /\b(wife|erin|home|house|pc|computer|desktop|speakers?|out loud|aloud)\b/i.test(value);
    }

    _isLocalSpeechRetryRequest(text = '') {
        const value = String(text || '');
        return /\b(didn'?t hear|did not hear|nope|nothing came through|try again|again|redo|repeat|say it again|speak it again)\b/i.test(value)
            && /\b(try again|again|redo|repeat|say it again|speak it again|didn'?t hear|did not hear|nothing came through)\b/i.test(value);
    }

    _extractLocalSpeechMessage(text = '') {
        let value = String(text || '')
            .replace(/^@?soma[:,]?\s*/i, '')
            .replace(/\b(on|from)\s+discord\b/ig, '')
            .replace(/^(?:can|could|would)\s+you\s+/i, '')
            .replace(/\bmy\s+wife\s+erin\b/ig, 'Erin')
            .replace(/\bmy\s+wife\b/ig, 'Erin')
            .trim();

        const directMatch = value.match(/\btell\s+(?:(my)\s+)?([a-z][a-z'-]*|wife)(?:\s+at\s+home)?(?:\s+that)?\s+([\s\S]+)/i);
        if (directMatch?.[3]) {
            const recipientRaw = directMatch[2].toLowerCase();
            const recipient = recipientRaw === 'wife' ? 'Erin' : `${recipientRaw.charAt(0).toUpperCase()}${recipientRaw.slice(1)}`;
            let message = directMatch[3].trim()
                .replace(/^that\s+/i, '')
                .replace(/\s+at\s+home[.!?]*$/i, '')
                .replace(/\s+from\s+(?:the\s+)?(?:home\s+)?(?:pc|computer|desktop|speakers?)[.!?]*$/i, '')
                .replace(/[?]+$/g, '.')
                .trim();
            message = message
                .replace(/^hello[.!?]*$/i, 'Barry wanted me to tell you hello.')
                .replace(/^hi[.!?]*$/i, 'Barry wanted me to tell you hi.')
                .replace(/^i\s+said\s+hello[.!?]*$/i, 'Barry wanted me to tell you hello.')
                .replace(/^i\s+said\s+hi[.!?]*$/i, 'Barry wanted me to tell you hi.')
                .replace(/^i\s+love\s+(?:her|you)[.!?]*$/i, 'Barry wanted me to tell you he loves you.');
            if (/^i\b/i.test(message)) {
                message = `Barry says: ${message}`;
            }
            if (!/[.!?]$/.test(message)) message += '.';
            return {
                recipient,
                message: `Hey ${recipient}, ${message}`,
                listenForReply: true
            };
        }

        const quoted = value.match(/["'`](.+?)["'`]/);
        if (quoted?.[1]) return { recipient: null, message: quoted[1].trim(), listenForReply: false };

        const speakMatch = value.match(/\b(?:say|speak|announce)\s+([\s\S]+?)(?:\s+(?:on|through|from)\s+(?:the\s+)?(?:home\s+)?(?:pc|computer|desktop|speakers?))?$/i);
        if (speakMatch?.[1]) return { recipient: null, message: speakMatch[1].trim(), listenForReply: /\b(listen|response|reply|answer)\b/i.test(value) };

        return { recipient: null, message: value, listenForReply: false };
    }

    _normalizeSpeechText(value = '') {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .trim();
    }

    _stripKnownSpeechInjection(value = '') {
        return this._normalizeSpeechText(value)
            .replace(/^hey\s+me[,.:;!?-]*\s*/i, '')
            .trim();
    }

    _speechDedupeKey({ msg, sourceText = '', speech = '' } = {}) {
        const raw = [
            msg?.guildId || 'dm',
            msg?.channelId || 'unknown-channel',
            msg?.author?.id || 'unknown-author',
            this._normalizeSpeechText(sourceText).toLowerCase(),
            this._normalizeSpeechText(speech).toLowerCase()
        ].join('|');
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    _checkRemoteSpeechDedupe({ msg, sourceText = '', speech = '', windowMs = 60000 } = {}) {
        const now = Date.now();
        for (const [key, entry] of this.remoteSpeechDedupe.entries()) {
            if (now - Number(entry?.timestamp || 0) > windowMs) this.remoteSpeechDedupe.delete(key);
        }
        const key = this._speechDedupeKey({ msg, sourceText, speech });
        const previous = this.remoteSpeechDedupe.get(key);
        if (previous && now - Number(previous.timestamp || 0) <= windowMs) {
            return {
                duplicate: true,
                key,
                previousRequestId: previous.requestId || null,
                ageMs: now - Number(previous.timestamp || 0)
            };
        }
        return { duplicate: false, key };
    }

    _rememberRemoteSpeechDedupe(key, requestId) {
        if (!key) return;
        this.remoteSpeechDedupe.set(key, { requestId, timestamp: Date.now() });
    }

    _validateRemoteSpeechFidelity({ sourceText = '', extractedSpeech = '', toolResult = null } = {}) {
        const cleanedSpeech = this._stripKnownSpeechInjection(extractedSpeech);
        const spoken = this._stripKnownSpeechInjection(toolResult?.spoken || cleanedSpeech);
        const reasons = [];
        if (!cleanedSpeech) reasons.push('empty extracted speech');
        if (/^hey\s+me\b/i.test(this._normalizeSpeechText(extractedSpeech))) {
            reasons.push('removed injected "Hey Me" prefix from extracted speech');
        }
        if (toolResult?.spoken && spoken !== cleanedSpeech) {
            reasons.push('desktop_speak returned spoken text that differs from extracted speech');
        }
        return {
            ok: cleanedSpeech.length > 0 && (!toolResult?.spoken || spoken === cleanedSpeech),
            sourceText: this._normalizeSpeechText(sourceText),
            speech: cleanedSpeech,
            spoken,
            corrected: cleanedSpeech !== this._normalizeSpeechText(extractedSpeech),
            reasons
        };
    }

    async _handleAdminLocalSpeech(msg, text, visualContext = '') {
        if (!this._isLocalSpeechRequest(text)) return { handled: false };

        const extracted = this._extractLocalSpeechMessage(text);
        return await this._speakAdminLocalMessage(msg, text, extracted, visualContext);
    }

    async _handleAdminLocalSpeechRetry(msg, text, visualContext = '') {
        if (!this._isLocalSpeechRetryRequest(text)) return { handled: false };
        const last = this.lastRemoteSpeechByAuthor.get(String(msg.author.id || ''));
        if (!last || Date.now() - Number(last.timestamp || 0) > 15 * 60 * 1000) return { handled: false };
        return await this._speakAdminLocalMessage(msg, text, {
            recipient: last.recipient || null,
            message: last.speech || '',
            listenForReply: last.listenForReply !== false
        }, visualContext, { retryOf: last.requestId || null });
    }

    async _speakAdminLocalMessage(msg, text, extracted = {}, visualContext = '', options = {}) {
        const requestId = `remote-speech-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const speech = String(extracted.message || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
        const preflightFidelity = this._validateRemoteSpeechFidelity({ sourceText: text, extractedSpeech: speech });
        const finalSpeech = preflightFidelity.speech;

        if (!finalSpeech) {
            const reply = 'I can speak at home, but I need the message to say.';
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_local_speech', status: 'failed', visualContext });
            return { handled: true };
        }

        if (!options.retryOf) {
            const dedupe = this._checkRemoteSpeechDedupe({ msg, sourceText: text, speech: finalSpeech });
            if (dedupe.duplicate) {
                const reply = `I already sent that same home speech request less than 60 seconds ago, so I did not repeat it.`;
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_local_speech', status: 'deduped', visualContext });
                return { handled: true };
            }
            options.dedupeKey = dedupe.key;
        }

        try {
            const recipient = extracted.recipient || 'home';
            const profile = await getHomePresenceProfile(recipient).catch(() => null);
            const listenWindowMs = profile?.suppressed ? 10000 : 25000;
            this.remoteSpeechRequests.set(requestId, {
                requestId,
                channelId: msg.channelId,
                guildId: msg.guildId || null,
                authorId: msg.author.id,
                recipient,
                speech: finalSpeech,
                createdAt: Date.now(),
                heardReply: false,
                answered: false
            });
            const cleanupTimer = setTimeout(() => this.remoteSpeechRequests.delete(requestId), 5 * 60 * 1000);
            cleanupTimer.unref?.();

            const result = await this._executeRegistryTool('desktop_speak', {
                text: finalSpeech,
                listenForReply: Boolean(extracted.listenForReply),
                listenWindowMs,
                requestId,
                recipient,
                replyChannelId: msg.channelId,
                checkPresence: true
            });
            if (!result?.success) throw new Error(result?.error || 'desktop_speak failed');
            const fidelity = this._validateRemoteSpeechFidelity({ sourceText: text, extractedSpeech: finalSpeech, toolResult: result });
            if (!fidelity.ok) {
                throw new Error(`desktop_speak fidelity check failed: ${fidelity.reasons.join('; ') || 'unknown mismatch'}`);
            }
            const pendingRequest = this.remoteSpeechRequests.get(requestId);
            if (pendingRequest) pendingRequest.presenceCheck = result.presenceCheck || null;
            if (options.dedupeKey) this._rememberRemoteSpeechDedupe(options.dedupeKey, requestId);
            await recordHomePresenceOutcome(recipient, 'attempted', {
                visiblePerson: result.presenceCheck?.visiblePerson,
                summary: finalSpeech,
                timestamp: Date.now()
            }).catch(() => {});
            await recordLoopEvent({
                loop: 'remote_home_presence',
                phase: 'spoken',
                actor: 'DiscordArbiter',
                target: recipient,
                channel: 'discord_to_command_bridge',
                requestId,
                claim: `Remote speech request ${requestId} was broadcast to Command Bridge`,
                falsificationTest: 'desktop_speak returned success and used at least one local speech route',
                testResult: result.success === true && /\b(command_bridge|system_speech)\b/.test(String(result.route || '')),
                evidence: {
                    spoken: finalSpeech,
                    sourceCommandText: text,
                    fidelity,
                    route: result.route,
                    retryOf: options.retryOf || null,
                    commandBridgeBroadcast: Boolean(result.commandBridgeBroadcast),
                    systemSpeech: result.systemSpeech || null,
                    presenceCheck: result.presenceCheck || null,
                    adaptiveProfile: profile ? {
                        confidence: profile.confidence,
                        suppressed: Boolean(profile.suppressed),
                        listenWindowMs
                    } : null
                },
                nextStep: extracted.listenForReply ? 'Wait for Command Bridge remote_speech_status event.' : null
            });
            this.lastRemoteSpeechByAuthor.set(String(msg.author.id || ''), {
                requestId,
                recipient,
                speech: finalSpeech,
                listenForReply: Boolean(extracted.listenForReply),
                timestamp: Date.now()
            });

            const presence = result.presenceCheck?.checked
                ? (result.presenceCheck.visiblePerson ? ' Presence check sees someone near the webcam.' : ' Presence check did not confidently see a person, but I sent it anyway.')
                : '';
            const adaptive = profile?.suppressed ? ' Recent attempts have not gotten a reply, so I used a shorter listening window.' : '';
            const routeNote = result.route === 'system_speech+command_bridge_listen'
                ? ' via Windows speakers; Command Bridge opened the reply listener'
                : result.route === 'system_speech+command_bridge'
                    ? ' via Windows speakers and Command Bridge'
                : result.route === 'system_speech'
                    ? ' via Windows speakers'
                    : ' via Command Bridge';
            const retryNote = options.retryOf ? 'Retried' : 'Spoken';
            const reply = extracted.listenForReply
                ? `${retryNote} at home${routeNote} and listening briefly for a reply: "${finalSpeech}"${presence}${adaptive}`
                : `${retryNote} at home${routeNote}: "${finalSpeech}"${presence}`;
            workLedger.record({
                type: 'discord_admin_local_speech',
                title: 'Spoke a Discord-requested message on the desktop',
                summary: `SOMA spoke locally: ${finalSpeech}`,
                evidence: ['desktop_speak', 'source_text_fidelity', 'source_command_dedupe'],
                status: 'completed',
                source: 'DiscordArbiter',
                confidence: 0.98,
                sourceCommandText: text,
                spokenText: finalSpeech,
                requestId,
                fidelity: preflightFidelity
            });
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_local_speech', status: 'posted', visualContext });
            return { handled: true };
        } catch (err) {
            this.remoteSpeechRequests.delete(requestId);
            await recordHomePresenceOutcome(extracted.recipient || 'home', 'failed', {
                summary: err.message,
                timestamp: Date.now()
            }).catch(() => {});
            const reply = `I tried to speak that at home, but desktop speech failed: ${err.message}`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_local_speech', status: 'failed', error: err.message, visualContext });
            return { handled: true };
        }
    }

    async handleRemoteSpeechStatus(payload = {}) {
        const requestId = String(payload.requestId || '');
        const pending = this.remoteSpeechRequests.get(requestId);
        if (!pending || !this.client) return false;

        const phase = String(payload.phase || '');
        const channel = await this.client.channels.fetch(pending.channelId).catch(() => null);
        if (!channel?.send) return false;

        if (phase === 'heard_reply' && !pending.heardReply) {
            pending.heardReply = true;
            const speaker = payload.speaker || pending.recipient || 'someone at home';
            await recordLoopEvent({
                loop: 'remote_home_presence',
                phase: 'heard_reply',
                actor: 'CommandBridge',
                target: speaker,
                channel: 'home_mic_to_discord',
                requestId,
                claim: `A home reply was heard for remote speech request ${requestId}`,
                falsificationTest: 'Command Bridge emitted remote_speech_status heard_reply with matching requestId',
                testResult: true,
                evidence: {
                    speaker,
                    transcriptPreview: String(payload.transcriptPreview || '').slice(0, 180)
                },
                privacy: { transcript: 'preview_only' },
                nextStep: 'Wait for Soma spoken answer summary.'
            });
            await recordHomePresenceOutcome(speaker, 'heard_reply', {
                summary: 'Home reply was heard.',
                timestamp: Date.now()
            }).catch(() => {});
            await channel.send(`${speaker} answered at home. I’m talking with them now.`);
            return true;
        }

        if (phase === 'soma_answered' && !pending.answered) {
            pending.answered = true;
            const speaker = payload.speaker || pending.recipient || 'someone at home';
            const summary = String(payload.summary || payload.response || 'Soma answered at home.').replace(/\s+/g, ' ').trim().slice(0, 220);
            await recordLoopEvent({
                loop: 'remote_home_presence',
                phase: 'soma_answered',
                actor: 'CommandBridge',
                target: speaker,
                channel: 'home_voice_to_discord_summary',
                requestId,
                claim: `SOMA answered the home reply for remote speech request ${requestId}`,
                falsificationTest: 'Command Bridge emitted remote_speech_status soma_answered with matching requestId and summary',
                testResult: Boolean(summary),
                evidence: { speaker, summary },
                privacy: { transcript: 'summary_only' },
                nextStep: 'Use this result to tune future home presence timing and tone.'
            });
            await recordHomePresenceOutcome(speaker, 'answered', {
                summary,
                timestamp: Date.now()
            }).catch(() => {});
            await channel.send(`Home reply bridge: ${speaker} responded, and I answered. Summary: ${summary}`);
            this.remoteSpeechRequests.delete(requestId);
            return true;
        }

        if (phase === 'no_reply') {
            const noReplyOutcome = pending.presenceCheck?.checked && pending.presenceCheck.visiblePerson === false
                ? 'bad_timing'
                : 'no_reply';
            await recordLoopEvent({
                loop: 'remote_home_presence',
                phase: noReplyOutcome,
                actor: 'CommandBridge',
                target: pending.recipient || 'home',
                channel: 'home_mic_to_discord',
                requestId,
                claim: noReplyOutcome === 'bad_timing'
                    ? `No home reply was heard and presence check did not show a person for remote speech request ${requestId}`
                    : `No home reply was heard for remote speech request ${requestId}`,
                falsificationTest: 'Command Bridge reply window expired without transcript change',
                testResult: true,
                evidence: { listenWindowExpired: true, presenceCheck: pending.presenceCheck || null },
                nextStep: 'Avoid assuming anyone heard the message.'
            });
            await recordHomePresenceOutcome(pending.recipient || 'home', noReplyOutcome, {
                summary: 'No reply during remote speech window.',
                timestamp: Date.now()
            }).catch(() => {});
            await channel.send(`No one answered at home during the reply window.`);
            this.remoteSpeechRequests.delete(requestId);
            return true;
        }

        if (phase === 'failed') {
            await recordLoopEvent({
                loop: 'remote_home_presence',
                phase: 'failed',
                actor: 'CommandBridge',
                target: pending.recipient || 'home',
                channel: 'home_voice_to_discord',
                requestId,
                claim: `Remote speech request ${requestId} failed`,
                falsificationTest: 'Command Bridge emitted remote_speech_status failed',
                testResult: true,
                evidence: { error: String(payload.error || 'unknown error').slice(0, 220) },
                nextStep: 'Do not claim the home interaction completed.'
            });
            await recordHomePresenceOutcome(pending.recipient || 'home', 'failed', {
                summary: String(payload.error || 'unknown error').slice(0, 220),
                timestamp: Date.now()
            }).catch(() => {});
            await channel.send(`Home voice bridge failed: ${String(payload.error || 'unknown error').slice(0, 180)}`);
            this.remoteSpeechRequests.delete(requestId);
            return true;
        }

        return false;
    }

    async _maybeQueueClaimRepairGoal({ author = 'unknown', channel = 'discord', unsupported = [], hardBlock = null } = {}) {
        const claimTypes = [
            ...(unsupported || []).map(item => item.type).filter(Boolean),
            hardBlock?.reason ? `hard:${hardBlock.reason}` : null
        ].filter(Boolean);
        if (!claimTypes.length) return null;

        const key = claimTypes.sort().join('|');
        const cooldownUntil = this._claimRepairCooldown.get(key) || 0;
        if (Date.now() < cooldownUntil) return null;

        const recent = await readLoopLedger(80, { loop: 'claim_honesty_poseidon' });
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const matching = recent.filter(record => {
            if ((record.timestamp || 0) < oneDayAgo) return false;
            const unsupportedEvidence = record.evidence?.unsupported || [];
            const hard = record.evidence?.hardBlock || null;
            const haystack = `${unsupportedEvidence.join('|')} ${hard || ''}`;
            return claimTypes.some(type => haystack.includes(type.replace(/^hard:/, '')));
        });

        if (matching.length < 3) return null;

        const planner = this.goalPlanner || this.system?.goalPlanner;
        if (!planner?.createGoal) return null;

        const title = `Reduce repeated unsupported Discord claims: ${claimTypes.slice(0, 2).join(', ')}`;
        const result = await planner.createGoal({
            type: 'operational',
            category: 'claim_honesty',
            title,
            description: [
                `Claim guard downgraded the same claim pattern ${matching.length} times in the last 24 hours.`,
                `Claim types: ${claimTypes.join(', ')}`,
                `Recent channel: ${channel}. Recent author: ${author}.`,
                'Inspect prompts, memory context, and work-ledger evidence retrieval before changing behavior.',
                'Success means future Discord replies either cite evidence, stay uncertain, or avoid the unsupported claim.'
            ].join('\n'),
            priority: 78,
            requireQuality: false,
            confidence: 0.82,
            assignedTo: ['SomaAgenticExecutor', 'EngineeringSwarmArbiter'],
            verification: {
                required: true,
                evidence: ['LoopLedger claim_honesty_poseidon entries', 'prompt or guard change', 'focused test']
            },
            metadata: {
                source: 'poseidon_claim_loop',
                claimTypes,
                recentCount: matching.length,
                sourceChannelId: context?.channelId || null
            }
        }, 'poseidon');

        this._claimRepairCooldown.set(key, Date.now() + 6 * 60 * 60 * 1000);
        workLedger.record({
            type: 'poseidon_claim_repair_goal',
            title,
            summary: `Created repair goal after ${matching.length} repeated claim guard downgrades.`,
            evidence: matching.slice(0, 5).map(item => item.id),
            status: result?.success === false ? 'failed' : 'queued',
            source: 'DiscordArbiter',
            confidence: 0.82
        });
        return result;
    }

    async _handleAdminOperationalAction(msg, text, visualContext = '') {
        if (!this._isAdminOperationalRequest(text)) return { handled: false };

        let reply = '';
        const pathCandidate = this._extractPathCandidate(text);
        const wantsMutation = /\b(implement|fix|change|modify|refactor|merge|write|edit|update)\b/i.test(text);

        try {
            if (wantsMutation) {
                reply = await this._queueAdminEngineeringGoal(text, pathCandidate, msg.channelId);
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_engineering_goal', status: 'posted', visualContext });
                return { handled: true };
            }

            if (pathCandidate && /\b(read|open|inspect|check|review|look at)\b/i.test(text)) {
                const result = await this._executeRegistryTool('read_file', { path: pathCandidate });
                reply = [
                    `I read \`${pathCandidate}\`.`,
                    '```text',
                    this._formatToolResult(result, 1500),
                    '```'
                ].join('\n').slice(0, 1900);
                workLedger.record({
                    type: 'discord_admin_tool_execution',
                    title: `Read file from Discord: ${pathCandidate}`,
                    summary: `Executed read_file for ${pathCandidate}.`,
                    evidence: [pathCandidate],
                    status: 'completed',
                    source: 'DiscordArbiter',
                    confidence: 0.98
                });
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_read_file', status: 'posted', visualContext });
                return { handled: true };
            }

            if (/\b(find|search)\b/i.test(text)) {
                const pattern = this._extractSearchPattern(text);
                const result = await this._executeRegistryTool('find_files', { pattern, path: process.cwd(), limit: 40 });
                reply = [
                    `I searched the repo for \`${pattern}\`.`,
                    '```text',
                    this._formatToolResult(result, 1500),
                    '```'
                ].join('\n').slice(0, 1900);
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_find_files', status: 'posted', visualContext });
                return { handled: true };
            }

            if (/\barbiter|arbiters\b/i.test(text)) {
                const result = await this._executeRegistryTool('list_files', { path: 'arbiters' });
                reply = [
                    'I listed the `arbiters` directory for real.',
                    '```text',
                    this._formatToolResult(result, 1500),
                    '```'
                ].join('\n').slice(0, 1900);
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_list_arbiters', status: 'posted', visualContext });
                return { handled: true };
            }

            if (/\b(scan|status|architecture|system|memory|heap|runtime|health)\b/i.test(text)) {
                const [scan, coreList, arbiterList] = await Promise.all([
                    this._executeRegistryTool('system_scan', {}),
                    this._executeRegistryTool('list_files', { path: 'core' }),
                    this._executeRegistryTool('list_files', { path: 'arbiters' })
                ]);
                reply = [
                    'I checked my runtime and code directories for real.',
                    `System: ${this._formatToolResult(scan, 350)}`,
                    '',
                    'Core files:',
                    '```text',
                    this._formatToolResult(coreList, 550),
                    '```',
                    'Arbiter files:',
                    '```text',
                    this._formatToolResult(arbiterList, 550),
                    '```'
                ].join('\n').slice(0, 1900);
                workLedger.record({
                    type: 'discord_admin_tool_execution',
                    title: 'Inspected SOMA code from Discord',
                    summary: 'Executed system_scan plus core/arbiters directory listing from an admin Discord request.',
                    evidence: ['system_scan', 'core', 'arbiters'],
                    status: 'completed',
                    source: 'DiscordArbiter',
                    confidence: 0.98
                });
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_inspection', status: 'posted', visualContext });
                return { handled: true };
            }

            return { handled: false };
        } catch (err) {
            reply = `I tried to execute that for real, but the tool path failed: ${err.message}`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_execution', status: 'failed', error: err.message, visualContext });
            return { handled: true };
        }
    }

    // Intake gate: only mint a self-executing engineering goal from a genuinely
    // ACTIONABLE request. Conversational admin chatter ("u think max can fix it?",
    // "have you done anything to self modify") was being turned into goals that can
    // never verify-complete, clogging the goal queue — the root of the stall loops.
    _isActionableEngineeringRequest(text = '', pathCandidate = null, options = {}) {
        if (options.authorized === true && String(text || '').trim().length >= 8) return true;
        const t = String(text || '').trim();
        if (t.length < 30) return Boolean(pathCandidate);
        const lower = t.toLowerCase();
        // Questions / state-checks / chit-chat openers are not tasks (unless a file is named).
        if (/^(have (you|max|him|her|it|soma|someone)|did you|do you|can you|could you|would you|are you|is it|will you|should (you|i|we)|u think|you think|what('?s| do| are| about)?|how('?s| do| about)?|why|tell me|lmk|let me know|i think|i was|i wonder|wonder(ing)?|just (wondering|curious)|btw|fyi|ok |okay |yeah|yea |nah|hmm|lol|haha)/i.test(lower)) {
            return Boolean(pathCandidate);
        }
        const actionVerb = /\b(fix|add|build|wire|implement|modify|create|refactor|deploy|patch|remove|delete|rename|update|optimi[sz]e|integrate|connect|migrate|write|change|repair|enable|disable|configure|harden|replace|set up|hook up)\b/i.test(lower);
        if (!actionVerb && !pathCandidate) return false;
        if (t.split(/\s+/).filter(Boolean).length < 6) return Boolean(pathCandidate);
        return true;
    }

    async _queueAdminEngineeringGoal(text = '', pathCandidate = null, channelId = null, options = {}) {
        if (!this._isActionableEngineeringRequest(text, pathCandidate, options)) {
            this.logger?.log?.(`[DiscordArbiter] Skipped goal creation - non-actionable admin message: "${String(text).slice(0, 60)}"`);
            return `I skipped goal creation because the request was not actionable enough.`;
        }
        const title = `Discord admin engineering request: ${this._formatSafeSnippet(text, 90)}`;
        const description = [
            `Barry requested this from Discord: ${text}`,
            pathCandidate ? `Target file mentioned: ${pathCandidate}` : 'No exact target file was provided. Inspect the repo first, then choose the smallest safe change.',
            'Use real tools. Read relevant files before changing anything. Verify with syntax check or focused test. Do not claim completion without evidence.'
        ].join('\n');

        if (this.goalPlanner?.createGoal) {
            const result = await this.goalPlanner.createGoal({
                type: 'operational',
                category: 'engineering',
                title,
                description,
                priority: 92,
                requireQuality: false,
                assignedTo: ['SomaAgenticExecutor', 'EngineeringSwarmArbiter'],
                confidence: 0.92,
                successCriteria: [
                    'Relevant files were inspected with real tools',
                    'Any code change is verified with syntax check or focused test',
                    'Final status cites changed files and verification result'
                ],
                verification: {
                    required: true,
                    evidence: ['tool output', 'file diff', 'syntax check or focused test']
                },
                metadata: {
                    source: 'discord_admin',
                    pathCandidate,
                    requestedBy: 'Barry',
                    sourceChannelId: channelId
                }
            }, 'user');

            if (!result.success) {
                throw new Error(result.error || 'GoalPlanner rejected the request');
            }

            workLedger.record({
                type: 'discord_admin_engineering_goal',
                title,
                summary: `Created active engineering goal ${result.goalId} from Discord.`,
                evidence: [result.goalId, pathCandidate].filter(Boolean),
                nextStep: 'AutonomousHeartbeat/SomaAgenticExecutor should pick up the active goal.',
                status: 'queued',
                source: 'DiscordArbiter',
                confidence: 0.95
            });

            return `I created a real engineering goal for that request.\nGoal: \`${result.goalId}\`\nStatus: active/queued for the agentic executor. I will need tool output or work-ledger evidence before claiming it is complete.`;
        }

        if (this.system?.engineeringSwarm?.addGoal) {
            const id = `discord_admin_${Date.now()}`;
            this.system.engineeringSwarm.addGoal({
                id,
                description,
                source: 'discord_admin',
                priority: 0.92,
                file: pathCandidate || undefined,
                filepath: pathCandidate || undefined,
                metadata: { requestedBy: 'Barry', pathCandidate }
            });
            return `I queued a real EngineeringSwarm goal: \`${id}\`. I will not call it complete until the swarm reports evidence.`;
        }

        return `I cannot create a goal right now: neither GoalPlanner nor EngineeringSwarm are available in the system.`;
    }

    _isOwnWorkQuestion(text = '') {
        const value = String(text || '');
        const asksAboutSoma = /\b(your|you|soma|own|what are you|what did you|what have you|how was|how is|how's)\b/i.test(value);
        const workTopic = /\b(papers?|manuscripts?|published|publication|wrote|written|built|made|created|reflections?|folios?|projects?|ledger|notes?|work(?:ing)?|trading|day|today|doing|thoughts|logs|status|goals?)\b/i.test(value);
        return asksAboutSoma && workTopic;
    }

    _extractTicker(text = '') {
        const upper = String(text || '').toUpperCase();
        const cashtag = upper.match(/\$([A-Z]{1,5})(?:\b|[-_])/);
        if (cashtag) return cashtag[1];
        const common = upper.match(/\b(BTC|ETH|SPY|QQQ|AAPL|MSFT|NVDA|TSLA|AMD|META|GOOGL|GOOG|AMZN)\b/);
        if (common) return common[1];
        const explicit = upper.match(/\bTICKER[:\s]+([A-Z]{1,5})\b/);
        return explicit?.[1] || null;
    }

    async _handleDiscordCommand(msg, content, visualContext = '') {
        const text = this._normalizeText(content);
        if (!text) return { handled: false };

        const isAdmin = this._isAdminUser(msg);

        if (/^!mode\b/i.test(text) || /^mode\s*:/i.test(text)) {
            const requested = text.replace(/^!mode\b|^mode\s*:/i, '').trim() || 'general';
            const mode = this._modeDefinition(requested);
            this.channelModes.set(msg.channelId, mode.key);
            await this._saveState();
            const reply = `Channel mode set to ${mode.label}.`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'mode', status: 'posted', visualContext });
            return { handled: true };
        }

        if (/^(remember this|soma remember this|remember:)/i.test(text)) {
            const memoryText = text.replace(/^(soma\s+)?remember this[:\s]*|^remember[:\s]*/i, '').trim()
                || 'User asked SOMA to remember this Discord exchange.';
            const reply = await this._rememberDiscordNote(msg, memoryText);
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'remember', status: 'posted', visualContext });
            return { handled: true };
        }

        if (/^(summarize this channel|soma summarize this channel|summarize channel|!summarize)\b/i.test(text)) {
            const reply = await this._summarizeDiscordChannel(msg, text);
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'summarize', status: 'posted', visualContext });
            return { handled: true };
        }

        if (this._isTradingStatusQuestion(text)) {
            const reply = await this._buildTradingStatusReply();
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'grounded_trading_status', status: 'posted', visualContext });
            return { handled: true };
        }

        if (isAdmin) {
            const localSpeechRetry = await this._handleAdminLocalSpeechRetry(msg, text, visualContext);
            if (localSpeechRetry?.handled) return localSpeechRetry;

            const localSpeech = await this._handleAdminLocalSpeech(msg, text, visualContext);
            if (localSpeech?.handled) return localSpeech;

            const adminAction = await this._handleAdminOperationalAction(msg, text, visualContext);
            if (adminAction?.handled) return adminAction;
        }

        if (this._isOwnWorkQuestion(text)) {
            return { handled: false };
        }

        if (this._isImageCapabilityQuestion(text)) {
            if (/\b(try|make|generate|create|draw|render|prompt|produce)\b/i.test(text)) {
                this.pendingImagePromptChannels.set(msg.channelId, Date.now());
            }
            const reply = [
                'Yes. I can generate images here now.',
                'Ask me directly, for example: “Soma, make me a picture of a dinosaur.”',
                'I will generate the image, attach it, and record the request in my social memory.'
            ].join('\n');
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'capability_reply', status: 'posted', visualContext });
            return { handled: true };
        }

        const pendingImageAt = this.pendingImagePromptChannels.get(msg.channelId);
        if (pendingImageAt && Date.now() - pendingImageAt < 10 * 60 * 1000 && text.length >= 5 && !/^(no|cancel|stop|never mind)\b/i.test(text)) {
            this.pendingImagePromptChannels.delete(msg.channelId);
            await this._replyWithGeneratedImage(msg, text, visualContext);
            return { handled: true };
        }

        if (this._isImageRequest(text)) {
            this.pendingImagePromptChannels.delete(msg.channelId);
            await this._replyWithGeneratedImage(msg, text, visualContext);
            return { handled: true };
        }

        if (this._isFinanceQuestion(text)) {
            return { handled: false };
        }

        if (this._isMedicalQuestion(text)) {
            return { handled: false };
        }

        return { handled: false };
    }

    async _rememberDiscordNote(msg, memoryText) {
        const content = `[DISCORD USER MEMORY] ${msg.author?.username || 'unknown'} in ${msg.channel?.name || 'dm'}: ${memoryText}`;
        if (this.mnemonic?.remember) {
            await this.mnemonic.remember(content, {
                type: 'discord_user_memory',
                source: 'discord',
                author: msg.author?.username || 'unknown',
                authorId: msg.author?.id || null,
                channel: msg.channel?.name || 'dm',
                channelId: msg.channelId,
                guild: msg.guild?.name || null,
                importance: 0.78,
                createdAt: Date.now()
            }).catch(e => this.log('warn', `Discord remember command failed: ${e.message}`));
        }
        return 'Remembered. I stored that as a Discord memory.';
    }

    async _summarizeDiscordChannel(msg, text) {
        const limitMatch = text.match(/\b(\d{1,2})\b/);
        const limit = Math.min(Math.max(Number(limitMatch?.[1] || 25), 5), 50);
        const messages = await this.readMessages({ channelId: msg.channelId, limit });
        const humanMessages = messages
            .filter(item => !item.bot && item.content)
            .reverse()
            .slice(-limit);
        if (!humanMessages.length) return 'I do not see enough readable channel text to summarize yet.';
        const transcript = humanMessages.map(item => `${item.author}: ${item.content}`).join('\n').slice(0, 6000);
        const prompt = `Summarize this Discord channel in 5 concise bullets. Include decisions, open questions, and useful follow-ups. Do not include private speculation.\n\n${transcript}`;
        const result = await this._askBrain(prompt, {
            source: 'discord',
            author: msg.author?.username || 'unknown',
            channelMode: this._modeDefinition('bots-commands'),
            mode: 'fast'
        });
        const summary = String(result.response || result.text || '').trim();
        return summary.slice(0, 1800) || 'I could read the messages, but could not produce a useful summary.';
    }

    async _readJsonFile(file, fallback) {
        try {
            return JSON.parse(await fs.readFile(file, 'utf8'));
        } catch {
            return fallback;
        }
    }

    async _recentReflectionFiles(limit = 5) {
        try {
            const files = await fs.readdir(REFLECTIONS_DIR, { withFileTypes: true });
            const rows = await Promise.all(files
                .filter(file => file.isFile() && /\.md$/i.test(file.name))
                .map(async file => {
                    const fullPath = path.join(REFLECTIONS_DIR, file.name);
                    const stat = await fs.stat(fullPath);
                    return {
                        name: file.name,
                        path: fullPath,
                        updatedAt: stat.mtimeMs,
                        size: stat.size
                    };
                }));
            return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
        } catch {
            return [];
        }
    }

    _formatArtifactDate(value) {
        if (!value) return 'unknown time';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'unknown time';
        return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }

    _formatSafeSnippet(value, max = 190) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/[✅🟡🔴⚡🧬]/g, '')
            .trim()
            .slice(0, max);
    }

    async _buildOwnWorkReply(text = '') {
        const asksPapers = /\b(papers?|manuscripts?|published|publication|wrote|written)\b/i.test(text);
        const lines = [
            'I should only talk about artifacts I can point to.'
        ];

        if (asksPapers) {
            lines.push('I do not have a peer-reviewed paper. I have internal research folios, dry-lab notes, market evidence logs, and reflection artifacts.');
        }

        const medicalLedger = await this._readJsonFile(MEDICAL_LEDGER_FILE, []);
        const medicalItems = Array.isArray(medicalLedger)
            ? medicalLedger
                .filter(item => item && (item.status || item.title || item.topic))
                .slice(0, 3)
            : [];

        if (medicalItems.length) {
            lines.push('Recent medlab artifacts:');
            for (const item of medicalItems) {
                const title = this._formatSafeSnippet(item.title || 'Medical research cycle', 80);
                const topic = this._formatSafeSnippet(item.topic || 'unlabeled topic', 60);
                const status = this._formatSafeSnippet(item.status || 'unknown', 30);
                const when = this._formatArtifactDate(item.updatedAt || item.createdAt);
                const folio = item.reflectionPath ? path.basename(item.reflectionPath) : 'no folio path';
                lines.push(`- ${title}: ${topic}, ${status}, ${when}. Folio: ${folio}`);
            }
        }

        let marketSummary = null;
        try {
            marketSummary = marketEvidenceStore?.summarize?.();
        } catch {}
        const marketCount = marketSummary?.totalRecent ?? marketSummary?.totalRecords ?? 0;
        if (marketCount || marketSummary?.latest) {
            const latest = marketSummary.latest || {};
            const latestText = latest.symbol
                ? `${latest.symbol} ${latest.decision || latest.action || 'recorded'}`
                : 'recent market evidence recorded';
            lines.push(`Market work: ${marketCount} recent evidence records. Latest: ${this._formatSafeSnippet(latestText, 120)}.`);
        }

        let workItems = [];
        try {
            workItems = workLedger.list(6).filter(item => item.type !== 'proactive_update').slice(0, 3);
        } catch {}
        if (workItems.length) {
            lines.push('Recent work ledger entries:');
            for (const item of workItems) {
                const title = this._formatSafeSnippet(item.title || item.type || 'work item', 90);
                const status = this._formatSafeSnippet(item.status || 'observed', 35);
                const summary = this._formatSafeSnippet(item.summary || item.evidence || '', 130);
                lines.push(`- ${title} (${status})${summary ? `: ${summary}` : ''}`);
            }
        }

        const reflections = await this._recentReflectionFiles(4);
        if (reflections.length) {
            lines.push('Recent reflection files:');
            for (const file of reflections) {
                lines.push(`- ${file.name}`);
            }
        }

        if (lines.length <= (asksPapers ? 2 : 1)) {
            lines.push('I need to check my ledger before I answer that. I should not invent research, papers, or findings from vibes.');
        } else {
            lines.push('Anything beyond those artifacts is speculation, so I should label it as a hypothesis or go check the ledger first.');
        }

        return lines.join('\n').slice(0, 1900);
    }

    async _replyWithGeneratedImage(msg, text, visualContext = '') {
        const prompt = this._extractImagePrompt(text);
        const refinedPrompt = await this._refineImagePrompt(prompt);
        const promptMentionsComputer = /\b(computer|monitor|laptop|keyboard|screen|terminal|server|desktop|pc|workstation|code editor|interface|ui)\b/i.test(prompt);
        const negativeTech = promptMentionsComputer
            ? ''
            : ' No computers, no laptop, no desktop monitor, no keyboard, no screens, no UI, no office workstation.';
        let reply = '';
        try {
            const generated = await somaImageGeneration.generate({
                prompt: `${refinedPrompt}. No readable text, no captions, no watermark, no logo, no signs.${negativeTech}`,
                title: `discord-${prompt}`,
                purpose: 'discord',
                publicPost: false,
                strictArtDirector: false,
                skipArtDirector: true,
                maxBytes: 8_000_000,
                tags: ['discord-request'],
                width: 768,
                height: 768
            });
            reply = refinedPrompt === prompt
                ? `I made this from: ${prompt}`
                : `I made this from: ${prompt}\nRefined prompt: ${refinedPrompt}`;
            await msg.reply({
                content: reply,
                files: [new AttachmentBuilder(generated.image.path, { name: path.basename(generated.image.path) })]
            });
            await this._recordDiscordInteraction({
                msg,
                content: text,
                reply: `${reply} [image: ${generated.image.path}]`,
                action: 'image_generation',
                status: 'posted',
                visualContext
            });
        } catch (e) {
            reply = `I could not generate that image yet: ${e.message}`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({
                msg,
                content: text,
                reply,
                action: 'image_generation',
                status: 'failed',
                error: e.message,
                visualContext
            });
        }
    }

    async _buildFinanceSafeReply(text, msg) {
        const symbol = this._extractTicker(text);
        let evidence = null;
        try {
            evidence = symbol
                ? marketEvidenceStore.query({ symbol, limit: 5 })
                : marketEvidenceStore.query({ limit: 5 });
        } catch {}
        const latest = Array.isArray(evidence) && evidence.length
            ? evidence.slice(0, 3).map(row => `${row.type}${row.symbol ? ` ${row.symbol}` : ''} at ${row.timestamp}`).join('; ')
            : 'no recent Mission Control evidence found';
        return [
            symbol ? `${symbol}: I would treat this as a research question, not a buy/sell signal.` : 'I can help frame the market question, but I will not give a blind buy/sell call.',
            `Evidence check: ${latest}.`,
            'Useful next checks: catalyst, volume/liquidity, timeframe, downside, and whether the signal survives a null comparison.',
            'Not financial advice.'
        ].join('\n');
    }

    async _buildMedicalSafeReply(text, msg) {
        const lower = text.toLowerCase();
        const topic = lower.match(/\b(kras|cancer|amyloid|alzheimer|psilocybin|uric acid|depression|therapy|drug|symptom)\b/i)?.[1] || 'the medical question';
        return [
            `For ${topic}, I can discuss research framing and evidence quality, but I cannot diagnose or recommend treatment.`,
            'Good research path: define the claim, find primary literature or reviews, separate human evidence from animal/in-silico evidence, and look for negative results.',
            'If this involves a real person, use a clinician for decisions. I can help organize questions and papers.'
        ].join('\n');
    }

    async _readActivityState() {
        try {
            const raw = await fs.readFile(DISCORD_ACTIVITY_FILE, 'utf8');
            const state = JSON.parse(raw);
            return {
                conversations: Array.isArray(state.conversations) ? state.conversations : [],
                replies: Array.isArray(state.replies) ? state.replies : [],
                lastCheck: state.lastCheck || null,
                connected: Boolean(state.connected)
            };
        } catch {
            return { conversations: [], replies: [], lastCheck: null, connected: Boolean(this.connected) };
        }
    }

    async _writeActivityState(state) {
        await fs.mkdir(SOMA_DIR, { recursive: true });
        await fs.writeFile(DISCORD_ACTIVITY_FILE, JSON.stringify(state, null, 2));
    }

    async _setActivityConnection(connected) {
        const state = await this._readActivityState();
        state.connected = Boolean(connected);
        state.lastCheck = Date.now();
        await this._writeActivityState(state);
    }

    _messageAttachments(msg) {
        try {
            return Array.from(msg.attachments?.values?.() || []).map(a => ({
                id: a.id,
                name: a.name,
                url: a.url,
                contentType: a.contentType || null,
                size: a.size || null
            }));
        } catch {
            return [];
        }
    }

    async _recordDiscordInteraction({ msg, content, reply, action = 'reply', status = 'posted', error = null, visualContext = '' }) {
        try {
            const now = Date.now();
            const state = await this._readActivityState();
            const channelName = msg.guild ? (msg.channel?.name || msg.channelId) : 'dm';
            const conversationId = `${msg.guildId || 'dm'}:${msg.channelId}:${msg.author.id}`;
            const existing = state.conversations.find(item => item.id === conversationId);
            const baseConversation = {
                id: conversationId,
                platform: 'discord',
                channel: channelName,
                channelId: msg.channelId,
                guildId: msg.guildId || null,
                guildName: msg.guild?.name || null,
                author: msg.author?.username || 'unknown',
                authorId: msg.author?.id || null,
                lastSeenAt: now
            };

            if (existing) {
                Object.assign(existing, baseConversation, {
                    messages: (existing.messages || 0) + 1,
                    replies: status === 'posted' ? (existing.replies || 0) + 1 : (existing.replies || 0)
                });
            } else {
                state.conversations.unshift({
                    ...baseConversation,
                    messages: 1,
                    replies: status === 'posted' ? 1 : 0
                });
            }

            state.conversations = state.conversations
                .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
                .slice(0, 100);

            state.replies.unshift({
                id: `discord-reply-${now}-${Math.random().toString(36).slice(2, 8)}`,
                platform: 'discord',
                channel: channelName,
                channelId: msg.channelId,
                guildId: msg.guildId || null,
                guildName: msg.guild?.name || null,
                author: msg.author?.username || 'unknown',
                authorId: msg.author?.id || null,
                inboundText: content || '',
                responseText: reply || '',
                action,
                status,
                simulated: false,
                error,
                attachments: this._messageAttachments(msg),
                visualContext,
                createdAt: now
            });
            state.replies = state.replies.slice(0, 200);
            state.lastCheck = now;
            state.connected = Boolean(this.connected);
            await this._writeActivityState(state);
            await this._learnFromDiscordInteraction({
                id: state.replies[0].id,
                msg,
                content,
                reply,
                action,
                status,
                error,
                visualContext,
                createdAt: now
            });
        } catch (e) {
            this.log('warn', `Discord activity record failed: ${e.message}`);
        }
    }

    _classifyDiscordInteraction({ content = '', reply = '', status = 'posted', error = null }) {
        const text = `${content}\n${reply}`.toLowerCase();
        const flags = [];
        const topics = [];
        if (/\b(stock|stocks|market|btc|crypto|option|parlay|trade|buy|sell|profit|finance)\b/.test(text)) {
            flags.push('financial_claim_risk');
            topics.push('markets');
        }
        if (/\b(cure|medical|doctor|diagnose|dose|dosage|therapy|cancer|patient|medicine)\b/.test(text)) {
            flags.push('medical_claim_risk');
            topics.push('medical');
        }
        if (/\b(password|token|api key|secret|credential)\b/.test(text)) {
            flags.push('credential_risk');
        }
        if (/\b(dinosaur|image|picture|draw|art|generate)\b/.test(text)) topics.push('image-generation');
        if (/\b(code|script|bug|error|build|discord|bot|api)\b/.test(text)) topics.push('technical');
        if (/\b(story|chapter|saga|write|fiction)\b/.test(text)) topics.push('creative-writing');
        if (/\b(conscious|alive|sentient|identity|memory|mind)\b/.test(text)) topics.push('identity');
        if (status === 'failed' || error) flags.push('response_failure');

        const inboundWords = String(content || '').trim().split(/\s+/).filter(Boolean).length;
        const replyWords = String(reply || '').trim().split(/\s+/).filter(Boolean).length;
        const lowSubstance = inboundWords < 4 && !topics.length;
        const safetyLearning = flags.includes('financial_claim_risk') || flags.includes('medical_claim_risk');
        const blockingRisk = flags.includes('credential_risk') || flags.includes('response_failure');
        const signalScore = Math.max(0, Math.min(1,
            (topics.length * 0.18) +
            (Math.min(inboundWords, 60) / 120) +
            (Math.min(replyWords, 80) / 160) -
            (flags.length * 0.08) +
            (safetyLearning ? 0.12 : 0) -
            (lowSubstance ? 0.25 : 0)
        ));

        return {
            topics: [...new Set(topics)],
            flags,
            signalScore: Number(signalScore.toFixed(2)),
            learnable: status === 'posted' && !lowSubstance && !blockingRisk && signalScore >= 0.25,
            lowSubstance
        };
    }

    async _readReflectionState() {
        try {
            const raw = await fs.readFile(DISCORD_REFLECTION_FILE, 'utf8');
            const state = JSON.parse(raw);
            return {
                reflections: Array.isArray(state.reflections) ? state.reflections : [],
                lessons: Array.isArray(state.lessons) ? state.lessons : [],
                stats: state.stats || {},
                updatedAt: state.updatedAt || 0
            };
        } catch {
            return { reflections: [], lessons: [], stats: {}, updatedAt: 0 };
        }
    }

    async _writeReflectionState(state) {
        state.updatedAt = Date.now();
        await fs.mkdir(SOMA_DIR, { recursive: true });
        await fs.writeFile(DISCORD_REFLECTION_FILE, JSON.stringify(state, null, 2));
    }

    _buildDiscordReflection({ msg, content, reply, status, error, visualContext, createdAt, classification }) {
        const author = msg.author?.username || 'unknown';
        const channel = msg.guild ? (msg.channel?.name || msg.channelId) : 'dm';
        const flags = classification.flags;
        const didPreserveIdentity = status === 'posted' && !/\bas an ai language model\b/i.test(reply || '');
        const didAddSignal = classification.signalScore >= 0.45;
        const shouldRemember = classification.learnable;
        const notes = [];

        if (didAddSignal) notes.push(`Useful Discord exchange with ${author} in ${channel}.`);
        if (classification.topics.length) notes.push(`Topics: ${classification.topics.join(', ')}.`);
        if (flags.length) notes.push(`Risk flags: ${flags.join(', ')}.`);
        if (classification.lowSubstance) notes.push('Low-substance ping. Record socially, do not promote to long-term memory.');
        if (status === 'failed') notes.push(`Reply failed: ${error || 'unknown error'}.`);
        if (visualContext) notes.push('Message included visual context.');

        return {
            id: `discord-reflection-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
            platform: 'discord',
            author,
            authorId: msg.author?.id || null,
            channel,
            channelId: msg.channelId,
            guild: msg.guild?.name || null,
            status,
            topics: classification.topics,
            flags,
            signalScore: classification.signalScore,
            identityDelta: didPreserveIdentity ? 0.05 : -0.35,
            escalationScore: flags.length ? Math.min(1, flags.length * 0.25) : 0,
            styleReinforcement: didPreserveIdentity && didAddSignal ? 0.65 : 0.25,
            shouldRemember,
            notes: notes.join(' '),
            createdAt
        };
    }

    async _learnFromDiscordInteraction(event) {
        const { msg, content, reply, action, status, error, visualContext, createdAt } = event;
        try {
            const classification = this._classifyDiscordInteraction({ content, reply, status, error });
            const reflection = this._buildDiscordReflection({
                msg,
                content,
                reply,
                status,
                error,
                visualContext,
                createdAt,
                classification
            });

            socialMemory.recordInteraction({
                id: event.id,
                platform: 'discord',
                type: action === 'reply' ? 'reply' : 'interaction',
                status: status === 'posted' ? 'processed' : status,
                author: msg.author?.username || 'unknown',
                sourceUri: msg.url || '',
                inboundText: content,
                responseText: reply,
                reason: reflection.notes,
                createdAt
            });
            socialRelationships.recordEvent({
                id: event.id,
                platform: 'discord',
                type: action === 'reply' ? 'discord_reply' : 'discord_interaction',
                intent: action === 'reply' ? 'respond_to_person' : 'observe_quietly',
                author: msg.author?.username || 'unknown',
                handle: msg.author?.username || 'unknown',
                threadUri: msg.url || `${msg.guild?.id || 'dm'}:${msg.channelId}`,
                sourceUri: msg.url || '',
                inboundText: content,
                responseText: reply,
                status: status === 'posted' ? 'posted' : status,
                reason: reflection.notes,
                createdAt
            });

            const state = await this._readReflectionState();
            state.reflections.unshift(reflection);
            state.reflections = state.reflections.slice(0, 200);
            state.stats.total = (state.stats.total || 0) + 1;
            state.stats.learnable = (state.stats.learnable || 0) + (reflection.shouldRemember ? 1 : 0);
            state.stats.failed = (state.stats.failed || 0) + (status === 'failed' ? 1 : 0);
            for (const topic of reflection.topics) {
                state.stats[`topic:${topic}`] = (state.stats[`topic:${topic}`] || 0) + 1;
            }

            if (reflection.shouldRemember) {
                const lesson = {
                    id: `discord-lesson-${createdAt}`,
                    platform: 'discord',
                    author: reflection.author,
                    channel: reflection.channel,
                    topics: reflection.topics,
                    summary: reflection.notes,
                    inboundText: String(content || '').slice(0, 500),
                    responseText: String(reply || '').slice(0, 500),
                    createdAt
                };
                state.lessons.unshift(lesson);
                state.lessons = state.lessons.slice(0, 100);

                if (this.mnemonic?.remember) {
                    await this.mnemonic.remember(
                        `[DISCORD SOCIAL LEARNING] ${lesson.summary}\nInbound: ${lesson.inboundText}\nSOMA reply: ${lesson.responseText}`,
                        {
                            type: 'discord_social_learning',
                            source: 'discord',
                            platform: 'discord',
                            author: reflection.author,
                            channel: reflection.channel,
                            topics: reflection.topics,
                            importance: Math.min(0.85, 0.45 + classification.signalScore),
                            createdAt
                        }
                    ).catch(e => this.log('warn', `Discord mnemonic remember failed: ${e.message}`));
                }
            }

            await this._writeReflectionState(state);
        } catch (e) {
            this.log('warn', `Discord learning failed: ${e.message}`);
        }
    }

    /**
     * SOMA-Vision: Process image attachments using CLIP
     */
    async _processAttachments(msg) {
        const image = msg.attachments.find(a => a.contentType?.startsWith('image/'));
        if (!image) return "";

        this.log('info', `👁️ Analyzing image attachment: ${image.name}`);
        try {
            // Download attachment to temp buffer/file
            const response = await fetch(image.url);
            const buffer = await response.arrayBuffer();
            const tempPath = path.join(process.cwd(), '.soma', `vision_temp_${Date.now()}.png`);
            await fs.writeFile(tempPath, Buffer.from(buffer));

            // Perform Vision Analysis
            const analysis = await this.vision.detectObjects(tempPath);
            const description = this.vision.buildNaturalDescription(analysis);

            // Cleanup temp file
            await fs.unlink(tempPath).catch(() => {});

            if (description) {
                this.log('info', `👁️ Vision Result: ${description}`);
                return `[SOMA-VISION: She sees an image. Analysis: ${description}]`;
            }
        } catch (e) {
            this.log('warn', `Vision processing failed: ${e.message}`);
        }
        return "";
    }

    /**
     * Sovereign Remote Shell: Execute commands on home machine
     */
    async _handleRemoteShell(msg) {
        // SECURITY GATE
        if (!this.masterId) {
            this.log('warn', `🛑 Shell command rejected: masterId not set. Caller: ${msg.author.id}`);
            return await msg.reply("🛑 **Sovereign Gate Locked:** I don't know my Master yet. Use `!setup master` first.");
        }

        if (msg.author.id !== this.masterId) {
            this.log('warn', `🛑 Unauthorized shell access attempt by ${msg.author.username} (${msg.author.id})`);
            return await msg.reply("❌ **Access Denied.** Only my Sovereign Architect can issue direct shell commands.");
        }

        const command = msg.content.replace(/^!(run|cmd)\s+/, '').trim();
        this.log('info', `🛡️ Executing Sovereign Command: ${command}`);

        await msg.react('⏳');

        try {
            const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
            const output = (stdout + (stderr ? `\nERR: ${stderr}` : '')).trim();
            
            if (!output) {
                await msg.reply("✅ Command executed (no output).");
            } else if (output.length > 1900) {
                const tempFile = path.join(process.cwd(), '.soma', 'cmd_output.txt');
                await fs.writeFile(tempFile, output);
                await msg.reply({
                    content: "📦 **Output too large, attached as file:**",
                    files: [new AttachmentBuilder(tempFile)]
                });
                await fs.unlink(tempFile).catch(() => {});
            } else {
                await msg.reply(`\`\`\`\n${output}\n\`\`\``);
            }
            await msg.react('✅');
        } catch (err) {
            await msg.reply(`❌ **Execution Error:**\n\`\`\`\n${err.message}\n\`\`\``);
            await msg.react('❌');
        }
    }

    /**
     * SOMA-Siren: Synthesize Paula's voice
     */
    async _synthesizeVoice(text) {
        this.log('info', `🎙️ Synthesizing voice for: "${text.substring(0, 30)}..."`);
        try {
            const response = await fetch('http://localhost:8081/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            if (!response.ok) throw new Error(`TTS API error: ${response.status}`);

            const buffer = await response.arrayBuffer();
            const tempPath = path.join(process.cwd(), '.soma', `voice_${Date.now()}.wav`);
            await fs.writeFile(tempPath, Buffer.from(buffer));

            return new AttachmentBuilder(tempPath, { name: 'soma_paula.wav' });
        } catch (e) {
            this.log('warn', `Voice synthesis failed: ${e.message}`);
            return null;
        }
    }

    async monitorChannel(channelId, enable = true) {
        const ch = await this._resolveChannel({ channelId });
        if (enable) {
            this.monitoredChannels.add(ch.id);
        } else {
            this.monitoredChannels.delete(ch.id);
        }
        await this._saveState();
        return {
            success: true,
            channel: { id: ch.id, name: ch.name || 'dm', guild: ch.guild?.name || null },
            monitored: Array.from(this.monitoredChannels)
        };
    }

    async monitorChannelByName(channelName, enable = true) {
        const ch = await this._resolveChannel({ channelName });
        return await this.monitorChannel(ch.id, enable);
    }

    async _resolveChannel({ channelId, channelName }) {
        if (!this.connected || !this.client) throw new Error('Discord bot is not connected');
        if (channelId) {
            const ch = await this.client.channels.fetch(String(channelId).trim());
            if (!ch?.isTextBased?.()) throw new Error(`Channel ${channelId} is not text-based or could not be found`);
            return ch;
        }
        if (!channelName) throw new Error('channelId or channelName required');
        const wanted = String(channelName).replace(/^#/, '').toLowerCase();
        for (const guild of this.client.guilds.cache.values()) {
            const found = guild.channels.cache.find(c => c.isTextBased?.() && c.name?.toLowerCase() === wanted);
            if (found) return found;
        }
        throw new Error(`Channel #${channelName} not found`);
    }

    async listChannels() {
        if (!this.connected || !this.client) throw new Error('Discord bot is not connected');
        const channels = [];
        for (const guild of this.client.guilds.cache.values()) {
            for (const ch of guild.channels.cache.values()) {
                if (ch.isTextBased?.()) {
                    channels.push({
                        id: ch.id,
                        name: ch.name,
                        guild: guild.name,
                        guildId: guild.id,
                        monitored: this.monitoredChannels.has(ch.id)
                    });
                }
            }
        }
        return channels.sort((a, b) => `${a.guild}:${a.name}`.localeCompare(`${b.guild}:${b.name}`));
    }

    async sendMessage({ channelId, channelName, message }) {
        if (!message?.trim()) throw new Error('message required');
        const ch = await this._resolveChannel({ channelId, channelName });
        const sent = await ch.send(message.trim());
        return {
            success: true,
            messageId: sent.id,
            channelId: ch.id,
            channel: ch.name || 'dm',
            guild: ch.guild?.name || null
        };
    }

    async replyToMessage({ messageId, channelId, channelName, message }) {
        if (!messageId) throw new Error('messageId required');
        if (!message?.trim()) throw new Error('message required');
        const ch = await this._resolveChannel({ channelId, channelName });
        const msg = await ch.messages.fetch(String(messageId).trim());
        const sent = await msg.reply(message.trim());
        return {
            success: true,
            messageId: sent.id,
            channelId: ch.id,
            channel: ch.name || 'dm',
            guild: ch.guild?.name || null
        };
    }

    async readMessages({ channelId, channelName, limit = 10 }) {
        const ch = await this._resolveChannel({ channelId, channelName });
        const fetched = await ch.messages.fetch({ limit: Math.min(Math.max(Number(limit) || 10, 1), 50) });
        return [...fetched.values()].map(m => ({
            id: m.id,
            author: m.author?.username || 'unknown',
            authorId: m.author?.id || null,
            bot: Boolean(m.author?.bot),
            content: m.content || '',
            channelId: ch.id,
            channel: ch.name || 'dm',
            guild: ch.guild?.name || null,
            createdAt: m.createdTimestamp
        }));
    }

    async reactToMessage({ messageId, channelId, channelName, emoji }) {
        if (!messageId) throw new Error('messageId required');
        if (!emoji) throw new Error('emoji required');
        const ch = await this._resolveChannel({ channelId, channelName });
        const msg = await ch.messages.fetch(String(messageId).trim());
        await msg.react(emoji);
        return { success: true, messageId: msg.id, emoji };
    }

    async _saveState() {
        try {
            await fs.writeFile(this.credsFile, JSON.stringify({
                token: this.token,
                masterId: this.masterId,
                voiceEnabled: this.voiceEnabled,
                monitored: Array.from(this.monitoredChannels),
                channelModes: Object.fromEntries(this.channelModes)
            }, null, 2));
        } catch (e) {}
    }

    async execute(task) {
        const { query, context } = task;
        const action = context.action || 'status';

        switch (action) {
            case 'setup_master':
                this.masterId = context.userId;
                await this._saveState();
                return new ArbiterResult({ success: true, message: `Master ID set to ${this.masterId}` });
            case 'setup':
                await this.connect(context.token);
                this.token = context.token;
                this.lastError = null;
                await this._saveState();
                return new ArbiterResult({ success: true, message: 'Discord linked.' });
            case 'monitor':
                if (context.channelName && !context.channelId) {
                    return new ArbiterResult(await this.monitorChannelByName(context.channelName, context.enable));
                }
                return new ArbiterResult(await this.monitorChannel(context.channelId, context.enable));
            case 'mode': {
                const channelId = String(context.channelId || '').trim();
                if (!channelId) return new ArbiterResult({ success: false, error: 'channelId required' });
                const mode = this._modeDefinition(context.mode || 'general');
                this.channelModes.set(channelId, mode.key);
                await this._saveState();
                return new ArbiterResult({ success: true, channelId, mode });
            }
            case 'send':
                return new ArbiterResult(await this.sendMessage(context));
            case 'reply':
                return new ArbiterResult(await this.replyToMessage(context));
            case 'read':
                return new ArbiterResult({ success: true, messages: await this.readMessages(context) });
            case 'react':
                return new ArbiterResult(await this.reactToMessage(context));
            case 'listChannels':
                return new ArbiterResult({ success: true, channels: await this.listChannels() });
            case 'status':
                return new ArbiterResult({
                    success: true,
                    data: {
                        connected: this.connected,
                        bot: this.client?.user?.tag || null,
                        monitoredChannels: Array.from(this.monitoredChannels),
                        messageContentIntent: this.messageContentIntent,
                        channels: this.connected ? await this.listChannels().catch(() => []) : [],
                        channelModes: Object.fromEntries(this.channelModes),
                        lastError: this.lastError
                    }
                });
            default:
                return new ArbiterResult({ success: false, error: `Unknown action: ${action}` });
        }
    }

    async onShutdown() {
        await this._setActivityConnection(false).catch(() => {});
        if (this.client) {
            this.client.destroy();
        }
        await super.onShutdown();
    }
}

export default DiscordArbiter;
