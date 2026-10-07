import fs from 'fs';
import path from 'path';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const SOCIAL_DIR = path.join(SOMA_DIR, 'social-media');
const LEDGER_FILE = path.join(SOCIAL_DIR, 'social-relationships.json');
const DAILY_DIR = path.join(SOCIAL_DIR, 'daily');
const MAX_EVENTS = 500;
const MAX_THREADS = 180;
const MAX_NOTES = 12;

const TASTE_TOPICS = new Set([
    'architecture', 'memory', 'agency', 'autonomy', 'reflection', 'retrieval',
    'local models', 'open source', 'tooling', 'creative coding', 'fiction',
    'story', 'generated art', 'safety', 'evidence', 'systems', 'simulation',
]);

const SKIP_RE = /\b(follow back|airdrop|giveaway|onlyfans|ratio|cancel|drama|politics|election|war|hate|idiot|stupid|buy now|sell now|financial advice|diagnose|dosage|cure)\b/i;
const PRIVATE_RE = /\b(dm me|private|secret|password|api key|token|personal crisis|suicide|self-harm)\b/i;
const PROMO_RE = /\b(sale|discount|launch offer|book a call|subscribe|course|newsletter)\b/i;

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

function dateKey(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10);
}

function mdEscape(value = '') {
    return String(value || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function appendDailyJournal(entry = {}, derived = {}) {
    try {
        fs.mkdirSync(DAILY_DIR, { recursive: true });
        const day = dateKey(entry.createdAt || Date.now());
        const file = path.join(DAILY_DIR, `${day}.md`);
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, [
                '---',
                `date: ${day}`,
                'type: social-daily-journal',
                'tags: [social, bluesky, relationships, memory]',
                '---',
                '',
                `# SOMA Social Daily - ${day}`,
                '',
            ].join('\n'));
        }

        const time = new Date(entry.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const handle = normalizeHandle(entry.author || entry.handle);
        const intent = derived.intent || entry.intent || inferIntent(entry);
        const thread = derived.thread || null;
        const topics = derived.topics || extractTopics(`${entry.inboundText || ''} ${entry.responseText || ''} ${entry.text || ''}`);
        const lines = [
            '',
            `## ${time} - ${intent}`,
            '',
            `- Platform: ${entry.platform || 'bluesky'}`,
            `- Person: ${handle}`,
            `- Status: ${entry.status || 'observed'}`,
            thread?.threadUri ? `- Thread: ${thread.threadUri}` : null,
            topics.length ? `- Topics: ${topics.join(', ')}` : null,
            entry.inboundText || entry.text ? `- What happened: ${mdEscape(entry.inboundText || entry.text).slice(0, 420)}` : null,
            entry.responseText ? `- What I said: ${mdEscape(entry.responseText).slice(0, 420)}` : null,
            entry.reason ? `- Why it mattered: ${mdEscape(entry.reason).slice(0, 260)}` : null,
        ].filter(Boolean);
        fs.appendFileSync(file, `${lines.join('\n')}\n`);
        return file;
    } catch {
        return null;
    }
}

function countBy(items = [], keyFn) {
    const counts = {};
    for (const item of items) {
        const key = keyFn(item);
        if (!key) continue;
        counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, count }));
}

