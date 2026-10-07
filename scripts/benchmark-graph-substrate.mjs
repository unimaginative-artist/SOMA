import fs from 'fs/promises';
import path from 'path';

const BASE_URL = process.env.SOMA_BENCHMARK_URL || 'http://127.0.0.1:3001';
const DEVICE_ID = 'graph-substrate-benchmark';
const TIMEOUT_MS = Number(process.env.SOMA_BENCHMARK_TIMEOUT_MS || 75_000);

const cases = [
    {
        id: 'cognitive-runtime-routing',
        question: 'How do SomaCT, SomaServiceBridge, and CognitiveRuntime connect in the current chat request flow? Answer concisely.',
        facts: [
            ['somact'],
            ['somaservicebridge'],
            ['/api/soma/chat', 'api', 'chat endpoint'],
            ['cognitiveruntime'],
            ['classif', 'routing', 'route']
        ],
        sources: ['frontend/apps/command-ct/somact.jsx', 'frontend/apps/command-ct/services/somaservicebridge.js', 'core/cognitiveruntime.js']
    },
    {
        id: 'ct-conversation-persistence',
        question: 'How does the current SOMA CT implementation persist and retrieve conversations across restarts? Answer concisely.',
        facts: [
            ['sqlite'],
            ['ctconversationstore'],
            ['ctroutes', '/api/soma/ct'],
            ['message', 'conversation'],
            ['search', 'branch']
        ],
        sources: ['server/services/ctconversationstore.js', 'server/routes/ctroutes.js']
    },
    {
        id: 'trading-lane-protection',
        question: 'What prevents trading requests in Soma from being handled by the generic agentic executor? Answer concisely.',
        facts: [
            ['trading'],
            ['specialist'],
            ['specialistregistry', 'registry'],
            ['risk', 'performance guard', 'tradingperformanceguard'],
            ['generic', 'agentic']
        ],
        sources: ['core/cognitiveruntime.js', 'core/specialistregistry.js']
    }
];

function normalizedPath(value = '') {
    return String(value).replace(/\\/g, '/').toLowerCase();
}

function score(result, benchmarkCase) {
    const answer = String(result.answer || '').toLowerCase();
    const factHits = benchmarkCase.facts.map(group => group.some(term => answer.includes(term.toLowerCase())));
    const graph = result.metadata?.graphRetrieval || {};
    const retrievedSources = (graph.sources || []).map(source => normalizedPath(source.file));
    const sourceHits = benchmarkCase.sources.map(expected => retrievedSources.some(actual => actual.includes(expected)));
    return {
        completed: Boolean(result.answer) && !result.error,
        factHits,
        factCoverage: factHits.filter(Boolean).length / benchmarkCase.facts.length,
        graphUsed: graph.used === true,
        graphNodeCount: graph.nodeCount || 0,
        graphEdgeCount: graph.edgeCount || 0,
        graphLatencyMs: graph.latencyMs || 0,
        sourceHits,
        sourceCoverage: sourceHits.filter(Boolean).length / benchmarkCase.sources.length,
        sourceCount: retrievedSources.length
    };
}

