import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    SomaAgenticExecutor,
    extractToolArgs,
    preservesUsefulContinuation,
    requiredOwnerWorkspacePreflight,
    selectDistinctInspectionRecovery
} from '../core/SomaAgenticExecutor.js';
import { GoalExecutorDaemon } from '../daemons/GoalExecutorDaemon.js';
import {
    ToolFailureCategory,
    classifyToolFailure,
    normalizeReadPath,
    normalizeWebUrl,
    retryDelayMs
} from '../core/ToolFailurePolicy.js';

const require = createRequire(import.meta.url);
const GoalPlannerArbiter = require('../arbiters/GoalPlannerArbiter.cjs');

function goal(id, overrides = {}) {
    return {
        id,
        title: `Goal ${id}`,
        description: 'Perform one bounded engineering task with evidence.',
        category: 'engineering',
        type: 'operational',
        status: 'pending',
        approved: true,
        priority: 50,
        metrics: { progress: 0 },
        metadata: { source: 'autonomous' },
        assignedTo: [],
        tasks: [],
        dependencies: [],
        prerequisites: [],
        createdAt: Date.now(),
        ...overrides
    };
}

test('tool parser preserves nested JSON content for substantive write_file calls', () => {
    const content = JSON.stringify({
        runId: 'apg-fixture',
        narrative: 'A substantive narrative with nested structure.',
        timeline: [{ order: 1, marker: 'LANTERN-123' }]
    });
    const text = `THINK: write the verified synthesis\nTOOL: write_file\nARGS: ${JSON.stringify({
        path: 'data/agency-proving-ground/artifacts/result.json',
        content
    })}`;
    assert.deepEqual(extractToolArgs(text), {
        path: 'data/agency-proving-ground/artifacts/result.json',
        content
    });
});

test('owner workspace artifact goals must discover authorized roots before planning writes', () => {
    const ownerGoal = {
        metadata: {
            source: 'discord_admin',
            sourceChannelId: 'dm-1',
            expectedArtifact: 'C:\\Users\\owner\\Documents\\Soma\\Artifacts\\repair.md'
        }
    };
    assert.deepEqual(requiredOwnerWorkspacePreflight(ownerGoal, []), {
        tool: 'workspace_roots', args: {}, reason: 'required_owner_workspace_discovery'
    });
    assert.equal(requiredOwnerWorkspacePreflight(ownerGoal, [{
        tool: 'workspace_roots', outcome: { ok: true }, result: { roots: ['C:\\Users\\owner\\Documents\\Soma\\Artifacts'] }
    }]), null);
});

test('inspection recovery ignores numeric root junk instead of treating it as evidence', () => {
    const recovery = selectDistinctInspectionRecovery({ description: 'Inspect SOMA code for a Discord repair.' }, [{
        tool: 'list_files',
        args: { directory: '.' },
        result: { path: '.', files: [{ name: '0.8', type: 'file' }, { name: 'core', type: 'dir' }] },
        outcome: { ok: true }
    }]);
    assert.deepEqual(recovery, {
        tool: 'list_files', args: { directory: './core' }, reason: 'advance_to_discovered_unlisted_directory'
    });
});

test('evidence-backed step-budget continuations are not treated as artifactless loops', () => {
    assert.equal(preservesUsefulContinuation({
        needsContinuation: true,
        observations: [
            { tool: 'read_file', outcome: { ok: true }, result: { content: 'source evidence' } }
        ]
    }), true);
    assert.equal(preservesUsefulContinuation({
        needsContinuation: false,
        observations: [
            { tool: 'read_file', outcome: { ok: true }, result: { content: 'source evidence' } }
        ]
    }), false);
});

