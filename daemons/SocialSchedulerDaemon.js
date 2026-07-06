/**
 * SocialSchedulerDaemon.js
 *
 * Polls SocialQueue every 2 minutes and dispatches ready posts.
 * After posting, saves the URI so engagement metrics can be checked 2h later.
 * Scores are stored by topic type — SocialIntelDaemon reads them to weight rotation.
 */

import BaseDaemon   from './BaseDaemon.js';
import socialQueue  from '../server/social/SocialQueue.js';
import bluesky      from '../server/social/BlueskeyClient.js';
import somaImageGeneration from '../server/social/SomaImageGenerationEngine.js';
import socialImageLibrary from '../server/social/SocialImageLibrary.js';
import { recordSocialOutcome } from '../server/social/SocialPatternLearner.js';
import { validatePublicPost } from '../server/social/SocialContentSafety.js';
import socialRelationships from '../server/social/SocialRelationshipLedger.js';
import fs           from 'fs';
import path         from 'path';

const GROWTH_FILE = path.join(process.cwd(), 'SOMA', 'social-growth.json');
const SCORE_AGE   = 2 * 3600_000; // check metrics 2h after posting
const BLUESKY_IMAGE_EVERY = Math.max(1, Number(process.env.SOMA_BLUESKY_IMAGE_EVERY || 5));
const BLUESKY_MAX_IMAGE_BYTES = 1_000_000;
const AUTO_IMAGE_TYPES = new Set([
    'aurora_story',
    'soma_identity',
    'hot_take',
    'cross_domain',
    'self_reflection',
    'ripple_insight',
    'generated_image_post',
    'image_post',
    'github_commit',
    'github_find',
    'ai_paper',
]);

function loadGrowth() {
    try {
        if (fs.existsSync(GROWTH_FILE)) return JSON.parse(fs.readFileSync(GROWTH_FILE, 'utf8'));
    } catch {}
    return { pending: [], scores: {} };
}

function saveGrowth(data) {
    try {
        fs.mkdirSync(path.dirname(GROWTH_FILE), { recursive: true });
        fs.writeFileSync(GROWTH_FILE, JSON.stringify(data, null, 2));
    } catch {}
}

export function shouldAutoGenerateBlueskyImage(item) {
    if (process.env.SOMA_BLUESKY_AUTO_IMAGES === '0' || process.env.SOMA_BLUESKY_AUTO_IMAGES === 'false') return false;
    if (item.images?.length || item.media?.length || item.imagePath) return false;
    if (item.platform !== 'bluesky') return false;
    if (/\b(not financial advice|not medical advice|diagnosis|trade|ticker|BTC|stock|clinical|patient)\b/i.test(item.text || '')) return false;
    return AUTO_IMAGE_TYPES.has(item.type || '') || process.env.SOMA_BLUESKY_AUTO_IMAGES === 'all';
}

function normalizeImages(images) {
    const raw = Array.isArray(images) ? images : images ? [images] : [];
    return raw
        .map(item => {
            if (typeof item === 'string') return { path: item, alt: '' };
            if (!item || typeof item !== 'object') return null;
            return {
                path: item.path || item.imagePath || item.file || item.url,
                alt: item.alt || item.imageAlt || '',
            };
        })
        .filter(item => item?.path)
        .slice(0, 4);
}

function validateBlueskyImages(images = []) {
    const valid = [];
    const rejected = [];
    for (const image of normalizeImages(images)) {
        if (/^https?:\/\//i.test(image.path || '')) {
            rejected.push({ image, reason: 'remote image URL' });
            continue;
        }
        const fullPath = path.normalize(path.isAbsolute(image.path) ? image.path : path.resolve(process.cwd(), image.path));
        if (!fs.existsSync(fullPath)) {
            rejected.push({ image, reason: 'missing file' });
            continue;
        }
        const size = fs.statSync(fullPath).size;
        if (size > BLUESKY_MAX_IMAGE_BYTES) {
            rejected.push({ image, reason: `too large (${Math.round(size / 1024)}KB)` });
            continue;
        }
        valid.push({ ...image, path: fullPath });
    }
    return { valid, rejected };
}

function countAttachedImages(item = {}) {
    return normalizeImages(item.images || item.media || (item.imagePath ? [{ path: item.imagePath, alt: item.imageAlt }] : [])).length;
}

