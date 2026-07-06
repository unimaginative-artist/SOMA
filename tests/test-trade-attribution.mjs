import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const SOURCE = fs.readFileSync(new URL('../server/finance/autonomousTrader.js', import.meta.url), 'utf8');

test('autonomous trade journal entries use canonical attribution helper', () => {
    const tradeEntryCalls = [...SOURCE.matchAll(/tradeLogger\.logTradeEntry\(\{[\s\S]*?\n\s*\}\);/g)]
        .map(match => match[0]);

    assert.ok(tradeEntryCalls.length >= 3, 'expected multiple trade journal paths');
    for (const call of tradeEntryCalls) {
        assert.match(call, /strategy:\s*attribution\.strategyId/, 'trade entry must store canonical strategy id');
        assert.match(call, /attribution,/, 'trade entry must persist attribution receipt');
    }
});

test('attribution receipt includes sim-to-live candidate identity', () => {
    assert.match(SOURCE, /_tradeAttribution\(\)/);
    assert.match(SOURCE, /candidateId:/);
    assert.match(SOURCE, /candidateKey:/);
    assert.match(SOURCE, /compiledStrategyId:/);
    assert.match(SOURCE, /strategySource:/);
});