function rebuildDailyDistillation(state, day = dateKey()) {
    try {
        fs.mkdirSync(DAILY_DIR, { recursive: true });
        const events = (state.events || [])
            .filter(event => dateKey(event.createdAt || Date.now()) === day)
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (!events.length) return null;

        const people = countBy(events, event => event.author && event.author !== 'unknown' ? event.author : null).slice(0, 8);
        const platforms = countBy(events, event => event.platform || 'unknown').slice(0, 4);
        const intents = countBy(events, event => event.intent || event.type || 'unknown').slice(0, 6);
        const topics = countBy(events.flatMap(event => event.topics || []), topic => topic).slice(0, 10);
        const notable = events
            .filter(event =>
                event.responseText ||
                /posted|reply|comment|dm/.test(`${event.status} ${event.type}`) ||
                (event.topics || []).length >= 2
            )
            .slice(-8);

        const lessons = [];
        if (people.length) lessons.push(`Most recurring social contact today: ${people[0].key} (${people[0].count} event${people[0].count === 1 ? '' : 's'}).`);
        if (topics.length) lessons.push(`Strongest social topics: ${topics.slice(0, 5).map(item => item.key).join(', ')}.`);
        if (intents.length) lessons.push(`Dominant intent: ${intents[0].key}.`);
        const replies = events.filter(event => /reply|comment|dm/.test(event.type || '') && event.responseText).length;
        const observations = events.filter(event => /observe|skip|like/.test(`${event.intent} ${event.type} ${event.status}`)).length;
        if (replies || observations) lessons.push(`Balance: ${replies} substantive response${replies === 1 ? '' : 's'}, ${observations} lighter observation${observations === 1 ? '' : 's'}.`);

        const digestPath = path.join(DAILY_DIR, `${day}.distilled.md`);
        const body = [
            '---',
            `date: ${day}`,
            'type: social-daily-distillation',
            'tags: [social, distilled, bluesky, discord, relationships]',
            '---',
            '',
            `# SOMA Social Distillation - ${day}`,
            '',
            '## Summary',
            '',
            `- Events: ${events.length}`,
            platforms.length ? `- Platforms: ${platforms.map(item => `${item.key} (${item.count})`).join(', ')}` : null,
            people.length ? `- People: ${people.map(item => `@${item.key} (${item.count})`).join(', ')}` : null,
            intents.length ? `- Intents: ${intents.map(item => `${item.key} (${item.count})`).join(', ')}` : null,
            topics.length ? `- Topics: ${topics.map(item => item.key).join(', ')}` : null,
            '',
            '## What Mattered',
            '',
            ...(lessons.length ? lessons.map(item => `- ${item}`) : ['- No strong social signal emerged yet.']),
            '',
            '## Notable Moments',
            '',
            ...(notable.length ? notable.map(event => {
                const handle = event.author && event.author !== 'unknown' ? `@${event.author}` : 'unknown';
                const said = event.responseText ? ` SOMA said: ${mdEscape(event.responseText).slice(0, 220)}` : '';
                const observed = event.inboundText ? `Observed: ${mdEscape(event.inboundText).slice(0, 220)}` : mdEscape(event.status || event.type);
                return `- ${event.platform || 'social'} ${event.intent || event.type || 'event'} with ${handle}: ${observed}${said}`;
            }) : ['- No notable social moments recorded.']),
            '',
            '## Carry Forward',
            '',
            people.length ? `- Remember ${people[0].key} as the warmest current relationship thread unless future interactions contradict it.` : '- Keep watching for recurring people before assuming familiarity.',
            topics.length ? `- Reuse ${topics[0].key} only when there is a concrete reason, not as filler.` : '- Let weak topics decay.',
            '',
        ].filter(line => line !== null).join('\n');

        fs.writeFileSync(digestPath, body, 'utf8');
        return digestPath;
    } catch {
        return null;
    }
}

function normalizeHandle(handle = '') {
    return String(handle || '').trim().replace(/^@/, '').toLowerCase() || 'unknown';
}

function words(text = '') {
    return [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])].slice(0, 24);
}

function extractTopics(text = '') {
    const value = String(text || '').toLowerCase();
    const found = [];
    for (const topic of TASTE_TOPICS) {
        const compact = topic.replace(/\s+/g, '.{0,12}');
        if (new RegExp(`\\b${compact}\\b`, 'i').test(value)) found.push(topic);
    }
    for (const word of words(text)) {
        if (['memory', 'agent', 'agents', 'model', 'models', 'code', 'story', 'fiction', 'image', 'system', 'systems', 'local', 'open'].includes(word)) {
            found.push(word);
        }
    }
    return [...new Set(found)].slice(0, 10);
}

function defaultState() {
    return {
        version: 1,
        updatedAt: 0,
        people: {},
        threads: {},
        events: [],
        taste: {
            topics: {},
            preferredIntents: {
                respond_to_person: 1,
                build_relationship: 1,
                share_work: 1,
                signal_identity: 1,
                ask_feedback: 1,
                publish_story: 1,
                observe_quietly: 1,
            },
        },
        cadence: {
            originalPostsToday: 0,
            repliesToday: 0,
            likesToday: 0,
            storyPostsToday: 0,
            imagePostsSinceLast: 0,
            resetAt: 0,
        },
    };
}

