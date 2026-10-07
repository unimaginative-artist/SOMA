import test from 'node:test';
import assert from 'node:assert/strict';
import { isContextualFollowup, resolveContextualTask, workflowForTask } from '../server/discord/TypedGoalWorkflow.js';

test('anaphoric Discord follow-up inherits the prior typed task', () => {
    assert.equal(isContextualFollowup('I thought you were going to fix that'), true);
    const task = resolveContextualTask('Can you finish it?', {
        kind: 'trading_diagnostic', category: 'trading', domain: 'paper_trading',
        request: 'Fix paper trading and measure it', goalId: 'prior-1'
    });
    assert.equal(task.kind, 'trading_diagnostic');
    assert.equal(task.contextParentGoalId, 'prior-1');
    assert.match(task.request, /Fix paper trading/);
});

test('a complaint mentioning a past fix is not an execution follow-up', () => {
    const complaint = 'No your goal system seems broken and I have attempted to fix it but it stays broken';
    assert.equal(isContextualFollowup(complaint), false);
    assert.equal(isContextualFollowup('Can you finish it?'), true);
    assert.equal(isContextualFollowup('Retry that with the new evidence'), true);
});

test('each accepted Discord task receives an ordered bounded workflow', () => {
    const workflow = workflowForTask({ kind: 'research' });
    assert.equal(workflow.allowDecomposition, false);
    assert.deepEqual(workflow.stages, [
        'inventory_local_evidence', 'collect_primary_sources',
        'reconcile_claims_and_citations', 'write_and_read_back_artifact'
    ]);
});
