import interactionStore from './interactionStore.js';
import replyClassifier from './replyClassifier.js';
import decisionEngine from './decisionEngine.js';
import { getSocialAutonomyConfig } from './autonomyModeConfig.js';
import { SocialRateLimiter } from './rateLimiter.js';
import { SomaVoiceEngine } from './somaVoiceEngine.js';
import { ReflectionEngine } from './reflectionEngine.js';
import socialMemory from '../SocialMemoryEngine.js';
import socialRelationships from '../SocialRelationshipLedger.js';
import { replyRefsFromPost } from '../BlueskyReplyRefs.js';
import socialContextProvider from '../SocialContextProvider.js';

export function normalizeNotification(notif = {}) {
    const post = notif.post || notif;
    const record = post.record || notif.record || {};
    const refs = replyRefsFromPost({ ...post, uri: post.uri || notif.uri, cid: post.cid || notif.cid, record });
    return {
        uri: post.uri || notif.uri,
        cid: post.cid || notif.cid,
        reason: notif.reason || 'reply',
        text: record.text || '',
        author: post.author || notif.author || {},
        handle: post.author?.handle || notif.author?.handle || '',
        displayName: post.author?.displayName || notif.author?.displayName || '',
        createdAt: Date.parse(record.createdAt || notif.indexedAt || 0) || Date.now(),
        parentRef: refs.parent,
        rootRef: refs.root,
        threadUri: refs.threadUri,
    };
}

function flattenThread(node, rows = []) {
    if (!node) return rows;
    const post = node.post || node;
    if (post?.uri) rows.push({
        uri: post.uri,
        handle: post.author?.handle || '',
        text: post.record?.text || '',
        cid: post.cid || '',
    });
    for (const reply of node.replies || []) flattenThread(reply, rows);
    return rows;
}

function normalizeDmMessage(convo = {}, message = {}, selfDid = '') {
    const other = (convo.members || []).find(member => member.did && member.did !== selfDid) || (convo.members || [])[0] || {};
    const sender = (convo.members || []).find(member => member.did === message.sender?.did) || {};
    return {
        uri: `dm:${convo.id}:${message.id}`,
        cid: message.id || '',
        platform: 'bluesky_dm',
        reason: 'direct_message',
        text: message.text || '',
        author: sender,
        handle: sender.handle || other.handle || '',
        displayName: sender.displayName || other.displayName || '',
        createdAt: Date.parse(message.sentAt || 0) || Date.now(),
        convoId: convo.id,
        messageId: message.id,
        threadUri: `dm:${convo.id}`,
        otherMember: other,
    };
}

export class BlueskySocialCortex {
    constructor({ blueskeyClient, brain = null, store = interactionStore } = {}) {
        this.client = blueskeyClient;
        this.brain = brain;
        this.store = store;
        this.voice = new SomaVoiceEngine({ brain });
        this.reflection = new ReflectionEngine();
    }

    setBrain(brain) {
        this.brain = brain;
        this.voice.setBrain(brain);
    }

    async processNotifications({ limit = 25, markSeen = true } = {}) {
        if (!this.client?.configured) return { ok: false, error: 'Bluesky not configured' };
        const notifications = await this.client.getNotifications(limit);
        const targets = notifications
            .filter(n => n.reason === 'reply' || n.reason === 'mention')
            .map(normalizeNotification)
            .filter(n => n.uri && n.text && !this.store.hasProcessed(n.uri));

        const results = [];
        for (const interaction of targets) {
            results.push(await this.processInteraction(interaction).catch(error => ({
                uri: interaction.uri,
                action: 'error',
                error: error.message,
            })));
            await new Promise(resolve => setTimeout(resolve, 500 + Math.floor(Math.random() * 1200)));
        }
        // updateSeen is global. Do not hide failed interactions; successful rows are
        // deduplicated by the store if Bluesky presents them again on the next pass.
        if (markSeen && targets.length && results.every(result => result.action !== 'error')) {
            await this.client.markSeen().catch(() => {});
        }
        return { ok: true, total: targets.length, results };
    }

