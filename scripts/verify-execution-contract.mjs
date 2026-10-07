import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const suites = [
    'execution-boundary-regressions', 'agentic-execution-protocol', 'execution-job-lifecycle',
    'discord-execution-followthrough', 'cognitive-runtime', 'chat-runtime-adapter',
    'soma-agentic-executor-continuation', 'agentic-execution-hardening', 'execution-harness',
    'self-evolution-execution', 'self-evolution-research', 'discord-conversation-boundaries',
    'discord-conversation-adapter', 'discord-task-router', 'discord-operational-evidence',
    'discord-actionable-goal', 'discord-reliability-upgrades'
].map(name => `tests/${name}.test.mjs`);
const sources = [
    'core/ExecutionProtocol.js', 'core/InspectionExecution.js', 'core/SomaAgenticExecutor.js',
    'core/CognitiveRuntime.js', 'core/CognitiveMoERouter.js', 'arbiters/DiscordArbiter.js',
    'server/routes/executeRoute.js', 'server/routes/somaRoutes.js', 'server/loaders/routes.js',
    'server/discord/DiscordWorkspaceFiles.js', 'scripts/verify-execution-contract.mjs', ...suites
];
const { NODE_TEST_CONTEXT: ignored, ...env } = process.env;
const run = args => spawnSync(process.execPath, args, { cwd: process.cwd(), env, windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
const directory = path.resolve('data/repair-verification');
await fs.mkdir(directory, { recursive: true });
const stem = path.join(directory, `execution-contract-${Date.now()}`);
const checked = sources.map(file => { const result = run(['--check', file]); return { file, passed: result.status === 0, error: result.stderr || result.error?.message || null }; });
const result = run(['--test', '--test-force-exit', '--test-reporter=spec', '--test-concurrency=1', ...suites]);
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
await fs.writeFile(`${stem}.log`, output);
const count = label => Number([...output.matchAll(new RegExp(`ℹ ${label} (\\d+)`, 'g'))].at(-1)?.[1] || 0);
const receipt = { at: new Date().toISOString(), suites, syntax: checked, tests: { exitCode: result.status, total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') },
    lint: { status: 'not_configured', reason: 'No root/server lint script or repository ESLint configuration; syntax and diff whitespace checks are separate.' }, log: `${stem}.log` };
if (process.argv.includes('--live')) {
    try {
    const { ensureOperatorCredential } = await import('../server/loaders/operatorCredential.js');
    const url = 'http://127.0.0.1:3001/api/execute';
    const unauthorized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'read core/ExecutionProtocol.js' }), signal: AbortSignal.timeout(15000) });
    // Do not print credentials or send a test message to Discord.
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operator-Token': ensureOperatorCredential() },
        body: JSON.stringify({ task: 'read core/ExecutionProtocol.js', mode: 'inspect', sync: true }), signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    receipt.live = { unauthorizedStatus: unauthorized.status, httpStatus: response.status, response: body,
        passed: unauthorized.status === 401 && response.status === 200 && body.state === 'completed' && body.verification?.passed === true && body.toolsUsed?.includes('read_file') };
    } catch (error) {
        receipt.live = { passed: false, response: {}, error: error.cause?.code || error.message };
    }
}
receipt.passed = result.status === 0 && checked.every(r => r.passed) && (!receipt.live || receipt.live.passed);
await fs.writeFile(`${stem}.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ receipt: `${stem}.json`, passed: receipt.passed, syntax: `${checked.filter(c => c.passed).length}/${checked.length}`, tests: receipt.tests,
    live: receipt.live ? { passed: receipt.live.passed, state: receipt.live.response.state, jobId: receipt.live.response.jobId } : 'not_requested' }, null, 2));
process.exitCode = receipt.passed ? 0 : 1;
