// Batch 4 — replication: pin store, signed replica announces, replica recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import GMNSiteService from '../server/services/GMNSiteService.js';
import { GMNPinStore } from '../server/services/GMNPinStore.js';
import { GMNSiteRegistry } from '../server/services/GMNSiteRegistry.js';
import { GMNIdentity } from '../server/services/GMNIdentity.js';
import { buildReplicaAnnounce, verifyReplicaAnnounce } from '../server/services/GMNAnnounce.js';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn4-${label}-`));
const hash = (c) => 'b1:' + String(c).repeat(64).slice(0, 64);
const makeBundle = (origin, site, body) => {
    origin.publish({ site, title: site, html: `<!doctype html><html><body>${body}</body></html>` });
    return origin.exportBundle(site);
};

test('pin store holds verified replicas, serves them, and evicts at the cap', () => {
    const origin = new GMNSiteService({ root: tmp('o') });
    const store = new GMNPinStore({ root: tmp('cache'), indexFile: path.join(tmp('idx'), 'pins.json'), maxPins: 2 });

    store.pin(makeBundle(origin, 'alpha', 'AAA'));
    assert.equal(store.has('alpha.gmn'), true);
    assert.ok(store.render('alpha.gmn').content.toString('utf8').includes('AAA'), 'pinned site renders through sandbox');

    // A tampered bundle is refused (never pinned).
    const a = origin.exportBundle('alpha');
    const bad = JSON.parse(JSON.stringify(a));
    bad.files[0].data = Buffer.from('<html><body>EVIL</body></html>').toString('base64');
    assert.throws(() => store.pin(bad), /verify failed/i);

    // Cap of 2: a third pin forces an LRU eviction.
    store.pin(makeBundle(origin, 'beta', 'BBB'));
    store.pin(makeBundle(origin, 'gamma', 'CCC'));
    assert.ok(store.stats().pins <= 2, 'respects max pins');
});

test('replica announce is signed and tamper-evident', () => {
    const id = new GMNIdentity(path.join(tmp('id'), 'id.json'));
    const ra = buildReplicaAnnounce('beta.gmn', hash('a'), id);
    assert.equal(ra.replicaNodeId, id.getNodeId());
    assert.equal(verifyReplicaAnnounce(ra).ok, true);
    assert.equal(verifyReplicaAnnounce({ ...ra, contentHash: hash('b') }).ok, false);
    assert.equal(verifyReplicaAnnounce({ ...ra, replicaNodeId: 'gmn_' + '0'.repeat(40) }).reason, 'nodeid_mismatch');
});

test('registry.recordReplica only records replicas of the current content', () => {
    const reg = new GMNSiteRegistry({ file: path.join(tmp('r'), 'r.json') });
    reg.upsert({ domain: 'beta.gmn', originNodeId: 'gmn_o', contentHash: hash('a'), source: 'remote', replicas: ['gmn_o'] });

    assert.equal(reg.recordReplica('beta.gmn', hash('a'), 'gmn_b').recorded, true);
    assert.ok(reg.get('beta.gmn').replicas.includes('gmn_b'));
    assert.equal(reg.recordReplica('beta.gmn', hash('a'), 'gmn_b').reason, 'already_replica');
    assert.equal(reg.recordReplica('beta.gmn', hash('z'), 'gmn_c').reason, 'hash_mismatch', 'replica of stale content rejected');
    assert.equal(reg.recordReplica('nope.gmn', hash('a'), 'gmn_x').reason, 'unknown_domain');
});