    async processDirectMessages({ limit = 20, messagesPerConvo = 20, markRead = true } = {}) {
        if (!this.client?.configured) return { ok: false, error: 'Bluesky not configured' };
        const listed = await this.client.listConvos(limit);
        const convos = (listed.convos || []).filter(convo => Number(convo.unreadCount || 0) > 0 || convo.lastMessage);
        const results = [];

        await this.client._ensureSession?.();
        const selfDid = this.client.session?.did || '';
        for (const convo of convos) {
            const messagesResult = await this.client.getMessages(convo.id, { limit: messagesPerConvo }).catch(() => ({ messages: [] }));
            const inbound = (messagesResult.messages || [])
                .filter(message => message?.id && message?.text && message.sender?.did !== selfDid)
                .sort((a, b) => Date.parse(a.sentAt || 0) - Date.parse(b.sentAt || 0));

            for (const message of inbound) {
                const interaction = normalizeDmMessage(convo, message, selfDid);
                if (this.store.hasProcessed(interaction.uri)) continue;
                results.push(await this.processDirectMessage(interaction, messagesResult.messages || []).catch(error => ({
                    uri: interaction.uri,
                    action: 'error',
                    error: error.message,
                })));
                await new Promise(resolve => setTimeout(resolve, 800 + Math.floor(Math.random() * 1700)));
            }

            if (markRead && inbound.length) {
                const latest = inbound[inbound.length - 1];
                await this.client.updateRead(convo.id, latest.id).catch(() => {});
            }
        }

        return { ok: true, total: results.length, convos: convos.length, results };
    }

    async hydrateThread(interaction) {
        try {
            const thread = await this.client.getThread(interaction.uri, { depth: 4, parentHeight: 4 });
            const rows = flattenThread(thread.thread).slice(0, 20);
            return {
                rows,
                text: rows.map(row => `@${row.handle}: ${row.text}`).join('\n').slice(0, 2000),
            };
        } catch {
            return { rows: [], text: '' };
        }
    }

    contextFromThread(rows = [], interaction = {}) {
        const myHandle = (this.client?.session?.handle || process.env.BLUESKY_HANDLE || process.env.BLUESKY_IDENTIFIER || '').replace(/^@/, '').toLowerCase();
        const threadReplyCount = rows.filter(row => row.handle?.toLowerCase() === myHandle).length;
        const sameBotThreadReplies = rows.filter(row => row.handle === interaction.handle && /bot|ai|agent/i.test(row.handle || '')).length;
        const lastSoma = [...rows].reverse().find(row => row.handle?.toLowerCase() === myHandle);
        const lastInbound = [...rows].reverse().find(row => row.handle && row.handle !== myHandle);
        return {
            threadReplyCount,
            sameBotThreadReplies,
            lastSomaReply: lastSoma?.text || '',
            lastInboundText: lastInbound?.text || '',
        };
    }

