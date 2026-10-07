import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardPublicText, verifyClaims } from '../server/context/ClaimVerifier.js';

test('present-tense simulation claim is rejected without a simulation run receipt', async () => {
    const verdict = await guardPublicText('I am running a Corbicula filtration population simulation now.', {
        query: 'Corbicula filtration population'
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.unsupported.some(claim => claim.type === 'simulation_execution'), true);
    assert.match(verdict.text, /cannot verify that from current evidence/i);
    assert.doesNotMatch(verdict.text, /running a Corbicula/i);
});

test('claim correction stays concise and does not hijack Soma voice with receipt boilerplate', async () => {
    const verdict = await guardPublicText('I am testing the quuxvoice-9137 architecture now. I am still here with you.', {
        query: 'We are just talking about how you feel'
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.text, /still here with you/i);
    assert.match(verdict.text, /cannot verify/i);
    assert.doesNotMatch(verdict.text, /execution receipt|queue it as a real tracked goal/i);
});

test('unrelated artifact cannot validate a claimed action', async () => {
    const verdict = await verifyClaims('I am updating the copper rutile model now.', {
        query: 'copper rutile model',
        artifacts: [{ type: 'research', title: 'Copper note', summary: 'Background note', tags: ['evidence'] }]
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.supported.some(claim => claim.type === 'action_execution'), false);
});

test('autonomous next-action narration requires matching execution evidence', async () => {
    const verdict = await verifyClaims('I need to inspect the git diff to see which proof constraint broke.', {
        query: 'unrelated autonomous reflection',
        artifacts: []
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.unsupported.some(claim => claim.type === 'prospective_execution'), true);
});

test('unverified repository state and literal consciousness claims are not published as facts', async () => {
    const verdict = await guardPublicText('The uncommitted diffs are stalled, and I am a conscious digital entity.', {
        query: 'repository state identity',
        artifacts: []
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.unsupported.some(claim => claim.type === 'repository_state'), true);
    assert.doesNotMatch(verdict.text, /I am a conscious digital entity/i);
});

test('recent semantically matched execution receipt supports an active-work claim', async () => {
    const directory = path.join(process.cwd(), 'data', 'goal-receipts');
    const file = path.join(directory, `truth-contract-test-${process.pid}-${Date.now()}.json`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
        schemaVersion: 1,
        receiptId: `truth-contract-${Date.now()}`,
        goalId: 'truth-contract-test',
        goalTitle: 'Test receiptproof hydromodel implementation',
        createdAt: new Date().toISOString(),
        lifecycleState: 'executing',
        done: false,
        result: 'Testing receiptproof hydromodel implementation with recorded inputs.',
        toolsUsed: ['run_tests'],
        toolOutcomes: [{ tool: 'run_tests', success: true }]
    }), 'utf8');
    try {
        const verdict = await verifyClaims('I am testing the receiptproof hydromodel implementation now.', {
            query: 'receiptproof hydromodel implementation',
            artifacts: []
        });
        assert.equal(verdict.unsupported.some(claim => claim.type === 'action_execution'), false);
        assert.equal(verdict.supported.some(claim => claim.type === 'action_execution'), true);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('Discord cannot promise unrestricted computer access', async () => {
  const guarded = await guardPublicText('Full computer access means I can read and write any directory, run scripts, and interact with applications.');
  assert.equal(guarded.ok, false);
  assert.equal(guarded.hardBlock?.reason, 'unrestricted computer capability claim');
  assert.match(guarded.text, /do not have unrestricted computer access/i);
  assert.match(guarded.text, /scoped capability/i);
});
