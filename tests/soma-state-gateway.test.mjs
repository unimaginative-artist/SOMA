import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SomaStateGateway } from '../core/SomaStateGateway.js';

test('canonical state enforces ownership and evidence for verified claims', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-state-'));
    const gateway = await new SomaStateGateway({ statePath: path.join(dir, 'state.json'), eventPath: path.join(dir, 'events.jsonl') }).initialize();
    await gateway.publish('vision', 'scene', { objects: 2 }, { owner: 'VisionDaemon', status: 'observed' });
    await assert.rejects(() => gateway.publish('vision', 'scene', {}, { owner: 'DiscordArbiter' }), /ownership conflict/);
    await assert.rejects(() => gateway.publish('goals', 'latest', {}, { owner: 'GoalPlanner', status: 'verified' }), /requires evidence/);
    await fs.rm(dir, { recursive: true, force: true });
});

test('canonical state survives restart with provenance intact', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-state-'));
    const options = { statePath: path.join(dir, 'state.json'), eventPath: path.join(dir, 'events.jsonl') };
    const first = await new SomaStateGateway(options).initialize();
    await first.publish('trading', 'summary', { mode: 'paper' }, { owner: 'TradingPerformanceGuard', status: 'verified', evidence: { report: 'guard' } });
    const recovered = await new SomaStateGateway(options).initialize();
    assert.equal(recovered.get('trading', 'summary').owner, 'TradingPerformanceGuard');
    assert.equal(recovered.get('trading', 'summary').status, 'verified');
    await fs.rm(dir, { recursive: true, force: true });
});
