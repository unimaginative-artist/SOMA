import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const SOMA_DIR = path.join(ROOT, 'SOMA');
const QUEUE_FILE = path.join(SOMA_DIR, 'social-queue.json');
const CORTEX_DB_FILE = path.join(SOMA_DIR, 'social-media', 'bluesky-social-cortex.db');
const LEDGER_FILE = path.join(SOMA_DIR, 'social-media', 'social-relationships.json');

export const SOCIAL_QUERY_PATTERN = /\b(post|posts|posted|posting|bluesky|blusky|tweet|tweets|twitter|x\.com|social|socials|followers?|feed|reply|replied|replies|thread|who did you (?:talk|post|reply)|what did you (?:post|say|tweet))\b/i;

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'you', 'your', 'did', 'what',
    'this', 'who', 'me', 'my', 'i', 'we', 'our', 'they', 'them'
]);

function extractKeywords(text = '') {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9_\-@]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function formatDate(ts) {
    if (!ts) return 'recently';
    try {
        const d = new Date(ts);
        return d.toISOString().slice(0, 10);
    } catch {
        return 'recently';
    }
}

function cleanOneLine(text = '', maxLen = 300) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return cleaned.slice(0, maxLen - 3) + '...';
}

export class SocialContextProvider {
    constructor({
        queuePath = QUEUE_FILE,
        cortexDbPath = CORTEX_DB_FILE,
        ledgerPath = LEDGER_FILE,
        mnemonic = null
    } = {}) {
        this.queuePath = queuePath;
        this.cortexDbPath = cortexDbPath;
        this.ledgerPath = ledgerPath;
        this.mnemonic = mnemonic;
        this._db = null;
    }

    setMnemonic(mnemonic) {
        this.mnemonic = mnemonic;
    }

    hasSocialKeywords(text = '') {
        return SOCIAL_QUERY_PATTERN.test(String(text || ''));
    }

    _getCortexDb() {
        if (this._db) return this._db;
        if (!fs.existsSync(this.cortexDbPath)) return null;
        try {
            const Database = require('better-sqlite3');
            this._db = new Database(this.cortexDbPath, { readonly: true, fileMustExist: true });
            return this._db;
        } catch (e) {
            console.warn(`[SocialContextProvider] Could not open cortex db: ${e.message}`);
            return null;
        }
    }

