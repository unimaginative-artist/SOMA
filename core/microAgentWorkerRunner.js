import { parentPort, workerData } from 'worker_threads';

async function run() {
    const { scriptPath, item, context } = workerData || {};
    if (!scriptPath) throw new Error('workerData.scriptPath is required');
    const mod = await import(`file://${scriptPath}`);
    const handler = mod.processItem || mod.default;
    if (typeof handler !== 'function') {
        throw new Error(`Worker script ${scriptPath} must export default or processItem function`);
    }
    return await handler(item, context || {});
}

run()
    .then(result => parentPort.postMessage({ success: true, result }))
    .catch(error => parentPort.postMessage({
        success: false,
        error: error.message,
        stack: error.stack
    }));