    async processInteraction(interaction) {
        if (this.store.hasProcessed(interaction.uri)) return { uri: interaction.uri, action: 'duplicate' };

        const config = getSocialAutonomyConfig();
        const thread = await this.hydrateThread(interaction);
        const context = this.contextFromThread(thread.rows, interaction);
        const relationship = socialRelationships.getRelationshipContext(interaction.handle, interaction.threadUri);
        const classification = replyClassifier.classify(interaction, context);
        const limiter = new SocialRateLimiter(this.store, config);
        const replyLimit = limiter.check({
            kind: 'reply',
            handle: interaction.handle,
            threadUri: interaction.threadUri,
            isBot: classification.botLikelihood >= 0.55,
        });
        const decision = decisionEngine.decide(classification, config, {
            ...context,
            relationship,
            rateLimited: !replyLimit.ok,
            rateLimitReason: replyLimit.reason,
        });
        if (!relationship.boundary.ok && /reply|draft/.test(decision.action)) {
            decision.action = 'review';
            decision.shouldLike = false;
            decision.shouldReply = false;
            decision.shouldDraft = false;
            decision.shouldReview = true;
            decision.reasons = [...(decision.reasons || []), `relationship_boundary:${relationship.boundary.reasons.join('|')}`];
        }

        let responseText = '';
        let responseUri = '';
        let action = decision.action;

        if (decision.shouldLike) {
            const likeLimit = limiter.check({ kind: 'like', handle: interaction.handle, threadUri: interaction.threadUri });
            if (likeLimit.ok) {
                await this.client.like({ uri: interaction.uri, cid: interaction.cid });
                limiter.record('like', { handle: interaction.handle, threadUri: interaction.threadUri, isBot: classification.botLikelihood >= 0.55 });
            }
        }

        if (decision.shouldReply) {
            responseText = await this.voice.generate({ interaction, classification, threadContext: thread.text, relationshipContext: relationship.text });
            const posted = await this.client.reply(responseText, interaction.parentRef, interaction.rootRef);
            responseUri = posted?.uri || '';
            limiter.record('reply', { handle: interaction.handle, threadUri: interaction.threadUri, isBot: classification.botLikelihood >= 0.55 });
            const reflection = this.reflection.reflect({ inboundText: interaction.text, responseText, classification, decision });
            this.store.recordReflection({ uri: interaction.uri, responseUri, ...reflection });
            socialContextProvider.recordOutboundPost({
                platform: 'bluesky',
                text: responseText,
                type: 'reply',
                recipient: `@${interaction.handle}`,
                inboundText: interaction.text,
                uri: responseUri,
                threadUri: interaction.threadUri,
                timestamp: Date.now()
            }).catch(() => {});
            if (this.brain?.system?.mnemonicArbiter?.remember) {
                this.brain.system.mnemonicArbiter.remember(`[SOCIAL REFLECTION] ${reflection.notes}`, {
                    type: 'social_reflection',
                    source: 'bluesky-social-cortex',
                    importance: Math.max(0.3, reflection.styleReinforcement || 0.4),
                    timestamp: Date.now(),
                }).catch(() => {});
            }
        }

        if (decision.shouldDraft) {
            responseText = await this.voice.generate({ interaction, classification, threadContext: thread.text, relationshipContext: relationship.text });
            this.store.enqueueReview({ ...interaction, classification, decision, reason: 'assisted draft', text: responseText });
        }

        if (decision.shouldReview) {
            this.store.enqueueReview({ ...interaction, classification, decision, reason: decision.reasons?.join(', ') || 'review required', text: interaction.text });
        }

        this.store.recordProcessed({
            uri: interaction.uri,
            handle: interaction.handle,
            threadUri: interaction.threadUri,
            reason: interaction.reason,
            text: interaction.text,
            classification,
            decision,
            action,
            responseText,
            responseUri,
            createdAt: interaction.createdAt,
        });
        this.store.upsertProfile({
            handle: interaction.handle,
            displayName: interaction.displayName,
            classification,
            decision,
            topics: classification.topics,
        });
        socialMemory.recordInteraction({
            platform: 'bluesky',
            type: action.includes('reply') ? 'comment_reply' : action,
            status: responseUri ? 'posted' : action,
            author: interaction.handle,
            sourceUri: interaction.uri,
            responseUri,
            inboundText: interaction.text,
            responseText,
            reason: `${action}: ${(classification.types || []).join(', ')}`,
        });
        socialRelationships.recordEvent({
            platform: 'bluesky',
            type: action.includes('reply') ? 'reply' : action,
            intent: 'respond_to_person',
            author: interaction.handle,
            threadUri: interaction.threadUri,
            sourceUri: interaction.uri,
            responseUri,
            inboundText: interaction.text,
            responseText,
            status: responseUri ? 'posted' : action,
            reason: `${action}: ${(classification.types || []).join(', ')}`,
            createdAt: interaction.createdAt,
        });

        return { uri: interaction.uri, handle: interaction.handle, action, classification, responseUri };
    }

    dmContext(messages = [], selfDid = '') {
        const rows = messages
            .filter(message => message?.text)
            .slice(-12)
            .map(message => `${message.sender?.did === selfDid ? 'SOMA' : 'Them'}: ${message.text}`);
        return {
            text: rows.join('\n').slice(0, 1800),
            priorSomaReplies: messages.filter(message => message.sender?.did === selfDid).length,
            lastInboundText: [...messages].reverse().find(message => message.sender?.did !== selfDid)?.text || '',
            lastSomaReply: [...messages].reverse().find(message => message.sender?.did === selfDid)?.text || '',
        };
    }

