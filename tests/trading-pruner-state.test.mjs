import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('portfolio-pruner quarantine survives time and releases only on new verified evidence', async () => {
    const originalCwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-pruner-state-'));
    process.chdir(temp);
    try {
        const moduleUrl = new URL(`../server/finance/TradingPrunerState.js?test=${Date.now()}`, import.meta.url);
        const state = await import(moduleUrl);
        const now = Date.parse('2026-08-28T12:00:00.000Z');
        const identity = { symbol: 'BTC-USD', strategyId: 'standard_portfolio', strategyVersion: 'v1', key: 'BTC-USD|standard_portfolio|v1' };
        state.recordPrunerQuarantine({
            identity, reason: 'losing evidence', stats: { trades: 43 }, evidenceFingerprint: 'evidence-v1', now, reviewIntervalMs: 60_000
        });
        assert.equal(state.isPrunerQuarantined(identity), true);
        assert.equal(state.isPrunerQuarantined(identity, now + 61_000), true);
        assert.ok(state.getPrunerQuarantine(identity, { evidenceFingerprint: 'evidence-v1', releaseOnNewEvidence: true }));
        assert.equal(state.getPrunerQuarantine(identity, { evidenceFingerprint: 'evidence-v2', releaseOnNewEvidence: true }), null);
        assert.equal(state.isPrunerQuarantined(identity), false);
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
