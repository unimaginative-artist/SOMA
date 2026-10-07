import fs from 'fs';
import path from 'path';
import socialQueue from './SocialQueue.js';
import { SocialPersonaEngine } from './SocialPersonaEngine.js';
import { polishPublicPost } from './SocialPostQualityGate.js';
import socialRelationships from './SocialRelationshipLedger.js';

const PREDICTIONS_FILE = path.join(process.cwd(), 'data', 'macroEventPredictions.json');

function readPredictions() {
    try {
        if (!fs.existsSync(PREDICTIONS_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf8'));
        return Array.isArray(parsed.predictions) ? parsed.predictions : [];
    } catch {
        return [];
    }
}

function firstUrl(prediction = {}) {
    const citations = prediction.sourceMeta?.citations || [];
    return citations.find(citation => /^https?:\/\//i.test(citation?.url || ''))?.url || prediction.sourceUrl || '';
}

function sentence(value = '', max = 130) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const clipped = clean.slice(0, max).trim();
    const stop = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf(';'), clipped.lastIndexOf(','));
    return (stop > 50 ? clipped.slice(0, stop) : clipped).trim();
}

function normalizeForSocial(prediction = {}) {
    const lens = prediction.lens?.label || prediction.lensLabel || 'Macro regime';
    const headline = prediction.headline || prediction.headlines?.[0] || prediction.query || 'Macro event scan';
    const summary = prediction.rippleEffectsPrediction || prediction.prediction || '';
    const provider = prediction.sourceMeta?.provider || 'ripple evidence';
    const url = firstUrl(prediction);
    return {
        lens,
        lensLabel: lens,
        title: headline,
        headline,
        summary,
        prediction: summary,
        provider,
        source: provider,
        url,
        sourceKey: `ripple:${prediction.fingerprint || headline.toLowerCase().slice(0, 80)}`,
        watch: 'Watch whether confirming instruments move together instead of one headline creating a temporary spike.',
        raw: prediction
    };
}

function deterministicDraft(data) {
    const lens = sentence(data.lens, 38);
    const headline = sentence(data.headline, 82);
    const url = data.url ? ` ${data.url}` : '';
    const body = `Ripple note (${lens}): ${headline}. Watch for confirmation across related signals before treating it as a regime shift.`;
    return polishPublicPost(`${body}${url}`, { type: 'ripple_insight', platform: 'bluesky' });
}

export class RippleSocialBridge {
    constructor({ brain } = {}) {
        this.persona = new SocialPersonaEngine({ brain });
    }

    setBrain(brain) {
        this.persona.setBrain(brain);
    }

    latestCandidate() {
        return readPredictions()
            .filter(item => item && !item.skippedDuplicate)
            .filter(item => item.status !== 'duplicate_collapsed' || (item.seenCount || 0) >= 2)
            .find(item => item.lens && (item.rippleEffectsPrediction || item.prediction))
            || readPredictions().find(item => item?.lens && (item.rippleEffectsPrediction || item.prediction))
            || null;
    }

    async buildDraft(prediction = null, { brain = null } = {}) {
        const candidate = prediction || this.latestCandidate();
        if (!candidate) throw new Error('No Ripple prediction available to socialise');
        if (brain) this.setBrain(brain);
        const data = normalizeForSocial(candidate);

        try {
            const post = await this.persona.generatePost('ripple_insight', data, 'bluesky');
            return { ...post, data, generatedBy: 'persona' };
        } catch (error) {
            const text = deterministicDraft(data);
            return {
                text,
                type: 'ripple_insight',
                platform: 'bluesky',
                socialIntent: socialRelationships.inferIntent({ type: 'ripple_insight', text, platform: 'bluesky' }),
                data,
                generatedBy: 'deterministic_fallback',
                generationError: error.message
            };
        }
    }

    async queueLatest({ brain = null, scheduledFor = null } = {}) {
        const draft = await this.buildDraft(null, { brain });
        const fireAt = scheduledFor || Date.now() + 5 * 60_000 + Math.floor(Math.random() * 10 * 60_000);
        const pushed = socialQueue.push({
            platform: 'bluesky',
            text: draft.text,
            type: 'ripple_insight',
            socialIntent: draft.socialIntent || socialRelationships.inferIntent({ type: 'ripple_insight', text: draft.text, platform: 'bluesky' }),
            scheduledFor: fireAt,
            sourceKey: draft.data.sourceKey,
            sourceUrl: draft.data.url || null,
            metadata: {
                rippleLens: draft.data.lens,
                provider: draft.data.provider,
                generatedBy: draft.generatedBy,
                generationError: draft.generationError || null,
                fingerprint: draft.data.raw?.fingerprint || null
            }
        });
        return { queued: Boolean(pushed), duplicate: !pushed, scheduledFor: fireAt, draft };
    }
}

export default new RippleSocialBridge();
