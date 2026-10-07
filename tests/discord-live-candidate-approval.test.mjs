import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiscordLiveCandidateApproval, candidateFingerprint } from '../server/finance/DiscordLiveCandidateApproval.js';

const candidate = {
    id: 'research-1', key: 'beebots_bizzy:BTC-USD', strategyId: 'beebots_bizzy', symbol: 'BTC-USD',
    action: 'eligible_for_human_live_review', live: { candidate: true, requiresHumanApproval: true },
    compiledStrategy: { id: 'compiled-abc' },
    simulation: { passed: true, trades: 120, score: 0.8 },
    paper: { trades: 110, winRate: 65, profitFactor: 1.5, maxDrawdownPct: 8, totalPnl: 80 }
};

async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-discord-live-'));
    const reportPath = path.join(root, 'report.json');
    const report = { success: true, liveCandidates: [structuredClone(candidate)] };
    await fs.writeFile(reportPath, JSON.stringify(report));
    const messages = [];
    const client = { users: { fetch: async id => {
        assert.equal(id, 'owner-123');
        return { send: async payload => {
            const message = { id: `message-${messages.length + 1}`, channelId: 'dm-1', ...payload };
            messages.push(message);
            return message;
        } };
    } } };
    const workflow = new DiscordLiveCandidateApproval({ root, reportPath, client,
        masterId: 'owner-123', maxBridge: {},
        maxReview: async () => ({ deliveryStatus: 'delivered', responsePreview: 'MORE_EVIDENCE: inspect venue fills',
            responseId: 'max-response-1', receiptPath: 'max-review-1.json' }) });
    return { root, reportPath, report, messages, workflow };
}

test('MAX advisory creates one hash-pinned owner DM and no live authorization', async t => {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const sent = await f.workflow.notifyFromReport(f.report);
    assert.equal(sent.length, 1);
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0].content, /MAX advisory/);
    assert.match(f.messages[0].content, /does not start live trading/);
    assert.equal(sent[0].liveOrdersAuthorized, false);
    assert.equal((await f.workflow.notifyFromReport(f.report)).length, 0);
    assert.equal(f.messages.length, 1);
});

test('only owner may decide exact current evidence and a decision is one-time', async t => {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await f.workflow.notifyFromReport(f.report);
    const fingerprint = candidateFingerprint(candidate);
    const input = { customId: `soma-live-review:approve:${fingerprint}`,
        messageId: 'message-1', channelId: 'dm-1' };
    assert.equal((await f.workflow.decide({ ...input, userId: 'stranger' })).accepted, false);
    assert.equal((await f.workflow.decide({ ...input, userId: 'owner-123', messageId: 'forged' })).accepted, false);
    const accepted = await f.workflow.decide({ ...input, userId: 'owner-123' });
    assert.equal(accepted.decision.decision, 'approved');
    assert.equal(accepted.decision.liveOrdersAuthorized, false);
    assert.equal((await f.workflow.decide({ ...input, userId: 'owner-123' })).accepted, false);
    const saved = JSON.parse(await fs.readFile(path.join(f.root, 'data', 'trading',
        'live-candidate-approvals', `${fingerprint}.decision.json`)));
    assert.equal(saved.decidedBy, 'owner-123');
});

test('changed or removed evidence, expiry, and absent MAX review fail closed', async t => {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const sent = await f.workflow.notifyFromReport(f.report);
    const input = { customId: `soma-live-review:reject:${sent[0].fingerprint}`,
        messageId: 'message-1', channelId: 'dm-1', userId: 'owner-123' };
    await fs.writeFile(f.reportPath, JSON.stringify({ success: true, liveCandidates: [] }));
    assert.match((await f.workflow.decide(input)).reason, /no longer eligible/);
    await fs.writeFile(f.reportPath, JSON.stringify({ ...f.report, policy: { minPaperTrades: 1 } }));
    assert.match((await f.workflow.decide(input)).reason, /policy changed/);
    await fs.writeFile(f.reportPath, JSON.stringify(f.report));
    f.workflow.now = () => Date.parse(sent[0].expiresAt);
    assert.match((await f.workflow.decide(input)).reason, /expired/);
    const blocked = new DiscordLiveCandidateApproval({ root: f.root, reportPath: f.reportPath,
        client: f.workflow.client, masterId: 'owner-123', maxBridge: null });
    const newer = { ...candidate, id: 'research-2' };
    await assert.rejects(blocked.notifyFromReport({ success: true, liveCandidates: [newer] }), /MAX review bridge unavailable/);
    assert.equal(f.messages.length, 1);
});

test('Discord button handler acknowledges and removes controls after persisted decision', async () => {
    const { DiscordArbiter } = await import('../arbiters/DiscordArbiter.js');
    const arbiter = new DiscordArbiter({ masterId: 'owner-123', system: { maxBridge: {} } });
    const handlers = new Map();
    arbiter.client = { user: { id: 'soma-bot' }, users: { fetch: async () => null },
        on: (event, handler) => handlers.set(event, handler) };
    arbiter._setupLiveCandidateApprovals();
    clearInterval(arbiter._liveApprovalTimer);
    let persisted = false, updated = null, response = null;
    arbiter._liveCandidateApprovals.decide = async () => {
        persisted = true;
        return { handled: true, accepted: true, decision: { decision: 'approved' } };
    };
    await handlers.get('interactionCreate')({
        isButton: () => true, customId: `soma-live-review:approve:${'a'.repeat(64)}`,
        user: { id: 'owner-123' }, channelId: 'dm-1',
        message: { id: 'message-1', author: { id: 'soma-bot' }, content: 'Candidate review',
            edit: async value => { assert.equal(persisted, true); updated = value; } },
        deferReply: async () => {}, editReply: async value => { response = value; }
    });
    assert.deepEqual(updated.components, []);
    assert.match(updated.content, /Decision: APPROVED/);
    assert.match(response, /Trading remains stopped/);
});
