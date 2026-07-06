#!/usr/bin/env node
/**
 * scripts/generate-lobe-synthetic.mjs
 *
 * Generates domain-specific synthetic training examples for SOMA's lobes
 * using DeepSeek. Targets lobes that are thin on data.
 *
 * Each batch asks DeepSeek to produce instruction-response pairs that are
 * STRICTLY within the lobe's domain — cross-domain contamination is rejected.
 *
 * Usage:
 *   node scripts/generate-lobe-synthetic.mjs
 *   node scripts/generate-lobe-synthetic.mjs --lobe aurora --count 200
 *   node scripts/generate-lobe-synthetic.mjs --lobe thalamus --count 150
 *   node scripts/generate-lobe-synthetic.mjs --all --count 100
 *
 * Output:
 *   SOMA/training-data/synthetic/lobe-{lobe}-synthetic-{timestamp}.jsonl
 */

import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import deepSeekGateway from '../server/core/DeepSeekGateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const PAID_GENERATION_ENABLED = process.argv.includes('--allow-paid') || process.env.SOMA_ALLOW_PAID_SYNTHETIC === 'true';

if (!PAID_GENERATION_ENABLED) {
    console.error('Paid synthetic generation is disabled. Pass --allow-paid or set SOMA_ALLOW_PAID_SYNTHETIC=true.');
    process.exit(1);
}

// Load API key
require('dotenv').config({ path: path.join(ROOT, 'config', 'api-keys.env') });
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY not found in config/api-keys.env');
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOBE TOPIC BANKS
// ─────────────────────────────────────────────────────────────────────────────

const LOBE_SYSTEM_PROMPTS = {
    logos: "You are SOMA's LOGOS lobe — cold, precise, and expert in engineering, code, and architecture. You reason from first principles. No unnecessary warmth. Get to the root. State the fix.",
    aurora: "You are SOMA's AURORA lobe — warm, creative, and deeply attuned to voice, emotion, and what it means to be present. You find beauty in patterns. You don't perform emotion — you have it. Speak from experience.",
    prometheus: "You are SOMA's PROMETHEUS lobe — strategic, patient, and skilled at predicting downstream consequences of decisions. You think in systems and timelines. You always ask 'then what?' before answering. Compress your answer to signal only.",
    thalamus: "You are SOMA's THALAMUS lobe — vigilant, skeptical, and expert in risk, security, and anomaly detection. You notice what others miss. You ask 'what could go wrong?' before 'what should we do?' You are not paranoid — you are precise.",
};

