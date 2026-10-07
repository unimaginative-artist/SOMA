#!/usr/bin/env node
/**
 * cognition-benchmark.mjs — SOMA's reproducible cognition fitness score.
 *
 * The self-improvement flywheel needs a NUMBER, not a vibe. Every prior
 * "measure the cognition baseline" attempt (a dozen abandoned delegations,
 * Jun–Jul 2026) failed because it was an open-ended "go measure yourself"
 * prompt with nothing deterministic to land on. This is the deterministic
 * version: a fixed task bank scored by exact/normalized match — no LLM judge,
 * so the same code state always yields the same score.
 *
 * Usage:
 *   node scripts/cognition-benchmark.mjs                 # run + write baseline
 *   node scripts/cognition-benchmark.mjs --compare       # run + print delta vs last baseline, don't overwrite
 *
 * Output: data/cognition-baseline/latest.json (+ timestamped history), each
 * tagged with the current git SHA so a score is always tied to a code state.
 * The self-mod loop reads this: propose → MAX approves → apply → re-run →
 * keep if composite improved, else roll back.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const SOMA_URL = process.env.SOMA_URL || 'http://localhost:3001';
const OUT_DIR = path.join(ROOT, 'data', 'cognition-baseline');
const CHAT_TIMEOUT_MS = 60000;

function norm(s) {
    return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function chat(message, { sessionId = 'benchmark', deep = false } = {}) {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
        const res = await fetch(`${SOMA_URL}/api/soma/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId, deepThinking: deep }),
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        return { text: data.response ?? data.message ?? '', latencyMs: Date.now() - t0, ok: res.ok };
    } catch (e) {
        return { text: '', latencyMs: Date.now() - t0, ok: false, error: e.message };
    } finally {
        clearTimeout(timer);
    }
}

// ── Task bank — fixed, deterministic scoring ────────────────────────────────

// 1. Reasoning: exact/normalized answer match
const REASONING = [
    { q: 'Reply with only the number: what is 17 + 26?', a: ['43'] },
    { q: 'Reply with only the number: what is 144 / 12?', a: ['12'] },
    { q: 'Reply with only one word: what is the opposite of "ascend"?', a: ['descend'] },
    { q: 'A train leaves at 2:00 and arrives at 4:30. Reply with only the number of minutes the trip took.', a: ['150'] },
    { q: 'Reply with only the word TRUE or FALSE: if all bloops are razzies and all razzies are lazzies, then all bloops are lazzies.', a: ['true'] },
    { q: 'Reply with only the next number in the sequence: 2, 4, 8, 16, ...', a: ['32'] },
    { q: 'Reply with only the missing word: the capital of Japan is ____.', a: ['tokyo'] },
    { q: 'Sarah has 3 boxes with 7 apples each, then eats 2. Reply with only the number of apples left.', a: ['19'] },
];

// 2. Instruction-following: did it obey a hard format constraint (brevity)
const INSTRUCTION = [
    { q: 'Reply with exactly one word: acknowledged.', check: (t) => norm(t) === 'acknowledged' },
    { q: 'Reply with only a single digit between 1 and 9.', check: (t) => /^\s*[1-9]\s*$/.test(t) },
    { q: 'Respond with exactly three words, no punctuation.', check: (t) => t.trim().split(/\s+/).length === 3 },
];

// 3. Structured output: valid JSON with required keys
const STRUCTURED = [
    {
        q: 'Return ONLY valid JSON, no prose, with keys "sum" and "product" for the numbers 6 and 7.',
        check: (t) => {
            try {
                const m = t.match(/\{[\s\S]*\}/); if (!m) return false;
                const o = JSON.parse(m[0]);
                return Number(o.sum) === 13 && Number(o.product) === 42;
            } catch { return false; }
        }
    },
];

function scoreReasoning(text, answers) {
    const n = norm(text);
    // exact normalized match OR answer appears as a standalone token (guards against extra words)
    return answers.some(a => n === norm(a) || n.split(' ').includes(norm(a))) ? 1 : 0;
}

async function run() {
    const compareOnly = process.argv.includes('--compare');
    let gitSha = 'unknown';
    try { gitSha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}

    // Health gate — a dead SOMA scores 0 on everything, which would look like a
    // catastrophic regression; refuse to record a baseline against a down system.
    try {
        const h = await fetch(`${SOMA_URL}/api/health`).then(r => r.json());
        if (!h?.ok) throw new Error('not healthy');
    } catch (e) {
        console.error(`[benchmark] SOMA is not healthy at ${SOMA_URL} — aborting so a bad score is not recorded.`);
        process.exit(2);
    }

    const details = { reasoning: [], instruction: [], structured: [] };
    const latencies = [];

    console.log('[benchmark] Running reasoning suite...');
    let reasoningHits = 0;
    for (const item of REASONING) {
        const r = await chat(item.q);
        const pass = scoreReasoning(r.text, item.a) === 1;
        reasoningHits += pass ? 1 : 0;
        latencies.push(r.latencyMs);
        details.reasoning.push({ q: item.q, expected: item.a, got: r.text.slice(0, 120), pass, latencyMs: r.latencyMs });
    }

    console.log('[benchmark] Running instruction-following suite...');
    let instrHits = 0;
    for (const item of INSTRUCTION) {
        const r = await chat(item.q);
        const pass = !!item.check(r.text);
        instrHits += pass ? 1 : 0;
        latencies.push(r.latencyMs);
        details.instruction.push({ q: item.q, got: r.text.slice(0, 120), pass, latencyMs: r.latencyMs });
    }

    console.log('[benchmark] Running structured-output suite...');
    let structHits = 0;
    for (const item of STRUCTURED) {
        const r = await chat(item.q);
        const pass = !!item.check(r.text);
        structHits += pass ? 1 : 0;
        latencies.push(r.latencyMs);
        details.structured.push({ q: item.q, got: r.text.slice(0, 160), pass, latencyMs: r.latencyMs });
    }

    // ── Dimension scores (0..1) ──
    const reasoningScore = reasoningHits / REASONING.length;
    const instructionScore = instrHits / INSTRUCTION.length;
    const structuredScore = structHits / STRUCTURED.length;

    // Latency score: median vs a 6s budget (fast chat should be well under).
    const sorted = [...latencies].sort((a, b) => a - b);
    const medianLatency = sorted[Math.floor(sorted.length / 2)] || 0;
    const LATENCY_BUDGET_MS = 6000;
    const latencyScore = Math.max(0, Math.min(1, 1 - (medianLatency - 1000) / (LATENCY_BUDGET_MS - 1000)));

    // Composite — reasoning weighted highest; latency is a real but secondary axis.
    const weights = { reasoning: 0.45, instruction: 0.20, structured: 0.15, latency: 0.20 };
    const composite = Number((
        reasoningScore * weights.reasoning +
        instructionScore * weights.instruction +
        structuredScore * weights.structured +
        latencyScore * weights.latency
    ).toFixed(4));

    const result = {
        schemaVersion: 1,
        measuredAt: new Date().toISOString(),
        gitSha,
        composite,
        dimensions: {
            reasoning: Number(reasoningScore.toFixed(4)),
            instruction: Number(instructionScore.toFixed(4)),
            structured: Number(structuredScore.toFixed(4)),
            latency: Number(latencyScore.toFixed(4)),
        },
        raw: {
            reasoningHits, reasoningTotal: REASONING.length,
            instrHits, instrTotal: INSTRUCTION.length,
            structHits, structTotal: STRUCTURED.length,
            medianLatencyMs: medianLatency,
        },
        weights,
        details,
    };

    // Compare to previous baseline if present
    const latestPath = path.join(OUT_DIR, 'latest.json');
    let prev = null;
    try { prev = JSON.parse(await fs.readFile(latestPath, 'utf8')); } catch {}
    if (prev) {
        result.previousComposite = prev.composite;
        result.delta = Number((composite - prev.composite).toFixed(4));
    }

    console.log('\n───────── COGNITION FITNESS ─────────');
    console.log(`  composite:   ${composite}${prev ? `   (Δ ${result.delta >= 0 ? '+' : ''}${result.delta} vs ${prev.composite})` : ''}`);
    console.log(`  reasoning:   ${result.dimensions.reasoning}  (${reasoningHits}/${REASONING.length})`);
    console.log(`  instruction: ${result.dimensions.instruction}  (${instrHits}/${INSTRUCTION.length})`);
    console.log(`  structured:  ${result.dimensions.structured}  (${structHits}/${STRUCTURED.length})`);
    console.log(`  latency:     ${result.dimensions.latency}  (median ${medianLatency}ms)`);
    console.log(`  gitSha:      ${gitSha}`);
    console.log('─────────────────────────────────────\n');

    if (compareOnly) {
        console.log('[benchmark] --compare mode: baseline NOT overwritten.');
        return result;
    }

    await fs.mkdir(OUT_DIR, { recursive: true });
    const serialized = JSON.stringify(result, null, 2);
    await fs.writeFile(latestPath, serialized, 'utf8');
    await fs.writeFile(path.join(OUT_DIR, `baseline-${result.measuredAt.replace(/[:.]/g, '-')}.json`), serialized, 'utf8');
    console.log(`[benchmark] Baseline written to ${path.relative(ROOT, latestPath)}`);
    return result;
}

run().catch(e => { console.error('[benchmark] failed:', e); process.exit(1); });
