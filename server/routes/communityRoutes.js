import express from 'express';
import axisStore from '../axis/AxisStore.js';

export default function createCommunityRoutes(system) {
    const router = express.Router();
    const bcast  = (event, data) => system?.wss?.clients?.forEach(c => c.readyState === 1 && c.send(JSON.stringify({ type: event, ...data })));

    const getUser = (req) => ({
        userId:     req.headers['x-axis-user-id']     || 'anon',
        userName:   req.headers['x-axis-user-name']   || 'Anonymous',
        userAvatar: req.headers['x-axis-user-avatar'] || '',
    });

    // ── Communities ───────────────────────────────────────────────────────────
    router.get('/', (req, res) => {
        const u    = getUser(req);
        const list = axisStore.getCommunities({ userId: u.userId !== 'anon' ? u.userId : undefined });
        res.json({ ok: true, communities: list });
    });

    router.post('/', (req, res) => {
        try {
            const u = getUser(req);
            const { name, description, icon, coverImage, isPublic } = req.body || {};
            if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
            const community = axisStore.createCommunity({ name: name.trim(), description, icon, coverImage, creatorId: u.userId, creatorName: u.userName, isPublic: isPublic !== false });
            bcast('axis.community_created', { community });
            res.json({ ok: true, community });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/:id', (req, res) => {
        const u         = getUser(req);
        const community = axisStore.getCommunity(req.params.id);
        if (!community) return res.status(404).json({ ok: false, error: 'Not found' });
        const members   = axisStore.getCommunityMembers(req.params.id);
        const myMembership = members.find(m => m.user_id === u.userId) || null;
        res.json({ ok: true, community, members, myMembership });
    });

    router.patch('/:id', (req, res) => {
        try {
            const community = axisStore.updateCommunity(req.params.id, req.body || {});
            if (!community) return res.status(404).json({ ok: false, error: 'Not found' });
            bcast('axis.community_updated', { community });
            res.json({ ok: true, community });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.delete('/:id', (req, res) => {
        axisStore.deleteCommunity(req.params.id);
        bcast('axis.community_deleted', { id: req.params.id });
        res.json({ ok: true });
    });

    router.post('/:id/join', (req, res) => {
        try {
            const u = getUser(req);
            axisStore.joinCommunity(req.params.id, { userId: u.userId, userName: u.userName, userAvatar: u.userAvatar });
            bcast('axis.community_member_joined', { communityId: req.params.id, userId: u.userId, userName: u.userName });
            res.json({ ok: true, community: axisStore.getCommunity(req.params.id) });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.delete('/:id/leave', (req, res) => {
        const u = getUser(req);
        axisStore.leaveCommunity(req.params.id, u.userId);
        res.json({ ok: true });
    });

    // ── Posts ─────────────────────────────────────────────────────────────────
    router.get('/:id/posts', (req, res) => {
        const { before, limit } = req.query;
        const posts = axisStore.getCommunityPosts(req.params.id, { before: before ? Number(before) : null, limit: limit ? Number(limit) : 50 });
        res.json({ ok: true, posts });
    });

    router.post('/:id/posts', (req, res) => {
        try {
            const u = getUser(req);
            const { content, images } = req.body || {};
            if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
            const post = axisStore.createCommunityPost({ communityId: req.params.id, authorId: u.userId, authorName: u.userName, authorAvatar: u.userAvatar, content: content.trim(), images });
            bcast('axis.community_post_created', { communityId: req.params.id, post });
            res.json({ ok: true, post });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.delete('/:id/posts/:postId', (req, res) => {
        axisStore.deleteCommunityPost(req.params.postId);
        bcast('axis.community_post_deleted', { communityId: req.params.id, postId: req.params.postId });
        res.json({ ok: true });
    });

    router.post('/:id/posts/:postId/pin', (req, res) => {
        const { pinned } = req.body || {};
        axisStore.pinCommunityPost(req.params.postId, pinned !== false);
        res.json({ ok: true });
    });

    router.post('/:id/posts/:postId/like', (req, res) => {
        const u = getUser(req);
        const liked = axisStore.hasLikedPost(req.params.postId, u.userId);
        const count = liked
            ? axisStore.unlikeCommunityPost(req.params.postId, u.userId)
            : axisStore.likeCommunityPost(req.params.postId, u.userId);
        bcast('axis.community_post_liked', { communityId: req.params.id, postId: req.params.postId, userId: u.userId, liked: !liked, count });
        res.json({ ok: true, liked: !liked, count });
    });

    router.get('/:id/posts/:postId/comments', (req, res) => {
        res.json({ ok: true, comments: axisStore.getCommunityPostComments(req.params.postId) });
    });

    router.post('/:id/posts/:postId/comments', (req, res) => {
        try {
            const u = getUser(req);
            const { content } = req.body || {};
            if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
            const comment = axisStore.addCommunityPostComment({ postId: req.params.postId, authorId: u.userId, authorName: u.userName, authorAvatar: u.userAvatar, content: content.trim() });
            bcast('axis.community_post_comment_added', { communityId: req.params.id, postId: req.params.postId, comment });
            res.json({ ok: true, comment });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    return router;
}
