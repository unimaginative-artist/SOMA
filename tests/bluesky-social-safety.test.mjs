import test from 'node:test';
import assert from 'node:assert/strict';
import { replyRefsFromPost, validateReplyRefs } from '../server/social/BlueskyReplyRefs.js';
import { normalizeBlueskyFeedPost } from '../server/social/BlueskeyClient.js';
import { assessSocialAccount } from '../server/social/SocialAccountSafety.js';
import { getSocialAutonomyConfig } from '../server/social/cortex/autonomyModeConfig.js';
import decisionEngine from '../server/social/cortex/decisionEngine.js';
import replyClassifier from '../server/social/cortex/replyClassifier.js';

const ref = (name) => ({ uri: `at://did:plc:test/app.bsky.feed.post/${name}`, cid: `cid-${name}` });

test('top-level Bluesky replies use the target as both parent and root', () => {
    const post = { ...ref('parent'), record: { text: 'hello' } };
    assert.deepEqual(replyRefsFromPost(post), { parent: ref('parent'), root: ref('parent'), threadUri: ref('parent').uri });
});

test('nested Bluesky replies preserve the original thread root', () => {
    const post = { ...ref('child'), record: { text: 'nested', reply: { root: ref('root'), parent: ref('prior') } } };
    const normalized = normalizeBlueskyFeedPost(post);
    assert.deepEqual(normalized.parentRef, ref('child'));
    assert.deepEqual(normalized.rootRef, ref('root'));
    assert.equal(normalized.threadUri, ref('root').uri);
});

test('invalid reply strong references fail closed', () => {
    assert.throws(() => validateReplyRefs({ uri: 'at://missing-cid' }), /valid AT URI and CID/);
});

test('account safety blocks adult, moderation, scam, and mass-follow signals', () => {
    const base = { did: 'did:plc:person', handle: 'person.bsky.social', description: 'A legitimate technical profile with enough context.', avatar: 'https://example/avatar', postsCount: 20, followersCount: 20, followsCount: 30 };
    assert.equal(assessSocialAccount(base).ok, true);
    assert.equal(assessSocialAccount({ ...base, displayName: 'Explicit 🔞' }).blocked, true);
    assert.equal(assessSocialAccount({ ...base, labels: [{ val: 'porn' }] }).blocked, true);
    assert.equal(assessSocialAccount({ ...base, description: 'Guaranteed forex returns, DM me' }).blocked, true);
    assert.equal(assessSocialAccount({ ...base, followersCount: 4, followsCount: 2000 }).blocked, true);
});

test('threading bug reports are treated as actionable operational feedback', () => {
    const classification = replyClassifier.classify({ text: 'FYI your reply threading is broken', handle: 'person.example' });
    assert.ok(classification.types.includes('operational feedback'));
    assert.ok(classification.replyWorthiness >= 0.65);
});

test('warm known people can pass without growth-hacking profile signals', () => {
    const result = assessSocialAccount({ did: 'did:plc:known', handle: 'known.bsky.social' }, { warm: true });
    assert.equal(result.ok, true);
});

test('Bluesky defaults to assisted drafts with automated interactions disabled', () => {
    const priorMode = process.env.SOMA_BLUESKY_AUTONOMY;
    const priorOptIn = process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS;
    delete process.env.SOMA_BLUESKY_AUTONOMY;
    delete process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS;
    try {
        const config = getSocialAutonomyConfig();
        assert.equal(config.mode, 'ASSISTED');
        assert.equal(config.automatedInteractionsEnabled, false);
        const decision = decisionEngine.decide({
            types: [], risk: 0.01, sentiment: 0.9, spam: false, hostile: false,
            confidence: 0.99, replyWorthiness: 0.9, loopRisk: 0,
        }, config);
        assert.equal(decision.action, 'draft');
        assert.equal(decision.shouldLike, false);
        assert.equal(decision.shouldReply, false);
        assert.equal(decision.shouldDraft, true);
    } finally {
        if (priorMode === undefined) delete process.env.SOMA_BLUESKY_AUTONOMY; else process.env.SOMA_BLUESKY_AUTONOMY = priorMode;
        if (priorOptIn === undefined) delete process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS; else process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS = priorOptIn;
    }
});

test('autonomous mode still requires an explicit automated-interaction opt-in', () => {
    const priorMode = process.env.SOMA_BLUESKY_AUTONOMY;
    const priorOptIn = process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS;
    process.env.SOMA_BLUESKY_AUTONOMY = 'AUTONOMOUS';
    delete process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS;
    try {
        assert.equal(getSocialAutonomyConfig().automatedInteractionsEnabled, false);
        assert.equal(getSocialAutonomyConfig().mode, 'ASSISTED');
        assert.equal(getSocialAutonomyConfig().requestedMode, 'AUTONOMOUS');
        process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS = 'true';
        assert.equal(getSocialAutonomyConfig().automatedInteractionsEnabled, true);
        assert.equal(getSocialAutonomyConfig().mode, 'AUTONOMOUS');
    } finally {
        if (priorMode === undefined) delete process.env.SOMA_BLUESKY_AUTONOMY; else process.env.SOMA_BLUESKY_AUTONOMY = priorMode;
        if (priorOptIn === undefined) delete process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS; else process.env.SOMA_BLUESKY_ALLOW_AUTOMATED_INTERACTIONS = priorOptIn;
    }
});
