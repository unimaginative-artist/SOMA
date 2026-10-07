import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OutboundAutonomyGate } from '../core/OutboundAutonomyGate.js';

async function fixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-outbound-'));
    let clock = 1000;
    return { dir, tick: ms => clock += ms, gate: new OutboundAutonomyGate({ statePath: path.join(dir, 'gate.json'), now: () => clock }) };
}

test('reflection cannot masquerade as file or execution progress', async () => {
    const { dir, gate } = await fixture();
    const result = gate.evaluate({ kind: 'reflection', source: 'loop', message: 'I am rewriting the blueprint and will inspect the git diff next.' });
    assert.equal(result.allowed, false);
    assert.equal(result.receipt.reason, 'reflection_contains_work_or_repository_claim');
    await fs.rm(dir, { recursive: true, force: true });
});

test('the vague code-work reflections seen on Discord are suppressed without evidence', async () => {
    const { dir, gate } = await fixture();
    for (const message of [
        "I'm diving into new ways to structure my code for smoother performance.",
        'Hit an interesting pattern in failing tests. Will analyze with node --trace-warnings to optimize performance.'
    ]) {
        const result = gate.evaluate({ kind: 'reflection', source: 'loop', message });
        assert.equal(result.allowed, false, message);
        assert.equal(result.receipt.reason, 'reflection_contains_work_or_repository_claim');
    }
    await fs.rm(dir, { recursive: true, force: true });
});

test('reflection yields attention while operator work is unresolved', async () => {
    const { dir, gate } = await fixture();
    const result = gate.evaluate({
        kind: 'reflection', source: 'loop', operatorWorkPending: true,
        message: 'Thermodynamic analogies may be useful for thinking about memory pressure.'
    });
    assert.equal(result.allowed, false);
    assert.equal(result.receipt.reason, 'operator_work_pending');
    await fs.rm(dir, { recursive: true, force: true });
});

test('provider overload text can never become a reflection', async () => {
    const { dir, gate } = await fixture();
    const result = gate.evaluate({
        kind: 'reflection', source: 'loop',
        message: 'My local brain is overloaded right now, so I stopped this turn instead of leaving you waiting. Retry in a moment.'
    });
    assert.equal(result.allowed, false);
    assert.equal(result.receipt.reason, 'reflection_contains_runtime_failure');
    await fs.rm(dir, { recursive: true, force: true });
});

test('verified work requires an execution receipt', async () => {
    const { dir, gate } = await fixture();
    assert.equal(gate.evaluate({ kind: 'verified_work', message: 'Tests passed.' }).allowed, false);
    assert.equal(gate.evaluate({ kind: 'verified_work', message: 'Tests passed.', verified: true, evidence: { transactionId: 'tx' } }).allowed, true);
    await fs.rm(dir, { recursive: true, force: true });
});

test('trading restart alerts deduplicate across a six-hour window', async () => {
    const { dir, gate, tick } = await fixture();
    const alert = 'Engine Auto-Resumed\nPaper trading on BTC-USD resumed after server restart';
    assert.equal(gate.evaluate({ kind: 'trading_resume', source: 'trading_notifications', message: alert, verified: true, evidence: { symbol: 'BTC-USD' } }).allowed, true);
    assert.equal(gate.evaluate({ kind: 'trading_resume', source: 'trading_notifications', message: alert, verified: true, evidence: { symbol: 'BTC-USD' } }).allowed, false);
    tick(6 * 60 * 60_000 + 1);
    assert.equal(gate.evaluate({ kind: 'trading_resume', source: 'trading_notifications', message: alert, verified: true, evidence: { symbol: 'BTC-USD' } }).allowed, true);
    await fs.rm(dir, { recursive: true, force: true });
});

test('restart dedupe is per message and does not suppress another market', async () => {
    const { dir, gate } = await fixture();
    const btc = 'Engine Auto-Resumed\nPaper trading on BTC-USD resumed after server restart';
    const eth = 'Engine Auto-Resumed\nPaper trading on ETH-USD resumed after server restart';
    assert.equal(gate.evaluate({ kind: 'trading_resume', source: 'trading_notifications', message: btc, verified: true }).allowed, true);
    assert.equal(gate.evaluate({ kind: 'trading_resume', source: 'trading_notifications', message: eth, verified: true }).allowed, true);
    await fs.rm(dir, { recursive: true, force: true });
});

test('ordinary trading alerts use a short duplicate window', async () => {
    const { dir, gate, tick } = await fixture();
    const alert = 'Risk Alert\nBTC-USD exceeded the configured exposure threshold';
    assert.equal(gate.evaluate({ kind: 'trading_alert', source: 'trading_notifications', message: alert, verified: true }).allowed, true);
    assert.equal(gate.evaluate({ kind: 'trading_alert', source: 'trading_notifications', message: alert, verified: true }).allowed, false);
    tick(5 * 60_000 + 1);
    assert.equal(gate.evaluate({ kind: 'trading_alert', source: 'trading_notifications', message: alert, verified: true }).allowed, true);
    await fs.rm(dir, { recursive: true, force: true });
});

test('a receipt is accepted only for the exact delivered message', async () => {
    const { dir, gate } = await fixture();
    const verdict = gate.evaluate({ kind: 'reflection', source: 'loop', message: 'Uncertainty can make a useful question more visible.' });
    assert.equal(gate.validatesReceipt(verdict.receipt, { message: verdict.text, source: 'loop', kind: 'reflection' }), true);
    assert.equal(gate.validatesReceipt(verdict.receipt, { message: 'I changed a file.', source: 'loop', kind: 'reflection' }), false);
    await fs.rm(dir, { recursive: true, force: true });
});

test('novel reflection is labeled and rate limited', async () => {
    const { dir, gate } = await fixture();
    const first = gate.evaluate({ kind: 'reflection', source: 'loop', message: 'I keep wondering which questions remain useful after uncertainty settles.' });
    assert.equal(first.allowed, true);
    assert.match(first.text, /^Reflection:/);
    assert.equal(gate.evaluate({ kind: 'reflection', source: 'loop', message: 'I wonder which questions stay useful after uncertainty settles.' }).allowed, false);
    await fs.rm(dir, { recursive: true, force: true });
});
