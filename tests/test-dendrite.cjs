#!/usr/bin/env node
/**
 * Smoke test for WebScraperDendrite objective browsing.
 *
 * Usage:
 *   node tests/test-dendrite.cjs
 */

const { WebScraperDendrite } = require('../cognitive/WebScraperDendrite.cjs');

async function main() {
  const dendrite = new WebScraperDendrite({
    name: 'DendriteSmokeTest',
    maxConcurrent: 1,
    minDelay: 10,
    maxDelay: 20,
    scrollSteps: 1,
    scrollDelay: 10,
    enableScreenshots: false
  });

  try {
    await dendrite.initialize();
    const result = await dendrite.browseObjective({
      objective: 'Dendrite smoke test',
      seedUrls: ['https://example.com'],
      maxPages: 1,
      timeoutMs: 15000
    });

    const page = result.pages?.[0];
    const ok = result.success && page && !page.error && page.title && page.text?.includes('Example Domain');
    console.log(JSON.stringify({
      success: !!ok,
      count: result.count,
      title: page?.title,
      status: page?.status,
      textLength: page?.text?.length || 0,
      error: page?.error || result.error || null
    }, null, 2));

    if (!ok) process.exitCode = 1;
  } finally {
    await dendrite.shutdown().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
