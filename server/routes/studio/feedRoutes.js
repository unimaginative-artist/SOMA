import studioComments from '../../studio/StudioCommentsStore.js';
import studioFeed from '../../studio/StudioFeedStore.js';
import studioSaved from '../../studio/StudioSavedStore.js';
import studioAxisEvents from '../../studio/StudioAxisEventBus.js';
import { validatePublicPost } from '../../social/SocialContentSafety.js';

/** Register Studio feed, comments, and cross-surface saved-library routes. */
export default function registerStudioFeedRoutes(router, {
    resolveActor,
    requireActor,
    studioContentTarget,
    canViewStudioContent,
    publicComment,
    notify,
    emitStudioAction,
    rankStudioFeedForViewer,
    publicFeedPost,
    canViewPost,
}) {
    // ── Post comments (shared by the Studio phone app AND the web Stage) ────────
    router.get('/posts/:postId/comments', (req, res) => {
        try {
            const actor = resolveActor(req);
            const target = studioContentTarget(req.params.postId);
            if (!target) return res.status(404).json({ ok: false, error: 'Content not found.' });
            if (!canViewStudioContent(actor, target)) return res.status(404).json({ ok: false, error: 'not found' });
            res.json({ ok: true, comments: studioComments.list(req.params.postId).map(comment => publicComment(comment, actor)) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/posts/:postId/comments', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const target = studioContentTarget(req.params.postId);
            if (!target) return res.status(404).json({ ok: false, error: 'Content not found.' });
            if (!canViewStudioContent(actor, target)) return res.status(403).json({ ok: false, error: 'Safety policy blocks commenting on this content.' });
            const comment = studioComments.add(req.params.postId, {
                ...(req.body || {}),
                who: actor.userId,
                name: actor.displayName || actor.name || actor.handle,
                avatar: actor.avatar || '',
            });
            const content = target.item;
            notify(content.authorId, target.type === 'signal' ? 'signal_comment' : 'comment', actor.userId, `commented: "${(comment.text || '').slice(0, 80)}"`, content.id, {
                targetType: target.type,
                targetTitle: target.title,
                commentId: comment.id,
                parentCommentId: comment.parentId || '',
                deepLink: `/studio/${target.type}/${encodeURIComponent(content.id)}?comments=1&comment=${encodeURIComponent(comment.id)}`,
            });
            emitStudioAction('comment.created', actor, content.id, { comment: publicComment(comment, actor), targetType: target.type });
            res.json({ ok: true, comment: publicComment(comment, actor), comments: studioComments.list(req.params.postId).map(item => publicComment(item, actor)) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/posts/:postId/comments/:commentId/like', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const target = studioContentTarget(req.params.postId);
            if (!target) return res.status(404).json({ ok: false, error: 'Content not found.' });
            if (!canViewStudioContent(actor, target)) return res.status(403).json({ ok: false, error: 'Safety policy blocks this interaction.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const comment = studioComments.like(req.params.postId, req.params.commentId, actor.userId, enabled);
            if (!comment) return res.status(404).json({ ok: false, error: 'Comment not found.' });
            if (enabled) {
                notify(comment.who, 'comment_like', actor.userId, 'liked your comment', req.params.postId, {
                    targetType: target.type,
                    targetTitle: target.title,
                    commentId: comment.id,
                    deepLink: `/studio/${target.type}/${encodeURIComponent(req.params.postId)}?comments=1&comment=${encodeURIComponent(comment.id)}`,
                });
            }
            emitStudioAction('comment.like', actor, req.params.postId, { commentId: comment.id, enabled });
            res.json({ ok: true, comment: publicComment(comment, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/posts/:postId/comments/:commentId', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const comment = studioComments.update(req.params.postId, req.params.commentId, actor.userId, req.body?.text);
            if (!comment) return res.status(404).json({ ok: false, error: 'Comment not found.' });
            emitStudioAction('comment.updated', actor, req.params.postId, { comment: publicComment(comment, actor) });
            res.json({ ok: true, comment: publicComment(comment, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/posts/:postId/comments/:commentId', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const removed = studioComments.delete(req.params.postId, req.params.commentId, actor.userId);
            if (!removed) return res.status(404).json({ ok: false, error: 'Comment not found.' });
            emitStudioAction('comment.deleted', actor, req.params.postId, { commentId: req.params.commentId });
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Posts feed & live updates (SSE stream) ──────────────────────────────────
    router.get('/feed/events', (req, res) => {
        const actor = resolveActor(req);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*',
        });

        const send = (busEvent) => {
            const event = busEvent.payload || {};
            const data = {
                ...event,
                busEventId: busEvent.id,
                busEventType: busEvent.type,
            };
            res.write(`event: feed\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        res.write(`event: feed\n`);
        res.write(`data: ${JSON.stringify({ type: 'connected', at: Date.now() })}\n\n`);

        const offFeed = studioAxisEvents.subscribe(send, { typePrefix: 'studio.feed.' });
        const offComment = studioAxisEvents.subscribe(send, { typePrefix: 'studio.comment.' });

        const keepAlive = setInterval(() => {
            res.write(`event: ping\n`);
            res.write(`data: ${JSON.stringify({ at: Date.now() })}\n\n`);
        }, 25000);

        req.on('close', () => {
            clearInterval(keepAlive);
            try { offFeed(); } catch (_) {}
            try { offComment(); } catch (_) {}
        });
    });

    // ── Posts feed — the shared STUDIO feed (mobile + web + Command Bridge) ─────
    router.get('/feed', (req, res) => {
        try {
            const actor = resolveActor(req);
            const { limit, before, author, humanOnly, cohort } = req.query;
            let rawList = studioFeed.list({ limit: 200, before, author });

            // 1. Human-Only Filter Toggle: strictly removes synthetic AI and slop
            if (humanOnly === 'true' || req.query.filter === 'human_only') {
                rawList = rawList.filter(p => !p.ai && !p.slop && p.trust !== 'ai' && p.trust !== 'slop' && p.trust !== 'flagged_slop');
            }

            // 2. Age Cohort Zoning: Mature adults (36+) shielded from young adult suggestive exposure
            const viewerAgeBand = actor?.ageBand || cohort || 'core_adult';
            if (viewerAgeBand === 'mature_adult') {
                rawList = rawList.filter(p => !(p.authorAgeBand === 'young_adult' && (p.suggestive || p.topic === 'twerk' || p.topic === 'suggestive')));
            }

            const posts = rankStudioFeedForViewer(actor, rawList)
                .slice(0, Math.min(Number(limit) || 50, 200))
                .map(p => ({ ...publicFeedPost(p, actor), comments_count: studioComments.count(p.id) }));
            res.json({ ok: true, posts });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/flag-ai', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (!existing) return res.status(404).json({ ok: false, error: 'Post not found.' });

            existing.aiFlags = (existing.aiFlags || 0) + 1;
            existing.flaggedBy = existing.flaggedBy || [];
            if (!existing.flaggedBy.includes(actor.userId)) {
                existing.flaggedBy.push(actor.userId);
            }
            if (existing.aiFlags >= 2) {
                existing.slop = true;
                existing.trust = 'flagged_slop';
                existing.aiDisclosure = {
                    label: 'SLOP / AI',
                    description: 'Community-flagged as synthetic AI content',
                    flagCount: existing.aiFlags
                };
            }
            studioFeed.update(req.params.id, existing.authorId, existing);
            emitStudioAction('feed.flag_ai', actor, req.params.id, { flags: existing.aiFlags, trust: existing.trust });
            res.json({ ok: true, flags: existing.aiFlags, trust: existing.trust, post: publicFeedPost(existing, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;

            // SOMA content safety validation
            const text = req.body?.text || '';
            const isMediaOrVoice = Boolean(req.body?.mediaUrl || req.body?.audioUrl || req.body?.videoUrl || req.body?.type === 'voice' || req.body?.type === 'image' || req.body?.type === 'brainrot' || req.body?.type === 'video');
            const safety = (!text && isMediaOrVoice)
                ? { ok: true }
                : validatePublicPost(text, { platform: 'studio' });

            const post = studioFeed.add({
                ...(req.body || {}),
                authorId: actor.userId,
                authorName: actor.displayName || actor.name || actor.handle,
                authorAvatar: actor.avatar || '',
                authorTrustTier: actor.trustTier,
                authorAgeBand: actor.ageBand,
            });

            if (!safety.ok) {
                studioFeed.flag(post.id, safety.reason || 'Content safety warning');
                post.flagged = true;
                post.flaggedReason = safety.reason || 'Content safety warning';
            }

            emitStudioAction('feed.created', actor, post.id, { post: publicFeedPost(post, actor) });
            res.status(201).json({ ok: true, post: publicFeedPost(post, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/like', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const liker = actor.userId;
            const delta = req.body && req.body.delta != null ? req.body.delta : 1;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks liking this post.' });
            const post = studioFeed.like(req.params.id, liker, delta);
            if (post && Number(delta) > 0) notify(post.authorId, 'like', liker, 'liked your post', post.id);
            emitStudioAction('feed.like', actor, req.params.id, { enabled: Number(delta) > 0, post: post ? publicFeedPost(post, actor) : null });
            res.json({ ok: true, post: post ? publicFeedPost(post, actor) : null });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/dislike', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks disliking this post.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const post = studioFeed.dislike(req.params.id, actor.userId, enabled);
            emitStudioAction('feed.dislike', actor, req.params.id, { enabled });
            res.json({ ok: true, post: post ? publicFeedPost(post, actor) : null });
        } catch (e) {
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'DISLIKE_FAILED' });
        }
    });

    router.post('/feed/:id/repost', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks reposting this post.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const post = studioFeed.repost(req.params.id, actor.userId, enabled);
            if (post && enabled) notify(post.authorId, 'repost', actor.userId, 'reposted your post', post.id);
            emitStudioAction('feed.repost', actor, req.params.id, { enabled, post: post ? publicFeedPost(post, actor) : null });
            res.json({ ok: true, post: post ? publicFeedPost(post, actor) : null });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/bookmark', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks bookmarking this post.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const post = studioFeed.bookmark(req.params.id, actor.userId, enabled);
            if (post) {
                studioSaved.set(actor.userId, {
                    itemType: post.type === 'brainrot' ? 'brainrot' : 'flux',
                    itemId: post.id,
                    title: post.text?.slice(0, 120) || `${post.type || 'Studio'} post`,
                    description: post.text,
                    authorId: post.authorId,
                    mediaUrl: post.media?.[0]?.thumbnailUrl || post.media?.[0]?.url || post.media?.[0] || '',
                    payload: publicFeedPost(post, actor),
                }, enabled);
            }
            emitStudioAction('feed.bookmark', actor, req.params.id, { enabled, saved: enabled }, [actor.userId]);
            res.json({ ok: true, post: post ? publicFeedPost(post, actor) : null });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/report', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks reporting this post.' });
            const post = studioFeed.report(req.params.id, {
                userId: actor.userId,
                reason: req.body?.reason || 'other',
                note: req.body?.note || '',
            });
            emitStudioAction('moderation.report', actor, req.params.id, { targetType: 'feed', reason: req.body?.reason || 'other' }, [actor.userId]);
            res.json({ ok: true, post: post ? publicFeedPost(post, actor) : null });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/feed/bookmarks/me', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const posts = rankStudioFeedForViewer(actor, studioFeed.listBookmarks(actor.userId, { limit: req.query.limit || 50 }))
                .map(p => ({ ...publicFeedPost(p, actor), comments_count: studioComments.count(p.id) }));
            res.json({ ok: true, posts });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/feed/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            studioFeed.delete(req.params.id, actor.userId);
            studioComments.removePost(req.params.id);
            emitStudioAction('feed.deleted', actor, req.params.id);
            res.json({ ok: true });
        } catch (e) {
            res.status(/^Only the author/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/feed/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const post = studioFeed.update(req.params.id, actor.userId, req.body || {});
            if (!post) return res.status(404).json({ ok: false, error: 'Post not found.' });
            emitStudioAction('feed.updated', actor, post.id, { post: publicFeedPost(post, actor) });
            res.json({ ok: true, post: publicFeedPost(post, actor) });
        } catch (e) {
            res.status(/^Only the author/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    // ── Saved library — one cross-surface collection for Flux, Signals,
    // Brainrot, Live, Collections, and future Studio surfaces. A Save button is
    // not real unless it writes here.
    router.get('/saved', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            res.json({ ok: true, items: studioSaved.list(actor.userId, { limit: req.query.limit, type: req.query.type }) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/saved', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const body = req.body || {};
            const enabled = body.enabled !== false;
            const item = studioSaved.set(actor.userId, body, enabled);
            emitStudioAction('saved.changed', actor, body.id || body.targetId || '', { enabled, item }, [actor.userId]);
            res.json({ ok: true, saved: enabled, item });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/saved/:type/:id', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const removed = studioSaved.remove(actor.userId, req.params.type, req.params.id);
            emitStudioAction('saved.changed', actor, req.params.id, { enabled: false, type: req.params.type }, [actor.userId]);
            res.json({ ok: true, removed });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

}
