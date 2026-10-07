// Batch 2 — signed site-announce build/verify + registry conflict resolution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GMNIdentity } from '../server/services/GMNIdentity.js';
import { GMNSiteRegistry } from '../server/services/GMNSiteRegistry.js';
import { buildSiteAnnounce, verifySiteAnnounce } from '../server/services/GMNAnnounce.js';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn2-${label}-`));
const hash = (c) => 'b1:' + String(c).repeat(64).slice(0, 64);
const entryFor = (domain, rev = 1, c = 'a') => ({ domain, contentHash: hash(c), rev, title: `T ${domain}`, summary: 's', bytes: 10, fileCount: 1 });

test('site announce is signed, verifiable, and tamper-evident', () => {
    const id = new GMNIdentity(path.join(tmp('id'), 'id.json'));
    const a = buildSiteAnnounce(entryFor('alpha.gmn', 2), id);

    assert.equal(a.originNodeId, id.getNodeId(), 'origin is the signing node');
    assert.equal(verifySiteAnnounce(a).ok, true, 'untouched announce verifies');

    assert.equal(verifySiteAnnounce({ ...a, contentHash: hash('b') }).ok, false, 'tampered hash fails');
    assert.equal(verifySiteAnnounce({ ...a, title: 'evil' }).ok, false, 'tampered title fails');
    assert.equal(verifySiteAnnounce({ ...a, rev: 99 }).ok, false, 'tampered rev fails');
    assert.equal(verifySiteAnnounce({ ...a, originNodeId: 'gmn_' + '0'.repeat(40) }).reason, 'nodeid_mismatch', 'spoofed origin caught');
    assert.equal(verifySiteAnnounce({ ...a, domain: 'nope' }).reason, 'bad_domain', 'bad domain caught');
});

test('applyRemoteAnnounce respects rev ordering and local authority', () => {
    const reg = new GMNSiteRegistry({ file: path.join(tmp('reg'), 'r.json') });
    const id = new GMNIdentity(path.join(tmp('id2'), 'id.json'));
    const node = id.getNodeId();

    // New domain is learned as a remote row with the origin as first replica.
    assert.equal(reg.applyRemoteAnnounce(buildSiteAnnounce(entryFor('beta.gmn', 1), id)).applied, true);
    const row = reg.get('beta.gmn');
    assert.equal(row.source, 'remote');
    assert.equal(row.originNodeId, node);
    assert.deepEqual(row.replicas, [node]);

    // Higher revision updates.
    assert.equal(reg.applyRemoteAnnounce(buildSiteAnnounce(entryFor('beta.gmn', 2, 'c'), id)).applied, true);
    assert.equal(reg.get('beta.gmn').rev, 2);

    // Lower revision is rejected as stale.
    assert.equal(reg.applyRemoteAnnounce(buildSiteAnnounce(entryFor('beta.gmn', 1), id)).reason, 'stale_rev');

    // Same rev + same hash is already current (idempotent).
    assert.equal(reg.applyRemoteAnnounce(buildSiteAnnounce(entryFor('beta.gmn', 2, 'c'), id)).reason, 'already_current');

    // A site we host locally is authoritative — a remote claim cannot overwrite it.
    reg.upsert({ domain: 'mine.gmn', originNodeId: 'gmn_self', contentHash: hash('9'), source: 'local', replicas: ['gmn_self'] });
    const blocked = reg.applyRemoteAnnounce(buildSiteAnnounce(entryFor('mine.gmn', 5), id));
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'local_authoritative');
    assert.equal(reg.get('mine.gmn').source, 'local');
});
