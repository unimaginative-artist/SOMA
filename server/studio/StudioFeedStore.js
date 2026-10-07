// Studio posts feed — the shared, real feed behind STUDIO (mobile + web + Command
// Bridge). A post written on any surface persists here and shows on all of them,
// authored by a real userId. Comments for a post live in StudioCommentsStore keyed
// by the post's id, so the feed and comments systems connect.
import fs from 'fs';
import path from 'path';
import { assertPublicPost } from '../social/SocialContentSafety.js';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-feed.json');
const now = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DISLIKE_DAILY_LIMIT = 25;
const DISLIKE_HOURLY_LIMIT = 5;

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

class StudioFeedStore {
    _load() {
        const db = readJson(FILE, null);
        return db && Array.isArray(db.posts) ? db : { posts: [] };
    }
    _save(db) { writeJson(FILE, db); return db; }

    list({ limit = 50, before = null, author = null } = {}) {
        let posts = this._load().posts.slice().sort((a, b) => b.createdAt - a.createdAt);
        if (author) posts = posts.filter(p => p.authorId === author);
        if (before) posts = posts.filter(p => p.createdAt < Number(before));
        return posts.slice(0, Math.min(Number(limit) || 50, 200));
    }

    get(id) { return this._load().posts.find(p => p.id === id) || null; }

