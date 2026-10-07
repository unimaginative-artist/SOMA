import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

test('improvement scorecard is wired through boot, API, chat feedback, and Command Bridge', async () => {
    const [loader, routes, chat, panel] = await Promise.all([
        fs.readFile('server/loaders/extended.js', 'utf8'),
        fs.readFile('server/loaders/routes.js', 'utf8'),
        fs.readFile('server/routes/somaRoutes.js', 'utf8'),
        fs.readFile('frontend/apps/command-bridge/panels/Cluster/ClusterOperations.jsx', 'utf8'),
    ]);
    assert.match(loader, /new ImprovementScorecard\(\{ system \}\)/);
    assert.match(routes, /\/api\/asi\/improvement-scorecard/);
    assert.match(routes, /requireSelfModificationOperatorAuth/);
    assert.match(chat, /improvementScorecard\??\.recordFeedback/);
    assert.match(panel, /Self-Improvement Scorecard/);
    assert.match(panel, /\/api\/asi\/improvement-scorecard/);
});
