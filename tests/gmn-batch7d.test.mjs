// Batch 7d — view-once MEDIA + read/screenshot receipts on the sealed engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GMNIdentity } from '../server/services/GMNIdentity.js';
import { GMNMessaging } from '../server/services/GMNMessaging.js';

const tmp = (l) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn7d-${l}-`));
const mkId = (l) => new GMNIdentity(path.join(tmp(l), 'id.json'));
const mkMsg = (l, identity) => new GMNMessaging({ file: path.join(tmp(l), 'm.json'), identity });

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA';

test('view-once media is sealed and withheld until opened', () => {
    const alice = mkId('a'), bob = mkId('b');
    const aM = mkMsg('am', alice), bM = mkMsg('bm', bob);

    const { wire, message } = aM.send(bob.getNodeId(), bob.getEncPublicKeyHex(), '', {
        viewOnce: true, media: PIXEL, mediaType: 'image',
    });
    assert.equal(wire.envelope.alg, 'x25519-aesgcm');

    bM.receive(wire);
    let m = bM.getMessages(alice.getNodeId())[0];
    assert.equal(m.locked, true, 'incoming view-once media locked before open');
    assert.equal(m.media, null, 'media withheld while locked');
    assert.equal(m.mediaType, 'image');

    bM.markOpened(alice.getNodeId(), message.id);
    m = bM.getMessages(alice.getNodeId())[0];
    assert.equal(m.locked, false);
    assert.equal(m.media, PIXEL, 'media revealed after open');
});

test('read receipt marks the sender’s outgoing message read', () => {
    const alice = mkId('a2'), bob = mkId('b2');
    const aM = mkMsg('am2', alice), bM = mkMsg('bm2', bob);

    const { wire, message } = aM.send(bob.getNodeId(), bob.getEncPublicKeyHex(), 'seen this?');
    bM.receive(wire);
    // Sender applies the read receipt that would arrive over the mesh.
    aM.markRead(bob.getNodeId(), message.id);
    const out = aM.getMessages(bob.getNodeId())[0];
    assert.equal(out.status, 'read');
    assert.ok(out.readAt > 0, 'readAt stamped on the sender copy');
});

test('screenshot is recorded on the sender copy', () => {
    const alice = mkId('a3'), bob = mkId('b3');
    const aM = mkMsg('am3', alice), bM = mkMsg('bm3', bob);
    const { wire, message } = aM.send(bob.getNodeId(), bob.getEncPublicKeyHex(), 'secret', { viewOnce: true });
    bM.receive(wire);
    // Bob screenshots → sender applies the screenshot receipt.
    aM.markScreenshot(bob.getNodeId(), message.id);
    assert.equal(aM.getMessages(bob.getNodeId())[0].screenshot, true);
});
