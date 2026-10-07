import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-repair-regressions-'));
const cwd = path.join(temporary, 'SOMA');
await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
await fs.copyFile(path.join(root, 'package.json'), path.join(cwd, 'package.json'));
await fs.copyFile(path.join(root, 'tests/agency-proving-ground.test.cjs'), path.join(cwd, 'tests/agency-proving-ground.test.cjs'));
for (const file of ['server/loaders/extended.js', 'server/loaders/routes.js', 'server/routes/somaRoutes.js',
    'frontend/apps/command-bridge/panels/Cluster/ClusterOperations.jsx']) {
    await fs.mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await fs.copyFile(path.join(root, file), path.join(cwd, file));
}
const allSuites = [
    'max-repair-availability.test.mjs',
    'self-repair-lifecycle.test.mjs', 'self-modification-governance.test.mjs', 'self-modification-safety.test.mjs',
    'self-evolution-director.test.mjs', 'self-evolution-execution.test.mjs', 'asi-kernel-closed-loop.test.mjs',
    'self-evolution-research.test.mjs',
    'deepseek-gateway.test.mjs', 'deepseek-budget-routing.test.mjs',
    'max-requested-execution.test.mjs', 'max-cluster-bridge.test.mjs', 'goal-verification-contract.test.cjs',
    'soma-agentic-executor-continuation.test.mjs', 'goal-executor-watchdog.test.mjs',
    'improvement-scorecard.test.mjs', 'improvement-scorecard-wiring.test.mjs',
    'discord-task-router.test.mjs', 'discord-conversation-boundaries.test.mjs', 'discord-reliability-upgrades.test.mjs',
    'discord-operational-evidence.test.mjs', 'discord-execution-followthrough.test.mjs', 'discord-conversation-adapter.test.mjs',
    'paper-risk-scope.test.mjs', 'trading-resume-intent.test.mjs', 'autonomous-mission-director.test.cjs',
];
const suites = process.argv.includes('--discord') ? allSuites.filter(file => file.startsWith('discord-')) : allSuites;
try {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    let output = '';
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=120000', ...suites.map(file => path.join(root, 'tests', file))], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        child.stdout.on('data', bytes => { output += bytes; });
        child.stderr.on('data', bytes => { output += bytes; });
        child.on('error', reject); child.on('exit', code => resolve(code));
    });
    const report = path.join(root, 'data/repair-verification', `regressions-${Date.now()}.log`);
    await fs.mkdir(path.dirname(report), { recursive: true });
    await fs.writeFile(report, output);
    console.log(output.split(/\r?\n/).slice(code ? -80 : -12).join('\n'));
    console.log(`Full regression receipt: ${report}`);
    process.exitCode = code ?? 1;
} finally {
    // Only this invocation's owned fixture directory is removed.
    await fs.rm(temporary, { recursive: true, force: true });
}
