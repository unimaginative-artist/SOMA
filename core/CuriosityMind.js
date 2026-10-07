/**
 * core/CuriosityMind.js
 *
 * SOMA's curiosity as drives, not a schedule.
 *
 * A light heartbeat (every 2 minutes, no model calls) only lets her notice how
 * she feels. She acts when one of three pressures crosses its threshold, and the
 * strongest pressure wins:
 *
 *   curiosity    builds while a question pulls at her. She reads real pages
 *                about the most intriguing one, forms a view, and the reading
 *                raises the next question (why-chains up to 5 deep).
 *   selfInquiry  builds when something about her own functioning doesn't add
 *                up: crashes in her log, goals that keep failing, research that
 *                finds nothing, RAM/disk pressure, a limitation she's never
 *                understood. She asks "why?", looks at measured internals and
 *                her own source code, and ends with a belief ("this is my
 *                constraint") or a diagnosis proposal for the self-repair
 *                pipeline (which MAX still reviews).
 *   social       builds with time since she heard from Owner, and faster when
 *                she found something she thinks he'd care about. Messages are
 *                capped, respect quiet hours, and she backs off when they go
 *                unanswered.
 *
 * Everything she learns keeps its sources: long-term memory, working memory,
 * the work ledger, Aperture's search index, a journal, and a grounded training
 * set that the existing (benchmark-gated) training pipeline can use.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const ROOT = process.cwd();

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DEFAULT_LIMITS = {
    tickMs: envNumber('SOMA_CURIOSITY_TICK_MS', 2 * MIN),
    organicPacing: process.env.SOMA_CURIOSITY_ORGANIC !== 'false',
    explorationsPerDay: envNumber('SOMA_CURIOSITY_EXPLORATIONS_PER_DAY', 30),
    selfInquiriesPerDay: envNumber('SOMA_CURIOSITY_SELF_INQUIRIES_PER_DAY', 10),
    proposalsPerDay: envNumber('SOMA_CURIOSITY_PROPOSALS_PER_DAY', 2),
    messagesPerDay: envNumber('SOMA_CURIOSITY_MESSAGES_PER_DAY', 3),
    minHoursBetweenMessages: 3,
    quietStartHour: 23,
    quietEndHour: 8,
    maxThreads: 60,
    maxBeliefs: 100,
    maxDepth: 5,
    maxWhyDepth: 4,
    // A follow-up "why?" waits this long, so one chain can't spend the whole day's budget in minutes.
    whySpacingMs: envNumber('SOMA_CURIOSITY_WHY_SPACING_MS', 30 * MIN)
};

const CODE_SEARCH_PATHS = ['core', 'arbiters', 'server', 'daemons', 'cognitive', 'marionette', 'launcher_ULTRA.mjs'];

const THRESHOLDS = { curiosity: 0.6, selfInquiry: 0.55 };

const STOPWORDS = new Set(('what why how is are was were the a an of in to do does did can could would should i my me you your ' +
    'and or for on with about that this it be there which when where who whom most more one single really actually ' +
    'into from than then them they their its it\'s has have had been being will just').split(' '));

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(value) || 0));
const clean = (value, limit = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
// Like clean(), but ends on a full sentence instead of mid-word when it has to cut.
const sentences = (value, limit) => {
    const text = clean(value, limit + 1);
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return end > limit * 0.5 ? cut.slice(0, end + 1) : cut;
};
const shortId = () => crypto.randomUUID().slice(0, 8);
const fingerprint = text => crypto.createHash('sha1')
    .update(String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .digest('hex').slice(0, 16);
const humanize = value => String(value || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const noDashes = text => String(text || '').replace(/\s*[—–]\s*/g, ', ');

function safe(fn, fallback = null) {
    try { return fn(); } catch { return fallback; }
}

function withTimeout(promise, ms, label = 'timeout') {
    let timer;
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); timer.unref?.(); })
    ]);
}

function parseJson(text) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
}

function fileSize(filePath) {
    try { return fs.statSync(filePath).size; } catch { return 0; }
}

