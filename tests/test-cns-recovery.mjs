import assert from 'assert/strict';
import messageBroker from '../core/MessageBroker.cjs';
import { SomaPolicyEngine, PolicyAction } from '../core/SomaPolicyEngine.js';
import { RecoveryCortex, FailureScenario } from '../core/RecoveryCortex.js';
import { GreenContract, GreenLevel } from '../core/GreenContract.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testSignalCompression() {
  const topic = `repo.batch.change.${Date.now()}`;
  const received = [];
  const unsubscribe = messageBroker.subscribe('repo.batch.change', (signal) => {
    if (signal.payload.files?.some(file => file.includes(topic))) {
      received.push(signal);
    }
  });

  messageBroker.emitSignal('repo.file.changed', { path: `${topic}/a.js`, filename: 'a.js' }, 'normal', 'TestDaemon');
  messageBroker.emitSignal('repo.file.changed', { path: `${topic}/b.js`, filename: 'b.js' }, 'normal', 'TestDaemon');
  messageBroker.emitSignal('repo.file.changed', { path: `${topic}/a.js`, filename: 'a.js' }, 'normal', 'TestDaemon');

  await sleep(Number(process.env.SOMA_SIGNAL_COMPRESS_MS || 1000) + 150);
  unsubscribe();

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'repo.batch.change');
  assert.deepEqual(received[0].payload.files.sort(), [`${topic}/a.js`, `${topic}/b.js`].sort());
  assert.equal(received[0].source, 'TestDaemon');
}

async function testSignalValidation() {
  let invalid = null;
  const onInvalid = (evt) => { invalid = evt; };
  messageBroker.once('signal_invalid', onInvalid);

  const result = messageBroker.emitSignal('health.warning', { issue: 'missing details' }, 'normal', 'TestDaemon');

  assert.equal(result, false);
  assert.equal(invalid.signal.type, 'health.warning');
  assert.match(invalid.error, /Missing required field 'details'/);
}

async function testPolicyEngine() {
  const engine = new SomaPolicyEngine();
  const actions = engine.evaluate({ heapUsage: 0.93, recentFailureCount: 3 }).map(item => item.action);

  assert.ok(actions.includes(PolicyAction.PAUSE_AUTONOMOUS));
  assert.ok(actions.includes(PolicyAction.TRIGGER_MEMORY_FLUSH));
  assert.ok(actions.includes(PolicyAction.SWITCH_LOCAL));
  assert.ok(actions.includes(PolicyAction.REQUIRE_HUMAN_REVIEW));
}

async function testRecoveryCortex() {
  const recovery = new RecoveryCortex({ messageBroker, maxAttempts: 1 });

  const provider = await recovery.handleFailure(FailureScenario.PROVIDER_FAILURE, { mode: 'local_only' });
  assert.equal(provider.status, 'recovered');
  assert.equal(process.env.BRAIN_MODE, 'local_only');

  const repeated = await recovery.handleFailure(FailureScenario.PROVIDER_FAILURE);
  assert.equal(repeated.status, 'escalated');

  const protocol = await recovery.handleFailure(FailureScenario.PROTOCOL_FAILURE, { ports: [3001] });
  assert.equal(protocol.status, 'needs_human_or_supervisor');
  assert.match(protocol.recommendation, /3001/);
}

async function testGreenContract() {
  const contract = new GreenContract();

  const good = await contract.verify({
    files: [{ path: 'example.js', content: 'export const value = 1;' }],
    testCommands: ['node --check example.js'],
    testResult: { ok: true, summary: 'synthetic test passed' }
  }, GreenLevel.TESTS_PASSED);

  assert.equal(good.ok, true);
  assert.equal(good.level, GreenLevel.TESTS_PASSED);

  const bad = await contract.verify({
    files: [{ path: 'broken.js', content: 'export const =' }]
  }, GreenLevel.SYNTAX_VALID);

  assert.equal(bad.ok, false);
  assert.equal(bad.checks[0].ok, false);
}

await testSignalCompression();
await testSignalValidation();
await testPolicyEngine();
await testRecoveryCortex();
await testGreenContract();

console.log('CNS recovery tests passed');
