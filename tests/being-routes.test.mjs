import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBeingStatus } from '../server/routes/beingRoutes.js';

test('being status exposes one bounded cross-system continuity view', () => {
    const status = buildBeingStatus({
        beingKernel: {
            snapshot() {
                return {
                    identity: { name: 'Soma' }, continuity: { bootCount: 3 }, attention: { focus: 'testing' },
                    commitments: [{ id: 'goal-1', status: 'active' }], world: { latestScene: null },
                    experiences: [{ id: 'exp-1' }, { id: 'exp-2' }]
                };
            },
            getScoreboard() { return { agency: { verifiedRate: 0.8 } }; }
        }
    });
    assert.equal(status.success, true);
    assert.equal(status.identity.name, 'Soma');
    assert.equal(status.commitments[0].id, 'goal-1');
    assert.equal(status.scoreboard.agency.verifiedRate, 0.8);
});
