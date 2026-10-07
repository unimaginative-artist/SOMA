import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTradingIntent, allowsAutonomousEntries, allowsScopedPaperMissionEntry, resumeMode, stopTradingIntent } from '../server/finance/TradingIntentPolicy.js';

test('legacy empty intent is stopped, even after restart', () => {
    const intent = normalizeTradingIntent({ engaged: {} });
    assert.equal(intent.desiredState, 'stopped');
    assert.equal(intent.autoResume, false);
    assert.equal(allowsAutonomousEntries(intent), false);
    assert.equal(resumeMode(intent, false), 'skip');
});

test('explicit stop overrides stale engaged rows and stale autoResume', () => {
    const stale = normalizeTradingIntent({
        desiredState: 'stopped', autoResume: true,
        engaged: { 'BTC-USD': { config: { paperMode: true } } }
    });
    assert.equal(stale.autoResume, false);
    assert.equal(resumeMode(stale, false), 'skip');
    assert.equal(resumeMode(stale, true), 'protect_exits_only');
});

test('stop with an empty registry persists a stop and can preserve exit protection', () => {
    const running = normalizeTradingIntent({ desiredState: 'running', autoResume: true, engaged: { 'BTC-USD': {} } });
    assert.equal(resumeMode(running, false), 'normal');
    const stopped = stopTradingIntent(running, { stopped: [], now: '2026-09-26T00:00:00.000Z' });
    const afterRestart = normalizeTradingIntent(stopped);
    assert.equal(afterRestart.desiredState, 'stopped');
    assert.equal(afterRestart.autoResume, false);
    assert.equal(resumeMode(afterRestart, false), 'skip');
    const protecting = stopTradingIntent(running, { stopped: ['BTC-USD'], protecting: ['BTC-USD'] });
    assert.equal(protecting.actualState, 'paused');
    assert.equal(resumeMode(normalizeTradingIntent(protecting), true), 'protect_exits_only');
});

test('paper mission permission does not open shared trading authority and an explicit stop revokes it', () => {
    const paper = normalizeTradingIntent({ desiredState: 'stopped', autoResume: false, paperMissionEnabled: true });
    assert.equal(paper.paperMissionEnabled, true);
    assert.equal(allowsAutonomousEntries(paper), false);
    assert.equal(resumeMode(paper, false), 'skip');
    const config = { selectedBy: 'mission_autopilot', paperMode: true, forcePaper: true,
        liveTradingEnabled: false, missionRunId: 'exact-run' };
    assert.equal(allowsScopedPaperMissionEntry(paper, config, true), true);
    for (const changed of [{ ...config, paperMode: false }, { ...config, forcePaper: false },
        { ...config, liveTradingEnabled: true }, { ...config, selectedBy: 'beebots' },
        { ...config, missionRunId: null }]) {
        assert.equal(allowsScopedPaperMissionEntry(paper, changed, true), false);
    }
    assert.equal(allowsScopedPaperMissionEntry(paper, config, false), false);
    assert.equal(allowsScopedPaperMissionEntry(stopTradingIntent(paper), config, true), false);
    assert.equal(stopTradingIntent(paper).paperMissionEnabled, false);
});
