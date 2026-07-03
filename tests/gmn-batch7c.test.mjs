// Batch 7c — addressing: a verified peer becomes a sealable Axis contact.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GMNIdentity, deriveNodeIdFromPublicKeyHex } from '../server/services/GMNIdentity.js';
import { GMNMessaging } from '../server/services/GMNMessaging.js';

const tmp = (l) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn7c-${l}-`));
const mkId = (l) => new GMNIdentity(path.join(tmp(l), 'id.json'));
const mkMsg = (l, identity) => new GMNMessaging({ file: path.join(tmp(l), 'm.json'), identity });

test('a peer nodeId derives from its SIGNING key — the handshake identifier', () => {
    const bob = mkId('b');
    // The mesh carries bob's signing pubkey; we must recover his gmn nodeId from it.
    assert.equal(deriveNodeIdFromPublicKeyHex(bob.getPublicKeyHex()), bob.getNodeId());
});

test('recordPeer(signing→nodeId, encPub) makes an addressable, sealable contact', () => {
    const alice = mkId('a'), bob = mkId('b2');
    const aM = mkMsg('am', alice);

    // Simulate what the arbiter does on handshake-verify: derive nodeId from the
    // peer's signing key, remember their encryption key.
    const bobNodeId = deriveNodeIdFromPublicKeyHex(bob.getPublicKeyHex());
    aM.recordPeer(bobNodeId, bob.getEncPublicKeyHex());

    // Bob shows up as a contact with an encryption key and no messages yet.
    const contact = aM.listThreads().find(t => t.peerNodeId === bobNodeId);
    assert.ok(contact, 'peer surfaces as a contact');
    assert.equal(contact.peerEncPub, bob.getEncPublicKeyHex());
    assert.equal(contact.last, null);

    // The remembered encPub is enough to seal a real message (no encPub passed to send).
    const { wire } = aM.send(bobNodeId, aM.threads.get(bobNodeId).peerEncPub, 'first contact');
    const bM = mkMsg('bm', bob);
    assert.equal(bM.receive(wire).ok, true);
    assert.equal(bM.getMessages(alice.getNodeId())[0].text, 'first contact');
});

test('one node carries separate secure threads via convo tags', () => {
    // Two Studio friends both hosted on Bob's node — different chatIds must not merge.
    const alice = mkId('a3'), bob = mkId('b3');
    const aM = mkMsg('am3', alice), bM = mkMsg('bm3', bob);
    const enc = bob.getEncPublicKeyHex();

    const w1 = aM.send(bob.getNodeId(), enc, 'hi via chat-iris', { convo: 'chat-iris' });
    const w2 = aM.send(bob.getNodeId(), enc, 'hi via chat-remy', { convo: 'chat-remy' });
    bM.receive(w1.wire); bM.receive(w2.wire);

    const iris = bM.getMessages(alice.getNodeId(), { convo: 'chat-iris' });
    const remy = bM.getMessages(alice.getNodeId(), { convo: 'chat-remy' });
    assert.equal(iris.length, 1);
    assert.equal(remy.length, 1);
    assert.equal(iris[0].text, 'hi via chat-iris');
    assert.equal(remy[0].text, 'hi via chat-remy');
    // Unfiltered still sees both.
    assert.equal(bM.getMessages(alice.getNodeId()).length, 2);
});
