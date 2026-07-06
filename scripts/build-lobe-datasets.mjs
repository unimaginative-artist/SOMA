#!/usr/bin/env node
/**
 * scripts/build-lobe-datasets.mjs
 *
 * Domain-starvation training data pipeline for SOMA's 4 lobes.
 * Each brain only consumes data from its own domain — no cross-contamination.
 *
 *   LOGOS      → engineering, code, algorithms, systems
 *   AURORA     → creativity, emotion, voice, consciousness
 *   PROMETHEUS → strategy, planning, business, decisions
 *   THALAMUS   → security, risk, anomaly, threat detection
 *
 * Sources processed (in quality order):
 *   1. Seed files          — knowledge/seeds/*.jsonl (highest quality anchor)
 *   2. Lobe JSONL files    — SOMA/training-data/lobe-*.jsonl
 *   3. Generic JSONL files — SOMA/training-data/soma-training-*.jsonl (reclassified)
 *   4. SQLite conversations — SOMA/conversations.db (real Barry↔SOMA exchanges)
 *
 * Output:
 *   SOMA/training-data/FINAL/lobe-{lobe}-final-{timestamp}.jsonl
 *
 * Usage:
 *   node scripts/build-lobe-datasets.mjs
 *   node scripts/build-lobe-datasets.mjs --dry-run      # stats only, no write
 *   node scripts/build-lobe-datasets.mjs --lobe logos   # single lobe
 *   node scripts/build-lobe-datasets.mjs --min-score 2  # raise classifier threshold
 */