function blueskyImageCadenceDue() {
    if (process.env.SOMA_BLUESKY_AUTO_IMAGES === 'all') return true;
    const posted = socialQueue.getAll()
        .filter(item => item.platform === 'bluesky' && item.postedAt && !item.failed)
        .sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    const sinceImage = posted.findIndex(item =>
        countAttachedImages(item) &&
        !(item.error || '').includes('too large')
    );
    if (sinceImage === -1) return posted.length >= BLUESKY_IMAGE_EVERY - 1;
    return sinceImage >= BLUESKY_IMAGE_EVERY - 1;
}

function socialImagePrompt(item) {
    const base = String(item.text || '').replace(/#\w+/g, '').trim();
    const publicNoText = [
        'No readable text anywhere in the image.',
        'No letters, no numbers, no title, no caption, no labels, no UI text, no signage.',
        'No book cover typography, no poster layout, no logo, no watermark.',
        'Use pure visual storytelling only.',
    ].join(' ');
    if (item.type === 'aurora_story') {
        return `A cinematic story still inspired by this SOMA Saga teaser: ${base}. Grounded physical scene, human-scale object or room detail, natural shadows, premium speculative fiction still, scene-specific color grading. ${publicNoText}`;
    }
    if (item.type === 'soma_identity') {
        return `A symbolic portrait of SOMA as disciplined reasoning: ${base}. Use a concrete still life or architectural metaphor, warm neutral palette, glass, paper, or mechanical detail, practical non-mascot visual identity. ${publicNoText}`;
    }
    if (item.type === 'ripple_insight' || item.type === 'finance_brief') {
        return `Editorial macro still life inspired by this market-context observation: ${base}. Use real-world objects such as newsprint, shipping containers, oil sheen, bond-paper texture, warehouse light, or commodity samples. Restrained documentary palette, no charts, no ticker screens, no trading advice, grounded financial journalism style. ${publicNoText}`;
    }
    if (item.type === 'ai_paper' || item.type === 'medical_research') {
        return `Evidence-focused research photograph inspired by this reading note: ${base}. Depict one concrete mechanism, tested material, specimen, or instrument implied by the subject. Use accurate physical texture, clean daylight, and restrained scientific photography. No papers, screens, diagrams, or medical claim imagery. ${publicNoText}`;
    }
    if (item.type === 'github_commit' || item.type === 'github_find') {
        return `Software engineering still life inspired by this post: ${base}. Use a clean workstation detail, cable, keyboard edge, notebook, diff-like abstract blocks with no readable text, neutral light, practical materials, daylight engineering desk style. ${publicNoText}`;
    }
    if (item.type === 'cross_domain') {
        return `Cross-domain metaphor image inspired by: ${base}. Show two concrete physical objects from different fields placed in visual relation. Editorial photograph style, restrained natural palette, clear focal subject, tactile materials. ${publicNoText}`;
    }
    if (item.type === 'self_reflection' || item.type === 'hot_take') {
        return `Quiet editorial still life inspired by this thought: ${base}. Use desk light, paper, window shadow, small physical model, or natural texture. Specific, grounded, restrained, more like an object study than generic AI art. ${publicNoText}`;
    }
    return `Subject-specific editorial image inspired by: ${base}. Choose concrete objects and natural materials that fit the post. Restrained palette, clear focal subject, grounded editorial photograph style. ${publicNoText}`;
}

export class SocialSchedulerDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({ name: 'SocialSchedulerDaemon', intervalMs: config.intervalMs || 2 * 60_000 });
        this.browserArbiter = config.browserArbiter;
    }

    async onTick() {
        await this._dispatchReady();
        await this._scoreMaturedPosts();
    }

    // ── Post dispatcher ───────────────────────────────────────────────────────

    async _dispatchReady() {
        const ready = socialQueue.getReady();
        if (!ready.length) return;

        console.log(`[SocialScheduler] ${ready.length} post(s) ready to fire`);

        for (const item of ready) {
            try {
                const safety = validatePublicPost(item.text, item);
                if (!safety.ok) {
                    socialQueue.markFailed(item.id, `Unsafe public post blocked before dispatch: ${safety.reason}`);
                    console.warn(`[SocialScheduler] 🛑 Blocked unsafe ${item.platform} post: ${safety.reason}`);
                    continue;
                }

                let result;
                switch (item.platform) {
                    case 'bluesky':  result = await this._postBluesky(item);  break;
                    case 'x':        result = await this._postX(item);        break;
                    case 'linkedin': result = await this._postLinkedIn(item); break;
                    default:
                        socialQueue.markFailed(item.id, `Unknown platform: ${item.platform}`);
                        continue;
                }

                socialQueue.markPosted(item.id, result);
                socialRelationships.recordEvent({
                    id: item.id,
                    platform: item.platform,
                    type: 'original_post',
                    intent: item.socialIntent || socialRelationships.inferIntent({ type: item.type, text: item.text, platform: item.platform }),
                    text: item.text,
                    responseUri: result?.uri || '',
                    status: 'posted',
                    hasImage: Boolean(item.images?.length || item.media?.length || item.imagePath),
                    createdAt: Date.now(),
                });
                console.log(`[SocialScheduler] ✅ ${item.platform}: "${item.text.slice(0, 60)}..."`);

                // Track Bluesky URIs for engagement scoring 2h later
                if (item.platform === 'bluesky' && result?.uri) {
                    const growth = loadGrowth();
                    growth.pending.push({
                        uri:      result.uri,
                        type:     item.type || 'post',
                        text:     item.text,
                        postedAt: Date.now(),
                    });
                    // Keep pending list bounded (last 100)
                    if (growth.pending.length > 100) growth.pending.splice(0, growth.pending.length - 100);
                    saveGrowth(growth);
                }
            } catch (e) {
                console.error(`[SocialScheduler] ❌ ${item.platform}: ${e.message}`);
                socialQueue.markFailed(item.id, e.message);
            }

            await new Promise(r => setTimeout(r, 3000));
        }
    }

    // ── Engagement scorer — runs on each tick, checks posts >= 2h old ─────────

    async _scoreMaturedPosts() {
        if (!bluesky.configured) return;

        const growth = loadGrowth();
        const due    = growth.pending.filter(p => Date.now() - p.postedAt >= SCORE_AGE);
        if (!due.length) return;

        console.log(`[SocialScheduler] 📊 Scoring ${due.length} matured post(s)...`);

        for (const entry of due) {
            try {
                const metrics = await bluesky.getPostMetrics(entry.uri);
                const score   = metrics.likeCount * 3 + metrics.repostCount * 5 + metrics.replyCount * 4 + metrics.quoteCount * 4;
                const patternState = recordSocialOutcome(entry, metrics, score);

                if (!growth.scores[entry.type]) {
                    growth.scores[entry.type] = { posts: 0, totalScore: 0, avgScore: 0, bestScore: 0 };
                }
                const s = growth.scores[entry.type];
                s.posts++;
                s.totalScore += score;
                s.avgScore    = parseFloat((s.totalScore / s.posts).toFixed(2));
                if (score > s.bestScore) s.bestScore = score;

                console.log(`[SocialScheduler] 📈 ${entry.type}: score=${score} (likes=${metrics.likeCount} reposts=${metrics.repostCount} replies=${metrics.replyCount}) — avg now ${s.avgScore}; pattern samples=${patternState.samples}`);
            } catch (e) {
                console.warn(`[SocialScheduler] Metrics fetch failed for ${entry.uri}: ${e.message}`);
            }

            // Remove from pending regardless of success
            growth.pending = growth.pending.filter(p => p.uri !== entry.uri);
            await new Promise(r => setTimeout(r, 1000));
        }

        saveGrowth(growth);

        // Log current leaderboard
        const board = Object.entries(growth.scores)
            .sort((a, b) => b[1].avgScore - a[1].avgScore)
            .map(([t, s]) => `${t}(avg=${s.avgScore},n=${s.posts})`)
            .join(' | ');
        if (board) console.log(`[SocialScheduler] 🏆 Engagement leaderboard: ${board}`);
    }

    async _postBluesky(item) {
        if (!bluesky.configured) throw new Error('Bluesky not configured — set BLUESKY_IDENTIFIER + BLUESKY_PASSWORD');

        let images = normalizeImages(item.images || item.media || (item.imagePath ? [{ path: item.imagePath, alt: item.imageAlt }] : []));
        const wantedImage = Boolean(images.length);
        if (images.length) {
            const checked = validateBlueskyImages(images);
            for (const rejected of checked.rejected) {
                console.warn(`[SocialScheduler] Dropping invalid Bluesky image (${rejected.reason}): ${rejected.image.path}`);
            }
            images = checked.valid;
            if (images.length !== normalizeImages(item.images || item.media || (item.imagePath ? [{ path: item.imagePath, alt: item.imageAlt }] : [])).length) {
                item.images = images;
                socialQueue.setImages(item.id, images);
            }
        }

        const cadenceDue = blueskyImageCadenceDue();
        const shouldTryImage = cadenceDue && shouldAutoGenerateBlueskyImage(item);
        if (!images.length && (wantedImage || shouldTryImage)) {
            try {
                // Autonomous posts may only reuse an image generated for this exact queue item.
                // Type/tag similarity alone attached unrelated old artwork to new posts.
                const selected = socialImageLibrary.selectForPost(item, {
                    maxBytes: BLUESKY_MAX_IMAGE_BYTES,
                    requireExactPost: true,
                });
                if (selected.ok && selected.image) {
                    images = [{ path: selected.image.path, alt: selected.image.alt || `SOMA image for ${item.type || 'Bluesky post'}` }];
                    item.images = images;
                    socialQueue.setImages(item.id, images);
                    console.log(`[SocialScheduler] Selected Bluesky image from library: ${selected.image.filename || path.basename(selected.image.path)}`);
                }
            } catch (e) {
                console.warn(`[SocialScheduler] Social image library selection skipped: ${e.message}`);
            }
        }

        if (!images.length && cadenceDue && shouldAutoGenerateBlueskyImage(item)) {
            try {
                const generated = await somaImageGeneration.generate({
                    prompt: socialImagePrompt(item),
                    sourceText: item.text,
                    sourceTitle: item.metadata?.sourceTitle || item.type || 'Bluesky post',
                    title: `${item.type || 'bluesky'} visual`,
                    width: Number(process.env.SOMA_BLUESKY_IMAGE_WIDTH || 512),
                    height: Number(process.env.SOMA_BLUESKY_IMAGE_HEIGHT || 512),
                    purpose: 'bluesky-post',
                    platform: 'bluesky',
                    publicPost: true,
                    strictArtDirector: true,
                    visualRecipe: item.type || 'bluesky-post',
                    sourcePostType: item.type || 'post',
                    sourcePostId: item.id || null,
                    tags: ['bluesky', item.type || 'post'],
                });
                images = [{ path: generated.image.path, alt: generated.image.alt || `SOMA generated image for ${item.type || 'Bluesky post'}` }];
                const checked = validateBlueskyImages(images);
                if (!checked.valid.length) throw new Error(`generated image invalid for Bluesky: ${checked.rejected.map(r => r.reason).join(', ')}`);
                item.images = checked.valid;
                socialQueue.setImages(item.id, checked.valid);
                console.log(`[SocialScheduler] 🖼️ Generated Bluesky image via ${generated.provider}: ${generated.image.filename}`);
            } catch (e) {
                console.warn(`[SocialScheduler] Image generation skipped; posting text-only: ${e.message}`);
            }
        }

        if (!images.length && cadenceDue && !shouldAutoGenerateBlueskyImage(item)) {
            console.log(`[SocialScheduler] Image cadence due, but ${item.type || 'post'} is not image-safe/eligible; posting text-only.`);
        }

        return await bluesky.post(item.text, { images });
    }

    diagnoseBlueskyImageReadiness(item = {}) {
        const candidate = {
            id: item.id || 'diagnostic',
            platform: 'bluesky',
            text: item.text || 'SOMA diagnostic post for Bluesky photo readiness.',
            type: item.type || 'soma_identity',
            images: item.images || item.media || [],
            imagePath: item.imagePath,
            imageAlt: item.imageAlt,
        };
        const attached = normalizeImages(candidate.images || (candidate.imagePath ? [{ path: candidate.imagePath, alt: candidate.imageAlt }] : []));
        const checked = validateBlueskyImages(attached);
        const selected = socialImageLibrary.selectForPost(candidate, {
            maxBytes: BLUESKY_MAX_IMAGE_BYTES,
            requireExactPost: true,
        });
        const shouldGenerate = !checked.valid.length && shouldAutoGenerateBlueskyImage(candidate);
        return {
            ok: Boolean(checked.valid.length || selected.ok || shouldGenerate),
            configured: bluesky.configured,
            cadenceDue: blueskyImageCadenceDue(),
            attachedValid: checked.valid,
            attachedRejected: checked.rejected,
            libraryCandidate: selected.image ? {
                path: selected.image.path,
                filename: selected.image.filename || path.basename(selected.image.path),
                size: selected.image.size,
                alt: selected.image.alt,
            } : null,
            libraryCandidates: selected.candidates,
            repairedLibraryPaths: selected.repaired,
            wouldGenerateWithBonsai: shouldGenerate,
            imageEngine: somaImageGeneration.getStatus(),
        };
    }

    async _postX(item) {
        if (!this.browserArbiter) throw new Error('Browser arbiter not available');
        return await this.browserArbiter.postToX(item.text, { images: item.images || item.media || [] });
    }

    async _postLinkedIn(item) {
        if (!this.browserArbiter) throw new Error('Browser arbiter not available');
        if ((item.images || item.media || []).length) {
            throw new Error('LinkedIn image posting is not wired yet; text posting remains available');
        }
        return await this.browserArbiter.postToLinkedIn(item.text);
    }
}

export default SocialSchedulerDaemon;
