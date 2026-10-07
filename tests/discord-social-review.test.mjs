import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import { BlueskyReviewService } from '../server/social/BlueskyReviewService.js';
import { InteractionStore } from '../server/social/cortex/interactionStore.js';

function discordMessage({ id = 'owner-1', username = 'owner', content = 'review' } = {}) {
    const replies = [];
    return {
        author: { id, username, bot: false },
        content,
        channelId: 'test-channel',
        guild: null,
        replies,
        async reply(value) { replies.push(value); return value; },
    };
}

test('Discord social review commands require an explicit owner ID, not an admin username', async () => {
    let accessed = false;
    const arbiter = new DiscordArbiter({
        masterId: 'real-owner',
        blueskyReviewService: { getStatus() { accessed = true; return { queuedReview: [] }; } },
    });
    arbiter._recordDiscordInteraction = async () => {};
    const msg = discordMessage({ id: 'impostor', username: 'owner', content: 'review' });
    const result = await arbiter._handleDiscordCommand(msg, 'review');
    assert.equal(result.handled, true);
    assert.equal(accessed, false);
    assert.match(msg.replies[0], /Access denied/i);
});

test('Discord owner can list and approve queued Bluesky drafts through the shared service', async () => {
    const calls = [];
    const reviewService = {
        getStatus() { return { queuedReview: [{ id: 13, handle: 'person.test', text: 'A safe pending reply.' }] }; },
        async approve(id, context) { calls.push({ id, context }); return { id, status: 'approved', responseUri: 'at://posted/13' }; },
    };
    const arbiter = new DiscordArbiter({ masterId: 'owner-1', blueskyReviewService: reviewService });
    arbiter._recordDiscordInteraction = async () => {};

    const list = discordMessage({ content: 'review' });
    await arbiter._handleDiscordCommand(list, 'review');
    assert.match(list.replies[0], /#13/);

    const approve = discordMessage({ content: 'approve 13' });
    await arbiter._handleDiscordCommand(approve, 'approve 13');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 13);
    assert.equal(calls[0].context.source, 'discord_operator');
    assert.match(approve.replies[0], /posted and verified/i);
});

test('Discord owner can inspect, edit, and reject without bypassing the shared service', async () => {
    const calls = [];
    const reviewService = {
        getReview(id) { calls.push(['inspect', id]); return { id, handle: 'person.test', status: 'pending', reason: 'Assisted draft awaiting operator review', text: 'Original draft.' }; },
        async edit(id, text, context) { calls.push(['edit', id, text, context.source]); return { id, text }; },
        reject(id, context) { calls.push(['reject', id, context.reason, context.source]); return { id, status: 'rejected' }; },
    };
    const arbiter = new DiscordArbiter({ masterId: 'owner-1', blueskyReviewService: reviewService });
    arbiter._recordDiscordInteraction = async () => {};

    const inspect = discordMessage({ content: 'inspect 13' });
    await arbiter._handleDiscordCommand(inspect, 'inspect 13');
    assert.match(inspect.replies[0], /Original draft/);

    const edit = discordMessage({ content: 'edit 13 Revised truthful draft.' });
    await arbiter._handleDiscordCommand(edit, 'edit 13 Revised truthful draft.');
    assert.match(edit.replies[0], /still pending/i);

    const reject = discordMessage({ content: 'reject 13 Not useful' });
    await arbiter._handleDiscordCommand(reject, 'reject 13 Not useful');
    assert.match(reject.replies[0], /Nothing was posted/i);
    assert.deepEqual(calls, [
        ['inspect', 13],
        ['edit', 13, 'Revised truthful draft.', 'discord_operator'],
        ['reject', 13, 'Not useful', 'discord_operator'],
    ]);
});

test('review service atomically prevents duplicate approval posts and records the decision', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-review-'));
    const store = new InteractionStore(path.join(dir, 'review.db'));
    try {
        store.enqueueReview({
            uri: 'at://incoming/1',
            handle: 'person.test',
            reason: 'Assisted draft awaiting operator review',
            text: 'A safe reply.',
            parentRef: { uri: 'at://parent/1', cid: 'cid-parent' },
            rootRef: { uri: 'at://root/1', cid: 'cid-root' },
        });
        const id = store.getStatus().queuedReview[0].id;
        let posts = 0;
        const service = new BlueskyReviewService({
            store,
            client: { async reply() { posts += 1; return { uri: 'at://posted/1' }; } },
            guardText: async text => ({ text }),
            assertPost: text => { if (!text) throw new Error('missing text'); },
        });

        const results = await Promise.allSettled([
            service.approve(id, { source: 'test', actorId: 'owner-1' }),
            service.approve(id, { source: 'test', actorId: 'owner-1' }),
        ]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.filter(result => result.status === 'rejected').length, 1);
        assert.equal(posts, 1);
        assert.equal(store.getReview(id).status, 'approved');
        assert.equal(store.getReviewAudit(id)[0].action, 'approved');
    } finally {
        store.db.close();
        await fs.rm(dir, { recursive: true, force: true });
    }
});