function loadState() {
    const state = readJson(LEDGER_FILE, defaultState());
    state.people = state.people || {};
    state.threads = state.threads || {};
    state.events = Array.isArray(state.events) ? state.events : [];
    state.taste = state.taste || { topics: {}, preferredIntents: {} };
    state.taste.topics = state.taste.topics || {};
    state.taste.preferredIntents = state.taste.preferredIntents || {};
    state.cadence = state.cadence || {};
    resetCadenceIfNeeded(state);
    return state;
}

function saveState(state) {
    state.updatedAt = Date.now();
    writeJson(LEDGER_FILE, state);
    return state;
}

function resetCadenceIfNeeded(state) {
    const now = Date.now();
    if (!state.cadence.resetAt || now >= state.cadence.resetAt) {
        const tomorrow = new Date();
        tomorrow.setHours(24, 0, 0, 0);
        state.cadence = {
            ...state.cadence,
            originalPostsToday: 0,
            repliesToday: 0,
            likesToday: 0,
            storyPostsToday: 0,
            resetAt: tomorrow.getTime(),
        };
    }
}

function inferIntent({ type = '', text = '', platform = 'bluesky' } = {}) {
    const value = `${type} ${text}`.toLowerCase();
    if (/aurora|story|saga|chapter/.test(value)) return 'publish_story';
    if (/github_commit|shipped|commit|diff|patch/.test(value)) return 'share_work';
    if (/soma_identity|memory|attention|architecture|identity/.test(value)) return 'signal_identity';
    if (/what do you think|feedback|critique|would you/.test(value)) return 'ask_feedback';
    if (/reply|mention|dm|comment/.test(value)) return 'respond_to_person';
    if (/like|observe|timeline/.test(value)) return 'observe_quietly';
    if (platform === 'bluesky') return 'share_work';
    return 'observe_quietly';
}

function boundaryCheck({ text = '', handle = '', intent = '', channel = 'public' } = {}) {
    const reasons = [];
    if (SKIP_RE.test(text)) reasons.push('unsafe_or_low_quality_topic');
    if (PROMO_RE.test(text) && intent !== 'respond_to_person') reasons.push('promotional');
    if (PRIVATE_RE.test(text) && channel !== 'dm') reasons.push('private_or_sensitive');
    if (/unknown|bot\d*|promo/i.test(handle || '')) reasons.push('low_relationship_signal');
    return {
        ok: reasons.length === 0,
        reasons,
    };
}

function touchPerson(state, handle, entry = {}) {
    const key = normalizeHandle(handle);
    const person = state.people[key] || {
        handle: key,
        displayName: entry.displayName || '',
        platforms: {},
        topics: {},
        tonePreference: 'direct and restrained',
        relationship: 'unfamiliar',
        receptivity: 0.5,
        trust: 0.5,
        notes: [],
        lastSeenAt: 0,
        lastInteractionAt: 0,
        interactions: 0,
        repliesFromSoma: 0,
        likesFromSoma: 0,
        skips: 0,
    };

    person.displayName = entry.displayName || person.displayName;
    person.platforms[entry.platform || 'bluesky'] = true;
    person.lastSeenAt = Date.now();
    person.interactions += 1;
    if (/reply|comment|dm/.test(entry.type || '')) person.lastInteractionAt = Date.now();
    if (entry.responseText) person.repliesFromSoma += 1;
    if (/like/.test(entry.type || '')) person.likesFromSoma += 1;
    if (entry.status === 'skipped') person.skips += 1;

    const topics = extractTopics(`${entry.inboundText || ''} ${entry.responseText || ''} ${entry.reason || ''}`);
    for (const topic of topics) person.topics[topic] = (person.topics[topic] || 0) + 1;

    if (entry.reason) {
        person.notes.unshift(String(entry.reason).slice(0, 180));
        person.notes = [...new Set(person.notes)].slice(0, MAX_NOTES);
    }

    const positive = /posted|liked|reply/.test(`${entry.status} ${entry.type}`);
    const negative = /skipped|blocked|failed|hostile|spam/.test(`${entry.status} ${entry.reason}`);
    person.trust = Math.max(0, Math.min(1, person.trust + (positive ? 0.03 : 0) - (negative ? 0.08 : 0)));
    person.receptivity = Math.max(0, Math.min(1, person.receptivity + (entry.responseUri ? 0.04 : 0) - (entry.status === 'skipped' ? 0.03 : 0)));
    person.relationship =
        person.repliesFromSoma >= 3 ? 'recurring' :
        person.interactions >= 2 ? 'known' : 'unfamiliar';

    state.people[key] = person;
    return person;
}

