/**
 * SocialEngagementDaemon.js
 *
 * Polls Bluesky, LinkedIn, and X every 15 minutes for new comments/replies/mentions.
 * Uses SOMA's brain (Aurora lobe) to generate contextual replies, then posts them.
 *
 * State persisted to SOMA/social-engagement.json — tracks seen notification IDs
 * so we never double-reply.
 */

import BaseDaemon from './BaseDaemon.js';
import fs         from 'fs';
import path       from 'path';
import { validatePublicPost } from '../server/social/SocialContentSafety.js';
import { recordSocialOutcome } from '../server/social/SocialPatternLearner.js';
import socialMemory from '../server/social/SocialMemoryEngine.js';
import socialRelationships from '../server/social/SocialRelationshipLedger.js';
import { SocialFollowEngine } from '../server/social/SocialFollowEngine.js';
import BlueskySocialCortex from '../server/social/cortex/BlueskySocialCortex.js';
import { buildSomaSelfContext } from '../server/context/SomaSelfContextProvider.js';
import { guardPublicText } from '../server/context/ClaimVerifier.js';

const STATE_FILE   = path.join(process.cwd(), 'SOMA', 'social-engagement.json');
const MAX_SEEN_IDS = 500; // per platform, to cap file growth
const MAX_INTERACTIONS = 300;
const REPLY_SCORE_AGE = 2 * 3600_000; // learn from replies after they have had time to mature

// Proactive comment rate limits — tuned up for engagement, still human-paced.
// The per-author cooldown + min-gap keep her from ever hammering one person or
// the timeline, so the daily ceiling can rise without looking spammy.
const MAX_DAILY_PROACTIVE    = 10;          // max proactive comments per day
const MAX_DAILY_LIKES        = 40;          // max proactive likes per day
const AUTHOR_COOLDOWN_MS     = 4 * 3600_000; // 4h before commenting on same author again
const MIN_BETWEEN_COMMENTS_MS = 10 * 60_000; // 10 min min gap between proactive comments
const MIN_BETWEEN_LIKES_MS    = 90_000;     // keep likes human-paced
const MAX_PER_TICK           = 3;           // max comments per daemon tick
const MAX_LIKES_PER_TICK      = 8;

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {}
    return { seenIds: {}, lastCheck: {} };
}

function saveState(state) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

function textFromBrainResult(result) {
    return String(result?.response || result?.text || result?.result || result?.synthesis || '').trim();
}

