#!/usr/bin/env node
/**
 * Offline checks for core/CuriosityMind.js — no network, no running SOMA, no model spend.
 * A scripted brain and search tool stand in for DeepSeek and the web, so what's tested
 * is the mind itself: drives, choosing, reading with sources, why-chains, beliefs,
 * repair proposals, messaging gates, and learning from Owner's replies.
 *
 *   node scripts/test-curiosity-mind.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CuriosityMind, searchQuery, categorizeDomain, CURIOSITY_DOMAINS } from '../core/CuriosityMind.js';
import { ProactivePresence } from '../core/ProactivePresence.js';
import { OutboundAutonomyGate } from '../core/OutboundAutonomyGate.js';

const HOUR = 3600_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curiosity-mind-'));
let clock = new Date(2026, 8, 14, 12, 0, 0).getTime();
const now = () => clock;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
    else { failed++; console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
}

// ── Stand-ins ──────────────────────────────────────────────────────────────
const brainCalls = [];
let selfInquiryReply = null;
let readIrrelevant = false;
const brain = {
    async reason(prompt, context) {
        brainCalls.push({ action: context.action, source: context.source, prompt });
        if (context.action === 'curiosity_wonder') {
            return { text: JSON.stringify({ questions: [
                { question: 'How do octopuses taste things with their arms?', why: 'Thinking with your skin sounds impossible', relatesToOwner: false },
                { question: 'Why do language servers use JSON-RPC?', why: 'Owner just built one into Pulse', relatesToOwner: true }
            ] }) };
        }
        if (context.action === 'curiosity_read') {
            if (readIrrelevant) return { text: JSON.stringify({ relevant: false, learned: 'These pages are about something else.', newQuestions: [], intrigue: 0.2 }) };
            return { text: 'Sure! ' + JSON.stringify({
                relevant: true,
                learned: 'Octopus suckers carry chemoreceptors, so an arm tastes what it touches — each arm makes local decisions.',
                surprise: 'Two thirds of their neurons are in the arms.',
                newQuestions: ['Do octopus arms remember what they tasted?', 'How do arm neurons coordinate without the brain?'],
                intrigue: 0.9,
                ownerWouldCare: 0.75,
                shareLine: 'Octopus arms can taste what they touch, and most of their neurons live in the arms.',
                belief: 'Intelligence does not have to live in one central place.',
                sourcesUsed: [1]
            }) };
        }
        if (context.action === 'curiosity_self_inquiry') return { text: JSON.stringify(selfInquiryReply) };
        if (context.action === 'curiosity_check_in') return { text: 'It has been quiet since yesterday. What have you been building since the language servers went in?' };
        return { text: '{}' };
    }
};

const toolCalls = [];
const toolRegistry = {
    async execute(name, args) {
        toolCalls.push({ name, args });
        if (name === 'web_search') {
            return `[1] **${args.query} (overview)**\nSuckers contain chemoreceptors that taste.\nhttps://example.org/octopus-taste\n\n[2] **${args.query} (details)**\nMost neurons are in the arms.\nhttps://example.org/cephalopod-neurons`;
        }
        if (name === 'fetch_url') return `Page at ${args.url}: ` + 'Octopus arms have chemoreceptors in their suckers and a large share of neurons. '.repeat(10);
        return '';
    }
};

const proposals = [];
const governor = { submitProposal(goal, source, reason) { proposals.push({ goal, source, reason }); return { success: true, proposalId: `p${proposals.length}` }; } };

const published = [];
const broadcasts = [];
const messageBroker = { async publish(topic, payload) { published.push({ topic, payload }); } };

const gate = new OutboundAutonomyGate({ statePath: path.join(dir, 'gate.json'), now });
const presence = await new ProactivePresence({ statePath: path.join(dir, 'presence.json'), gate, now }).initialize({ messageBroker, broadcast: (type, payload) => broadcasts.push({ type, payload }) });

const legacyEngine = {
    knowledgeGaps: new Map([
        ['audio_processing', { type: 'limitation', gap: 'audio_processing' }],
        ['agent_architecture', { type: 'unexplored_domain', gap: 'agent_architecture' }]
    ]),
    explorationHistory: new Map([['audio_processing', 7300], ['agent_architecture', 3]]),
    curiosityQueue: [{ gap: 'audio_processing', question: 'workaround for audio' }],
    getStats: () => ({ explorationsStarted: 26869, explorationsCompleted: 0, autonomousTrainings: 0, knowledgeGaps: 31, exploredTopics: 2559 })
};

const ledger = [];
const launcherLog = path.join(dir, 'launcher_debug.log');
fs.writeFileSync(launcherLog, '[2026-09-01T00:00:00.000Z] >>> old history that should be ignored <<<\n[2026-09-01T00:00:01.000Z] [FATAL] Uncaught Exception: ancient failure\n');

const system = {
    quadBrain: brain,
    toolRegistry,
    messageBroker,
    proactivePresence: presence,
    curiosityEngine: legacyEngine,
    goalPlanner: { goals: new Map(), missionDirector: { governor } },
    selfModel: { limitations: new Map([['real_time_video', 1.0], ['infinite_memory', 0.7]]) }
};

const mind = new CuriosityMind({
    system,
    now,
    autoStart: false,
    workLedger: { record: entry => ledger.push(entry) },
    paths: {
        state: path.join(dir, 'mind.json'),
        journal: path.join(dir, 'journal.jsonl'),
        training: path.join(dir, 'training.jsonl'),
        launcherLog,
        presence: path.join(dir, 'presence-awareness.json')
    }
});
mind._aperture = async () => null; // Aperture isn't running offline → exercises the fallback path
mind._machineFacts = async () => ['CPU: test', 'GPU: none', 'Camera: never analyzed'];
mind._webResults = async () => []; // no live DuckDuckGo in the offline test; falls back to the stub tool
await mind.initialize();

// ── 1. Boot ────────────────────────────────────────────────────────────────
check('retires legacy gaps explored thousands of times', !legacyEngine.knowledgeGaps.has('audio_processing') && legacyEngine.knowledgeGaps.has('agent_architecture'));
check('old history in the launcher log is not treated as new', mind.state.introspection.logCursor === fs.statSync(launcherLog).size);
check('search query drops filler words', searchQuery('How do octopuses taste things with their arms?') === 'octopuses taste things arms');
check('search query drops possessives and code quotes', searchQuery("Does Express's `trust proxy` setting allow forging?") === 'express trust proxy setting allow forging');

// ── 2. Self-inquiry: the old engine's silence is noticed first ──────────────
selfInquiryReply = {
    explanation: 'The loader passes my brain as quadBrain but the engine only read brain, so synthesis never ran.',
    kind: 'bug', belief: 'My old curiosity loop was busy but disconnected from my brain.', confidence: 0.8,
    file: 'arbiters/CuriosityEngine.js', line: 74, suggestedFix: 'Read opts.quadBrain as the brain.',
    nextWhy: 'Why did nothing report that the brain was missing?'
};
let result = await mind.tick();
check('unease about her own functioning wins the first choice', result.action === 'self_inquiry', JSON.stringify(result.result?.question || result));
check('self-inquiry reads her real source code', brainCalls.at(-1)?.prompt.includes('arbiters/CuriosityEngine.js (lines'));
check('a confident bug becomes a diagnosis proposal', proposals.length === 1 && proposals[0].goal.title.startsWith('Diagnose why') && proposals[0].goal.metadata.suspectedFile === 'arbiters/CuriosityEngine.js');
check('self-inquiry forms a belief', mind.state.beliefs.some(belief => belief.about === 'self'));
check('the answer raises the next why', mind.state.introspection.followUps[0]?.question === 'Why did nothing report that the brain was missing?');

// Follow the why-chain: next tick should pick the queued why.
selfInquiryReply = { explanation: 'No health check watched curiosity output.', kind: 'design_choice', belief: 'Nothing was watching whether my curiosity produced anything.', confidence: 0.6, file: null, nextWhy: null };
clock += 5 * 60_000;
check('a follow-up why waits before being asked', !(await mind._senseSelf(clock)).some(anomaly => anomaly.key.startsWith('why:')));
clock += 26 * 60_000;
result = await mind.tick();
check('the why-chain continues on its own', result.action === 'self_inquiry' && result.result.question.includes('nothing report'));
check('a why-chain answer is not re-asked', mind.state.introspection.followUps.length === 0);

// ── 3. Understanding a limitation ─────────────────────────────────────────
selfInquiryReply = { explanation: 'My camera feed is captured but never analysed and there is no video model loaded.', kind: 'constraint', belief: 'I can see frames but I have nothing that understands video.', confidence: 0.7, file: null, nextWhy: null };
clock += 5 * 60_000;
result = await mind.tick();
check('she asks why she is limited, with machine facts', result.action === 'self_inquiry' && result.result.question.includes('real time video') && brainCalls.at(-1).prompt.includes('This machine, measured just now'));
check('a limitation becomes an understood constraint', mind.state.beliefs.some(belief => belief.limitKey === 'limit:real_time_video') && mind.state.stats.constraintsUnderstood === 1);
check('limits below 0.8 are not obsessed over', !mind.state.introspection.seenAnomalies['limit:infinite_memory']);

// ── 4. New crashes in the log ─────────────────────────────────────────────
fs.appendFileSync(launcherLog, `[2026-09-14T12:00:00.000Z] [FATAL] Uncaught Exception: Cannot read properties of undefined (reading 'x')\nTypeError: boom\n    at run (${path.join(process.cwd(), 'core', 'CuriosityMind.js')}:120:5)\n`);
selfInquiryReply = { explanation: 'A property is read before the object exists.', kind: 'unknown', belief: null, confidence: 0.3, file: null, nextWhy: null };
clock += 5 * 60_000;
result = await mind.tick();
check('a new crash makes her ask why', result.action === 'self_inquiry' && result.result.question.includes('Cannot read properties'));
check('crash inquiry includes the stack location in her code', brainCalls.at(-1).prompt.includes('core/CuriosityMind.js (lines'));
check('low confidence does not invent a belief', !mind.state.beliefs.some(belief => belief.statement.includes('property')));

// ── 4b. "Which code does this?" → she searches her own codebase ─────────────
mind.state.introspection.followUps.unshift({
    key: 'why:code-search-test',
    severity: 0.9,
    question: 'Which code actually calls `noteOwnerContact` when Owner replies on Discord?',
    evidence: ['I only know the name noteOwnerContact.'],
    refs: [],
    depth: 1
});
clock += 5 * 60_000;
result = await mind.tick();
check('a "which code?" why searches her own codebase', result.action === 'self_inquiry'
    && brainCalls.at(-1).prompt.includes('You searched your own code')
    && brainCalls.at(-1).prompt.includes('arbiters/DiscordArbiter.js (lines'));
check('the journal records what she searched and found', (mind.readJournal(1)[0]?.codeMatches || []).some(match => match.startsWith('arbiters/DiscordArbiter.js:')));

// ── 5. Quiet drives do nothing ─────────────────────────────────────────────
clock += 5 * 60_000;
mind.state.drives = { curiosity: 0.3, selfInquiry: 0, social: 0 };
mind.noteOwnerContact({ channel: 'chat', text: 'I added real language servers to Pulse last night' });
const callsBefore = brainCalls.length;
result = await mind.tick();
check('no pressure over threshold → no action and no model call', !result.acted && brainCalls.length === callsBefore);

// ── 6. Curiosity builds, then she wonders and reads ────────────────────────
for (let i = 0; i < 40 && !(result = await (clock += 10 * 60_000, mind.tick())).acted; i++);
check('curiosity builds on its own until she explores', result.action === 'explore', `after drives ${JSON.stringify(result.drives)}`);
check('with nothing open she wonders first', mind.state.threads.some(thread => thread.origin === 'wonder'));
check('wondering sees what Owner said', brainCalls.find(call => call.action === 'curiosity_wonder')?.prompt.includes('real language servers'));
check('she reads real pages via the free tools, never Brave', toolCalls.some(call => call.name === 'web_search') && toolCalls.some(call => call.name === 'fetch_url'));
check('what she learned keeps its sources', result.result.sources?.[0] === 'https://example.org/octopus-taste');
check('reading raises follow-up questions', result.result.newQuestions?.length === 2 && mind.state.threads.some(thread => thread.origin === 'reading' && thread.depth === 1));
check('a world belief is formed', mind.state.beliefs.some(belief => belief.about === 'world'));
check('discovery recorded with evidence in the work ledger', ledger[0]?.evidence?.includes('example.org'));
check('grounded training example written', (() => {
    const example = JSON.parse(fs.readFileSync(path.join(dir, 'training.jsonl'), 'utf8').trim().split('\n')[0]);
    return example.instruction === result.result.question && example.output.includes('chemoreceptors');
})());
check('something Owner would like is held to share', mind.state.owner.pendingShare?.value === 0.75);

// ── 6b. Aperture is her own window onto the web ──────────────────────────
const apertureCalls = [];
let apertureNetwork = true;
mind._aperture = async (route, options = {}) => {
    apertureCalls.push({ route, method: options.method || 'GET', body: options.body || null });
    if (route === '/settings') return { success: true, settings: { permissions: { networkAccess: apertureNetwork } } };
    if (route.startsWith('/portal/search')) {
        return { success: true, results: apertureNetwork
            ? [
                { url: 'https://example.org/arm-memory', title: 'Arm memory', snippet: 'Octopus arms and memory', source: 'web_search_duckduckgo' },
                { url: 'https://example.org/arm-nerves', title: 'Arm nerves', snippet: 'Nerve cords in arms', source: 'web_search_duckduckgo' },
                { url: 'https://example.org/indexed-note', title: 'Indexed note', snippet: 'Saved earlier', content: 'Previously captured page about octopus arm memory. '.repeat(12), source: 'reader' }
            ]
            : [] };
    }
    return { success: true };
};
const toolCallsBeforeAperture = toolCalls.filter(call => call.name === 'web_search').length;
mind.addThread({ question: 'Do octopus arms remember what they tasted before?', interest: 1, origin: 'reading' });
result = await mind.tick({ force: 'explore' });
check('she searches through Aperture first', apertureCalls.some(call => call.route.startsWith('/portal/search?q=') && call.route.includes('web=true')));
check('Aperture results are enough; the old tool is not used', toolCalls.filter(call => call.name === 'web_search').length === toolCallsBeforeAperture);
check('what she read is indexed in Aperture as hers', apertureCalls.some(call => call.route === '/portal/index' && call.body?.source === 'soma:curiosity'));
check('her search and visits appear in Portal history the way Portal records them', apertureCalls.some(call => call.route === '/portal/history' && call.body?.kind === 'research' && call.body?.address.startsWith('portal://index/')) && apertureCalls.some(call => call.route === '/portal/history' && call.body?.kind === 'reader' && call.body?.address === 'https://example.org/arm-memory'));

// Portal's loose local index returned an unrelated saved page in the live run.
mind._aperture = async (route) => {
    if (route === '/settings') return { success: true, settings: { permissions: { networkAccess: true } } };
    if (route.startsWith('/portal/search')) {
        return { success: true, results: [
            { url: 'https://example.org/octopus-old', title: 'Octopus arms taste', snippet: 'Suckers and chemoreceptors', content: 'octopus '.repeat(80), source: 'reader' },
            { url: 'https://example.org/express-proxy', title: 'Express trust proxy and X-Forwarded-For', snippet: 'How req.ip is derived when trust proxy is set', source: 'web_search_duckduckgo' }
        ] };
    }
    return { success: true };
};
const unrelated = await mind._search(searchQuery('Does Express trust proxy let a client forge X-Forwarded-For past req.ip?'));
check('unrelated saved pages are dropped from her search', unrelated.length === 1 && unrelated[0].url === 'https://example.org/express-proxy');

const trainingLinesBefore = fs.readFileSync(path.join(dir, 'training.jsonl'), 'utf8').trim().split('\n').length;
const beliefsBefore = mind.state.beliefs.length;
readIrrelevant = true;
mind.addThread({ question: 'Does Express trust proxy let a client forge X-Forwarded-For?', interest: 1, origin: 'wonder' });
result = await mind.tick({ force: 'explore' });
readIrrelevant = false;
check('pages that do not answer are an honest miss, not a finding', result.result.outcome === 'pages_did_not_answer'
    && fs.readFileSync(path.join(dir, 'training.jsonl'), 'utf8').trim().split('\n').length === trainingLinesBefore
    && mind.state.beliefs.length === beliefsBefore);

mind._aperture = async (route, options = {}) => {
    apertureCalls.push({ route, method: options.method || 'GET', body: options.body || null });
    if (route === '/settings') return { success: true, settings: { permissions: { networkAccess: apertureNetwork } } };
    if (route.startsWith('/portal/search')) return { success: true, results: [] };
    return { success: true };
};
apertureNetwork = false;
const fetchesBefore = toolCalls.filter(call => call.name === 'fetch_url').length;
mind.addThread({ question: 'How do squid change colour so quickly?', interest: 1, origin: 'reading' });
result = await mind.tick({ force: 'explore' });
check('Aperture network access off → she stays off the web', result.result.outcome === 'found_nothing_readable' && toolCalls.filter(call => call.name === 'fetch_url').length === fetchesBefore);
apertureNetwork = true;
mind._aperture = async () => null;

// ── 7. Messaging gates ────────────────────────────────────────────────────
check('quiet hours block messages', (() => { const saved = clock; clock = new Date(2026, 8, 14, 23, 30).getTime(); const r = mind._canMessage(); clock = saved; return r.reason === 'quiet_hours'; })());
check('gate refuses curiosity messages that claim work', !gate.evaluate({ message: "I fixed the octopus module", source: 'curiosity_mind', kind: 'curiosity_share', verified: true, evidence: { sources: ['x'] } }).allowed);
check('gate allows asking what Owner is working on', gate.evaluate({ message: 'What are you working on today?', source: 'curiosity_mind', kind: 'social_checkin', verified: true, evidence: { facts: {} } }).allowed);

// ── 8. Missing Owner + a good find → she reaches out ──────────────────────
mind.state.owner.lastContactAt = clock - 8 * HOUR;
mind.state.drives = { curiosity: 0, selfInquiry: 0, social: 0.5 };
for (let i = 0; i < 40 && !(result = await (clock += 10 * 60_000, mind.tick())).acted; i++) {
    if (new Date(clock).getHours() >= 23) break;
}
check('missing Owner plus a good find → she shares it', result.action === 'reach_out' && result.result.delivered, JSON.stringify(result.result || result.drives));
check('share goes to Discord (broker) and the Command Bridge', published.some(p => p.topic === 'soma_proactive' && p.payload.kind === 'curiosity_share') && broadcasts.some(b => b.payload.type === 'soma_proactive'));
check('the share includes its source link', published.at(-1)?.payload.message.includes('https://example.org/octopus-taste'));
check('social pressure is relieved after speaking', mind.state.drives.social === 0);

// ── 9. Replies teach her ──────────────────────────────────────────────────
const thresholdBefore = mind.state.owner.shareThreshold;
clock += HOUR;
mind.noteOwnerContact({ channel: 'discord', text: 'Whoa, that is wild, tell me more about the arms' });
check('a reply counts and lowers her hesitation', mind.state.owner.replies === 1 && mind.state.owner.shareThreshold < thresholdBefore);

mind.state.owner.sent.unshift({ at: clock - 25 * HOUR, kind: 'social_checkin', text: 'test', repliedAt: null, ignored: false });
const thresholdMid = mind.state.owner.shareThreshold;
await mind.tick();
check('an ignored message raises her hesitation', mind.state.owner.ignored === 1 && mind.state.owner.shareThreshold > thresholdMid);

// ── 10. Daily caps ────────────────────────────────────────────────────────
mind.state.budget.messages = 3;
check('daily message cap holds', mind._canMessage().reason === 'daily_message_limit');
mind.state.budget.explorations = mind.limits.explorationsPerDay;
check('daily exploration budget holds', (await mind.explore()).skipped === 'daily_exploration_budget');

// ── 11. Status + persistence ──────────────────────────────────────────────
const status = mind.getStatus();
check('status shows wonders, beliefs and journal', status.wonders.length > 0 && status.beliefs.length >= 3 && mind.readJournal(50).length >= 6);
mind._save();
const reloaded = await new CuriosityMind({ system, now, autoStart: false, paths: mind.paths }).initialize();
check('state survives a restart', reloaded.state.beliefs.length === mind.state.beliefs.length && reloaded.state.threads.length === mind.state.threads.length);
check('every model call is labelled background curiosity', brainCalls.every(call => call.source === 'curiosity_mind'));

// ── 12. Organic Pacing, Domain Rotation & Stimulus ─────────────────────────
// 12a. Domain Categorization
check('categorizeDomain correctly identifies biology_nature', categorizeDomain('How do octopuses taste things with their arms?') === 'biology_nature');
check('categorizeDomain correctly identifies systems_engineering', categorizeDomain('Does Express trust proxy let a client forge X-Forwarded-For?') === 'systems_engineering');
check('categorizeDomain correctly identifies owner_projects', categorizeDomain('Owner is evaluating whether to start a shower glass installation business') === 'owner_projects');
check('categorizeDomain correctly identifies markets_economics', categorizeDomain('What causes liquidity crises and trend reversal in crypto trading markets?') === 'markets_economics');
check('categorizeDomain correctly identifies epistemology_philosophy', categorizeDomain('Can consciousness exist without subjective qualia?') === 'epistemology_philosophy');
check('categorizeDomain correctly identifies creative_narrative', categorizeDomain('Why do world mythologies share the ancient hero journey archetype?') === 'creative_narrative');

// 12b. Domain Satiation & Topic Rotation
mind.state.recentDomains = ['biology_nature'];
const bioThread = mind.addThread({ question: 'How do squid cells express pigment so quickly?', interest: 0.8 });
const sysThread = mind.addThread({ question: 'How does an event bus arbitrate concurrent messages?', interest: 0.8 });
const bioScore = mind._scoreThread(bioThread);
const sysScore = mind._scoreThread(sysThread);
check('domain rotation dampens repeat domains and boosts novel ones', bioScore < sysScore && bioThread.domain === 'biology_nature' && sysThread.domain === 'systems_engineering');

// 12c. 72-Hour Sharing Cooldown
const sharedThread = mind.addThread({ question: 'Do octopus arms retain local motor memory?', interest: 0.9 });
sharedThread.lastSharedAt = clock - 2 * HOUR;
const sharedScore = mind._scoreThread(sharedThread);
check('72-hour sharing cooldown heavily suppresses repeated sharing', sharedScore < 0.1);

// 12d. Organic Pacing Delay Engine
mind.limits.organicPacing = true;
// Night quiet hours
const nightTime = new Date(2026, 8, 14, 23, 30, 0).getTime();
const nightDelay = mind._calculateOrganicDelay(nightTime);
check('organic pacing quiet hours schedule long dormant delay (40-100m)', nightDelay >= 40 * 60_000 && nightDelay <= 100 * 60_000);

// Operator active listener buffer (Owner recently active)
const daytimeActive = new Date(2026, 8, 14, 14, 0, 0).getTime();
mind.state.owner.lastContactAt = daytimeActive - 5 * 60_000;
const listenerDelay = mind._calculateOrganicDelay(daytimeActive);
check('active listener window delays spontaneous wondering (14-26m)', listenerDelay >= 14 * 60_000 && listenerDelay <= 26 * 60_000);

// Drive-dependent delay (high curiosity drive)
mind.state.owner.lastContactAt = daytimeActive - 2 * HOUR;
mind.state.drives.curiosity = 0.85;
const highDriveDelay = mind._calculateOrganicDelay(daytimeActive);
check('high drive pressure shortens organic delay (3-10m)', highDriveDelay >= 3 * 60_000 && highDriveDelay <= 10 * 60_000);

// Stochastic non-cyclic jitter (two delay calculations are not equal)
const sampleDelays = new Set();
for (let i = 0; i < 5; i++) sampleDelays.add(mind._calculateOrganicDelay(daytimeActive));
check('stochastic jitter produces non-periodic, non-metronomic intervals', sampleDelays.size > 1);

// 12e. Event-driven Stimulus
const driveBeforeStim = mind.state.drives.curiosity;
const stimResult = mind.stimulate({
    question: 'How do automated market maker pool curves handle slippage?',
    source: 'backtest_engine',
    intrigue: 0.85
});
check('stimulate creates a thread and raises curiosity drive', stimResult.stimulated && mind.state.drives.curiosity > driveBeforeStim);
const stimJournal = mind.readJournal(3).find(j => j.type === 'stimulated');
check('stimulus event is recorded in the curiosity journal', Boolean(stimJournal) && stimJournal.source === 'backtest_engine');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
