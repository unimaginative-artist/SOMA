import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchConversation } from '../server/social/TwitchConversation.js';

const context = { channel: 'owner', viewerId: '42', tenantId: 'owner:owner', botUsername: 'soma_ai' };

test('natural greetings, direct address, command, mention and native reply are recognized', () => {
    const chat = new TwitchConversation();
    for (const text of ['hey soma', 'Hi, SOMA how are you?', 'Soma, tell me a joke', 'hello soma_ai', '!soma hello', '@soma_ai hi']) {
        assert.equal(chat.match(text, context).directed, true, text);
    }
    assert.equal(chat.match('hi', { ...context, tags: { 'reply-parent-user-login': 'soma_ai' } }).directed, true);
    for (const text of ['someone told soma about this', 'somatic stuff', '@soma_ai_fake hi', '!somatic hi', '!soma-info']) {
        assert.equal(chat.match(text, context), null, text);
    }
    assert.equal(chat.match('hey soma how are you?', context).prompt, 'how are you?');
});

test('only delivered exchanges open a bounded same-viewer same-channel conversation', () => {
    let now = 1000;
    const chat = new TwitchConversation({ now: () => now });
    const turn = chat.match('hey soma', context);
    assert.equal(chat.match('how are you?', context), null);
    chat.delivered(turn, 'hello', 'Hello viewer');
    assert.equal(chat.match('and you?', { ...context, viewerId: '99' }), null);
    assert.equal(chat.match('and you?', { ...context, channel: 'friend' }), null);
    assert.equal(chat.match('and you?', { ...context, tenantId: 'new-invite' }), null);
    assert.equal(chat.match('and you?', { ...context, dryRun: true }), null);
    assert.deepEqual(chat.match('and you?', context).history, [{ viewer: 'hello', soma: 'Hello viewer' }]);
    for (const text of ['!other hi', '@another hi', '/command', 'hi']) {
        const tags = text === 'hi' ? { 'reply-parent-user-login': 'other' } : {};
        assert.equal(chat.match(text, { ...context, tags }), null);
    }
    for (let i = 0; i < 3; i++) chat.delivered(chat.match('follow up', context), 'follow up', 'reply');
    assert.equal(chat.match('fourth follow up', context), null);
    chat.delivered(chat.match('Soma, hi again', context), 'hi again', 'hi');
    now += 120001;
    assert.equal(chat.match('expired follow up', context), null);
    assert.equal(chat.sessions.size, 0);
});

test('close, revoke, missing identity, and preview cannot retain a conversation', () => {
    const chat = new TwitchConversation();
    chat.delivered(chat.match('hey soma', context), 'hello', 'hi');
    const closed = chat.match('stop talking', context);
    assert.equal(closed.closed, true);
    chat.delivered(closed, 'stop talking', 'ok');
    assert.equal(chat.sessions.size, 0);
    chat.delivered(chat.match('hey soma', context), 'hello', 'hi');
    chat.clearChannel('owner');
    assert.equal(chat.sessions.size, 0);
    chat.delivered(chat.match('hey soma', { ...context, viewerId: null }), 'hello', 'hi');
    assert.equal(chat.sessions.size, 0);
});

test('session and history retention remain bounded under public chat load', () => {
    const chat = new TwitchConversation();
    for (let i = 0; i < 510; i++) chat.delivered(chat.match('hey soma', { ...context, viewerId: String(i) }), 'hi', 'hi');
    assert.equal(chat.sessions.size, 500);
    for (let i = 0; i < 10; i++) chat.delivered(chat.match('Soma, hi', context), 'hi', 'hi');
    assert.equal(chat.match('Soma, hi', context).history.length, 3);
});
