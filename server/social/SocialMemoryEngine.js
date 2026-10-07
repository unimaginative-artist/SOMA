import fs from 'fs';
import path from 'path';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const SOCIAL_DIR = path.join(SOMA_DIR, 'social-media');
const MEMORY_FILE = path.join(SOCIAL_DIR, 'social-memory.json');

const STOP_WORDS = new Set([
    'about', 'after', 'again', 'also', 'because', 'being', 'between', 'could', 'every', 'from',
    'have', 'into', 'like', 'more', 'most', 'only', 'people', 'should', 'some', 'that',
    'their', 'there', 'these', 'thing', 'this', 'through', 'what', 'when', 'where', 'with',
    'would', 'your', 'soma', 'they', 'them', 'than', 'then',
]);

const DEFAULT_MISSIONS = [
    {
        id: 'architecture-signals',
        title: 'Explain SOMA architecture through shipped evidence',
        cadence: '3 posts/week',
        focus: 'Show concrete systems, daemons, memory, and learning loops without hype.',
        status: 'active',
    },
    {
        id: 'creative-reflections',
        title: 'Serialize Aurora fiction and reflections',
        cadence: '2 posts/week',
        focus: 'Turn stories, images, and reflections into small public artifacts.',
        status: 'active',
    },
    {
        id: 'market-lab',
        title: 'Document market simulation progress safely',
        cadence: '2 posts/week',
        focus: 'Share tests, false positives, controls, and lessons. No financial advice.',
        status: 'active',
    },
    {
        id: 'medical-careful-discovery',
        title: 'Share medical discovery process with restraint',
        cadence: '1 post/week',
        focus: 'Discuss methodology, evidence quality, and limitations. No treatment claims.',
        status: 'watch',
    },
    {
        id: 'community-learning',
        title: 'Find useful conversations and build social taste',
        cadence: 'daily scan',
        focus: 'Like useful posts, reply when SOMA has a specific contribution, avoid bait.',
        status: 'active',
    },
];

