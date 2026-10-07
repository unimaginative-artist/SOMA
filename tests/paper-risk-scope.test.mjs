import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PaperRiskScope, brokerHaltAppliesToPaper } from '../server/finance/PaperRiskScope.js';
import { RiskManager } from '../arbiters/RiskManager.js';

async function setup(t) {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'paper-risk-'));
    t.after(() => rm(rootPath, { recursive: true, force: true }));
    return { rootPath, scope: new PaperRiskScope({ rootPath, identity: 'ETH-USD|scalp|v3' }),
        input: { trade: { symbol: 'ETH-USD', side: 'buy', size: .1, price: 2000 }, portfolio: { initialBalance: 10000, balance: 10000, positions: {} } } };
}

test('paper account uses its own equity and fractional sizes, leaving broker loss halt intact', async t => {
    const { scope, input } = await setup(t);
    const brokerRisk = { riskState: { isHalted: true, haltReason: 'Max drawdown exceeded' }, portfolio: { totalValue: 100354.91, peakValue: 100354.91 } };
    const before = JSON.stringify(brokerRisk);
    const result = await scope.validate({ ...input, brokerRisk });
    assert.equal(result.approved, true); assert.equal(result.adjustedSize, .1); assert.equal(result.equity, 10000); assert.equal(result.drawdown, 0);
    assert.equal(JSON.stringify(brokerRisk), before);
});

test('manual/global and unknown safety halts still stop paper', async t => {
    const { scope, input } = await setup(t);
    for (const riskState of [{ isHalted: true, haltReason: 'Manual stop' }, { isHalted: true, haltReason: 'Max drawdown exceeded', haltScope: 'all' }]) {
        assert.equal(brokerHaltAppliesToPaper({ riskState }), true);
        assert.equal((await scope.validate({ ...input, brokerRisk: { riskState } })).approved, false);
    }
});

test('paper drawdown is enforced and its halt survives restart and price recovery', async t => {
    const { rootPath, scope, input } = await setup(t);
    const result = await scope.validate({ ...input, portfolio: { ...input.portfolio, balance: 9000 } });
    assert.equal(result.approved, false); assert.ok(result.violations.some(v => v.rule === 'MAX_DRAWDOWN'));
    const restored = new PaperRiskScope({ rootPath, identity: scope.identity });
    assert.equal((await restored.validate(input)).approved, false);
    const persisted = JSON.parse(await readFile(scope.statePath, 'utf8'));
    assert.equal(persisted.riskState.isHalted, true);
});

test('daily ledger limits, loss streak sizing and unrealized losses are real risk inputs', async t => {
    const { scope, input } = await setup(t);
    const now = Date.now(); const stamp = new Date(now).toISOString();
    const closedTrades = Array.from({length:5}, () => ({ entry_time: stamp, exit_time: stamp, pnl: -1 }));
    const small = await scope.validate({ ...input, closedTrades, now });
    assert.equal(small.adjustedSize, .05);
    const limited = await scope.validate({ ...input, closedTrades, now, brokerRisk: { limits: { maxDailyTrades: 5 } } });
    assert.equal(limited.approved, false);
});

test('invalid equity and corrupt persisted risk state fail closed', async t => {
    const { rootPath, scope, input } = await setup(t);
    assert.equal((await scope.validate({ ...input, portfolio: { ...input.portfolio, balance: NaN } })).approved, false);
    await writeFile(scope.statePath, '{broken');
    await assert.rejects(new PaperRiskScope({ rootPath, identity: scope.identity }).validate(input));
});

test('paper size reductions respect fractions; legacy stock sizing remains integer', () => {
    const r = new RiskManager({ rootPath: os.tmpdir() });
    assert.equal(r.calculateAdjustedSize({ size: .12345678, allowFractional: true }, []), .123456);
    assert.equal(r.calculateAdjustedSize({ size: 1.9 }, []), 1);
});