test('repeated inspections advance through discovered files and goal-authorized URLs', () => {
    const goal = {
        description: 'Fetch http://127.0.0.1:3001/source/W1 and http://127.0.0.1:3001/source/W2.'
    };
    const observations = [{
        tool: 'list_files',
        args: { directory: 'research' },
        result: { path: 'research', files: [{ name: 'notes', type: 'dir' }] },
        outcome: { ok: true }
    }];
    assert.deepEqual(selectDistinctInspectionRecovery(goal, observations), {
        tool: 'list_files',
        args: { directory: 'research/notes' },
        reason: 'advance_to_discovered_unlisted_directory'
    });

    observations.push({
        tool: 'list_files',
        args: { directory: 'research/notes' },
        result: { path: 'research/notes', files: [{ name: 'evidence.md', type: 'file' }] },
        outcome: { ok: true }
    });
    assert.deepEqual(selectDistinctInspectionRecovery(goal, observations), {
        tool: 'read_file',
        args: { path: 'research/notes/evidence.md' },
        reason: 'advance_to_discovered_unread_file'
    });

    observations.push({
        tool: 'read_file',
        args: { path: 'research/notes/evidence.md' },
        result: { path: 'research/notes/evidence.md', content: 'evidence' },
        outcome: { ok: true }
    });
    assert.deepEqual(selectDistinctInspectionRecovery(goal, observations), {
        tool: 'web_fetch',
        args: { url: 'http://127.0.0.1:3001/source/W1', maxChars: 4000 },
        reason: 'advance_to_goal_authorized_url'
    });
});

test('inspection recovery prefers an existing path explicitly grounded in the goal', t => {
    const relativeFixture = `data/agency-proving-ground/test-grounding-${Date.now()}`;
    const absoluteFixture = path.join(process.cwd(), relativeFixture);
    fs.mkdirSync(absoluteFixture, { recursive: true });
    t.after(() => fs.rmSync(absoluteFixture, { recursive: true, force: true }));

    const recovery = selectDistinctInspectionRecovery({
        description: `Read material below ${relativeFixture} and write data/output/paper.md.`
    }, []);
    assert.deepEqual(recovery, {
        tool: 'list_files',
        args: { directory: relativeFixture },
        reason: 'recover_with_existing_goal_grounded_directory'
    });
});

test('self-evolution recovery advances from its diagnostic to the registered benchmark source', () => {
    const recovery = selectDistinctInspectionRecovery({
        description: 'Improve the bounded capability and verify it.',
        metadata: { benchmarkTests: ['tests/agency-proving-ground.test.cjs'] },
    }, [{
        tool: 'read_file',
        args: { path: 'data/self-evolution/diagnostics/research-test.md' },
        result: { path: 'data/self-evolution/diagnostics/research-test.md', content: 'diagnostic' },
        outcome: { ok: true },
    }]);
    assert.deepEqual(recovery, {
        tool: 'read_file',
        args: { path: 'tests/agency-proving-ground.test.cjs' },
        reason: 'recover_with_existing_goal_grounded_file',
    });
});

test('inspection recovery advances from a test into its imported implementation', () => {
    const recovery = selectDistinctInspectionRecovery({ description: 'Diagnose the bounded implementation.' }, [{
        tool: 'read_file',
        args: { path: 'tests/agency-focus-tool-recovery.test.mjs' },
        result: {
            path: 'tests/agency-focus-tool-recovery.test.mjs',
            content: "import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';",
        },
        outcome: { ok: true },
    }]);
    assert.deepEqual(recovery, {
        tool: 'read_file',
        args: { path: 'core/SomaAgenticExecutor.js' },
        reason: 'advance_from_test_to_imported_implementation',
    });
});

