'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkGovernor } = require('../core/WorkGovernor.cjs');
const { STATUS } = require('../core/GoalLifecycle.cjs');

test('autonomous ideas become durable proposals while human work is admitted', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-governor-'));
  const governor = new WorkGovernor({ dataDir });
  assert.equal(governor.decide({ title: 'Explore thermodynamics', category: 'research' }, 'autonomous').admitted, false);
  assert.equal(governor.decide({ title: 'Build my app', category: 'engineering' }, 'discord_admin').admitted, true);
  const first = governor.submitProposal({ title: 'Explore thermodynamics', category: 'research' }, 'curiosity');
  const duplicate = governor.submitProposal({ title: 'Explore thermodynamics!', category: 'research' }, 'council');
  assert.equal(first.proposalOnly, true);
  assert.equal(duplicate.deduped, true);
  assert.equal(governor.list().length, 1);
});

test('startup reconciliation defers autonomous executable noise without deleting it', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-governor-'));
  const governor = new WorkGovernor({ dataDir });
  const autonomous = { id: 'a', title: 'Moonshot', category: 'moonshot', status: STATUS.ACTIVE, metadata: { source: 'autonomous' } };
  const human = { id: 'h', title: 'Discord task', category: 'engineering', status: STATUS.ACTIVE, metadata: { source: 'discord_admin' } };
  const goals = new Map([['a', autonomous], ['h', human]]);
  const active = new Set(['a', 'h']);
  assert.equal(governor.reconcileExisting(goals, active).deferred, 1);
  assert.equal(autonomous.status, STATUS.DEFERRED);
  assert.equal(active.has('a'), false);
  assert.equal(active.has('h'), true);
});

test('self-evolution is executable only with an ASI benchmark contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-governor-evolution-'));
  const governor = new WorkGovernor({ dataDir: root });
  const base = {
    title: 'Improve research',
    category: 'asi_kernel',
    metadata: {
      admissionClass: 'self_evolution',
      allowAutonomousExecution: true,
      benchmarkTests: ['tests/agency-proving-ground.test.cjs'],
      capabilityContract: { objective: 'Improve research' },
      missionDirectorApproved: true,
      expectedArtifact: 'data/self-evolution/research.md'
    }
  };
  assert.equal(governor.decide(base, 'ASIKernel').admitted, true);
  assert.equal(governor.decide({ ...base, metadata: { ...base.metadata, missionDirectorApproved: false } }, 'ASIKernel').admitted, false);
  assert.equal(governor.decide({ ...base, metadata: { ...base.metadata, benchmarkTests: [] } }, 'ASIKernel').admitted, false);
  assert.equal(governor.decide(base, 'curiosity').admitted, false);
  fs.rmSync(root, { recursive: true, force: true });
});
