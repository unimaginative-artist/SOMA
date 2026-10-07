// Fixed evaluator for real research-evidence loss. Candidates may not edit this file.
// URI comparison: RFC 9110 section 4.2.3; URL serialization: WHATWG URL Standard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeResearchItems } from '../core/ResearchSourcePolicy.js';

test('case-sensitive resource paths are not silently merged', () => {
    const items = [{ url: 'https://example.org/Paper' }, { url: 'https://example.org/paper' }];
    assert.deepEqual(dedupeResearchItems(items), items);
});
test('case-sensitive query values remain distinct', () => {
    const items = [{ url: 'https://example.org/?id=Ab' }, { url: 'https://example.org/?id=ab' }];
    assert.equal(dedupeResearchItems(items).length, 2);
});
test('different long resource identifiers are not truncated into a collision', () => {
    const prefix = 'https://example.org/' + 'a'.repeat(260);
    assert.equal(dedupeResearchItems([{ url: prefix + 'x' }, { url: prefix + 'y' }]).length, 2);
});
test('equivalent host case and default HTTPS port collapse to the first receipt', () => {
    const first = { url: 'https://EXAMPLE.org:443/paper', title: 'First evidence' };
    assert.deepEqual(dedupeResearchItems([first, { url: 'https://example.org/paper' }]), [first]);
});
test('different schemes and nondefault ports do not merge', () => {
    assert.equal(dedupeResearchItems(['https://example.org/a', 'http://example.org/a', 'https://example.org:444/a'].map(url => ({ url }))).length, 3);
});
test('exact duplicate receipts retain first source metadata', () => {
    const first = { url: 'https://example.org/paper', tier: 'mcp' };
    assert.deepEqual(dedupeResearchItems([first, { ...first, tier: 'public_web' }]), [first]);
});
test('non-URL identifiers are lossless and distinct from title fallbacks', () => {
    const items = [{ id: 'ABC' }, { id: 'abc' }, { title: 'ABC' }];
    assert.deepEqual(dedupeResearchItems(items), items);
});
test('empty records are ignored without mutating valid input', () => {
    const items = [{}, { url: 'https://example.org/' }];
    const before = structuredClone(items);
    assert.deepEqual(dedupeResearchItems(items), [items[1]]);
    assert.deepEqual(items, before);
});

// Generalization checks: these were added by the operator after inspecting a
// test-passing candidate. A changed suite invalidates earlier plan fingerprints.
test('a port is default only for its own scheme, not for another scheme', () => {
    for (const [plain, alternate] of [['http://example.org/a', 'http://example.org:443/a'], ['https://example.org/a', 'https://example.org:80/a']]) {
        assert.equal(dedupeResearchItems([{ url: plain }, { url: alternate }]).length, 2);
    }
});
test('URL credentials and fragments identify distinct receipts', () => {
    const urls = ['https://alice@example.org/a', 'https://bob@example.org/a', 'https://example.org/a#A', 'https://example.org/a#a'];
    assert.equal(dedupeResearchItems(urls.map(url => ({ url }))).length, 4);
});
test('malformed URL receipts use lossless fallbacks without crashing', () => {
    const items = [{ url: 'Not a URL' }, { url: 'not a URL' }, { id: 'Not a URL' }];
    assert.deepEqual(dedupeResearchItems(items), items);
});
