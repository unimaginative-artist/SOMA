#!/usr/bin/env node
/**
 * bluesky_worker.mjs
 * Standalone child process for Bluesky AT Protocol calls.
 * Reads a JSON task from stdin, writes a JSON result to stdout.
 * Runs in a clean process, unaffected by SOMA's main process state.
 *
 * Task types: login, post, reply, likePost, getNotifications, markSeen, refreshSession, getTimeline, searchPosts, getThread,
 * listConvos, getMessages, sendMessage, updateRead, deletePost, follow, getFollowers, getFollows
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const PDS = 'bsky.social';
const CHAT = 'api.bsky.chat';

const IMAGE_MIME = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif':  'image/gif',
};

function xrpc(method, endpoint, body, token, contentType = 'application/json') {
    return xrpcHost(PDS, method, endpoint, body, token, contentType);
}

function chatXrpc(method, endpoint, body, token, contentType = 'application/json') {
    return xrpcHost(CHAT, method, endpoint, body, token, contentType);
}

function xrpcHost(hostname, method, endpoint, body, token, contentType = 'application/json') {
    return new Promise((resolve, reject) => {
        const data    = Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': contentType };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (data)  headers['Content-Length'] = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);

        const options = {
            hostname,
            port:     443,
            path:     `/xrpc/${endpoint}`,
            method,
            headers,
            timeout:  20000,
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || raw.slice(0, 200)}`));
                    else resolve(parsed);
                } catch {
                    if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                    else resolve({ raw });
                }
            });
        });

        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        if (data) req.write(data);
        req.end();
    });
}

function resolveImagePath(inputPath) {
    if (!inputPath || /^https?:\/\//i.test(inputPath)) {
        throw new Error('Bluesky image posts require a local image path');
    }
    let cleaned = String(inputPath).trim()
        .replace(/^[`"'\u201c\u201d\u2018\u2019]+|[`"'\u201c\u201d\u2018\u2019]+$/g, '')
        .trim();
    const windowsPaths = [...cleaned.matchAll(/[a-zA-Z]:[\\/][^`"'\u201c\u201d\u2018\u2019]+/g)]
        .map(match => match[0].trim())
        .filter(Boolean);
    if (windowsPaths.length > 1) cleaned = windowsPaths[windowsPaths.length - 1];
    return path.normalize(path.isAbsolute(cleaned) ? cleaned : path.resolve(process.cwd(), cleaned));
}

async function uploadImages(images = [], token) {
    const uploads = [];
    for (const item of images.slice(0, 4)) {
        const fullPath = resolveImagePath(item.path);
        if (!fs.existsSync(fullPath)) throw new Error(`Image not found: ${item.path}`);

        const ext = path.extname(fullPath).toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) throw new Error(`Unsupported Bluesky image type: ${ext || 'unknown'}`);

        const data = fs.readFileSync(fullPath);
        if (data.length > 1_000_000) {
            throw new Error(`Bluesky image is too large (${Math.round(data.length / 1024)}KB). Keep images under 1MB.`);
        }

        const uploaded = await xrpc('POST', 'com.atproto.repo.uploadBlob', data, token, mime);
        uploads.push({
            alt: String(item.alt || '').slice(0, 1000),
            image: uploaded.blob,
        });
    }
    return uploads;
}

async function run() {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const task = JSON.parse(raw);

    let result;
    switch (task.type) {
        case 'login':
            result = await xrpc('POST', 'com.atproto.server.createSession',
                { identifier: task.identifier, password: task.password });
            break;

        case 'refreshSession':
            result = await xrpc('POST', 'com.atproto.server.refreshSession',
                null, task.refreshJwt);
            break;

        case 'post':
        case 'reply': {
            const record = {
                $type:     'app.bsky.feed.post',
                text:      task.text.slice(0, 300),
                createdAt: new Date().toISOString(),
            };
            if (task.facets?.length)  record.facets = task.facets;
            if (task.replyRef)        record.reply  = task.replyRef;
            if (task.images?.length) {
                const images = await uploadImages(task.images, task.token);
                if (images.length) {
                    record.embed = {
                        $type: 'app.bsky.embed.images',
                        images,
                    };
                }
            }
            result = await xrpc('POST', 'com.atproto.repo.createRecord', {
                repo: task.did, collection: 'app.bsky.feed.post', record
            }, task.token);
            break;
        }

        case 'likePost': {
            if (!task.subject?.uri || !task.subject?.cid) throw new Error('likePost requires subject uri and cid');
            const record = {
                $type:     'app.bsky.feed.like',
                subject:   { uri: task.subject.uri, cid: task.subject.cid },
                createdAt: new Date().toISOString(),
            };
            result = await xrpc('POST', 'com.atproto.repo.createRecord', {
                repo: task.did, collection: 'app.bsky.feed.like', record
            }, task.token);
            break;
        }

        case 'deletePost': {
            if (!task.repo || !task.rkey) throw new Error('deletePost requires repo and rkey');
            result = await xrpc('POST', 'com.atproto.repo.deleteRecord', {
                repo: task.repo,
                collection: 'app.bsky.feed.post',
                rkey: task.rkey,
            }, task.token);
            break;
        }

        case 'getNotifications':
            result = await xrpc('GET', `app.bsky.notification.listNotifications?limit=${task.limit || 20}`,
                null, task.token);
            break;

        case 'markSeen':
            result = await xrpc('POST', 'app.bsky.notification.updateSeen',
                { seenAt: new Date().toISOString() }, task.token);
            break;

        case 'getPostMetrics': {
            const encoded = encodeURIComponent(task.uri);
            result = await xrpc('GET', `app.bsky.feed.getPosts?uris=${encoded}`, null, task.token);
            const p = result?.posts?.[0];
            result = {
                uri:          task.uri,
                likeCount:    p?.likeCount    || 0,
                repostCount:  p?.repostCount  || 0,
                replyCount:   p?.replyCount   || 0,
                quoteCount:   p?.quoteCount   || 0,
            };
            break;
        }

        case 'getThread': {
            const uri = encodeURIComponent(task.uri || '');
            result = await xrpc('GET', `app.bsky.feed.getPostThread?uri=${uri}&depth=${task.depth || 4}&parentHeight=${task.parentHeight || 4}`, null, task.token);
            break;
        }

        case 'listConvos': {
            const limit = Math.min(Number(task.limit || 20), 100);
            const cursor = task.cursor ? `&cursor=${encodeURIComponent(task.cursor)}` : '';
            result = await chatXrpc('GET', `chat.bsky.convo.listConvos?limit=${limit}${cursor}`, null, task.token);
            break;
        }

        case 'getMessages': {
            if (!task.convoId) throw new Error('getMessages requires convoId');
            const limit = Math.min(Number(task.limit || 30), 100);
            const cursor = task.cursor ? `&cursor=${encodeURIComponent(task.cursor)}` : '';
            result = await chatXrpc('GET', `chat.bsky.convo.getMessages?convoId=${encodeURIComponent(task.convoId)}&limit=${limit}${cursor}`, null, task.token);
            break;
        }

        case 'sendMessage': {
            if (!task.convoId) throw new Error('sendMessage requires convoId');
            const text = String(task.text || '').trim().slice(0, 1000);
            if (!text) throw new Error('sendMessage requires text');
            result = await chatXrpc('POST', 'chat.bsky.convo.sendMessage', {
                convoId: task.convoId,
                message: { text },
            }, task.token);
            break;
        }

        case 'updateRead': {
            if (!task.convoId) throw new Error('updateRead requires convoId');
            result = await chatXrpc('POST', 'chat.bsky.convo.updateRead', {
                convoId: task.convoId,
                messageId: task.messageId || undefined,
            }, task.token);
            break;
        }

        case 'getTimeline':
            result = await xrpc('GET', `app.bsky.feed.getTimeline?limit=${task.limit || 20}`, null, task.token);
            break;

        case 'searchPosts': {
            const q = encodeURIComponent(task.query || '');
            result = await xrpc('GET', `app.bsky.feed.searchPosts?q=${q}&limit=${task.limit || 15}`, null, task.token);
            break;
        }

        case 'follow': {
            if (!task.subject) throw new Error('follow requires subject did');
            const record = {
                $type:     'app.bsky.graph.follow',
                subject:   task.subject,
                createdAt: new Date().toISOString(),
            };
            result = await xrpc('POST', 'com.atproto.repo.createRecord', {
                repo: task.did, collection: 'app.bsky.graph.follow', record
            }, task.token);
            break;
        }

        case 'getFollowers': {
            const actor = encodeURIComponent(task.actor || task.did || '');
            result = await xrpc('GET', `app.bsky.graph.getFollowers?actor=${actor}&limit=${Math.min(Number(task.limit || 50), 100)}`, null, task.token);
            break;
        }

        case 'getFollows': {
            const actor = encodeURIComponent(task.actor || task.did || '');
            result = await xrpc('GET', `app.bsky.graph.getFollows?actor=${actor}&limit=${Math.min(Number(task.limit || 50), 100)}`, null, task.token);
            break;
        }

        default:
            throw new Error(`Unknown task type: ${task.type}`);
    }

    process.stdout.write(JSON.stringify({ ok: true, data: result }));
}

run().catch(e => {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
});
