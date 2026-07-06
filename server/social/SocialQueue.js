/**
 * SocialQueue.js
 * Simple JSON file queue for scheduled social media posts.
 * SOMA/social-queue.json — persisted between restarts.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertPublicMediaMetadata, assertPublicPost, validatePublicPost } from './SocialContentSafety.js';
import socialImageLibrary from './SocialImageLibrary.js';

const QUEUE_FILE = path.join(process.cwd(), 'SOMA', 'social-queue.json');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // drop unposted items after 7 days

function load() {
    try {
        if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    } catch {}
    return [];
}

function save(items) {
    try {
        fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2));
    } catch (e) {
        console.error('[SocialQueue] save failed:', e.message);
    }
}

function normalizeImages(input) {
    const raw = Array.isArray(input) ? input : input ? [input] : [];
    return raw
        .map(item => {
            if (typeof item === 'string') return { path: item };
            if (item && typeof item === 'object') {
                return {
                    path: item.path || item.imagePath || item.file || item.url,
                    alt:  item.alt || item.imageAlt || '',
                };
            }
            return null;
        })
        .filter(item => item?.path)
        .slice(0, 4);
}

function hash(text, images = []) {
    const mediaKey = images.map(i => `${i.path}:${i.alt || ''}`).join('|');
    return crypto.createHash('sha1').update(`${text}\n${mediaKey}`).digest('hex').slice(0, 12);
}

export class SocialQueue {
    /** Add a post to the queue. Returns false if duplicate. */
    push({ platform, text, scheduledFor, type = 'post', images, imagePath, imageAlt, sourceKey, sourceUrl, socialIntent, metadata }) {
        assertPublicPost(text, { type, platform });
        const items = load();
        const normalizedImages = normalizeImages(images || (imagePath ? [{ path: imagePath, alt: imageAlt }] : []));
        assertPublicMediaMetadata(normalizedImages);
        const h     = hash(text, normalizedImages);
        if (items.some(i => i.contentHash === h)) return false;
        const cooldownMs = type === 'finance_brief' ? 48 * 3600_000 : 24 * 3600_000;
        if (sourceKey && items.some(i =>
            i.platform === platform &&
            i.sourceKey === sourceKey &&
            !i.failed &&
            Date.now() - (i.postedAt || i.createdAt || 0) < cooldownMs
        )) return false;

        const item = {
            id:          `sq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            platform,
            text,
            images:       normalizedImages,
            type,
            socialIntent: socialIntent || null,
            metadata: metadata && typeof metadata === 'object' ? metadata : {},
            sourceKey:    sourceKey || null,
            sourceUrl:    sourceUrl || null,
            scheduledFor: scheduledFor || Date.now(),
            contentHash:  h,
            createdAt:    Date.now(),
            postedAt:     null,
        };
        items.push(item);
        save(items);
        if (normalizedImages.length) {
            socialImageLibrary.recordUsage(normalizedImages, {
                platform,
                queueId: item.id,
                text,
                status: 'queued',
            });
        }
        return true;
    }

    /** Get all items whose scheduledFor <= now and haven't been posted. */
    getReady() {
        const now   = Date.now();
        const items = load();
        let changed = false;
        for (const item of items) {
            if (item.postedAt || item.failed || item.scheduledFor > now) continue;
            const verdict = validatePublicPost(item.text, item);
            if (verdict.ok) continue;
            if (verdict.code === 'privacy_leak') {
                item.text = '[REDACTED: outbound privacy gate]';
                item.privacyQuarantined = true;
            }
            item.failed = true;
            item.failedAt = Date.now();
            item.error = `Unsafe public post blocked before dispatch: ${verdict.reason}`;
            changed = true;
        }
        if (changed) save(items);
        return items.filter(i => !i.postedAt && !i.failed && i.scheduledFor <= now);
    }

    /** Mark an item as posted. */
    markPosted(id, result = {}) {
        const items = load();
        const item  = items.find(i => i.id === id);
        if (item) {
            item.postedAt = Date.now();
            item.postResult = result;
            if (item.images?.length) {
                socialImageLibrary.recordUsage(item.images, {
                    platform: item.platform,
                    queueId: item.id,
                    text: item.text,
                    status: 'posted',
                    postUrl: result?.url || result?.uri || result?.link || null,
                    usedAt: item.postedAt,
                });
            }
        }
        save(items);
    }

    /** Persist media changes made by the scheduler before dispatch. */
    setImages(id, images = []) {
        const items = load();
        const item = items.find(i => i.id === id);
        if (!item) return false;
        item.images = normalizeImages(images);
        item.contentHash = hash(item.text, item.images);
        save(items);
        return true;
    }

    /** Mark an item as failed (keeps it in queue for inspection but won't retry). */
    markFailed(id, error) {
        const items = load();
        const item  = items.find(i => i.id === id);
        if (item) { item.failed = true; item.failedAt = Date.now(); item.error = String(error); }
        save(items);
    }

    /** Remove items older than MAX_AGE_MS that are already posted or failed. */
    cleanup() {
        const cutoff = Date.now() - MAX_AGE_MS;
        const items  = load().filter(i => {
            if ((i.postedAt || i.failed) && i.createdAt < cutoff) return false;
            return true;
        });
        save(items);
        return items.length;
    }

    /** How many posts scheduled for a given platform today. */
    countTodayFor(platform) {
        const midnight = new Date(); midnight.setHours(0,0,0,0);
        return load().filter(i =>
            i.platform === platform &&
            i.scheduledFor >= midnight.getTime() &&
            !i.failed
        ).length;
    }

    countTodayForType(platform, type) {
        const midnight = new Date(); midnight.setHours(0,0,0,0);
        return load().filter(i =>
            i.platform === platform &&
            i.type === type &&
            i.scheduledFor >= midnight.getTime() &&
            !i.failed
        ).length;
    }

    hasRecentSourceKey(platform, sourceKey, cooldownMs = 24 * 3600_000) {
        if (!sourceKey) return false;
        return load().some(i =>
            i.platform === platform &&
            i.sourceKey === sourceKey &&
            !i.failed &&
            Date.now() - (i.postedAt || i.createdAt || 0) < cooldownMs
        );
    }

    getAll() { return load(); }
    getPending() { return load().filter(i => !i.postedAt && !i.failed); }
}

export default new SocialQueue();
