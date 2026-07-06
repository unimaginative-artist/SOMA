/**
 * server/workers/BrainWorker.cjs
 *
 * QuadBrain (SOMArbiterV3) running in its own worker thread.
 * The main HTTP thread sends messages here and awaits results —
 * inference never blocks the event loop.
 *
 * Follows the exact same pattern as SearchWorker.cjs.
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const { pathToFileURL } = require('url');

let brain = null;
let initError = null;

// ── Initialize QuadBrain in this worker ──────────────────────
async function initialize() {
    try {
        console.log('[BrainWorker] Loading SOMArbiterV3...');

        // Dynamic import of ESM module from CJS worker
        const modulePath = pathToFileURL(
            path.join(__dirname, '../../arbiters/SOMArbiterV3.js')
        ).href;

        const { SOMArbiterV3 } = await import(modulePath);

        // Minimal config — worker brain handles inference only.
        // Memory/fragment/personality wiring stays on the main thread.
        // process.env is inherited from parent (GOOGLE_AI_KEY, etc.)
        // Create a proxy ToolRegistry that sends messages back to the main thread
        const toolProxy = {
            execute: (tool, args) => {
                return new Promise((resolve, reject) => {
                    const callId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    
                    const handler = (msg) => {
                        if (msg.type === 'tool_result' && msg.callId === callId) {
                            parentPort.off('message', handler);
                            if (msg.error) reject(new Error(msg.error));
                            else resolve(msg.result);
                        }
                    };
                    
                    parentPort.on('message', handler);
                    parentPort.postMessage({ type: 'execute_tool', callId, tool, args });
                });
            },
            getToolsManifest: () => workerData.toolsManifest || []
        };

        // Fallback router for worker (System 2 requires a router to pick a brain)
        const mockRouter = {
            route: async () => ({ brain: 'LOGOS', method: 'worker_fallback', confidence: 0.9 }),
            on: () => {},
            emit: () => {}
        };

        brain = new SOMArbiterV3({
            asiEnabled: true,
            criticEnabled: false, // Skip critique in worker — main thread handles quality gates
            personalityEnabled: false,
            toolRegistry: toolProxy,
            router: mockRouter
        });

        await brain.initialize();

        console.log('[BrainWorker] SOMArbiterV3 ready');
        parentPort.postMessage({ type: 'ready' });

    } catch (err) {
        initError = err.message;
        console.error('[BrainWorker] Failed to initialize:', err.message);
        parentPort.postMessage({ type: 'init_error', error: err.message });
    }
}

// ── Handle messages from main thread ─────────────────────────
parentPort.on('message', async (msg) => {
    const { id, type } = msg;

    // Guard: if init failed, bounce all calls immediately
    if (initError && type !== 'ping') {
        parentPort.postMessage({ id, type: 'error', error: `BrainWorker init failed: ${initError}` });
        return;
    }

    try {
        switch (type) {
            case 'reason': {
                if (!brain) {
                    parentPort.postMessage({ id, type: 'error', error: 'Brain not ready yet' });
                    return;
                }
                const result = await brain.reason(msg.query, msg.context || {});
                parentPort.postMessage({ id, type: 'result', result });
                break;
            }

            case 'status': {
                const result = brain
                    ? (typeof brain.getStatus === 'function' ? brain.getStatus() : { status: 'ready', name: 'SOMArbiterV3' })
                    : { status: 'initializing' };
                parentPort.postMessage({ id, type: 'result', result });
                break;
            }

            case 'update_models': {
                if (!brain) throw new Error('Brain not ready yet');
                if (msg.baseModel) brain.ollamaModel = msg.baseModel;
                if (msg.lobeModels) Object.assign(brain.lobeModels, msg.lobeModels);
                brain._ollamaModelCache = { models: null, ts: 0 };
                parentPort.postMessage({
                    id,
                    type: 'result',
                    result: { updated: true, baseModel: brain.ollamaModel, lobeModels: brain.lobeModels }
                });
                break;
            }

            case 'ping': {
                parentPort.postMessage({ id, type: 'result', result: { alive: true, ready: !!brain } });
                break;
            }

            default:
                parentPort.postMessage({ id, type: 'error', error: `Unknown message type: ${type}` });
        }
    } catch (err) {
        console.error('[BrainWorker] Error handling message:', err.message);
        parentPort.postMessage({ id, type: 'error', error: err.message });
    }
});

// Start immediately
initialize();
