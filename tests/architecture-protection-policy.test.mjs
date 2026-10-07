import test from 'node:test';
import assert from 'node:assert/strict';
import { protectionForArchitecturePath } from '../core/ArchitectureProtectionPolicy.js';
import UniversalLearningPipeline from '../arbiters/UniversalLearningPipeline.js';

test('protects the complete trading domain from architecture quarantine', () => {
    for (const file of [
        'server/finance/autonomousTrader.js',
        'server/finance/StrategyRegistry.js',
        'arbiters/BacktestEngine.js',
        'arbiters/FinanceAgentArbiter.js',
        'appendages/forecaster/active_guesses.json'
    ]) {
        const result = protectionForArchitecturePath(file);
        assert.equal(result.protected, true, file);
        assert.equal(result.domain, 'trading', file);
    }
});

test('protects the new cognitive spine', () => {
    assert.equal(protectionForArchitecturePath('core/CognitiveRuntime.js').domain, 'core');
    assert.equal(protectionForArchitecturePath('core/WorkingMemory.js').domain, 'core');
});

test('protects vision and embodiment work from architecture quarantine', () => {
    for (const file of ['daemons/VisionDaemon.js', 'arbiters/VisionProcessingArbiter.js', 'server/routes/perceptionRoutes.js', 'core/EmbodimentRuntime.js']) {
        assert.equal(protectionForArchitecturePath(file).domain, 'embodiment', file);
    }
});

test('does not treat model self-approval or response length as reward', () => {
    const pipeline = Object.create(UniversalLearningPipeline.prototype);
    assert.equal(pipeline.calculateReward({ output: 'A polished answer', metadata: { success: true, criticScore: 1 } }), 0);
    assert.equal(pipeline.calculateReward({ output: 'Verified', metadata: { success: true, externallyVerified: true } }), 1);
    assert.equal(pipeline.calculateReward({ output: 'Wrong', metadata: { success: false, error: 'test failed' } }), -1);
});
