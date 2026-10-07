/**
 * core/OwnerMindModel.js
 *
 * Per-session cognitive state model — tracks what a user KNOWS, WANTS, and DOESN'T KNOW.
 * One instance per sessionId so multiple simultaneous users never corrupt each other's model.
 *
 * Tracks per topic:
 *  - demonstrated_knowledge: topics the user has clearly understood and applied
 *  - building_toward: consecutive questions suggesting a goal/project
 *  - confusion_signals: topics they keep asking about (implies gap, not curiosity)
 *  - proactive_hints: things SOMA should surface before being asked
 *
 * Updated after every chat. Injected as [USER MIND MODEL] into every prompt.
 * Persists to .soma/user-minds/{sessionId}.json  (falls back to .soma/user-minds/default.json).
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { ownerName } = _require('./SomaOwner.cjs');

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const MINDS_DIR  = path.join(__dirname, '..', 'server', '.soma', 'user-minds');
const MAX_TOPICS = 30;
const MAX_HINTS  = 5;

const CONFUSION_THRESHOLD = 3;
const BUILD_THRESHOLD     = 2;

function storePath(sessionId) {
    const safe = (sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return path.join(MINDS_DIR, `${safe}.json`);
}

function loadStore(sessionId) {
    try {
        const p = storePath(sessionId);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return { topics: {}, buildingToward: [], hints: [], lastUpdated: 0, sessionId };
}

function saveStore(sessionId, data) {
    try {
        if (!fs.existsSync(MINDS_DIR)) fs.mkdirSync(MINDS_DIR, { recursive: true });
        fs.writeFileSync(storePath(sessionId), JSON.stringify(data, null, 2));
    } catch {}
}

function extractTopics(text) {
    const t = text.toLowerCase();
    const patterns = [
        [/\b(websocket|ws)\b/,               'WebSocket'],
        [/\b(deepseek|llm|model|brain)\b/,   'AI models'],
        [/\b(memory|mnemonic|recall)\b/,     'memory system'],
        [/\b(arbiter|orchestrat)\b/,         'arbiter architecture'],
        [/\b(message.?broker|signal|cns)\b/, 'signal routing'],
        [/\b(deploy|docker|server|prod)\b/,  'deployment'],
        [/\b(latency|perf|slow|fast|speed)\b/, 'performance'],
        [/\b(database|sqlite|db|query)\b/,   'database'],
        [/\b(react|jsx|component|frontend|ui)\b/, 'frontend'],
        [/\b(node|express|backend|api|route)\b/,  'backend'],
        [/\b(goal|plan|task|mission)\b/,     'goals'],
        [/\b(self.?mod|patch|autonom)\b/,    'self-modification'],
        [/\b(security|auth|token|key)\b/,    'security'],
        [/\b(trading|stock|finance|market)\b/, 'finance'],
        [/\b(git|commit|branch|pr|pull.?request)\b/, 'git workflow'],
        [/\b(error|bug|fix|crash|fail)\b/,   'debugging'],
        [/\b(train|fine.?tun|dataset|learn)\b/, 'machine learning'],
        [/\b(voice|tts|speech|audio)\b/,     'voice/audio'],
    ];
    return [...new Set(patterns.filter(([re]) => re.test(t)).map(([, l]) => l))];
}

// ── Per-session registry ──────────────────────────────────────────────────────
const _registry = new Map(); // sessionId → UserMindModel instance

export class UserMindModel {
    constructor(sessionId = 'default') {
        this.sessionId = sessionId;
        this._data     = null;
        this._dirty    = false;
        this._recentTopicWindow = [];
        this._saveTimer = null;
    }

    _load() {
        if (!this._data) this._data = loadStore(this.sessionId);
    }

    update(userMessage, somaResponse, userCorrected = false) {
        this._load();
        const topics = extractTopics(userMessage);
        const now    = Date.now();

        for (const topic of topics) {
            if (!this._data.topics[topic]) {
                this._data.topics[topic] = {
                    askCount: 0, correctionCount: 0,
                    firstSeen: now, lastSeen: now,
                    knowledgeDemonstrated: false,
                };
            }
            const t = this._data.topics[topic];
            t.askCount++;
            t.lastSeen = now;
            if (userCorrected) { t.correctionCount++; t.knowledgeDemonstrated = true; }
            if (userMessage.length > 80) t.knowledgeDemonstrated = true;
        }

        this._recentTopicWindow.push(...topics);
        if (this._recentTopicWindow.length > 10)
            this._recentTopicWindow = this._recentTopicWindow.slice(-10);

        const counts = {};
        for (const t of this._recentTopicWindow) counts[t] = (counts[t] || 0) + 1;
        this._data.buildingToward = Object.entries(counts)
            .filter(([, c]) => c >= BUILD_THRESHOLD).map(([t]) => t).slice(0, 3);

        this._data.hints = Object.entries(this._data.topics)
            .filter(([, v]) => v.correctionCount >= 2 && v.askCount >= CONFUSION_THRESHOLD)
            .sort((a, b) => b[1].correctionCount - a[1].correctionCount)
            .slice(0, MAX_HINTS)
            .map(([topic, v]) => `${topic} (asked ${v.askCount}x, corrected SOMA ${v.correctionCount}x)`);

        const entries = Object.entries(this._data.topics)
            .sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, MAX_TOPICS);
        this._data.topics = Object.fromEntries(entries);

        this._data.lastUpdated = now;
        this._dirty = true;

        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            if (this._dirty) { saveStore(this.sessionId, this._data); this._dirty = false; }
        }, 2000);
    }

    getContextString() {
        this._load();
        const d     = this._data;
        const parts = [];
        const name  = ownerName();

        if (d.buildingToward?.length)
            parts.push(`Currently building toward: ${d.buildingToward.join(', ')}`);
        if (d.hints?.length)
            parts.push(`Topics where SOMA gets corrected often — double-check: ${d.hints.join('; ')}`);

        const expert = Object.entries(d.topics)
            .filter(([, v]) => v.knowledgeDemonstrated && v.askCount >= 3)
            .map(([t]) => t).slice(0, 5);
        if (expert.length)
            parts.push(`${name} has demonstrated expertise in: ${expert.join(', ')} — skip basics`);

        if (!parts.length) return '';
        const tag = `${name.toUpperCase()} MIND MODEL`;
        return `\n[${tag} — silent background context only, do NOT quote directly]\n${parts.join('\n')}\n[/${tag}]\n`;
    }
}

/** Returns the UserMindModel for a given sessionId, creating it if needed. */
export function getUserMind(sessionId) {
    const key = sessionId || 'default';
    if (!_registry.has(key)) _registry.set(key, new UserMindModel(key));
    return _registry.get(key);
}

// Backward-compatible singleton — used by callers that don't have a sessionId
export const ownerMind = {
    update:           (...args) => getUserMind('default').update(...args),
    getContextString: ()        => getUserMind('default').getContextString(),
};

// Migrate legacy owner-mind.json into the new per-session store on first boot
try {
    const legacy = path.join(__dirname, '..', 'server', '.soma', 'owner-mind.json');
    const dest   = storePath('default');
    if (fs.existsSync(legacy) && !fs.existsSync(dest)) {
        if (!fs.existsSync(MINDS_DIR)) fs.mkdirSync(MINDS_DIR, { recursive: true });
        fs.copyFileSync(legacy, dest);
    }
} catch {}
