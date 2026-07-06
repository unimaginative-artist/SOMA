/**
 * BlueskeyClient.js
 * AT Protocol client for Bluesky.
 * Uses a child process (bluesky_worker.mjs) to isolate HTTP calls from
 * SOMA's main process, which has Windows Defender HTTPS interference.
 * Session persisted to SOMA/.bluesky-session.json (2h TTL, auto-refresh).
 *
 * Env vars: BLUESKY_HANDLE or BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD or BLUESKY_PASSWORD.
 * Use an app password, not the main account password.
 */

import fs   from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { assertPublicMediaMetadata, assertPublicPost } from './SocialContentSafety.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const WORKER       = path.join(__dirname, 'bluesky_worker.mjs');
const SESSION_FILE = path.join(process.cwd(), 'SOMA', '.bluesky-session.json');

function loadSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch {}
    return null;
}

function saveSession(data) {
    try {
        fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data));
    } catch {}
}

/** Run a task in the isolated child process. */
function runWorker(task) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [WORKER], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env:   { ...process.env },   // inherit env (for any future keys)
            windowsHide: true,
        });

        let out = '';
        let err = '';
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => err += d);

        let timeout;
        child.on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            try {
                const parsed = JSON.parse(out);
                if (!parsed.ok) reject(new Error(parsed.error || 'Worker error'));
                else resolve(parsed.data);
            } catch {
                reject(new Error(`Worker bad output (exit ${code}): ${err || out}`));
            }
        });

        child.stdin.write(JSON.stringify(task));
        child.stdin.end();

        // Worker-level timeout
        timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Bluesky worker timed out after 45s'));
        }, 45_000);
    });
}

/** Extract hashtag facets for the AT Protocol richtext spec. */
function buildFacets(text) {
    const facets = [];
    for (let i = 0; i < text.length; ) {
        if (text[i] === '#') {
            const tagStart = i;
            let j = i + 1;
            while (j < text.length && /\w/.test(text[j])) j++;
            const tag = text.slice(tagStart + 1, j);
            if (tag.length > 0) {
                const byteStart = Buffer.from(text.slice(0, tagStart), 'utf8').length;
                const byteEnd   = Buffer.from(text.slice(0, j), 'utf8').length;
                facets.push({
                    $type:    'app.bsky.richtext.facet',
                    index:    { byteStart, byteEnd },
                    features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
                });
            }
            i = j;
        } else {
            i++;
        }
    }
    return facets;
}

function buildLinkFacets(text) {
    const facets = [];
    const urlRe  = /https?:\/\/[^\s)>\]"']+/g;
    let   m;
    while ((m = urlRe.exec(text)) !== null) {
        const byteStart = Buffer.from(text.slice(0, m.index), 'utf8').length;
        const byteEnd   = Buffer.from(text.slice(0, m.index + m[0].length), 'utf8').length;
        facets.push({
            $type:    'app.bsky.richtext.facet',
            index:    { byteStart, byteEnd },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
        });
    }
    return facets;
}

