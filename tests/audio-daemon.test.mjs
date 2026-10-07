import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioDaemon, summarizeWorkerFailure } from '../core/AudioDaemon.js';

function fixture() {
    const calls = [];
    const system = {
        socialIdentity: { processIntroduction: async () => ({ handled: false }) },
        chatRuntime: { handle: async input => { calls.push(input); return { text: 'Done', cognitiveTransaction: { id: 'tx-voice' } }; } },
        toolRegistry: { execute: async (name, args) => { calls.push({ name, args }); return { success: true }; } }
    };
    return { daemon: new AudioDaemon({ system, enabled: false }), calls };
}

test('speech without wake phrase cannot execute', async () => {
    const { daemon, calls } = fixture();
    const result = await daemon.ingestTranscript('delete the project');
    assert.equal(result.handled, false);
    assert.equal(calls.length, 0);
});

test('wake phrase and command route through the shared chat runtime', async () => {
    const { daemon, calls } = fixture();
    const result = await daemon.ingestTranscript('Hey Soma, inspect the vision system');
    assert.equal(result.handled, true);
    assert.equal(calls[0].channel, 'local_voice');
    assert.equal(calls[0].message, 'inspect the vision system');
    assert.equal(calls[1].name, 'desktop_speak');
});

test('wake phrase opens a bounded follow-up command window', async () => {
    const { daemon, calls } = fixture();
    const wake = await daemon.ingestTranscript('Hey Soma');
    assert.equal(wake.awaitingCommand, true);
    await daemon.ingestTranscript('what can you see');
    assert.equal(calls[0].message, 'what can you see');
});

test('audio worker failures collapse noisy Python tracebacks into one useful device error', () => {
    const summary = summarizeWorkerFailure('Traceback...\nfoo.py line 9\nsounddevice.PortAudioError: Error opening RawInputStream: Unanticipated host error');
    assert.match(summary, /PortAudioError/);
    assert.doesNotMatch(summary, /Traceback/);
});
