import fs from 'fs';
import path from 'path';
import rippleLoopLedger from '../../core/RippleLoopLedger.js';

const PATTERN_FILE = path.join(process.cwd(), 'SOMA', 'social-patterns.json');
const MAX_EXAMPLES = 80;

const DEFAULT_STATE = {
    updatedAt: 0,
    samples: 0,
    averages: {},
    features: {},
    topExamples: [],
    strategy: {
        guidance: [
            'No scored posts yet. Keep rotating content types until engagement data arrives.',
        ],
        preferredFeatures: [],
        avoidedFeatures: [],
        bestHours: [],
        bestTerms: [],
    },
};

function loadState() {
    try {
        if (fs.existsSync(PATTERN_FILE)) return JSON.parse(fs.readFileSync(PATTERN_FILE, 'utf8'));
    } catch {}
    return structuredClone(DEFAULT_STATE);
}

function saveState(state) {
    fs.mkdirSync(path.dirname(PATTERN_FILE), { recursive: true });
    fs.writeFileSync(PATTERN_FILE, JSON.stringify(state, null, 2));
}

function bucketLength(length) {
    if (length < 120) return 'length_short';
    if (length < 220) return 'length_medium';
    return 'length_long';
}

function extractTerms(text) {
    const stop = new Set([
        'the','and','for','that','this','with','from','into','your','you','are','not','but','its','it',
        'https','http','www','com','org','abs','ai','llm','soma','about','what','when','where','why',
    ]);
    return [...text.toLowerCase().matchAll(/[a-z][a-z0-9-]{3,}/g)]
        .map(m => m[0])
        .filter(term => !stop.has(term) && !/^\d+$/.test(term))
        .slice(0, 12);
}

export function extractSocialFeatures(entry) {
    const text = entry.text || '';
    const clean = text.replace(/https?:\/\/\S+/g, '').replace(/#[\w-]+/g, '').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    const postedAt = entry.postedAt || Date.now();
    const hour = new Date(postedAt).getHours();
    const firstWord = words[0]?.toLowerCase()?.replace(/[^a-z0-9-]/g, '') || '';

    const features = [
        bucketLength(text.length),
        `type_${entry.type || 'post'}`,
        `hour_${hour}`,
    ];

    if (/https?:\/\/\S+/.test(text)) features.push('has_url');
    else features.push('no_url');
    if (/\?/.test(text)) features.push('has_question');
    else features.push('no_question');
    if (/\bI\b|\bmy\b|\bme\b/i.test(text)) features.push('first_person');
    if (/[;:]/.test(text)) features.push('has_colon_semicolon');
    if (/\bnot\b|\bno\b|\bnever\b|\bwithout\b/i.test(text)) features.push('has_contrast');
    if (/[0-9]/.test(text)) features.push('has_numbers');
    if (firstWord) features.push(`lead_${firstWord}`);

    for (const term of extractTerms(text).slice(0, 6)) features.push(`term_${term}`);

    return { features, hour, length: text.length, wordCount: words.length };
}

function updateFeature(bucket, score) {
    bucket.posts = (bucket.posts || 0) + 1;
    bucket.totalScore = (bucket.totalScore || 0) + score;
    bucket.avgScore = parseFloat((bucket.totalScore / bucket.posts).toFixed(2));
    bucket.bestScore = Math.max(bucket.bestScore || 0, score);
}

function buildStrategy(state) {
    const ranked = Object.entries(state.features || {})
        .filter(([, data]) => data.posts >= 1)
        .sort((a, b) => (b[1].avgScore || 0) - (a[1].avgScore || 0));

    const preferred = ranked.slice(0, 8).map(([feature, data]) => ({ feature, ...data }));
    const avoided = ranked.slice(-8).reverse().map(([feature, data]) => ({ feature, ...data }));
    const bestHours = preferred
        .filter(item => item.feature.startsWith('hour_'))
        .map(item => ({ hour: Number(item.feature.slice(5)), avgScore: item.avgScore, posts: item.posts }))
        .slice(0, 3);
    const bestTerms = preferred
        .filter(item => item.feature.startsWith('term_'))
        .map(item => ({ term: item.feature.slice(5), avgScore: item.avgScore, posts: item.posts }))
        .slice(0, 8);

    const guidance = [];
    if (preferred.length) {
        guidance.push(`Lean into: ${preferred.slice(0, 5).map(i => i.feature.replace(/_/g, ' ')).join(', ')}.`);
    }
    if (avoided.length && state.samples >= 4) {
        guidance.push(`Use less often: ${avoided.slice(0, 4).map(i => i.feature.replace(/_/g, ' ')).join(', ')}.`);
    }
    if (bestHours.length) {
        guidance.push(`Best posting hours so far: ${bestHours.map(i => `${i.hour}:00`).join(', ')}.`);
    }
    if (!guidance.length) guidance.push('Keep exploring. More scored posts are needed before changing strategy strongly.');

    state.strategy = {
        guidance,
        preferredFeatures: preferred,
        avoidedFeatures: avoided,
        bestHours,
        bestTerms,
    };
}

export function recordSocialOutcome(entry, metrics = {}, score = 0) {
    const state = loadState();
    const extracted = extractSocialFeatures(entry);

    state.samples = (state.samples || 0) + 1;
    state.updatedAt = Date.now();
    state.averages.totalScore = (state.averages.totalScore || 0) + score;
    state.averages.avgScore = parseFloat((state.averages.totalScore / state.samples).toFixed(2));

    for (const feature of extracted.features) {
        if (!state.features[feature]) state.features[feature] = { posts: 0, totalScore: 0, avgScore: 0, bestScore: 0 };
        updateFeature(state.features[feature], score);
    }

    state.topExamples.push({
        uri: entry.uri,
        type: entry.type || 'post',
        text: entry.text || '',
        score,
        metrics,
        features: extracted.features.slice(0, 12),
        postedAt: entry.postedAt,
        scoredAt: Date.now(),
    });
    state.topExamples = state.topExamples
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, MAX_EXAMPLES);

    buildStrategy(state);
    saveState(state);
    rippleLoopLedger.recordSocialRippleOutcome(entry, metrics, score);
    return state;
}

export function getSocialPatternState() {
    return loadState();
}

export function buildSocialStrategyPrompt() {
    const state = loadState();
    const guidance = state.strategy?.guidance || DEFAULT_STATE.strategy.guidance;
    const terms = (state.strategy?.bestTerms || []).map(t => t.term).slice(0, 5);
    return [
        'Observed Bluesky performance patterns:',
        ...guidance.map(line => `- ${line}`),
        terms.length ? `- Strong topic words so far: ${terms.join(', ')}.` : null,
        '- Treat these as weak preferences, not hard rules. Keep variety and avoid sounding formulaic.',
    ].filter(Boolean).join('\n');
}

export default {
    extractSocialFeatures,
    recordSocialOutcome,
    getSocialPatternState,
    buildSocialStrategyPrompt,
};