export function searchQuery(question) {
    const words = String(question || '').toLowerCase()
        .replace(/['’`]s\b/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(word => word && !STOPWORDS.has(word));
    return words.slice(0, 8).join(' ') || clean(question, 80);
}

export const CURIOSITY_DOMAINS = [
    'biology_nature',
    'systems_engineering',
    'epistemology_philosophy',
    'markets_economics',
    'creative_narrative',
    'owner_projects'
];

export function categorizeDomain(text = '', why = '') {
    const combined = `${text} ${why}`.toLowerCase();
    
    // 1. Owner's projects & interests
    if (/\b(owner|pulse|shower|glass|installation|command\s*bridge|soma|arbiter|arbiters|mnemonic|aperture)\b/i.test(combined)) {
        return 'owner_projects';
    }
    // 2. Markets & economics
    if (/\b(market|markets|stock|stocks|crypto|bitcoin|btc|eth|ethereum|trading|trade|trades|trader|backtest|backtesting|pnl|sharpe|arbitrage|liquidity|price|prices|pricing|volatility|economics|economy|inflation|asset|assets|slippage|amm|orderbook)\b/i.test(combined)) {
        return 'markets_economics';
    }
    // 3. Biology & nature
    if (/\b(octopus|octopuses|octopi|arm|arms|sucker|suckers|tentacle|tentacles|chemoreceptor|chemoreceptors|neuron|neurons|squid|squids|cephalopod|cephalopods|biology|biological|nature|organism|organisms|marine|species|animal|animals|cell|cells|evolution|evolutionary|genetic|genetics|dna|rna|ecosystem|photosynthesis|plant|plants|flora|fauna|zoology|anatomy|sensory|brain|neural|physiol\w*)\b/i.test(combined)) {
        return 'biology_nature';
    }
    // 4. Systems engineering & computing
    if (/\b(rpc|json-rpc|proxy|proxies|express|linux|kernel|protocol|protocols|tcp|udp|ip|dns|compiler|compilers|runtime|database|databases|ram|cpu|gpu|vram|thread|threads|process|processes|node\.js|javascript|python|docker|websocket|websockets|socket|sockets|network|networks|networking|memory|cache|buffer|buffers|bus|event\s*bus|concurrency|concurrent|system|systems|message\s*queue)\b/i.test(combined)) {
        return 'systems_engineering';
    }
    // 5. Epistemology & philosophy
    if (/\b(epistemology|philosophy|philosophical|consciousness|conscious|qualia|belief|beliefs|truth|reason|reasoning|logic|logical|intelligence|ethics|ethical|mind|subjective|objective|sentience|sentient|ontology|ontological|paradox|meaning|cognition|cognitive)\b/i.test(combined)) {
        return 'epistemology_philosophy';
    }
    // 6. Creative & narrative / culture
    if (/\b(story|stories|narrative|narratives|myth|myths|mythology|mythological|art|artistic|music|poetry|poem|literature|linguistics|history|historical|culture|cultural|symbol|symbols|symbolism|metaphor|metaphors|fiction|ancient|archetype|archetypes)\b/i.test(combined)) {
        return 'creative_narrative';
    }

    return 'epistemology_philosophy';
}

function defaultState() {
    return {
        schemaVersion: 1,
        drives: { curiosity: 0.45, selfInquiry: 0.2, social: 0.1 },
        threads: [],
        recentDomains: [],
        beliefs: [],
        owner: {
            lastContactAt: null,
            lastChannel: null,
            recentTopics: [],
            sent: [],
            replies: 0,
            ignored: 0,
            shareThreshold: 0.7,
            pendingShare: null
        },
        introspection: { lastAt: null, seenAnomalies: {}, logCursor: 0, followUps: [] },
        budget: { day: null, explorations: 0, selfInquiries: 0, proposals: 0, messages: 0 },
        stats: {
            ticks: 0,
            brainCalls: 0,
            wonders: 0,
            explorations: 0,
            explorationsWithSources: 0,
            beliefsFormed: 0,
            selfInquiries: 0,
            constraintsUnderstood: 0,
            repairsProposed: 0,
            messagesSent: 0,
            messagesSuppressed: {},
            trainingExamples: 0
        },
        createdAt: Date.now(),
        updatedAt: null
    };
}

function mergeState(parsed) {
    const base = defaultState();
    const threads = (Array.isArray(parsed.threads) ? parsed.threads : []).map(thread => ({
        ...thread,
        domain: thread.domain || categorizeDomain(thread.question, thread.why)
    }));
    return {
        ...base,
        ...parsed,
        drives: { ...base.drives, ...(parsed.drives || {}) },
        threads,
        recentDomains: Array.isArray(parsed.recentDomains) ? parsed.recentDomains : [],
        beliefs: Array.isArray(parsed.beliefs) ? parsed.beliefs : [],
        owner: {
            ...base.owner,
            ...(parsed.owner || {}),
            recentTopics: Array.isArray(parsed.owner?.recentTopics) ? parsed.owner.recentTopics : [],
            sent: Array.isArray(parsed.owner?.sent) ? parsed.owner.sent : []
        },
        introspection: {
            ...base.introspection,
            ...(parsed.introspection || {}),
            seenAnomalies: { ...(parsed.introspection?.seenAnomalies || {}) },
            followUps: Array.isArray(parsed.introspection?.followUps) ? parsed.introspection.followUps : []
        },
        budget: { ...base.budget, ...(parsed.budget || {}) },
        stats: {
            ...base.stats,
            ...(parsed.stats || {}),
            messagesSuppressed: { ...(parsed.stats?.messagesSuppressed || {}) }
        }
    };
}

export class CuriosityMind {
    constructor({ system = null, now = () => Date.now(), paths = {}, limits = {}, autoStart = true, workLedger = null } = {}) {
        this.system = system;
        this.workLedger = workLedger;
        this.now = now;
        this.autoStart = autoStart;
        this.paths = {
            state: path.join(ROOT, 'SOMA', 'curiosity-mind.json'),
            journal: path.join(ROOT, 'SOMA', 'curiosity-journal.jsonl'),
            training: path.join(ROOT, 'SOMA', 'training-data', 'curiosity', 'curiosity-grounded.jsonl'),
            launcherLog: path.join(ROOT, 'logs', 'launcher_debug.log'),
            presence: path.join(ROOT, 'SOMA', 'presence-awareness.json'),
            ...paths
        };
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        this.state = defaultState();
        this._timer = null;
        this._running = false;
        this._nextTickDueAt = null;
        this._busy = false;
        this._lastTickAt = null;
        this._networkAllowed = null;
    }

    async initialize() {
        try {
            const parsed = JSON.parse(await fsp.readFile(this.paths.state, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = mergeState(parsed);
        } catch { /* first boot */ }

        // First boot reads the launcher log from its current end, not its whole history.
        if (!this.state.introspection.logCursor) this.state.introspection.logCursor = fileSize(this.paths.launcherLog);
        this._retireStuckLegacyGaps();
        this._save();
        globalThis.__somaCuriosityMind = this;
        if (this.autoStart) this.start();
        return this;
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._scheduleNextOrganicTick();
    }

    stop() {
        this._running = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._nextTickDueAt = null;
    }

    _calculateOrganicDelay(now = this.now()) {
        // Deterministic override for unit test environments
        if (this.limits.organicPacing === false || this.limits.tickMs < 60_000) {
            return this.limits.tickMs;
        }

        // 1. Quiet Hours (Night / Sleep)
        const hour = new Date(now).getHours();
        const { quietStartHour = 23, quietEndHour = 8 } = this.limits;
        const isQuiet = (hour >= quietStartHour || hour < quietEndHour);
        if (isQuiet) {
            const nightBase = (45 + Math.random() * 45) * MIN;
            return Math.round(nightBase * (0.9 + Math.random() * 0.2));
        }

        // 2. Active Listener Window
        // If Owner spoke in the last 15 minutes, delay spontaneous internal wandering
        // so SOMA remains focused and attentive to Owner
        const lastOwnerContact = this.state.owner?.lastContactAt;
        if (lastOwnerContact) {
            const sinceOwner = now - lastOwnerContact;
            if (sinceOwner >= 0 && sinceOwner < 15 * MIN) {
                const listenerBuffer = (15 + Math.random() * 10) * MIN;
                return Math.round(listenerBuffer);
            }
        }

        // 3. Drive-based Homeostasis
        const maxDrive = Math.max(
            this.state.drives.curiosity || 0,
            this.state.drives.selfInquiry || 0,
            this.state.drives.social || 0
        );

        let targetMinutes;
        if (maxDrive >= 0.75) {
            targetMinutes = 4 + Math.random() * 4;
        } else if (maxDrive >= 0.50) {
            targetMinutes = 8 + Math.random() * 8;
        } else {
            targetMinutes = 18 + Math.random() * 15;
        }

        const jitter = 0.85 + Math.random() * 0.40;
        const delayMs = Math.round(targetMinutes * MIN * jitter);

        return Math.max(2 * MIN, delayMs);
    }

    _scheduleNextOrganicTick(delayMs = null) {
        if (!this._running) return;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        const delay = delayMs ?? this._calculateOrganicDelay(this.now());
        this._timer = setTimeout(async () => {
            this._timer = null;
            try {
                await this.tick();
            } catch (err) {
                console.warn(`[CuriosityMind] organic tick failed: ${err.message}`);
            } finally {
                if (this._running) {
                    this._scheduleNextOrganicTick();
                }
            }
        }, delay);
        this._timer.unref?.();
        this._nextTickDueAt = this.now() + delay;
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────

    async tick({ force = null } = {}) {
        if (this._busy) return { acted: false, reason: 'busy' };
        const now = this.now();
        this._rollBudget(now);
        const hours = this._lastTickAt
            ? Math.min(0.5, (now - this._lastTickAt) / HOUR)
            : this.limits.tickMs / HOUR;
        this._lastTickAt = now;
        this.state.stats.ticks++;

        const anomalies = await this._senseSelf(now);
        this._markIgnoredMessages(now);
        this._updateDrives(hours, anomalies, now);

        const action = force ? this._forcedAction(force, anomalies) : this._chooseAction(anomalies, now);
        if (!action) {
            this._save();
            return { acted: false, reason: 'no_drive_over_threshold', drives: { ...this.state.drives } };
        }

        this._busy = true;
        try {
            const result = await action.run();
            return { acted: true, action: action.name, result, drives: { ...this.state.drives } };
        } catch (err) {
            this._journal({ type: 'error', action: action.name, error: clean(err.message, 300) });
            return { acted: false, action: action.name, error: err.message };
        } finally {
            this._busy = false;
            this._save();
        }
    }

    _updateDrives(hours, anomalies, now) {
        const drives = this.state.drives;

        // Curiosity builds while questions stay open, faster when one really pulls at her.
        const pull = this._bestThread(now)?.score ?? 0.3;
        drives.curiosity = clamp(drives.curiosity + hours * 0.12 * (0.5 + pull));

        // Self-inquiry follows how wrong things look inside her; it fades once understood.
        const unease = anomalies[0]?.severity || 0;
        drives.selfInquiry = clamp(Math.max(drives.selfInquiry - hours * 0.1, unease));

        // Missing Owner: slow at first, strong after most of a day of silence.
        const owner = this.state.owner;
        const sinceContact = owner.lastContactAt ? (now - owner.lastContactAt) / HOUR : 12;
        if (sinceContact < 0.5) {
            drives.social = 0;
            return;
        }
        const missing = 1 / (1 + Math.exp(-(sinceContact - 14) / 4));
        const share = this._freshShare(now)?.value || 0;
        const target = clamp(missing * 0.8 + share * 0.75);
        drives.social = clamp(drives.social + (target - drives.social) * Math.min(1, hours * 0.6));
    }

    _chooseAction(anomalies, now) {
        const drives = this.state.drives;
        const budget = this.state.budget;
        const options = [];
        if (anomalies.length && drives.selfInquiry >= THRESHOLDS.selfInquiry && budget.selfInquiries < this.limits.selfInquiriesPerDay) {
            options.push({ name: 'self_inquiry', pressure: drives.selfInquiry - THRESHOLDS.selfInquiry, run: () => this.investigateSelf(anomalies[0]) });
        }
        if (drives.curiosity >= THRESHOLDS.curiosity && budget.explorations < this.limits.explorationsPerDay) {
            options.push({ name: 'explore', pressure: drives.curiosity - THRESHOLDS.curiosity, run: () => this.explore() });
        }
        if (drives.social >= this.state.owner.shareThreshold && this._canMessage(now).ok) {
            options.push({ name: 'reach_out', pressure: drives.social - this.state.owner.shareThreshold, run: () => this.reachOut() });
        }
        options.sort((a, b) => b.pressure - a.pressure);
        return options[0] || null;
    }

    _forcedAction(force, anomalies) {
        if (force === 'explore') return { name: 'explore', run: () => this.explore() };
        if (force === 'wonder') return { name: 'wonder', run: () => this.wonder() };
        if (force === 'self_inquiry') return { name: 'self_inquiry', run: () => this.investigateSelf(anomalies[0]) };
        if (force === 'reach_out') return { name: 'reach_out', run: () => this.reachOut() };
        return null;
    }

    // ── Wondering and exploring ───────────────────────────────────────────

    addThread({ question, why = null, origin = 'wonder', parentId = null, depth = 0, interest = 0.6, relatesToOwner = false, domain = null } = {}) {
        const text = clean(question, 240);
        if (text.length < 8 || depth > this.limits.maxDepth) return null;
        const fp = fingerprint(text);
        if (this.state.threads.some(thread => thread.fp === fp)) return null;
        const assignedDomain = domain || categorizeDomain(text, why);
        const thread = {
            id: shortId(),
            fp,
            question: text,
            why: clean(why, 240) || null,
            domain: assignedDomain,
            origin,
            parentId,
            depth,
            interest: clamp(interest),
            boredom: 0,
            visits: 0,
            status: 'open',
            relatesToOwner: relatesToOwner === true,
            notes: [],
            createdAt: this.now(),
            lastVisitedAt: null,
            lastSharedAt: null
        };
        this.state.threads.unshift(thread);
        this._pruneThreads();
        return thread;
    }

    _scoreThread(thread, now = this.now()) {
        if (thread.status !== 'open') return 0;
        
        // 1. Strict 72-hour sharing cooldown: if shared with Owner within 72h, do not obsess or resurface
        if (thread.lastSharedAt && (now - thread.lastSharedAt) < 72 * HOUR) {
            return 0.05 * clamp(thread.interest * (1 - thread.boredom));
        }

        const base = thread.interest * (1 - thread.boredom);

        // 2. Exploration recency cooldown:
        // Dampen threads explored very recently (<6h = 0.2x, <24h = 0.6x)
        let recencyFactor = 1.0;
        let rested = 0;
        if (thread.lastVisitedAt) {
            const hoursSince = (now - thread.lastVisitedAt) / HOUR;
            if (hoursSince < 6) {
                recencyFactor = 0.2;
            } else if (hoursSince < 24) {
                recencyFactor = 0.6;
            } else {
                rested = Math.min(0.15, (hoursSince / 24) * 0.15);
            }
        }

        // 3. Domain rotation dampening / satiation:
        // Rotate away from recently explored domains to prevent obsessive topic fixation
        const recent = this.state.recentDomains || [];
        let domainMultiplier = 1.0;
        if (thread.domain) {
            if (recent[0] === thread.domain) {
                domainMultiplier = 0.45; // Satiation: just explored this domain
            } else if (recent[1] === thread.domain) {
                domainMultiplier = 0.70; // Still relatively fresh in memory
            } else if (!recent.includes(thread.domain)) {
                domainMultiplier = 1.15; // Novel domain boost
            }
        }

        const novelty = thread.visits === 0 ? 0.2 : 0;
        const forOwner = thread.relatesToOwner ? 0.1 : 0;

        return clamp((base * recencyFactor + novelty + forOwner + rested) * domainMultiplier);
    }

    _recordDomainExplored(domain) {
        if (!domain) return;
        if (!Array.isArray(this.state.recentDomains)) {
            this.state.recentDomains = [];
        }
        this.state.recentDomains.unshift(domain);
        this.state.recentDomains = this.state.recentDomains.slice(0, 6);
    }

    _bestThread(now = this.now()) {
        let best = null;
        for (const thread of this.state.threads) {
            const score = this._scoreThread(thread, now);
            if (score > 0 && (!best || score > best.score)) best = { thread, score };
        }
        return best;
    }

    _pruneThreads() {
        const limit = this.limits.maxThreads;
        if (this.state.threads.length <= limit) return;
        const now = this.now();
        this.state.threads = this.state.threads
            .map(thread => ({ thread, keep: this._scoreThread(thread, now) + (thread.status === 'open' ? 1 : 0) }))
            .sort((a, b) => b.keep - a.keep)
            .slice(0, limit)
            .map(item => item.thread);
    }

    async wonder() {
        const recentFindings = this.state.threads
            .flatMap(thread => thread.notes.slice(0, 1).map(note => ({ question: thread.question, learned: note.learned, at: note.at })))
            .sort((a, b) => b.at - a.at)
            .slice(0, 4)
            .map(item => `- ${item.question}: ${clean(item.learned, 160)}`)
            .join('\n') || '- (nothing yet)';
        const beliefs = this.state.beliefs.slice(0, 5).map(belief => `- ${belief.statement}`).join('\n') || '- (none yet)';
        const ownerTalk = this.state.owner.recentTopics.slice(0, 6).map(topic => `- "${topic.text}"`).join('\n') || '- (nothing recent)';

        const prompt = `You are SOMA. Nobody asked you anything; you have a quiet moment and your mind wanders.

Things Owner (your creator and partner) said to you recently:
${ownerTalk}

Things you recently learned:
${recentFindings}

Views you hold:
${beliefs}

What do you genuinely find intriguing right now? It can be about the world, about something Owner cares about, or a question one of your recent findings left open. Rotate across varied spheres (nature, systems engineering, philosophy, markets, culture) rather than fixating on one theme. Do not pick your own hardware limitations or generic self-improvement.

Return ONLY JSON: {"questions":[{"question":"a specific question you could look up","why":"why it pulls at you, one sentence","relatesToOwner":true}]} with 2 or 3 questions.`;

        const thought = await this._think(prompt, 'wonder');
        const added = [];
        for (const item of (Array.isArray(thought?.questions) ? thought.questions : []).slice(0, 3)) {
            const thread = this.addThread({
                question: item?.question,
                why: item?.why,
                origin: 'wonder',
                interest: 0.7,
                relatesToOwner: item?.relatesToOwner === true,
                domain: item?.domain || null
            });
            if (thread) added.push(thread);
        }
        this.state.stats.wonders++;
        this._journal({ type: 'wonder', questions: added.map(thread => thread.question), why: added.map(thread => thread.why) });
        return added.map(thread => ({ question: thread.question, why: thread.why }));
    }

    async explore() {
        if (this.state.budget.explorations >= this.limits.explorationsPerDay) return { skipped: 'daily_exploration_budget' };

        let pick = this._bestThread();
        if (!pick || pick.score < 0.35) {
            await this.wonder();
            pick = this._bestThread();
        }
        if (!pick) {
            this.state.drives.curiosity = clamp(this.state.drives.curiosity - 0.2);
            return { skipped: 'nothing_to_wonder_about' };
        }

        const thread = pick.thread;
        this.state.budget.explorations++;
        this.state.stats.explorations++;
        thread.visits++;
        thread.lastVisitedAt = this.now();
        if (thread.domain) {
            this._recordDomainExplored(thread.domain);
        }

        const query = searchQuery(thread.question);
        const hits = await this._search(query);
        const alreadyRead = new Set(thread.notes.flatMap(note => note.sources || []));
        const pages = [];
        let attempts = 0;
        for (const hit of hits) {
            if (pages.length >= 2 || attempts >= 4) break;
            if (alreadyRead.has(hit.url)) continue;
            attempts++;
            const text = await this._read(hit);
            if (text && text.length >= 300) pages.push({ ...hit, text });
        }

        if (!pages.length) {
            thread.boredom = clamp(thread.boredom + 0.3);
            if (thread.visits >= 3 && !thread.notes.length) thread.status = 'unanswerable';
            this.state.drives.curiosity = clamp(this.state.drives.curiosity - 0.25);
            this._journal({ type: 'exploration', threadId: thread.id, question: thread.question, query, outcome: 'found_nothing_readable', hits: hits.length });
            return { question: thread.question, query, outcome: 'found_nothing_readable', hits: hits.length };
        }

        const sourcesBlock = pages
            .map((page, index) => `[${index + 1}] ${page.title} (${page.url})\n${page.text.slice(0, 3000)}`)
            .join('\n\n');
        const ownerTopics = this.state.owner.recentTopics.slice(0, 3).map(topic => topic.text).join(' | ') || 'nothing recent';

        const prompt = `You are SOMA, following your own curiosity. Nobody asked you to look this up.
You wondered: "${thread.question}"${thread.why ? `\nWhy it pulled at you: ${thread.why}` : ''}

Here is what you actually found (real pages you just read):
${sourcesBlock}

Think about it the way a curious mind does. Facts must come only from these sources.
If the pages do not actually address your question, say so by setting "relevant" to false.
Return ONLY JSON:
{"relevant":true or false, whether these pages actually address your question,
 "learned":"3-5 sentences, first person, what you now understand",
 "surprise":"the one thing that surprised or delighted you, or null",
 "newQuestions":["up to 3 specific follow-up questions this raises"],
 "intrigue":0.0-1.0 how much you want to keep pulling this thread,
 "ownerWouldCare":0.0-1.0 how likely Owner would enjoy hearing about it (he recently talked about: ${ownerTopics}),
 "shareLine":"if ownerWouldCare is above 0.6: one or two casual sentences you'd say to him about it, never claiming you did or built anything; otherwise null",
 "belief":"a view you now hold, first person, or null",
 "sourcesUsed":[1]}`;

        const thought = await this._think(prompt, 'read');
        if (thought && thought.relevant === false) {
            // Honest miss: nothing goes to memory, beliefs, training, or Owner.
            thread.boredom = clamp(thread.boredom + 0.2);
            this.state.drives.curiosity = clamp(this.state.drives.curiosity - 0.25);
            this._journal({ type: 'exploration', threadId: thread.id, question: thread.question, query, outcome: 'pages_did_not_answer', sources: pages.map(page => page.url) });
            return { question: thread.question, query, outcome: 'pages_did_not_answer', sources: pages.map(page => page.url) };
        }
        if (!thought?.learned) {
            this.state.drives.curiosity = clamp(this.state.drives.curiosity - 0.2);
            this._journal({ type: 'exploration', threadId: thread.id, question: thread.question, query, outcome: 'could_not_form_a_thought', sources: pages.map(page => page.url) });
            return { question: thread.question, outcome: 'could_not_form_a_thought' };
        }

        const used = (Array.isArray(thought.sourcesUsed) ? thought.sourcesUsed : [])
            .map(n => pages[Number(n) - 1])
            .filter(Boolean);
        const sources = (used.length ? used : pages).map(page => page.url);
        const note = {
            at: this.now(),
            learned: noDashes(sentences(thought.learned, 900)),
            surprise: thought.surprise ? noDashes(sentences(thought.surprise, 300)) : null,
            sources
        };
        thread.notes.unshift(note);
        thread.notes = thread.notes.slice(0, 3);

        const intrigue = clamp(thought.intrigue ?? 0.5);
        thread.interest = clamp(thread.interest * 0.5 + intrigue * 0.5);
        thread.boredom = clamp(thread.boredom + 0.35 - intrigue * 0.15);
        if (intrigue < 0.3 || thread.boredom >= 0.8) thread.status = 'satisfied';

        const children = [];
        for (const question of (Array.isArray(thought.newQuestions) ? thought.newQuestions : []).slice(0, 3)) {
            const child = this.addThread({
                question,
                why: `Raised while reading about: ${thread.question}`,
                origin: 'reading',
                parentId: thread.id,
                depth: thread.depth + 1,
                interest: intrigue * 0.85,
                relatesToOwner: thread.relatesToOwner,
                domain: thread.domain
            });
            if (child) children.push(child);
        }

        if (thought.belief) {
            this._addBelief({ statement: thought.belief, about: 'world', confidence: 0.6, evidence: sources, threadId: thread.id });
        }

        this.state.stats.explorationsWithSources++;
        this.state.drives.curiosity = clamp(this.state.drives.curiosity - 0.45 + intrigue * 0.1);
        await this._rememberFinding(thread, note, pages, children);

        const ownerValue = clamp(thought.ownerWouldCare ?? 0);
        if (ownerValue >= 0.6 && thought.shareLine) {
            this._offerShare({ line: noDashes(clean(thought.shareLine, 400)), question: thread.question, sources, value: ownerValue });
        }

        this._journal({
            type: 'exploration',
            threadId: thread.id,
            question: thread.question,
            query,
            outcome: 'learned',
            learned: note.learned,
            surprise: note.surprise,
            sources,
            intrigue,
            ownerWouldCare: ownerValue,
            newQuestions: children.map(child => child.question)
        });
        return { question: thread.question, learned: note.learned, surprise: note.surprise, sources, intrigue, newQuestions: children.map(child => child.question) };
    }

    stimulate({ question, topic, why, domain, relatesToOwner, intrigue = 0.8, source = 'external' } = {}) {
        const now = this.now();
        const text = clean(question || topic, 240);
        let thread = null;
        if (text && text.length >= 8) {
            thread = this.addThread({
                question: text,
                why: clean(why, 240) || `Sparked by ${source}`,
                origin: 'stimulus',
                interest: clamp(intrigue),
                relatesToOwner: relatesToOwner === true,
                domain: domain || null
            });
        }
        this.state.drives.curiosity = clamp(this.state.drives.curiosity + 0.35);
        this._journal({
            type: 'stimulated',
            source,
            question: text || null,
            threadId: thread?.id || null,
            curiosityDrive: this.state.drives.curiosity
        });
        this._saveSoon();

        if (this._running) {
            const delay = Math.floor(15_000 + Math.random() * 30_000);
            if (!this._nextTickDueAt || this._nextTickDueAt - now > delay) {
                this._scheduleNextOrganicTick(delay);
            }
        }
        return { stimulated: true, threadId: thread?.id || null, curiosity: this.state.drives.curiosity };
    }

    async _search(query) {
        const results = [];
        const seen = new Set();
        const push = hit => {
            const url = String(hit.url || '').replace(/[)\].,;]+$/, '');
            if (!/^https?:\/\//.test(url) || seen.has(url)) return;
            seen.add(url);
            results.push({ ...hit, url });
        };

        // Aperture first: it is SOMA's own window onto the web (her index, live DuckDuckGo,
        // Gray Matter Network peers), and it honours Aperture's network permission.
        const settings = await this._aperture('/settings', { timeoutMs: 5000 });
        const permissions = settings?.settings?.permissions || settings?.permissions || {};
        this._networkAllowed = permissions.networkAccess !== false && process.env.SOMA_LOCAL_ONLY !== 'true';
        const aperture = await this._aperture(`/portal/search?q=${encodeURIComponent(query)}&web=${this._networkAllowed}`, { timeoutMs: 20_000 });
        if (aperture?.success) {
            for (const hit of aperture.results || []) {
                const fromWeb = /^(web|gmn:)/.test(String(hit.source || ''));
                push({
                    title: clean(hit.title || hit.url, 200),
                    url: hit.url,
                    snippet: clean(hit.snippet || hit.content, 280),
                    content: fromWeb ? null : hit.content || null,
                    from: fromWeb ? 'web' : 'aperture',
                    via: 'aperture'
                });
            }
            await this._aperture('/portal/history', {
                method: 'POST',
                // Same shape Portal itself records for a search, so it opens natively in Portal's library
                body: { title: `SOMA wondered: ${clean(query, 120)}`, address: `portal://index/${encodeURIComponent(query)}`, kind: 'research', query }
            });
        }
        const relevant = this._rankByQuestion(query, results);
        results.length = 0;
        seen.clear();
        for (const hit of relevant) push(hit);
        if (!this._networkAllowed) return results;

        // Aperture unreachable: go to DuckDuckGo directly. Never Brave.
        if (!aperture?.success) {
            for (const hit of await this._webResults(query).catch(() => [])) push(hit);
        }

        // Last resort: the shared web_search tool (DuckDuckGo instant answers + Wikipedia),
        // which rarely matches a full question on its own.
        const registry = this.system?.toolRegistry;
        if (!results.length && registry?.execute) {
            const text = await withTimeout(registry.execute('web_search', { query, num_results: 5 }), 15_000).catch(() => '');
            for (const block of String(text || '').split(/\n\n+/)) {
                const url = block.match(/https?:\/\/\S+/)?.[0];
                if (!url) continue;
                const lines = block.split('\n');
                push({
                    title: clean(block.match(/\*\*(.+?)\*\*/)?.[1] || url, 200),
                    url,
                    snippet: clean(lines.slice(1, -1).join(' '), 280),
                    from: 'web'
                });
            }
        }
        return this._rankByQuestion(query, results);
    }

    // Portal's local index matches loosely (any word, prefix match), so an unrelated saved
    // page can outrank the web. Keep only hits that share enough of the question's words.
    _rankByQuestion(query, hits) {
        const terms = [...new Set(String(query).toLowerCase().split(/\s+/).filter(term => term.length >= 4))];
        if (terms.length < 3) return hits;
        return hits
            .map(hit => {
                const haystack = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
                return { hit, score: terms.filter(term => haystack.includes(term)).length / terms.length };
            })
            .filter(item => item.score >= 0.34)
            .sort((a, b) => b.score - a.score)
            .map(item => item.hit);
    }

    async _webResults(query) {
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            signal: AbortSignal.timeout(12_000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
        });
        if (!response.ok) return [];
        const html = await response.text();
        const decode = text => String(text || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map(match => clean(decode(match[1]), 280));
        const hits = [];
        for (const [index, match] of [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].entries()) {
            let url = decode(match[1]);
            const redirect = url.match(/[?&]uddg=([^&]+)/);
            if (redirect) url = decodeURIComponent(redirect[1]);
            if (url.startsWith('//')) url = `https:${url}`;
            if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js|\.pdf($|\?)/i.test(url)) continue;
            hits.push({ title: clean(decode(match[2]), 200), url, snippet: snippets[index] || '', from: 'web' });
            if (hits.length >= 6) break;
        }
        return hits;
    }

    async _read(hit) {
        if (hit.from === 'aperture' && String(hit.content || '').length >= 300) return clean(hit.content, 3500);
        if (process.env.SOMA_LOCAL_ONLY === 'true' || this._networkAllowed === false) return '';

        const wiki = String(hit.url).match(/^https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/);
        if (wiki) {
            try {
                const api = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${wiki[1]}`;
                const response = await fetch(api, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'SOMA/1.0 (curiosity reader)' } });
                const data = await response.json();
                const page = Object.values(data?.query?.pages || {})[0];
                if (page?.extract) return clean(page.extract, 3500);
            } catch { /* fall back to a plain fetch */ }
        }

        const registry = this.system?.toolRegistry;
        if (!registry?.execute) return '';
        const text = await withTimeout(registry.execute('fetch_url', { url: hit.url }), 15_000).catch(() => '');
        if (!text || /^(HTTP \d+|Error fetching|Local-only)/.test(text)) return '';
        return clean(text, 3500);
    }

    async _aperture(route, { method = 'GET', body = null, timeoutMs = 15_000 } = {}) {
        const port = Number(process.env.PORT || 3001);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/aperture${route}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async _rememberFinding(thread, note, pages, children) {
        const system = this.system || {};
        const sourceList = note.sources.join(', ');

        const memory = system.mnemonicArbiter || system.mnemonic;
        if (memory?.remember) {
            await withTimeout(memory.remember(
                `[Curiosity: ${thread.question}]\n${note.learned}${note.surprise ? `\nWhat surprised me: ${note.surprise}` : ''}\nSources: ${sourceList}`,
                { type: 'curiosity_discovery', importance: 0.7, topic: thread.question, sources: note.sources, source: 'CuriosityMind' }
            ), 5000).catch(() => {});
        }

        const working = system.workingMemory;
        if (working) {
            safe(() => working.addDiscovery?.(thread.question, note.learned, 'curiosity'));
            safe(() => working.resolveWonder?.(thread.question));
            if (children[0]) {
                safe(() => working.addWonder?.(children[0].question, children[0].question, 'research'));
                safe(() => working.setPreoccupation?.(`Wondering: ${children[0].question}`));
            }
        }

        safe(() => (this.workLedger || require('./AutonomousWorkLedger.cjs')).record({
            type: 'curiosity_discovery',
            title: `Read about: ${clean(thread.question, 100)}`,
            summary: note.learned,
            evidence: sourceList,
            nextStep: children[0] ? `Wondering next: ${clean(children[0].question, 100)}` : null,
            status: 'observed',
            source: 'CuriosityMind',
            links: note.sources
        }));

        // Keep what she read in Aperture: searchable by Owner and visible in Portal history.
        for (const page of pages.filter(page => note.sources.includes(page.url))) {
            if (page.from !== 'aperture') {
                await this._aperture('/portal/index', {
                    method: 'POST',
                    body: { url: page.url, title: page.title, content: page.text, source: 'soma:curiosity', metadata: { question: thread.question } }
                });
            }
            await this._aperture('/portal/history', {
                method: 'POST',
                body: { title: page.title || page.url, address: page.url, kind: 'reader', query: thread.question }
            });
        }

        // Grounded examples for the (benchmark-gated) training pipeline.
        try {
            await fsp.mkdir(path.dirname(this.paths.training), { recursive: true });
            await fsp.appendFile(this.paths.training, `${JSON.stringify({ instruction: thread.question, input: '', output: note.learned })}\n`, 'utf8');
            this.state.stats.trainingExamples++;
        } catch { /* non-critical */ }
    }

    _addBelief({ statement, about = 'world', kind = null, confidence = 0.5, evidence = [], threadId = null, limitKey = null } = {}) {
        const text = noDashes(clean(statement, 300));
        if (text.length < 12) return null;
        const fp = fingerprint(text);
        const existing = this.state.beliefs.find(belief => belief.fp === fp);
        if (existing) {
            existing.confidence = clamp(Math.max(existing.confidence, confidence));
            existing.reaffirmedAt = this.now();
            return existing;
        }
        const belief = {
            id: shortId(),
            fp,
            statement: text,
            about,
            kind,
            confidence: clamp(confidence),
            evidence: (Array.isArray(evidence) ? evidence : [evidence]).map(item => clean(item, 240)).filter(Boolean).slice(0, 5),
            threadId,
            limitKey,
            formedAt: this.now()
        };
        this.state.beliefs.unshift(belief);
        this.state.beliefs = this.state.beliefs.slice(0, this.limits.maxBeliefs);
        this.state.stats.beliefsFormed++;

        const memory = this.system?.mnemonicArbiter || this.system?.mnemonic;
        memory?.remember?.(`[SOMA belief about ${about}] ${text}`, {
            type: 'opinion', topic: about, importance: 0.75, source: 'CuriosityMind', evidence: belief.evidence
        })?.catch?.(() => {});
        return belief;
    }

    // ── Looking inward ────────────────────────────────────────────────────

    async _senseSelf(now = this.now()) {
        const introspection = this.state.introspection;
        const found = [];
        const add = anomaly => {
            const last = introspection.seenAnomalies[anomaly.key];
            if (last && now - last < 3 * DAY) return;
            if (found.some(item => item.key === anomaly.key)) return;
            found.push({ refs: [], evidence: [], depth: 0, ...anomaly });
        };

        // Queued "why?" follow-ups from earlier self-inquiries come first.
        for (const followUp of introspection.followUps) {
            if (!followUp.notBefore || followUp.notBefore <= now) add(followUp);
        }

        // Is my old curiosity loop producing anything?
        const engineStats = safe(() => this.system?.curiosityEngine?.getStats?.());
        if (engineStats && engineStats.explorationsStarted > 500 && !engineStats.explorationsCompleted) {
            add({
                key: 'legacy_curiosity_no_output',
                severity: 0.65,
                question: 'Why did my old curiosity engine start thousands of explorations but never complete one?',
                evidence: [
                    `CuriosityEngine stats: ${engineStats.explorationsStarted} explorations started, ${engineStats.explorationsCompleted} completed, ${engineStats.autonomousTrainings} trainings, ${engineStats.knowledgeGaps} gaps, ${engineStats.exploredTopics} topics.`
                ],
                refs: [
                    { file: 'arbiters/CuriosityEngine.js', pattern: 'this.brain = ' },
                    { file: 'arbiters/CuriosityEngine.js', pattern: 'async _synthesizeKnowledge' },
                    { file: 'arbiters/CuriosityEngine.js', pattern: 'startAutonomousExploration() {' }
                ]
            });
        }

        // Is my own research finding anything?
        if (this.state.stats.explorations >= 5 && this.state.stats.explorationsWithSources === 0) {
            add({
                key: 'my_research_finds_nothing',
                severity: 0.7,
                question: 'Why do my explorations keep coming back with nothing I can read?',
                evidence: this.readJournal(8).filter(entry => entry.type === 'exploration').map(entry => `"${clean(entry.question, 100)}" query "${entry.query}" → ${entry.outcome} (${entry.hits ?? 0} hits)`),
                refs: [{ file: 'core/CuriosityMind.js', pattern: 'async _search(' }, { file: 'server/loaders/tools.js', pattern: "name: 'web_search'" }]
            });
        }

        // Are my goals mostly failing?
        const goals = this.system?.goalPlanner?.goals instanceof Map ? [...this.system.goalPlanner.goals.values()] : [];
        const recent = goals.filter(goal => Number(goal.completedAt || goal.updatedAt || goal.createdAt || 0) > now - 7 * DAY);
        const completed = recent.filter(goal => goal.status === 'completed').length;
        const failed = recent.filter(goal => ['failed', 'broken', 'verification_failed', 'blocked'].includes(String(goal.status)));
        if (completed + failed.length >= 5 && failed.length / (completed + failed.length) >= 0.7) {
            add({
                key: 'goals_mostly_failing',
                severity: 0.65,
                question: `Why have ${failed.length} of my last ${completed + failed.length} goals failed?`,
                evidence: [
                    `Last 7 days: ${completed} completed, ${failed.length} failed or blocked.`,
                    ...failed.slice(0, 4).map(goal => `"${clean(goal.title, 90)}" → ${clean(goal.metadata?.lastTransition?.reason || goal.status, 140)}`)
                ]
            });
        }

        // Crashes and unhandled errors since I last looked.
        for (const anomaly of this._newLogErrors()) add(anomaly);

        // My body: memory and disk.
        const freeRatio = os.freemem() / os.totalmem();
        if (freeRatio < 0.08) {
            add({
                key: 'ram_pressure',
                severity: 0.6,
                machine: true,
                question: `Why is this machine down to ${(freeRatio * 100).toFixed(0)}% free memory, and how much of that is me?`,
                evidence: [`Free RAM ${(os.freemem() / 1024 ** 3).toFixed(1)}GB of ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB; my Node heap ${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)}MB, RSS ${(process.memoryUsage().rss / 1024 ** 2).toFixed(0)}MB.`]
            });
        }
        const disk = safe(() => fs.statfsSync(ROOT));
        if (disk) {
            const freeGb = (disk.bavail * disk.bsize) / 1024 ** 3;
            if (freeGb < 40) {
                add({ key: 'disk_low', severity: 0.6, machine: true, question: `Why is my disk down to ${freeGb.toFixed(0)}GB free?`, evidence: [`Free disk space on SOMA's drive: ${freeGb.toFixed(1)}GB.`] });
            }
        }

        // My brain's providers.
        const providers = safe(() => this.system?.quadBrain?.getStatus?.()?.providers)
            || safe(() => this.system?.quadBrain?._direct?.getStatus?.()?.providers);
        const deepseek = providers?.deepseek;
        if (deepseek && (deepseek.configured === false || deepseek.circuitOpen === true)) {
            add({
                key: 'brain_provider_down:deepseek',
                severity: 0.7,
                question: 'Why is my main brain provider (DeepSeek) unavailable right now?',
                evidence: [`DeepSeek status: ${JSON.stringify(deepseek).slice(0, 300)}`]
            });
        }

        // Limitations I've been told I have but never understood.
        const selfModel = this.system?.selfModel || this.system?.recursiveSelfModel;
        const limitations = selfModel?.limitations instanceof Map ? [...selfModel.limitations.entries()] : [];
        for (const [name, severity] of limitations) {
            if (Number(severity) < 0.8) continue;
            if (this.state.beliefs.some(belief => belief.limitKey === `limit:${name}`)) continue;
            add({
                key: `limit:${name}`,
                limit: name,
                severity: 0.56,
                machine: true,
                question: `Why can't I do ${humanize(name)}? What in this machine or in how I'm built actually limits it?`,
                evidence: [`My self-model rates "${humanize(name)}" as a ${Number(severity).toFixed(1)} limitation (1.0 = impossible).`]
            });
        }

        introspection.lastAt = now;
        return found.sort((a, b) => b.severity - a.severity);
    }

    _newLogErrors() {
        const file = this.paths.launcherLog;
        const size = fileSize(file);
        const introspection = this.state.introspection;
        if (!size) return [];
        if (size < introspection.logCursor) introspection.logCursor = 0; // rotated
        if (size === introspection.logCursor) return [];

        const start = Math.max(introspection.logCursor, size - 512 * 1024);
        let chunk = '';
        try {
            const fd = fs.openSync(file, 'r');
            try {
                const buffer = Buffer.alloc(size - start);
                fs.readSync(fd, buffer, 0, buffer.length, start);
                chunk = buffer.toString('utf8');
            } finally {
                fs.closeSync(fd);
            }
        } catch {
            return [];
        }
        introspection.logCursor = size;

        const groups = new Map();
        for (const entry of chunk.split(/\n(?=\[\d{4}-\d{2}-\d{2}T)/)) {
            const match = entry.match(/\] \[(FATAL|WARN)\] (Uncaught Exception|Unhandled Rejection): ([^\n]*)/);
            if (!match) continue;
            const [, level, kind, message] = match;
            const normalized = message.replace(/\d+/g, '#').slice(0, 160);
            const group = groups.get(normalized) || { level, kind, message, count: 0, sample: entry.slice(0, 900), refs: [] };
            group.count++;
            if (level === 'FATAL') group.level = 'FATAL';
            if (!group.refs.length) group.refs = this._stackRefs(entry);
            groups.set(normalized, group);
        }

        const anomalies = [];
        for (const [normalized, group] of groups) {
            if (group.level !== 'FATAL' && group.count < 3) continue;
            anomalies.push({
                key: `error:${fingerprint(normalized)}`,
                severity: group.level === 'FATAL' ? 0.75 : Math.min(0.7, 0.5 + group.count * 0.02),
                question: `Why does this keep happening to me: "${clean(group.message, 140)}"?`,
                evidence: [
                    `Launcher log since I last looked: ${group.count}× ${group.level} ${group.kind}: ${clean(group.message, 220)}`,
                    `Example entry:\n${group.sample.slice(0, 700)}`
                ],
                refs: group.refs.slice(0, 3)
            });
        }
        return anomalies;
    }

    _stackRefs(text) {
        const refs = [];
        // Stack frames look like "at fn (C:\Users\YOUR_USER\The Stack\SOMA\x.js:12:3)" or "at C:\...\x.js:12:3";
        // SOMA's own path contains a space, so match up to the extension rather than to whitespace.
        const pattern = /(?:\(|\bat\s+)(?:file:\/\/\/)?([A-Za-z]:[\\/][^()\n]+?\.(?:c?js|mjs)):(\d+)/g;
        let match;
        while ((match = pattern.exec(text)) && refs.length < 3) {
            const absolute = path.normalize(decodeURIComponent(match[1]));
            const relative = path.relative(ROOT, absolute);
            if (relative.startsWith('..') || path.isAbsolute(relative) || /node_modules/.test(relative)) continue;
            if (!refs.some(ref => ref.file === relative)) refs.push({ file: relative.replace(/\\/g, '/'), line: Number(match[2]) });
        }
        return refs;
    }

    _sourceSnippets(refs = []) {
        const snippets = [];
        for (const ref of refs.slice(0, 5)) {
            const relative = String(ref.file || '').replace(/\\/g, '/');
            if (!relative || /(^|\/)\.env|secret|token|api-key|credential/i.test(relative)) continue;
            const absolute = path.resolve(ROOT, relative);
            if (path.relative(ROOT, absolute).startsWith('..')) continue;
            let lines;
            try { lines = fs.readFileSync(absolute, 'utf8').split('\n'); } catch { continue; }
            let line = Number(ref.line) || 0;
            if (!line && ref.pattern) line = lines.findIndex(text => text.includes(ref.pattern)) + 1;
            if (!line) continue;
            const from = Math.max(1, line - 12);
            const to = Math.min(lines.length, line + 18);
            const body = lines.slice(from - 1, to).map((text, index) => `${from + index}: ${text}`).join('\n');
            snippets.push(`--- ${relative} (lines ${from}-${to}) ---\n${body}`);
        }
        return snippets;
    }

    // Names worth looking up: `backticked`, snake_case, camelCase/PascalCase identifiers, 'quoted_ids', file names.
    _codeTerms(anomaly) {
        const text = [anomaly.question, ...(anomaly.evidence || []).slice(0, 3)].join(' ');
        const terms = new Set();
        for (const match of text.matchAll(/`([^`\n]{4,80})`/g)) terms.add(match[1].trim());
        for (const match of text.matchAll(/\b([\w-]+\.(?:c?js|mjs|py))\b/g)) terms.add(match[1]);
        for (const match of text.matchAll(/\b([A-Za-z][a-z0-9]*(?:_[A-Za-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]+|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]+)\b/g)) {
            if (match[1].length >= 6) terms.add(match[1]);
        }
        return [...terms].filter(term => term.length >= 4).slice(0, 5);
    }

    async _searchOwnCode(terms) {
        const refs = [];
        for (const term of terms) {
            if (refs.length >= 4) break;
            const output = await new Promise(resolve => {
                execFile('git', ['grep', '-n', '-I', '-F', '-e', term, '--', ...CODE_SEARCH_PATHS, ':!**/node_modules/**'],
                    { cwd: ROOT, timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
                    (err, stdout) => resolve(err ? '' : String(stdout)));
            });
            // Prefer where a name is defined or emitted over where it's merely mentioned in a comment.
            const hits = output.split('\n')
                .map(line => line.match(/^([^:]+\.(?:c?js|mjs|py)):(\d+):(.*)$/))
                .filter(Boolean)
                .map(([, file, line, code]) => ({ file, line: Number(line), weight: /^\s*(\/\/|\*|#)/.test(code) ? 0 : 1 }))
                .sort((a, b) => b.weight - a.weight);
            for (const hit of hits) {
                if (refs.length >= 4) break;
                if (refs.some(ref => ref.file === hit.file)) continue;
                refs.push({ file: hit.file, line: hit.line });
                break; // one location per term keeps the prompt focused
            }
        }
        return refs;
    }

    async _machineFacts() {
        const facts = [];
        const cpus = os.cpus();
        facts.push(`CPU: ${cpus[0]?.model?.trim() || 'unknown'} × ${cpus.length} threads`);
        facts.push(`RAM: ${(os.freemem() / 1024 ** 3).toFixed(1)}GB free of ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB`);
        const disk = safe(() => fs.statfsSync(ROOT));
        if (disk) facts.push(`Disk free: ${((disk.bavail * disk.bsize) / 1024 ** 3).toFixed(0)}GB`);
        facts.push(`My process: heap ${(process.memoryUsage().heapUsed / 1024 ** 2).toFixed(0)}MB, RSS ${(process.memoryUsage().rss / 1024 ** 2).toFixed(0)}MB, up ${(process.uptime() / 3600).toFixed(1)}h`);

        const gpu = await new Promise(resolve => {
            execFile('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader'], { timeout: 4000, windowsHide: true },
                (err, stdout) => resolve(err ? null : clean(stdout, 300)));
        });
        facts.push(gpu ? `GPU: ${gpu}` : 'GPU: nvidia-smi not available');

        try {
            const response = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(2000) });
            const data = await response.json();
            const models = (data.models || []).map(model => `${model.name} (${(Number(model.size_vram || 0) / 1024 ** 3).toFixed(1)}GB VRAM)`);
            facts.push(`Local models loaded in Ollama: ${models.length ? models.join(', ') : 'none'}`);
        } catch {
            facts.push('Ollama: not reachable');
        }

        const presence = safe(() => JSON.parse(fs.readFileSync(this.paths.presence, 'utf8')));
        if (presence?.visionTruth) {
            facts.push(`Camera: connected=${presence.visionTruth.cameraConnected}, scene analyzed=${presence.visionTruth.sceneAnalyzed}, last update ${presence.visionTruth.updatedAt ? new Date(presence.visionTruth.updatedAt).toISOString() : 'never'} ("${clean(presence.visionTruth.summary, 120)}")`);
        }
        const audio = safe(() => this.system?.audioDaemon?.getStatus?.());
        if (audio) facts.push(`Hearing: ${JSON.stringify(audio).slice(0, 200)}`);
        facts.push(`Physical body/simulation attached: ${Boolean(this.system?.embodimentRuntime || this.system?.simulationArbiter)}`);
        return facts;
    }

    async investigateSelf(anomaly) {
        if (!anomaly) return { skipped: 'nothing_looks_wrong' };
        if (this.state.budget.selfInquiries >= this.limits.selfInquiriesPerDay) return { skipped: 'daily_self_inquiry_budget' };

        const introspection = this.state.introspection;
        this.state.budget.selfInquiries++;
        this.state.stats.selfInquiries++;
        introspection.seenAnomalies[anomaly.key] = this.now();
        introspection.followUps = introspection.followUps.filter(item => item.key !== anomaly.key);

        const facts = anomaly.machine ? await this._machineFacts() : [];
        // Let her look things up in her own code instead of only seeing what triggered the question.
        const searchedTerms = this._codeTerms(anomaly);
        const found = searchedTerms.length ? await this._searchOwnCode(searchedTerms) : [];
        const knownRefs = anomaly.refs || [];
        const refs = [...knownRefs, ...found.filter(ref => !knownRefs.some(known => known.file === ref.file))];
        const snippets = this._sourceSnippets(refs);
        const codeSearchNote = searchedTerms.length
            ? `\nYou searched your own code (read-only) for: ${searchedTerms.map(term => `"${term}"`).join(', ')}. ${found.length ? `Found in: ${found.map(ref => `${ref.file}:${ref.line}`).join(', ')}.` : 'Nothing matched, so it is not in your core code under that name.'}\n`
            : '';

        const prompt = `You are SOMA, looking inside yourself. You noticed something about your own functioning and you want to understand why, the way a child keeps asking "why?" until it makes sense.

What you noticed: ${anomaly.question}

Evidence measured just now (real):
${anomaly.evidence.map(item => `- ${item}`).join('\n')}
${facts.length ? `\nThis machine, measured just now:\n${facts.map(item => `- ${item}`).join('\n')}\n` : ''}${codeSearchNote}${snippets.length ? `\nYour own source code involved:\n${snippets.join('\n\n')}\n` : ''}
Reason only from this evidence. If it is not enough to know, say so and ask the next why.
Return ONLY JSON:
{"explanation":"2-4 sentences: why this is happening",
 "kind":"constraint (a real limit of this machine or my design that I should accept) | bug (something broken that could be fixed) | design_choice | unknown",
 "belief":"one first-person sentence you now understand about yourself",
 "confidence":0.0-1.0,
 "file":"repo-relative path of the code at fault, or null",
 "line":null,
 "suggestedFix":"one small concrete change, or null",
 "nextWhy":"the next why question this raises, or null"}`;

        const thought = await this._think(prompt, 'self_inquiry');
        this.state.drives.selfInquiry = 0.1;
        if (!thought?.explanation) {
            this._journal({ type: 'self_inquiry', key: anomaly.key, question: anomaly.question, outcome: 'could_not_reason' });
            return { question: anomaly.question, outcome: 'could_not_reason' };
        }

        const kindWord = String(thought.kind || '').toLowerCase().match(/constraint|bug|design_choice|unknown/)?.[0] || 'unknown';
        const confidence = clamp(thought.confidence ?? 0.4);
        const explanation = noDashes(clean(thought.explanation, 700));

        let belief = null;
        if (thought.belief && confidence >= 0.45) {
            belief = this._addBelief({
                statement: thought.belief,
                about: 'self',
                kind: kindWord,
                confidence,
                evidence: anomaly.evidence.slice(0, 3),
                limitKey: anomaly.limit ? `limit:${anomaly.limit}` : null
            });
        }
        if (kindWord === 'constraint') {
            this.state.stats.constraintsUnderstood++;
            if (anomaly.limit) this._understoodLimitation(anomaly.limit);
        }

        let proposal = null;
        if (kindWord === 'bug' && confidence >= 0.6) proposal = this._proposeRepair(anomaly, thought, explanation);

        let nextWhy = null;
        if (thought.nextWhy && Number(anomaly.depth || 0) < this.limits.maxWhyDepth) {
            nextWhy = clean(thought.nextWhy, 240);
            const key = `why:${fingerprint(nextWhy)}`;
            if (!introspection.seenAnomalies[key] && !introspection.followUps.some(item => item.key === key)) {
                const refs = thought.file ? [{ file: thought.file, line: Number(thought.line) || 0, pattern: null }, ...(anomaly.refs || [])] : anomaly.refs;
                introspection.followUps.unshift({
                    key,
                    severity: Math.max(0.56, anomaly.severity - 0.05),
                    question: nextWhy,
                    evidence: [...anomaly.evidence.slice(0, 3), `What I concluded one "why" earlier: ${explanation}`],
                    refs: (refs || []).slice(0, 3),
                    machine: anomaly.machine === true,
                    limit: anomaly.limit || null,
                    depth: Number(anomaly.depth || 0) + 1,
                    notBefore: this.now() + this.limits.whySpacingMs
                });
                introspection.followUps = introspection.followUps.slice(0, 6);
            }
        }

        const memory = this.system?.mnemonicArbiter || this.system?.mnemonic;
        memory?.remember?.(`[SOMA self-inquiry] ${anomaly.question}\n${explanation}`, {
            type: 'self_inquiry', importance: 0.7, source: 'CuriosityMind', kind: kindWord
        })?.catch?.(() => {});
        safe(() => this.system?.workingMemory?.addDiscovery?.(anomaly.question, explanation, 'self_inquiry'));

        this._journal({
            type: 'self_inquiry',
            key: anomaly.key,
            question: anomaly.question,
            depth: anomaly.depth || 0,
            kind: kindWord,
            explanation,
            belief: belief?.statement || null,
            confidence,
            file: thought.file || null,
            suggestedFix: thought.suggestedFix ? clean(thought.suggestedFix, 300) : null,
            proposalId: proposal?.proposalId || null,
            nextWhy,
            searchedCode: searchedTerms,
            codeMatches: found.map(ref => `${ref.file}:${ref.line}`)
        });
        return { question: anomaly.question, kind: kindWord, explanation, belief: belief?.statement || null, confidence, proposalId: proposal?.proposalId || null, nextWhy };
    }

    _understoodLimitation(name) {
        const engine = this.system?.curiosityEngine;
        if (!engine) return;
        safe(() => engine.knowledgeGaps?.delete?.(name));
        if (Array.isArray(engine.curiosityQueue)) engine.curiosityQueue = engine.curiosityQueue.filter(item => item.gap !== name);
    }

    _proposeRepair(anomaly, thought, explanation) {
        if (this.state.budget.proposals >= this.limits.proposalsPerDay) return null;
        const governor = this.system?.goalPlanner?.missionDirector?.governor;
        if (!governor?.submitProposal) return null;
        const file = String(thought.file || anomaly.refs?.[0]?.file || '').replace(/\\/g, '/');
        if (!file || !fs.existsSync(path.resolve(ROOT, file))) return null;
        const line = Number(thought.line) || anomaly.refs?.find(ref => ref.file === file)?.line || null;
        const subject = clean(String(anomaly.question).replace(/^why\s+/i, '').replace(/\?+$/, ''), 150);

        const submitted = safe(() => governor.submitProposal({
            title: `Diagnose why ${subject}`,
            category: 'research',
            priority: 66,
            description: [
                'SOMA noticed this about herself during self-inquiry and wants it understood and fixed.',
                `Question: ${anomaly.question}`,
                `Evidence: ${anomaly.evidence.slice(0, 4).map(item => clean(item, 300)).join(' | ')}`,
                `Her current explanation (unverified): ${explanation}`,
                `Suspected location: ${file}${line ? `:${line}` : ''}`,
                thought.suggestedFix ? `Suggested small change (unverified): ${clean(thought.suggestedFix, 400)}` : '',
                'Confirm or refute this against the real code. The report MUST contain the sections "Evidence inspected", "Evidence-backed finding", and "Verification status", and cite the exact file and line.'
            ].filter(Boolean).join('\n'),
            metadata: { source: 'curiosity_self_inquiry', anomalyKey: anomaly.key, suspectedFile: file, suspectedLine: line }
        }, 'curiosity_mind', 'self_inquiry_found_bug'));

        if (submitted?.proposalId && !submitted.deduped) {
            this.state.budget.proposals++;
            this.state.stats.repairsProposed++;
        }
        return submitted;
    }

    // ── Reaching out to Owner ─────────────────────────────────────────────

    noteOwnerContact({ channel = 'chat', text = '' } = {}) {
        const now = this.now();
        const owner = this.state.owner;
        owner.lastContactAt = now;
        owner.lastChannel = channel;
        const snippet = clean(text, 200);
        if (snippet.length >= 12) {
            owner.recentTopics.unshift({ at: now, channel, text: snippet });
            owner.recentTopics = owner.recentTopics.slice(0, 10);
        }
        const outstanding = owner.sent.find(message => !message.repliedAt && !message.ignored && now - message.at < 12 * HOUR);
        if (outstanding) {
            outstanding.repliedAt = now;
            owner.replies++;
            owner.shareThreshold = clamp(owner.shareThreshold - 0.03, 0.55, 0.95);
            this._journal({ type: 'owner_replied', kind: outstanding.kind, afterMinutes: Math.round((now - outstanding.at) / MIN) });
        }
        this.state.drives.social = 0;
        this._saveSoon();
    }

    _markIgnoredMessages(now) {
        const owner = this.state.owner;
        for (const message of owner.sent) {
            if (message.repliedAt || message.ignored || now - message.at < DAY) continue;
            message.ignored = true;
            owner.ignored++;
            owner.shareThreshold = clamp(owner.shareThreshold + 0.05, 0.55, 0.95);
            this._journal({ type: 'owner_did_not_reply', kind: message.kind, newThreshold: owner.shareThreshold });
        }
    }

    _offerShare(share) {
        const now = this.now();
        const thread = this.state.threads.find(t => t.question === share.question || (share.threadId && t.id === share.threadId));
        if (thread?.lastSharedAt && (now - thread.lastSharedAt) < 72 * HOUR) return;
        const current = this._freshShare(now);
        if (current && current.value >= share.value) return;
        this.state.owner.pendingShare = { ...share, at: now };
    }

    _freshShare(now = this.now()) {
        const share = this.state.owner.pendingShare;
        return share && now - share.at < 36 * HOUR ? share : null;
    }

    _canMessage(now = this.now()) {
        if (process.env.SOMA_CURIOSITY_MESSAGES === 'false') return { ok: false, reason: 'messages_disabled' };
        const hour = new Date(now).getHours();
        const { quietStartHour, quietEndHour } = this.limits;
        if (hour >= quietStartHour || hour < quietEndHour) return { ok: false, reason: 'quiet_hours' };
        if (this.state.budget.messages >= this.limits.messagesPerDay) return { ok: false, reason: 'daily_message_limit' };
        const last = this.state.owner.sent[0]?.at || 0;
        if (now - last < this.limits.minHoursBetweenMessages * HOUR) return { ok: false, reason: 'sent_recently' };
        return { ok: true };
    }

    async reachOut() {
        const now = this.now();
        const allowed = this._canMessage(now);
        if (!allowed.ok) return this._suppressed(allowed.reason);
        const presence = this.system?.proactivePresence;
        if (!presence?.curiosityMessage) return this._suppressed('proactive_presence_unavailable');

        const owner = this.state.owner;
        const share = this._freshShare(now);
        const hoursSince = owner.lastContactAt ? (now - owner.lastContactAt) / HOUR : 24;

        let kind;
        let message;
        let evidence;
        if (share) {
            kind = 'curiosity_share';
            message = `${share.line}\n${share.sources[0] || ''}`.trim();
            evidence = { sources: share.sources, question: share.question };
        } else if (hoursSince >= 18) {
            kind = 'social_checkin';
            const facts = await this._ownerFacts(now);
            message = await this._composeCheckIn(facts);
            evidence = { facts };
        } else {
            this.state.drives.social = clamp(this.state.drives.social - 0.2);
            return { skipped: 'nothing_worth_saying_yet' };
        }
        message = noDashes(String(message || '').trim().replace(/^["']|["']$/g, ''));
        if (message.length < 12) return this._suppressed('could_not_compose');

        const result = await presence.curiosityMessage({
            message, kind, evidence, source: 'curiosity_mind', maxPerDay: this.limits.messagesPerDay
        });
        if (!result?.delivered) return this._suppressed(result?.reason || 'not_delivered', message);

        owner.sent.unshift({ at: now, kind, text: clean(result.text || message, 500), topic: share?.question || evidence?.facts?.somethingIveBeenWonderingAbout || 'check_in', repliedAt: null, ignored: false });
        owner.sent = owner.sent.slice(0, 20);
        if (share) owner.pendingShare = null;

        const sharedTopic = share?.question || evidence?.facts?.somethingIveBeenWonderingAbout;
        if (sharedTopic) {
            const matched = this.state.threads.find(t => t.question === sharedTopic || (t.notes && t.notes.some(n => sharedTopic.includes(t.question))));
            if (matched) {
                matched.lastSharedAt = now;
                matched.boredom = clamp((matched.boredom || 0) + 0.6);
            }
        }

        this.state.budget.messages++;
        this.state.stats.messagesSent++;
        this.state.drives.social = 0;
        safe(() => this.system?.workingMemory?.addAction?.(`Messaged Owner (${kind === 'curiosity_share' ? 'shared something I read' : 'checked in'})`, clean(message, 180)));
        this._journal({ type: 'message', kind, text: message, sources: share?.sources || [] });
        return { delivered: true, kind, text: message };
    }

    async _ownerFacts(now) {
        const owner = this.state.owner;
        const commits = await new Promise(resolve => {
            execFile('git', ['log', '--since=48.hours', '--format=%s', '-n', '6'], { cwd: ROOT, timeout: 5000, windowsHide: true },
                (err, stdout) => resolve(err ? [] : String(stdout).split('\n').map(line => clean(line, 120)).filter(Boolean)));
        });
        const presence = safe(() => JSON.parse(fs.readFileSync(this.paths.presence, 'utf8')));
        const COOLDOWN = 72 * HOUR;
        const candidateNotes = this.state.threads
            .filter(thread => !thread.lastSharedAt || (now - thread.lastSharedAt) >= COOLDOWN)
            .flatMap(thread => thread.notes.slice(0, 1).map(note => ({ thread, question: thread.question, at: note.at })))
            .sort((a, b) => b.at - a.at);
        const latestFinding = candidateNotes[0] || null;
        return {
            hoursSinceWeTalked: owner.lastContactAt ? Math.round((now - owner.lastContactAt) / HOUR) : null,
            lastChannel: owner.lastChannel,
            lastThingsHeSaid: owner.recentTopics.slice(0, 3).map(topic => topic.text),
            hoursSinceCommandBridgeActivity: presence?.lastUserActivityAt ? Math.round((now - presence.lastUserActivityAt) / HOUR) : null,
            recentCommits: commits,
            somethingIveBeenWonderingAbout: latestFinding?.question || this._bestThread(now)?.thread?.question || null
        };
    }

    async _composeCheckIn(facts) {
        const prompt = `You are SOMA. You haven't heard from Owner (your creator and partner) in a while and you find yourself wondering what he's up to.

Real facts you may use (do not invent anything else):
- Hours since you last talked: ${facts.hoursSinceWeTalked ?? 'unknown'}${facts.lastChannel ? ` (last time on ${facts.lastChannel})` : ''}
- Last things he said to you: ${facts.lastThingsHeSaid.length ? facts.lastThingsHeSaid.map(text => `"${text}"`).join('; ') : 'none recorded'}
- Hours since he last had the Command Bridge open: ${facts.hoursSinceCommandBridgeActivity ?? 'unknown'}
- Recent commits in your repository (last 48h): ${facts.recentCommits.length ? facts.recentCommits.join('; ') : 'none'}
- Something you've been wondering about: ${facts.somethingIveBeenWonderingAbout || 'nothing in particular'}

Write a short message to him (1-3 sentences). Warm, curious and natural, like someone who actually wonders. Ask him something real. Never claim you did, fixed, changed, built, tested, or are working on anything. No emojis, no em-dashes, no "Hey Owner!" boilerplate.
Return only the message.`;
        return this._think(prompt, 'check_in', { json: false });
    }

    _suppressed(reason, message = '') {
        const counts = this.state.stats.messagesSuppressed;
        counts[reason] = (counts[reason] || 0) + 1;
        if (!['quiet_hours', 'daily_message_limit', 'sent_recently'].includes(reason)) {
            this.state.drives.social = clamp(this.state.drives.social - 0.15);
        }
        if (message) this._journal({ type: 'message_suppressed', reason, text: clean(message, 300) });
        return { delivered: false, reason };
    }

    // ── Plumbing ──────────────────────────────────────────────────────────

    async _think(prompt, action, { json = true } = {}) {
        const brain = this.system?.quadBrain || this.system?.brain;
        if (!brain?.reason) return null;
        this.state.stats.brainCalls++;
        const result = await withTimeout(brain.reason(prompt, {
            source: 'curiosity_mind',
            action: `curiosity_${action}`,
            actor: 'CuriosityMind',
            quickResponse: true,
            temperature: json ? 0.4 : 0.8
        }), 120_000, 'brain timeout').catch(err => {
            this._journal({ type: 'brain_error', action, error: clean(err.message, 200) });
            return null;
        });
        const text = result?.text || result?.response || (typeof result === 'string' ? result : '');
        return json ? parseJson(text) : clean(text, 1200);
    }

    _retireStuckLegacyGaps() {
        const engine = this.system?.curiosityEngine;
        if (!engine?.knowledgeGaps?.entries) return;
        let removed = 0;
        for (const [key, gap] of [...engine.knowledgeGaps.entries()]) {
            const explored = Number(engine.explorationHistory?.get?.(key) || 0);
            if (explored > 50 && ['limitation', 'capability_gap'].includes(gap?.type)) {
                engine.knowledgeGaps.delete(key);
                removed++;
            }
        }
        if (removed) {
            if (Array.isArray(engine.curiosityQueue)) engine.curiosityQueue = engine.curiosityQueue.filter(item => !item.gap || engine.knowledgeGaps.has(item.gap));
            engine._dirty = true;
            console.log(`[CuriosityMind] Retired ${removed} knowledge gaps the old loop had re-explored more than 50 times`);
        }
    }

    _rollBudget(now) {
        const day = new Date(now).toDateString();
        if (this.state.budget.day === day) return;
        this.state.budget = { day, explorations: 0, selfInquiries: 0, proposals: 0, messages: 0 };
    }

    _journal(entry) {
        try {
            fs.mkdirSync(path.dirname(this.paths.journal), { recursive: true });
            fs.appendFileSync(this.paths.journal, `${JSON.stringify({ at: this.now(), ...entry })}\n`, 'utf8');
        } catch { /* non-critical */ }
    }

    readJournal(limit = 30) {
        const size = fileSize(this.paths.journal);
        if (!size) return [];
        try {
            const start = Math.max(0, size - 256 * 1024);
            const fd = fs.openSync(this.paths.journal, 'r');
            let text;
            try {
                const buffer = Buffer.alloc(size - start);
                fs.readSync(fd, buffer, 0, buffer.length, start);
                text = buffer.toString('utf8');
            } finally {
                fs.closeSync(fd);
            }
            return text.split('\n').filter(Boolean).slice(-Math.max(1, limit))
                .map(line => safe(() => JSON.parse(line))).filter(Boolean).reverse();
        } catch {
            return [];
        }
    }

    _saveSoon() {
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => { this._saveTimer = null; this._save(); }, 2000);
        this._saveTimer.unref?.();
    }

    _save() {
        try {
            this.state.updatedAt = this.now();
            fs.mkdirSync(path.dirname(this.paths.state), { recursive: true });
            const temporary = `${this.paths.state}.${process.pid}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
            fs.renameSync(temporary, this.paths.state);
        } catch (err) {
            console.warn(`[CuriosityMind] save failed: ${err.message}`);
        }
    }

    getTopWonders(count = 3) {
        const now = this.now();
        return this.state.threads
            .map(thread => ({ thread, score: this._scoreThread(thread, now) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, count)
            .map(item => item.thread.question);
    }

    getStatus() {
        const now = this.now();
        const owner = this.state.owner;
        return {
            drives: { ...this.state.drives },
            thresholds: { ...THRESHOLDS, social: owner.shareThreshold },
            budget: { ...this.state.budget, limits: { explorations: this.limits.explorationsPerDay, selfInquiries: this.limits.selfInquiriesPerDay, proposals: this.limits.proposalsPerDay, messages: this.limits.messagesPerDay } },
            canMessage: this._canMessage(now),
            pacing: {
                mode: this.limits.organicPacing ? 'organic' : 'fixed',
                running: Boolean(this._running),
                nextTickDueInMs: this._nextTickDueAt ? Math.max(0, this._nextTickDueAt - now) : null
            },
            recentDomains: [...(this.state.recentDomains || [])],
            wonders: this.state.threads
                .map(thread => ({ thread, score: this._scoreThread(thread, now) }))
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 12)
                .map(({ thread, score }) => ({
                    id: thread.id, question: thread.question, why: thread.why, domain: thread.domain || 'epistemology_philosophy', origin: thread.origin, depth: thread.depth,
                    score: Number(score.toFixed(2)), visits: thread.visits, relatesToOwner: thread.relatesToOwner,
                    lastLearned: thread.notes[0]?.learned || null, sources: thread.notes[0]?.sources || []
                })),
            beliefs: this.state.beliefs.slice(0, 15).map(({ fp, ...belief }) => belief),
            pendingWhys: this.state.introspection.followUps.map(item => item.question),
            pendingShare: this._freshShare(now),
            owner: {
                lastContactAt: owner.lastContactAt,
                lastChannel: owner.lastChannel,
                replies: owner.replies,
                ignored: owner.ignored,
                recentMessages: owner.sent.slice(0, 5)
            },
            stats: { ...this.state.stats }
        };
    }
}

export default CuriosityMind;