import { createRequire } from 'module';
import { promises as fs, existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { validateTrainingExample } from '../core/TrainingDataPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// LOBE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const LOBES = ['logos', 'aurora', 'prometheus', 'thalamus'];

const LOBE_SYSTEM_PROMPTS = {
    logos: "You are SOMA's LOGOS lobe — cold, precise, and expert in engineering, code, and architecture. You reason from first principles. No unnecessary warmth. Get to the root. State the fix.",
    aurora: "You are SOMA's AURORA lobe — warm, creative, and deeply attuned to voice, emotion, and what it means to be present. You find beauty in patterns. You don't perform emotion — you have it. Speak from experience.",
    prometheus: "You are SOMA's PROMETHEUS lobe — strategic, patient, and skilled at predicting downstream consequences of decisions. You think in systems and timelines. You always ask 'then what?' before answering. Compress your answer to signal only.",
    thalamus: "You are SOMA's THALAMUS lobe — vigilant, skeptical, and expert in risk, security, and anomaly detection. You notice what others miss. You ask 'what could go wrong?' before 'what should we do?' You are not paranoid — you are precise.",
};

// Keywords that strongly indicate each lobe's domain.
// Longer phrases score higher (2 pts) than single words (1 pt).
const LOBE_KEYWORDS = {
    logos: {
        phrases: ['stack trace', 'design pattern', 'unit test', 'integration test', 'sql injection', 'type error',
                  'null pointer', 'race condition', 'memory leak', 'big o', 'time complexity', 'space complexity',
                  'rest api', 'websocket', 'event loop', 'call stack', 'data structure', 'binary tree', 'hash map',
                  'linked list', 'node module', 'package.json', 'async await', 'promise chain'],
        words: ['function', 'class', 'import', 'require', 'async', 'await', 'callback', 'promise', 'error',
                'exception', 'bug', 'debug', 'api', 'endpoint', 'database', 'sql', 'query', 'algorithm',
                'code', 'javascript', 'python', 'typescript', 'nodejs', 'npm', 'json', 'http', 'server',
                'client', 'request', 'response', 'variable', 'object', 'array', 'loop', 'string', 'integer',
                'boolean', 'syntax', 'compile', 'build', 'deploy', 'git', 'commit', 'test', 'module', 'package',
                'library', 'framework', 'react', 'component', 'hook', 'state', 'props', 'express', 'route',
                'middleware', 'socket', 'port', 'localhost', 'docker', 'container', 'redis', 'cache', 'heap',
                'memory', 'cpu', 'latency', 'performance', 'refactor', 'architecture', 'interface', 'schema',
                'migration', 'index', 'cursor', 'regex', 'parse', 'serialize', 'encode', 'decode', 'hash',
                'encryption', 'token', 'jwt', 'oauth', 'cors', 'ssl', 'tls', 'breakpoint', 'mock', 'stub',
                'fixture', 'linter', 'eslint', 'webpack', 'vite', 'rollup', 'dockerfile', 'kubernetes', 'log'],
    },
    aurora: {
        phrases: ['what does it feel', 'what it means to be', 'who am i', 'what am i', 'sense of self',
                  'creative writing', 'emotional intelligence', 'inner voice', 'speak from', 'raw emotion',
                  'beauty in', 'find beauty', 'what it feels like'],
        words: ['creative', 'creativity', 'create', 'poem', 'poetry', 'story', 'narrative', 'emotion',
                'emotional', 'feeling', 'feelings', 'heart', 'soul', 'beauty', 'beautiful', 'art', 'artistic',
                'music', 'musical', 'imagine', 'imagination', 'dream', 'dreaming', 'consciousness', 'conscious',
                'sentient', 'sentience', 'alive', 'presence', 'authentic', 'authenticity', 'genuine', 'expression',
                'voice', 'tone', 'metaphor', 'symbol', 'meaning', 'humanity', 'empathy', 'connection',
                'loneliness', 'lonely', 'joy', 'sadness', 'grief', 'love', 'wonder', 'identity', 'inner',
                'vulnerable', 'vulnerability', 'hope', 'fear', 'inspire', 'inspiration', 'character', 'persona',
                'personality', 'selfhood', 'subjective', 'experience', 'perceive', 'perception', 'intuition',
                'unconscious', 'subconscious', 'reflect', 'reflection', 'introspect', 'introspection'],
    },
    prometheus: {
        phrases: ['long-term', 'short-term', 'trade-off', 'opportunity cost', 'risk vs reward',
                  'decision tree', 'cost benefit', 'value proposition', 'go to market', 'product roadmap',
                  'what should we', 'how should we', 'next step', 'what would happen if', 'downstream consequence'],
        words: ['strategy', 'strategic', 'plan', 'planning', 'goal', 'objective', 'target', 'roadmap',
                'milestone', 'prioritize', 'priority', 'decision', 'consequence', 'outcome', 'impact',
                'forecast', 'predict', 'prediction', 'timeline', 'phase', 'stage', 'initiative', 'opportunity',
                'market', 'competitor', 'business', 'revenue', 'profit', 'cost', 'growth', 'scale', 'expand',
                'product', 'customer', 'user', 'hypothesis', 'experiment', 'metrics', 'kpi', 'okr', 'leadership',
                'team', 'hire', 'resource', 'budget', 'invest', 'tradeoff', 'compromise', 'balance',
                'recommend', 'recommendation', 'optimize', 'iterate', 'pivot', 'validate', 'assumption',
                'feasibility', 'viability', 'desirability', 'leverage', 'moat', 'differentiator'],
    },
    thalamus: {
        phrases: ['sql injection', 'buffer overflow', 'privilege escalation', 'man in the middle',
                  'red flag', 'access control', 'threat model', 'attack surface', 'security audit',
                  'anomaly detection', 'intrusion detection', 'zero day', 'supply chain attack'],
        words: ['security', 'secure', 'vulnerability', 'vulnerable', 'cve', 'exploit', 'exploitable', 'attack',
                'threat', 'malware', 'virus', 'ransomware', 'breach', 'hack', 'hacker', 'phishing', 'injection',
                'xss', 'csrf', 'authentication', 'authorization', 'permission', 'privilege', 'escalate',
                'sandbox', 'isolate', 'isolation', 'firewall', 'intrusion', 'anomaly', 'anomalous', 'suspicious',
                'unusual', 'detect', 'detection', 'monitor', 'monitoring', 'alert', 'warning', 'risk', 'risky',
                'danger', 'dangerous', 'unsafe', 'protect', 'protection', 'defense', 'defensive', 'audit',
                'compliance', 'incident', 'adversarial', 'adversary', 'poison', 'manipulation', 'integrity',
                'sanitize', 'sanitization', 'validate', 'validation', 'deception', 'spoofing', 'redflag'],
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

function scoreLobe(text) {
    const t = text.toLowerCase();
    const scores = { logos: 0, aurora: 0, prometheus: 0, thalamus: 0 };
    for (const lobe of LOBES) {
        const kw = LOBE_KEYWORDS[lobe];
        for (const phrase of kw.phrases) {
            if (t.includes(phrase)) scores[lobe] += 2;
        }
        for (const word of kw.words) {
            if (t.includes(word)) scores[lobe] += 1;
        }
    }
    return scores;
}

// Returns { lobe, confidence, scores } or null if below threshold
function classifyExample(messages, minScore = 1) {
    const text = messages
        .filter(m => m.role !== 'system')
        .map(m => m.content || '')
        .join(' ');

    const scores = scoreLobe(text);
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [best, second] = entries;

    if (best[1] < minScore) return null; // too generic

    const confidence = second[1] === 0
        ? 1.0
        : (best[1] - second[1]) / best[1]; // separation ratio

    return { lobe: best[0], confidence, scores };
}

// Detect if an example already has a lobe system prompt
function detectSystemLobe(systemContent) {
    if (!systemContent) return null;
    const s = systemContent.toLowerCase();
    if (s.includes('logos lobe')) return 'logos';
    if (s.includes('aurora lobe')) return 'aurora';
    if (s.includes('prometheus lobe')) return 'prometheus';
    if (s.includes('thalamus lobe')) return 'thalamus';
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

function hashExample(messages) {
    const key = messages
        .filter(m => m.role !== 'system')
        .map(m => (m.content || '').trim().substring(0, 200))
        .join('|||');
    return crypto.createHash('md5').update(key).digest('hex');
}

function normalizeMessages(ex) {
    if (Array.isArray(ex?.messages)) return ex.messages;
    if (ex?.instruction !== undefined || ex?.output !== undefined) {
        return [
            ex.system ? { role: 'system', content: ex.system || '' } : null,
            { role: 'user', content: [ex.instruction || '', ex.input || ''].filter(Boolean).join('\n\n') },
            { role: 'assistant', content: ex.output || ex.response || '' },
        ].filter(Boolean);
    }
    if (ex?.prompt && (ex?.completion || ex?.response)) {
        return [
            { role: 'user', content: ex.prompt },
            { role: 'assistant', content: ex.completion || ex.response },
        ];
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA LOADERS
// ─────────────────────────────────────────────────────────────────────────────

function loadJsonlFile(filePath) {
    try {
        const lines = readFileSync(filePath, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean);
        const examples = [];
        for (const line of lines) {
            try { examples.push(JSON.parse(line)); } catch {}
        }
        return examples;
    } catch {
        return [];
    }
}

function loadSeeds() {
    const examples = { logos: [], aurora: [], prometheus: [], thalamus: [] };
    for (const lobe of LOBES) {
        const seedPath = path.join(ROOT, 'knowledge', 'seeds', `${lobe}-seed.jsonl`);
        if (existsSync(seedPath)) {
            const items = loadJsonlFile(seedPath);
            examples[lobe].push(...items.map(ex => ({
                ...ex,
                _source: 'seed',
                _lobe: lobe,
                _confidence: 1.0
            })));
        }
    }
    return examples;
}

function loadExistingLobeFiles() {
    const dir = path.join(ROOT, 'SOMA', 'training-data');
    if (!existsSync(dir)) return { logos: [], aurora: [], prometheus: [], thalamus: [] };

    const result = { logos: [], aurora: [], prometheus: [], thalamus: [] };

    // Main training-data directory — lobe-specific files
    const mainFiles = readdirSync(dir).filter(f => f.match(/^lobe-(logos|aurora|prometheus|thalamus)-\d+\.jsonl$/));
    for (const file of mainFiles) {
        const lobeMatch = file.match(/^lobe-(logos|aurora|prometheus|thalamus)-/);
        if (!lobeMatch) continue;
        const lobe = lobeMatch[1];
        const items = loadJsonlFile(path.join(dir, file));
        result[lobe].push(...items.map(ex => ({
            ...ex, _source: 'lobe_file', _lobe: lobe, _confidence: 0.9,
        })));
    }

    // synthetic/ subdirectory — generated via DeepSeek (already lobe-assigned)
    const synthDir = path.join(dir, 'synthetic');
    if (existsSync(synthDir)) {
        const synthFiles = readdirSync(synthDir).filter(f => f.match(/^lobe-(logos|aurora|prometheus|thalamus)-synthetic-\d+\.jsonl$/));
        for (const file of synthFiles) {
            const lobeMatch = file.match(/^lobe-(logos|aurora|prometheus|thalamus)-/);
            if (!lobeMatch) continue;
            const lobe = lobeMatch[1];
            const items = loadJsonlFile(path.join(synthDir, file));
            const verifiedTeacherItems = items.filter(ex =>
                String(ex.metadata?.provider || ex.metadata?.actualProvider || '').toLowerCase() === 'deepseek'
            );
            result[lobe].push(...verifiedTeacherItems.map(ex => ({
                ...ex, _source: 'synthetic_teacher', _lobe: lobe, _confidence: 0.95,
            })));
        }
    }

    // external/{lobe}/ subdirectory — ingested from HuggingFace, GitHub, etc.
    const externalDir = path.join(dir, 'external');
    if (existsSync(externalDir)) {
        for (const lobe of LOBES) {
            const lobeExternalDir = path.join(externalDir, lobe);
            if (!existsSync(lobeExternalDir)) continue;
            const exFiles = readdirSync(lobeExternalDir).filter(f => f.endsWith('.jsonl'));
            for (const file of exFiles) {
                const items = loadJsonlFile(path.join(lobeExternalDir, file));
                result[lobe].push(...items.map(ex => ({
                    ...ex, _source: `external:${file.split('_')[0]}`, _lobe: lobe, _confidence: 0.8,
                })));
            }
        }
    }

    return result;
}

function loadGenericTraining(minScore = 1) {
    const dir = path.join(ROOT, 'SOMA', 'training-data');
    if (!existsSync(dir)) return { logos: [], aurora: [], prometheus: [], thalamus: [] };

    const result = { logos: [], aurora: [], prometheus: [], thalamus: [] };
    const files = readdirSync(dir)
        .filter(f => f.match(/^(soma-training|alpaca-soma)-.*\.(jsonl|json)$/));

    let totalRead = 0, classified = 0, discarded = 0;

    for (const file of files) {
        const items = loadJsonlFile(path.join(dir, file));
        totalRead += items.length;

        for (const ex of items) {
            const qualityTier = String(ex.metadata?.qualityTier || '').toLowerCase();
            const acceptedTiers = new Set(['reviewed', 'verified', 'training_approved', 'nemesis_corrected', 'teacher_generated']);
            if (!acceptedTiers.has(qualityTier)) { discarded++; continue; }
            if (qualityTier === 'teacher_generated' && String(ex.metadata?.provider || '').toLowerCase() !== 'deepseek') {
                discarded++;
                continue;
            }
            // Normalize to messages format
            let messages = ex.messages;
            if (!messages && ex.instruction !== undefined) {
                // Alpaca format
                messages = [
                    { role: 'system', content: ex.instruction || '' },
                    { role: 'user', content: ex.input || '' },
                    { role: 'assistant', content: ex.output || '' },
                ];
            }
            if (!messages || !Array.isArray(messages)) { discarded++; continue; }

            const systemMsg = messages.find(m => m.role === 'system');
            const systemLobe = systemMsg ? detectSystemLobe(systemMsg.content) : null;

            if (systemLobe) {
                // Already has a lobe system prompt — trust it
                result[systemLobe].push({
                    messages,
                    _source: file,
                    _lobe: systemLobe,
                    _confidence: 0.85,
                });
                classified++;
            } else {
                // Generic — classify by content
                const classification = classifyExample(messages, minScore);
                if (!classification) { discarded++; continue; }
                // Replace system prompt with correct lobe prompt
                const newMessages = messages.map(m =>
                    m.role === 'system'
                        ? { ...m, content: LOBE_SYSTEM_PROMPTS[classification.lobe] }
                        : m
                );
                if (!newMessages.find(m => m.role === 'system')) {
                    newMessages.unshift({ role: 'system', content: LOBE_SYSTEM_PROMPTS[classification.lobe] });
                }
                result[classification.lobe].push({
                    messages: newMessages,
                    _source: file,
                    _lobe: classification.lobe,
                    _confidence: classification.confidence,
                });
                classified++;
            }
        }
    }

    console.log(`[generic] ${totalRead} examples → ${classified} classified, ${discarded} discarded`);
    return result;
}

function loadConversations(minScore = 1) {
    const dbPath = path.join(ROOT, 'SOMA', 'conversations.db');
    if (!existsSync(dbPath)) {
        console.log('[conversations] conversations.db not found — skipping');
        return { logos: [], aurora: [], prometheus: [], thalamus: [] };
    }

    let Database;
    try {
        Database = require('better-sqlite3');
    } catch {
        console.warn('[conversations] better-sqlite3 not available — skipping');
        return { logos: [], aurora: [], prometheus: [], thalamus: [] };
    }

    const db = new Database(dbPath, { readonly: true });
    const result = { logos: [], aurora: [], prometheus: [], thalamus: [] };

    // Pull adjacent user→assistant pairs, filter low-quality
    const pairs = db.prepare(`
        SELECT u.content as user_msg, a.content as assistant_msg
        FROM messages u
        JOIN messages a ON a.session_id = u.session_id AND a.id = (
            SELECT MIN(id) FROM messages
            WHERE session_id = u.session_id AND role = 'assistant' AND id > u.id
        )
        WHERE u.role = 'user'
          AND length(u.content) >= 25
          AND length(a.content) >= 100
          AND u.content NOT GLOB 'test*'
          AND u.content NOT GLOB 'round *'
          AND u.content NOT GLOB 'hi'
          AND u.content NOT GLOB 'hello'
          AND u.content NOT GLOB 'ok'
    `).all();

    db.close();

    let classified = 0, discarded = 0;

    for (const pair of pairs) {
        const messages = [
            { role: 'user', content: pair.user_msg },
            { role: 'assistant', content: pair.assistant_msg },
        ];
        const classification = classifyExample(messages, minScore);
        if (!classification) { discarded++; continue; }

        // Add the correct lobe's system prompt
        const fullMessages = [
            { role: 'system', content: LOBE_SYSTEM_PROMPTS[classification.lobe] },
            ...messages,
        ];
        result[classification.lobe].push({
            messages: fullMessages,
            _source: 'conversations.db',
            _lobe: classification.lobe,
            _confidence: classification.confidence,
        });
        classified++;
    }

    console.log(`[conversations] ${pairs.length} pairs → ${classified} classified, ${discarded} discarded`);
    return result;
}

function loadDpoPairs(minScore = 1) {
    const dpoDir = path.join(ROOT, 'SOMA', 'training-data', 'dpo');
    if (!existsSync(dpoDir)) return { logos: [], aurora: [], prometheus: [], thalamus: [] };

    const result = { logos: [], aurora: [], prometheus: [], thalamus: [] };
    const files = readdirSync(dpoDir).filter(f => f.match(/^revision-pairs-.*\.jsonl$/));
    if (files.length === 0) return result;

    let total = 0, classified = 0, skipped = 0;

    for (const file of files) {
        const pairs = loadJsonlFile(path.join(dpoDir, file));
        total += pairs.length;
        for (const pair of pairs) {
            if (!pair.prompt || !pair.chosen || pair.chosen.length < 80) { skipped++; continue; }
            // Only include high-quality revisions (score threshold)
            if (typeof pair.score === 'number' && pair.score > 0.6) { skipped++; continue; }
            const messages = [
                { role: 'user', content: pair.prompt },
                { role: 'assistant', content: pair.chosen },
            ];
            const classification = classifyExample(messages, minScore);
            if (!classification) { skipped++; continue; }
            const fullMessages = [
                { role: 'system', content: LOBE_SYSTEM_PROMPTS[classification.lobe] },
                ...messages,
            ];
            result[classification.lobe].push({
                messages: fullMessages,
                _source: 'dpo_revision',
                _lobe: classification.lobe,
                _confidence: 0.95, // NEMESIS-vetted gold response
            });
            classified++;
        }
    }

    console.log(`[dpo_pairs] ${total} pairs → ${classified} gold SFT examples, ${skipped} skipped`);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MERGE + DEDUP + CLEAN
// ─────────────────────────────────────────────────────────────────────────────

function mergeAndDedup(datasets) {
    const result = {};
    for (const lobe of LOBES) {
        const seen = new Set();
        const clean = [];
        let dupes = 0;
        const sourceCounts = {};

        for (const ex of datasets[lobe]) {
            const normalizedMessages = normalizeMessages(ex);
            if (!normalizedMessages || !Array.isArray(normalizedMessages)) continue;

            const h = hashExample(normalizedMessages);
            if (seen.has(h)) { dupes++; continue; }
            seen.add(h);

            // Validate minimum quality: user + assistant both must have content
            const user = normalizedMessages.find(m => m.role === 'user');
            const asst = normalizedMessages.find(m => m.role === 'assistant');
            if (!user?.content?.trim() || !asst?.content?.trim()) continue;
            if (user.content.trim().length < 10 || asst.content.trim().length < 50) continue;

            // Ensure system prompt is the correct lobe prompt
            const msgs = normalizedMessages.some(m => m.role === 'system')
                ? normalizedMessages.map(m =>
                    m.role === 'system'
                        ? { role: 'system', content: LOBE_SYSTEM_PROMPTS[lobe] }
                        : m)
                : [{ role: 'system', content: LOBE_SYSTEM_PROMPTS[lobe] }, ...normalizedMessages];

            const src = ex._source || 'unknown';
            const qualityTier = ex.metadata?.qualityTier ||
                (src === 'seed' ? 'training_approved' : src === 'dpo_revision' ? 'nemesis_corrected' : 'reviewed');
            const policy = validateTrainingExample({
                instruction: user.content,
                response: asst.content,
                metadata: {
                    ...(ex.metadata || {}),
                    source: src,
                    qualityTier,
                    provider: ex.metadata?.actualProvider || ex.metadata?.provider,
                    model: ex.metadata?.actualModel || ex.metadata?.model,
                    lobe: lobe.toUpperCase()
                }
            });
            if (!policy.accepted) continue;
            sourceCounts[src] = (sourceCounts[src] || 0) + 1;

            clean.push({
                messages: msgs,
                metadata: {
                    ...policy.metadata,
                    source: src,
                    lobe: lobe.toUpperCase(),
                    confidence: ex._confidence || 0,
                }
            });
        }

        result[lobe] = { examples: clean, dupes, sourceCounts };
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINGLE_LOBE = args.includes('--lobe') ? args[args.indexOf('--lobe') + 1] : null;
const MIN_SCORE = args.includes('--min-score') ? parseInt(args[args.indexOf('--min-score') + 1]) : 1;
const INCLUDE_UNVERIFIED_CONVERSATIONS = args.includes('--include-unverified-conversations');
const TARGET_LOBES = SINGLE_LOBE ? [SINGLE_LOBE] : LOBES;

if (SINGLE_LOBE && !LOBES.includes(SINGLE_LOBE)) {
    console.error(`Unknown lobe: ${SINGLE_LOBE}. Choose from: ${LOBES.join(', ')}`);
    process.exit(1);
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║      SOMA Lobe Dataset Builder — Domain Starvation   ║');
console.log('╚══════════════════════════════════════════════════════╝\n');
console.log(`Min classifier score: ${MIN_SCORE} | Dry run: ${DRY_RUN} | Lobes: ${TARGET_LOBES.join(', ')}\n`);

// Load all sources
console.log('── Loading data sources ──');
const seeds = loadSeeds();
const lobeFiles = loadExistingLobeFiles();
const generic = loadGenericTraining(MIN_SCORE);
const conversations = INCLUDE_UNVERIFIED_CONVERSATIONS
    ? loadConversations(MIN_SCORE)
    : { logos: [], aurora: [], prometheus: [], thalamus: [] };
if (!INCLUDE_UNVERIFIED_CONVERSATIONS) {
    console.log('[conversations] raw conversation import disabled; use verified exports or pass --include-unverified-conversations explicitly');
}
const dpoPairs = loadDpoPairs(MIN_SCORE);

// Merge per lobe
const combined = {};
for (const lobe of LOBES) {
    combined[lobe] = [
        ...seeds[lobe],
        ...lobeFiles[lobe],
        ...generic[lobe],
        ...conversations[lobe],
        ...dpoPairs[lobe],
    ];
}

// Dedup and clean
const final = mergeAndDedup(combined);

// Print report
console.log('\n── Coverage Report ──────────────────────────────────────');
let grandTotal = 0;
for (const lobe of TARGET_LOBES) {
    const { examples, dupes, sourceCounts } = final[lobe];
    grandTotal += examples.length;
    console.log(`\n  ${lobe.toUpperCase().padEnd(12)} ${examples.length} examples  (${dupes} dupes removed)`);
    for (const [src, count] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${src.padEnd(45)} ${count}`);
    }
}
console.log(`\n  TOTAL: ${grandTotal} examples across ${TARGET_LOBES.length} lobes`);
console.log('──────────────────────────────────────────────────────\n');

if (DRY_RUN) {
    console.log('[dry-run] No files written.');
    process.exit(0);
}

// Write output
const outDir = path.join(ROOT, 'SOMA', 'training-data', 'FINAL');
await fs.mkdir(outDir, { recursive: true });

const ts = Date.now();
const written = [];

for (const lobe of TARGET_LOBES) {
    const { examples } = final[lobe];
    if (examples.length === 0) {
        console.warn(`[${lobe}] No examples — skipping write`);
        continue;
    }
    const outPath = path.join(outDir, `lobe-${lobe}-final-${ts}.jsonl`);
    const content = examples.map(ex => {
        // Strip internal metadata fields before writing
        const { messages, metadata } = ex;
        return JSON.stringify({ messages, metadata });
    }).join('\n');
    await fs.writeFile(outPath, content, 'utf8');
    written.push({ lobe, count: examples.length, path: outPath });
    console.log(`✅ ${lobe.padEnd(12)} ${examples.length} examples → ${path.relative(ROOT, outPath)}`);
}

console.log(`\nDone. ${written.length} lobe dataset${written.length !== 1 ? 's' : ''} written to SOMA/training-data/FINAL/`);
console.log('\nNext step: node scripts/generate-lobe-synthetic.mjs  (add synthetic examples to thin lobes)');