test('only one non-trading goal can hold execution focus', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-focus-'));
    const planner = new GoalPlannerArbiter({ dataDir, maxActiveGoals: 10 });
    const focused = goal('focused', { status: 'active', priority: 80, startedAt: Date.now() - 1000 });
    const queued = goal('queued', { priority: 90, metadata: { source: 'discord_admin' } });
    planner.goals.set(focused.id, focused);
    planner.goals.set(queued.id, queued);
    planner.activeGoals.add(focused.id);
    planner.activeGoals.add(queued.id);
    try {
        const result = await planner.startGoal(queued.id);
        assert.equal(result.success, false);
        assert.equal(result.queued, true);
        assert.equal(result.focusedGoalId, focused.id);
        assert.equal(queued.status, 'pending');
        assert.equal(planner.getExecutionFocus().id, focused.id);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('trading goals remain on an independent execution lane', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trading-lane-'));
    const planner = new GoalPlannerArbiter({ dataDir, maxActiveGoals: 10 });
    const focused = goal('engineering', { status: 'active', priority: 80 });
    const trading = goal('trading', { category: 'trading', title: 'Evaluate paper trading risk', priority: 90 });
    planner.goals.set(focused.id, focused);
    planner.goals.set(trading.id, trading);
    planner.activeGoals.add(focused.id);
    planner.activeGoals.add(trading.id);
    try {
        const result = await planner.startGoal(trading.id);
        assert.equal(result.success, true);
        assert.equal(trading.status, 'active');
        assert.equal(planner.getExecutionFocus().id, focused.id);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('focus reconciliation queues extra executors and limits non-trading backlog', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-queue-limit-'));
    const planner = new GoalPlannerArbiter({ dataDir, maxActiveGoals: 10, maxNonTradingQueue: 2 });
    const goals = [
        goal('human-focus', { status: 'active', priority: 70, metadata: { source: 'discord_admin' } }),
        goal('extra-active', { status: 'active', priority: 99 }),
        goal('queue-a', { priority: 60 }),
        goal('queue-b', { priority: 50 }),
        goal('queue-c', { priority: 40 }),
        goal('market-sidecar', { status: 'active', category: 'trading', title: 'Paper trading monitor' })
    ];
    for (const item of goals) {
        planner.goals.set(item.id, item);
        planner.activeGoals.add(item.id);
    }
    try {
        const focus = planner.reconcileExecutionFocus();
        const queue = planner.enforceNonTradingQueueLimit();
        assert.equal(focus.focusedGoalId, 'human-focus');
        assert.equal(planner.goals.get('extra-active').status, 'pending');
        assert.equal(queue.queuedGoalIds.length, 2);
        assert.equal(queue.deferredGoalIds.length, 2);
        assert.equal(planner.goals.get('market-sidecar').status, 'active');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('tool failures are typed into actionable recovery classes', () => {
    assert.equal(classifyToolFailure({ tool: 'read_file', result: { error: 'ENOENT: no such file', code: 'ENOENT' } }).category, ToolFailureCategory.NOT_FOUND);
    assert.equal(classifyToolFailure({ tool: 'web_fetch', result: { error: 'HTTP 429', status: 429 } }).category, ToolFailureCategory.RATE_LIMIT);
    assert.equal(classifyToolFailure({ tool: 'web_fetch', result: { error: 'request timed out', code: 'ETIMEDOUT' } }).retryable, true);
    assert.equal(classifyToolFailure({ tool: 'read_file', result: { error: 'outside allowed root' } }).suggestedTool, 'computer_read');
});

test('common malformed file paths and web URLs are repaired deterministically', () => {
    const root = path.resolve(process.cwd());
    assert.equal(normalizeReadPath(`SOMA/package.json`, root), 'package.json');
    assert.equal(normalizeReadPath('`core/SomaAgenticExecutor.js`', root), 'core/SomaAgenticExecutor.js');
    assert.equal(normalizeWebUrl('example.com/docs'), 'https://example.com/docs');
    assert.ok(retryDelayMs(4) <= 1000);
});

test('read_file accepts a mistakenly root-prefixed SOMA path', async () => {
    const executor = new SomaAgenticExecutor({ maxIterations: 1 });
    executor.initialize({ brain: {}, system: {} });
    const result = await executor._tools.read_file.execute({ path: 'SOMA/package.json', startLine: 1, maxLines: 2 });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.path.replace(/\\/g, '/'), 'package.json');
    assert.match(result.content, /"name"\s*:\s*"soma"/i);
});

test('legacy goal daemon cannot race the authoritative agentic executor during startup', async () => {
    let executions = 0;
    const pending = goal('startup-race');
    const daemon = new GoalExecutorDaemon({
        fallbackGraceMs: 30_000,
        system: {
            agenticExecutor: { async execute() {} },
            goalPlanner: { goals: new Map([[pending.id, pending]]) }
        }
    });
    daemon._execute = async () => { executions++; };
    await daemon.tick();
    assert.equal(executions, 0);
    assert.equal(pending.status, 'pending');
});

test('legacy goal daemon observes a bootstrap grace period even before modern wiring appears', async () => {
    let executions = 0;
    const pending = goal('bootstrap-grace');
    const daemon = new GoalExecutorDaemon({
        fallbackGraceMs: 30_000,
        system: { goalPlanner: { goals: new Map([[pending.id, pending]]) } }
    });
    daemon._execute = async () => { executions++; };
    await daemon.tick();
    assert.equal(executions, 0);
    assert.equal(pending.status, 'pending');
});