    getRecentPosts({ limit = 15, platform = null, query = '' } = {}) {
        const posts = [];
        const seenUris = new Set();
        const seenTexts = new Set();

        // 1. Original broadcasts from social-queue.json
        try {
            if (fs.existsSync(this.queuePath)) {
                const rawQueue = JSON.parse(fs.readFileSync(this.queuePath, 'utf8'));
                const queueItems = Array.isArray(rawQueue) ? rawQueue : [];
                for (const item of queueItems) {
                    if (!item || !item.postedAt) continue;
                    if (platform && item.platform && item.platform !== platform) continue;
                    const uri = item.postResult?.uri || item.postResult?.url || item.id || '';
                    if (seenUris.has(uri)) continue;
                    if (uri) seenUris.add(uri);

                    posts.push({
                        id: item.id || uri,
                        platform: item.platform || 'bluesky',
                        type: 'original_post',
                        category: item.type || 'post',
                        recipient: 'public',
                        text: item.text || '',
                        inboundText: null,
                        uri,
                        threadUri: null,
                        timestamp: Number(item.postedAt || item.createdAt || 0),
                    });
                }
            }
        } catch (err) {
            console.warn(`[SocialContextProvider] Error reading social-queue: ${err.message}`);
        }

        // 2. Conversational replies and mentions from bluesky-social-cortex.db
        try {
            const db = this._getCortexDb();
            if (db) {
                // Table: processed_interactions
                try {
                    const rows = db.prepare(`
                        SELECT uri, platform, handle, thread_uri, text, response_text, response_uri, processed_at, created_at
                        FROM processed_interactions
                        WHERE response_text IS NOT NULL AND length(trim(response_text)) > 0
                        ORDER BY processed_at DESC
                        LIMIT 100
                    `).all();

                    for (const row of rows) {
                        const targetUri = row.response_uri || row.uri || '';
                        if (targetUri && seenUris.has(targetUri)) continue;
                        if (targetUri) seenUris.add(targetUri);

                        const recipient = row.handle
                            ? (row.handle.startsWith('@') ? row.handle : `@${row.handle}`)
                            : 'public';

                        posts.push({
                            id: row.uri || targetUri,
                            platform: row.platform || 'bluesky',
                            type: 'reply',
                            recipient,
                            text: row.response_text || '',
                            inboundText: row.text || null,
                            uri: targetUri,
                            threadUri: row.thread_uri || null,
                            timestamp: Number(row.processed_at || row.created_at || 0),
                        });
                    }
                } catch {
                    // Ignore table query errors if schema differs
                }

                // Table: review_queue (approved reviews that might not be in processed_interactions)
                try {
                    const approvedRows = db.prepare(`
                        SELECT id, uri, handle, thread_uri, text, status, response_uri, resolved_at, created_at
                        FROM review_queue
                        WHERE status = 'approved' AND response_uri IS NOT NULL AND length(trim(response_uri)) > 0
                        ORDER BY resolved_at DESC
                        LIMIT 50
                    `).all();

                    for (const row of approvedRows) {
                        const targetUri = row.response_uri || '';
                        if (targetUri && seenUris.has(targetUri)) continue;
                        if (targetUri) seenUris.add(targetUri);

                        const recipient = row.handle
                            ? (row.handle.startsWith('@') ? row.handle : `@${row.handle}`)
                            : 'public';

                        posts.push({
                            id: `review-${row.id}`,
                            platform: 'bluesky',
                            type: 'reply',
                            recipient,
                            text: row.text || '',
                            inboundText: null,
                            uri: targetUri,
                            threadUri: row.thread_uri || null,
                            timestamp: Number(row.resolved_at || row.created_at || 0),
                        });
                    }
                } catch {
                    // Ignore review_queue query errors
                }
            }
        } catch (err) {
            console.warn(`[SocialContextProvider] Error reading cortex db: ${err.message}`);
        }

        // Deduplicate any exact identical text occurrences
        const uniquePosts = [];
        for (const p of posts) {
            const key = `${p.platform}:${p.recipient}:${p.text.slice(0, 80)}`;
            if (seenTexts.has(key)) continue;
            seenTexts.add(key);
            uniquePosts.push(p);
        }

        // 3. Relevance ranking if query is provided
        const qClean = String(query || '').trim().toLowerCase();
        if (qClean) {
            const keywords = extractKeywords(qClean);
            const scored = uniquePosts.map(post => {
                let score = 0;
                const postTextLower = (post.text || '').toLowerCase();
                const inboundLower = (post.inboundText || '').toLowerCase();
                const recipientLower = (post.recipient || '').toLowerCase();

                // Exact phrase match
                if (qClean.length > 5 && postTextLower.includes(qClean)) {
                    score += 150;
                }
                if (qClean.length > 5 && inboundLower.includes(qClean)) {
                    score += 100;
                }

                // Check sub-phrases or segments (e.g. "most agents", "memory that argues")
                const subPhrases = qClean.split(/[",.?!;:]/).map(s => s.trim()).filter(s => s.length >= 8);
                for (const sub of subPhrases) {
                    if (postTextLower.includes(sub)) score += 80;
                    if (inboundLower.includes(sub)) score += 60;
                }

                // Keyword hits
                for (const kw of keywords) {
                    if (postTextLower.includes(kw)) score += 15;
                    if (inboundLower.includes(kw)) score += 10;
                    if (recipientLower.includes(kw)) score += 25;
                }

                // Recency weight: up to 10 points for posts in the last 30 days
                const ageDays = (Date.now() - (post.timestamp || 0)) / (24 * 3600 * 1000);
                if (ageDays >= 0 && ageDays < 30) {
                    score += Math.max(0, 10 - ageDays * 0.3);
                }

                return { post, score };
            });

            // Filter down: if top item has positive score, return top scored items
            const matches = scored.filter(s => s.score > 0);
            if (matches.length > 0) {
                matches.sort((a, b) => b.score - a.score || b.post.timestamp - a.post.timestamp);
                return matches.slice(0, limit).map(m => m.post);
            }
        }

        // Fallback: sort by timestamp descending
        uniquePosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return uniquePosts.slice(0, limit);
    }

    formatSocialContextBlock({ query = '', limit = 6 } = {}) {
        const posts = this.getRecentPosts({ query, limit });
        if (!posts.length) return '';

        const lines = [
            '[RECENT SOMA SOCIAL MEDIA ACTIVITY & POSTS]',
            'Evidence of what SOMA actually posted and who SOMA replied to on social media. Quote or reference these verified facts accurately:',
        ];

        for (const p of posts) {
            const dateStr = formatDate(p.timestamp);
            const shortText = cleanOneLine(p.text, 280);
            const shortInbound = p.inboundText ? cleanOneLine(p.inboundText, 200) : null;
            const uriNote = p.uri ? ` [uri: ${p.uri}]` : '';

            if (p.type === 'reply' && p.recipient && p.recipient !== 'public') {
                lines.push(`- Reply to ${p.recipient} on ${p.platform} (${dateStr}): "${shortText}"${uriNote}`);
                if (shortInbound) {
                    lines.push(`  (In response to ${p.recipient}: "${shortInbound}")`);
                }
            } else {
                lines.push(`- Original Post on ${p.platform} (${dateStr}): "${shortText}"${uriNote}`);
            }
        }

        lines.push('[/RECENT SOMA SOCIAL MEDIA ACTIVITY & POSTS]');
        return lines.join('\n');
    }

    async recordOutboundPost({
        platform = 'bluesky',
        text = '',
        type = 'original_post',
        recipient = 'public',
        inboundText = null,
        uri = '',
        threadUri = null,
        timestamp = Date.now()
    } = {}) {
        if (!text || !text.trim()) return;

        const normalizedRecipient = recipient
            ? (recipient.startsWith('@') || recipient === 'public' ? recipient : `@${recipient}`)
            : 'public';

        if (this.mnemonic?.remember) {
            try {
                let memoryContent = '';
                if (type === 'reply' && normalizedRecipient !== 'public') {
                    memoryContent = `[SOCIAL REPLY] SOMA replied to ${normalizedRecipient} on ${platform}: "${text}"`
                        + (inboundText ? ` in response to: "${inboundText}"` : '')
                        + (uri ? ` (URI: ${uri})` : '');
                } else {
                    memoryContent = `[SOCIAL POST] SOMA posted on ${platform}: "${text}"`
                        + (uri ? ` (URI: ${uri})` : '');
                }

                await this.mnemonic.remember(memoryContent, {
                    type: 'social_post',
                    platform,
                    recipient: normalizedRecipient,
                    postType: type,
                    uri: uri || '',
                    threadUri: threadUri || '',
                    timestamp,
                    importance: 0.85
                });
            } catch (err) {
                console.warn(`[SocialContextProvider] Failed to index post to MnemonicArbiter: ${err.message}`);
            }
        }
    }

    async syncHistoricalPostsToMnemonic(mnemonicArbiter = this.mnemonic) {
        if (!mnemonicArbiter?.remember) return { syncedCount: 0 };
        const posts = this.getRecentPosts({ limit: 250 });
        let syncedCount = 0;

        for (const post of posts) {
            try {
                const hashKey = crypto.createHash('sha1').update(`${post.platform}:${post.uri || post.text}`).digest('hex').slice(0, 16);
                let content = '';
                if (post.type === 'reply' && post.recipient !== 'public') {
                    content = `[HISTORICAL SOCIAL REPLY] SOMA replied to ${post.recipient} on ${post.platform}: "${post.text}"`
                        + (post.inboundText ? ` in response to: "${post.inboundText}"` : '')
                        + (post.uri ? ` (URI: ${post.uri})` : '');
                } else {
                    content = `[HISTORICAL SOCIAL POST] SOMA posted on ${post.platform}: "${post.text}"`
                        + (post.uri ? ` (URI: ${post.uri})` : '');
                }

                await mnemonicArbiter.remember(content, {
                    type: 'social_post',
                    platform: post.platform,
                    recipient: post.recipient,
                    postType: post.type,
                    uri: post.uri,
                    timestamp: post.timestamp,
                    id: `mem_social_${post.platform}_${hashKey}`,
                    historicalSync: true,
                    importance: 0.80
                });
                syncedCount++;
            } catch {
                // Continue syncing remaining posts
            }
        }

        return { syncedCount, total: posts.length };
    }
}

export const defaultSocialContextProvider = new SocialContextProvider();
export default defaultSocialContextProvider;
