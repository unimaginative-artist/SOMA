import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AutonomousCapabilityExpansion } from '../arbiters/AutonomousCapabilityExpansion.js';

test('dormant capability integration works with a standard console-style logger', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-ace-'));
  const arbiterDir = path.join(baseDir, 'arbiters');
  await fs.mkdir(arbiterDir, { recursive: true });
  await fs.writeFile(path.join(arbiterDir, 'FixtureArbiter.js'), `
    export default class FixtureArbiter {
      constructor() { this.name = 'FixtureArbiter'; }
      async initialize() { this.ready = true; }
      getStatus() { return { ready: this.ready }; }
    }
  `, 'utf8');

  const messages = [];
  const expansion = new AutonomousCapabilityExpansion({
    logger: {
      info: message => messages.push(message),
      warn: message => messages.push(message),
      error: message => messages.push(message)
    }
  });
  expansion.baseDir = baseDir;

  const system = {};
  const result = await expansion.integrateDormantCapability('FixtureArbiter', system);

  assert.equal(result.success, true, result.error);
  const manifest = JSON.parse(await fs.readFile(path.join(baseDir, '.soma', 'arbiter_manifest.json'), 'utf8'));
  assert.equal(system.fixturearbiter.ready, true);
  assert.equal(manifest.FixtureArbiter.status, 'arrived');
  assert.ok(messages.some(message => message.includes('Manifest physically synchronized')));
  assert.ok(messages.some(message => message.includes('PHYSICALLY INTEGRATED')));
});
