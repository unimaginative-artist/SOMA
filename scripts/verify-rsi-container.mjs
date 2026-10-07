import { IsolatedCandidateRunner } from '../core/IsolatedCandidateRunner.js';

const root = process.cwd();
const runner = new IsolatedCandidateRunner({ root });
if (!await runner.dockerAvailable()) {
    console.error('RSI isolation unavailable: Docker engine is not reachable');
    process.exitCode = 2;
} else {
    const receipt = await runner.run({
        worktree: root,
        files: [],
        contract: { requiresContainer: true, testFiles: ['tests/rsi-container-smoke.test.mjs'] },
    });
    console.log(JSON.stringify({ passed: receipt.passed, mode: receipt.mode, networkIsolated: receipt.networkIsolated, checks: receipt.checks }, null, 2));
}
