// Batch 7a — the E2E crypto foundation: X25519 identity + sealed, signed messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GMNIdentity } from '../server/services/GMNIdentity.js';
import { seal, open } from '../server/services/GMNSeal.js';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn7-${label}-`));

test('migrates an Ed25519-only identity in place — adds X25519, keeps the nodeId', () => {
    const file = path.join(tmp('mig'), 'id.json');
    // Write a pre-Batch-7 identity file (signing key only, no encryption key).
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { format: 'der', type: 'spki' },
        privateKeyEncoding: { format: 'der', type: 'pkcs8' },
    });
    const nodeId = 'gmn_' + crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 40);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ alg: 'ed25519', nodeId, publicKey: publicKey.toString('hex'), privateKey: privateKey.toString('hex'), createdAt: new Date().toISOString() }));

    const id = new GMNIdentity(file);
    assert.equal(id.getNodeId(), nodeId, 'nodeId preserved through migration');
    assert.ok(id.getEncPublicKeyHex().length > 0, 'X25519 encryption key added');

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(raw.encPublicKey && raw.encPrivateKey, 'encryption keys persisted');

    // Reload is stable — same nodeId and same encryption key.
    const id2 = new GMNIdentity(file);
    assert.equal(id2.getEncPublicKeyHex(), id.getEncPublicKeyHex());
});

test('seal/open is confidential, authenticated, recipient-only, and tamper-evident', () => {
    const alice = new GMNIdentity(path.join(tmp('a'), 'id.json'));
    const bob = new GMNIdentity(path.join(tmp('b'), 'id.json'));
    const carol = new GMNIdentity(path.join(tmp('c'), 'id.json'));
    const secret = 'meet at the old server room, midnight';

    const env = seal(secret, bob.getEncPublicKeyHex(), alice);
    assert.equal(env.alg, 'x25519-aesgcm');

    // Bob (the recipient) opens it and knows it's from Alice.
    const r = open(env, bob);
    assert.equal(r.ok, true);
    assert.equal(r.plaintext.toString('utf8'), secret);
    assert.equal(r.from, alice.getNodeId());

    // Carol (not the recipient) cannot decrypt.
    assert.equal(open(env, carol).ok, false, 'only the recipient can open');

    // Tampered ciphertext is rejected (the signature covers it).
    const flipped = { ...env, ct: env.ct.slice(0, -1) + (env.ct.slice(-1) === 'a' ? 'b' : 'a') };
    assert.equal(open(flipped, bob).ok, false, 'tampered ciphertext rejected');

    // A forged sender identity is caught (nodeId must derive from the signing key).
    assert.equal(open({ ...env, from: 'gmn_' + '0'.repeat(40) }, bob).reason, 'sender_mismatch');
});
