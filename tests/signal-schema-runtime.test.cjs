'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SignalRegistry } = require('../core/SignalSchema.cjs');

test('engineering swarm health reports use a registered runtime signal', () => {
  const registry = new SignalRegistry();
  assert.doesNotThrow(() => registry.validate({ type: 'swarm.health.report', payload: { healthy: true } }));
  assert.equal(registry.definitions.has('swarm.health.report'), true);
});
