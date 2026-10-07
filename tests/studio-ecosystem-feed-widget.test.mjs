import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const widgetPath = path.join(
    ROOT,
    'frontend',
    'apps',
    'command-bridge',
    'panels',
    'Studio',
    'components',
    'widgets',
    'AppsFeedWidget.tsx',
);
const ecosystemPath = path.join(
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

test('Stage ecosystem widget reads the durable shared Studio feed', () => {
    const source = fs.readFileSync(widgetPath, 'utf8');

    assert.match(source, /\/api\/studio\/feed\?limit=\$\{FEED_LIMIT\}/);
    assert.match(source, /payload\.posts/);
    assert.match(source, /SHARED ECOSYSTEM FEED/);
    assert.match(source, /CONNECTED/);
    assert.doesNotMatch(source, /CONTENT_TEMPLATES|APPS_CONFIG|Math\.random/);
});

test('Stage ecosystem widget persists lightning-bolt reactions', () => {
    const source = fs.readFileSync(widgetPath, 'utf8');

    assert.match(source, /\/api\/studio\/feed\/\$\{encodeURIComponent\(post\.id\)\}\/like/);
    assert.match(source, /delta: nextLiked \? 1 : -1/);
    assert.match(source, /viewerLiked/);
    assert.match(source, /<Zap/);
    assert.doesNotMatch(source, /<Heart|Heart,/);
});

test('Ecosystem save action uses bookmark semantics rather than a heart', () => {
    const source = fs.readFileSync(ecosystemPath, 'utf8');

    assert.match(source, /toggleSignalBookmark/);
    assert.match(source, /togglePost\(post, 'bookmark'\)/);
    assert.match(source, /viewerBookmarked/);
    assert.doesNotMatch(source, /\bHeart\b/);
});
