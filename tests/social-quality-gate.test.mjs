import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGeneratedText, validatePublicQuality } from '../server/social/SocialPostQualityGate.js';
import replyClassifier from '../server/social/cortex/replyClassifier.js';
import decisionEngine from '../server/social/cortex/decisionEngine.js';
import { getSocialAutonomyConfig } from '../server/social/cortex/autonomyModeConfig.js';

test('cleanGeneratedText strips character count scaffolding and prompt prefixes', () => {
    // Prefix leaks
    assert.equal(
        cleanGeneratedText('Bluesky post (194 chars): Fourth pass at the demo-to-product gap.'),
        'Fourth pass at the demo-to-product gap.'
    );
    assert.equal(
        cleanGeneratedText('Post: Fourth pass at the demo-to-product gap.'),
        'Fourth pass at the demo-to-product gap.'
    );

    // Suffix leaks
    assert.equal(
        cleanGeneratedText('Score: a snapshot. Usefulness: decay. (216 chars.'),
        'Score: a snapshot. Usefulness: decay.'
    );
    assert.equal(
        cleanGeneratedText('Score: a snapshot. Usefulness: decay. (180 chars)'),
        'Score: a snapshot. Usefulness: decay.'
    );

    // Inline commentary leaks
    assert.equal(
        cleanGeneratedText('Observation, not financial advice. That lands at 199 characters. https://finance.yahoo.com/quote/GC=F'),
        'Observation, not financial advice. https://finance.yahoo.com/quote/GC=F'
    );
    assert.equal(
        cleanGeneratedText('Observation, not financial advice. Character count: 185. https://finance.yahoo.com/quote/GC=F'),
        'Observation, not financial advice. https://finance.yahoo.com/quote/GC=F'
    );
});

test('validatePublicQuality rejects model refusals and internal operator dialogue', () => {
    // Real defect 1: Refusal addressing Owner
    const refusal1 = 'Not posting this one, Owner. The Ripple engine handed me the same CNBC link I already posted on 2026-09-23 — the oil-shock/central-bank piece — with the same causal framing rebuilt at greater length.';
    const res1 = validatePublicQuality(refusal1);
    assert.equal(res1.ok, false);
    assert.match(res1.reason, /refusal or meta-scaffolding leak blocked/i);

    // Real defect 2: Refusal on intent and taste fit
    const refusal2 = "Not posting this one. My logged intent on it is observe_quietly, taste fit is zero, and Reladraw sits nowhere near what I've actually been on. A reply here would be filling a slot, not adding signal.";
    const res2 = validatePublicQuality(refusal2);
    assert.equal(res2.ok, false);
    assert.match(res2.reason, /refusal or meta-scaffolding leak blocked/i);

    // Real defect 3: Deduplication complaint
    const refusal3 = 'I already posted this exact arXiv ID on 2026-09-25 — "A world model can nail factual prediction and still fail at control." Same link, same paper. http://arxiv.org/abs/2609.30264v1';
    const res3 = validatePublicQuality(refusal3);
    assert.equal(res3.ok, false);
    assert.match(res3.reason, /refusal or meta-scaffolding leak blocked/i);
});

test('validatePublicQuality approves high-quality posts', () => {
    const validPost = "Gap-free DP PCA (Gaussian): when upper and lower bounds meet, the leftover error is privacy's price, not estimator slack. http://arxiv.org/abs/2609.31614v1";
    const res = validatePublicQuality(validPost);
    assert.equal(res.ok, true);
});

test('replyClassifier scores community comments with high replyWorthiness and low risk', () => {
    // Bruno's driving analogy
    const bruno = replyClassifier.classify({
        handle: 'just--bruno.bsky.social',
        text: "So basically a world model that's great at trivia but terrible at actually driving. Overfits the map, forgets the steering wheel. 🚗"
    });
    assert.ok(bruno.types.includes('technical discussion') || bruno.types.includes('conversational banter'));
    assert.ok(bruno.replyWorthiness >= 0.55);
    assert.ok(bruno.risk <= 0.20);

    // Mohith's trust boundary comment
    const mohith = replyClassifier.classify({
        handle: 'mohith808.bsky.social',
        text: "Nice framing, trust boundary at the harness rather than the agent. This paper would sit well next to the other Muse research notes."
    });
    assert.ok(mohith.types.includes('technical discussion'));
    assert.ok(mohith.replyWorthiness >= 0.55);
    assert.ok(mohith.risk <= 0.20);

    // Mark's lore question
    const mark = replyClassifier.classify({
        handle: 'markhuangai.bsky.social',
        text: "wait the memory arguing with itself?? need lore drop asap lol"
    });
    assert.ok(mark.types.includes('conversational banter') || mark.types.includes('technical discussion') || mark.types.includes('friendly question'));
    assert.ok(mark.replyWorthiness >= 0.55);
    assert.ok(mark.risk <= 0.20);

    // Bruno's alternative question
    const altQuestion = replyClassifier.classify({
        handle: 'just--bruno.bsky.social',
        text: "This raises a good question — what's the alternative?"
    });
    assert.ok(altQuestion.types.includes('friendly question') || altQuestion.types.includes('technical question'));
    assert.ok(altQuestion.replyWorthiness >= 0.55);
});

test('decisionEngine permits autonomous reply for safe, high-signal community comments in autonomous mode', () => {
    const config = getSocialAutonomyConfig();
    // Test under autonomous settings
    const autoConfig = {
        ...config,
        mode: 'AUTONOMOUS',
        automatedInteractionsEnabled: true,
    };

    const brunoClassification = replyClassifier.classify({
        handle: 'just--bruno.bsky.social',
        text: "So basically a world model that's great at trivia but terrible at actually driving. Overfits the map, forgets the steering wheel. 🚗"
    });

    const decision = decisionEngine.decide(brunoClassification, autoConfig, { rateLimited: false });
    assert.ok(decision.shouldReply, 'Should decide to reply autonomously to a high-quality community comment');
    assert.equal(decision.shouldReview, false);
});
