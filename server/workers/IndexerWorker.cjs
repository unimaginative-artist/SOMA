const { parentPort } = require('worker_threads');
const { ContentExtractor } = require('../utils/ContentExtractor.js');

const extractor = new ContentExtractor();

parentPort.on('message', async (msg) => {
    if (!msg || msg.type !== 'extract') return;
    const { filePath, requestId } = msg;
    try {
        const content = await extractor.extract(filePath);
        parentPort.postMessage({ type: 'extracted', requestId, content });
    } catch (e) {
        parentPort.postMessage({ type: 'error', requestId, error: e.message });
    }
});
