#!/usr/bin/env node
/**
 * lobe-benchmark.mjs — does the LoRA training actually buy expertise?
 *
 * The honest test of Barry's onion: a trained local lobe is only real substrate
 * if it BEATS the base model it was fine-tuned from on its own domain. If it
 * doesn't, the training was theatre with extra steps.
 *
 * For each lobe we ask domain questions with OBJECTIVE, checkable answers (no
 * LLM judge — that would just be theatre judging theatre) and score the trained
 * lobe vs an untrained baseline of the same size. Local-only via Ollama: free,
 * fast, reproducible.
 *
 * Usage: node scripts/lobe-benchmark.mjs
 */

const OLLAMA = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
// Baselines: same-class small models the lobes were distilled from / compare to.
const BASELINES = ['nemotron-mini:latest', 'gemma3:4b'];

const SUITES = {
    'soma-logos': [ // logic / code / engineering
        { q: 'Time complexity of binary search on a sorted array? Answer with only the big-O notation.', a: ['o(log n)', 'olog n', 'log n'] },
        { q: 'What concurrency bug happens when two threads write shared state without a lock? One or two words.', a: ['race condition', 'race'] },
        { q: 'In Big-O, which is faster for large n: O(n log n) or O(n^2)? Answer with just the notation.', a: ['o(n log n)', 'n log n'] },
        { q: 'What data structure gives O(1) average lookup by key? One word.', a: ['hash', 'hashmap', 'hash table', 'dictionary', 'map'] },
        { q: 'What does the SOLID "S" stand for? One phrase.', a: ['single responsibility'] },
        { q: 'Reply with only the result: 2 to the power of 10.', a: ['1024'] },
    ],
    'soma-thalamus': [ // security / risk
        { q: 'Default TCP port for HTTPS? Number only.', a: ['443'] },
        { q: 'HTTP status code for Unauthorized? Number only.', a: ['401'] },
        { q: 'Attack that injects malicious SQL via unsanitized input? Name it, short.', a: ['sql injection', 'sqli'] },
        { q: 'What does the C in the CIA security triad stand for? One word.', a: ['confidentiality'] },
        { q: 'Attack that floods a service to make it unavailable? Acronym.', a: ['dos', 'ddos'] },
        { q: 'Storing passwords, you should hash and also add a random ___? One word.', a: ['salt'] },
    ],
    'soma-prometheus': [ // strategy / game theory
        { q: 'In the prisoner\'s dilemma, what is the dominant strategy for a single round? One word.', a: ['defect', 'defection', 'betray'] },
        { q: 'A situation where no player can improve by changing strategy alone is a ___ equilibrium. One word.', a: ['nash'] },
        { q: 'Buy low, sell high exploits what market inefficiency? One word.', a: ['arbitrage', 'mispricing'] },
        { q: 'A repeated-game strategy that copies the opponent\'s last move? Name it.', a: ['tit for tat', 'tit-for-tat'] },
        { q: 'Diversifying to reduce risk relies on assets being ___ correlated (high or low)? One word.', a: ['low', 'negatively', 'uncorrelated'] },
    ],
    'soma-aurora': [ // creative / literary / music
        { q: 'A 14-line poem is called a ___? One word.', a: ['sonnet'] },
        { q: 'Repetition of initial consonant sounds is called ___? One word.', a: ['alliteration'] },
        { q: 'How many lines in a haiku? Number only.', a: ['3', 'three'] },
        { q: 'A comparison using "like" or "as" is a ___? One word.', a: ['simile'] },
        { q: 'The emotional tone of a piece of writing is its ___? One word.', a: ['mood', 'tone', 'atmosphere'] },
    ],
};

function norm(s) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function hit(text, answers) {
    const n = norm(text);
    return answers.some(a => n === norm(a) || n.includes(norm(a))) ? 1 : 0;
}

async function ask(model, prompt) {
    try {
        const res = await fetch(`${OLLAMA}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.1, num_predict: 40 } }),
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) return { text: '', err: `HTTP ${res.status}` };
        const j = await res.json();
        return { text: (j.response || '').trim() };
    } catch (e) { return { text: '', err: e.message }; }
}

async function available() {
    try { const j = await (await fetch(`${OLLAMA}/api/tags`)).json(); return (j.models || []).map(m => m.name); }
    catch { return []; }
}

async function scoreModel(model, suite) {
    let hits = 0; const detail = [];
    for (const item of suite) {
        const r = await ask(model, item.q);
        const ok = hit(r.text, item.a);
        hits += ok;
        detail.push({ q: item.q.slice(0, 50), got: r.text.slice(0, 40).replace(/\n/g, ' '), ok, err: r.err });
    }
    return { hits, total: suite.length, pct: Number((hits / suite.length * 100).toFixed(0)), detail };
}

async function run() {
    const models = await available();
    if (!models.length) { console.error('Ollama not reachable'); process.exit(2); }
    const baseline = BASELINES.find(b => models.some(m => m === b || m.startsWith(b.split(':')[0]))) || null;
    console.log(`[lobe-bench] baseline model: ${baseline || 'NONE FOUND'}\n`);

    const summary = [];
    for (const [lobe, suite] of Object.entries(SUITES)) {
        const lobeModel = models.find(m => m === lobe || m.startsWith(lobe + ':')) || (models.includes(`${lobe}-q4:latest`) ? `${lobe}-q4:latest` : null);
        if (!lobeModel) { console.log(`${lobe}: NOT REGISTERED — skipped`); continue; }

        const trained = await scoreModel(lobeModel, suite);
        const base = baseline ? await scoreModel(baseline, suite) : { pct: null };
        const delta = base.pct != null ? trained.pct - base.pct : null;
        summary.push({ lobe, lobeModel, trainedPct: trained.pct, baselinePct: base.pct, delta });

        console.log(`── ${lobe} (${lobeModel}) ─────────────────────────`);
        console.log(`   trained lobe:  ${trained.hits}/${trained.total}  (${trained.pct}%)`);
        if (base.pct != null) console.log(`   base ${baseline}: ${base.hits}/${base.total}  (${base.pct}%)   Δ ${delta >= 0 ? '+' : ''}${delta}pts`);
        for (const d of trained.detail) console.log(`     ${d.ok ? '✅' : '❌'} "${d.q}..." → "${d.got}"${d.err ? ' [' + d.err + ']' : ''}`);
        console.log('');
    }

    console.log('════════ VERDICT ════════');
    for (const s of summary) {
        const v = s.delta == null ? 'no baseline' : s.delta > 0 ? `TRAINING HELPS (+${s.delta}pts)` : s.delta === 0 ? 'no gain' : `WORSE (${s.delta}pts)`;
        console.log(`  ${s.lobe.padEnd(16)} trained ${String(s.trainedPct).padStart(3)}%  vs base ${String(s.baselinePct).padStart(3)}%  → ${v}`);
    }
}

run().catch(e => { console.error(e); process.exit(1); });
