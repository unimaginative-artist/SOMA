import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveMoERouter, MOE_LANES, globalCognitiveMoERouter } from '../core/CognitiveMoERouter.js';

describe('CognitiveMoERouter', () => {
  test('Classifies basic greetings and casual conversation as CONVERSATION', async () => {
    const router = new CognitiveMoERouter();
    const r1 = await router.route('hey soma!');
    assert.equal(r1.lane, MOE_LANES.CONVERSATION);
    assert.equal(r1.requiresTools, false);
    assert.equal(r1.targetLobe, 'AURORA');

    const r2 = await router.route('how are you feeling today?');
    assert.equal(r2.lane, MOE_LANES.CONVERSATION);
    assert.equal(r2.requiresTools, false);
  });

  test('past-tense discussion of failed file search is not a new execution request', async () => {
    const router = new CognitiveMoERouter({ system1Bridge: { classifyTurn: async () => null } });
    const result = await router.route('No i spent all day trying to fix your ability to search files on that computer');
    assert.equal(result.lane, MOE_LANES.CONVERSATION);
    assert.equal(result.requiresTools, false);
  });

  test('Classifies explicit code modification and fixes as ACTION_EXECUTION', async () => {
    const router = new CognitiveMoERouter();
    const r1 = await router.route('Please fix the error handling in server/routes/somaRoutes.js');
    assert.equal(r1.lane, MOE_LANES.ACTION_EXECUTION);
    assert.equal(r1.requiresTools, true);
    assert.equal(r1.targetLobe, 'LOGOS');
    assert.ok(r1.suggestedModel.includes('qwen2.5-coder'));

    const r2 = await router.route('write a unit test for executeRoute.js and run it');
    assert.equal(r2.lane, MOE_LANES.ACTION_EXECUTION);
    assert.equal(r2.requiresTools, true);
  });

  test('Accurately routes Owner live Discord queries from 2026-09-23 session', async () => {
    const router = new CognitiveMoERouter();

    // Query 1: "open max folder and tell me the contents"
    const r1 = await router.route('Actually can you open max folder and tell me the contents');
    assert.equal(r1.lane, MOE_LANES.DIRECT_INSPECTION);
    assert.equal(r1.requiresTools, true);
    assert.equal(r1.targetLobe, 'LOGOS');

    // Query 2: "How does max look architecturally"
    const r2 = await router.route('How does max look architecturally');
    assert.equal(r2.lane, MOE_LANES.DIRECT_INSPECTION);
    assert.equal(r2.requiresTools, true);

    // Query 3: "Can you trace down max’s architecture"
    const r3 = await router.route('Can you trace down max’s architecture');
    assert.equal(r3.lane, MOE_LANES.DIRECT_INSPECTION);
    assert.equal(r3.requiresTools, true);

    // Query 4: Conversational banter: "Oh good what would you like to try first?"
    const r4 = await router.route('Oh good what would you like to try first?');
    assert.equal(r4.lane, MOE_LANES.CONVERSATION);
    assert.equal(r4.requiresTools, false);

    // Query 5: Full stack engineering request
    const r5 = await router.route('hey build me a website front end and back end');
    assert.equal(r5.lane, MOE_LANES.ACTION_EXECUTION);
    assert.equal(r5.requiresTools, true);
  });
});
