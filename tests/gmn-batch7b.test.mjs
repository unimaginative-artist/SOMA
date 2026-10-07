// Batch 7b — ephemeral E2E messaging engine over the mesh.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GMNIdentity } from '../server/services/GMNIdentity.js';
import { GMNMessaging } from '../server/services/GMNMessaging.js';

const tmp = (l) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn7b-${l}-`));
const mkId = (l) => new GMNIdentity(path.join(tmp(l), 'id.json'));
const mkMsg = (l, identity) => new GMNMessaging({ file: path.join(tmp(l), 'm.json'), identity });

test('sealed direct message round-trips only to the intended recipient', () => {
    const alice = mkId('a'), bob = mkId('b'), carol = mkId('c');
    const aM = mkMsg('am', alice), bM = mkMsg('bm', bob), cM = mkMsg('cm', carol);

    const { wire } = aM.send(bob.getNodeId(), bob.getEncPublicKeyHex(), 'ping over the mesh');
    assert.equal(wire.to, bob.getNodeId());
    assert.equal(wire.envelope.alg, 'x25519-aesgcm');

    const r = bM.receive(wire);
    assert.equal(r.ok, true);
    assert.equal(r.from, alice.getNodeId());
    assert.equal(bM.getMessages(alice.getNodeId())[0].text, 'ping over the mesh');

    // Carol (wrong recipient) cannot open it.
    assert.equal(cM.receive(wire).ok, false, 'only the recipient can open');
    // Duplicate delivery is idempotent.
    assert.equal(bM.receive(wire).duplicate, true);
});

test('view-once locks until opened; burn-on-read sets an expiry; sweep deletes dead', () => {
    const alice = mkId('a2'), bob = mkId('b2');
    const aM = mkMsg('am2', alice), bM = mkMsg('bm2', bob);

    // view-once: body withheld until opened
    const vo = aM.send(bob.getNodeId(), bob.getEncPublicKeyHex(), 'photo', { viewOnce: true });
    bM.receive(vo.wire);
    let m = bM.getMessages(alice.getNodeId())[0];
    assert.equal(m.locked, true);
    assert.equal(m.text, '', 'view-once body hidden before open');
    bM.markOpened(alice.getNodeId(), vo.message.id);
    m = bM.getMessages(alice.getNodeId())[0];
    assert.equal(m.locked, false);
    assert.equal(m.text, 'photo');

    // burn-on-read: opening starts the timer
    const br = aM.send(bob.getNodeId(), bob.getEncPublicKeyHex(), 'secret', { burnOnReadMs: 5000 });
    bM.receive(br.wire);
    const opened = bM.markOpened(alice.getNodeId(), br.message.id);
    assert.ok(opened.expiresAt > Date.now(), 'burn timer set on read');

    // sweep removes anything already expired
    bM.threads.get(alice.getNodeId()).messages.forEach(x => { x.expiresAt = 1; });
    bM.sweep();
    assert.equal(bM.getMessages(alice.getNodeId()).length, 0, 'expired messages swept everywhere');
});
