import fs from 'fs/promises';
import path from 'path';

const MEMORY_FILE = path.join(process.cwd(), 'SOMA', 'home-presence-memory.json');
const DEFAULT_PERSON = {
    attempts: 0,
    heardReplies: 0,
    answered: 0,
    noReplies: 0,
    failures: 0,
    confidence: 0.5,
    lastOutcome: null,
    lastSummary: null,
    lastInteractionAt: null,
    suppressedUntil: null
};

function keyFor(name = 'home') {
    return String(name || 'home').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'home';
}

async function readState() {
    try {
        const parsed = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : { version: 1, people: {} };
    } catch {
        return { version: 1, people: {} };
    }
}

async function writeState(state) {
    await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
    await fs.writeFile(MEMORY_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function nextProfile(profile, outcome, details = {}) {
    const now = Number(details.timestamp || Date.now());
    const next = { ...DEFAULT_PERSON, ...profile };
    next.attempts += outcome === 'attempted' ? 1 : 0;
    if (outcome === 'heard_reply') next.heardReplies += 1;
    if (outcome === 'answered') next.answered += 1;
    if (outcome === 'no_reply') next.noReplies += 1;
    if (outcome === 'failed') next.failures += 1;

    const delta = {
        attempted: details.visiblePerson === false ? -0.02 : 0.01,
        heard_reply: 0.12,
        answered: 0.16,
        no_reply: -0.08,
        failed: -0.12,
        bad_timing: -0.12
    }[outcome] || 0;
    next.confidence = clamp(next.confidence + delta);
    next.lastOutcome = outcome;
    next.lastSummary = details.summary || next.lastSummary || null;
    next.lastInteractionAt = now;

    const recentMissRate = next.attempts >= 3 ? (next.noReplies + next.failures) / next.attempts : 0;
    if (recentMissRate >= 0.6 || outcome === 'bad_timing') {
        next.suppressedUntil = now + 30 * 60 * 1000;
    } else if (outcome === 'answered' || outcome === 'heard_reply') {
        next.suppressedUntil = null;
    }
    return next;
}

export async function recordHomePresenceOutcome(person = 'home', outcome = 'attempted', details = {}) {
    const state = await readState();
    const key = keyFor(person);
    state.people = state.people || {};
    const existing = state.people[key] || { ...DEFAULT_PERSON, displayName: person || 'home', key };
    state.people[key] = {
        ...nextProfile(existing, outcome, details),
        displayName: existing.displayName || person || 'home',
        key
    };
    state.updatedAt = Date.now();
    await writeState(state);
    return state.people[key];
}

export async function getHomePresenceProfile(person = 'home') {
    const state = await readState();
    const key = keyFor(person);
    const profile = state.people?.[key] || { ...DEFAULT_PERSON, displayName: person || 'home', key };
    return {
        ...profile,
        suppressed: Boolean(profile.suppressedUntil && profile.suppressedUntil > Date.now())
    };
}

export function homePresenceMemoryPath() {
    return MEMORY_FILE;
}

export default {
    recordHomePresenceOutcome,
    getHomePresenceProfile,
    homePresenceMemoryPath
};
