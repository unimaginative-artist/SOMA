import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';

function fakeMessage() {
    return {
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: 'barry-1', username: 'Undeca' }
    };
}

test('remote speech fidelity removes known Hey Me injection before artifact logging', () => {
    const arbiter = new DiscordArbiter({ token: 'test-token' });
    const result = arbiter._validateRemoteSpeechFidelity({
        sourceText: '@Soma tell Erin hello at home',
        extractedSpeech: 'Hey Me, Hey Erin, Barry wanted me to tell you hello.',
        toolResult: {
            spoken: 'Hey Erin, Barry wanted me to tell you hello.'
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.corrected, true);
    assert.equal(result.speech, 'Hey Erin, Barry wanted me to tell you hello.');
    assert.ok(result.reasons.some(reason => reason.includes('Hey Me')));
});

test('remote speech fidelity rejects tool output that differs from extracted speech', () => {
    const arbiter = new DiscordArbiter({ token: 'test-token' });
    const result = arbiter._validateRemoteSpeechFidelity({
        sourceText: '@Soma say hello at home',
        extractedSpeech: 'Hello at home.',
        toolResult: {
            spoken: 'Different words.'
        }
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(reason => reason.includes('differs')));
});

test('remote speech dedupe suppresses identical source commands within the window', () => {
    const arbiter = new DiscordArbiter({ token: 'test-token' });
    const msg = fakeMessage();
    const first = arbiter._checkRemoteSpeechDedupe({
        msg,
        sourceText: '@Soma tell Erin hello at home',
        speech: 'Hey Erin, Barry wanted me to tell you hello.'
    });
    assert.equal(first.duplicate, false);

    arbiter._rememberRemoteSpeechDedupe(first.key, 'remote-speech-test');
    const second = arbiter._checkRemoteSpeechDedupe({
        msg,
        sourceText: '@Soma tell Erin hello at home',
        speech: 'Hey Erin, Barry wanted me to tell you hello.'
    });

    assert.equal(second.duplicate, true);
    assert.equal(second.previousRequestId, 'remote-speech-test');
});