    add({ authorId, authorName = '', authorAvatar = '', authorTrustTier = 'UNKNOWN', authorAgeBand = 'unknown', text, media = [], mediaUrl = '', audioUrl = '', videoUrl = '', duration = 0, type = 'text', trust = 'camera', attestation = null, metadata = {} } = {}) {
        const body = String(text || '').trim();
        const mediaArr = Array.isArray(media) ? media.filter(Boolean) : [];
        if (mediaUrl && !mediaArr.includes(mediaUrl)) mediaArr.push(mediaUrl);
        const resolvedAudio = audioUrl || metadata?.audioUrl || (type === 'voice' ? mediaUrl : '');
        const resolvedVideo = videoUrl || metadata?.videoUrl || ((type === 'brainrot' || type === 'video') ? (mediaUrl || mediaArr[0] || '') : '');
        if (!body && !mediaArr.length && !resolvedAudio && !resolvedVideo) throw new Error('A post needs text or media');
        if (body && ['usr-soma', 'usr-maxwell'].includes(String(authorId || ''))) {
            assertPublicPost(body, { platform: 'studio', type });
        }
        let resolvedType = type;
        if (resolvedAudio || type === 'voice') {
            resolvedType = 'voice';
        } else if (resolvedVideo || type === 'brainrot' || type === 'video') {
            resolvedType = type === 'video' ? 'video' : 'brainrot';
        } else if (mediaArr.length || mediaUrl || type === 'image') {
            resolvedType = 'image';
        }
        const post = {
            id: `p-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: String(authorId || 'anon'),
            authorName: String(authorName || ''),
            authorAvatar: String(authorAvatar || ''),
            authorTrustTier: String(authorTrustTier || 'UNKNOWN'),
            authorAgeBand: String(authorAgeBand || 'unknown'),
            text: body.slice(0, 2000),
            media: mediaArr.slice(0, 8),
            mediaUrl: mediaArr[0] || String(mediaUrl || ''),
            audioUrl: resolvedAudio || '',
            videoUrl: resolvedVideo || '',
            duration: Number(duration || metadata?.duration || 0),
            type: resolvedType,
            trust: trust || (metadata && metadata.trust) || 'camera',
            attestation: attestation || (metadata && metadata.attestation) || null,
            metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
            likes: 0,
            revision: 1,
            createdAt: now(),
        };
        const db = this._load();
        db.posts.push(post);
        db.posts = db.posts.slice(-1000); // cap history
        this._save(db);
        return post;
    }

    update(id, userId, { text, media, type, videoUrl } = {}) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        if (!userId || post.authorId !== userId) throw new Error('Only the author can edit this post');
        const nextText = text === undefined ? post.text : String(text || '').trim().slice(0, 2000);
        const nextMedia = media === undefined ? (post.media || []) : (Array.isArray(media) ? media.filter(Boolean).slice(0, 8) : []);
        const nextVideo = videoUrl !== undefined ? videoUrl : (post.videoUrl || '');
        if (!nextText && !nextMedia.length && !nextVideo && !post.audioUrl) throw new Error('A post needs text or media');
        post.text = nextText;
        post.media = nextMedia;
        if (nextVideo) post.videoUrl = nextVideo;
        post.type = nextVideo ? (type === 'video' ? 'video' : 'brainrot') : (nextMedia.length ? (type === 'text' ? 'image' : String(type || post.type || 'image')) : (post.audioUrl ? 'voice' : 'text'));
        post.updatedAt = now();
        post.revision = Number(post.revision || 1) + 1;
        this._save(db);
        return post;
    }

    like(id, userId, delta = 1) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        post.likers = post.likers || [];
        post.dislikers = post.dislikers || [];
        const has = post.likers.includes(userId);
        if (Number(delta) >= 0 && !has) { post.likers.push(userId); }
        else if (Number(delta) < 0 && has) { post.likers = post.likers.filter(u => u !== userId); }
        if (Number(delta) >= 0) post.dislikers = post.dislikers.filter(u => u !== userId);
        post.likes = post.likers.length;
        post.dislikes = post.dislikers.length;
        post.feedbackUpdatedAt = now();
        this._save(db);
        return post;
    }

    dislike(id, userId, enabled = true) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        post.likers = post.likers || [];
        post.dislikers = post.dislikers || [];
        post.feedback = Array.isArray(post.feedback) ? post.feedback : [];
        const has = post.dislikers.includes(userId);
        if (enabled && !has) {
            const windowStartDay = now() - DAY_MS;
            const windowStartHour = now() - HOUR_MS;
            const allFeedback = db.posts.flatMap(p => Array.isArray(p.feedback) ? p.feedback : []);
            const activeDislikes = allFeedback.filter(item =>
                item.userId === userId &&
                item.type === 'dislike' &&
                item.enabled !== false
            );
            const dailyCount = activeDislikes.filter(item => Number(item.updatedAt || item.createdAt || 0) >= windowStartDay).length;
            const hourlyCount = activeDislikes.filter(item => Number(item.updatedAt || item.createdAt || 0) >= windowStartHour).length;
            if (dailyCount >= DISLIKE_DAILY_LIMIT) {
                const err = new Error(`Daily dislike limit reached (${DISLIKE_DAILY_LIMIT}).`);
                err.code = 'DISLIKE_DAILY_LIMIT';
                err.status = 429;
                throw err;
            }
            if (hourlyCount >= DISLIKE_HOURLY_LIMIT) {
                const err = new Error(`Hourly dislike limit reached (${DISLIKE_HOURLY_LIMIT}).`);
                err.code = 'DISLIKE_HOURLY_LIMIT';
                err.status = 429;
                throw err;
            }
        }
        if (enabled && !has) post.dislikers.push(userId);
        if (!enabled && has) post.dislikers = post.dislikers.filter(u => u !== userId);
        if (enabled) post.likers = post.likers.filter(u => u !== userId);
        const existingFeedback = post.feedback.find(item => item.userId === userId && item.type === 'dislike');
        if (existingFeedback) {
            existingFeedback.enabled = Boolean(enabled);
            existingFeedback.updatedAt = now();
        } else {
            post.feedback.push({ userId, type: 'dislike', enabled: Boolean(enabled), createdAt: now(), updatedAt: now() });
        }
        post.likes = post.likers.length;
        post.dislikes = post.dislikers.length;
        post.feedbackUpdatedAt = now();
        this._save(db);
        return post;
    }

    repost(id, userId, enabled = true) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        post.reposters = post.reposters || [];
        const has = post.reposters.includes(userId);
        if (enabled && !has) post.reposters.push(userId);
        if (!enabled && has) post.reposters = post.reposters.filter(u => u !== userId);
        post.reposts = post.reposters.length;
        this._save(db);
        return post;
    }

    bookmark(id, userId, enabled = true) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        post.bookmarkers = post.bookmarkers || [];
        const has = post.bookmarkers.includes(userId);
        if (enabled && !has) post.bookmarkers.push(userId);
        if (!enabled && has) post.bookmarkers = post.bookmarkers.filter(u => u !== userId);
        post.bookmarks = post.bookmarkers.length;
        this._save(db);
        return post;
    }

    report(id, { userId, reason = 'other', note = '' } = {}) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        post.reports = Array.isArray(post.reports) ? post.reports : [];
        const cleanReason = String(reason || 'other').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40) || 'other';
        const existing = post.reports.find(item => item.userId === userId && item.reason === cleanReason);
        if (existing) {
            existing.note = String(note || existing.note || '').slice(0, 500);
            existing.updatedAt = now();
        } else {
            post.reports.push({
                id: `r-${now()}-${Math.random().toString(36).slice(2, 7)}`,
                userId,
                reason: cleanReason,
                note: String(note || '').slice(0, 500),
                createdAt: now(),
            });
        }
        post.reportCount = post.reports.length;
        if (post.reportCount >= 3) post.visibilityLimited = true;
        this._save(db);
        return post;
    }

    flag(id, reason = 'unspecified') {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return null;
        post.flagged = true;
        post.flaggedReason = String(reason).slice(0, 200);
        post.flaggedAt = Date.now();
        this._save(db);
        return post;
    }

    listBookmarks(userId, { limit = 50 } = {}) {
        const max = Math.min(Number(limit) || 50, 200);
        return this._load().posts
            .filter(post => Array.isArray(post.bookmarkers) && post.bookmarkers.includes(userId))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, max);
    }

    delete(id, userId) {
        const db = this._load();
        const post = db.posts.find(p => p.id === id);
        if (!post) return false;
        if (userId && post.authorId !== userId) throw new Error('Only the author can delete this post');
        db.posts = db.posts.filter(p => p.id !== id);
        this._save(db);
        return true;
    }
}

export default new StudioFeedStore();