function touchThread(state, threadUri, entry = {}) {
    if (!threadUri) return null;
    const thread = state.threads[threadUri] || {
        threadUri,
        platform: entry.platform || 'bluesky',
        handle: normalizeHandle(entry.author || entry.handle),
        status: 'open',
        intent: entry.intent || inferIntent(entry),
        topicHints: [],
        lastInboundText: '',
        lastSomaText: '',
        lastAction: '',
        replyCount: 0,
        createdAt: Date.now(),
        updatedAt: 0,
        followUpDueAt: null,
    };
    const topics = extractTopics(`${entry.inboundText || ''} ${entry.responseText || ''}`);
    thread.topicHints = [...new Set([...topics, ...(thread.topicHints || [])])].slice(0, 10);
    if (entry.inboundText) thread.lastInboundText = String(entry.inboundText).slice(0, 500);
    if (entry.responseText) {
        thread.lastSomaText = String(entry.responseText).slice(0, 500);
        thread.replyCount += 1;
        thread.followUpDueAt = Date.now() + 36 * 3600_000;
    }
    thread.lastAction = entry.type || entry.status || thread.lastAction;
    thread.updatedAt = Date.now();
    if (thread.replyCount >= 2) thread.status = 'cooldown';
    state.threads[threadUri] = thread;
    return thread;
}

export class SocialRelationshipLedger {
    load() { return loadState(); }
    save(state) { return saveState(state); }

    inferIntent(input = {}) {
        return inferIntent(input);
    }

