import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RealityLoopDirector } from '../core/RealityLoopDirector.js';

test('reality loop schedules one proving-ground task, waits for it, then learns from its verified outcome', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-reality-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let runs = [];
    const recorded = { trials: [], cases: [], notices: [] };
    const provingGround = {
        listTrials() { return [{ id: 'computer-search-and-report' }, { id: 'reflection-consolidation' }]; },
        listRuns() { return runs; },
        refresh(id) { return runs.find(run => run.id === id); },
        async start({ trialId }) {
            const run = { id: 'run-1', trialId, state: 'queued', terminal: false, createdAt: new Date().toISOString(), goalId: 'goal-1' };
            runs = [run];
            return run;
        }
    };
    const director = await new RealityLoopDirector({
        system: {
            goalPlanner: { goals: new Map(), createGoal() {} },
            capabilityTrials: {
                listTrials() { return [{ id: 'memory' }, { id: 'coding' }]; },
                async run(domain, options) { return { id: `measurement-${domain}`, valid: true, score: 0.9, options }; }
            }
        },
        provingGround,
        proceduralMemory: { async recordCase(value) { recorded.cases.push(value); }, getStatus() { return {}; } },
        skillCompiler: { async compileEligible() { return []; }, getStatus() { return {}; } },
        desktopWorldModel: { getStatus() { return {}; } }, adaptiveCognition: { getStatus() { return {}; } },
        proactivePresence: { async reportVerifiedWork(value) { recorded.notices.push(value); }, getStatus() { return {}; } },
        reliability: { async recordTrial(value) { recorded.trials.push(value); }, dashboard() { return {}; } },
        statePath: path.join(root, 'director.json')
    }).initialize(null, { autoStart: false });

    const launched = await director.cycle();
    assert.equal(launched.launched, true);
    assert.equal(launched.trialId, 'computer-search-and-report');
    assert.equal(launched.measurement.domain, 'coding');
    assert.equal(launched.measurement.valid, true);
    const waiting = await director.cycle();
    assert.equal(waiting.reason, 'capability_trial_active');

    runs = [{ ...runs[0], state: 'completed', terminal: true, updatedAt: new Date().toISOString(), score: { value: 92, diagnostics: { toolsUsed: ['computer_search', 'read_file', 'write_file'] } } }];
    const observed = await director.cycle({ launch: false });
    assert.equal(observed.processed, 1);
    assert.equal(recorded.trials.length, 1);
    assert.equal(recorded.cases[0].verified, true);
    assert.equal(recorded.notices.length, 1);
    assert.equal(director.getStatus().state.completed, 1);
    director.stop();
});

test('reality loop defers self-training while operator work is active', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-reality-priority-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const director = await new RealityLoopDirector({
        system: { goalPlanner: { goals: new Map([['g', { id: 'g', status: 'active', metadata: { userDirected: true } }]]) } },
        provingGround: { listRuns() { return []; }, listTrials() { return [{ id: 'x' }]; }, async start() { throw new Error('must not launch'); } },
        statePath: path.join(root, 'director.json')
    }).initialize(null, { autoStart: false });
    assert.equal((await director.cycle()).reason, 'operator_work_has_priority');
});
