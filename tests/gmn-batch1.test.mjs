// Batch 1 — GMN content addressing, node identity, and site registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import GMNSiteService from '../server/services/GMNSiteService.js';
import GMNSiteRegistry from '../server/services/GMNSiteRegistry.js';
import { GMNIdentity } from '../server/services/GMNIdentity.js';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn-${label}-`));

test('node identity is stable across reloads and signs/verifies', () => {
    const file = path.join(tmp('id'), 'identity.json');
    const id = new GMNIdentity(file);
    const nodeId = id.getNodeId();
    assert.match(nodeId, /^gmn_[0-9a-f]{40}$/, 'nodeId is a gmn_ fingerprint');

    // A second instance reading the same file MUST resolve to the same identity.
    const id2 = new GMNIdentity(file);
    assert.equal(id2.getNodeId(), nodeId, 'identity persists across reloads');

    const sig = id.sign('gray matter');
    assert.equal(id.verify(id.getPublicKeyHex(), 'gray matter', sig), true, 'valid signature verifies');
    assert.equal(id.verify(id.getPublicKeyHex(), 'tampered', sig), false, 'tampered payload fails');
});

test('site bundle hash is deterministic, timestamp-independent, and content-sensitive', () => {
    const svc = new GMNSiteService({ root: tmp('sites') });
    svc.publish({ site: 'proof', title: 'Proof', description: 'd', html: '<!doctype html><html><body><h1>hello</h1></body></html>' });

    const a = svc.bundle('proof');
    const b = svc.bundle('proof');
    assert.match(a.contentHash, /^b1:[0-9a-f]{64}$/, 'hash is algorithm-tagged sha256');
    assert.equal(a.contentHash, b.contentHash, 'same content -> same hash (deterministic)');

    // Bumping only manifest timestamps must NOT change the content address.
    svc.touchManifests('proof');
    assert.equal(svc.bundle('proof').contentHash, a.contentHash, 'updatedAt does not affect hash');

    // Changing a real file MUST change the content address.
    svc.writeSourceFile('proof', '/index.html', '<!doctype html><html><body><h1>changed</h1></body></html>');
    assert.notEqual(svc.bundle('proof').contentHash, a.contentHash, 'content change -> new hash');
});

test('registry upserts, tracks replicas, persists, and reconciles local sites', () => {
    const file = path.join(tmp('reg'), 'registry.json');
    const reg = new GMNSiteRegistry({ file });

    const e1 = reg.upsert({ domain: 'foo.gmn', originNodeId: 'gmn_a', contentHash: 'b1:aaa', title: 'Foo', replicas: ['gmn_a'] });
    assert.equal(reg.get('foo.gmn').contentHash, 'b1:aaa');
    assert.equal(e1.rev, 1, 'first insert is rev 1');

    // New content hash increments the monotonic revision; replicas accumulate.
    const e2 = reg.upsert({ domain: 'foo.gmn', contentHash: 'b1:bbb', replicas: ['gmn_a'] });
    assert.equal(e2.rev, 2, 'content change increments rev');
    // A metadata-only upsert (same hash) does NOT bump rev.
    assert.equal(reg.upsert({ domain: 'foo.gmn', contentHash: 'b1:bbb', title: 'Foo 2' }).rev, 2, 'metadata change keeps rev');
    reg.addReplica('foo.gmn', 'gmn_b');
    assert.deepEqual(reg.get('foo.gmn').replicas, ['gmn_a', 'gmn_b']);

    assert.throws(() => reg.upsert({ domain: 'not a domain' }), /Invalid GMN domain/);

    // Persistence: a fresh instance on the same file sees the same rows.
    const reg2 = new GMNSiteRegistry({ file });
    assert.equal(reg2.get('foo.gmn').contentHash, 'b1:bbb');

    // reconcileLocal mirrors real on-disk sites as authoritative local rows.
    const svc = new GMNSiteService({ root: tmp('sites2') });
    svc.publish({ site: 'mine', title: 'Mine', html: '<!doctype html><html><body>x</body></html>' });
    const count = reg2.reconcileLocal(svc, 'gmn_self');
    assert.ok(count >= 1, 'reconciled at least one local site');
    const mine = reg2.get('mine.gmn');
    assert.equal(mine.originNodeId, 'gmn_self');
    assert.equal(mine.source, 'local');
    assert.match(mine.contentHash, /^b1:/);
    assert.deepEqual(mine.replicas, ['gmn_self']);
});
