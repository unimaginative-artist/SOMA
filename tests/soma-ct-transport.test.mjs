import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSseJsonStream, SomaChatTransport } from '../frontend/apps/command-ct/services/SomaChatTransport.js';
import { SomaServiceBridge } from '../frontend/apps/command-ct/services/SomaServiceBridge.js';

function chunkedBody(text, sizes) {
  const encoded = new TextEncoder().encode(text);
  let offset = 0;
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= encoded.length) return controller.close();
      const size = sizes[index++ % sizes.length];
      controller.enqueue(encoded.slice(offset, offset + size));
      offset += size;
    }
  });
}

async function collect(stream) {
  const values = [];
  for await (const value of stream) values.push(value);
  return values;
}

test('SSE parser preserves JSON frames split across arbitrary network chunks', async () => {
  const body = chunkedBody(
    'data: {"token":"hel"}\r\n\r\ndata: {"token":"lo"}\n\ndata: {"done":true,"response":"hello"}\n\n',
    [1, 2, 5, 3]
  );
  assert.deepEqual(await collect(parseSseJsonStream(body)), [
    { token: 'hel' },
    { token: 'lo' },
    { done: true, response: 'hello' }
  ]);
});

test('SSE parser reports malformed frames instead of silently losing output', async () => {
  const body = chunkedBody('data: {broken}\n\n', [2]);
  await assert.rejects(() => collect(parseSseJsonStream(body)), /Invalid SSE JSON frame/);
});

test('natural language always uses cognition; only explicit commands bypass it', () => {
  const service = Object.create(SomaServiceBridge.prototype);
  assert.equal(service.detectCommandType('build me an app and test it'), 'reasoning');
  assert.equal(service.detectCommandType('search this computer for Max'), 'reasoning');
  assert.equal(service.detectCommandType('hey are you there'), 'reasoning');
  assert.equal(service.detectCommandType('/search Max'), 'search');
  assert.equal(service.detectCommandType('/code implement a parser'), 'code');
  assert.equal(service.detectCommandType('$git status'), 'shell');
});

test('chat transport sends a server session without duplicating client history', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  let requestSignal;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    requestSignal = options.signal;
    return new Response(JSON.stringify({ success: true, response: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const transport = new SomaChatTransport({ sessionId: 'ct:device:conversation' });
    const { controller } = await transport.request({ message: 'hello' });
    transport.completeRequest(controller);
    assert.equal(requestBody.sessionId, 'ct:device:conversation');
    assert.equal(requestBody.message, 'hello');
    assert.equal(Object.hasOwn(requestBody, 'history'), false);
    transport.activeController = controller;
    transport.cancel();
    assert.equal(requestSignal.aborted, true, 'Stop remains wired after response headers arrive');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
