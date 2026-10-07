// Model suitability probe through MAX's real repair job and SOMA's isolated tests.
// Does not publish source, change runtime model configuration, or submit a goal.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSomaRepairJob } from '../../MAX/core/SomaRepairJob.js';
import { SelfModificationGovernance } from '../core/SelfModificationGovernance.js';
import { SelfRepairCandidate } from '../core/SelfRepairCandidate.js';

const model = process.argv[2];
if (!model) throw new Error('Pass an installed coding model name');
const root = process.cwd();
const reportDir = path.join(root, 'data/repair-verification', `max-model-probe-${Date.now()}`);
await fs.mkdir(reportDir, { recursive: true });
const { plans } = JSON.parse(await fs.readFile('data/self-evolution/research/ledger.json', 'utf8'));
const plan = plans.at(-1);
const report = { model, at: new Date().toISOString(), productionPublication: false, sourcePlanId: plan.id };
let candidate;
try {
    const max = { agentBrain: { think: async (prompt, options) => {
        const r = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
            body: JSON.stringify({ model, stream: false, keep_alive: '5m',
                messages: [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: prompt }],
                options: { num_ctx: 8192, num_predict: 3000, temperature: .1 } }),
        });
        if (!r.ok) throw new Error(`Local model HTTP ${r.status}`);
        const d = await r.json();
        report.timing = { duration: d.total_duration, promptTokens: d.prompt_eval_count, completionTokens: d.eval_count };
        return { text: d.message?.content, metadata: { model: d.model, backend: 'ollama' } };
    } } };
    report.proposal = await runSomaRepairJob(max, { source: 'soma', description: plan.request,
        repairContract: { schemaVersion: 1, workspace: root, sourceGoalId: `model-probe:${plan.id}`, files: [{ path: plan.file, sourceHash: plan.sourceHash }] } });
    const governance = new SelfModificationGovernance({ root, system: {} });
    candidate = await SelfRepairCandidate.create(governance, report.proposal.patch, { testFiles: plan.testFiles, risk: 'medium' });
    report.validation = candidate.validation; report.passed = true;
    console.log(`PASS: ${model} produced a candidate passing the strengthened fixed suite.`);
} catch (error) {
    report.passed = false; report.error = error.message;
    report.failure = `${error.stdout || ''}\n${error.stderr || ''}`.slice(-14000);
    process.exitCode = 1; console.error(error.message);
} finally {
    await candidate?.close();
    await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Model probe receipt: ${reportDir}`);
}
