import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHAT_ENDPOINT = process.env.SOMA_CHAT_OLLAMA_ENDPOINT || 'http://127.0.0.1:11435';
const CHAT_MODEL = process.env.SOMA_CHAT_LOCAL_MODEL || 'soma-aurora:v2';
let readinessPromise = null;
let retryTimer = null;
globalThis.__SOMA_CHAT_SIDECAR_READY = false;

function ollamaExecutable() {
  if (process.env.OLLAMA_EXE) return process.env.OLLAMA_EXE;
  if (process.platform === 'win32') {
    const candidate = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'ollama';
}

async function isListening(timeoutMs = 1500) {
  try {
    const response = await fetch(`${CHAT_ENDPOINT}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilListening(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isListening()) return;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`Local chat Ollama sidecar did not bind ${CHAT_ENDPOINT}`);
}

export function ensureLocalChatOllamaSidecar() {
  if (readinessPromise) return readinessPromise;
  clearTimeout(retryTimer);
  retryTimer = null;
  readinessPromise = (async () => {
    if (!(await isListening())) {
      const child = spawn(ollamaExecutable(), ['serve'], {
        env: {
          ...process.env,
          OLLAMA_HOST: CHAT_ENDPOINT.replace(/^https?:\/\//, ''),
          OLLAMA_MAX_LOADED_MODELS: '1',
          OLLAMA_NUM_PARALLEL: '1',
          OLLAMA_KEEP_ALIVE: '-1',
        },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      child.on('error', error => { console.warn(`[SOMA] Chat sidecar launch failed: ${error.message}`); });
      await waitUntilListening();
    }

    // Load the small conversational model during SOMA startup and retain it.
    // This avoids making the first human message pay a CPU-bound cold start.
    const warm = await fetch(`${CHAT_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        prompt: 'Reply OK.',
        stream: false,
        keep_alive: -1,
        options: { num_predict: 1, temperature: 0 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!warm.ok) throw new Error(`Chat sidecar warmup failed with HTTP ${warm.status}`);
    globalThis.__SOMA_CHAT_SIDECAR_READY = true;
    return { endpoint: CHAT_ENDPOINT, model: CHAT_MODEL };
  })().catch(error => {
    globalThis.__SOMA_CHAT_SIDECAR_READY = false;
    readinessPromise = null;
    // A warmup timeout is recoverable. Without a scheduled retry /health stayed
    // 'initializing' forever although the model/server had subsequently loaded.
    retryTimer = setTimeout(() => {
      void ensureLocalChatOllamaSidecar().catch(() => {});
    }, 30000);
    retryTimer.unref?.();
    throw error;
  });
  return readinessPromise;
}

export function getLocalChatOllamaConfig() {
  return { endpoint: CHAT_ENDPOINT, model: CHAT_MODEL };
}
