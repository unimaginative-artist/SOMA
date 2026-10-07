import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareWorkerContext } from '../server/BrainBridge.js';
import { CtConversationStore } from '../server/services/CtConversationStore.js';
import { parseSseJsonStream } from '../frontend/apps/command-ct/services/SomaChatTransport.js';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('worker context converts streaming callbacks into serializable intent', () => {
  const onToken = () => {};
  const controller = new AbortController();
  const prepared = prepareWorkerContext({ sessionId: 'ct-test', onToken, signal: controller.signal });
  assert.equal(prepared.onToken, onToken);
  assert.equal(prepared.signal, controller.signal);
  assert.equal(prepared.workerContext.onToken, undefined);
  assert.equal(prepared.workerContext.signal, undefined);
  assert.equal(prepared.workerContext.streamTokens, true);
  assert.doesNotThrow(() => structuredClone(prepared.workerContext));
});

test('SSE parser preserves progress, token, and completion frames', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"progress":true,"message":"still searching"}\n\n'));
      controller.enqueue(encoder.encode('data: {"token":"hel"}\n\ndata: {"token":"lo"}\n\n'));
      controller.enqueue(encoder.encode('data: {"done":true,"response":"hello"}\n\n'));
      controller.close();
    }
  });
  const events = [];
  for await (const event of parseSseJsonStream(body)) events.push(event);
  assert.deepEqual(events.map(event => Object.keys(event)[0]), ['progress', 'token', 'token', 'done']);
  assert.equal(events.at(-1).response, 'hello');
});

test('conversation store persists catalogs, messages, pins, and search', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ct-'));
  const file = path.join(dir, 'ct.sqlite');
  const store = new CtConversationStore(file);
  try {
    store.upsert('owner', {
      id: 'conv-test', title: 'Architecture research', pinned: true,
      messages: [{ id: 'm1', type: 'command', content: 'Find worker architecture', timestamp: 1 }]
    });
    const found = store.list('owner', 'worker');
    assert.equal(found.length, 1);
    assert.equal(found[0].pinned, true);
    assert.equal(store.get('owner', 'conv-test').messages[0].content, 'Find worker architecture');
    assert.equal(store.delete('owner', 'conv-test'), true);
    assert.equal(store.get('owner', 'conv-test'), null);
  } finally {
    store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CT frontend and backend agree on repaired multimodal and filesystem contracts', () => {
  const bridge = read('frontend/apps/command-ct/services/SomaServiceBridge.js');
  const routes = read('server/routes/somaRoutes.js');
  assert.match(bridge, /sourcePath: source, destPath: destination/);
  assert.match(routes, /filePath or base64 image data is required/);
  assert.match(routes, /document\/extract/);
  assert.match(routes, /requireCtSession/);
});

test('generated code preview cannot combine scripts with same-origin privilege', () => {
  const source = read('frontend/apps/command-ct/components/CodeArtifact.jsx');
  assert.doesNotMatch(source, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(source, /Content-Security-Policy/);
});

test('Pulse shortcut uses Command Bridge navigation instead of removed state', () => {
  const source = read('frontend/apps/command-ct/SomaCT.jsx');
  assert.match(source, /CustomEvent\('soma:navigate'/);
  assert.doesNotMatch(source, /setShowPulseConfirm|confirmRun/);
});

