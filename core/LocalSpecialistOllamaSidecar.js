import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SPECIALIST_ENDPOINT = process.env.SOMA_SPECIALIST_OLLAMA_ENDPOINT || 'http://127.0.0.1:11436';
const SPECIALIST_MODEL = process.env.SOMA_DISCORD_SPECIALIST_MODEL || 'soma-logos:v2';
let readinessPromise = null;

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
        const response = await fetch(`${SPECIALIST_ENDPOINT}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
        return response.ok;
    } catch { return false; }
}

async function waitUntilListening(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isListening()) return;
        await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw new Error(`Local specialist Ollama sidecar did not bind ${SPECIALIST_ENDPOINT}`);
}

export function ensureLocalSpecialistOllamaSidecar() {
    if (readinessPromise) return readinessPromise;
    readinessPromise = (async () => {
        if (!(await isListening())) {
            const child = spawn(ollamaExecutable(), ['serve'], {
                env: {
                    ...process.env,
                    OLLAMA_HOST: SPECIALIST_ENDPOINT.replace(/^https?:\/\//, ''),
                    OLLAMA_MAX_LOADED_MODELS: '1',
                    OLLAMA_NUM_PARALLEL: '1',
                    OLLAMA_KEEP_ALIVE: '-1'
                },
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
            await waitUntilListening();
        }
        const warm = await fetch(`${SPECIALIST_ENDPOINT}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: SPECIALIST_MODEL,
                prompt: 'Reply OK.', stream: false, keep_alive: -1,
                options: { num_predict: 1, temperature: 0 }
            }),
            signal: AbortSignal.timeout(180_000)
        });
        if (!warm.ok) throw new Error(`Specialist sidecar warmup failed with HTTP ${warm.status}`);
        return { endpoint: SPECIALIST_ENDPOINT, model: SPECIALIST_MODEL };
    })().catch(error => {
        readinessPromise = null;
        throw error;
    });
    return readinessPromise;
}

export function getLocalSpecialistOllamaConfig() {
    return { endpoint: SPECIALIST_ENDPOINT, model: SPECIALIST_MODEL };
}