async function chat(benchmarkCase, mode) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const startedAt = Date.now();
    try {
        const response = await fetch(`${BASE_URL}/api/soma/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-studio-device-id': DEVICE_ID },
            signal: controller.signal,
            body: JSON.stringify({
                message: benchmarkCase.question,
                stream: true,
                deepThinking: false,
                graphRetrievalMode: mode,
                sessionId: `graph-bench-${benchmarkCase.id}-${mode}-${Date.now()}`
            })
        });
        const raw = await response.text();
        const events = raw.split(/\r?\n\r?\n/).filter(Boolean).map(frame => {
            const line = frame.split(/\r?\n/).find(value => value.startsWith('data:'));
            try { return JSON.parse(line?.slice(5).trim()); } catch { return { invalid: true }; }
        });
        const done = events.findLast(event => event.done);
        const failure = events.findLast(event => event.error || event.timeout);
        return {
            mode,
            httpStatus: response.status,
            durationMs: Date.now() - startedAt,
            answer: done?.response || done?.message || '',
            metadata: done?.metadata || {},
            progressMessages: events.filter(event => event.progress).map(event => event.message),
            error: failure?.error || failure?.response || (!done ? 'missing_completion_frame' : null)
        };
    } catch (error) {
        return { mode, durationMs: Date.now() - startedAt, answer: '', metadata: {}, progressMessages: [], error: error.name === 'AbortError' ? 'client_timeout' : error.message };
    } finally {
        clearTimeout(timer);
    }
}

function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const results = [];
for (const benchmarkCase of cases) {
    for (const mode of ['off', 'force']) {
        const result = await chat(benchmarkCase, mode);
        result.score = score(result, benchmarkCase);
        results.push({ caseId: benchmarkCase.id, question: benchmarkCase.question, ...result });
        process.stdout.write(`${benchmarkCase.id} ${mode}: coverage=${(result.score.factCoverage * 100).toFixed(0)}% graph=${result.score.graphUsed} duration=${result.durationMs}ms${result.error ? ` error=${result.error}` : ''}\n`);
    }
}

const byMode = Object.fromEntries(['off', 'force'].map(mode => {
    const rows = results.filter(result => result.mode === mode);
    return [mode, {
        trials: rows.length,
        completionRate: average(rows.map(row => row.score.completed ? 1 : 0)),
        meanFactCoverage: average(rows.map(row => row.score.factCoverage)),
        meanSourceCoverage: average(rows.map(row => row.score.sourceCoverage)),
        meanDurationMs: average(rows.map(row => row.durationMs)),
        meanGraphLatencyMs: average(rows.map(row => row.score.graphLatencyMs)),
        graphUseRate: average(rows.map(row => row.score.graphUsed ? 1 : 0))
    }];
}));

const report = {
    generatedAt: new Date().toISOString(),
    methodology: 'Single-run live A/B diagnostic. Fact coverage is deterministic expected-term coverage, not a complete semantic accuracy judgment.',
    baseUrl: BASE_URL,
    cases: cases.length,
    summary: byMode,
    delta: {
        factCoverage: byMode.force.meanFactCoverage - byMode.off.meanFactCoverage,
        sourceCoverage: byMode.force.meanSourceCoverage - byMode.off.meanSourceCoverage,
        durationMs: byMode.force.meanDurationMs - byMode.off.meanDurationMs
    },
    results
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.resolve('Artifacts');
await fs.mkdir(artifactDir, { recursive: true });
const jsonPath = path.join(artifactDir, `graph-substrate-benchmark-${stamp}.json`);
const markdownPath = path.join(artifactDir, `graph-substrate-benchmark-${stamp}.md`);
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

const pct = value => `${(value * 100).toFixed(1)}%`;
const lines = [
    '# Graph Cognitive Substrate A/B Benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '> Single-run live diagnostic. Expected-term coverage is a reproducible proxy, not a complete factual-accuracy score.',
    '',
    '| Mode | Completion | Fact coverage | Source coverage | Mean duration | Graph latency | Graph use |',
    '|---|---:|---:|---:|---:|---:|---:|',
    `| LLM only | ${pct(byMode.off.completionRate)} | ${pct(byMode.off.meanFactCoverage)} | ${pct(byMode.off.meanSourceCoverage)} | ${Math.round(byMode.off.meanDurationMs)} ms | ${Math.round(byMode.off.meanGraphLatencyMs)} ms | ${pct(byMode.off.graphUseRate)} |`,
    `| Graph grounded | ${pct(byMode.force.completionRate)} | ${pct(byMode.force.meanFactCoverage)} | ${pct(byMode.force.meanSourceCoverage)} | ${Math.round(byMode.force.meanDurationMs)} ms | ${Math.round(byMode.force.meanGraphLatencyMs)} ms | ${pct(byMode.force.graphUseRate)} |`,
    '',
    `Fact coverage delta: ${(report.delta.factCoverage * 100).toFixed(1)} percentage points.`,
    `Source coverage delta: ${(report.delta.sourceCoverage * 100).toFixed(1)} percentage points.`,
    `Latency delta: ${Math.round(report.delta.durationMs)} ms.`,
    '',
    '## Trials',
    ...results.flatMap(result => [
        '',
        `### ${result.caseId} — ${result.mode === 'force' ? 'Graph grounded' : 'LLM only'}`,
        '',
        `- Completed: ${result.score.completed}`,
        `- Fact coverage: ${pct(result.score.factCoverage)}`,
        `- Graph used: ${result.score.graphUsed}`,
        `- Sources: ${result.score.sourceCount}`,
        `- Duration: ${result.durationMs} ms`,
        result.error ? `- Error: ${result.error}` : '',
        '',
        result.answer || '_No answer_'
    ].filter(Boolean))
];
await fs.writeFile(markdownPath, lines.join('\n'));
process.stdout.write(`${JSON.stringify({ summary: byMode, delta: report.delta, jsonPath, markdownPath }, null, 2)}\n`);
