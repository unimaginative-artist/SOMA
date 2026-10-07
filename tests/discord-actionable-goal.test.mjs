import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';

test('explicit model authorization queues the concrete goal instead of reapplying chatter heuristics', async () => {
    const created = [];
    const arbiter = new DiscordArbiter({
        brain: { processQuery: async () => ({ response: '' }) },
        goalPlanner: {
            createGoal: async (goal, source) => {
                created.push({ goal, source });
                return { success: true, goalId: 'authorized-goal-1', goal: { ...goal, id: 'authorized-goal-1' } };
            }
        }
    });

    const response = await arbiter._queueAdminEngineeringGoal(
        'Architecture census phase one',
        null,
        'test-channel',
        { authorized: true }
    );

    assert.equal(created.length, 1);
    assert.equal(created[0].source, 'user');
    assert.equal(created[0].goal.metadata.source, 'discord_admin');
    assert.match(response, /authorized-goal-1/);
});

test('ordinary conversational fragments still do not create engineering goals', async () => {
    const arbiter = new DiscordArbiter({ brain: { processQuery: async () => ({ response: '' }) } });
    assert.equal(arbiter._isActionableEngineeringRequest('sounds cool haha'), false);
    assert.equal(arbiter._isActionableEngineeringRequest('Architecture census phase one', null, { authorized: true }), true);
});
