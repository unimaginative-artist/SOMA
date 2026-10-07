// Evaluator-only generalization cases. SelfEvolutionResearch does not include
// this file's contents in its proposal prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeResearchItems } from '../core/ResearchSourcePolicy.js';

test('HTTP default port and host case canonicalize without losing first-source metadata', () => {
    const first = { url: 'http://EXAMPLE.org:80/a', source: 'first' };
    const second = { url: 'http://example.org/a', source: 'second' };
    assert.deepEqual(dedupeResearchItems([first, second]), [first]);
});

test('fragment and userinfo are not erased from source identity', () => {
    const items = [
        { url: 'https://alice@example.org/a#one' },
        { url: 'https://bob@example.org/a#one' },
        { url: 'https://alice@example.org/a#two' },
    ];
    assert.deepEqual(dedupeResearchItems(items), items);
});

test('fallback identifiers retain case and do not collide across source types', () => {
    const items = [{ id: 'Paper-A' }, { id: 'paper-a' }, { title: 'Paper-A' }];
    assert.deepEqual(dedupeResearchItems(items), items);
});
