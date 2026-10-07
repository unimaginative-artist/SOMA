import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const cockpitPath = path.join(
    ROOT,
    'frontend',
    'apps',
    'command-bridge',
    'panels',
    'Studio',
    'components',
    'views',
    'EcosystemView.tsx',
);

test('Ecosystem cockpit consumes authoritative Studio and Axis contracts', () => {
    const source = fs.readFileSync(cockpitPath, 'utf8');

    for (const endpoint of [
        '/api/studio/signals?limit=40',
        '/api/studio/feed?limit=80',
        '/api/studio/saved?limit=100',
        '/api/axis/directs',
        '/api/axis/communities',
        '/api/studio/notifications/',
    ]) {
        assert.ok(source.includes(endpoint), `missing ecosystem source ${endpoint}`);
    }
    assert.match(source, /REFRESH_INTERVAL_MS = 12_000/);
    assert.match(source, /studio:ecosystem-changed/);
});

test('Ecosystem cockpit actions persist and navigate into functional surfaces', () => {
    const source = fs.readFileSync(cockpitPath, 'utf8');

    assert.match(source, /\/signals\/\$\{encodeURIComponent\(signal\.id\)\}\/like/);
    assert.match(source, /\/signals\/\$\{encodeURIComponent\(signal\.id\)\}\/bookmark/);
    assert.match(source, /\/feed\/\$\{encodeURIComponent\(post\.id\)\}\/\$\{action\}/);
    assert.match(source, /new CustomEvent\('app:navigate'/);
    assert.match(source, /communityId: community\.id/);
    assert.match(source, /axisSource: chat\.axisSource \|\| 'studio'/);
});

test('Ecosystem cockpit no longer ships curated viral presentation arrays', () => {
    const source = fs.readFileSync(cockpitPath, 'utf8');

    assert.doesNotMatch(source, /TOP_SIGNALS|BRAINROT_CLIPS|NEURAL_ARCH|VOID_STATE|picsum\.photos|randomuser\.me/);
    assert.match(source, /The old viral placeholders are gone/);
});
