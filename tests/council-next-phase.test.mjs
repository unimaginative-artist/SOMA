import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CouncilRunStore } from '../core/CouncilRunStore.js';
import { CouncilEvidenceProvider } from '../core/CouncilEvidenceProvider.js';
import { createCouncilDecisionPacket, authorizeCouncilDecision } from '../core/CouncilDecisionPacket.js';
import { CouncilOutcomeLedger } from '../core/CouncilOutcomeLedger.js';
import { LargeReasoningCouncil, LARGE_COUNCIL_LOBES, normalizeCouncilMemo } from '../core/LargeReasoningCouncil.js';
import { DiscordConversationJobStore } from '../server/discord/DiscordConversationJobStore.js';

const temporary = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('council phase journal survives restart and rejects stale generations', () => {
    const dir = temporary('soma-council-run-');
    try {
        const statePath = path.join(dir, 'runs.json');
        const first = new CouncilRunStore({ statePath });
        const run = first.begin({ id: 'discord-message-1', question: 'Compare two plans' });
        first.checkpoint(run.id, 'lobe:LOGOS', { text: 'memo', model: 'soma-logos:v2' });
        const restarted = new CouncilRunStore({ statePath });
        const resumed = restarted.begin({ id: run.id, question: 'Compare two plans' });
        assert.equal(resumed.resumeCount, 1);
        assert.equal(resumed.phases['lobe:LOGOS'].payload.text, 'memo');
        assert.throws(() => restarted.checkpoint(run.id, 'qwen:synthesis', { text: 'draft' }, { expectedGeneration: 1 }), /Stale council generation/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('shared evidence bundle carries runtime, memory, and graph provenance', async () => {
    const provider = new CouncilEvidenceProvider({
        mnemonic: { recall: async () => ({ results: [{ id: 'm1', content: 'verified memory', similarity: 0.9 }] }) },
        graph: { retrieve: async () => ({ used: true, context: 'NODE Recovery', sources: [{ file: 'core/Recovery.js' }] }) }
    });
    const bundle = await provider.build('How should recovery work?', { operationalContext: 'SOMA port 3001 is down' });
    assert.equal(bundle.facts.length, 3);
    assert.ok(bundle.sources.some(source => source.type === 'memory'));
    assert.ok(bundle.sources.some(source => source.type === 'graph'));
    assert.match(bundle.text, /SOMA port 3001 is down/);
    assert.match(bundle.digest, /^[a-f0-9]{64}$/);
});

test('model provenance is a runtime gate for trained council seats', () => {
    assert.throws(() => normalizeCouncilMemo('LOGOS', { text: 'memo', model: 'qwen2.5:7b' }, {
        expectedModel: 'soma-logos:v2', strictProvenance: true
    }), /provenance mismatch/);
    const memo = normalizeCouncilMemo('LOGOS', {
        text: JSON.stringify({ claims: ['c1'], evidence_refs: ['E1'], uncertainties: ['u1'], recommendation: 'r1', confidence: 0.8 }),
        model: 'soma-logos:v2'
    }, { expectedModel: 'soma-logos:v2', strictProvenance: true });
    assert.equal(memo.structured, true);
    assert.deepEqual(memo.evidenceRefs, ['E1']);
});

test('resumed council skips completed lobes and preserves proposal-only authority', async () => {
    const dir = temporary('soma-council-resume-');
    try {
        const store = new CouncilRunStore({ statePath: path.join(dir, 'runs.json') });
        store.begin({ id: 'request-1', question: 'Build a bounded plan' });
        store.checkpoint('request-1', 'lobe:LOGOS', { lobe: 'LOGOS', text: 'saved memo', recommendation: 'saved memo', model: 'soma-logos:v2' });
        const calls = [];
        const council = new LargeReasoningCouncil({
            runStore: store,
            outcomeLedger: new CouncilOutcomeLedger({ statePath: path.join(dir, 'outcomes.json') }),
            lobeRunner: async (lobe, prompt) => {
                calls.push(lobe);
                if (calls.length === 4) return { text: 'VERDICT: ACCEPT\nFINAL: Verified answer.', model: 'soma-logos:v2' };
                return { text: `${lobe} memo`, model: `soma-${lobe.toLowerCase()}:v2` };
            },
            largeClient: { model: 'qwen-test', complete: async () => ({ text: 'draft', model: 'qwen-test', provider: 'local' }) }
        });
        const result = await council.deliberate('Build a bounded plan', { requestId: 'request-1' });
        assert.deepEqual(calls, ['AURORA', 'PROMETHEUS', 'THALAMUS', 'LOGOS']);
        assert.equal(result.decisionPacket.actionAuthority, false);
        assert.equal(result.decisionPacket.executable, false);
        assert.equal(store.get('request-1').status, 'completed');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('council decisions require explicit bounded operator authorization', () => {
    const packet = createCouncilDecisionPacket({ runId: 'r1', question: 'Fix the service', answer: 'Proposal' });
    assert.equal(packet.requiresOperatorAuthorization, true);
    assert.equal(packet.executable, false);
    assert.throws(() => authorizeCouncilDecision(packet, {}), /operator authorization/);
    const authorized = authorizeCouncilDecision(packet, {
        operator: 'Owner', allowedTools: ['read_file', 'run_tests'], allowedWritePaths: ['data/council']
    });
    assert.equal(authorized.executable, true);
    assert.equal(authorized.goalContract.strict, true);
    assert.equal(authorized.actionAuthority, false);
});

test('outcome ledger measures quality and latency without changing model weights', () => {
    const dir = temporary('soma-council-outcomes-');
    try {
        const ledger = new CouncilOutcomeLedger({ statePath: path.join(dir, 'outcomes.json') });
        ledger.recordRun({ runId: 'r1', durationMs: 1000 });
        ledger.recordRun({ runId: 'r2', durationMs: 2000 });
        ledger.recordOutcome('r1', { success: true, qualityScore: 0.9 });
        ledger.recordOutcome('r2', { success: false, qualityScore: 0.4, operatorCorrection: 'Missed a constraint' });
        const summary = ledger.summary();
        assert.equal(summary.successRate, 0.5);
        assert.equal(summary.averageQuality, 0.65);
        assert.equal(summary.corrections, 1);
        assert.equal(Object.hasOwn(summary, 'weights'), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every trained lobe remains represented in the council contract', () => {
    assert.deepEqual(LARGE_COUNCIL_LOBES, ['LOGOS', 'AURORA', 'PROMETHEUS', 'THALAMUS']);
});

test('long Discord council jobs persist progress, renew leases, and can be cancelled', () => {
    const dir = temporary('soma-council-discord-');
    try {
        const store = new DiscordConversationJobStore({ statePath: path.join(dir, 'jobs.json'), ownerId: 'worker', leaseMs: 1000 });
        store.receive({ id: 'm1', content: 'Use the full council' });
        store.claim('m1', 1000);
        store.progress('m1', { phase: 'lobe:LOGOS', completed: 1, total: 6 });
        const heartbeat = store.heartbeat('m1', 1500);
        assert.equal(heartbeat.progress.phase, 'lobe:LOGOS');
        assert.equal(Date.parse(heartbeat.leaseUntil), 2500);
        assert.equal(store.cancel('m1').status, 'cancelled');
        assert.equal(store.pending().length, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Discord conversation queue applies bounded backpressure', () => {
    const dir = temporary('soma-council-backpressure-');
    try {
        const store = new DiscordConversationJobStore({ statePath: path.join(dir, 'jobs.json'), maxPending: 1 });
        store.receive({ id: 'm1' });
        assert.throws(() => store.receive({ id: 'm2' }), /queue is full/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