    async processDirectMessage(interaction, messages = []) {
        if (this.store.hasProcessed(interaction.uri)) return { uri: interaction.uri, action: 'duplicate' };

        const baseConfig = getSocialAutonomyConfig();
        const config = {
            ...baseConfig,
            thresholds: {
                ...baseConfig.thresholds,
                autoReplyRiskMax: Math.min(baseConfig.thresholds.autoReplyRiskMax, 0.18),
                autoReplyWorthinessMin: Math.max(baseConfig.thresholds.autoReplyWorthinessMin, 0.65),
                autoReplyLoopRiskMax: Math.min(baseConfig.thresholds.autoReplyLoopRiskMax, 0.25),
            },
        };
        const selfDid = this.client.session?.did || '';
        const dmContext = this.dmContext(messages, selfDid);
        const relationship = socialRelationships.getRelationshipContext(interaction.handle, interaction.threadUri);
        const classification = replyClassifier.classify(interaction, {
            threadReplyCount: dmContext.priorSomaReplies,
            sameBotThreadReplies: 0,
            lastSomaReply: dmContext.lastSomaReply,
            lastInboundText: dmContext.lastInboundText,
        });
        const limiter = new SocialRateLimiter(this.store, config);
        const dmLimit = limiter.check({
            kind: 'dm_reply',
            handle: interaction.handle,
            threadUri: interaction.threadUri,
            isBot: classification.botLikelihood >= 0.55,
        });
        const decision = decisionEngine.decide(classification, config, {
            threadReplyCount: dmContext.priorSomaReplies,
            relationship,
            rateLimited: !dmLimit.ok,
            rateLimitReason: dmLimit.reason,
        });
        if (!relationship.boundary.ok && /reply|draft/.test(decision.action)) {
            decision.action = 'review';
            decision.shouldLike = false;
            decision.shouldReply = false;
            decision.shouldDraft = false;
            decision.shouldReview = true;
            decision.reasons = [...(decision.reasons || []), `relationship_boundary:${relationship.boundary.reasons.join('|')}`];
        }

        let action = decision.action;
        let responseText = '';
        let responseUri = '';

        // DMs cannot be liked. Convert like-only outcomes into observe/ignore.
        if (action === 'like') action = 'ignore';
        if (action === 'like_and_reply') action = 'reply';
        if (action === 'like_and_draft') action = 'draft';

        if (action === 'reply') {
            responseText = await this.voice.generate({
                interaction,
                classification,
                threadContext: dmContext.text,
                channel: 'dm',
                relationshipContext: relationship.text,
            });
            const sent = await this.client.sendMessage(interaction.convoId, responseText);
            responseUri = sent?.message?.id || sent?.id || '';
            limiter.record('dm_reply', { handle: interaction.handle, threadUri: interaction.threadUri, isBot: classification.botLikelihood >= 0.55 });
            const reflection = this.reflection.reflect({ inboundText: interaction.text, responseText, classification, decision: { ...decision, action } });
            this.store.recordReflection({ uri: interaction.uri, responseUri, ...reflection });
            socialContextProvider.recordOutboundPost({
                platform: 'bluesky_dm',
                text: responseText,
                type: 'direct_message',
                recipient: `@${interaction.handle}`,
                inboundText: interaction.text,
                uri: responseUri,
                threadUri: interaction.threadUri,
                timestamp: Date.now()
            }).catch(() => {});
        } else if (action === 'draft') {
            responseText = await this.voice.generate({
                interaction,
                classification,
                threadContext: dmContext.text,
                channel: 'dm',
                relationshipContext: relationship.text,
            });
            this.store.enqueueReview({ ...interaction, classification, decision: { ...decision, action }, reason: 'dm assisted draft', text: responseText });
        } else if (action === 'review' || decision.shouldReview) {
            this.store.enqueueReview({ ...interaction, classification, decision: { ...decision, action }, reason: decision.reasons?.join(', ') || 'dm review required', text: interaction.text });
        }

        this.store.recordProcessed({
            uri: interaction.uri,
            platform: 'bluesky_dm',
            handle: interaction.handle,
            threadUri: interaction.threadUri,
            reason: interaction.reason,
            text: interaction.text,
            classification,
            decision: { ...decision, action },
            action,
            responseText,
            responseUri,
            createdAt: interaction.createdAt,
        });
        this.store.upsertProfile({
            handle: interaction.handle,
            displayName: interaction.displayName,
            classification,
            decision: { ...decision, action },
            topics: classification.topics,
        });
        socialMemory.recordInteraction({
            platform: 'bluesky_dm',
            type: action === 'reply' ? 'dm_reply' : `dm_${action}`,
            status: responseUri ? 'posted' : action,
            author: interaction.handle,
            sourceUri: interaction.uri,
            responseUri,
            inboundText: interaction.text,
            responseText,
            reason: `${action}: ${(classification.types || []).join(', ')}`,
        });
        socialRelationships.recordEvent({
            platform: 'bluesky_dm',
            type: action === 'reply' ? 'dm_reply' : `dm_${action}`,
            intent: 'respond_to_person',
            author: interaction.handle,
            threadUri: interaction.threadUri,
            sourceUri: interaction.uri,
            responseUri,
            inboundText: interaction.text,
            responseText,
            status: responseUri ? 'posted' : action,
            reason: `${action}: ${(classification.types || []).join(', ')}`,
            createdAt: interaction.createdAt,
        });

        return { uri: interaction.uri, handle: interaction.handle, action, classification, responseUri };
    }

    getStatus() {
        return {
            ok: true,
            configured: !!this.client?.configured,
            autonomy: getSocialAutonomyConfig(),
            store: this.store.getStatus(),
            directMessages: {
                enabled: true,
                mode: 'stricter_than_public',
                limits: {
                    perHour: getSocialAutonomyConfig().limits.dmRepliesPerHour,
                    perDay: getSocialAutonomyConfig().limits.dmRepliesPerDay,
                },
            },
        };
    }
}

export default BlueskySocialCortex;
