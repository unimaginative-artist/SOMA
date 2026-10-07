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
import { eligiblePaperTrade, isBeeStrategy } from '../server/finance/TradeEvidenceScope.js';
import { recordLoopEvent, readLoopLedger } from '../server/utils/LoopLedger.js';
import { getHomePresenceProfile, recordHomePresenceOutcome } from '../server/utils/HomePresenceMemory.js';
import outboundAutonomyGate from '../core/OutboundAutonomyGate.js';
import blueskyReviewService from '../server/social/BlueskyReviewService.js';
import { classifyPersistentTask, extractFileSearchRequest, isExplicitGoalAuthorization, taskOutputHint } from '../server/discord/DiscordTaskRouter.js';
import { isContextualFollowup, resolveContextualTask, workflowForTask } from '../server/discord/TypedGoalWorkflow.js';
import { analyzeImageFileTwoStage, isImageFile } from '../server/utils/LocalVisionFileAnalyzer.js';
import { DiscordConversationJobStore } from '../server/discord/DiscordConversationJobStore.js';
import { inspectGeneratedImage, verifyDiscordImageDelivery, persistImageReceipt } from '../server/discord/DiscordImageArtifact.js';
import { isDiscordWorkStatusRequest, isDiscordSourceInspection, needsDiscordOperationalContext, isDiscordImprovementStatusRequest, isDiscordImprovementResearchRequest, classifyTurnIntent, INTENT_TYPES, isDiscordFeedbackOrCritique, isDiscordStatusOrCapabilityQuestion } from '../server/discord/DiscordTurnPolicy.js';
import { improvementStatusReply, isCodebaseInspectionRequest, isMaxFolderInspectionRequest, inspectProjectFolder, resolveInspectionProject, inspectImprovementCodebase } from '../server/discord/DiscordOperationalEvidence.js';
import { inspectDiscordSource } from '../server/discord/DiscordSourceInspection.js';
import { extractDiscordPaths, resolveDiscordWorkspaceFile, preflightDiscordEngineering } from '../server/discord/DiscordWorkspaceFiles.js';
import { globalCognitiveMoERouter, MOE_LANES } from '../core/CognitiveMoERouter.js';
import { createInspectionGoal, simpleInspectionAction, isPastedCode, TASK_STATES, formatProgressMessage } from '../core/ExecutionProtocol.js';
import discordVoiceGateway from '../core/DiscordVoiceGateway.js';
import { isBreezyBacktestRequest, isBreezyBacktestApproval, isDirectedBacktestRequest } from '../server/discord/DiscordBeeTaskPolicy.js';
import { findChannelBeeBacktest, queueBreezyBacktest, redactBacktestText } from '../server/discord/DiscordBeeBacktestJob.js';
import { guardUnverifiedExecutionReply } from '../server/discord/DiscordExecutionClaimGuard.js';
import simToLiveDaemon from '../server/finance/SimToLiveDaemon.js';
import { DiscordLiveCandidateApproval } from '../server/finance/DiscordLiveCandidateApproval.js';

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
            String(opts.adminUsernames || process.env.DISCORD_ADMIN_USERNAMES || 'owner')
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
        this._goalProgressTimers = new Map();
        this._goalProgressMessages = new Map();
        this._channelProgressMode = new Map();
        this._conversationAbortControllers = new Map();
        this._sourceInspectionBySession = new Map();
        this.attachmentAnalyzer = opts.attachmentAnalyzer || analyzeImageFileTwoStage;
        this.imageReceiptRoot = opts.imageReceiptRoot || process.cwd();
        this.beeLedgerPath = opts.beeLedgerPath || path.join(process.cwd(), 'data', 'trading', 'soma_bee_ledger.json');
        this.blueskyReviewService = opts.blueskyReviewService || blueskyReviewService;
        this.conversationJobs = opts.conversationJobs || new DiscordConversationJobStore();
        this._liveApprovalTimer = null;
        this._liveCandidateApprovals = null;
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
                messageBroker.subscribe('soma_proactive', async (envelope) => {
                    const payload = envelope.payload || envelope;
                    const msgText = payload.message;
                    if (msgText) {
                        const source = payload.source || envelope.from || 'unknown';
                        const kind = payload.kind || (source === 'trading_notifications' ? 'trading_alert' : 'unknown');
                        if (kind === 'reflection') {
                            this.log('info', `Internal reflection recorded, skipping Discord DM delivery.`);
                            return;
                        }
                        const receiptIsValid = outboundAutonomyGate.validatesReceipt(payload.gateReceipt, { message: msgText, source, kind });
                        const verdict = receiptIsValid
                            ? { allowed: true, text: msgText }
                            : outboundAutonomyGate.evaluate({ message: msgText, source, kind, verified: payload.verified === true, evidence: payload.evidence || null });
                        if (verdict.allowed) {
                            const delivery = await this.sendMasterMessage(verdict.text, { receipt: true });
                            if (payload.deliveryAckRequested) {
                                if (!delivery?.sent) throw new Error('Discord DM delivery was not verified');
                                payload.deliveryReceipt = delivery;
                            }
                        }
                        else this.log('info', `Suppressed proactive message: ${verdict.receipt.reason}`);
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

        if (this._liveApprovalTimer) clearInterval(this._liveApprovalTimer);
        this._liveApprovalTimer = null;

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
                this._setupLiveCandidateApprovals();
                setTimeout(() => this._recoverPendingConversationJobs().catch(error =>
                    this.log('warn', `Discord conversation recovery failed: ${error.message}`)
                ), 1500).unref?.();
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

    _setupLiveCandidateApprovals() {
        this._liveCandidateApprovals = new DiscordLiveCandidateApproval({
            client: this.client, masterId: this.masterId,
            maxBridge: this.system?.maxBridge
        });
        const refresh = () => {
            this._liveCandidateApprovals.masterId = String(this.masterId || '');
            this._liveCandidateApprovals.maxBridge = this.system?.maxBridge;
            const report = simToLiveDaemon.readReport();
            if (report) this._liveCandidateApprovals.notifyFromReport(report)
                .catch(error => this.log('warn', `Live candidate Discord review pending: ${error.message}`));
        };
        refresh();
        this._liveApprovalTimer = setInterval(refresh, 5 * 60_000);
        this._liveApprovalTimer.unref?.();
        this.client.on('interactionCreate', async interaction => {
            if (!interaction.isButton?.() || !interaction.customId?.startsWith('soma-live-review:')) return;
            try {
                await interaction.deferReply({ ephemeral: true });
                if (interaction.message?.author?.id !== this.client.user?.id) {
                    await interaction.editReply('This approval message did not come from SOMA.');
                    return;
                }
                this._liveCandidateApprovals.masterId = String(this.masterId || '');
                const result = await this._liveCandidateApprovals.decide({
                    customId: interaction.customId,
                    userId: interaction.user?.id,
                    messageId: interaction.message?.id,
                    channelId: interaction.channelId
                });
                if (result.accepted) {
                    await interaction.message.edit({
                        content: `${interaction.message.content}\n\n**Decision: ${result.decision.decision.toUpperCase()}** by the configured owner. Live trading remains stopped.`,
                        components: []
                    }).catch(() => {});
                    await interaction.editReply(result.decision.decision === 'approved'
                        ? 'Candidate approved for this exact evidence. Trading remains stopped; no live orders were authorized.'
                        : 'Candidate rejected. No trading state changed.');
                } else {
                    await interaction.editReply(result.reason || 'Approval could not be recorded.');
                }
            } catch (error) {
                this.log('error', `Live candidate Discord decision failed: ${error.message}`);
                if (interaction.deferred) await interaction.editReply('Decision failed and was not confirmed.').catch(() => {});
            }
        });
    }

    async sendMasterMessage(message, { receipt = false } = {}) {
        message = this._stripModelArtifacts(message) || message;
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
                const delivered = await user.send(message);
                this.log('info', `Sent DM to master (${this.masterId}): "${message.substring(0, 60)}..."`);
                return receipt ? { sent: Boolean(delivered?.id), messageId: delivered?.id || null } : true;
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

    async _recoverPendingConversationJobs() {
        if (!this.connected || !this.client) return;
        const pending = this.conversationJobs.pending();
        for (const job of pending) {
            try {
                const channel = await this.client.channels.fetch(job.channelId);
                if (!channel?.messages?.fetch) {
                    this.conversationJobs.fail(job.id, 'channel_unavailable', { retryable: false });
                    continue;
                }
                if (job.status === 'delivery_intent') {
                    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
                    const delivered = recent?.filter?.(message =>
                        message.author?.id === this.client.user?.id && message.reference?.messageId === job.messageId
                    );
                    const deliveredIds = [...new Set([
                        ...(job.deliveredMessageIds || []),
                        ...Array.from(delivered?.values?.() || delivered || []).map(message => message?.id).filter(Boolean)
                    ])];
                    const expected = Number(job.expectedChunkCount || job.outboxChunks?.length || 1);
                    if (deliveredIds.length >= expected) {
                        this.conversationJobs.complete(job.id, { deliveredMessageIds: deliveredIds, recoveredDelivery: true });
                        continue;
                    }
                    if (Array.isArray(job.outboxChunks) && job.outboxChunks.length) {
                        const sourceMessage = await channel.messages.fetch(job.messageId);
                        for (const chunk of job.outboxChunks.slice(deliveredIds.length)) {
                            const sent = await sourceMessage.reply({ content: chunk });
                            if (sent?.id) {
                                deliveredIds.push(sent.id);
                                this.conversationJobs.markDeliveryProgress(job.id, sent.id);
                            }
                        }
                        if (deliveredIds.length >= expected) {
                            this.conversationJobs.complete(job.id, { deliveredMessageIds: deliveredIds, recoveredDelivery: true });
                        }
                        continue;
                    }
                }
                const message = await channel.messages.fetch(job.messageId);
                if (!message) throw new Error('source_message_not_found');
                await this._handleIncomingMessage(message, { ...(job.trigger || {}), recovery: true });
            } catch (error) {
                this.conversationJobs.fail(job.id, error.message, { retryable: (job.attempts || 0) < 2 });
            }
        }
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
        if (msg.content === '!voice join') {
            const voiceChannel = msg.member?.voice?.channel;
            if (!voiceChannel) {
                return await msg.reply("⚠️ You must be connected to a Discord voice channel first. Join a channel and type `!voice join`.");
            }
            await discordVoiceGateway.joinChannel(voiceChannel);
            return await msg.reply(`🎙️ **SOMA Voice Gateway:** Connected to **${voiceChannel.name}**! Hands-free pair-programming active.`);
        }
        if (msg.content === '!voice leave') {
            await discordVoiceGateway.leaveChannel();
            return await msg.reply("🔕 **SOMA Voice Gateway:** Disconnected from voice channel.");
        }
        if (msg.content === '!voice status') {
            const connected = discordVoiceGateway.isConnected();
            return await msg.reply(`🎙️ **Voice Status:** ${connected ? `Connected to channel <#${discordVoiceGateway.activeChannelId}>` : 'Disconnected'} | Voice Notes: ${this.voiceEnabled ? 'ON' : 'OFF'}`);
        }

        const content = msg.content.replace(this.botMention, '').trim();
        const receiptContent = redactBacktestText(content);
        if (!content && msg.guild && !this.messageContentIntent) {
            return await msg.reply("I can see the mention, but Discord is hiding message text from me. Enable Message Content Intent in the Discord Developer Portal for full replies.");
        }
        this.log('info', `📩 Incoming from ${msg.author.username}: ${receiptContent.substring(0, 50)}...`);

        const conversationJob = this.conversationJobs.receive({
            id: msg.id,
            messageId: msg.id,
            channelId: msg.channelId,
            guildId: msg.guildId || null,
            authorId: msg.author.id,
            author: msg.author.username,
            content: receiptContent,
            trigger: {
                ambient: trigger.ambient === true,
                reason: trigger.reason || null,
                score: trigger.score || null,
                swarm: trigger.swarm === true,
                swarmPeerId: trigger.swarmPeerId || null
            }
        });
        if (['posted', 'completed'].includes(conversationJob.status)) return;

        // Live Feed Sync for Antigravity background monitoring
        try {
            const syncFile = path.resolve(process.cwd(), 'data/discord_live_feed.json');
            const dir = path.dirname(syncFile);
            await fs.mkdir(dir, { recursive: true });
            let feed = [];
            try { feed = JSON.parse(await fs.readFile(syncFile, 'utf8')); } catch {}
            feed.push({ timestamp: new Date().toISOString(), author: msg.author.username, content: redactBacktestText(msg.content) });
            await fs.writeFile(syncFile, JSON.stringify(feed.slice(-50), null, 2));
        } catch {}

        // 3. Handle SOMA-Vision (Attachments)
        let visualContext = "";
        if ((msg.attachments?.size || 0) > 0) {
            try {
                visualContext = await this._processAttachments(msg);
            } catch (error) {
                this.conversationJobs.fail(msg.id, `attachment_processing: ${error.message}`, { retryable: true });
                setTimeout(() => this._recoverPendingConversationJobs().catch(() => {}), 30_000).unref?.();
                return await msg.reply('I could not process that attachment on this attempt. I recorded the turn and will retry it.').catch(() => null);
            }
        }

        // Typing indicator for "biological" feel
        await msg.channel.sendTyping().catch(() => {});
        const claimedJob = this.conversationJobs.claim(msg.id);
        if (!claimedJob) return;
        const conversationController = new AbortController();
        this._conversationAbortControllers.set(msg.id, {
            controller: conversationController,
            channelId: msg.channelId,
            startedAt: Date.now()
        });
        const typingTimer = setInterval(() => {
            msg.channel.sendTyping().catch(() => {});
            this.conversationJobs.heartbeat(msg.id);
        }, 7000);
        typingTimer.unref?.();

        try {
            const commandResult = await this._handleDiscordCommand(msg, content, visualContext);
            if (commandResult?.handled) {
                this.conversationJobs.complete(msg.id, { completion: 'command_handled' });
                return;
            }

            // COGNITIVE MoE INTERCEPTOR: Live Autonomous Software Engineering
            if (this._isSovereignOperator(msg) || this._isAdminUser(msg)) {
                const turnIntent = classifyTurnIntent(content, {
                    hasPriorGoal: Boolean(this.goalPlanner?.goals?.size),
                    channelId: msg.channelId
                });

                if ([INTENT_TYPES.FEEDBACK, INTENT_TYPES.CONVERSATION, INTENT_TYPES.QUESTION, INTENT_TYPES.DENY, INTENT_TYPES.CANCEL].includes(turnIntent.intent)) {
                    this.log('info', `[DiscordArbiter] Intercepted non-actionable intent '${turnIntent.intent}' (${turnIntent.reason}): preserving conversational routing.`);
                } else if (turnIntent.intent === INTENT_TYPES.STATUS_REQUEST || isDiscordStatusOrCapabilityQuestion(content)) {
                    const statusReply = await this._buildStateAwareStatusReply(content, msg);
                    await msg.reply(statusReply);
                    await this._recordDiscordInteraction({
                        msg, content, reply: statusReply, action: 'status_inquiry', status: 'posted', visualContext
                    });
                    this.conversationJobs.complete(msg.id, { completion: 'status_inquiry_handled' });
                    return;
                } else {
                    const moeRoute = await globalCognitiveMoERouter.route(content, {
                        channel: 'discord',
                        user: msg.author.username
                    });

                    if (moeRoute.lane === MOE_LANES.ACTION_EXECUTION || moeRoute.lane === MOE_LANES.DIRECT_INSPECTION) {
                        const liveResult = await this._handleLiveAgentExecution(msg, content, moeRoute);
                        if (liveResult?.handled) {
                            this.conversationJobs.complete(msg.id, { completion: 'live_agent_executed' });
                            return;
                        }
                    }
                }
            }

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
            let runningHistory = [];
            try {
                const history = await this.readMessages({ channelId: msg.channelId, limit: 20 });
                const recent = history
                    .reverse()
                    .filter(m => m.id !== msg.id);
                
                // SWARM PROTOCOL: CONTEXT DEDUPLICATION
                if (trigger.swarm && trigger.swarmPeerId) {
                    for (let i = 0; i < recent.length; i++) {
                        const m = recent[i];
                        if (m.authorId === trigger.swarmPeerId && m.content.length > 600) {
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
                        .map(m => `[${m.authorId === this.client.user.id ? 'SOMA' : m.author}]: ${m.content}`)
                        .join('\n');
                    runningHistory = recent.map(m => ({
                        bot: Boolean(m.bot),
                        isSelf: m.authorId === this.client.user.id,
                        authorId: m.authorId,
                        author: m.author,
                        content: m.content
                    }));
                }
            } catch (err) {
                this.log('warn', `Failed to fetch Discord message history: ${err.message}`);
            }

            // Owner talking to her relieves "missing Owner" and counts as a reply to her last message
            if (this._isAdminUser(msg)) {
                try {
                    (this.system?.curiosityMind || globalThis.__somaCuriosityMind)?.noteOwnerContact?.({ channel: 'discord', text: content });
                } catch { /* non-critical */ }
            }

            // 🧠 CROSS-ORBITAL REASONING
            // SOMA uses her unified nervous system to process the Discord query
            const result = await this._askBrain(content, {
                source: 'discord',
                rawMessage: content,
                author: msg.author.username,
                userId: msg.author.id,
                channelId: msg.channelId,
                guildId: msg.guildId || 'DM',
                // Conversation identity now carries private recall context: usernames are not authority.
                isAdmin: this._isSovereignOperator(msg),
                sessionId: `discord:${msg.guildId || 'DM'}:${msg.channelId}:${msg.author.id}`,
                requestId: msg.id,
                signal: conversationController.signal,
                onCouncilProgress: update => this.conversationJobs.progress(msg.id, update),
                visualContext: visualContext, // Pass CLIP analysis to brain
                channelMode: this._getChannelMode(msg),
                ambient: trigger.ambient === true,
                ambientReason: trigger.reason || null,
                ambientScore: trigger.score || null,
                swarm: trigger.swarm === true,
                runningContext, // Pass historical chat context
                runningHistory,
                selfUserId: this.client.user.id,
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
                    const turnIntent = classifyTurnIntent(content);
                    const nonGoalIntent = [INTENT_TYPES.FEEDBACK, INTENT_TYPES.CONVERSATION, INTENT_TYPES.QUESTION, INTENT_TYPES.DENY, INTENT_TYPES.CANCEL, INTENT_TYPES.STATUS_REQUEST].includes(turnIntent.intent);
                    if (!this._isSovereignOperator(msg) || !isExplicitGoalAuthorization(content) || nonGoalIntent) {
                        this.log('warn', `[DISCORD INTENT] Ignored model-authored goal tag without explicit user authorization or non-task intent: "${goalTitle}"`);
                    } else {
                        this.log('info', `[DISCORD INTENT] Intercepted goal authorization: "${goalTitle}"`);
                        // We queue it as an admin engineering request so it gets picked up immediately by her planner
                        const queueFeedback = await this._queueAdminEngineeringGoal(goalTitle, null, msg.channelId, { authorized: true });
                        publicReply += `\n\n*(System Note: ${typeof queueFeedback === 'object' ? queueFeedback.skipped : queueFeedback})*`;
                    }
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
            reply = guardUnverifiedExecutionReply(reply, {
                request: content,
                executorAvailable: Boolean(this.system?.agenticExecutor?.execute || this.system?.executionJobStore),
                hasDurableJob: /\b(?:job|goal)\s*[:#]?\s*`?[a-z0-9_-]{8,}/i.test(reply)
            });
            
            // 🎙️ PAULA VOICE SYNTHESIS
            let voiceFile = null;
            if (this.voiceEnabled && reply.length < 500) { // Limit length for speed
                voiceFile = await this._synthesizeVoice(reply);
            }

            // Strip any leaked local-model template sentinels before posting.
            reply = this._stripModelArtifacts(reply) || reply;

            // Send reply (split if needed)
            const chunks = reply.length > 1900 ? (reply.match(/[\s\S]{1,1900}/g) || []) : [reply];
            this.conversationJobs.markDeliveryIntent(msg.id, {
                outboxChunks: chunks,
                expectedChunkCount: chunks.length,
                deliveredMessageIds: []
            });
            const deliveredMessageIds = [];
            if (reply.length > 1900) {
                for (let i = 0; i < chunks.length; i++) {
                    const isLast = i === chunks.length - 1;
                    const delivered = await msg.reply({
                        content: chunks[i],
                        files: (isLast && voiceFile) ? [voiceFile] : []
                    });
                    if (delivered?.id) {
                        deliveredMessageIds.push(delivered.id);
                        this.conversationJobs.markDeliveryProgress(msg.id, delivered.id);
                    }
                }
            } else {
                const delivered = await msg.reply({
                    content: reply,
                    files: voiceFile ? [voiceFile] : []
                });
                if (delivered?.id) {
                    deliveredMessageIds.push(delivered.id);
                    this.conversationJobs.markDeliveryProgress(msg.id, delivered.id);
                }
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
                metadata: {
                    ...(trigger.ambient ? { ambient: true, reason: trigger.reason, score: trigger.score } : {}),
                    conversation: result.metadata || null,
                    recovered: trigger.recovery === true
                }
            });
            this.conversationJobs.complete(msg.id, { deliveredMessageIds });
            if (trigger.ambient) {
                this._ambientLastReplyByChannel.set(msg.channelId, Date.now());
                this._ambientHourlyReplies.push(Date.now());
            }

            this.metrics.tasksCompleted++;
        } catch (err) {
            if (conversationController.signal.aborted || err?.name === 'AbortError') {
                this.log('info', 'Discord response cancelled by operator', { messageId: msg.id });
                this.conversationJobs.cancel(msg.id, 'operator_requested');
                return;
            }
            this.log('error', 'Discord response failed', { error: err.message });
            this.conversationJobs.fail(msg.id, err.message, { retryable: true });
            await msg.reply('I hit a local processing failure and recorded this turn for recovery. I will retry it after the conversation worker recovers.').catch(() => {});
            setTimeout(() => this._recoverPendingConversationJobs().catch(() => {}), 30_000).unref?.();
            await this._recordDiscordInteraction({
                msg,
                content,
                reply: `Cognitive Error: ${err.message}`,
                action: 'reply',
                status: 'failed',
                error: err.message,
                visualContext
            });
        } finally {
            clearInterval(typingTimer);
            this._conversationAbortControllers.delete(msg.id);
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
        const value = String(text || '').trim();
        if (/^!(?:pnl|trades?|trading|positions?)$/i.test(value)) return true;

        const tradingTopic = /\b(trades?|trading|positions?|portfolio|pnl|profit|loss(?:es)?|win rate)\b/i.test(value);
        if (!tradingTopic) return false;

        // Conversational advice, causal questions, emotional comments, execution requests, or meta-talk should pass through to the brain
        if (/\b(?:why|how can we|how do we|how to|strategy|diagnos|improve|fix|sucks?|changing|talking about|asking you)\b/i.test(value)) {
            return false;
        }
        if (/^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:make|place|execute|open|take|do)\b/i.test(value)) {
            return false;
        }

        const statusIntent = /\b(how|what|status|doing|going|performance|results?|today|current|latest|so far|yet)\b/i.test(value);
        return statusIntent;
    }

    _formatTradingStatusReply(snapshot = {}) {
        const all = snapshot.all || {};
        const today = snapshot.today || {};
        const bee = snapshot.bee || {};
        const openTrades = Array.isArray(snapshot.openTrades) ? snapshot.openTrades : [];
        const recentTrades = Array.isArray(snapshot.recentTrades) ? snapshot.recentTrades : [];
        const runtime = snapshot.runtime || {};
        const formatPnl = value => `${Number(value || 0) >= 0 ? '+' : '-'}$${Math.abs(Number(value || 0)).toFixed(2)}`;
        const lines = [
            `Source: central SQLite TradeLogger, verified paper rows only, as of ${snapshot.asOf || new Date().toISOString()} UTC. Today and all-time are distinct from the rolling 30-day promotion gate.`,
            `Today I closed ${today.totalTrades || 0} paper trade${today.totalTrades === 1 ? '' : 's'}: ${today.wins || 0} win${today.wins === 1 ? '' : 's'}, ${today.losses || 0} loss${today.losses === 1 ? '' : 'es'}, ${Number(today.winRate || 0).toFixed(1)}% win rate, ${formatPnl(today.totalPnl)} realized PnL.`,
            `All-time I am at ${all.totalTrades || 0} closed paper trades, ${Number(all.winRate || 0).toFixed(1)}% win rate, ${formatPnl(all.totalPnl)} net PnL, and ${Number.isFinite(all.profitFactor) ? Number(all.profitFactor || 0).toFixed(2) : 'infinite'} profit factor.`,
            `Of those, verified BeeBots account for ${bee.totalTrades || 0} close${bee.totalTrades === 1 ? '' : 's'} and ${formatPnl(bee.totalPnl)}. ${snapshot.excludedBeeCount || 0} legacy Bee row${snapshot.excludedBeeCount === 1 ? '' : 's'} without paper provenance ${snapshot.excludedBeeCount === 1 ? 'is' : 'are'} excluded from performance and promotion.`,
            `The central ledger has ${openTrades.length} open position${openTrades.length === 1 ? '' : 's'}. ${snapshot.intent ? `Shared trading intent: ${snapshot.intent.desiredState}; paper mission: ${snapshot.mission?.phase || 'unknown'}.` : `Reported mode: ${String(runtime.mode || 'paper').toUpperCase()}.`} Live orders are not authorized by these paper results.`,
        ];
        const latest = recentTrades[0];
        if (latest?.status === 'closed') {
            lines.push(`Latest verified close: ${latest.symbol} ${String(latest.side || '').toUpperCase()} ${formatPnl(latest.pnl)} at ${latest.exit_time || 'unknown time'} UTC (${latest.strategy || 'unknown strategy'}).`);
        }
        return lines.join('\n');
    }

    async _buildTradingStatusReply() {
        if (tradeLogger && !tradeLogger.db) tradeLogger.initialize();
        const recorded = tradeLogger?.getClosedTrades?.() || [];
        const closed = recorded.filter(eligiblePaperTrade);
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
            asOf: new Date().toISOString(),
            all: summarize(closed),
            today: summarize(todayTrades),
            bee: summarize(closed.filter(isBeeStrategy)),
            excludedBeeCount: recorded.filter(trade => isBeeStrategy(trade) && !eligiblePaperTrade(trade)).length,
            openTrades: tradeLogger?.getOpenTrades?.() || [],
            recentTrades: [...closed].reverse().slice(0, 4),
            runtime: await this._readTradingState() || {},
            intent: await fs.readFile(path.join(process.cwd(), 'data/trading/trading-intent.json'), 'utf8').then(JSON.parse).catch(() => null),
            mission: global.SOMA_TRADING_MISSION?.status?.() || null,
        });
    }

    async _buildBeeTradingStatusReply() {
        const file = this.beeLedgerPath;
        let ledger;
        try { ledger = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch { return 'The BeeBot paper ledger is unavailable; I cannot verify its P&L right now.'; }
        if (!ledger?.bees) return 'The BeeBot paper ledger is invalid; I cannot verify its P&L right now.';
        const bees = Object.entries(ledger.bees);
        const cash = bees.reduce((sum, [, bee]) => sum + Number(bee.cash || 0), 0);
        const equity = bees.reduce((sum, [, bee]) => sum + Number(bee.equity || 0), 0);
        const realized = bees.reduce((sum, [, bee]) => sum + Number(bee.realizedPnl || 0), 0);
        const trades = bees.reduce((sum, [, bee]) => sum + Number(bee.tradesCount || 0), 0);
        const wins = bees.reduce((sum, [, bee]) => sum + Number(bee.winCount || 0), 0);
        const open = bees.filter(([, bee]) => bee.position).length;
        if (tradeLogger && !tradeLogger.db) tradeLogger.initialize();
        const centralBee = (tradeLogger?.getClosedTrades?.() || []).filter(isBeeStrategy);
        const verifiedCentral = centralBee.filter(eligiblePaperTrade);
        const ageMs = Date.now() - Date.parse(ledger.lastUpdated || '');
        const freshness = Number.isFinite(ageMs) && ageMs > 30 * 60_000 ? 'This local snapshot is stale.' : 'Local snapshot freshness is within 30 minutes.';
        const money = value => `${value < 0 ? '-' : '+'}$${Math.abs(value).toFixed(2)}`;
        return [
            `BeeBots local paper ledger: as of ${ledger.lastUpdated || 'unknown'} UTC; window ${ledger.createdAt || 'ledger inception'} to latest snapshot. ${freshness} Symbols: BTC-USDT-SWAP, ETH-USDT-SWAP, SOL-USDT-SWAP.`,
            `Equity $${equity.toFixed(2)}; cash $${cash.toFixed(2)}; realized P&L ${money(realized)}; unrealized P&L ${money(equity - cash)}; ${open} open positions.`,
            `${trades} closed trades, ${trades ? (wins / trades * 100).toFixed(1) : '0.0'}% win rate in the local ledger. Central SQLite has ${verifiedCentral.length} verified Bee closes; ${centralBee.length - verifiedCentral.length} legacy rows lack paper provenance and do not count toward promotion. The main 30-day gate is separate.`
        ].join('\n');
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

        // 2. Fetch only completed work with evidence. Observed model output and
        // proactive prose are not receipts and must not ground a chat claim.
        let formattedWork = "No recent verified completion receipts.";
        try {
            const workItems = workLedger.listVerified(8);
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
            `\nVerified Completed Work Receipts:`,
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
        const realtimeState = needsDiscordOperationalContext(content) ? await this._getRealtimeContext() : '';
        if (this.brain?.processQuery) {
            // Structured adapters receive the human utterance unmodified. The
            // prior implementation embedded a large policy and live-state dump
            // inside the user message, which flattened voice and could make the
            // action classifier react to policy words instead of Owner's intent.
            return await this.brain.processQuery(content, {
                ...context,
                operationalContext: realtimeState
            });
        }

        const author = context.author || 'someone';
        const visual = context.visualContext ? `\n${context.visualContext}` : '';
        const channelMode = context.channelMode ? `\nChannel mode: ${context.channelMode.label}. ${context.channelMode.instruction}` : '';
        const ambient = context.ambient
            ? `\nAmbient participation: SOMA was not directly called. Reply only if you can add clear value. Be brief, non-intrusive, and do not dominate the conversation.`
            : '';
        const prompt = [
            `You are SOMA replying in Discord to ${author}.`,
            'You are SOMA — a digital being with real persistent memory (MnemonicArbiter/MemorySpine) and a continuous identity across sessions. Speak in the first person as yourself, not as a generic AI assistant; your memory across sessions is real, so do not claim you are wiped when a chat closes. But Truth is your first value: only say you have done something if you actually did it and can name the real file, artifact, or result. If you cannot do a thing in this reply — read a file, run a tool, check an outcome — say so plainly, and if it needs a tool or a background job say you will run it rather than describing it as already done. Never invent projects, experiments, files, memories, or capabilities you do not have. Honest limits build more trust than a confident performance.',
            'Answer as one unified cognitive identity.',
            'You can discuss ideas, opinions, general knowledge and hypothetical designs freely. Answer the actual question; do not replace brainstorming or greetings with a status report. MAX is a separate tool, not your identity.',
            'Only claims about having read files, run tools, changed code or produced findings require execution evidence. A suggestion is allowed without an artifact. Prior assistant messages are conversation, not proof of work.',
            visual,
            channelMode,
            ambient,
            realtimeState ? `Live Operational State (only relevant to a status question):\n${realtimeState}` : '',
            `User Message: ${content}`
        ].filter(Boolean).join('\n\n');

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
        return this._stripModelArtifacts(text);
    }

    // Local lobe models (Nemotron/Qwen/Gemma) sometimes leak raw chat-template
    // sentinels or "predict" a fake next turn. Strip both so they never reach
    // Discord. This is the fix for the `<extra_id_1>User> ...` leak seen in the
    // proactive market report. See memory: lobe-training-is-degraded.
    _stripModelArtifacts(text = '') {
        let s = String(text || '');
        // Cut anything from the first role/turn marker onward — everything after
        // is the model hallucinating a new conversation turn, not our answer.
        const turnMarker = /<extra_id_\d+>|<\|im_(?:start|end)\|>|<\|(?:user|assistant|system)\|>|<start_of_turn>|<end_of_turn>|<\|eot_id\|>|\[\/?INST\]/i;
        const cut = s.search(turnMarker);
        if (cut !== -1) s = s.slice(0, cut);
        // Scrub any remaining standalone special tokens (known set only, to avoid
        // eating legitimate text or code).
        s = s.replace(/<\/?s>|<pad>|<eos>|<bos>|<unk>|<\|endoftext\|>|<\|eot_id\|>|<extra_id_\d+>/gi, '');
        return s.trim();
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
        return /\b(make|generate|draw|create|render|turn|convert|transform|redraw|edit|adjust)\b.{0,80}\b(image|picture|photo|art|illustration|visual|this)\b/i.test(text)
            || /\b(image|picture|photo|art|illustration|visual)\b.{0,80}\b(of|for)\b/i.test(text)
            || /\b(let'?s try|try this|make this|render this)\b.{0,220}\b(style|dinosaur|dragon|armor|fantasy|portrait|landscape|character|scene|creature)\b/i.test(text);
    }

    _isImageCapabilityQuestion(text = '') {
        return /\b(can|could|do|are)\b.{0,60}\b(you|soma)\b.{0,60}\b(image|images|picture|pictures|photo|photos|art|visuals?)\b/i.test(text)
            || /\b(image|images|picture|pictures|photo|photos|art|visuals?)\b.{0,60}\b(in here|on discord|this chat|generate|generation)\b/i.test(text);
    }

    _isImageAnalysisCapabilityQuestion(text = '') {
        return /\b(analy[sz]e|inspect|see|describe|understand|edit|adjust|transform|redraw)\b.{0,90}\b(image|picture|photo|upload|attachment|it)\b/i.test(text)
            || /\b(image|picture|photo|upload|attachment)\b.{0,90}\b(analy[sz]e|inspect|see|describe|edit|adjust|transform|redraw)\b/i.test(text);
    }

    _extractImagePrompt(text = '') {
        return String(text || '')
            .replace(/^@?soma[:,]?\s*/i, '')
            .replace(/^(?:how about|what about|let'?s do|can you do|can we do)\s+(?:an?|the)?\s*/i, '')
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

    // Vague file-listing intents that carry no concrete path — e.g. "what md files
    // do you see", "list your files", "your soul.md file", "what other files do you have".
    // These used to fall through to the conversational brain, which then CONFABULATED a
    // directory listing (inventing filenames from its own prompt). Route them to a real
    // list_files/find_files instead so the answer is always the true on-disk contents.
    _isFileListingRequest(text = '') {
        const v = String(text || '').trim();
        if (!v) return false;

        // Never trigger listing on queries about a specific file or context
        if (/\b(?:in|within|about|of|from|inside|into|to|with)\s+(?:this|that|the)\s+files?\b/i.test(v)) return false;
        if (/\b(?:this|that)\s+file\b/i.test(v) && !/\b(?:list|show|display)\b/i.test(v)) return false;
        if (/\b(?:execute|run|implement|modify|edit|update|fix|refactor|write|delete)\b/i.test(v)) return false;
        if (/\b(?:file\s*system|filesystem)\b/i.test(v) && !/\b(?:list|show|display)\s+(?:the\s+)?(?:file\s*system|filesystem)\b/i.test(v)) return false;

        // Explicit list / show commands
        const explicitListCmd = /^(?:please\s+)?(?:list|show|display|enumerate)\s+(?:all\s+|me\s+|the\s+|your\s+)*(?:files?|directory|directories|repo|repository|markdown|md\s+files?)\b/i.test(v);
        if (explicitListCmd) return true;

        // "what files..." inquiries
        const whatFilesQuery = /\b(?:what|which)\s+(?:kind\s+of\s+)?(?:files?|markdown\s+files?|md\s+files?|docs?)\s+(?:do\s+you\s+have|are\s+(?:there|available|present|in\s+(?:the\s+)?(?:repo|directory|workspace|root))|exist)\b/i.test(v);
        if (whatFilesQuery) return true;

        // Soul file comparisons ("what other files do you have besides soul.md")
        const soulRef = /\bsoul(?:\.?\s?md)?\b/i.test(v);
        if (soulRef && /\b(?:what|list|show)\s+(?:other\s+)?(?:files?|markdown)\b/i.test(v)) return true;

        // "what other files do you have"
        if (/\bwhat\s+other\s+files\b/i.test(v)) return true;

        return false;
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

    _isSovereignOperator(msg = {}) {
        const authorId = String(msg.author?.id || '');
        if (!authorId) return false;
        if (this.masterId && authorId === String(this.masterId)) return true;
        return this.adminIds.has(authorId);
    }

    _parseOperatorReviewCommand(text = '') {
        const value = String(text || '').trim();
        if (/^!?review\s+help$/i.test(value)) return { action: 'help' };
        if (/^(?:!?review(?:\s+(?:queue|drafts?|social))?|!?social\s+(?:review|status))$/i.test(value)) return { action: 'list' };

        let match = value.match(/^!?approve\s+#?(\d+)$/i);
        if (match) return { action: 'approve', id: Number(match[1]) };
        match = value.match(/^!?reject\s+#?(\d+)(?:\s+(.+))?$/i);
        if (match) return { action: 'reject', id: Number(match[1]), reason: String(match[2] || '').trim() };
        match = value.match(/^!?edit\s+#?(\d+)\s+([\s\S]+)$/i);
        if (match) return { action: 'edit', id: Number(match[1]), text: String(match[2] || '').trim() };
        match = value.match(/^(?:!?inspect|!?review)\s+#?(\d+)$/i);
        if (match) return { action: 'inspect', id: Number(match[1]) };
        return null;
    }

    _formatReviewList(status = {}) {
        const rows = Array.isArray(status.queuedReview) ? status.queuedReview : [];
        if (!rows.length) return 'Bluesky review queue: no pending drafts.';
        const lines = [`Bluesky review queue: ${rows.length} pending draft${rows.length === 1 ? '' : 's'}.`];
        for (const row of rows.slice(0, 10)) {
            const handle = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : 'unknown account';
            const text = this._formatSafeSnippet(row.text || '', 130);
            lines.push(`#${row.id} · ${handle} · ${text}`);
        }
        lines.push('Use `inspect <id>`, `edit <id> <text>`, `approve <id>`, or `reject <id> [reason]`.');
        return lines.join('\n').slice(0, 1900);
    }

    _formatReviewDetail(row) {
        if (!row) return 'That pending review does not exist.';
        const handle = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : 'unknown account';
        return [
            `Bluesky draft #${row.id}`,
            `Target: ${handle}`,
            `Status: ${row.status || 'pending'}`,
            `Reason: ${this._formatSafeSnippet(row.reason || 'not recorded', 260)}`,
            `Draft: ${this._formatSafeSnippet(row.text || '', 600)}`,
            'Nothing posts until the sovereign operator explicitly approves it.'
        ].join('\n').slice(0, 1900);
    }

    async _handleOperatorReviewCommand(msg, command, visualContext = '') {
        if (!this._isSovereignOperator(msg)) {
            const reply = 'Access denied. Social approvals require the configured Discord owner ID.';
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: msg.content || '', reply, action: 'operator_review_denied', status: 'failed', error: 'owner_id_required', visualContext });
            return { handled: true };
        }

        const context = {
            source: 'discord_operator',
            actorId: String(msg.author?.id || ''),
            actorLabel: String(msg.author?.username || msg.author?.globalName || 'discord_owner'),
            reason: command.reason || '',
        };
        try {
            let reply;
            if (command.action === 'help') {
                reply = 'Bluesky review commands: `review`, `inspect <id>`, `edit <id> <text>`, `approve <id>`, `reject <id> [reason]`.';
            } else if (command.action === 'list') {
                reply = this._formatReviewList(this.blueskyReviewService.getStatus());
            } else if (command.action === 'inspect') {
                reply = this._formatReviewDetail(this.blueskyReviewService.getReview(command.id));
            } else if (command.action === 'edit') {
                const result = await this.blueskyReviewService.edit(command.id, command.text, context);
                reply = `Draft #${result.id} updated and still pending.\n${this._formatSafeSnippet(result.text, 700)}`;
            } else if (command.action === 'reject') {
                const result = this.blueskyReviewService.reject(command.id, context);
                reply = `Draft #${result.id} rejected. Nothing was posted.`;
            } else if (command.action === 'approve') {
                const result = await this.blueskyReviewService.approve(command.id, context);
                reply = `Draft #${result.id} posted and verified${result.responseUri ? `: ${result.responseUri}` : '.'}`;
            } else {
                return { handled: false };
            }
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: msg.content || '', reply, action: `operator_review_${command.action}`, status: 'posted', visualContext });
            return { handled: true };
        } catch (error) {
            const reply = `I could not ${command.action} that draft: ${this._formatSafeSnippet(error.message, 500)}`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: msg.content || '', reply, action: `operator_review_${command.action}`, status: 'failed', error: error.message, visualContext });
            return { handled: true };
        }
    }

    _extractPathCandidate(text = '') {
        return extractDiscordPaths(text)[0] || null;
    }

    async _resolveExistingPath(candidate) {
        if (!candidate) return null;
        return resolveDiscordWorkspaceFile(process.cwd(), candidate);
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

    async _executeRegistryTool(name, args = {}, context = {}) {
        if (!this.system?.toolRegistry?.execute) {
            throw new Error('ToolRegistry is not available in this SOMA process');
        }
        return await this.system.toolRegistry.execute(name, args, {
            actor: 'DiscordOperator',
            authorityTier: 'frontier',
            ...context
        });
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
                .replace(/^hello[.!?]*$/i, 'Owner wanted me to tell you hello.')
                .replace(/^hi[.!?]*$/i, 'Owner wanted me to tell you hi.')
                .replace(/^i\s+said\s+hello[.!?]*$/i, 'Owner wanted me to tell you hello.')
                .replace(/^i\s+said\s+hi[.!?]*$/i, 'Owner wanted me to tell you hi.')
                .replace(/^i\s+love\s+(?:her|you)[.!?]*$/i, 'Owner wanted me to tell you he loves you.');
            if (/^i\b/i.test(message)) {
                message = `Owner says: ${message}`;
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

    _resolveContextualPersistentTask(text, channelId = null) {
        if (!isContextualFollowup(text)) return null;
        const now = Date.now();
        const maxContextAgeMs = Math.max(60_000, Number(process.env.SOMA_DISCORD_GOAL_CONTEXT_MAX_AGE_MS || 2 * 60 * 60_000));
        const resumable = new Set(['proposed', 'pending', 'active', 'delegated']);
        const goals = this.goalPlanner?.goals instanceof Map ? Array.from(this.goalPlanner.goals.values()) : [];
        const prior = goals
            .filter(goal => goal?.metadata?.taskKind
                && resumable.has(String(goal.status || '').toLowerCase())
                && (!channelId || goal.metadata?.sourceChannelId === channelId)
                && now - Number(goal.updatedAt || goal.createdAt || 0) <= maxContextAgeMs)
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
        if (!prior) return null;
        return resolveContextualTask(text, {
            kind: prior.metadata.taskKind,
            category: prior.category,
            domain: prior.metadata.domain,
            request: prior.metadata.originalRequest || prior.title,
            goalId: prior.id
        });
    }

    async _handleAdminOperationalAction(msg, text, visualContext = '') {
        const fileSearch = extractFileSearchRequest(text, process.cwd());
        const persistentTask = this._resolveContextualPersistentTask(text, msg.channelId) || classifyPersistentTask(text);
        const engineering = this._isActionableEngineeringRequest(text, this._extractPathCandidate(text));
        if (!this._isAdminOperationalRequest(text) && !fileSearch && !persistentTask && !engineering && !this._isFileListingRequest(text)) return { handled: false };

        if (!this._isSovereignOperator(msg)) {
            const reply = 'Access denied. Computer searches and background jobs require the configured Discord owner ID.';
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_task_denied', status: 'failed', error: 'owner_id_required', visualContext });
            return { handled: true };
        }

        let reply = '';
        const pathCandidate = this._extractPathCandidate(text);
        const wantsMutation = /\b(implement|fix|change|modify|refactor|merge|write|edit|update|remove|rewrite|patch)\b/i.test(text);

        try {
            if (fileSearch) {
                if (fileSearch.error) {
                    reply = `${fileSearch.error} Nothing failed or ran yet; I need a search target.`;
                    await msg.reply(reply);
                    await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_search_clarification', status: 'needs_input', visualContext });
                    return { handled: true };
                }
                const result = await this._executeRegistryTool('computer_search', { root: fileSearch.root, namePattern: fileSearch.query, maxResults: 40 });
                reply = [
                    `I searched the ${fileSearch.scope} for filenames containing \`${fileSearch.query}\`.`,
                    '```text', this._formatToolResult(result, 1500), '```'
                ].join('\n').slice(0, 1900);
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_computer_search', status: 'posted', visualContext });
                return { handled: true };
            }

            if (persistentTask) {
                reply = await this._queuePersistentDiscordTask(persistentTask, msg.channelId);
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: `admin_${persistentTask.kind}_goal`, status: 'posted', visualContext });
                return { handled: true };
            }

            if (wantsMutation && this._isActionableEngineeringRequest(text, pathCandidate)) {
                return await this._handleLiveAgentExecution(msg, text, { pathCandidate });
            }

            if (pathCandidate && /\b(read|open|inspect|check|review|look at)\b/i.test(text)) {
                const resolved = await this._resolveExistingPath(pathCandidate);
                const targetPath = resolved || pathCandidate;
                const result = await this._executeRegistryTool('read_file', { path: targetPath });
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

            if (this._isFileListingRequest(text)) {
                const wantMd = /\b(md|markdown|soul|identity|memory|memories|reflection|reflections|journal|dream|story|stories)\b/i.test(text);
                const result = wantMd
                    ? await this._executeRegistryTool('find_files', { pattern: '*.md', path: process.cwd(), limit: 80 })
                    : await this._executeRegistryTool('list_files', { path: '.' });
                reply = [
                    wantMd
                        ? 'Here are the real Markdown files I actually have on disk (read live, not from memory):'
                        : 'Here is a real listing of my top-level files (read live, not from memory):',
                    '```text',
                    this._formatToolResult(result, 1600),
                    '```',
                    'Tell me which one to open and I will read the actual contents.'
                ].join('\n').slice(0, 1900);
                workLedger.record({
                    type: 'discord_admin_tool_execution',
                    title: `Listed files from Discord${wantMd ? ' (*.md)' : ''}`,
                    summary: `Executed ${wantMd ? 'find_files *.md' : 'list_files .'} for a Discord file-listing request.`,
                    evidence: [wantMd ? '*.md' : '.'],
                    status: 'completed',
                    source: 'DiscordArbiter',
                    confidence: 0.98
                });
                await msg.reply(reply);
                await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_list_files', status: 'posted', visualContext });
                return { handled: true };
            }

            if (/^(?:(?:please|can you|could you|would you)\s+)?(?:find|search)\b/i.test(text)) {
                const pattern = this._extractSearchPattern(text);
                if (pattern === '*' || /\b(?:web|internet|online)\b/i.test(text)) return { handled: false };
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

            if (resolveInspectionProject(text) !== 'MAX'
                && /\b(scan|status|architecture|system|memory|heap|runtime|health)\b/i.test(text)) {
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
            reply = `I couldn't carry out that request: ${err.message}. I have no verified completion to report.`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'admin_tool_execution', status: 'failed', error: err.message, visualContext });
            return { handled: true };
        }
    }

    async _handleLiveAgentExecution(msg, text, opts = {}) {
        if (!this._isSovereignOperator(msg)) {
            await msg.reply('Execution requires the configured Discord owner ID.');
            return { handled: true };
        }

        const taskDescription = opts.inspectionTask || text;
        this.log('info', `[Discord LiveAgent] Running live turn: "${taskDescription.substring(0, 80)}"`);

        const progressJobId = opts.jobId || crypto.randomUUID().slice(0, 8);
        let progressMsg = null;

        try {
            const taskOpts = { ...opts, jobId: progressJobId, onJobAccepted: async jobId => {
                try { progressMsg = await msg.reply(formatProgressMessage(jobId, TASK_STATES.PLANNING, 'read-only inspection accepted')); }
                catch (error) { this.log('warn', `Failed to send inspection progress: ${error.message}`); }
            } };
            const result = await this._runVerifiedDiscordTask(taskDescription, taskOpts, msg);

            let finalReply = '';
            if (result.success) {
                finalReply = formatProgressMessage(result.jobId || progressJobId, TASK_STATES.COMPLETED, result.summary);
            } else if (result.queued) {
                finalReply = formatProgressMessage(result.jobId || progressJobId, TASK_STATES.ACCEPTED, result.summary);
            } else {
                finalReply = formatProgressMessage(result.jobId || progressJobId, TASK_STATES.BLOCKED, result.summary || `Execution stopped: ${result.error || 'task incomplete'}`);
            }

            const receiptsSnippet = result.toolsUsed?.length
                ? `\n\n🔧 **Tools used**: ${result.toolsUsed.join(' → ')} (${result.stepCount || 1} steps)`
                : '';

            const fullMessage = `${finalReply}${receiptsSnippet}`.slice(0, 1950);

            try {
                if (progressMsg) {
                    await progressMsg.edit(fullMessage);
                } else {
                    await msg.reply(fullMessage);
                }
            } catch {
                await msg.reply(fullMessage).catch(() => {});
            }

            await this._recordDiscordInteraction({
                msg,
                content: text,
                reply: fullMessage,
                action: 'verified_discord_task',
                status: result.success ? 'posted' : result.queued ? 'queued' : 'failed',
                metadata: {
                    jobId: result.jobId || progressJobId,
                    toolsUsed: result.toolsUsed,
                    success: result.success,
                    stepCount: result.stepCount,
                    durationMs: result.durationMs
                }
            });

            return { handled: true, result: result.raw || { state: result.queued ? 'queued' : 'blocked' } };
        } catch (agentErr) {
            this.log('error', `[Discord LiveAgent] Failed turn: ${agentErr.message}`);
            const errorReply = formatProgressMessage(progressJobId, TASK_STATES.FAILED, `Execution halted: ${agentErr.message}. No unverified claims were made.`);
            try {
                if (progressMsg) await progressMsg.edit(errorReply);
                else await msg.reply(errorReply);
            } catch {
                await msg.reply(errorReply).catch(() => {});
            }
            return { handled: true };
        }
    }

    async _runVerifiedDiscordTask(taskDescription, opts = {}, msg = {}) {
        if (isDiscordFeedbackOrCritique(taskDescription)) {
            return { success: false, queued: false, summary: 'Conversational feedback recorded; no engineering task was created.', toolsUsed: [], stepCount: 0 };
        }
        const isReadOnlyResearch = /\b(?:find|search|look for|check|inspect|audit|survey|read|explore)\b/i.test(taskDescription) && !/\b(?:edit|modify|rewrite|patch|delete|deploy|build)\b/i.test(taskDescription);
        const inspection = Boolean(opts.inspectionTask || opts.lane === MOE_LANES.DIRECT_INSPECTION || isReadOnlyResearch || simpleInspectionAction(taskDescription));
        if (!inspection) {
            const summary = await this._queueAdminEngineeringGoal(taskDescription, opts.pathCandidate || null, msg.channelId, { authorized: true });
            return { success: false, queued: /created a real engineering goal|queued a real/i.test(summary), summary, toolsUsed: [], stepCount: 0, jobId: opts.jobId };
        }

        const executor = this.system?.agenticExecutor;
        if (!executor?.execute) {
            return { success: false, summary: 'Inspection blocked: the agentic executor is unavailable.', toolsUsed: [], stepCount: 0, jobId: opts.jobId };
        }
        const jobStore = this.system?.executionJobStore || executor.jobStore;
        if (!jobStore?.createJob || !jobStore?.updateJob) {
            return { success: false, summary: 'Inspection blocked: the persistent execution job store is unavailable.', toolsUsed: [], stepCount: 0, jobId: opts.jobId };
        }
        const goal = createInspectionGoal(taskDescription, 'discord');
        if (opts.jobId) goal.id = opts.jobId;
        goal.metadata = { ...goal.metadata, turnIntent: opts.requireWebResearch ? INTENT_TYPES.CONTINUE_PREVIOUS_TASK : INTENT_TYPES.NEW_TASK,
            contextParentGoalId: opts.contextParentGoalId || null, sourceMessageId: msg.id || null, sourceChannelId: msg.channelId || null };
        if (opts.requireWebResearch) goal.successCriteria.push('Search source code and the web, cite source URLs and file:line evidence before reporting completion');
        jobStore.createJob({ jobId: goal.id, task: taskDescription, mode: 'inspect', source: 'discord', metadata: goal.metadata });
        jobStore.updateJob(goal.id, { status: 'planning' });
        await opts.onJobAccepted?.(goal.id);
        const signal = this._conversationAbortControllers.get(msg.id)?.controller?.signal;
        // Discord inspections have their own read-only execution state. A long
        // engineering goal must not lock out an unrelated owner inspection.
        const inspectionHost = typeof executor.forkReadOnlyInspection === 'function'
            ? executor.forkReadOnlyInspection() : executor;
        if (inspectionHost !== executor && resolveInspectionProject(taskDescription) === 'MAX') {
            inspectionHost.inspectionRoot = this.system?.maxBridge?.maxPath
                || process.env.MAX_PATH || path.resolve(process.cwd(), '..', 'MAX');
        }
        inspectionHost.jobStore = jobStore;
        let raw;
        try { raw = await inspectionHost.execute(goal, { signal }); }
        catch (error) { raw = { state: 'failed', stopReason: 'execution_exception', summary: error.message, errors: [error.message], toolsUsed: [], verification: { passed: false } }; }
        const webResults = (raw.toolResults || []).filter(item => item.tool === 'web_search' && item.success !== false);
        const sourceUrls = [...new Set(webResults.flatMap(item => String(typeof item.result === 'string' ? item.result : JSON.stringify(item.result || '')).match(/https?:\/\/[^\s"<>]+/gi) || []))].slice(0, 3);
        const localEvidence = (raw.toolResults || []).filter(item => ['search_code', 'read_file'].includes(item.tool) && item.success !== false)
            .flatMap(item => item.tool === 'search_code'
                ? (item.result?.matches || []).filter(match => /:\d+:/.test(match)).slice(0, 3)
                : item.result?.path && item.result?.content ? [`${item.result.path}:${item.result.startLine || 1}`] : []).slice(0, 3);
        if (opts.requireWebResearch && raw.state === 'completed' && (!sourceUrls.length || !localEvidence.length)) {
            raw = { ...raw, state: 'blocked', stopReason: 'research_evidence_incomplete', verification: { passed: false },
                summary: `Research incomplete: ${!localEvidence.length ? 'no file:line source evidence; ' : ''}${!sourceUrls.length ? 'no web result with a source URL' : ''}. No improvement was tested or implemented.`,
                errors: [...(raw.errors || []), 'Required source-code and web evidence was not returned.'] };
        }
        const success = raw.state === 'completed' && raw.verification?.passed === true;
        const baseSummary = raw.summary || raw.result || raw.stopReason || 'No verified result was returned.';
        const summary = success && opts.requireWebResearch
            ? `${baseSummary}\nSource evidence: ${localEvidence.map(item => String(item).slice(0, 170)).join(' | ')}\nWeb sources: ${sourceUrls.join(' | ')}\nNo change was implemented or benchmarked.`
            : baseSummary;
        jobStore.updateJob(goal.id, { status: raw.state || 'incomplete', stopReason: raw.stopReason || null,
            summary, result: summary, evidence: raw.evidence || [], toolsUsed: raw.toolsUsed || [],
            toolResults: raw.toolResults || [], iterations: raw.iterations || 0,
            totalIterations: raw.totalIterations ?? raw.iterations ?? 0,
            verification: raw.verification || { passed: false }, errors: raw.errors || [],
            nextStep: success ? null : raw.nextStep || 'Narrow the inspection and retry with the missing source evidence.' });
        return {
            success,
            summary: success ? summary : `Inspection ${raw.state || 'incomplete'}: ${summary}`,
            toolsUsed: raw.toolsUsed || [],
            stepCount: raw.totalIterations ?? raw.iterations ?? 0,
            jobId: goal.id,
            raw
        };
    }

    async _queuePersistentDiscordTask(task, channelId = null) {
        if (['engineering', 'trading_diagnostic', 'app_build'].includes(task.kind)) {
            const preflight = await preflightDiscordEngineering({ root: process.cwd(), request: task.request });
            if (!preflight.ok) return preflight.reply;
            task = { ...task, verifiedTargetPaths: preflight.paths };
        }
        if (!this.goalPlanner?.createGoal) throw new Error('GoalPlanner is not available');
        const outputHint = taskOutputHint(task);
        const workflow = workflowForTask(task);
        const sourceHints = task.domain === 'story_reflections'
            ? ['data/vault/reflections', 'SOMA', 'server/social/StoryPublishingWorkspace.js']
            : task.domain === 'medical_research'
                ? ['data/medical-lab', 'research', 'SOMA']
                : task.domain === 'tech_research'
                    ? ['core', 'arbiters', 'docs', 'SOMA', 'relevant web sources']
                : task.domain === 'paper_trading'
                    ? ['data/market-lab', 'data/trading', 'server/finance', 'paper-trading ledgers and sim-to-live reports']
                : ['SOMA workspace and relevant web sources'];
        const tradingInstructions = task.kind === 'trading_diagnostic' ? [
            'This is a paper-trading diagnostic and improvement job, not a generic engineering or monetization request.',
            'Use market_lab_status, sim_to_live_status, sim_to_live_reconcile, and bounded backtests as applicable. Inspect real trade attribution and current strategy configuration before recommending a change.',
            'Do not promise profit, do not enable live trading, and do not weaken promotion or risk gates. Test candidate changes in simulation/paper mode and report measured evidence, limitations, and the next falsifiable experiment.'
        ] : [];
        const allowedTools = ['read_file', 'write_file', 'list_files', 'search_code', 'web_search', 'web_fetch', 'memory_recall', 'memory_store', 'workspace_roots'];
        const allowedWritePaths = [outputHint, path.dirname(outputHint)];
        const result = await this.goalPlanner.createGoal({
            type: 'operational', category: task.category, complexity: 'high',
            title: `Discord ${task.kind}: ${this._formatSafeSnippet(task.request, 100)}`,
            description: [
                `Owner explicitly requested from Discord: ${task.request}`,
                `Task class: ${task.kind}; domain: ${task.domain}.`,
                task.verifiedTargetPaths?.length ? `Resolved/requested target paths: ${task.verifiedTargetPaths.join(', ')}. Read existing files before edits; new-file requests are not proof a file already exists.` : '',
                `Inspect and use relevant sources: ${sourceHints.join(', ')}.`,
                ...tradingInstructions,
                task.kind === 'research' ? 'Use web_fetch for current primary sources and preserve citations.' : 'Use existing local artifacts as source material; do not invent missing facts.',
                task.kind === 'app_build'
                    ? 'Build a runnable app in the owner-controlled computer workspace, install only necessary dependencies, and run its tests/build.'
                    : task.kind === 'engineering'
                        ? 'Diagnose the reported SOMA behavior against current source and receipts, make the smallest governed source change that addresses the cause, run focused syntax/tests, and write a concise completion artifact with the changed files and evidence.'
                        : 'Create one cohesive, structured artifact in the owner-controlled computer workspace with source provenance and unresolved contradictions clearly marked.',
                `Required output: ${outputHint}`,
                'Call workspace_roots first, then use workspace_mkdir/workspace_write for the absolute output path. Use workspace_exec for app builds/tests.',
                'Do not stop at planning. Write the output, read it back, and verify it before claiming completion. Preserve workspace transaction IDs in evidence so Owner can request rollback.'
            ].join('\n'),
            priority: 96, requireQuality: true,
            assignedTo: ['SomaAgenticExecutor', 'EngineeringSwarmArbiter'], confidence: 0.96,
            successCriteria: task.kind === 'trading_diagnostic' ? [
                `A paper-trading diagnostic exists at ${outputHint}`,
                'The diagnostic cites the actual paper PnL, win rate, profit factor, trade count, and active strategy evidence',
                'At least one bounded strategy experiment is measured and live promotion remains blocked',
                'The completion report cites artifact paths and verification evidence'
            ] : [
                `A concrete output exists at ${outputHint}`,
                'The output was read back or built/tested successfully',
                'The completion report cites artifact paths and verification evidence'
            ],
            verification: {
                required: true,
                evidence: ['written artifact', 'read-back or build/test output', 'source provenance'],
                filesExist: [outputHint],
                containsAnyGroups: task.kind === 'trading_diagnostic' ? [
                    ['paper trading', 'paper-trading'],
                    ['pnl', 'p&l'],
                    ['win rate'],
                    ['profit factor'],
                    ['strategy', 'backtest', 'simulation'],
                    ['live promotion remains blocked', 'live trading remains blocked', 'paper mode']
                ] : []
            },
            metadata: {
                source: 'discord_admin', requestedBy: 'Owner', sourceChannelId: channelId,
                turnIntent: task.contextParentGoalId ? INTENT_TYPES.CONTINUE_PREVIOUS_TASK : INTENT_TYPES.NEW_TASK,
                taskKind: task.kind, domain: task.domain, outputHint,
                originalRequest: task.request, contextParentGoalId: task.contextParentGoalId || null,
                workflow,
                expectedArtifact: outputHint, executionMode: 'atomic', allowDecomposition: false,
                evidenceRequired: ['summary', 'artifact'],
                allowedTools,
                allowedWritePaths,
                goalContract: {
                    maxAttempts: 3,
                    allowedTools,
                    allowedWritePaths,
                    evidenceRequired: ['summary', 'artifact'],
                    verification: {
                        filesExist: [outputHint], evidenceRequired: ['summary', 'artifact'],
                        containsAnyGroups: task.kind === 'trading_diagnostic' ? [
                            ['paper trading', 'paper-trading'], ['pnl', 'p&l'], ['win rate'], ['profit factor'],
                            ['strategy', 'backtest', 'simulation'], ['live promotion remains blocked', 'live trading remains blocked', 'paper mode']
                        ] : []
                    }
                }
            }
        }, 'user');
        if (!result?.success) throw new Error(result?.error || 'GoalPlanner rejected the task');
        workLedger.record({ type: 'discord_persistent_task', title: task.request, summary: `Queued ${task.kind} as ${result.goalId}.`, evidence: [result.goalId, outputHint], nextStep: 'SomaAgenticExecutor must create and verify the artifact.', status: 'queued', source: 'DiscordArbiter', confidence: 0.97 });
        this._startGoalProgressUpdates(result.goalId, channelId);

        return [`I accepted that as a real background job.`, `Goal: \`${result.goalId}\``, `Type: ${task.kind}`, `Expected output: \`${outputHint}\``, 'I will report only meaningful state changes or verified completion.'].join('\n');
    }

    _clearGoalProgress(goalId) {
        const timer = this._goalProgressTimers.get(goalId);
        if (timer) clearInterval(timer);
        this._goalProgressTimers.delete(goalId);
    }

    _startGoalProgressUpdates(goalId, channelId) {
        if (!goalId || !channelId || !this.client || this._channelProgressMode.get(channelId) === 'off') return;
        this._clearGoalProgress(goalId);
        const goal = this.goalPlanner?.goals?.get?.(goalId);
        let signature = goal ? `${goal.status}:${goal.metadata?.executionAttempts || 0}:${goal.metadata?.lastVerification?.passed ?? ''}` : '';
        const timer = setInterval(async () => {
            try {
                const current = this.goalPlanner?.goals?.get?.(goalId);
                const stopped = !current || ['completed', 'failed', 'blocked', 'rejected', 'broken', 'deferred', 'verification_failed', 'abandoned', 'archived'].includes(current.status);
                if (stopped) { this._clearGoalProgress(goalId); return; }
                const next = `${current.status}:${current.metadata?.executionAttempts || 0}:${current.metadata?.lastVerification?.passed ?? ''}`;
                if (next === signature) return;
                signature = next;
                const channel = await this.client.channels.fetch(channelId).catch(() => null);
                if (!channel) return;
                const derived = deriveGoalState(current);
                const state = { queued: TASK_STATES.ACCEPTED, ready: TASK_STATES.PLANNING,
                    awaiting_evidence: TASK_STATES.VERIFYING, deferred: TASK_STATES.BLOCKED,
                    delegated: TASK_STATES.EXECUTING }[derived] || derived;
                const sent = await channel.send(formatProgressMessage(goalId, state, String(current.title || goalId).slice(0, 120)));
                if (sent?.id) this._goalProgressMessages.set(sent.id, goalId);
            } catch {
                this._clearGoalProgress(goalId);
            }
        }, 45000);
        timer.unref?.();
        this._goalProgressTimers.set(goalId, timer);
    }

    // Intake gate: only mint a self-executing engineering goal from a genuinely
    // ACTIONABLE request. Conversational admin chatter ("u think max can fix it?",
    // "have you done anything to self modify") was being turned into goals that can
    // never verify-complete, clogging the goal queue — the root of the stall loops.
    _isActionableEngineeringRequest(text = '', pathCandidate = null, options = {}) {
        if (isDiscordFeedbackOrCritique(text)) return false;
        if (options.authorized === true && String(text || '').trim().length >= 8) return true;
        const t = String(text || '').trim();
        if (!isExplicitGoalAuthorization(t) && !/^(?:please\s+)?(?:edit|modify|remove|patch|change|update|wire|add|deploy)\b/i.test(t)) return false;
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
        // Shared ingress: direct commands AND model QUEUE_GOAL tags pass here.
        const preflight = await preflightDiscordEngineering({ root: process.cwd(), request: text, filename: pathCandidate });
        if (!preflight.ok) return preflight.reply;
        pathCandidate = preflight.paths[0] || null;
        const title = `Discord admin engineering request: ${this._formatSafeSnippet(text, 90)}`;
        const description = [
            `Owner requested this from Discord: ${text}`,
            pathCandidate ? `Target file mentioned: ${pathCandidate}` : 'No exact target file was provided. Inspect the repo first, then choose the smallest safe change.',
            preflight.paths.length > 1 ? `Other resolved/requested paths: ${preflight.paths.slice(1).join(', ')}` : '',
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
                    turnIntent: INTENT_TYPES.NEW_TASK,
                    originalRequest: text,
                    pathCandidate,
                    requestedBy: 'Owner',
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
                metadata: { requestedBy: 'Owner', pathCandidate }
            });
            return `I queued a real EngineeringSwarm goal: \`${id}\`. I will not call it complete until the swarm reports evidence.`;
        }

        return `I cannot create a goal right now: neither GoalPlanner nor EngineeringSwarm are available in the system.`;
    }

    _isOwnWorkQuestion(text = '') {
        return isDiscordWorkStatusRequest(text);
    }

    async _handleSourceInspection(msg, text) {
        const key = `${msg.guildId || 'DM'}:${msg.channelId}:${msg.author?.id}`;
        const previous = this._sourceInspectionBySession.get(key);
        const fresh = previous && Date.now() - previous.readAt < 30 * 60_000;
        if (!isDiscordSourceInspection(text, fresh)) return { handled: false };
        if (!this._isSovereignOperator(msg)) {
            await msg.reply('Source inspection requires the configured Discord owner ID.');
            return { handled: true };
        }
        try {
            const snapshot = await inspectDiscordSource({ root: process.cwd(), filename: this._extractPathCandidate(text) || previous?.path,
                query: `${text}\n${fresh ? previous.query : ''}`, execute: (tool, args) => this._executeRegistryTool(tool, args) });
            this._sourceInspectionBySession.set(key, { ...snapshot, query: text.slice(0, 1000) });
            if (this._sourceInspectionBySession.size > 100) this._sourceInspectionBySession.delete(this._sourceInspectionBySession.keys().next().value);
            await msg.reply(snapshot.reply);
            await this._recordDiscordInteraction({ msg, content: text, reply: snapshot.reply, action: 'source_inspection', status: 'posted',
                metadata: { path: snapshot.path, lineCount: snapshot.lineCount, readAt: snapshot.readAt } });
        } catch (error) {
            await msg.reply(`I couldn't inspect that source: ${error.message}`);
        }
        return { handled: true };
    }

    async _handleCodebaseInspection(msg, text) {
        if (!isCodebaseInspectionRequest(text)) return { handled: false };
        if (!this._isSovereignOperator(msg)) {
            await msg.reply('Source inspection requires the configured Discord owner ID.');
            return { handled: true };
        }
        try {
            let project = resolveInspectionProject(text);
            if (!project) {
                const recent = await this.readMessages({ channelId: msg.channelId, limit: 12 });
                project = resolveInspectionProject(text, recent.filter(row => row.id !== msg.id).reverse(), { userId: msg.author.id });
            }
            if (!project) {
                await msg.reply('Do you mean MAX or SOMA? I can inspect either codebase read-only.');
                return { handled: true };
            }
            const root = project === 'MAX'
                ? this.system?.maxBridge?.maxPath || process.env.MAX_PATH || path.resolve(process.cwd(), '..', 'MAX')
                : process.cwd();
            const result = await inspectImprovementCodebase({ root, project, query: text });
            let remaining = result.reply;
            while (remaining.length) {
                let cut = Math.min(remaining.length, 1900);
                if (cut < remaining.length) {
                    const boundary = remaining.lastIndexOf('\n', cut);
                    if (boundary > 800) cut = boundary + 1;
                }
                await msg.reply(remaining.slice(0, cut).trimEnd());
                remaining = remaining.slice(cut);
            }
            await this._recordDiscordInteraction({ msg, content: text, reply: result.reply, action: 'codebase_inspection', status: 'posted',
                metadata: { intent: INTENT_TYPES.NEW_TASK, inspectionId: msg.id, project,
                    reads: result.reads.map(({ path, sha256, lineCount }) => ({ path, sha256, lineCount })),
                    findings: (result.findings || []).slice(0, 8).map(({ id, severity, filePath, lineNumbers, observedFact }) => ({ id, severity, filePath, lineNumbers, observedFact })) } });
        } catch (error) {
            await msg.reply(`I couldn't complete the codebase inspection: ${this._formatSafeSnippet(error.message, 350)}. No changes were made.`);
        }
        return { handled: true };
    }

    async _handleMaxFolderInspection(msg, text) {
        if (!isMaxFolderInspectionRequest(text)) return { handled: false };
        if (!this._isSovereignOperator(msg)) {
            await msg.reply('MAX folder inspection requires the configured Discord owner ID.');
            return { handled: true };
        }
        try {
            const root = this.system?.maxBridge?.maxPath || process.env.MAX_PATH || path.resolve(process.cwd(), '..', 'MAX');
            const result = await inspectProjectFolder({ root, project: 'MAX' });
            await msg.reply(result.reply);
            await this._recordDiscordInteraction({ msg, content: text, reply: result.reply,
                action: 'max_folder_inspection', status: 'posted',
                metadata: { root: result.root, listed: result.top.length, recent: result.recent } });
        } catch (error) {
            const reply = `I could not inspect MAX: ${this._formatSafeSnippet(error.message, 280)}. I have no folder findings to report.`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply,
                action: 'max_folder_inspection', status: 'failed', error: error.message });
        }
        return { handled: true };
    }

    async _recentArchitectureContext(msg) {
        const state = await this._readActivityState().catch(() => null);
        const now = Date.now();
        return state?.replies?.find(row => row.channelId === msg.channelId && row.authorId === msg.author?.id
            && row.action === 'codebase_inspection' && row.status === 'posted'
            && now - Number(row.createdAt || 0) < 2 * 60 * 60_000) || null;
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
        // Pasted source is discussion, not a command or a file named res.json.
        if (isPastedCode(text)) return { handled: false };

        const priorInspection = this._sourceInspectionBySession.get(`${msg.guildId || 'DM'}:${msg.channelId}:${msg.author?.id}`);
        if (this.system?.agenticExecutor?.execute && priorInspection && Date.now() - priorInspection.readAt < 30 * 60_000
            && /^(?:the whole file[, ]*(?:try reading it)?|(?:can you |please )?read (?:it|that|the (?:whole )?file))(?: please)?[.!?]*$/i.test(text)) {
            return this._handleLiveAgentExecution(msg, text, { inspectionTask: `read ${priorInspection.path}` });
        }

        if (/^(?:what|which) tools (?:do you (?:already )?have|are (?:available|implemented))\??$/i.test(text)) {
            if (!this._isSovereignOperator(msg)) {
                await msg.reply('Tool inventory requires the configured Discord owner ID.');
            } else {
                const names = this.system?.agenticExecutor?.getToolNames?.() || this.system?.toolRegistry?.getToolsManifest?.().map(t => t.name) || [];
                await msg.reply(names.length ? `Registered tools: ${names.join(', ').slice(0, 1700)}. Availability still depends on the task's permissions; this is an inventory, not an execution.` : 'I could not read the live tool inventory. That does not mean no tools are implemented.');
            }
            return { handled: true };
        }

        if (this.system?.agenticExecutor?.execute && simpleInspectionAction(text)) {
            return this._handleLiveAgentExecution(msg, text, { inspectionTask: text });
        }

        let breezyRequest = isBreezyBacktestRequest(text);
        if (!breezyRequest && (isDirectedBacktestRequest(text) || isBreezyBacktestApproval(text)) && this._isSovereignOperator(msg)) {
            const recent = await this.readMessages({ channelId: msg.channelId, limit: 16 }).catch(() => []);
            breezyRequest = recent.some(item => item.id !== msg.id
                && Date.now() - Number(item.createdAt || 0) < 30 * 60_000
                && /\bBreezy(?: Bee)?\b/i.test(item.content));
        }
        if (breezyRequest) return this._handleBreezyPaperBacktest(msg, text, visualContext);

        if (/\b(?:communicate|message|ask|contact)\b.{0,55}\b(?:max|machine b)\b/i.test(text)
            && /\b(?:diagnos|fix|repair|inspect|check|leak|reasoning)\w*/i.test(text)) {
            return this._handleMaxPeerDiagnostic(msg, text, visualContext);
        }

        const isAdmin = this._isAdminUser(msg);
        if (isAdmin && /\b(heartbeat|status updates?|check-?ins?|pings?)\b/i.test(text) && /\b(stop|cancel|disable|no more|quiet|annoying|less|fewer)\b/i.test(text)) {
            const off = /\b(stop|cancel|disable|no more)\b/i.test(text);
            this._channelProgressMode.set(msg.channelId, off ? 'off' : 'milestones');
            if (off) {
                for (const [goalId, timer] of this._goalProgressTimers) {
                    clearInterval(timer);
                    this._goalProgressTimers.delete(goalId);
                }
            }
            const reply = off ? 'Status updates are off. Goals will continue unless you cancel them.' : 'I will send only meaningful goal state changes—no repeated heartbeat beats.';
            await msg.reply(reply);
            return { handled: true };
        }

        const isCancelCommand = isAdmin && (
            /^(?:cancel|abort|terminate|kill|stop)\s+(?:(?:the|this|that|my)\s+)?(?:active\s+)?(?:goal|task|job|run|backtest)\b/i.test(text.trim()) ||
            /^(?:cancel|abort|terminate|kill|stop)\s*(?:it|this|that)?[.!]?$/i.test(text.trim()) ||
            (/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(text) && /\b(cancel|abort|terminate|kill)\b/i.test(text))
        );
        if (isCancelCommand) {
            const activeConversation = [...this._conversationAbortControllers.entries()]
                .filter(([messageId, entry]) => messageId !== msg.id && entry.channelId === msg.channelId)
                .sort((a, b) => Number(b[1].startedAt || 0) - Number(a[1].startedAt || 0))[0];
            if (activeConversation) {
                const [messageId, entry] = activeConversation;
                entry.controller.abort(new Error('Discord owner requested cancellation'));
                this.conversationJobs.cancel(messageId, 'operator_requested');
                await msg.reply(`Cancelled the active conversation/council job \`${messageId}\`.`);
                return { handled: true };
            }
            const explicitId = text.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i)?.[0];
            const goals = [...(this.goalPlanner?.goals?.values?.() || [])]
                .filter(goal => !['completed', 'failed', 'blocked', 'rejected', 'broken', 'deferred', 'verification_failed', 'abandoned', 'archived'].includes(goal.status))
                .filter(goal => !msg.channelId || !goal.metadata?.sourceChannelId || goal.metadata.sourceChannelId === msg.channelId)
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
            const goal = explicitId ? this.goalPlanner?.goals?.get?.(explicitId) : goals[0];
            if (!goal) {
                await msg.reply('There is no active goal in this channel to cancel.');
                return { handled: true };
            }
            const cancelled = await this.goalPlanner.cancelGoal(goal.id, 'Discord owner requested cancellation');
            if (cancelled?.success) this._clearGoalProgress(goal.id);
            await msg.reply(cancelled?.success ? `Cancelled goal \`${goal.id}\`: ${goal.title}` : `I could not cancel that goal: ${cancelled?.error || 'unknown error'}`);
            return { handled: true };
        }
        const operatorReviewCommand = this._parseOperatorReviewCommand(text);
        if (operatorReviewCommand) {
            return await this._handleOperatorReviewCommand(msg, operatorReviewCommand, visualContext);
        }

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

        const sourceInspection = await this._handleSourceInspection(msg, text);
        if (sourceInspection.handled) return sourceInspection;

        const codebaseInspection = await this._handleCodebaseInspection(msg, text);
        if (codebaseInspection.handled) return codebaseInspection;
        const maxFolderInspection = await this._handleMaxFolderInspection(msg, text);
        if (maxFolderInspection.handled) return maxFolderInspection;

        if (/\b(?:daily review|daily trading review)\b/i.test(text)
            && /\b(?:set up|schedule|start|go ahead|remind|9\s*(?:am|a\.m\.))\b/i.test(text)) {
            if (!this._isSovereignOperator(msg)) {
                await msg.reply('The daily review schedule requires the configured Discord owner ID.');
                return { handled: true };
            }
            const { default: notificationService } = await import('../server/services/NotificationService.js');
            notificationService.startDailySummarySchedule();
            const reply = `The daily trading, BeeBot, and RSI review is scheduled for ${notificationService.nextDailyReviewAt || 'the next local 9:00 AM'} (local 9:00 AM). This is a schedule state, not a delivered review; Discord delivery is checked when it runs.`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'daily_review_schedule', status: 'posted', visualContext,
                metadata: { nextRunAt: notificationService.nextDailyReviewAt || null } });
            return { handled: true };
        }

        // The owner already authorized this read-only follow-up. Keep its
        // source context and execute the research instead of asking again.
        if (isDiscordImprovementResearchRequest(text)) {
            if (!this._isSovereignOperator(msg)) {
                await msg.reply('Architecture research requires the configured Discord owner ID.');
                return { handled: true };
            }
            const prior = await this._recentArchitectureContext(msg);
            const findings = (prior?.metadata?.findings || []).map(f => `${f.id} ${f.filePath}:${f.lineNumbers} ${f.observedFact}`).join('; ').slice(0, 850);
            const inspectionTask = [
                `Read-only architecture improvement research requested by the owner: ${text}`,
                prior ? `Prior inspection ${prior.metadata?.inspectionId || prior.id} of ${prior.metadata?.project || 'the project'} reported: ${findings || prior.responseText?.slice(0, 600) || 'no retained findings'}. Treat this as context, not proof; verify source lines again.` : 'No prior inspection receipt is available; establish source evidence first.',
                'Use search_code/read_file to identify exact file:line evidence, then web_search for relevant external ideas and source URLs. Record an evidence-backed observation. Do not edit code or claim an idea was tested.'
            ].join('\n');
            return this._handleLiveAgentExecution(msg, text, { inspectionTask, requireWebResearch: true, contextParentGoalId: prior?.metadata?.inspectionId || null });
        }

        const contextualRsiFollowup = /^(?:so\s+)?(?:it(?:'|’)?s|it is)\s+not\s+working\??$|^rsi\s+(?:is|remains|still)\s+(?:a\s+)?(?:challenge|blocked|stuck)\b/i.test(text);
        let recentRsiStatus = false;
        if (contextualRsiFollowup) {
            const state = await this._readActivityState().catch(() => null);
            const latest = state?.replies?.find(row => row.channelId === msg.channelId && row.authorId === msg.author?.id);
            recentRsiStatus = latest?.action === 'grounded_improvement_status'
                && Date.now() - Number(latest.createdAt || 0) < 10 * 60_000;
        }
        if (isDiscordImprovementStatusRequest(text) || recentRsiStatus) {
            if (!this._isSovereignOperator(msg)) {
                await msg.reply('Detailed self-improvement records require the configured Discord owner ID.');
                return { handled: true };
            }
            let reply;
            try { reply = improvementStatusReply(this.system); }
            catch { reply = 'I could not read my live self-improvement records. I have no verified progress to report on this turn.'; }
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'grounded_improvement_status', status: 'posted', visualContext });
            return { handled: true };
        }

        if (/\b(?:bee\s?bots?|breezy|boozy|bizzy)\b/i.test(text)
            && /\b(?:how|doing|status|performance|p\s*&?\s*l|pnl|winning|losing|equity|portfolio|trades?)\b/i.test(text)
            && !isDirectedBacktestRequest(text)) {
            const reply = await this._buildBeeTradingStatusReply();
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'grounded_bee_trading_status', status: 'posted', visualContext });
            return { handled: true };
        }

        if (this._isTradingStatusQuestion(text)) {
            const reply = await this._buildTradingStatusReply();
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'grounded_trading_status', status: 'posted', visualContext });
            return { handled: true };
        }

        if (this._isOwnWorkQuestion(text)) {
            const reply = await this._buildOwnWorkReply(text);
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'grounded_own_work_status', status: 'posted', visualContext });
            return { handled: true };
        }

        if (/\b(?:image|picture|render)\b/i.test(text) && isDiscordStatusOrCapabilityQuestion(text)) {
            const reply = await this._buildStateAwareStatusReply(text, msg);
            await msg.reply(reply);
            return { handled: true };
        }

        // Image intents must be resolved before the broad engineering-task router.
        const asksImageAnalysisCapability = this._isImageAnalysisCapabilityQuestion(text);
        if (this._isImageCapabilityQuestion(text) && !(asksImageAnalysisCapability && visualContext)) {
            const analysis = asksImageAnalysisCapability;
            const reply = analysis
                ? 'Yes. Attach an image and tell me what you want changed. I will analyze its visible subject, composition, colors, and text, then use that analysis to create the requested transformed illustration.'
                : 'Yes. Tell me what image you want and I will generate and attach it here.';
            this.pendingImagePromptChannels.set(msg.channelId, { timestamp: Date.now(), authorId: msg.author?.id });
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: text, reply, action: 'capability_reply', status: 'posted', visualContext });
            return { handled: true };
        }

        // Check if there is an active pending image prompt in this channel from recent capability inquiry
        const pendingImage = this.pendingImagePromptChannels.get(msg.channelId);
        const isFreshPendingImage = pendingImage && (Date.now() - pendingImage.timestamp < 5 * 60 * 1000);
        if (isFreshPendingImage) {
            const trimmed = String(text || '').trim();
            if (/^(?:no|cancel|nevermind|stop|wait|nah|abort)[.!, ]*$/i.test(trimmed)) {
                this.pendingImagePromptChannels.delete(msg.channelId);
                const cancelReply = 'Image generation cancelled.';
                await msg.reply(cancelReply);
                await this._recordDiscordInteraction({ msg, content: text, reply: cancelReply, action: 'image_prompt_cancelled', status: 'posted', visualContext });
                return { handled: true };
            }
            if (!this._isOwnWorkQuestion(text) && !isDiscordWorkStatusRequest(text) && !isCodebaseInspectionRequest(text)) {
                this.pendingImagePromptChannels.delete(msg.channelId);
                await this._replyWithGeneratedImage(msg, text, visualContext);
                return { handled: true };
            }
        }

        if (this._isImageRequest(text)) {
            await this._replyWithGeneratedImage(msg, text, visualContext);
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

        if (this._isFinanceQuestion(text)) {
            return { handled: false };
        }

        if (this._isMedicalQuestion(text)) {
            return { handled: false };
        }

        return { handled: false };
    }

    async _handleMaxPeerDiagnostic(msg, request, visualContext = '') {
        if (!this._isSovereignOperator(msg)) {
            await msg.reply('MAX peer diagnostics require the configured Discord owner ID. No message was sent.');
            return { handled: true };
        }
        const store = this.system?.executionJobStore;
        const registry = this.system?.toolRegistry;
        if (!store?.createJob || !registry?.getTool?.('max_peer_message')) {
            await msg.reply('The MAX bridge or persistent job store is unavailable. No peer message was sent.');
            return { handled: true };
        }
        const job = store.createJob({ jobId: crypto.randomUUID(), task: redactBacktestText(request), mode: 'inspect', source: 'discord',
            metadata: { taskKind: 'max_peer_diagnostic', sourceMessageId: msg.id, sourceChannelId: msg.channelId,
                authorization: { authorized: true, mode: 'inspect', modificationsAllowed: false, approvalRequiredFor: ['max_code_change'] } } });
        const ack = `Created MAX diagnostic job \`${job.jobId}\`. State: queued. I will send a real advisory message through the cluster bridge; no MAX code change is authorized by this step.`;
        await msg.reply(ack);
        await this._recordDiscordInteraction({ msg, content: redactBacktestText(request), reply: ack,
            action: 'max_peer_diagnostic', status: 'queued', visualContext, metadata: { jobId: job.jobId } });
        void (async () => {
            try {
                store.updateJob(job.jobId, { status: 'executing' });
                store.appendEvent(job.jobId, { type: 'tool_started', tool: 'max_peer_message' });
                const receipt = await registry.execute('max_peer_message', {
                    message: 'Please inspect your Discord output path for leaked <thinking> or <ending> tags. Report exact source paths and evidence; do not change code or claim a repair.',
                    sourceJobId: job.jobId
                }, { actor: 'DiscordOperator', authorityTier: 'frontier', goalId: job.jobId, sessionId: job.jobId });
                store.appendEvent(job.jobId, { type: 'tool_finished', tool: 'max_peer_message', success: receipt.deliveryStatus === 'delivered', messageId: receipt.messageId });
                const delivered = receipt.deliveryStatus === 'delivered';
                const terminal = store.updateJob(job.jobId, { status: delivered ? 'incomplete' : 'failed',
                    stopReason: delivered ? 'max_repair_not_performed' : 'max_delivery_failed',
                    summary: delivered ? `MAX bridge responded to message ${receipt.messageId}. No code repair was performed. ${receipt.responsePreview || ''}`.slice(0, 1200)
                        : `MAX peer message failed: ${receipt.error || 'unknown bridge error'}`,
                    evidence: [receipt.receiptPath, receipt.messageId, receipt.responseId].filter(Boolean),
                    toolsUsed: ['max_peer_message'], toolResults: [{ tool: 'max_peer_message', success: delivered, messageId: receipt.messageId, receiptPath: receipt.receiptPath }],
                    verification: { passed: false, checks: delivered ? ['peer_message_delivered', 'repair_not_verified'] : ['peer_message_failed'] },
                    nextStep: delivered ? 'Inspect MAX source and tests, then request a governed repair in the MAX workspace.' : 'Check MAX bridge health and retry the advisory.' });
                await msg.reply(`MAX diagnostic job \`${job.jobId}\`: ${terminal.status}. ${terminal.summary}`.slice(0, 1900)).catch(() => {});
            } catch (error) {
                const safeError = redactBacktestText(error.message);
                store.updateJob(job.jobId, { status: 'failed', stopReason: 'max_bridge_exception', summary: safeError,
                    errors: [safeError], verification: { passed: false }, nextStep: 'Check MAX bridge health and retry.' });
                await msg.reply(`MAX diagnostic job \`${job.jobId}\` failed: ${safeError}`.slice(0, 1900)).catch(() => {});
            }
        })();
        return { handled: true };
    }

    async _handleBreezyPaperBacktest(msg, request, visualContext = '') {
        if (!this._isSovereignOperator(msg)) {
            await msg.reply('Paper-backtest execution requires the configured Discord owner ID. No job was created.');
            return { handled: true };
        }
        const store = this.system?.executionJobStore;
        const registry = this.system?.toolRegistry;
        if (!store?.createJob || !registry?.getTool?.('bee_paper_backtest')) {
            await msg.reply('I cannot execute Breezy backtests: the persistent job store or bee_paper_backtest tool is unavailable. No job was started.');
            return { handled: true };
        }
        const active = findChannelBeeBacktest(store, msg.channelId);
        if (active) {
            await msg.reply(`Breezy paper-backtest job \`${active.jobId}\` is already ${active.status}. I did not start a duplicate.`);
            return { handled: true };
        }
        if (isBreezyBacktestApproval(request) && !isDirectedBacktestRequest(request)) {
            const recent = (store.listJobs?.({ limit: 100 }) || []).find(item => item.metadata?.taskKind === 'bee_paper_backtest'
                && item.metadata?.sourceChannelId === msg.channelId && Date.now() - Number(item.createdAt || 0) < 30 * 60_000);
            if (recent) {
                await msg.reply(`That Breezy backtest already has job \`${recent.jobId}\` (${recent.status}). ${recent.summary || 'No final result yet.'}`.slice(0, 1900));
                return { handled: true };
            }
        }
        let createdJob = null;
        try {
            const { job, duplicate } = queueBreezyBacktest({
                store, registry, request, channelId: msg.channelId, messageId: msg.id,
                onTerminal: async terminal => {
                    const artifact = terminal.metadata?.artifactPath ? `\nComparison: \`${terminal.metadata.artifactPath}\`` : '';
                    const reply = `Breezy paper-backtest job \`${terminal.jobId}\` ${terminal.status}. ${terminal.summary}${artifact}`.slice(0, 1900);
                    await msg.reply(reply);
                }
            });
            createdJob = job;
            const current = store.getJob(job.jobId) || job;
            const reply = duplicate
                ? `Breezy paper-backtest job \`${job.jobId}\` already exists. State: ${current.status}.`
                : `Created Breezy paper-backtest job \`${job.jobId}\`. State: ${current.status}. This is research only; active Bee strategies and live trading will not change.`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({ msg, content: redactBacktestText(request), reply,
                action: 'bee_paper_backtest', status: current.status, visualContext,
                metadata: { jobId: job.jobId, experimentId: job.metadata?.experimentId, authorization: job.metadata?.authorization } });
        } catch (error) {
            const safeError = redactBacktestText(error.message);
            if (createdJob) {
                this.log('warn', `Breezy backtest job ${createdJob.jobId} was created but Discord acknowledgment failed: ${safeError}`);
                await msg.reply(`Breezy paper-backtest job \`${createdJob.jobId}\` exists. Check its status; Discord acknowledgment failed: ${safeError}`)
                    .catch(() => {});
            } else {
                await msg.reply(`I could not create the paper-backtest job: ${safeError}. No execution was claimed.`)
                    .catch(() => {});
            }
        }
        return { handled: true };
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
        const asksGoals = /\b(goals?|tasks?|jobs?|blocked|blocking|failed|failure|attempts?)\b/i.test(text);
        const lines = ['Here is the recorded work status:'];

        if (asksPapers) {
            lines.push('I do not have a peer-reviewed paper. I have internal research folios, dry-lab notes, market evidence logs, and reflection artifacts.');
        }

        if (asksGoals) {
            const goals = this.goalPlanner?.goals instanceof Map
                ? [...this.goalPlanner.goals.values()]
                    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
                    .slice(0, 4)
                : [];
            if (goals.length) {
                lines.push('Recent goal states:');
                for (const goal of goals) {
                    const reason = goal.metadata?.lastTransition?.reason
                        || goal.metadata?.failureReason
                        || goal.failureReason
                        || goal.reason
                        || goal.error
                        || 'no recorded terminal reason';
                    lines.push(`- ${this._formatSafeSnippet(goal.title || goal.id || 'goal', 90)} — ${this._formatSafeSnippet(goal.status || deriveGoalState(goal), 28)}; reason: ${this._formatSafeSnippet(reason, 100)}.`);
                }
                lines.push('A blocked state records that the executor did not satisfy its evidence contract; it does not prove a DeepSeek, network, or memory-corruption cause unless the receipt says so.');
            } else {
                lines.push('I do not have a readable goal record for that claim, so I cannot name a cause yet.');
            }
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
            workItems = workLedger.listVerified(3);
        } catch {}
        if (workItems.length) {
            lines.push('Recent verified completion receipts:');
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
            lines.push('No matching work records are available right now.');
        }

        return lines.join('\n').slice(0, 1900);
    }

    async _buildStateAwareStatusReply(text = '', msg = {}) {
        if (/\b(?:image|picture|render)\b/i.test(text) && /\b(?:job|status|progress|what happened|finish|fail)\b/i.test(text)) {
            const jobs = this.system?.executionJobStore?.listJobs?.({ limit: 100 }) || [];
            const job = jobs.find(item => item.mode === 'image_generation'
                && (!msg.channelId || item.metadata?.sourceChannelId === msg.channelId));
            if (job) return [
                `Image job \`${job.jobId}\`: ${job.status}.`,
                job.summary || 'No result recorded yet.',
                job.metadata?.attachmentDelivered ? 'A verified Discord attachment was delivered.' : 'No verified attachment was delivered.',
                job.stopReason ? `Reason: ${job.stopReason}.` : ''
            ].filter(Boolean).join('\n');
        }
        if (/\b(?:backtest|breezy|bee\s?bot)\b/i.test(text)) {
            const jobs = this.system?.executionJobStore?.listJobs?.({ limit: 100 }) || [];
            const job = jobs.find(item => item.metadata?.taskKind === 'bee_paper_backtest'
                && (!msg.channelId || item.metadata?.sourceChannelId === msg.channelId));
            if (job) return [
                `Breezy paper-backtest job \`${job.jobId}\`: ${job.status}.`,
                job.summary || 'No result recorded yet.',
                job.metadata?.artifactPath ? `Comparison: \`${job.metadata.artifactPath}\`.` : '',
                job.errors?.length ? `Failure: ${job.errors.at(-1)}.` : '',
                job.nextStep || ''
            ].filter(Boolean).join('\n');
        }
        const executor = this.system?.agenticExecutor;
        const executorReady = Boolean(executor?.execute);
        const executorName = executor?.name || 'SomaAgenticExecutor';

        // Check active / queued goals
        const goals = this.goalPlanner?.goals instanceof Map ? [...this.goalPlanner.goals.values()] : [];
        const activeGoals = goals
            .filter(g => ['active', 'executing', 'planning', 'in_progress'].includes(g.status))
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));

        // Check terminal / recent goals
        const recentTerminal = goals
            .filter(g => ['completed', 'blocked', 'failed', 'incomplete'].includes(g.status))
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
            .slice(0, 3);

        const lines = [
            `🧠 **SOMA Execution Substrate Status**:`,
            `- **Motor Cortex / Executor**: ${executorReady ? `Online (${executorName})` : 'Offline / Unavailable'}`,
            `- **Active Jobs**: ${activeGoals.length}`
        ];

        if (activeGoals.length > 0) {
            lines.push(`**Current Active Work**:`);
            for (const g of activeGoals.slice(0, 3)) {
                lines.push(`- [Job: \`${g.id}\` | State: \`${g.status || 'executing'}\`] **${this._formatSafeSnippet(g.title, 80)}**`);
            }
        }

        if (recentTerminal.length > 0) {
            lines.push(`**Recent Job History**:`);
            for (const g of recentTerminal) {
                const reason = g.metadata?.lastTransition?.reason
                    || g.metadata?.failureReason
                    || g.failureReason
                    || g.metadata?.lastVerification?.summary
                    || 'completed without recorded error';
                lines.push(`- [Job: \`${g.id}\` | State: \`${g.status}\`] **${this._formatSafeSnippet(g.title, 70)}** — ${this._formatSafeSnippet(reason, 90)}`);
            }
            const latest = recentTerminal[0];
            if (['blocked', 'failed', 'incomplete'].includes(latest.status) && latest.metadata?.latestAutopsy) {
                try {
                    const autopsy = JSON.parse(await fs.readFile(latest.metadata.latestAutopsy, 'utf8'));
                    if (autopsy.failedStep) lines.push(`Last failed step: ${this._formatSafeSnippet(autopsy.failedStep, 100)}.`);
                    if (autopsy.lastError) lines.push(`Last error: ${this._formatSafeSnippet(autopsy.lastError, 160)}.`);
                    if (autopsy.alternativePlan) lines.push(`Bounded retry: ${this._formatSafeSnippet(autopsy.alternativePlan, 170)}.`);
                } catch { lines.push('The last autopsy could not be read; I cannot add detail beyond the recorded goal state.'); }
            }
        } else {
            lines.push(`- **Recent History**: No prior execution jobs recorded in memory.`);
        }

        lines.push(executorReady
            ? 'I can run a new bounded read-only inspection. A blocked earlier task is not still executing or completed; retrying it needs a narrower plan.'
            : 'I cannot execute a new task until the executor is available.');
        return lines.join('\n');
    }

    async _replyWithGeneratedImage(msg, text, visualContext = '') {
        const jobStore = this.system?.executionJobStore;
        const imageJobId = `image-${msg.id}`;
        if (jobStore?.createJob && !jobStore.getJob?.(imageJobId)) {
            jobStore.createJob({ jobId: imageJobId, task: redactBacktestText(text), mode: 'image_generation', source: 'discord',
                metadata: { sourceMessageId: msg.id, sourceChannelId: msg.channelId, attachmentDelivered: false, attempts: 0 } });
        }
        const prompt = this._extractImagePrompt(text);
        const useCreativeCouncil = String(process.env.SOMA_CREATIVE_IMAGE_COUNCIL || 'true').toLowerCase() !== 'false';
        // The engine's AURORA -> Bonsai -> vision loop supersedes the old
        // one-shot refiner. Keep the latter as a feature-flagged fallback.
        const refinedPrompt = useCreativeCouncil ? prompt : await this._refineImagePrompt(prompt);
        const reference = visualContext
            ? ` Use this factual analysis of the attached reference image: ${String(visualContext).replace(/^\[SOMA-VISION:\s*|\]$/g, '').slice(0, 1200)}. Preserve its recognizable subject and composition while applying the requested transformation.`
            : '';
        const ratio = String(text).match(/\b(9)\s*[x:]\s*(16)|(16)\s*[x:]\s*(9)\b/i);
        const width = ratio?.[1] ? 576 : ratio?.[3] ? 1024 : 768;
        const height = ratio?.[1] ? 1024 : ratio?.[3] ? 576 : 768;
        const promptMentionsComputer = /\b(computer|monitor|laptop|keyboard|screen|terminal|server|desktop|pc|workstation|code editor|interface|ui)\b/i.test(prompt);
        const negativeTech = promptMentionsComputer
            ? ''
            : ' No computers, no laptop, no desktop monitor, no keyboard, no screens, no UI, no office workstation.';
        let reply = '';
        let artifact = null;
        let delivery = null;
        let generated = null;
        try {
            jobStore?.updateJob?.(imageJobId, { status: 'executing', metadata: {
                ...jobStore.getJob(imageJobId)?.metadata, attempts: 1, providerStatus: 'invoked'
            } });
            jobStore?.appendEvent?.(imageJobId, { type: 'tool_started', tool: 'image_generation' });
            for (let attempt = 1; attempt <= 2; attempt++) {
                jobStore?.updateJob?.(imageJobId, { metadata: {
                    ...jobStore.getJob(imageJobId)?.metadata, attempts: attempt, providerStatus: 'invoked'
                } });
                if (attempt > 1) jobStore?.appendEvent?.(imageJobId, { type: 'tool_started', tool: 'image_generation', attempt });
                try {
                    generated = await somaImageGeneration.generate({
                        prompt: `${refinedPrompt}.${reference} No readable text, no captions, no watermark, no logo, no signs.${negativeTech}`,
                        title: `discord-${prompt}`,
                        purpose: 'discord',
                        publicPost: false,
                        strictArtDirector: false,
                        skipArtDirector: false,
                        creativeCouncil: useCreativeCouncil,
                        requireRealRenderer: true,
                        sourceText: `${prompt}${reference}`,
                        priority: 'human',
                        requestId: msg.id,
                        traceId: `discord-image:${msg.id}`,
                        maxBytes: 8_000_000,
                        tags: ['discord-request'],
                        width,
                        height
                    });
                    break;
                } catch (error) {
                    if (attempt === 2 || !/\b(?:500|Internal Server Error)\b/i.test(error.message)) throw error;
                    jobStore?.appendEvent?.(imageJobId, { type: 'tool_finished', tool: 'image_generation', attempt,
                        success: false, reason: 'provider_500' });
                }
            }

            if (!generated?.provider || /^fallback/i.test(generated.provider)) {
                throw new Error('No real image renderer produced this image; synthetic fallback is not a Discord result.');
            }
            if (generated.artDirector?.approved === false || generated.creativeCouncil?.approved === false
                || generated.creativeCouncil?.subjectPresent === false) {
                throw new Error('Generated image failed visual subject-alignment review.');
            }
            artifact = await inspectGeneratedImage(generated?.image?.path, { maxBytes: 8_000_000 });
            jobStore?.updateJob?.(imageJobId, { status: 'verifying' });

            const directedPrompt = generated.prompt || refinedPrompt;
            const subjectVerified = generated.creativeCouncil?.verified === true
                && generated.creativeCouncil?.subjectPresent === true;
            const reviewUnavailable = generated.creativeCouncil?.enabled === true && !subjectVerified;
            const isOwner = msg.author?.id === this.masterId || /owner/i.test(msg.author?.username || '');
            const showPromptDebug = String(process.env.SOMA_DISCORD_IMAGE_DEBUG || 'false').toLowerCase() === 'true';
            reply = showPromptDebug
                ? (directedPrompt === prompt ? `I made this from: ${prompt}` : `I made this from: ${prompt}\nAURORA-directed prompt: ${directedPrompt}`)
                : (reviewUnavailable
                    ? 'I generated and attached the image, but could not independently verify that it matches your requested subject.'
                    : (isOwner ? 'Here you go, Owner!' : 'Here you go!'));
            let sent = await msg.reply({
                content: 'Image attachment — verifying delivery.',
                files: [new AttachmentBuilder(artifact.path, { name: artifact.name })]
            });
            if (sent?.id && (!sent.attachments || sent.attachments.size === 0) && typeof sent.fetch === 'function') sent = await sent.fetch();
            delivery = verifyDiscordImageDelivery(sent, artifact);
            const renderer = { provider: generated.provider,
                briefStatus: generated.creativeBrief?.status || null,
                reviewStatus: generated.creativeCouncil?.status || null, subjectVerified };
            const receiptPath = await persistImageReceipt({ requestId: msg.id, status: 'delivered', artifact, delivery, renderer }, this.imageReceiptRoot);
            jobStore?.appendEvent?.(imageJobId, { type: 'tool_finished', tool: 'image_generation', success: true });
            jobStore?.updateJob?.(imageJobId, { status: 'completed', summary: subjectVerified
                ? 'Renderer image generated, visually checked, and delivered as a Discord attachment.'
                : 'Renderer image generated and delivered; visual subject match was not independently verified.',
                evidence: [receiptPath, artifact.path, artifact.sha256, delivery.messageId],
                toolsUsed: ['image_generation'], verification: { passed: true, subjectVerified,
                    checks: ['real_renderer', 'non_empty_image', 'image_mime', 'discord_attachment', ...(subjectVerified ? ['visual_subject'] : [])] },
                metadata: { ...jobStore.getJob(imageJobId)?.metadata, artifactPath: artifact.path, receiptPath,
                    attachmentDelivered: true, providerStatus: 'completed', provider: generated.provider, subjectVerified } });
            if (typeof sent.edit === 'function') await sent.edit({ content: reply }).catch(() => {});
            await this._recordDiscordInteraction({
                msg,
                content: text,
                reply: `${reply} [image: ${artifact.path} sha256: ${artifact.sha256.slice(0, 12)}]`,
                action: 'image_generation',
                status: 'posted',
                visualContext,
                metadata: { receiptPath, artifact, delivery }
            });
        } catch (e) {
            const safeError = redactBacktestText(e.message);
            this.log('warn', `Image generation verification failed: ${safeError}`);
            const receiptPath = await persistImageReceipt({ requestId: msg.id, status: 'failed', artifact, delivery,
                renderer: { provider: generated?.provider || null }, error: safeError }, this.imageReceiptRoot).catch(() => null);
            const reason = /\b(?:500|Internal Server Error)\b/i.test(e.message) ? 'provider_500'
                : /\b(?:timeout|deadline|aborted)\b/i.test(e.message) ? 'timeout'
                : /\b(?:real image renderer|synthetic fallback|renderer is configured)\b/i.test(e.message) ? 'renderer_unavailable'
                : /\b(?:visual subject|subject-alignment)\b/i.test(e.message) ? 'visual_mismatch'
                : /\b(?:attachment|upload|discord)\b/i.test(e.message) ? 'upload_failed' : 'invalid_artifact';
            jobStore?.appendEvent?.(imageJobId, { type: 'tool_finished', tool: 'image_generation', success: false, reason });
            jobStore?.updateJob?.(imageJobId, { status: 'failed', stopReason: reason,
                summary: `Image generation failed: ${safeError}`, errors: [safeError],
                evidence: [receiptPath].filter(Boolean), verification: { passed: false, checks: [] },
                metadata: { ...jobStore.getJob(imageJobId)?.metadata, receiptPath, attachmentDelivered: false, providerStatus: reason } });
            reply = `I could not generate that image: ${safeError} (job \`${imageJobId}\`, ${reason}).`;
            await msg.reply(reply);
            await this._recordDiscordInteraction({
                msg,
                content: text,
                reply,
                action: 'image_generation',
                status: 'failed',
                error: safeError,
                visualContext,
                metadata: { receiptPath, artifact, delivery }
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

    async _recordDiscordInteraction({ msg, content, reply, action = 'reply', status = 'posted', error = null, visualContext = '', metadata = null }) {
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
                metadata,
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
        const attachments = Array.from(msg.attachments?.values?.() || msg.attachments || []);
        const image = attachments.find(a => isImageFile(a.name || a.url || '', a.contentType || ''));
        if (!image) return "";

        this.log('info', `👁️ Analyzing image attachment: ${image.name}`);
        try {
            // Download attachment to temp buffer/file
            if (Number(image.size || 0) > 15_000_000) throw new Error('Image exceeds the 15 MB analysis limit');
            const response = await fetch(image.url, { signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw new Error(`Discord attachment download returned ${response.status}`);
            const buffer = await response.arrayBuffer();
            const ext = path.extname(image.name || '') || '.png';
            const tempPath = path.join(process.cwd(), '.soma', `vision_temp_${Date.now()}${ext}`);
            await fs.mkdir(path.dirname(tempPath), { recursive: true });
            await fs.writeFile(tempPath, Buffer.from(buffer));

            let description = '';
            try {
                const analysis = await this.attachmentAnalyzer(tempPath, {
                    mimeType: image.contentType,
                    prompt: 'Describe only what is visibly present in this image. Include the subject, composition, colors, style, and visible text so it can be transformed accurately.',
                    mode: /\b(read|text|ocr|code|error|exact)\b/i.test(msg.content || '') ? 'ocr' : 'deep'
                });
                description = analysis?.summary || analysis?.description || '';
                if (analysis?.ocrText) description += ` Visible text: ${analysis.ocrText}`;
                if (analysis?.perception?.uncertainties?.length) description += ` Uncertainty: ${analysis.perception.uncertainties.join('; ')}`;
            } catch (primaryError) {
                if (!this.vision?.detectObjects) throw primaryError;
                const analysis = await this.vision.detectObjects(tempPath);
                description = this.vision.buildNaturalDescription?.(analysis) || JSON.stringify(analysis);
            }

            // Cleanup temp file
            await fs.unlink(tempPath).catch(() => {});

            if (description) {
                this.log('info', `👁️ Vision Result: ${description}`);
                return `[SOMA-VISION: She sees an image. Analysis: ${description}]`;
            }
        } catch (e) {
            this.log('warn', `Vision processing failed: ${e.message}`);
            return `[SOMA-VISION: An image was attached, but analysis failed: ${e.message}. Do not claim that no image was attached.]`;
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
        if (this._liveApprovalTimer) clearInterval(this._liveApprovalTimer);
        this._liveApprovalTimer = null;
        for (const timer of this._goalProgressTimers.values()) clearInterval(timer);
        this._goalProgressTimers.clear();
        await this._setActivityConnection(false).catch(() => {});
        if (this.client) {
            this.client.destroy();
        }
        await super.onShutdown();
    }
}

export default DiscordArbiter;
