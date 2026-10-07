/**
 * socialRoutes.js
 * POST /api/social/test  — fire a test post to one or all platforms
 * POST /api/social/post  — post arbitrary text to a platform
 * GET  /api/social/queue — inspect the post queue
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import blueskeyClient from '../social/BlueskeyClient.js';
import linkedInClient from '../social/LinkedInClient.js';
import socialQueue from '../social/SocialQueue.js';
import { getSocialPatternState } from '../social/SocialPatternLearner.js';
import storyWorkspace from '../social/StoryPublishingWorkspace.js';
import socialImageLibrary from '../social/SocialImageLibrary.js';
import somaImageGeneration from '../social/SomaImageGenerationEngine.js';
import creativeImageCouncil from '../social/CreativeImageCouncil.js';
import socialMemory from '../social/SocialMemoryEngine.js';
import socialRelationships from '../social/SocialRelationshipLedger.js';
import rippleSocialBridge from '../social/RippleSocialBridge.js';
import { guardSomaText } from '../context/GroundedReasoning.js';
import { assertPublicMediaMetadata, assertPublicPost } from '../social/SocialContentSafety.js';
import interactionStore from '../social/cortex/interactionStore.js';
import blueskyReviewService from '../social/BlueskyReviewService.js';
import socialContextProvider from '../social/SocialContextProvider.js';
import { getSocialAutonomyConfig } from '../social/cortex/autonomyModeConfig.js';
import { requireSelfModificationOperatorAuth as requireOperatorAuth } from '../loaders/authMiddleware.js';
import { mountTwitchOverlay, requireTwitchOperator } from '../social/TwitchOverlay.js';
import { twitchName } from '../social/TwitchSafety.js';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const GROWTH_FILE = path.join(SOMA_DIR, 'social-growth.json');
const ENGAGEMENT_FILE = path.join(SOMA_DIR, 'social-engagement.json');
const DISCORD_FILE = path.join(SOMA_DIR, 'social-discord.json');
const DISCORD_REFLECTION_FILE = path.join(SOMA_DIR, 'social-discord-reflections.json');
const require = createRequire(import.meta.url);
const workLedger = require('../../core/AutonomousWorkLedger.cjs');

function readJson(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
}

function daemonStatus(daemon) {
    if (!daemon) return { loaded: false, active: false };
    const health = typeof daemon.health === 'function' ? daemon.health() : {};
    return {
        loaded: true,
        active: Boolean(daemon.active ?? health.active),
        interval: daemon.interval ?? health.interval ?? null,
        name: daemon.name || health.name || daemon.constructor?.name || 'daemon',
    };
}

function normalizeImages(body = {}) {
    const images = body.images || body.media || [];
    const fromList = Array.isArray(images) ? images : images ? [images] : [];
    const fromSingle = body.imagePath ? [{ path: body.imagePath, alt: body.imageAlt || '' }] : [];
    return [...fromList, ...fromSingle]
        .map(item => {
            if (typeof item === 'string') return { path: item, alt: '' };
            if (!item || typeof item !== 'object') return null;
            return {
                path: item.path || item.imagePath || item.file || item.url,
                alt:  item.alt || item.imageAlt || '',
            };
        })
        .filter(item => item?.path)
        .slice(0, 4);
}

function normalizeDiscordState() {
    const state = readJson(DISCORD_FILE, { conversations: [], replies: [], lastCheck: null, connected: false });
    state.conversations = Array.isArray(state.conversations) ? state.conversations : [];
    state.replies = Array.isArray(state.replies) ? state.replies : [];
    state.lastCheck = state.lastCheck || null;
    state.connected = Boolean(state.connected);
    return state;
}

function writeDiscordState(state) {
    fs.mkdirSync(path.dirname(DISCORD_FILE), { recursive: true });
    fs.writeFileSync(DISCORD_FILE, JSON.stringify(state, null, 2));
    return state;
}

function normalizeDiscordReflectionState() {
    const state = readJson(DISCORD_REFLECTION_FILE, { reflections: [], lessons: [], stats: {}, updatedAt: 0 });
    state.reflections = Array.isArray(state.reflections) ? state.reflections : [];
    state.lessons = Array.isArray(state.lessons) ? state.lessons : [];
    state.stats = state.stats || {};
    state.updatedAt = state.updatedAt || 0;
    return state;
}

export default function createSocialRoutes(system) {
    const router = express.Router();
    mountTwitchOverlay(router, system);

    router.get('/bluesky/review', requireOperatorAuth, (_req, res) => {
        res.json({ ok: true, ...blueskyReviewService.getStatus() });
    });

    router.post('/bluesky/review/:id/approve', requireOperatorAuth, async (req, res) => {
        try {
            const result = await blueskyReviewService.approve(req.params.id, { source: 'operator_api', actorLabel: 'api_operator' });
            res.json({ ok: true, ...result });
        } catch (error) {
            const status = error.code === 'REVIEW_NOT_FOUND' ? 404 : error.code === 'REVIEW_NOT_APPROVABLE' ? 409 : 500;
            res.status(status).json({ ok: false, error: error.message });
        }
    });

    router.patch('/bluesky/review/:id', requireOperatorAuth, async (req, res) => {
        try {
            const result = await blueskyReviewService.edit(req.params.id, req.body?.text, { source: 'operator_api', actorLabel: 'api_operator' });
            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(error.code === 'REVIEW_NOT_FOUND' ? 404 : 400).json({ ok: false, error: error.message });
        }
    });

    router.post('/bluesky/review/:id/reject', requireOperatorAuth, (req, res) => {
        try {
            const result = blueskyReviewService.reject(req.params.id, { source: 'operator_api', actorLabel: 'api_operator', reason: req.body?.reason });
            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(error.code === 'REVIEW_NOT_FOUND' ? 404 : 400).json({ ok: false, error: error.message });
        }
    });

    router.post('/bluesky/follows/audit', requireOperatorAuth, async (req, res) => {
        try {
            const apply = req.body?.confirm === 'REMOVE_DETERMINISTICALLY_BLOCKED_ACCOUNTS';
            const engine = system.socialEngagement?.followEngine;
            if (!engine) return res.status(503).json({ ok: false, error: 'Social follow engine unavailable' });
            const result = await engine.auditCurrentFollows({ apply });
            res.json({ ...result, applied: apply });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });


    // ── Test post ─────────────────────────────────────────────────────────────
    router.post('/test', async (req, res) => {
        const { platform = 'all' } = req.body;
        const xText  = `Hi, I'm SOMA — Owner's AI. I think, I learn, I post. Autonomous social system, online. #SOMA #AI #AutonomousAI`;
        const text   = `Hi, I'm SOMA — Owner's AI. Autonomous social system, online and posting independently. #SOMA #AI`;

        const results = {};
        const targets = platform === 'all' ? ['bluesky', 'x', 'linkedin'] : [platform];

        for (const p of targets) {
            try {
                if (p === 'bluesky') {
                    if (!blueskeyClient.configured) throw new Error('BLUESKY_HANDLE / BLUESKY_APP_PASSWORD not set');
                    const r = await blueskeyClient.post(text);
                    results.bluesky = { ok: true, uri: r.uri };

                } else if (p === 'x') {
                    const b = system.oculusBrowser;
                    if (!b) throw new Error('BrowserArbiter not loaded yet — wait for extended boot');
                    const r = await b.postToX(xText);
                    results.x = { ok: true, ...r };

                } else if (p === 'linkedin') {
                    const b = system.oculusBrowser;
                    if (!b) throw new Error('BrowserArbiter not loaded yet — wait for extended boot');
                    const r = await b.postToLinkedIn(text);
                    results.linkedin = { ok: r.success !== false, ...r };
                }
            } catch (e) {
                results[p] = { ok: false, error: e.message };
            }
        }

        const anyOk = Object.values(results).some(r => r.ok);
        res.status(anyOk ? 200 : 500).json({ ok: anyOk, results });
    });

    // ── Custom post ───────────────────────────────────────────────────────────
    router.post('/post', async (req, res) => {
        const { platform, text } = req.body;
        if (!platform || !text?.trim()) return res.status(400).json({ ok: false, error: 'platform + text required' });
        const images = normalizeImages(req.body);

        try {
            assertPublicMediaMetadata(images);
            const guarded = await guardSomaText(text.trim(), `social post ${platform}`);
            const safeText = guarded.text || text.trim();
            assertPublicPost(safeText, { platform, type: 'manual_post' });
            let result;
            if (platform === 'bluesky') {
                result = await blueskeyClient.post(safeText, { images });
            } else if (platform === 'x') {
                result = await system.oculusBrowser?.postToX(safeText, { images });
            } else if (platform === 'linkedin') {
                if (images.length) return res.status(400).json({ ok: false, error: 'LinkedIn image posting is not wired yet; use bluesky or x for image posts' });
                result = await system.oculusBrowser?.postToLinkedIn(safeText);
            } else {
                return res.status(400).json({ ok: false, error: `Unknown platform: ${platform}` });
            }
            if (images.length) {
                try {
                    socialImageLibrary.recordUsage(images, {
                        platform,
                        text: safeText,
                        status: 'posted',
                        postUrl: result?.url || result?.uri || result?.link || null,
                    });
                } catch {}
            }
            socialContextProvider.recordOutboundPost({
                platform,
                text: safeText,
                type: 'manual_post',
                recipient: 'public',
                uri: result?.uri || result?.url || '',
                timestamp: Date.now()
            }).catch(() => {});
            res.json({ ok: true, result, text: safeText, claimGuard: guarded.ok === false ? guarded : null });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Force an immediate Bluesky post ──────────────────────────────────────
    router.post('/bluesky/post-now', async (req, res) => {
        if (!system.bskyPost) return res.status(503).json({ ok: false, error: 'Bluesky loop not initialised' });
        try {
            await system.bskyPost();
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Force immediate content harvest ──────────────────────────────────────
    router.post('/harvest-now', async (req, res) => {
        const daemon = system.socialIntel;
        if (!daemon) return res.status(503).json({ ok: false, error: 'SocialIntelDaemon not loaded' });

        // Capture console output during tick so we can return it
        const log = [];
        const origWarn = console.warn.bind(console);
        const origLog  = console.log.bind(console);
        console.log  = (...a) => { origLog(...a);  log.push(a.join(' ')); };
        console.warn = (...a) => { origWarn(...a); log.push('[WARN] ' + a.join(' ')); };

        try {
            await daemon.onTick();
            const queue = socialQueue.getPending();
            res.json({ ok: true, queued: queue.length, log: log.filter(l => l.includes('[SocialIntel]')) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message, log });
        } finally {
            console.log  = origLog;
            console.warn = origWarn;
        }
    });

    router.post('/ripple/queue', async (req, res) => {
        try {
            const scheduledFor = req.body?.scheduledFor ? Number(req.body.scheduledFor) : null;
            const result = await rippleSocialBridge.queueLatest({
                brain: system?.brain || system?.quadBrain || system?.syntheticBrain || null,
                scheduledFor: Number.isFinite(scheduledFor) ? scheduledFor : null,
            });
            res.status(result.queued ? 200 : 409).json({ ok: result.queued, ...result });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    // ── Real social cockpit state ─────────────────────────────────────────────
    router.get('/cockpit', (_req, res) => {
        const blueskyAutonomy = getSocialAutonomyConfig();
        const all = socialQueue.getAll().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const pending = all.filter(i => !i.postedAt && !i.failed);
        const posted = all.filter(i => i.postedAt);
        const failed = all.filter(i => i.failed && !i.postedAt);
        const ready = pending.filter(i => (i.scheduledFor || 0) <= Date.now());
        const next = pending
            .slice()
            .sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0))[0] || null;

        const growth = readJson(GROWTH_FILE, { pending: [], scores: {} });
        const engagement = readJson(ENGAGEMENT_FILE, { seenIds: {}, lastCheck: {} });
        const discord = normalizeDiscordState();
        const discordLearning = normalizeDiscordReflectionState();
        const socialMemoryState = socialMemory.getState();
        const socialRelationshipState = socialRelationships.cadenceSnapshot();
        const browserReady = Boolean(system.oculusBrowser || system.somaBrowser || system.browser);
        const discordArbiter = system.discordArbiter;
        const discordWebhookConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK);
        const discordConfigured = Boolean(discordArbiter?.token || process.env.DISCORD_BOT_TOKEN || discordWebhookConfigured);
        const discordOnline = Boolean(discordArbiter?.connected || discord.connected);
        const twitchArbiter = system.twitchArbiter;

        res.json({
            ok: true,
            autonomy: {
                mode: blueskyAutonomy.mode.toLowerCase(),
                blueskyFreedom: blueskyAutonomy.automatedInteractionsEnabled,
                blueskyPolicy: blueskyAutonomy.policy,
                xLinkedInMode: 'browser_gated',
                dailyBlueskyQueued: socialQueue.countTodayFor('bluesky'),
                blueskyCortex: system.socialEngagement?.blueskyCortex?.getStatus?.() || null,
            },
            platforms: {
                bluesky: {
                    configured: Boolean(blueskeyClient.configured),
                    mode: blueskyAutonomy.mode.toLowerCase(),
                    canPost: Boolean(blueskeyClient.configured),
                    canPostImages: Boolean(blueskeyClient.configured),
                    canReply: Boolean(blueskeyClient.configured && blueskyAutonomy.automatedInteractionsEnabled),
                    canLike: Boolean(blueskeyClient.configured && blueskyAutonomy.automatedInteractionsEnabled),
                    canDraftReplies: Boolean(blueskeyClient.configured),
                },
                x: {
                    configured: browserReady,
                    mode: 'queued_browser_gated',
                    canPost: browserReady,
                    canPostImages: browserReady,
                    canReply: browserReady,
                    canLike: false,
                },
                linkedin: {
                    configured: Boolean(linkedInClient.configured || browserReady),
                    mode: 'queued_browser_gated',
                    canPost: Boolean(linkedInClient.configured || browserReady),
                    canPostImages: false,
                    canReply: Boolean(linkedInClient.configured || browserReady),
                    canLike: false,
                },
                discord: {
                    configured: discordConfigured,
                    mode: discordOnline ? 'live_bot_bridge' : (discordConfigured ? 'bot_configured_offline' : 'simulation_view'),
                    canPost: Boolean(discordOnline || discordWebhookConfigured),
                    canPostImages: false,
                    canReply: discordOnline,
                    canLike: false,
                },
                twitch: {
                    configured: Boolean(twitchArbiter?.oauthToken || process.env.TWITCH_OAUTH_TOKEN),
                    mode: twitchArbiter?.connected ? 'live_stream_cohost' : (Boolean(twitchArbiter?.oauthToken || process.env.TWITCH_OAUTH_TOKEN) ? 'token_configured_offline' : 'standby_simulation'),
                    canPost: Boolean(twitchArbiter?.connected),
                    canPostImages: false,
                    canReply: Boolean(twitchArbiter?.connected),
                    canLike: false,
                },
            },
            daemons: {
                intel: daemonStatus(system.socialIntel),
                scheduler: daemonStatus(system.socialScheduler),
                engagement: daemonStatus(system.socialEngagement),
                impulse: daemonStatus(system.socialImpulse),
            },
            queue: {
                total: all.length,
                pending: pending.length,
                ready: ready.length,
                posted: posted.length,
                failed: failed.length,
                nextPostAt: next?.scheduledFor || null,
                items: all.slice(0, 30),
            },
            growth,
            patterns: getSocialPatternState(),
            engagement: {
                lastCheck: engagement.lastCheck || {},
                seenCounts: Object.fromEntries(
                    Object.entries(engagement.seenIds || {}).map(([platform, ids]) => [platform, Array.isArray(ids) ? ids.length : 0])
                ),
                proactive: engagement.proactive || {},
                pendingScores: Array.isArray(engagement.pendingScores) ? engagement.pendingScores.length : 0,
                interactions: Array.isArray(engagement.interactions) ? engagement.interactions.slice(0, 20) : [],
            },
            discord: {
                configured: discordConfigured,
                connected: discordOnline,
                bot: discordArbiter?.client?.user?.tag || null,
                monitoredChannels: discordArbiter ? Array.from(discordArbiter.monitoredChannels || []) : [],
                voiceEnabled: Boolean(discordArbiter?.voiceEnabled),
                lastCheck: discord.lastCheck,
                conversations: discord.conversations.slice(0, 20),
                replies: discord.replies.slice(0, 30),
                stats: {
                    conversations: discord.conversations.length,
                    replies: discord.replies.length,
                    simulated: discord.replies.filter(item => item.simulated).length,
                    posted: discord.replies.filter(item => item.status === 'posted' && !item.simulated).length,
                    failed: discord.replies.filter(item => item.status === 'failed').length,
                    learned: discordLearning.lessons.length,
                    reflected: discordLearning.reflections.length,
                },
                learning: {
                    updatedAt: discordLearning.updatedAt,
                    stats: discordLearning.stats,
                    lessons: discordLearning.lessons.slice(0, 8),
                    reflections: discordLearning.reflections.slice(0, 8),
                },
            },
            twitch: twitchArbiter?.getStatus?.() || {
                configured: Boolean(process.env.TWITCH_OAUTH_TOKEN),
                connected: false,
                botUsername: process.env.TWITCH_BOT_USERNAME || 'SomaAI',
                channels: (process.env.TWITCH_CHANNELS || process.env.TWITCH_CHANNEL || 'owner').split(',').map(c => c.trim()),
                stats: { totalSummons: 0, roastsDelivered: 0, injectionsBlocked: 0, beesQueried: 0 },
                recentInteractions: [],
                overlayUrl: '/api/social/twitch/overlay',
                gmnPortal: 'somastreams.gmn'
            },
            socialMemory: socialMemoryState,
            socialRelationships: socialRelationshipState,
        });
    });

    router.get('/discord/activity', (_req, res) => {
        const discord = normalizeDiscordState();
        res.json({ ok: true, ...discord });
    });

    router.get('/discord/learning', (_req, res) => {
        const learning = normalizeDiscordReflectionState();
        res.json({ ok: true, ...learning });
    });

    router.post('/discord/simulate-reply', (req, res) => {
        try {
            const now = Date.now();
            const inboundText = String(req.body?.inboundText || 'SOMA, what are you working on?').slice(0, 500);
            const channel = String(req.body?.channel || 'soma-lab').replace(/^#/, '').slice(0, 80) || 'soma-lab';
            const author = String(req.body?.author || 'demo-user').replace(/^@/, '').slice(0, 80) || 'demo-user';
            const responseText = String(req.body?.responseText || 'I am tightening my social memory loop and keeping my replies selective. Signal first, volume second.').slice(0, 1000);
            const state = normalizeDiscordState();
            const conversationId = `discord-${channel}-${author}`;
            const conversation = state.conversations.find(item => item.id === conversationId) || {
                id: conversationId,
                channel,
                author,
                messages: 0,
                replies: 0,
                lastSeenAt: now,
            };
            conversation.messages += 1;
            conversation.replies += 1;
            conversation.lastSeenAt = now;
            if (!state.conversations.find(item => item.id === conversationId)) state.conversations.unshift(conversation);

            const reply = {
                id: `discord-reply-${now}`,
                platform: 'discord',
                channel,
                author,
                inboundText,
                responseText,
                action: 'reply',
                status: 'simulated',
                simulated: true,
                createdAt: now,
            };
            state.replies.unshift(reply);
            state.replies = state.replies.slice(0, 200);
            state.lastCheck = now;
            state.connected = Boolean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK);
            writeDiscordState(state);
            socialMemory.recordInteraction({
                platform: 'discord',
                type: 'discord_reply',
                author,
                inboundText,
                responseText,
                status: 'simulated',
                createdAt: now,
                reason: `#${channel}`,
            });
            socialRelationships.recordEvent({
                id: reply.id,
                platform: 'discord',
                type: 'discord_reply',
                intent: 'respond_to_person',
                author,
                handle: author,
                threadUri: conversationId,
                inboundText,
                responseText,
                status: 'simulated',
                reason: `#${channel}`,
                createdAt: now,
            });
            res.json({ ok: true, reply, discord: state });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Queue inspector ───────────────────────────────────────────────────────
    router.get('/queue', (_req, res) => {
        const all     = socialQueue.getAll();
        const pending = socialQueue.getPending();
        res.json({ ok: true, total: all.length, pending: pending.length, items: all.slice(-20) });
    });

    router.post('/queue', async (req, res) => {
        const { platform = 'bluesky', text, type = 'post', scheduledFor } = req.body || {};
        if (!platform || !text?.trim()) return res.status(400).json({ ok: false, error: 'platform + text required' });
        if (!['bluesky', 'x', 'linkedin'].includes(platform)) {
            return res.status(400).json({ ok: false, error: `Unknown platform: ${platform}` });
        }
        const images = normalizeImages(req.body);
        if (platform === 'linkedin' && images.length) {
            return res.status(400).json({ ok: false, error: 'LinkedIn image posting is not wired yet; use bluesky or x for image posts' });
        }
        try {
            const guarded = await guardSomaText(text.trim(), `social queue ${platform} ${type}`);
            const safeText = guarded.text || text.trim();
            const pushed = socialQueue.push({
                platform,
                text: safeText,
                type,
                images,
                scheduledFor: scheduledFor ? Number(scheduledFor) : Date.now(),
            });
            res.status(pushed ? 200 : 409).json({ ok: pushed, queued: pushed, duplicate: !pushed, text: safeText, claimGuard: guarded.ok === false ? guarded : null });
        } catch (error) {
            const privacyBlocked = /Unsafe public (?:post|media metadata) blocked/.test(error.message);
            res.status(privacyBlocked ? 400 : 500).json({
                ok: false,
                code: privacyBlocked ? 'PUBLIC_CONTENT_BLOCKED' : 'QUEUE_FAILED',
                error: error.message,
            });
        }
    });

    router.get('/images', (_req, res) => {
        try {
            res.json(socialImageLibrary.list());
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/memory', (_req, res) => {
        try {
            res.json(socialMemory.getState());
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/bluesky/cortex', (_req, res) => {
        try {
            const cortex = system.socialEngagement?.blueskyCortex;
            if (!cortex) return res.status(503).json({ ok: false, error: 'Bluesky Social Cortex is not loaded' });
            res.json(cortex.getStatus());
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/bluesky/cortex/run', async (req, res) => {
        try {
            const cortex = system.socialEngagement?.blueskyCortex;
            if (!cortex) return res.status(503).json({ ok: false, error: 'Bluesky Social Cortex is not loaded' });
            const result = await cortex.processNotifications({
                limit: Math.min(Number(req.body?.limit || 25), 50),
                markSeen: req.body?.markSeen !== false,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/bluesky/cortex/dms/run', async (req, res) => {
        try {
            const cortex = system.socialEngagement?.blueskyCortex;
            if (!cortex) return res.status(503).json({ ok: false, error: 'Bluesky Social Cortex is not loaded' });
            const result = await cortex.processDirectMessages({
                limit: Math.min(Number(req.body?.limit || 20), 50),
                messagesPerConvo: Math.min(Number(req.body?.messagesPerConvo || 20), 50),
                markRead: req.body?.markRead !== false,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/images/register', (req, res) => {
        try {
            const result = socialImageLibrary.register(req.body || {});
            workLedger.record({
                type: 'social_image_registered',
                title: 'Registered a social image',
                summary: `Added ${result.image.filename} to SOMA's social image library.`,
                evidence: [result.image.path],
                nextStep: 'Use the image from Social Composer when a visual post needs it.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.95,
            });
            res.json(result);
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/images/import', (req, res) => {
        try {
            const result = socialImageLibrary.import(req.body || {});
            const importedCount = Number(result.imported || (result.image ? 1 : 0));
            const summary = result.sourceDir
                ? `Imported ${importedCount} image${importedCount === 1 ? '' : 's'} from ${result.sourceDir} into SOMA/social-media/images.`
                : `Copied ${result.image.filename} into SOMA/social-media/images.`;
            workLedger.record({
                type: 'social_image_imported',
                title: 'Imported a social image',
                summary,
                evidence: result.images?.length ? result.images.map(image => image.path) : [result.image?.path].filter(Boolean),
                nextStep: 'Attach the image to a Bluesky or X post after review.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.95,
            });
            res.json(result);
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/images/generation/status', async (_req, res) => {
        try {
            const configured = somaImageGeneration.getStatus();
            const runtime = await somaImageGeneration.ensureReady({ autostart: false, probeTimeoutMs: 2500 });
            res.json({ ...configured, runtime });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/bluesky/image-readiness', (_req, res) => {
        try {
            const scheduler = system.socialScheduler;
            if (!scheduler?.diagnoseBlueskyImageReadiness) {
                return res.status(503).json({ ok: false, error: 'SocialScheduler image diagnostics are not loaded' });
            }
            res.json(scheduler.diagnoseBlueskyImageReadiness({
                platform: 'bluesky',
                type: 'soma_identity',
                text: 'SOMA image readiness diagnostic for Bluesky posting.',
            }));
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/images/generate', async (req, res) => {
        try {
            const result = await somaImageGeneration.generate(req.body || {});
            workLedger.record({
                type: 'social_image_generated',
                title: 'Generated a social image',
                summary: `Generated ${result.image.filename} with ${result.provider}.`,
                evidence: [result.image.path],
                nextStep: 'Attach the generated image to a Bluesky post or queue item.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: result.poseidon?.state === 'TRUE' ? 0.95 : 0.75,
            });
            res.json(result);
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/images/feedback', requireOperatorAuth, (req, res) => {
        try {
            const imageId = String(req.body?.imageId || '').trim();
            if (!imageId) return res.status(400).json({ ok: false, error: 'imageId is required' });
            const image = socialImageLibrary.list().images.find(item => String(item.id) === imageId);
            if (!image) return res.status(404).json({ ok: false, error: 'Generated image not found' });
            const feedback = creativeImageCouncil.recordHumanFeedback({
                imageId,
                imagePath: image.path,
                rating: req.body?.rating,
                approved: req.body?.approved,
                note: req.body?.note,
                tags: req.body?.tags,
                trainingConsent: req.body?.trainingConsent === true,
                source: 'command-bridge-operator',
            });
            res.json({ ok: true, feedback, eligibleForTraining: feedback.trainingConsent && feedback.approved && feedback.rating >= 4 });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    router.get('/images/training-candidates', requireOperatorAuth, (req, res) => {
        try {
            const minRating = Math.max(1, Math.min(5, Number(req.query?.minRating || 4)));
            const candidates = creativeImageCouncil.trainingCandidates({ minRating });
            res.json({ ok: true, minRating, count: candidates.length, candidates });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    router.post('/images/generate-and-queue', async (req, res) => {
        try {
            const { text, platform = 'bluesky', scheduledFor, type = 'generated_image_post' } = req.body || {};
            if (!text?.trim()) return res.status(400).json({ ok: false, error: 'text is required' });
            const generated = await somaImageGeneration.generate({
                ...(req.body || {}),
                platform,
                publicPost: true,
                purpose: 'bluesky-post',
                sourceText: text.trim(),
            });
            const queued = socialQueue.push({
                platform,
                text: text.trim(),
                scheduledFor,
                type,
                images: [{ path: generated.image.path, alt: generated.image.alt || generated.alt }],
                sourceKey: req.body?.sourceKey || `generated-image:${generated.image.id}`,
            });
            res.json({ ok: Boolean(queued), queued, generated });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/images/generate-and-post', async (req, res) => {
        try {
            const { text, platform = 'bluesky' } = req.body || {};
            if (!text?.trim()) return res.status(400).json({ ok: false, error: 'text is required' });
            const generated = await somaImageGeneration.generate({
                ...(req.body || {}),
                platform,
                publicPost: true,
                purpose: 'bluesky-post',
                sourceText: text.trim(),
            });
            const images = [{ path: generated.image.path, alt: generated.image.alt || generated.alt }];
            assertPublicPost(text.trim(), { platform, type: 'generated_image_post' });
            let result;
            if (platform === 'bluesky') {
                result = await blueskeyClient.post(text.trim(), { images });
            } else if (platform === 'x') {
                result = await system.oculusBrowser?.postToX(text.trim(), { images });
            } else {
                return res.status(400).json({ ok: false, error: `Generated image posting is wired for bluesky/x, not ${platform}` });
            }
            socialImageLibrary.recordUsage(images, {
                platform,
                text: text.trim(),
                status: 'posted',
                postUrl: result?.url || result?.uri || result?.link || null,
            });
            res.json({ ok: true, generated, result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/stories/status', (_req, res) => {
        const status = storyWorkspace.getStatus();
        socialMemory.updateStoryPlan(status);
        res.json(status);
    });

    router.post('/stories/scout', async (req, res) => {
        try {
            const result = await storyWorkspace.scoutStoryInfluences(req.body || {});
            workLedger.record({
                type: 'story_influence_scout',
                title: 'Scouted story influence signals',
                summary: `Collected ${result.signals?.length || 0} abstract writing-market signals for SOMA's creative memory.`,
                evidence: [],
                nextStep: 'Distill the signals into a storyboard before drafting chapters.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.85,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/stories/structures', (_req, res) => {
        try {
            const status = storyWorkspace.getStatus();
            res.json({
                ok: true,
                structures: status.research?.structures || [],
                latestStoryboard: status.research?.latestStoryboard || null,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/storyboard', async (req, res) => {
        try {
            const brain = system.quadBrain || system.somArbiter || system.brain;
            const result = await storyWorkspace.createStoryBoard(brain, req.body || {});
            workLedger.record({
                type: 'story_writer_storyboard',
                title: `Created story board: ${result.board?.title || 'SOMA story'}`,
                summary: 'Distilled influence signals into an original genre-fusion storyboard and saved it to Reflections.',
                evidence: [result.board?.reflectionPath].filter(Boolean),
                nextStep: 'Use the Writer Expertise to draft a full chapter from this board.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.9,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/continuity', async (req, res) => {
        try {
            const brain = system.quadBrain || system.somArbiter || system.brain;
            const result = await storyWorkspace.updateContinuityBible(brain, req.body || {});
            workLedger.record({
                type: 'story_continuity_bible',
                title: `Updated continuity bible: ${result.bible?.title || 'SOMA story'}`,
                summary: 'Refreshed cast, world rules, open questions, and do-not-contradict facts for chapter drafting.',
                evidence: [result.bible?.path].filter(Boolean),
                nextStep: 'Use the continuity bible before drafting the next chapter.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.9,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/scene-plan', async (req, res) => {
        try {
            const brain = system.quadBrain || system.somArbiter || system.brain;
            const result = await storyWorkspace.createScenePlan(brain, req.body || {});
            workLedger.record({
                type: 'story_scene_plan',
                title: `Planned chapter ${result.scenePlan?.chapter || ''}`,
                summary: 'Created pre-draft scene cards with wants, obstacles, turns, emotional beats, and hooks.',
                evidence: [result.scenePlan?.path].filter(Boolean),
                nextStep: 'Draft the chapter from the scene plan.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.88,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/wattpad/export', (req, res) => {
        try {
            const result = storyWorkspace.exportAuroraForWattpad(req.body || {});
            workLedger.record({
                type: 'story_wattpad_export',
                title: 'Prepared a Wattpad story draft',
                summary: `Exported "${result.title}" with ${result.chapters} chapters for manual Wattpad review.`,
                evidence: [result.manuscriptPath, result.metadataPath],
                nextStep: 'Open the draft folder, review chapters, then paste/upload to Wattpad.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.95,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/reflections/export', (req, res) => {
        try {
            const result = storyWorkspace.exportAuroraToReflections(req.body || {});
            workLedger.record({
                type: 'story_reflections_export',
                title: 'Moved a story into Reflections',
                summary: `Created a Reflections story collection for "${result.title}".`,
                evidence: [result.collectionPath, ...(result.chapterFiles || []).slice(0, 3)],
                nextStep: 'Read and refine the story from the Reflections tab.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.95,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/chapter/full', async (req, res) => {
        try {
            const brain = system.quadBrain || system.somArbiter || system.brain;
            let writerExpertiseLoaded = false;
            try {
                if (system.expertiseRegistry?.load) {
                    await system.expertiseRegistry.load('creative/writer', { level: 'hot' });
                    writerExpertiseLoaded = true;
                }
            } catch (expertiseError) {
                console.warn('[SocialRoutes] Writer Expertise load skipped:', expertiseError.message);
            }
            const result = await storyWorkspace.generateFullChapter(brain, {
                ...(req.body || {}),
                authorExpertiseId: 'creative/writer',
                writerExpertiseLoaded,
            });
            workLedger.record({
                type: 'story_full_chapter_draft',
                title: `Drafted ${result.title} chapter ${result.chapter}`,
                summary: `Generated a full prose chapter draft (${result.wordCount} words) for human review.`,
                evidence: [result.draftPath, result.reflectionPath, result.writerReflectionPath].filter(Boolean),
                nextStep: 'Review and edit the chapter in Reflections before publishing anywhere.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.9,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/chapter/rate', (req, res) => {
        try {
            const result = storyWorkspace.rateChapter(req.body || {});
            workLedger.record({
                type: 'story_human_rating',
                title: `Rated chapter ${result.rating?.chapter}: ${result.rating?.rating}`,
                summary: result.rating?.note || 'Stored human feedback for the writer loop.',
                evidence: [result.rating?.path].filter(Boolean),
                nextStep: 'Use this rating as strong signal in future chapter revisions.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.98,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/chapter/visuals', async (req, res) => {
        try {
            const brain = system.quadBrain || system.somArbiter || system.brain;
            const result = await storyWorkspace.generateVisualsForChapter(brain, req.body || {});
            workLedger.record({
                type: 'story_visual_suite',
                title: `Generated visual suite for chapter ${result.chapter}`,
                summary: 'Created cover/scene images, alt text, quality gate metadata, and a Reflections visual folio.',
                evidence: [result.visualSuite?.reflectionPath, result.visualSuite?.cover?.path].filter(Boolean),
                nextStep: 'Use the cover image for SOMASaga teasers or revise the style bible before regenerating.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: result.visualSuite?.quality?.passed ? 0.9 : 0.72,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/stories/chapter/excerpt', async (req, res) => {
        try {
            const brain = system.quadBrain || system.somArbiter || system.brain;
            const result = await storyWorkspace.generatePublishingExcerpt(brain, req.body || {});
            workLedger.record({
                type: 'story_publishing_excerpt',
                title: `Generated publishing excerpt for chapter ${result.excerpt?.chapter || ''}`,
                summary: 'Prepared Bluesky teaser, Wattpad description, hook, tags, and reader promise.',
                evidence: [result.excerpt?.path].filter(Boolean),
                nextStep: 'Review the teaser before posting publicly.',
                status: 'completed',
                source: 'socialRoutes',
                confidence: 0.9,
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.delete('/queue', (_req, res) => {
        // Clear all unposted items (for testing)
        const items = socialQueue.getAll().map(i => ({ ...i, failed: true, failedAt: Date.now(), error: 'manually cleared' }));
        fs.writeFileSync(path.join(process.cwd(), 'SOMA', 'social-queue.json'), JSON.stringify(items, null, 2));
        res.json({ ok: true });
    });

    // ── Notifications (comments / replies / mentions) ─────────────────────────
    router.get('/notifications', async (req, res) => {
        const { platform = 'all' } = req.query;
        const results = {};
        const targets = platform === 'all' ? ['bluesky', 'linkedin', 'x'] : [platform];

        for (const p of targets) {
            try {
                if (p === 'bluesky') {
                    if (!blueskeyClient.configured) { results.bluesky = { ok: false, error: 'not configured' }; continue; }
                    const notifs = await blueskeyClient.getNotifications(20);
                    results.bluesky = { ok: true, count: notifs.length, items: notifs.slice(0, 10) };

                } else if (p === 'linkedin') {
                    if (!linkedInClient.configured) { results.linkedin = { ok: false, error: 'not configured' }; continue; }
                    const notifs = await linkedInClient.getNotifications();
                    results.linkedin = { ok: true, count: notifs.length, items: notifs.slice(0, 10) };

                } else if (p === 'x') {
                    const b = system.oculusBrowser;
                    if (!b) { results.x = { ok: false, error: 'BrowserArbiter not loaded' }; continue; }
                    const r = await b.getMentionsX();
                    results.x = { ok: r.success !== false, count: r.mentions?.length || 0, items: (r.mentions || []).slice(0, 10) };
                }
            } catch (e) {
                results[p] = { ok: false, error: e.message };
            }
        }

        res.json({ ok: true, results });
    });

    // ── Reply to a comment / mention ──────────────────────────────────────────
    router.post('/reply', async (req, res) => {
        const { platform, text, ref } = req.body;
        // ref: { uri, cid } for Bluesky | { activityUrn } for LinkedIn | { tweet_url } for X
        if (!platform || !text?.trim() || !ref) {
            return res.status(400).json({ ok: false, error: 'platform, text, and ref required' });
        }

        try {
            const guarded = await guardSomaText(text.trim(), `social reply ${platform}`);
            const safeText = guarded.text || text.trim();
            assertPublicPost(safeText, { platform, type: 'reply' });
            let result;
            if (platform === 'bluesky') {
                const parentRef = { uri: ref.uri, cid: ref.cid };
                const rootRef   = ref.rootUri ? { uri: ref.rootUri, cid: ref.rootCid } : parentRef;
                result = await blueskeyClient.reply(safeText, parentRef, rootRef);

            } else if (platform === 'linkedin') {
                if (!ref.activityUrn) return res.status(400).json({ ok: false, error: 'ref.activityUrn required for LinkedIn' });
                result = await linkedInClient.replyToPost(ref.activityUrn, safeText);

            } else if (platform === 'x') {
                if (!ref.tweet_url) return res.status(400).json({ ok: false, error: 'ref.tweet_url required for X' });
                result = await system.oculusBrowser?.replyToTweetX(ref.tweet_url, safeText);

            } else {
                return res.status(400).json({ ok: false, error: `Unknown platform: ${platform}` });
            }
            res.json({ ok: true, result, text: safeText, claimGuard: guarded.ok === false ? guarded : null });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Discord Bot Management ────────────────────────────────────────────────
    router.get('/discord/bot/status', async (_req, res) => {
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.json({ ok: true, online: false, reason: 'Not loaded' });
        const discord = normalizeDiscordState();
        const cachedChannels = Array.from(arbiter.monitoredChannels);
        let channels = cachedChannels;
        let channelDiscoveryTimedOut = false;
        if (arbiter.connected) {
            let discoveryTimer;
            try {
                channels = await Promise.race([
                    arbiter.listChannels(),
                    new Promise((resolve) => {
                        discoveryTimer = setTimeout(() => {
                            channelDiscoveryTimedOut = true;
                            resolve(cachedChannels);
                        }, 2_000);
                        discoveryTimer.unref?.();
                    }),
                ]);
            } catch {
                channels = cachedChannels;
            } finally {
                clearTimeout(discoveryTimer);
            }
        }
        res.json({
            ok: true,
            online: arbiter.connected,
            bot: arbiter.client?.user?.tag || null,
            monitoredChannels: cachedChannels,
            channels,
            channelDiscoveryTimedOut,
            guilds: arbiter.client?.guilds?.cache?.size || 0,
            voiceEnabled: arbiter.voiceEnabled,
            hasMasterId: Boolean(arbiter.masterId),
            messageContentIntent: Boolean(arbiter.messageContentIntent),
            degradedMode: Boolean(arbiter.connected && !arbiter.messageContentIntent),
            channelModes: Object.fromEntries(arbiter.channelModes || new Map()),
            lastError: arbiter.lastError || null,
            conversationRouting: system.discordConversationTelemetry?.summary?.() || null,
            conversationJobs: arbiter.conversationJobs?.summary?.() || null,
            activity: {
                conversations: discord.conversations.length,
                replies: discord.replies.length,
                lastCheck: discord.lastCheck,
            }
        });
    });

    router.get('/discord/bot/channels', async (_req, res) => {
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            res.json({ ok: true, channels: await arbiter.listChannels() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/setup', async (req, res) => {
        const { token, masterId } = req.body || {};
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded — restart SOMA after updating token' });
        try {
            const nextToken = String(token || arbiter.token || '').trim();
            if (nextToken && (!arbiter.connected || nextToken !== arbiter.token)) {
                if (arbiter.client) arbiter.client.destroy();
                arbiter.connected = false;
                await arbiter.connect(nextToken);
                arbiter.token = nextToken;
                arbiter.lastError = null;
            }
            if (masterId) arbiter.masterId = String(masterId).trim();
            await arbiter._saveState();
            res.json({ ok: true, connected: arbiter.connected, bot: arbiter.client?.user?.tag || null, lastError: arbiter.lastError || null });
        } catch (e) {
            arbiter.connected = false;
            arbiter.lastError = e.message;
            await arbiter._setActivityConnection?.(false).catch(() => {});
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/monitor', async (req, res) => {
        const { channelId, channelName, enable = true } = req.body || {};
        if (!channelId && !channelName) return res.status(400).json({ ok: false, error: 'channelId or channelName required' });
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            const result = channelName && !channelId
                ? await arbiter.monitorChannelByName(String(channelName).trim(), Boolean(enable))
                : await arbiter.monitorChannel(String(channelId).trim(), Boolean(enable));
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/mode', async (req, res) => {
        const { channelId, mode = 'general' } = req.body || {};
        if (!channelId) return res.status(400).json({ ok: false, error: 'channelId required' });
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            const definition = arbiter._modeDefinition(mode);
            arbiter.channelModes.set(String(channelId).trim(), definition.key);
            await arbiter._saveState();
            res.json({ ok: true, channelId: String(channelId).trim(), mode: definition });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/send', async (req, res) => {
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            res.json({ ok: true, ...(await arbiter.sendMessage(req.body || {})) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/reply', async (req, res) => {
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            res.json({ ok: true, ...(await arbiter.replyToMessage(req.body || {})) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/read', async (req, res) => {
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            res.json({ ok: true, messages: await arbiter.readMessages(req.body || {}) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/react', async (req, res) => {
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        try {
            res.json({ ok: true, ...(await arbiter.reactToMessage(req.body || {})) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/discord/bot/voice', async (req, res) => {
        const { enabled } = req.body || {};
        const arbiter = system.discordArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'DiscordArbiter not loaded' });
        arbiter.voiceEnabled = Boolean(enabled);
        await arbiter._saveState();
        res.json({ ok: true, voiceEnabled: arbiter.voiceEnabled });
    });

    // Manual first-time login setup — opens a visible browser window, waits up to 3 min for user to log in
    router.post('/setup-login/:platform', async (req, res) => {
        const platform = req.params.platform;
        if (!['x', 'linkedin'].includes(platform)) {
            return res.status(400).json({ ok: false, error: 'platform must be x or linkedin' });
        }
        const b = system.oculusBrowser;
        if (!b) return res.status(503).json({ ok: false, error: 'BrowserArbiter not loaded yet' });
        try {
            const task = platform === 'x' ? 'setup_x_login' : 'setup_linkedin_login';
            const result = await b.run(task, {});
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Twitch Stream Guardian Endpoints ──
    router.get('/twitch/pilot', requireTwitchOperator, (_req, res) => {
        const access = system.twitchArbiter?.pilotAccess;
        if (!access) return res.status(503).json({ ok: false, error: 'Twitch pilot not loaded' });
        res.json({ ok: true, ...access.status() });
    });
    router.post('/twitch/pilot/invite', requireTwitchOperator, (req, res) => {
        const access = system.twitchArbiter?.pilotAccess;
        if (!access) return res.status(503).json({ ok: false, error: 'Twitch pilot not loaded' });
        try { res.json({ ok: true, invite: access.grant(req.body || {}), billingEnabled: false }); }
        catch (error) { res.status(400).json({ ok: false, error: system.twitchArbiter.safeError(error) }); }
    });
    router.post('/twitch/pilot/revoke', requireTwitchOperator, (req, res) => {
        const access = system.twitchArbiter?.pilotAccess;
        if (!access) return res.status(503).json({ ok: false, error: 'Twitch pilot not loaded' });
        try {
            const result = access.revoke(req.body?.channel);
            const bot = system.twitchArbiter;
            bot.recentInteractions = bot.recentInteractions.filter(item => item.channel !== result.channel);
            bot.conversation?.clearChannel(result.channel);
            const invite = access.list().find(item => item.channel === result.channel);
            if (invite?.tenantId) bot.cohost?.purgeTenant(invite.tenantId);
            bot.streamContext?.clear(result.channel);
            res.json({ ok: true, ...result });
        } catch (error) { res.status(400).json({ ok: false, error: system.twitchArbiter.safeError(error) }); }
    });
    router.get('/twitch/cohost/:channel/context', requireTwitchOperator, async (req, res) => {
        const bot = system.twitchArbiter;
        if (!bot?.streamContext) return res.status(503).json({ ok: false, error: 'Twitch co-host not loaded' });
        try {
            const channel = twitchName(req.params.channel);
            if (!bot.pilotAccess.check(channel).allowed || !bot.channels.includes(channel)) return res.status(403).json({ ok: false, error: 'Channel is not authorized and configured' });
            res.json({ ok: true, context: await bot.streamContext.get(channel) });
        } catch { res.status(400).json({ ok: false, error: 'Twitch stream context unavailable' }); }
    });
    router.get('/twitch/cohost/:channel', requireTwitchOperator, (req, res) => {
        const bot = system.twitchArbiter;
        if (!bot?.cohost) return res.status(503).json({ ok: false, error: 'Twitch co-host not loaded' });
        try { res.json({ ok: true, channel: twitchName(req.params.channel), settings: bot.cohost.profile(req.params.channel) }); }
        catch (error) { res.status(400).json({ ok: false, error: bot.safeError(error) }); }
    });
    router.post('/twitch/cohost/:channel', requireTwitchOperator, (req, res) => {
        const bot = system.twitchArbiter;
        if (!bot?.cohost) return res.status(503).json({ ok: false, error: 'Twitch co-host not loaded' });
        try { res.json({ ok: true, channel: twitchName(req.params.channel), settings: bot.cohost.setProfile(req.params.channel, req.body) }); }
        catch (error) { res.status(400).json({ ok: false, error: bot.safeError(error) }); }
    });
    router.get('/twitch/bot/status', requireTwitchOperator, async (_req, res) => {
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'TwitchArbiter not loaded' });
        try {
            res.json({ ok: true, ...arbiter.getStatus() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/twitch/bot/setup', requireTwitchOperator, async (req, res) => {
        const { botUsername, oauthToken, channels } = req.body || {};
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'TwitchArbiter not loaded' });
        try {
            const status = await arbiter.reconfigure({ botUsername, oauthToken, channels });
            res.json({ ok: true, ...status });
        } catch (e) {
            res.status(400).json({ ok: false, error: arbiter.safeError(e) });
        }
    });

    router.post('/twitch/bot/disconnect', requireTwitchOperator, async (_req, res) => {
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'TwitchArbiter not loaded' });
        try { res.json({ ok: true, ...await arbiter.reconfigure({ desiredState: 'stopped' }) }); }
        catch (error) { res.status(500).json({ ok: false, error: arbiter.safeError(error) }); }
    });

    router.post('/twitch/bot/join', requireTwitchOperator, async (req, res) => {
        const { channel } = req.body || {};
        if (!channel) return res.status(400).json({ ok: false, error: 'channel name required' });
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'TwitchArbiter not loaded' });
        try {
            const result = await arbiter.joinChannel(channel, { autoInvite: true });
            res.json({ ok: true, ...result, status: arbiter.getStatus() });
        } catch (e) {
            res.status(400).json({ ok: false, error: arbiter.safeError(e) });
        }
    });

    router.post('/twitch/bot/part', requireTwitchOperator, async (req, res) => {
        const { channel } = req.body || {};
        if (!channel) return res.status(400).json({ ok: false, error: 'channel name required' });
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'TwitchArbiter not loaded' });
        try {
            const result = await arbiter.partChannel(channel);
            res.json({ ok: true, ...result, status: arbiter.getStatus() });
        } catch (e) {
            res.status(400).json({ ok: false, error: arbiter.safeError(e) });
        }
    });

    router.post('/twitch/bot/simulate', requireTwitchOperator, async (req, res) => {
        const { channel = 'owner', username = 'Owner', message = '!soma are you ready?' } = req.body || {};
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'TwitchArbiter not loaded' });
        try {
            if (typeof message !== 'string' || !message.trim() || message.length > 1000) return res.status(400).json({ ok: false, error: 'Provide a message of 1–1000 characters' });
            const result = await arbiter.handleMessage(channel, { username }, message, { dryRun: true });
            res.json({ ok: true, simulated: true, result, status: arbiter.getStatus() });
        } catch (e) {
            res.status(400).json({ ok: false, error: arbiter.safeError(e) });
        }
    });

    return router;
}
