// Batch 3 — content-addressed bundle transport: export → verify → install → render.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import GMNSiteService from '../server/services/GMNSiteService.js';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn3-${label}-`));

test('exportBundle round-trips through verify + install + render on a second node', () => {
    const origin = new GMNSiteService({ root: tmp('origin') });
    origin.publish({ site: 'shared', title: 'Shared', description: 'd', html: '<!doctype html><html><body><h1>peer content</h1></body></html>' });

    const bundle = origin.exportBundle('shared');
    assert.match(bundle.contentHash, /^b1:[0-9a-f]{64}$/);
    assert.equal(origin.verifyBundle(bundle).ok, true, 'untouched bundle verifies');
    // The transport hash equals the local content address (consistent everywhere).
    assert.equal(bundle.contentHash, origin.bundle('shared').contentHash);

    // A different "node" installs the bundle and renders it through ITS OWN sandbox.
    const cache = new GMNSiteService({ root: tmp('cache'), seed: false });
    const resolved = cache.installBundle(bundle);
    assert.equal(resolved.canonical, 'shared.gmn');
    assert.equal(cache.readManifest('shared').contentHash, bundle.contentHash, 'cache records the content hash');

    const rendered = cache.render('shared.gmn');
    assert.ok(rendered.content.toString('utf8').includes('peer content'), 'peer site renders locally');
});

test('verifyBundle and installBundle reject tampered bundles', () => {
    const origin = new GMNSiteService({ root: tmp('o2') });
    origin.publish({ site: 'safe', title: 'Safe', html: '<!doctype html><html><body>ok</body></html>' });
    const bundle = origin.exportBundle('safe');

    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.files[0].data = Buffer.from('<!doctype html><html><body>EVIL</body></html>').toString('base64');
    assert.equal(origin.verifyBundle(tampered).ok, false, 'tampered bytes fail the content hash');

    const cache = new GMNSiteService({ root: tmp('c2'), seed: false });
    assert.throws(() => cache.installBundle(tampered), /verification failed/i, 'install refuses an unverified bundle');
});
