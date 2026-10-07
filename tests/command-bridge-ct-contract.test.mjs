import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Command Bridge embeds the canonical SOMA CT module', () => {
  const bridge = read('frontend/apps/command-bridge/SomaCommandBridge.jsx');
  assert.match(bridge, /lazy\(\(\) => import\(['"]\.\.\/command-ct\/SomaCT['"]\)\)/);
  assert.match(bridge, /id:\s*['"]terminal['"],\s*label:\s*['"]SOMA CT['"]/);
  assert.match(bridge, /activeModule === ['"]terminal['"][\s\S]{0,500}<SomaCT\s*\/>/);
});

test('SOMA CT uses the authoritative chat and continuity APIs', () => {
  const service = read('frontend/apps/command-ct/services/SomaServiceBridge.js');
  const transport = read('frontend/apps/command-ct/services/SomaChatTransport.js');
  assert.match(service, /const BACKEND_URL = ['"]\/api['"]/);
  assert.match(transport, /`\$\{this\.baseUrl\}\/soma\/chat`/);
  assert.match(transport, /`\$\{this\.baseUrl\}\/soma\/history\?/);
  assert.match(service, /getSharedSessionId\(\)/);
  assert.doesNotMatch(transport, /history:\s*this\.conversationHistory/);
});

test('SOMA CT exposes independent health and durable goal lifecycle UI', () => {
  const ct = read('frontend/apps/command-ct/SomaCT.jsx');
  const connection = read('frontend/apps/command-ct/hooks/useSomaCtConnection.js');
  const jobs = read('frontend/apps/command-ct/components/GoalJobCards.jsx');
  assert.match(ct, /label="Chat"/);
  assert.match(ct, /label="Live"/);
  assert.match(ct, /label="Approval"/);
  assert.match(connection, /goal_completed/);
  assert.match(jobs, /data-goal-status/);
});

test('system health checks the real embedded CT contract instead of retired port 4200', () => {
  const health = read('health-check.cjs');
  assert.match(health, /Command Bridge UI/);
  assert.match(health, /SOMA CT continuity API/);
  assert.doesNotMatch(health, /port:\s*4200/);
});
