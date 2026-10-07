import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CognitiveRuntime } from '../core/CognitiveRuntime.js';

function createSystem() {
    const calls = { brain: 0, agent: 0, transitions: [], learning: [], brainContexts: [], reality: [] };
    const system = {
        ready: true,
        workingMemory: {
            state: { preoccupation: null, openWonders: [] },
            setPreoccupation(value) { this.state.preoccupation = value; },
            addAction() {},
            async save() {}
        },
        quadBrain: { async reason(prompt, context) { calls.brain++; calls.brainContexts.push(context); return { text: `answer:${prompt}` }; } },
        agenticExecutor: {
            async execute() {
                calls.agent++;
                return { done: true, toolsUsed: ['write_file'], observations: [{ result: { success: true } }], completionEvidence: { passed: true }, text: 'implemented' };
            }
        },
        worldModel: { async observeTransition(value) { calls.transitions.push(value); } },
        learningPipeline: { async logInteraction(value) { calls.learning.push(value); } },
        goalPlanner: { getActiveGoals() { return []; } },
        realityLoop: { async observeTransaction(value) { calls.reality.push(value); } }
    };
    return { system, calls };
}

test('routes concrete work through tools and records grounded learning', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-cognitive-'));
    const { system, calls } = createSystem();
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(dir, 'ledger.jsonl') }).initialize(system);
    const result = await runtime.run({ message: 'implement the verified change', sessionId: 'test' });

    assert.equal(calls.agent, 1);
    assert.equal(calls.brain, 0);
    assert.equal(result.cognitiveTransaction.verified, true);
    assert.deepEqual(result.cognitiveTransaction.toolsUsed, ['write_file']);
    assert.equal(calls.transitions[0].reward, 1);
    assert.equal(calls.learning[0].metadata.externallyVerified, true);
    assert.equal(calls.reality[0].observed.verified, true);
});

test('protects trading requests from generic autonomous execution', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-cognitive-'));
    const { system, calls } = createSystem();
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(dir, 'ledger.jsonl') }).initialize(system);
    const result = await runtime.run({ message: 'analyze my trading positions and market regime' });

    assert.equal(calls.agent, 0);
    assert.equal(calls.brain, 1);
    assert.equal(result.cognitiveTransaction.domain, 'trading');
    assert.equal(calls.transitions.length, 0);
});

test('trusted read-only inspection uses an isolated host while engineering execution is busy', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-cognitive-'));
    const { system, calls } = createSystem();
    let forked = 0;
    system.agenticExecutor._executionActive = true;
    system.agenticExecutor.forkReadOnlyInspection = () => {
        forked++;
        return {
            async execute(goal) {
                assert.equal(goal.metadata.executionMode, 'inspect');
                return { state: 'completed', done: true, verification: { passed: true },
                    summary: 'Listed real files', toolsUsed: ['list_files', 'record_observation'],
                    observations: [{ tool: 'list_files', outcome: { ok: true }, result: { success: true } }] };
            }
        };
    };
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(dir, 'ledger.jsonl') }).initialize(system);
    const result = await runtime.run({ message: 'list files', trustedActionAuthority: true });
    assert.equal(forked, 1);
    assert.equal(calls.agent, 0);
    assert.match(result.text, /Listed real files/);
});

test('real goal planner queues agentic chat work instead of bypassing execution focus', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-cognitive-'));
    const { system, calls } = createSystem();
    let created = null;
    system.goalPlanner = {
        goals: new Map(),
        getActiveGoals() { return []; },
        async createGoal(goal, source) {
            created = { goal, source };
            return { success: true, goalId: 'queued-goal', goal: { ...goal, id: 'queued-goal', status: 'pending' } };
        }
    };
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(dir, 'ledger.jsonl') }).initialize(system);
    const result = await runtime.run({ message: 'fix the bug in this code file', sessionId: 'discord:test', options: { sourceChannel: 'discord' } });

    assert.equal(calls.agent, 0);
    assert.equal(created.source, 'user');
    assert.equal(created.goal.category, 'engineering');
    assert.equal(result.goalId, 'queued-goal');
    assert.match(result.text, /Queued as focused goal/);
    assert.equal(result.cognitiveTransaction.verified, false);
});

test('keeps ordinary conversation on the inference lane', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-cognitive-'));
    const { system, calls } = createSystem();
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(dir, 'ledger.jsonl') }).initialize(system);
    const result = await runtime.run({ message: 'how are you today?', quickResponse: true });

    assert.equal(calls.agent, 0);
    assert.equal(calls.brain, 1);
    assert.equal(result.cognitiveTransaction.lane, 'inference');
    assert.equal(calls.transitions.length, 0);
});

test('injects measured adaptive cognition and procedural guidance into inference', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-cognitive-'));
    const { system, calls } = createSystem();
    system.adaptiveCognition = { assess() { return { mode: 'adversarial', deepThinking: true, forceMultiLobe: true, temperature: 0.25, uncertainty: 0.8, evidenceStrictness: 'maximum' }; } };
    system.proceduralMemory = { retrieve() { return [{ patternId: 'p1', recommendedTools: ['read_file'] }]; } };
    system.skillCompiler = { recommend() { return [{ id: 's1' }]; } };
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(dir, 'ledger.jsonl') }).initialize(system);
    await runtime.run({ message: 'Explain the security architecture' });
    assert.equal(calls.brainContexts[0].forceMultiLobe, true);
    assert.equal(calls.brainContexts[0].temperature, 0.25);
    assert.equal(calls.brainContexts[0].proceduralGuidance[0].patternId, 'p1');
    assert.equal(calls.brainContexts[0].reusableSkills[0].id, 's1');
});

test('does not confuse analysis or creative writing with permission to act', () => {
    const runtime = new CognitiveRuntime();
    assert.equal(runtime.classify({ message: 'analyze this argument carefully' }).lane, 'inference');
    assert.equal(runtime.classify({ message: 'write a poem about memory' }).lane, 'inference');
    assert.equal(runtime.classify({ message: 'fix the bug in this code file' }).lane, 'agentic');
    assert.equal(runtime.classify({ message: 'do it', forceAgentic: true }).lane, 'agentic');
    assert.equal(runtime.classify({ message: 'I attempted to fix the code, but the goal loop is still broken' }).lane, 'inference');
    assert.equal(runtime.classify({ message: 'Can you fix the bug in this code file?' }).lane, 'agentic');
});
