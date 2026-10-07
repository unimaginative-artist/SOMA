import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('legacy Command Bridge entry point delegates to authoritative SOMA runtime', () => {
    const legacyServer = read('run_studio_backend_3001.mjs');
    const canonicalServer = read('launcher_ULTRA.mjs');
    const routeLoader = read('server', 'loaders', 'routes.js');

    assert.match(legacyServer, /import '\.\/launcher_ULTRA\.mjs'/);
    assert.match(routeLoader, /safeMount\('\/api\/social', createSocialRoutes\(system\)\)/);
    assert.match(canonicalServer, /app\.use\('\/api', \(req, res\)/);
    assert.match(canonicalServer, /code: 'API_ROUTE_NOT_FOUND'/);
});

test('social clients reject HTML instead of parsing it as JSON', () => {
    const helper = read('frontend', 'apps', 'command-bridge', 'utils', 'jsonRequest.js');
    const module = read('frontend', 'apps', 'command-bridge', 'components', 'SocialModule.jsx');
    const simulation = read('frontend', 'apps', 'command-bridge', 'components', 'SimulationSuite.jsx');
    const widget = read(
        'frontend',
        'apps',
        'command-bridge',
        'panels',
        'Studio',
        'components',
        'widgets',
        'SocialActivityWidget.tsx',
    );

    assert.match(helper, /content-type/);
    assert.match(helper, /reached a web page instead of its API route/);
    assert.match(module, /jsonRequest\('\/api\/social\/cockpit'\)/);
    assert.match(simulation, /jsonRequest\('\/api\/social\/cockpit'\)/);
    assert.doesNotMatch(widget, /fetch\('\/api\/social\/cockpit'\).*\.json\(\)/);
});

test('JSON response guard explains HTML route leaks without a parser exception', async () => {
    const { readJsonResponse } = await import(
        '../frontend/apps/command-bridge/utils/jsonRequest.js'
    );
    const response = new Response('<!DOCTYPE html><title>Wrong route</title>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    await assert.rejects(
        readJsonResponse(response, '/api/social/cockpit'),
        /reached a web page instead of its API route \(404\)/,
    );
});