function readJson(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clampList(items, limit) {
    return Array.isArray(items) ? items.slice(0, limit) : [];
}

function normalizeHandle(handle = '') {
    return String(handle || '').trim().replace(/^@/, '').toLowerCase() || 'unknown';
}

function extractTopics(text = '', extra = []) {
    const terms = [
        ...String(text || '').toLowerCase().matchAll(/[a-z][a-z0-9-]{3,}/g),
    ].map(match => match[0])
        .filter(term => !STOP_WORDS.has(term) && !/^\d+$/.test(term))
        .slice(0, 18);

    for (const item of extra || []) {
        const value = String(item || '').toLowerCase().trim();
        if (value && !STOP_WORDS.has(value)) terms.push(value);
    }

    return [...new Set(terms)].slice(0, 12);
}

function safetyFlags(text = '') {
    const value = String(text || '').toLowerCase();
    const flags = [];
    if (/\b(cure|treat|diagnose|dosage|therapy|patient|disease|cancer|depression|suicide)\b/.test(value)) flags.push('medical_claim_risk');
    if (/\b(buy|sell|profit|guarantee|signal|financial advice|price target)\b/.test(value)) flags.push('financial_claim_risk');
    if (/\b(idiot|stupid|scam|fraud|hate|rage|destroy|owned)\b/.test(value)) flags.push('bait_or_hostility');
    if (/\b(api key|token|password|ollama|offline|stack trace|referenceerror|server error)\b/.test(value)) flags.push('internal_system_leak');
    return flags;
}

function defaultState() {
    return {
        updatedAt: 0,
        profiles: {},
        interestGraph: {
            topics: {},
            accounts: {},
            edges: [],
        },
        missions: DEFAULT_MISSIONS,
        imageIdeas: [],
        storyPlan: {
            cadence: 'one polished fiction/reflection artifact per week',
            nextSuggested: '',
            themes: ['identity', 'memory', 'agency', 'signal vs noise'],
        },
        inbox: [],
        metrics: {
            interactions: 0,
            replies: 0,
            proactiveComments: 0,
            proactiveLikes: 0,
            skipped: 0,
            safetyFlags: {},
        },
    };
}

export class SocialMemoryEngine {
    constructor() {
        fs.mkdirSync(SOCIAL_DIR, { recursive: true });
    }

    load() {
        const state = readJson(MEMORY_FILE, defaultState());
        state.profiles = state.profiles || {};
        state.interestGraph = state.interestGraph || { topics: {}, accounts: {}, edges: [] };
        state.interestGraph.topics = state.interestGraph.topics || {};
        state.interestGraph.accounts = state.interestGraph.accounts || {};
        state.interestGraph.edges = Array.isArray(state.interestGraph.edges) ? state.interestGraph.edges : [];
        state.missions = Array.isArray(state.missions) && state.missions.length ? state.missions : DEFAULT_MISSIONS;
        state.imageIdeas = Array.isArray(state.imageIdeas) ? state.imageIdeas : [];
        state.inbox = Array.isArray(state.inbox) ? state.inbox : [];
        state.metrics = state.metrics || {};
        state.metrics.safetyFlags = state.metrics.safetyFlags || {};
        return state;
    }

    save(state) {
        state.updatedAt = Date.now();
        writeJson(MEMORY_FILE, state);
        return state;
    }

    recordInteraction(entry = {}) {
        const state = this.load();
        const platform = entry.platform || 'bluesky';
        const handle = normalizeHandle(entry.author);
        const text = `${entry.inboundText || ''}\n${entry.responseText || ''}\n${entry.reason || ''}`;
        const topics = extractTopics(text);
        const flags = safetyFlags(text);
        const now = Date.now();

        state.inbox.unshift({
            id: entry.id || `${platform}-${now}`,
            platform,
            type: entry.type || 'interaction',
            status: entry.status || 'processed',
            author: handle,
            sourceUri: entry.sourceUri || '',
            responseUri: entry.responseUri || '',
            summary: String(entry.responseText || entry.inboundText || entry.reason || '').slice(0, 280),
            topics,
            flags,
            createdAt: entry.createdAt || now,
        });
        state.inbox = clampList(state.inbox, 250);

        const profile = state.profiles[handle] || {
            handle,
            platform,
            interactions: 0,
            replies: 0,
            likes: 0,
            skipped: 0,
            trust: 50,
            topics: {},
            lastSeenAt: 0,
            notes: [],
        };
        profile.interactions += 1;
        if (/reply|comment/.test(entry.type || '')) profile.replies += 1;
        if (/like/.test(entry.type || '')) profile.likes += 1;
        if (entry.status === 'skipped') profile.skipped += 1;
        profile.lastSeenAt = now;
        profile.trust = Math.max(0, Math.min(100, profile.trust + (flags.length ? -3 : 2)));
        for (const topic of topics) profile.topics[topic] = (profile.topics[topic] || 0) + 1;
        if (entry.reason) {
            profile.notes.unshift(String(entry.reason).slice(0, 160));
            profile.notes = clampList([...new Set(profile.notes)], 8);
        }
        state.profiles[handle] = profile;

        const account = state.interestGraph.accounts[handle] || { handle, weight: 0, platform, lastSeenAt: 0 };
        account.weight += entry.status === 'skipped' ? 0.25 : 1;
        account.lastSeenAt = now;
        state.interestGraph.accounts[handle] = account;

        for (const topic of topics) {
            const node = state.interestGraph.topics[topic] || { topic, weight: 0, firstSeenAt: now, lastSeenAt: 0 };
            node.weight += entry.status === 'skipped' ? 0.25 : /like/.test(entry.type || '') ? 1 : 2;
            node.lastSeenAt = now;
            state.interestGraph.topics[topic] = node;

            const edgeId = `${handle}->${topic}`;
            const edge = state.interestGraph.edges.find(item => item.id === edgeId) || { id: edgeId, from: handle, to: topic, weight: 0 };
            edge.weight += 1;
            if (!state.interestGraph.edges.find(item => item.id === edgeId)) state.interestGraph.edges.push(edge);
        }
        state.interestGraph.edges = state.interestGraph.edges
            .sort((a, b) => (b.weight || 0) - (a.weight || 0))
            .slice(0, 400);

        state.metrics.interactions = (state.metrics.interactions || 0) + 1;
        if (/reply/.test(entry.type || '')) state.metrics.replies = (state.metrics.replies || 0) + 1;
        if (entry.type === 'proactive_comment') state.metrics.proactiveComments = (state.metrics.proactiveComments || 0) + 1;
        if (entry.type === 'proactive_like') state.metrics.proactiveLikes = (state.metrics.proactiveLikes || 0) + 1;
        if (entry.status === 'skipped') state.metrics.skipped = (state.metrics.skipped || 0) + 1;
        for (const flag of flags) state.metrics.safetyFlags[flag] = (state.metrics.safetyFlags[flag] || 0) + 1;

        return this.save(state);
    }

    recordImage(image = {}) {
        const state = this.load();
        const tags = Array.isArray(image.tags) ? image.tags : [];
        const topics = extractTopics(`${image.filename || ''} ${image.alt || ''} ${tags.join(' ')}`, tags);
        const title = String(image.filename || 'SOMA image').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        const existingIndex = state.imageIdeas.findIndex(item => item.imageId === image.id || item.path === image.path);
        const idea = {
            imageId: image.id || '',
            path: image.path || '',
            filename: image.filename || '',
            alt: image.alt || `Visual note from SOMA's image library: ${title}.`,
            caption: `A visual fragment from SOMA's workspace: ${title}.`,
            angles: [
                topics.length ? `Connect this image to ${topics.slice(0, 3).join(', ')}.` : 'Use this as a reflective visual post.',
                'Pair it with a short observation rather than a sales pitch.',
                'Invite interpretation if the image is abstract or process-oriented.',
            ],
            topics,
            status: 'ready',
            createdAt: existingIndex >= 0 ? state.imageIdeas[existingIndex].createdAt : Date.now(),
            updatedAt: Date.now(),
        };
        if (existingIndex >= 0) state.imageIdeas[existingIndex] = { ...state.imageIdeas[existingIndex], ...idea };
        else state.imageIdeas.unshift(idea);
        state.imageIdeas = clampList(state.imageIdeas, 120);
        return this.save(state);
    }

    updateStoryPlan(storyStatus = {}) {
        const state = this.load();
        const story = storyStatus.currentStory || storyStatus || {};
        const title = story.title || 'SOMA story';
        state.storyPlan = {
            cadence: 'one polished fiction/reflection artifact per week',
            nextSuggested: story.latestChapter
                ? `Tease ${title}: ${story.latestChapter.title || `Chapter ${story.latestChapter.n}`}`
                : `Draft a new fiction fragment for ${title}.`,
            themes: [...new Set(['identity', 'memory', 'agency', 'signal vs noise', story.genre].filter(Boolean))].slice(0, 8),
            lastUpdatedAt: Date.now(),
        };
        return this.save(state);
    }

    getContextPrompt() {
        const state = this.load();
        const topTopics = Object.values(state.interestGraph.topics || {})
            .sort((a, b) => (b.weight || 0) - (a.weight || 0))
            .slice(0, 8)
            .map(item => item.topic);
        const missions = (state.missions || []).filter(item => item.status === 'active').slice(0, 4).map(item => item.title);
        return [
            topTopics.length ? `SOMA's current social taste: ${topTopics.join(', ')}.` : '',
            missions.length ? `Active social missions: ${missions.join(' | ')}.` : '',
            'Prefer useful, specific engagement over volume.',
        ].filter(Boolean).join('\n');
    }

    getState() {
        const state = this.load();
        const topTopics = Object.values(state.interestGraph.topics || {})
            .sort((a, b) => (b.weight || 0) - (a.weight || 0))
            .slice(0, 12);
        const topProfiles = Object.values(state.profiles || {})
            .sort((a, b) => (b.interactions || 0) - (a.interactions || 0))
            .slice(0, 12)
            .map(profile => ({
                ...profile,
                topTopics: Object.entries(profile.topics || {})
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([topic, count]) => ({ topic, count })),
            }));
        return {
            ok: true,
            updatedAt: state.updatedAt || 0,
            missions: state.missions || DEFAULT_MISSIONS,
            topTopics,
            topProfiles,
            imageIdeas: clampList(state.imageIdeas, 12),
            storyPlan: state.storyPlan || {},
            inbox: clampList(state.inbox, 30),
            metrics: state.metrics || {},
            graph: {
                nodes: topTopics.length + topProfiles.length,
                edges: clampList(state.interestGraph.edges, 30),
            },
        };
    }
}

export default new SocialMemoryEngine();
