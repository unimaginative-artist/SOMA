import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradingResumeConfig } from '../server/finance/TradingResumeIntent.js';

test('runtime-forced paper mode and original virtual capital survive persistence', () => {
    assert.deepEqual(buildTradingResumeConfig({ strategyVersion: 'v3' }, { paperMode: true, _paperPortfolio: { initialBalance: 10000 } }), {
        strategyVersion: 'v3', paperMode: true, forcePaper: true, initialBalance: 10000
    });
});
test('broker sessions and unknown legacy mode never become auto-resumable paper intent', () => {
    assert.equal(buildTradingResumeConfig({ paperMode: true }, { paperMode: false }).paperMode, false);
    assert.equal(buildTradingResumeConfig({}).paperMode, false);
});
test('explicit paper request is preserved without a runtime and input config is untouched', () => {
    const config = { forcePaper: true, strategyVersion: 'unchanged' };
    assert.equal(buildTradingResumeConfig(config).paperMode, true);
    assert.deepEqual(config, { forcePaper: true, strategyVersion: 'unchanged' });
});
