import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SomaBeingKernel } from '../core/SomaBeingKernel.js';

test('being kernel persists identity continuity, commitments, and grounded experience', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-being-'));
    const statePath = path.join(root, 'being.json');
    const eventPath = path.join(root, 'events.jsonl');
    const goal = { id: 'goal-1', title: 'Build a verified paper', status: 'active', priority: 90, createdAt: Date.now(), metadata: { source: 'user' } };
    const system = {
        goalPlanner: { async getActiveGoals() { return { goals: [goal] }; } },
        agencyMetrics: { summarize() { return { verifiedRate: 1 }; } },
        stateGateway: {
            async publish() {},
            get(namespace, key) {
                if (namespace === 'vision' && key === 'latest_scene') return { value: { labels: ['person', 'teddy bear'] } };
                return null;
            }
        },
        mnemonicArbiter: { async remember(_text, metadata) { return { id: `memory-${metadata.type}` }; } }
    };

    const first = await new SomaBeingKernel({ statePath, eventPath, reconcileIntervalMs: 60_000 }).initialize(system);
    await first.beginTurn({ message: 'Let us make this real', channel: 'discord', userId: 'owner' });
    await first.recordTransaction({
        id: 'tx-1', finishedAt: Date.now(), input: { message: 'Build a verified paper' },
        classification: { lane: 'agentic', domain: 'research' },
        observed: { success: true, verified: true, toolsUsed: ['workspace_write'], evidence: { passed: true } }
    });
    first.stop();

    const second = await new SomaBeingKernel({ statePath, eventPath, reconcileIntervalMs: 60_000 }).initialize(system);
    try {
        const snapshot = second.snapshot();
        assert.equal(snapshot.identity.name, 'Soma');
        assert.equal(snapshot.continuity.bootCount, 2);
        assert.equal(snapshot.continuity.verifiedActionCount, 1);
        assert.equal(snapshot.commitments[0].id, 'goal-1');
        assert.equal(snapshot.experiences[0].type, 'verified_action');
        assert.equal(snapshot.experiences[0].memoryReceipt, 'memory-being_verified_action');
        assert.match(second.getContextBlock(), /Owner is my creator and long-term partner/);
        assert.equal(second.getScoreboard().agency.verifiedRate, 1);
        assert.deepEqual(snapshot.world.latestScene.labels, ['person', 'teddy bear']);
    } finally {
        second.stop();
        await fs.rm(root, { recursive: true, force: true });
    }
});