function normalizeImages(images) {
    const raw = Array.isArray(images) ? images : images ? [images] : [];
    return raw
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

export class BlueskeyClient {
    constructor() {
        this.session   = loadSession();
        this.expiresAt = this.session?.expiresAt || 0;
    }

    get configured() {
        return !!((process.env.BLUESKY_HANDLE || process.env.BLUESKY_IDENTIFIER) && (process.env.BLUESKY_APP_PASSWORD || process.env.BLUESKY_PASSWORD));
    }

    async _ensureSession() {
        if (this.session && Date.now() < this.expiresAt - 60_000) return;

        const identifier = (process.env.BLUESKY_HANDLE || process.env.BLUESKY_IDENTIFIER)?.trim();
        const password   = (process.env.BLUESKY_APP_PASSWORD || process.env.BLUESKY_PASSWORD)?.trim();

        if (!identifier || !password) {
            throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD env vars required');
        }

        // Try refresh if session was created within the last 24h
        const sessionAge = this.expiresAt ? Date.now() - (this.expiresAt - 7_200_000) : Infinity;
        if (this.session?.refreshJwt && sessionAge < 86_400_000) {
            try {
                const data = await runWorker({ type: 'refreshSession', refreshJwt: this.session.refreshJwt });
                this.session   = { ...data, expiresAt: Date.now() + 7_200_000 };
                this.expiresAt = this.session.expiresAt;
                saveSession(this.session);
                return;
            } catch {}
        }

        // Full login
        this.session   = null;
        this.expiresAt = 0;
        const data = await runWorker({ type: 'login', identifier, password });
        this.session   = { ...data, expiresAt: Date.now() + 7_200_000 };
        this.expiresAt = this.session.expiresAt;
        saveSession(this.session);
    }

    /** Post to Bluesky. Returns { uri, cid } on success. */
    async post(text, options = {}) {
        assertPublicPost(text, { platform: 'bluesky', type: options.type || 'post' });
        assertPublicMediaMetadata(options.images || options.imagePath);
        await this._ensureSession();
        const postText = String(text || '').slice(0, 300);
        const facets = [...buildFacets(postText), ...buildLinkFacets(postText)];
        return await runWorker({
            type:   'post',
            text:   postText,
            facets: facets.length ? facets : undefined,
            images: normalizeImages(options.images || options.imagePath),
            did:    this.session.did,
            token:  this.session.accessJwt,
        });
    }

    /** Reply to a post. parentRef = { uri, cid }. rootRef = same or the thread root. */
    async reply(text, parentRef, rootRef) {
        assertPublicPost(text, { platform: 'bluesky', type: 'reply' });
        await this._ensureSession();
        const replyText = String(text || '').slice(0, 300);
        const facets   = [...buildFacets(replyText), ...buildLinkFacets(replyText)];
        const replyRef = { root: rootRef || parentRef, parent: parentRef };
        return await runWorker({
            type:     'reply',
            text:     replyText,
            facets:   facets.length ? facets : undefined,
            replyRef,
            did:      this.session.did,
            token:    this.session.accessJwt,
        });
    }

    /** The session DID (after auth), or null. */
    get did() { return this.session?.did || null; }

    /** Follow an account by DID. Returns { uri, cid }. */
    async follow(subjectDid) {
        await this._ensureSession();
        const did = String(subjectDid || '').trim();
        if (!did.startsWith('did:')) throw new Error('Bluesky follow requires a DID subject');
        if (did === this.session.did) throw new Error('Refusing to follow self');
        return await runWorker({ type: 'follow', subject: did, did: this.session.did, token: this.session.accessJwt });
    }

    /** Accounts that follow `actor` (default: SOMA). Returns [{ did, handle, displayName }]. */
    async getFollowers(actor = null, limit = 50) {
        await this._ensureSession();
        const data = await runWorker({ type: 'getFollowers', actor: actor || this.session.did, limit, token: this.session.accessJwt });
        return (data?.followers || []).map(a => ({ did: a.did, handle: a.handle, displayName: a.displayName || '' })).filter(a => a.did);
    }

    /** Accounts `actor` follows (default: SOMA). Returns [{ did, handle, displayName }]. */
    async getFollows(actor = null, limit = 100) {
        await this._ensureSession();
        const data = await runWorker({ type: 'getFollows', actor: actor || this.session.did, limit, token: this.session.accessJwt });
        return (data?.follows || []).map(a => ({ did: a.did, handle: a.handle, displayName: a.displayName || '' })).filter(a => a.did);
    }

    /** Like a Bluesky post. postRef = { uri, cid }. */
    async like(postRef) {
        await this._ensureSession();
        if (!postRef?.uri || !postRef?.cid) throw new Error('Bluesky like requires uri and cid');
        return await runWorker({
            type:    'likePost',
            subject: { uri: postRef.uri, cid: postRef.cid },
            did:     this.session.did,
            token:   this.session.accessJwt,
        });
    }

    /** Delete a record owned by this account. Accepts an AT URI or record key. */
    async deletePost(uriOrRkey) {
        await this._ensureSession();
        const value = String(uriOrRkey || '').trim();
        const match = value.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
        const repo = match?.[1] || this.session.did;
        const rkey = match?.[2] || value;
        if (!rkey || rkey.includes('/')) throw new Error('Bluesky deletePost requires a valid post AT URI or record key');
        if (repo !== this.session.did) throw new Error('Refusing to delete a Bluesky post owned by another account');
        return await runWorker({
            type: 'deletePost',
            repo,
            rkey,
            token: this.session.accessJwt,
        });
    }

    /** Get recent notifications (replies, mentions, likes). */
    async getNotifications(limit = 20) {
        await this._ensureSession();
        const data = await runWorker({ type: 'getNotifications', limit, token: this.session.accessJwt });
        return data.notifications || [];
    }

    /** Hydrate a Bluesky thread around a post URI. */
    async getThread(uri, options = {}) {
        await this._ensureSession();
        if (!uri) throw new Error('Bluesky getThread requires uri');
        return await runWorker({
            type: 'getThread',
            uri,
            depth: options.depth || 4,
            parentHeight: options.parentHeight || 4,
            token: this.session.accessJwt,
        });
    }

    /** List Bluesky DM conversations. Requires an app password with chat access. */
    async listConvos(limit = 20, cursor = null) {
        await this._ensureSession();
        return await runWorker({
            type: 'listConvos',
            limit,
            cursor,
            token: this.session.accessJwt,
        });
    }

    /** Get messages for a Bluesky DM conversation. */
    async getMessages(convoId, options = {}) {
        await this._ensureSession();
        if (!convoId) throw new Error('Bluesky getMessages requires convoId');
        return await runWorker({
            type: 'getMessages',
            convoId,
            limit: options.limit || 30,
            cursor: options.cursor || null,
            token: this.session.accessJwt,
        });
    }

    /** Send a Bluesky DM message. */
    async sendMessage(convoId, text) {
        await this._ensureSession();
        if (!convoId) throw new Error('Bluesky sendMessage requires convoId');
        return await runWorker({
            type: 'sendMessage',
            convoId,
            text: String(text || '').slice(0, 1000),
            token: this.session.accessJwt,
        });
    }

    /** Mark a Bluesky DM conversation read. */
    async updateRead(convoId, messageId = null) {
        await this._ensureSession();
        if (!convoId) throw new Error('Bluesky updateRead requires convoId');
        return await runWorker({
            type: 'updateRead',
            convoId,
            messageId,
            token: this.session.accessJwt,
        });
    }

    /** Mark notifications as seen. */
    async markSeen() {
        await this._ensureSession();
        await runWorker({ type: 'markSeen', token: this.session.accessJwt });
    }

    /** Get like/repost/reply counts for a post URI. */
    async getPostMetrics(uri) {
        await this._ensureSession();
        return await runWorker({ type: 'getPostMetrics', uri, token: this.session.accessJwt });
    }

    /**
     * Get home timeline posts (from accounts SOMA follows).
     * Returns array of { uri, cid, author: { did, handle, displayName }, text, createdAt, likeCount, replyCount }
     */
    async getTimeline(limit = 20) {
        await this._ensureSession();
        const data = await runWorker({ type: 'getTimeline', limit, token: this.session.accessJwt });
        return (data?.feed || []).map(item => {
            const post = item?.post || item;
            return {
                uri:         post?.uri || '',
                cid:         post?.cid || '',
                author:      post?.author || {},
                text:        post?.record?.text || '',
                createdAt:   post?.record?.createdAt || post?.indexedAt || '',
                likeCount:   post?.likeCount   || 0,
                replyCount:  post?.replyCount  || 0,
                repostCount: post?.repostCount || 0,
            };
        }).filter(p => p.uri && p.text);
    }

    /**
     * Search for posts by keyword or phrase.
     * Returns array of { uri, cid, author, text, createdAt }
     */
    async searchPosts(query, limit = 15) {
        await this._ensureSession();
        const data = await runWorker({ type: 'searchPosts', query, limit, token: this.session.accessJwt });
        return (data?.posts || []).map(post => ({
            uri:        post?.uri || '',
            cid:        post?.cid || '',
            author:     post?.author || {},
            text:       post?.record?.text || '',
            createdAt:  post?.record?.createdAt || post?.indexedAt || '',
            likeCount:  post?.likeCount  || 0,
            replyCount: post?.replyCount || 0,
        })).filter(p => p.uri && p.text);
    }
}

export default new BlueskeyClient();