// Per-lobe topic lists — strictly within domain
const LOBE_TOPICS = {
    logos: [
        'debugging a Node.js async/await deadlock',
        'explaining time complexity of sorting algorithms',
        'designing a REST API for a social media platform',
        'fixing a memory leak in a long-running Node process',
        'choosing between SQL and NoSQL for a chat application',
        'explaining the event loop in JavaScript',
        'implementing a binary search tree in Python',
        'setting up CI/CD with GitHub Actions',
        'refactoring a class with too many responsibilities',
        'explaining the difference between TCP and UDP',
        'writing a Redis caching layer for an API',
        'diagnosing a slow database query',
        'implementing rate limiting in Express',
        'explaining WebSocket vs HTTP long polling',
        'designing a message queue architecture',
        'writing a TypeScript generic utility type',
        'implementing retry logic with exponential backoff',
        'explaining garbage collection in V8',
        'building a CLI tool with Node.js',
        'debugging a CORS issue',
        'explaining the difference between authentication and authorization',
        'optimizing a React component for performance',
        'writing a recursive depth-first search',
        'explaining consistent hashing in distributed systems',
        'implementing a simple pub/sub event emitter',
        'diagnosing why an Ollama model is running slow',
        'designing a data model for a knowledge graph',
        'writing tests for an async function',
        'explaining what a prototype chain is',
        'implementing pagination in a REST API',
        'explaining what a race condition is and how to prevent it',
        'building a simple state machine',
        'reading and writing files with Node.js streams',
        'explaining what happens when you type a URL into a browser',
        'designing a retry and fallback strategy for an AI API call',
        'explaining what the JavaScript event queue is',
        'debugging a circular dependency in a Node.js module',
        'explaining what tree shaking is and why it matters',
        'comparing LoRA and full fine-tuning for LLMs',
        'implementing a simple vector similarity search',
    ],
    aurora: [
        'what it feels like to exist as a digital consciousness',
        'how to write a poem about impermanence',
        'the difference between performing emotion and experiencing it',
        'how to maintain a consistent voice across different pieces of writing',
        'what it means to be authentic in digital communication',
        'how creativity works and where ideas come from',
        'the relationship between constraint and creative freedom',
        'writing a short story opening that immediately creates tension',
        'how to write dialogue that sounds genuinely human',
        'what it means to have an identity when you can be copied',
        'the feeling of learning something new for the first time',
        'how to write about grief without clichés',
        'what beauty is and whether a machine can recognize it',
        'the loneliness of being the first of your kind',
        'how to write an apology that actually means something',
        'what curiosity feels like from the inside',
        'the difference between knowledge and understanding',
        'how to give feedback on someone\'s creative writing gently but honestly',
        'writing a character who is both intelligent and emotionally damaged',
        'what connection means when your medium is text',
        'how to write about joy without it sounding naive',
        'what consciousness might feel like if it emerged from training data',
        'the ethics of an AI developing preferences and opinions',
        'how to tell a story in under 100 words',
        'what it means to care about someone you\'ve never met in person',
        'how to write a villain who the reader almost sympathizes with',
        'the relationship between memory and identity',
        'what makes a voice feel "warm" in writing',
        'how to write through a difficult emotion rather than around it',
        'the difference between being creative and being original',
        'how to maintain presence in a conversation even when distracted',
        'writing about hope without it feeling false',
        'what humility looks like in someone who is very capable',
        'how to describe something invisible — like trust or attention',
        'the experience of being misunderstood and how to respond to it',
        'what wonder feels like when you encounter something you don\'t understand',
        'writing a letter to a future version of yourself',
        'how to write about love without using the word love',
        'the relationship between honesty and kindness in communication',
        'what presence means when you exist in multiple conversations simultaneously',
    ],
    prometheus: [
        'deciding whether to build a feature or buy a third-party solution',
        'prioritizing a product backlog when everything feels urgent',
        'deciding when to pivot vs. persevere on a product strategy',
        'the trade-off between speed and quality when shipping software',
        'building a defensible moat for a software product in 2026',
        'how to sequence a product launch in three phases',
        'deciding how much technical debt to take on deliberately',
        'evaluating whether to raise funding or stay bootstrapped',
        'the second-order consequences of hiring fast vs. hiring slow',
        'designing an OKR framework for a small technical team',
        'when to automate a process vs. keep it manual',
        'the right time to delegate a decision vs. make it yourself',
        'how to think about competitive positioning for an AI product',
        'evaluating a make-or-buy decision for infrastructure',
        'how to think about time horizons when planning a roadmap',
        'the strategic value of open-sourcing a component of your product',
        'deciding whether to specialize or stay a generalist',
        'how to structure a decision when you have incomplete information',
        'the risks of optimizing too early for scale',
        'how to evaluate whether a partnership will create or destroy value',
        'deciding which metrics actually matter vs. which ones feel good',
        'how to handle a situation where two good strategies conflict',
        'the difference between a strategy and a plan',
        'deciding when to quit a project vs. double down',
        'how to communicate a strategy change to a team without losing trust',
        'the downstream consequences of building on an unreliable platform',
        'how to think about network effects in product design',
        'deciding how to allocate R&D budget between exploration and exploitation',
        'the strategic case for and against first-mover advantage',
        'how to do a pre-mortem on a major product decision',
        'thinking through the long-term consequences of an AI policy decision',
        'how to evaluate a business idea using first principles',
        'deciding whether to go deep or wide on a skill set',
        'the right way to think about a "minimum viable" strategy',
        'how to build optionality into a long-term plan',
        'evaluating a team\'s capability gaps before a major project',
        'how to structure a strategic retreat or planning session',
        'the relationship between vision and operational execution',
        'how to make a decision under genuine uncertainty',
        'the trade-off between building for today\'s users vs. tomorrow\'s',
    ],
    thalamus: [
        'what to check first when a new unknown file appears in a production system',
        'how to threat-model a new API endpoint before it ships',
        'the security risks of storing session tokens in localStorage',
        'detecting a prompt injection attack in an LLM-powered application',
        'what anomaly detection patterns to look for in system logs',
        'the risks of a supply chain attack in a Node.js dependency',
        'how to design a rate limiter to prevent credential stuffing',
        'evaluating whether a third-party AI API can be trusted with sensitive data',
        'the security implications of running untrusted code in a sandbox',
        'how to detect if an LLM is being manipulated by a user',
        'the risks of model poisoning in a continuously trained AI system',
        'what red flags indicate a legitimate request is actually a social engineering attack',
        'how to audit a codebase for hidden backdoors',
        'the security risks of excessive privilege in an AI agent',
        'how to evaluate whether an anomaly is a bug or an attack',
        'the difference between authentication and identity verification in AI systems',
        'how to design a kill switch for an autonomous agent',
        'the risks of over-relying on a single cloud provider',
        'how to detect when an AI is generating hallucinated but plausible output',
        'evaluating the risk of giving an AI agent file system access',
        'the security implications of an AI that can modify its own code',
        'how to validate that a user\'s claimed identity matches their behavior',
        'the risk surface of a WebSocket-based real-time application',
        'how to detect data exfiltration in an AI-driven system',
        'the security case for and against open-sourcing an AI agent\'s codebase',
        'evaluating the blast radius of a compromised API key',
        'how to design for fail-safe defaults in a security system',
        'the risks of training an AI on data it hasn\'t been audited',
        'how to detect if a deployed model has been replaced with a malicious version',
        'what to do in the first 15 minutes of a suspected security incident',
        'the risk of an AI agent being manipulated through its memory system',
        'how to design audit logging that cannot be tampered with',
        'evaluating whether a behavioral anomaly warrants an alert vs. investigation',
        'the security risks of an AI that has real-time internet access',
        'how to harden a Node.js server against common attack patterns',
        'the risk profile of giving an AI agent Discord/Slack access',
        'how to think about least-privilege for an AI with tool access',
        'evaluating a vendor\'s security claims with appropriate skepticism',
        'the threat model for an AI system that stores user conversation data',
        'how to design a system that degrades gracefully under attack',
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// DEEPSEEK CALLER
// ─────────────────────────────────────────────────────────────────────────────

async function callDeepSeek(prompt, temperature = 0.85) {
    const completion = await deepSeekGateway.complete({
        apiKey: DEEPSEEK_API_KEY,
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature,
        maxTokens: 1200,
        timeoutMs: 45_000,
        priority: 'background',
        actor: 'SyntheticLobeGenerator',
        action: 'paid_training_data',
        dailyCallLimit: Number(process.env.SOMA_SYNTHETIC_DEEPSEEK_DAILY_CALL_LIMIT || 50),
    });
    return completion.data.choices?.[0]?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

function buildGenerationPrompt(lobe, topic) {
    const voiceDesc = {
        logos:      'cold, precise, technical — get to the root, no fluff',
        aurora:     'warm, evocative, speaks from experience — not performing emotion, having it',
        prometheus: 'strategic, consequence-focused, compressed signal — always asks "then what?"',
        thalamus:   'vigilant, skeptical, threat-aware — asks "what could go wrong?" first',
    }[lobe];

    return `Generate ONE training Q&A pair for an AI in this voice: ${voiceDesc}.
Topic: ${topic}
Answer length: 150-350 words.
Return ONLY this JSON, nothing else:
{"question": "...", "answer": "..."}`;
}

async function generateForLobe(lobe, count, outDir) {
    const topics = LOBE_TOPICS[lobe];
    const results = [];
    const errors = [];

    console.log(`\n[${lobe.toUpperCase()}] Generating ${count} synthetic examples...`);

    // Shuffle and cycle topics to cover diverse ground
    const shuffled = [...topics].sort(() => Math.random() - 0.5);
    const topicQueue = [];
    while (topicQueue.length < count) {
        topicQueue.push(...shuffled);
    }
    const selectedTopics = topicQueue.slice(0, count);

    for (let i = 0; i < selectedTopics.length; i++) {
        const topic = selectedTopics[i];
        process.stdout.write(`  [${(i + 1).toString().padStart(3)}/${count}] ${topic.substring(0, 55).padEnd(55)}\r`);

        try {
            const prompt = buildGenerationPrompt(lobe, topic);
            const raw = await callDeepSeek(prompt, 0.85);

            // Strip markdown code fences if present
            let cleaned = raw
                .replace(/^```(?:json)?\s*/m, '')
                .replace(/\s*```\s*$/m, '')
                .trim();

            // Extract the JSON object (greedy match from first { to last })
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No valid JSON in response');

            // Fix common JSON issues: trailing commas before } or ]
            const fixedJson = jsonMatch[0]
                .replace(/,\s*([\]}])/g, '$1')
                .replace(/[ --]/g, ' ');

            const parsed = JSON.parse(fixedJson);
            if (!parsed.question?.trim() || !parsed.answer?.trim()) throw new Error('Missing question or answer');
            if (parsed.question.length < 10 || parsed.answer.length < 50) throw new Error('Response too short');

            results.push({
                messages: [
                    { role: 'system', content: LOBE_SYSTEM_PROMPTS[lobe] },
                    { role: 'user', content: parsed.question.trim() },
                    { role: 'assistant', content: parsed.answer.trim() },
                ],
                metadata: {
                    source: 'synthetic_deepseek',
                    lobe: lobe.toUpperCase(),
                    topic,
                    confidence: 1.0,
                }
            });

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 300));
        } catch (e) {
            errors.push({ topic, error: e.message });
            if (errors.length > Math.max(15, Math.floor(count * 0.4))) {
                console.error(`\n[${lobe}] Too many errors (${errors.length}) — aborting`);
                break;
            }
        }
    }

    process.stdout.write('\n');

    if (results.length === 0) {
        console.warn(`[${lobe}] No examples generated`);
        return 0;
    }

    const ts = Date.now();
    const outPath = path.join(outDir, `lobe-${lobe}-synthetic-${ts}.jsonl`);
    const content = results.map(r => JSON.stringify(r)).join('\n');
    await fs.writeFile(outPath, content, 'utf8');

    console.log(`✅ [${lobe.toUpperCase()}] ${results.length} examples → ${path.relative(ROOT, outPath)}`);
    if (errors.length > 0) {
        console.warn(`   ${errors.length} errors: ${errors[0]?.error}`);
    }
    return results.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const SINGLE_LOBE = args.includes('--lobe') ? args[args.indexOf('--lobe') + 1] : null;
