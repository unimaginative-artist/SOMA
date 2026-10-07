'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('runtime health recognizes either simulation engine and exposes autonomy evidence', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server', 'loaders', 'routes.js'), 'utf8');
  assert.match(source, /system\.simulation \|\| system\.simulationEvaluator/);
  assert.match(source, /heartbeatRunning/);
  assert.match(source, /scoreboard/);
  assert.match(source, /Missing optional credentials degrade only their connector/);
});

test('goal planner leaves SomaAgenticExecutor dispatch to the authoritative heartbeat loop', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'arbiters', 'GoalPlannerArbiter.cjs'), 'utf8');
  assert.match(source, /if \(arbiter === 'SomaAgenticExecutor'\)/);
  assert.match(source, /broker dispatch skipped/);
});
