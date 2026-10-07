import test from 'node:test';
import assert from 'node:assert/strict';
import { SwarmCritiqueHarness } from '../core/SwarmCritiqueHarness.js';
import maxAgentBridge from '../core/MaxAgentBridge.js';

test('SwarmCritiqueHarness: formats structured Discord receipt card', () => {
    const harness = new SwarmCritiqueHarness();
    const critique = {
        approved: true,
        score: 95,
        issues: [],
        receipt: { signature: 'abcdef1234567890abcdef1234567890' }
    };

    const card = harness.formatDiscordReceipt({
        taskTitle: 'Bi-directional Swarm Protocol Test',
        somaSummary: 'Implemented SwarmCritiqueHarness in SOMA core',
        maxSummary: 'Verified Agent0 tool listener on port 3100',
        critique,
        branch: 'swarm/feature-test-1'
    });

    assert.ok(card.includes('SOMA 🤝 MAX Swarm Execution Receipt'));
    assert.ok(card.includes('swarm/feature-test-1'));
    assert.ok(card.includes('95/100'));
    assert.ok(card.includes('**HMAC Signoff:** `abcdef1234567890`'));
});

test('SwarmCritiqueHarness: flags missing branch and scores accordingly', async () => {
    const harness = new SwarmCritiqueHarness();
    const result = await harness.critiqueBranch({ branch: null });

    assert.equal(result.approved, false);
    assert.equal(result.score, 0);
    assert.ok(result.issues.includes('No branch specified for critique.'));
});

test('MaxAgentBridge: exposes swarm methods and harness', () => {
    assert.equal(typeof maxAgentBridge.delegateSwarmTask, 'function');
    assert.equal(typeof maxAgentBridge.critiqueBranch, 'function');
    assert.equal(typeof maxAgentBridge.formatSwarmReceipt, 'function');
    assert.ok(maxAgentBridge.swarmHarness);
});