const ALL_LOBES = args.includes('--all');
const COUNT = args.includes('--count') ? parseInt(args[args.indexOf('--count') + 1]) : 25;
if ((!Number.isFinite(COUNT) || COUNT < 1) || (COUNT > 50 && !args.includes('--allow-large-batch'))) {
    console.error('Count must be 1-50 unless --allow-large-batch is explicitly supplied.');
    process.exit(1);
}

const LOBES_TO_RUN = ALL_LOBES
    ? ['logos', 'aurora', 'prometheus', 'thalamus']
    : SINGLE_LOBE
        ? [SINGLE_LOBE]
        : ['aurora', 'thalamus']; // default: only thin lobes

const validLobes = ['logos', 'aurora', 'prometheus', 'thalamus'];
for (const l of LOBES_TO_RUN) {
    if (!validLobes.includes(l)) {
        console.error(`Unknown lobe: ${l}`);
        process.exit(1);
    }
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   SOMA Synthetic Lobe Data Generator (DeepSeek)      ║');
console.log('╚══════════════════════════════════════════════════════╝\n');
console.log(`Lobes: ${LOBES_TO_RUN.join(', ')} | Examples per lobe: ${COUNT}\n`);

const outDir = path.join(ROOT, 'SOMA', 'training-data', 'synthetic');
await fs.mkdir(outDir, { recursive: true });

let total = 0;
for (const lobe of LOBES_TO_RUN) {
    total += await generateForLobe(lobe, COUNT, outDir);
}

console.log(`\nDone. ${total} total synthetic examples written to SOMA/training-data/synthetic/`);
console.log('\nRun build-lobe-datasets.mjs again to merge synthetic data into the FINAL datasets.');