    recordEvent(entry = {}) {
        const state = loadState();
        const intent = entry.intent || inferIntent(entry);
        const person = touchPerson(state, entry.author || entry.handle, entry);
        const thread = touchThread(state, entry.threadUri || entry.sourceUri || entry.responseUri, { ...entry, intent });
        const topics = extractTopics(`${entry.inboundText || ''} ${entry.responseText || ''} ${entry.text || ''}`);
        const journalPath = appendDailyJournal(entry, { intent, thread, topics });

        for (const topic of topics) {
            state.taste.topics[topic] = (state.taste.topics[topic] || 0) + (/posted|liked/.test(entry.status || '') ? 2 : 1);
        }
        state.taste.preferredIntents[intent] = (state.taste.preferredIntents[intent] || 0) + 1;

        if (entry.type === 'original_post') state.cadence.originalPostsToday += 1;
        if (/reply|comment|dm/.test(entry.type || '')) state.cadence.repliesToday += entry.responseText ? 1 : 0;
        if (/like/.test(entry.type || '')) state.cadence.likesToday += 1;
        if (intent === 'publish_story') state.cadence.storyPostsToday += 1;
        if (entry.hasImage) state.cadence.imagePostsSinceLast = 0;
        else if (entry.type === 'original_post') state.cadence.imagePostsSinceLast = Number(state.cadence.imagePostsSinceLast || 0) + 1;

        state.events.unshift({
            id: entry.id || `social-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            platform: entry.platform || 'bluesky',
            type: entry.type || 'interaction',
            intent,
            author: normalizeHandle(entry.author || entry.handle),
            threadUri: entry.threadUri || entry.sourceUri || entry.responseUri || '',
            inboundText: String(entry.inboundText || entry.text || '').slice(0, 500),
            responseText: String(entry.responseText || '').slice(0, 500),
            status: entry.status || 'observed',
            topics,
            journalPath,
            createdAt: entry.createdAt || Date.now(),
        });
        state.events = state.events.slice(0, MAX_EVENTS);
        state.threads = Object.fromEntries(Object.entries(state.threads).slice(-MAX_THREADS));
        const distillationPath = rebuildDailyDistillation(state, dateKey(entry.createdAt || Date.now()));
        if (state.events[0]) state.events[0].distillationPath = distillationPath;
        saveState(state);
        return { state, person, thread, intent };
    }

    getRelationshipContext(handle = '', threadUri = '') {
        const state = loadState();
        const person = state.people[normalizeHandle(handle)] || null;
        const thread = threadUri ? state.threads[threadUri] || null : null;
        const topTopics = person
            ? Object.entries(person.topics || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic]) => topic)
            : [];
        const boundary = boundaryCheck({ handle, text: thread?.lastInboundText || '', intent: thread?.intent || 'respond_to_person' });
        return {
            person,
            thread,
            boundary,
            text: [
                person ? `Relationship with @${person.handle}: ${person.relationship}, receptivity=${person.receptivity.toFixed(2)}, trust=${person.trust.toFixed(2)}, tone=${person.tonePreference}.` : `No prior relationship memory for @${normalizeHandle(handle)}.`,
                topTopics.length ? `Known shared topics: ${topTopics.join(', ')}.` : '',
                person?.notes?.length ? `Recent notes: ${person.notes.slice(0, 3).join(' | ')}` : '',
                thread ? `Open thread intent=${thread.intent}, status=${thread.status}, prior replies=${thread.replyCount}, last action=${thread.lastAction}.` : '',
                boundary.ok ? '' : `Boundary caution: ${boundary.reasons.join(', ')}.`
            ].filter(Boolean).join('\n')
        };
    }

    evaluateCandidate(post = {}) {
        const state = loadState();
        const handle = normalizeHandle(post.author?.handle || post.handle);
        const text = String(post.text || '');
        const topics = extractTopics(text);
        const person = state.people[handle] || null;
        const boundary = boundaryCheck({ text, handle, intent: 'respond_to_person' });
        const tasteFit = topics.reduce((sum, topic) => sum + Math.min(3, state.taste.topics[topic] || (TASTE_TOPICS.has(topic) ? 1 : 0)), 0);
        const relationshipBoost = person?.relationship === 'recurring' ? 2 : person?.relationship === 'known' ? 1 : 0;
        const promoPenalty = PROMO_RE.test(text) ? 3 : 0;
        const score = Math.max(0, tasteFit + relationshipBoost - promoPenalty - (boundary.ok ? 0 : 5));
        return {
            ok: boundary.ok,
            shouldSkip: !boundary.ok || score < 1,
            shouldLike: boundary.ok && score >= 2,
            shouldComment: boundary.ok && score >= 4,
            score,
            topics,
            handle,
            boundaryReasons: boundary.reasons,
            relationship: person?.relationship || 'unfamiliar',
        };
    }

    cadenceSnapshot() {
        const state = loadState();
        const topTopics = Object.entries(state.taste.topics || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([topic]) => topic);
        return {
            cadence: state.cadence,
            topTopics,
            activeThreads: Object.values(state.threads || {})
                .filter(thread => thread.status === 'open')
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .slice(0, 8),
        };
    }

    buildPromptContext({ handle = '', threadUri = '', postText = '' } = {}) {
        const rel = this.getRelationshipContext(handle, threadUri);
        const candidate = postText ? this.evaluateCandidate({ text: postText, handle }) : null;
        const cadence = this.cadenceSnapshot();
        return [
            rel.text,
            candidate ? `Taste fit for this post: score=${candidate.score}, topics=${candidate.topics.join(', ') || 'none'}, skip=${candidate.shouldSkip}.` : '',
            cadence.topTopics.length ? `SOMA's developed social taste: ${cadence.topTopics.join(', ')}.` : '',
            `Today's cadence: original=${cadence.cadence.originalPostsToday || 0}, replies=${cadence.cadence.repliesToday || 0}, likes=${cadence.cadence.likesToday || 0}.`,
            'Relationship rules: prefer continuity over volume, do not fake intimacy, do not flatter mechanically, do not over-reply, and let weak threads rest.'
        ].filter(Boolean).join('\n');
    }
}

export default new SocialRelationshipLedger();
