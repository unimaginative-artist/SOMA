import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assertPublicMediaMetadata,
    assertPublicPost,
    detectSensitivePublicContent,
    validatePublicPost,
} from '../server/social/SocialContentSafety.js';
import { buildSomaContext } from '../server/context/SomaContextKernel.js';
import { BlueskeyClient } from '../server/social/BlueskeyClient.js';
import studioFeed from '../server/studio/StudioFeedStore.js';

const LEAKED_PROFILE = '[USER PROFILE] # User Profile ## Identity Name: Barry Role: Builder / Operator Location: Lisbon Timezone: America/New\\_York Avatar:';

test('rejects the exact profile text that escaped to Bluesky', () => {
    const verdict = validatePublicPost(LEAKED_PROFILE, { platform: 'bluesky' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'privacy_leak');
    assert.ok(verdict.findings.includes('internal_context_marker'));
    assert.throws(() => assertPublicPost(LEAKED_PROFILE), /Unsafe public post blocked/);
});

test('rejects credentials, contact details, and private home paths', () => {
    const cases = [
        'Debug result access_token: abcdefghijklmnopqrstuvwxyz',
        'Contact the operator at private.person@example.com for access.',
        'Call the operator at 212-555-0198 before deployment.',
        'Artifact saved to C:\\Users\\barry\\Desktop\\private.json today.',
    ];
    for (const value of cases) {
        assert.ok(detectSensitivePublicContent(value).length, value);
        assert.equal(validatePublicPost(value).ok, false, value);
    }
});

test('rejects private data in image alt text', () => {
    assert.throws(
        () => assertPublicMediaMetadata([{ path: 'safe.png', alt: LEAKED_PROFILE }]),
        /Unsafe public media metadata blocked/
    );
});

test('allows an ordinary grounded public post', () => {
    const text = 'I tested the new retrieval path against the same benchmark twice. Latency fell, but recall quality stayed flat.';
    assert.deepEqual(validatePublicPost(text, { platform: 'bluesky' }), { ok: true });
});

test('rejects source-field echoes and malformed generation metadata', () => {
    const cases = [
        'Title: A paper about shared memory\nURL: https://example.com/paper',
        '<EXTRA_DATA>{"message":"Observed performance patterns"}',
        '[term user] Prefer more restraint when discussing fairness.',
    ];
    for (const value of cases) {
        assert.equal(validatePublicPost(value, { platform: 'bluesky' }).ok, false, value);
    }
});

test('public context excludes the private user profile and memory tiers', async () => {
    const context = await buildSomaContext('architecture work', {
        force: true,
        publicOnly: true,
        includeUser: true,
    });
    assert.match(context, /\[SOMA PUBLIC BACKGROUND\]/);
    assert.doesNotMatch(context, /\[USER PROFILE\]/);
    assert.doesNotMatch(context, /\[MEMORY RETRIEVAL\]/);
    assert.doesNotMatch(context, /\[LEARNING SPINE\]/);
});

test('Bluesky client blocks unsafe text before attempting network access', async () => {
    const client = new BlueskeyClient();
    await assert.rejects(client.post(LEAKED_PROFILE), /Unsafe public post blocked/);
    await assert.rejects(
        client.reply(LEAKED_PROFILE, { uri: 'at://example/post/1', cid: 'cid' }),
        /Unsafe public post blocked/
    );
});

test('Studio blocks unsafe automated-agent posts', () => {
    assert.throws(
        () => studioFeed.add({ authorId: 'usr-soma', text: LEAKED_PROFILE }),
        /Unsafe public post blocked/
    );
});