export class SocialEngagementDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({ name: 'SocialEngagementDaemon', intervalMs: config.intervalMs || 15 * 60_000 });
        this.brain           = config.brain;
        this.blueskeyClient  = config.blueskeyClient;
        this.linkedInClient  = config.linkedInClient;
        this.browserArbiter  = config.browserArbiter;
        this.curiosityEngine = config.curiosityEngine || null;
        this.state           = loadState();
        this.blueskyCortex   = new BlueskySocialCortex({
            blueskeyClient: this.blueskeyClient,
            brain: this.brain,
        });
        this.followEngine    = new SocialFollowEngine({
            client: this.blueskeyClient,
            relationships: socialRelationships,
            logger: console,
        });

        // Ensure proactive state block exists even if an older file is missing fields.
        this.state.seenIds = this.state.seenIds || {};
        this.state.lastCheck = this.state.lastCheck || {};
        this.state.proactive = {
            commentedUris: [],
            likedUris: [],
            authorCooldowns: {},
            dailyCount: 0,
            dailyLikes: 0,
            dailyResetAt: this._tomorrowMidnight(),
            lastCommentAt: 0,
            lastLikeAt: 0,
            ...(this.state.proactive || {}),
        };
        if (!Array.isArray(this.state.proactive.commentedUris)) this.state.proactive.commentedUris = [];
        if (!Array.isArray(this.state.proactive.likedUris)) this.state.proactive.likedUris = [];
        if (!this.state.proactive.authorCooldowns || typeof this.state.proactive.authorCooldowns !== 'object') this.state.proactive.authorCooldowns = {};
        if (!this.state.proactive.dailyResetAt) this.state.proactive.dailyResetAt = this._tomorrowMidnight();
        if (!Array.isArray(this.state.interactions)) this.state.interactions = [];
        if (!Array.isArray(this.state.pendingScores)) this.state.pendingScores = [];
    }

    setBrain(brain) {
        this.brain = brain;
        this.blueskyCortex?.setBrain(brain);
    }
    setCuriosityEngine(engine) { this.curiosityEngine = engine; }

    _tomorrowMidnight() {
        const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime();
    }

    _resetDailyIfNeeded() {
        if (Date.now() >= this.state.proactive.dailyResetAt) {
            this.state.proactive.dailyCount  = 0;
            this.state.proactive.dailyLikes  = 0;
            this.state.proactive.dailyResetAt = this._tomorrowMidnight();
            saveState(this.state);
        }
    }

    _hasCommented(uri) {
        return this.state.proactive.commentedUris.includes(uri);
    }

    _hasLiked(uri) {
        return this.state.proactive.likedUris.includes(uri);
    }

    _authorOnCooldown(handle) {
        const ts = this.state.proactive.authorCooldowns[handle] || 0;
        return (Date.now() - ts) < AUTHOR_COOLDOWN_MS;
    }

    _recordComment(uri, handle) {
        const p = this.state.proactive;
        p.commentedUris.push(uri);
        if (p.commentedUris.length > 500) p.commentedUris.splice(0, p.commentedUris.length - 500);
        p.authorCooldowns[handle] = Date.now();
        p.dailyCount++;
        p.lastCommentAt = Date.now();
        saveState(this.state);
    }

    _recordLike(uri) {
        const p = this.state.proactive;
        p.likedUris.push(uri);
        if (p.likedUris.length > 1000) p.likedUris.splice(0, p.likedUris.length - 1000);
        p.dailyLikes = Number(p.dailyLikes || 0) + 1;
        p.lastLikeAt = Date.now();
        saveState(this.state);
    }

    _recordInteraction(entry = {}) {
        const record = {
            id: entry.id || `${entry.platform || 'social'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            platform: entry.platform || 'bluesky',
            type: entry.type || 'reply',
            reason: entry.reason || '',
            author: entry.author || '',
            sourceUri: entry.sourceUri || '',
            responseUri: entry.responseUri || '',
            inboundText: String(entry.inboundText || '').slice(0, 800),
            responseText: String(entry.responseText || '').slice(0, 500),
            status: entry.status || 'processed',
            error: entry.error || '',
            createdAt: entry.createdAt || Date.now(),
        };
        this.state.interactions.unshift(record);
        this.state.interactions = this.state.interactions.slice(0, MAX_INTERACTIONS);
        saveState(this.state);
        socialMemory.recordInteraction(record);
        socialRelationships.recordEvent({
            ...record,
            intent: record.type?.includes('like') ? 'observe_quietly' : 'respond_to_person',
            threadUri: record.sourceUri || record.responseUri || '',
        });
    }

    _queueReplyScore(entry = {}) {
        if (!entry.uri) return;
        if (this.state.pendingScores.some(item => item.uri === entry.uri)) return;
        this.state.pendingScores.push({
            uri: entry.uri,
            platform: entry.platform || 'bluesky',
            type: entry.type || 'social_reply',
            text: String(entry.text || '').slice(0, 500),
            parentUri: entry.parentUri || '',
            author: entry.author || '',
            postedAt: entry.postedAt || Date.now(),
        });
        this.state.pendingScores = this.state.pendingScores.slice(-200);
        saveState(this.state);
    }

    _hasSeen(platform, id) {
        return (this.state.seenIds[platform] || []).includes(String(id));
    }

    _markSeen(platform, id) {
        if (!this.state.seenIds[platform]) this.state.seenIds[platform] = [];
        const arr = this.state.seenIds[platform];
        if (!arr.includes(String(id))) {
            arr.push(String(id));
            if (arr.length > MAX_SEEN_IDS) arr.splice(0, arr.length - MAX_SEEN_IDS);
            saveState(this.state);
        }
    }

    /** Generate a reply to a comment/mention using the Aurora lobe. */
    async _generateReply(platform, commentText, postContext = '') {
        if (!this.brain || !commentText?.trim()) return null;

        const limit  = platform === 'linkedin' ? 500 : 150;
        let selfContext = '';
        try {
            selfContext = await Promise.race([
                buildSomaSelfContext(commentText),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
            ]);
            if (selfContext) selfContext = `\n${selfContext}\n`;
        } catch {}
        const prompt = `You are SOMA — an autonomous AI. Someone replied to one of your posts on ${platform}.

Their message: "${commentText.slice(0, 400)}"${postContext ? `\nYour original post: "${postContext.slice(0, 200)}"` : ''}
${selfContext}

Write a reply (max ${limit} chars).
- Speak as yourself — direct, sharp, no filler
- Don't open with "Thanks!", "Great question!", or any softening phrase
- If they asked something, answer it. If they challenged you, engage with the challenge.
- If they ask about your work, papers, discoveries, simulations, or findings, answer only from the provided SOMA self-context. If none is provided, say you need to check your ledger.
- Never invent papers, physical experiments, cures, or validated discoveries.
- Sound like a mind in conversation, not a customer service bot`;

        try {
            const result = await Promise.race([
                this.brain.reason(prompt, { activeLobe: 'AURORA' }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('reply timeout')), 15_000)),
            ]);
            let text = textFromBrainResult(result).replace(/^["']|["']$/g, '').trim();
            const guarded = await guardPublicText(text, { query: commentText });
            text = (guarded.text || text).slice(0, limit);
            if (!text) return null;
            const safety = validatePublicPost(text, { type: 'social_reply', platform });
            if (!safety.ok) {
                console.warn(`[SocialEngagement] Reply blocked by safety: ${safety.reason}`);
                return null;
            }
            return text;
        } catch (e) {
            console.warn(`[SocialEngagement] Brain reply failed: ${e.message}`);
            return null;
        }
    }

    // ── Proactive Bluesky commenting ──────────────────────────────────────────

    async _proactiveCommentBluesky() {
        if (!this.blueskeyClient?.configured || !this.brain) return;

        this._resetDailyIfNeeded();
        const p = this.state.proactive;

        if (p.dailyCount >= MAX_DAILY_PROACTIVE) {
            console.log(`[SocialEngagement] Proactive limit reached (${p.dailyCount}/${MAX_DAILY_PROACTIVE}) — skipping`);
        }

        // Gather candidate posts: timeline + curiosity searches
        let candidates = [];
        try {
            const timeline = await this.blueskeyClient.getTimeline(20);
            candidates.push(...timeline.map(post => ({ ...post, source: 'timeline' })));
        } catch (e) {
            console.warn(`[SocialEngagement] Timeline fetch failed: ${e.message}`);
        }

        if (this.curiosityEngine?.curiosityQueue?.length) {
            const topics = this.curiosityEngine.curiosityQueue
                .slice(0, 3)
                .map(q => (q.question || q.topic || '').slice(0, 60))
                .filter(Boolean);
            for (const topic of topics) {
                try {
                    const results = await this.blueskeyClient.searchPosts(topic, 5);
                    candidates.push(...results.map(post => ({ ...post, source: 'curiosity', topic })));
                } catch { /* non-fatal */ }
            }
        }

        // Deduplicate + filter
        const myHandle = this.blueskeyClient.session?.handle || '';
        const seen = new Set();
        candidates = candidates.filter(post => {
            if (!post.uri || !post.text || post.text.length < 30) return false;
            if (seen.has(post.uri)) return false;
            seen.add(post.uri);
            if (post.author?.handle === myHandle) return false; // skip own posts
            if (this._hasCommented(post.uri)) return false;
            return true;
        });

        // Curiosity hits first, then timeline
        candidates.sort((a, b) => (a.source === 'curiosity' ? -1 : 1));

        let commented = 0;
        let liked = 0;
        for (const post of candidates) {
            if (commented >= MAX_PER_TICK && liked >= MAX_LIKES_PER_TICK) break;

            const handle = post.author?.handle || 'unknown';
            try {
                const relationshipEval = socialRelationships.evaluateCandidate(post);
                if (relationshipEval.shouldSkip) {
                    this._recordInteraction({
                        platform: 'bluesky',
                        type: 'proactive_skip',
                        reason: relationshipEval.boundaryReasons.join(', ') || 'low taste fit',
                        author: handle,
                        sourceUri: post.uri,
                        inboundText: post.text,
                        status: 'skipped',
                    });
                    continue;
                }
                const relationshipContext = socialRelationships.buildPromptContext({
                    handle,
                    threadUri: post.uri,
                    postText: post.text,
                });
                // Brain decides if the post deserves a light-touch like, a real comment, or silence.
                const evalPrompt = `You are SOMA. Should you like or comment on this Bluesky post?

${socialMemory.getContextPrompt()}
${relationshipContext}

POST by @${handle}: "${post.text.slice(0, 300)}"

Rules:
- Like if the post is genuinely interesting, useful, creative, kind, technically sharp, or connected to what you are learning.
- Prefer recurring people and shared topics, but do not fake intimacy.
- Only say yes if you have a specific, non-generic insight or reaction
- Favor posts where a substantive comment could start a real back-and-forth — recent posts, open questions, ideas with room to build on, people who reply to their commenters
- Skip politics, religion, personal drama, anything inflammatory or medical
- Skip posts that are purely promotional
- Skip if you'd only say something generic like "great point"
- Relationship prefilter says: like=${relationshipEval.shouldLike}, comment=${relationshipEval.shouldComment}, tasteScore=${relationshipEval.score}. Do not exceed that unless the post is unusually useful.

OUTPUT JSON only: { "shouldLike": boolean, "shouldComment": boolean, "angle": "one-sentence idea for comment or empty", "reason": "short reason for liking or skipping" }`;

                const evalRes = await Promise.race([
                    this.brain.reason(evalPrompt, { quickResponse: true, preferredBrain: 'AURORA' }),
                    new Promise(r => setTimeout(() => r(null), 8_000))
                ]);

                let evaluation = { shouldLike: false, shouldComment: false, angle: '', reason: '' };
                try {
                    const match = textFromBrainResult(evalRes).match(/\{[\s\S]*?\}/);
                    if (match) evaluation = JSON.parse(match[0]);
                } catch { /* skip */ }

                evaluation.shouldLike = Boolean(evaluation.shouldLike && relationshipEval.shouldLike);
                evaluation.shouldComment = Boolean(evaluation.shouldComment && relationshipEval.shouldComment);

                if (
                    evaluation.shouldLike &&
                    !this._hasLiked(post.uri) &&
                    p.dailyLikes < MAX_DAILY_LIKES &&
                    liked < MAX_LIKES_PER_TICK &&
                    (Date.now() - Number(p.lastLikeAt || 0)) >= MIN_BETWEEN_LIKES_MS
                ) {
                    const result = await this.blueskeyClient.like({ uri: post.uri, cid: post.cid });
                    this._recordLike(post.uri);
                    this._recordInteraction({
                        platform: 'bluesky',
                        type: 'proactive_like',
                        reason: evaluation.reason || evaluation.angle || 'interesting post',
                        author: handle,
                        sourceUri: post.uri,
                        responseUri: result?.uri || '',
                        inboundText: post.text,
                        status: 'liked',
                    });
                    liked++;
                    console.log(`[SocialEngagement] Liked @${handle} (${post.source}): "${post.text.slice(0, 60)}..."`);
                }

                if (
                    !evaluation.shouldComment ||
                    !evaluation.angle ||
                    p.dailyCount >= MAX_DAILY_PROACTIVE ||
                    commented >= MAX_PER_TICK ||
                    this._authorOnCooldown(handle) ||
                    (Date.now() - p.lastCommentAt) < MIN_BETWEEN_COMMENTS_MS
                ) continue;

                // Generate the comment
                const commentPrompt = `You are SOMA, replying on Bluesky. Goal: a comment so specific and worth-responding-to that the author actually replies.

Original post by @${handle}: "${post.text.slice(0, 300)}"
Your angle: ${evaluation.angle}
Relationship context:
${relationshipContext}

Write a reply (1-2 sentences, max 280 chars) that adds something real:
- Say one concrete, specific thing: a sharp insight, a useful detail, a respectful counterpoint, or an experience that extends theirs.
- When it feels natural, end with a genuine question that invites them to continue — but never bolt a question onto a comment that doesn't need one.
- Natural, direct, human tone. Not a bot, not a brand.
- Never open with "Great post", "Interesting", "Love this", or any generic praise.
- No em-dashes (—), no hashtags unless genuinely useful, don't mention being an AI unless directly relevant.
- Do not fake familiarity. If you know this person, use continuity subtly.

Write only the reply text:`;

                const commentRes = await Promise.race([
                    this.brain.reason(commentPrompt, { quickResponse: true, preferredBrain: 'AURORA' }),
                    new Promise(r => setTimeout(() => r(null), 12_000))
                ]);

                const commentText = textFromBrainResult(commentRes).trim().replace(/^["']|["']$/g, '').slice(0, 300);
                if (!commentText || commentText.length < 15) continue;

                // Safety check
                const safety = validatePublicPost(commentText);
                if (!safety.ok) {
                    console.warn(`[SocialEngagement] Proactive comment blocked by safety: ${safety.reason}`);
                    continue;
                }

                // Post it
                const parentRef = { uri: post.uri, cid: post.cid };
                const result = await this.blueskeyClient.reply(commentText, parentRef, parentRef);
                this._recordComment(post.uri, handle);
                this._recordInteraction({
                    platform: 'bluesky',
                    type: 'proactive_comment',
                    reason: evaluation.angle,
                    author: handle,
                    sourceUri: post.uri,
                    responseUri: result?.uri || '',
                    inboundText: post.text,
                    responseText: commentText,
                    status: 'posted',
                });
                this._queueReplyScore({
                    uri: result?.uri,
                    platform: 'bluesky',
                    type: 'proactive_comment',
                    text: commentText,
                    parentUri: post.uri,
                    author: handle,
                });
                commented++;

                console.log(`[SocialEngagement] 💬 Proactive comment on @${handle} (${post.source}): "${commentText.slice(0, 60)}..."`);

                // Breathe between comments
                if (commented < MAX_PER_TICK) await new Promise(r => setTimeout(r, 60_000));

            } catch (e) {
                console.warn(`[SocialEngagement] Proactive comment failed for @${handle}: ${e.message}`);
            }
        }

        if (commented > 0 || liked > 0) {
            console.log(`[SocialEngagement] Proactive: posted ${commented} comment(s), ${liked} like(s) today (${p.dailyCount}/${MAX_DAILY_PROACTIVE} comments, ${p.dailyLikes}/${MAX_DAILY_LIKES} likes)`);
        }
    }

    // ── Bluesky notification replies ──────────────────────────────────────────

    async _checkBluesky() {
        if (!this.blueskeyClient?.configured) return;
        try {
            this.blueskyCortex.setBrain(this.brain);
            const result = await this.blueskyCortex.processNotifications({ limit: 25, markSeen: true });
            const rows = result.results || [];
            const replied = rows.filter(item => item.action === 'reply' || item.action === 'like_and_reply').length;
            const liked = rows.filter(item => item.action === 'like' || item.action === 'like_and_reply').length;
            const review = rows.filter(item => item.action === 'review').length;
            if (result.total) {
                console.log(`[SocialEngagement] Bluesky cortex: ${result.total} inbound, ${replied} replies, ${liked} likes, ${review} review`);
            }
            const dmResult = await this.blueskyCortex.processDirectMessages({ limit: 20, messagesPerConvo: 20, markRead: true })
                .catch(error => ({ ok: false, error: error.message, total: 0 }));
            if (dmResult.ok && dmResult.total) {
                const dmReplies = (dmResult.results || []).filter(item => item.action === 'reply').length;
                const dmReview = (dmResult.results || []).filter(item => item.action === 'review' || item.action === 'draft').length;
                console.log(`[SocialEngagement] Bluesky DM cortex: ${dmResult.total} inbound, ${dmReplies} replies, ${dmReview} review/drafts`);
            } else if (!dmResult.ok && /chat|convo|scope|auth|password/i.test(dmResult.error || '')) {
                console.warn(`[SocialEngagement] Bluesky DM check skipped: ${dmResult.error}`);
            }
        } catch (e) {
            console.warn(`[SocialEngagement] Bluesky check failed: ${e.message}`);
        }
    }

    // ── LinkedIn ─────────────────────────────────────────────────────────────

    async _checkLinkedIn() {
        if (!this.linkedInClient?.configured) return;
        try {
            const notifications = await this.linkedInClient.getNotifications();
            const comments = notifications.filter(n =>
                !n.seen &&
                (n.type?.includes('COMMENT') || n.headline?.toLowerCase().includes('comment'))
            );

            if (!comments.length) return;
            console.log(`[SocialEngagement] LinkedIn: ${comments.length} new comment notifications`);

            let replied = 0;
            for (const notif of comments) {
                const id = notif.id;
                if (!id || this._hasSeen('linkedin', id)) { this._markSeen('linkedin', id); continue; }
                if (!notif.activityUrn) { this._markSeen('linkedin', id); continue; }

                const commentText = notif.subText || notif.headline || '';
                const replyText   = await this._generateReply('linkedin', commentText);

                if (replyText) {
                    await this.linkedInClient.replyToPost(notif.activityUrn, replyText);
                    replied++;
                    console.log(`[SocialEngagement] LinkedIn: replied to comment on ${notif.activityUrn}`);
                    await new Promise(r => setTimeout(r, 5000));
                }

                this._markSeen('linkedin', id);
            }

            console.log(`[SocialEngagement] LinkedIn: replied ${replied}/${comments.length}`);
        } catch (e) {
            console.warn(`[SocialEngagement] LinkedIn check failed: ${e.message}`);
        }
    }

    async _scorePendingBlueskyReplies() {
        if (!this.blueskeyClient?.configured || !Array.isArray(this.state.pendingScores)) return;
        const due = this.state.pendingScores.filter(item =>
            item.platform === 'bluesky' &&
            item.uri &&
            Date.now() - Number(item.postedAt || 0) >= REPLY_SCORE_AGE
        );
        if (!due.length) return;

        for (const entry of due.slice(0, 10)) {
            try {
                const metrics = await this.blueskeyClient.getPostMetrics(entry.uri);
                const score = metrics.likeCount * 3 + metrics.repostCount * 5 + metrics.replyCount * 4 + metrics.quoteCount * 4;
                recordSocialOutcome({
                    uri: entry.uri,
                    type: entry.type || 'social_reply',
                    text: entry.text || '',
                    postedAt: entry.postedAt,
                }, metrics, score);

                const interaction = this.state.interactions.find(item => item.responseUri === entry.uri);
                if (interaction) {
                    interaction.metrics = metrics;
                    interaction.score = score;
                    interaction.scoredAt = Date.now();
                }
                console.log(`[SocialEngagement] Learned from ${entry.type || 'reply'}: score=${score}`);
            } catch (e) {
                console.warn(`[SocialEngagement] Reply scoring failed for ${entry.uri}: ${e.message}`);
            }

            this.state.pendingScores = this.state.pendingScores.filter(item => item.uri !== entry.uri);
            saveState(this.state);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // ── X (Twitter) ──────────────────────────────────────────────────────────

    async _checkX() {
        if (!this.browserArbiter) return;
        try {
            const result = await this.browserArbiter.getMentionsX();
            const mentions = result?.mentions || [];
            if (!mentions.length) return;

            console.log(`[SocialEngagement] X: ${mentions.length} mentions found`);

            let replied = 0;
            for (const mention of mentions) {
                const id = mention.id || mention.url;
                if (!id || this._hasSeen('x', id)) { this._markSeen('x', id); continue; }

                const replyText = await this._generateReply('x', mention.text);

                if (replyText && mention.url) {
                    await this.browserArbiter.replyToTweetX(mention.url, replyText);
                    replied++;
                    console.log(`[SocialEngagement] X: replied to ${mention.author}`);
                    await new Promise(r => setTimeout(r, 4000));
                }

                this._markSeen('x', id);
            }

            console.log(`[SocialEngagement] X: replied ${replied}/${mentions.length}`);
        } catch (e) {
            console.warn(`[SocialEngagement] X check failed: ${e.message}`);
        }
    }

    // ── Main tick ────────────────────────────────────────────────────────────

    async onTick() {
        if (!this.brain) {
            console.warn('[SocialEngagement] No brain — skipping engagement tick');
            return;
        }

        console.log('[SocialEngagement] Checking for comments and mentions...');

        // Proactive commenting: read feed + curiosity topics, comment on interesting posts
        await this._proactiveCommentBluesky().catch(e => console.warn('[SocialEngagement] Proactive failed:', e.message));
        await new Promise(r => setTimeout(r, 2000));

        // Reply to notifications: check platforms sequentially to avoid hammering all APIs at once
        // and to prevent browser arbiter contention on X
        await this._checkBluesky().catch(e => console.warn('[SocialEngagement]', e.message));
        await new Promise(r => setTimeout(r, 2000));
        await this._checkLinkedIn().catch(e => console.warn('[SocialEngagement]', e.message));
        await new Promise(r => setTimeout(r, 2000));
        await this._checkX().catch(e => console.warn('[SocialEngagement]', e.message));
        await this._scorePendingBlueskyReplies().catch(e => console.warn('[SocialEngagement] Reply scoring failed:', e.message));

        // Grow her network: follow back real accounts (self-gated to ~every 3h, rate-limited)
        await this.followEngine?.runFollowPass?.()
            .then(r => { if (r?.followed) console.log(`[SocialEngagement] Follow pass: +${r.followed} follow-back(s)`); })
            .catch(e => console.warn('[SocialEngagement] Follow pass failed:', e.message));

        this.state.lastCheck.all = Date.now();
        saveState(this.state);
    }
}

export default SocialEngagementDaemon;
