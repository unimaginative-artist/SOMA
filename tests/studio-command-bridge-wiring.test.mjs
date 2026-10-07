import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('Command Bridge keeps native Studio and mobile Studio as separate surfaces', () => {
    const studioPanel = fs.readFileSync(
        path.join(ROOT, 'frontend', 'apps', 'command-bridge', 'panels', 'Studio', 'App.tsx'),
        'utf8'
    );
    const legacyServer = fs.readFileSync(path.join(ROOT, 'run_studio_backend_3001.mjs'), 'utf8');
    const canonicalServer = fs.readFileSync(path.join(ROOT, 'launcher_ULTRA.mjs'), 'utf8');
    const routeLoader = fs.readFileSync(path.join(ROOT, 'server', 'loaders', 'routes.js'), 'utf8');
    const nativeStage = path.join(ROOT, 'frontend', 'public', 'stage', 'Studio.dc.html');

    assert.match(studioPanel, /src="\/stage\/Studio\.dc\.html"/);
    assert.doesNotMatch(studioPanel, /src="http:\/\/localhost:8088\/"/);
    assert.match(legacyServer, /import '\.\/launcher_ULTRA\.mjs'/);
    assert.match(canonicalServer, /express\.static\(join\(__dirname, 'frontend', 'dist'\)\)/);
    assert.match(routeLoader, /safeMount\('\/api\/axis',\s+createAxisRoutes\(system\)\)/);
    assert.match(routeLoader, /safeMount\('\/api\/social',\s+createSocialRoutes\(system\)\)/);
    assert.ok(fs.existsSync(nativeStage), 'native Command Bridge Studio Stage must exist');
    assert.ok(fs.statSync(nativeStage).size > 300_000, 'native Studio Stage unexpectedly looks truncated');
});
