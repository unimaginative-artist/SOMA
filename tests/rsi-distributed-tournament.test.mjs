import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { RsiDistributedTournament, SCAFFOLDING_ARMS } from '../core/rsi/RsiDistributedTournament.js';

test('RsiDistributedTournament initializes baseline and arms correctly', () => {
    const tempDir = path.resolve(process.cwd(), 'data', `test_rsi_${Date.now()}`);
    const tournament = new RsiDistributedTournament({ dataDir: tempDir });

    const baseline = tournament.getIncumbentBaseline();
    assert.ok(baseline.fitnessScore > 0);
    assert.equal(typeof baseline.scaffolding, 'object');
    assert.equal(SCAFFOLDING_ARMS.length, 5);

    // Clean up
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
});

test('RsiDistributedTournament computes fitness correctly', () => {
    const tournament = new RsiDistributedTournament();
    // Formula: (Accuracy * 100) - (LatencyMs * 0.005) - (TokenCost * 0.02)
    // 0.95 * 100 = 95
    // 100 * 0.005 = 0.5
    // 400 * 0.02 = 8
    // Fitness = 95 - 0.5 - 8 = 86.5
    const fitness = tournament.computeFitness(0.95, 100, 400);
    assert.equal(fitness, 86.5);
});

test('RsiDistributedTournament selects arm via UCB1 and proposes valid candidate', () => {
    const tempDir = path.resolve(process.cwd(), 'data', `test_rsi_${Date.now()}`);
    const tournament = new RsiDistributedTournament({ dataDir: tempDir });

    const arm = tournament.selectArm();
    assert.ok(arm);
    assert.ok(SCAFFOLDING_ARMS.some(a => a.id === arm.id));

    const candidate = tournament.proposeCandidate(arm);
    assert.equal(candidate.armId, arm.id);
    assert.ok(candidate.candidateValue >= arm.range[0]);
    assert.ok(candidate.candidateValue <= arm.range[1]);

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
});

test('RsiDistributedTournament executes a cycle and logs history', async () => {
    const tempDir = path.resolve(process.cwd(), 'data', `test_rsi_${Date.now()}`);
    const tournament = new RsiDistributedTournament({ dataDir: tempDir });

    const result = await tournament.runCycle();
    assert.ok(result.cycleId);
    assert.equal(typeof result.promoted, 'boolean');
    assert.equal(typeof result.delta, 'number');
    assert.ok(result.telemetry.localProbe);

    const history = tournament.getTournamentHistory(5);
    assert.equal(history.length, 1);
    assert.equal(history[0].cycleId, result.cycleId);

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
});
