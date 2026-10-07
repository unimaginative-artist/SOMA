import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Floating Chat has a client deadline, retry affordance, and bounded local-first contract', async () => {
  const [floating, bridge, routes, quadBrain, v3, sidecar] = await Promise.all([
    fs.readFile('frontend/apps/command-bridge/components/FloatingChat.jsx', 'utf8'),
    fs.readFile('frontend/apps/command-bridge/SomaCommandBridge.jsx', 'utf8'),
    fs.readFile('server/routes/somaRoutes.js', 'utf8'),
    fs.readFile('arbiters/SOMArbiterV2_QuadBrain.js', 'utf8'),
    fs.readFile('arbiters/SOMArbiterV3.js', 'utf8'),
    fs.readFile('core/LocalChatOllamaSidecar.js', 'utf8'),
  ]);

  assert.match(floating, /CHAT_CLIENT_TIMEOUT_MS\s*=\s*35_000/);
  assert.match(floating, /controller\.abort/);
  assert.match(floating, /retryText/);
  assert.match(bridge, /signal/);
  assert.match(bridge, /somaBackend\.fetch/);
  assert.match(routes, /localFirstChat/);
  assert.match(routes, /!deepThinking && !localFirstChat/);
  assert.match(routes, /SOMA_CHAT_RESERVATION_MS/);
  assert.match(routes, /SOMA_CHAT_MAX_TOKENS \|\| 128/);
  assert.match(routes, /SOMA_CHAT_TEMPERATURE \|\| 0\.4/);
  assert.match(quadBrain, /keep_alive:/);
  assert.match(quadBrain, /__SOMA_CHAT_RESERVED_UNTIL/);
  assert.match(quadBrain, /endpointOverride \|\| this\.ollamaEndpoint/);
  assert.match(sidecar, /OLLAMA_MAX_LOADED_MODELS/);
  assert.match(sidecar, /keep_alive: -1/);
  assert.match(sidecar, /__SOMA_CHAT_SIDECAR_READY = true/);
  assert.match(quadBrain, /String\(t\?\.name \|\| t\?\.function\?\.name \|\| ''\)/);
  assert.match(v3, /SOMA_CHAT_LOCAL_TIMEOUT_MS/);
  assert.match(v3, /Math\.min\(Number\(context\.maxTokens \|\| 384\), 512\)/);
  assert.match(v3, /local-degraded/);
});
