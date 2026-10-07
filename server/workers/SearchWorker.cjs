
const { parentPort, workerData } = require('worker_threads');
const { LocalEmbedder } = require('../ml/LocalEmbedder.cjs');
const { ACORNAdapter } = require('../storage/ACORNAdapter.cjs');
const { ContentExtractor } = require('../utils/ContentExtractor.js'); // Ensure this can run in worker (imports might need checking)
const path = require('path');

// Initialize Singletons inside the Worker
let embedder = null;
let acornIndex = null;
let extractor = null;

async function initialize() {
    try {
        console.log('[SearchWorker] Initializing...');
        
        // 1. Load Embedder (Heavy)
        embedder = new LocalEmbedder();
        await embedder.initialize();
        
        // 2. Load Vector DB (Heavy I/O)
        // We need to pass the storage path via workerData
        const storagePath = workerData?.storagePath || path.join(process.cwd(), '.soma', 'storage');
        
        // ACORNAdapter (Disk-Based HybridDB)
        acornIndex = new ACORNAdapter();
        // Force load if needed, or it lazily loads from default path.
        // We might need to ensure it points to the correct DB path if ACORNAdapter has hardcoded paths.
        // For now, assuming ACORNAdapter default constructor handles it or we update it.
        // Actually, our ACORNAdapter uses process.cwd() which works in worker threads too.
        
        // 3. Load Content Extractor
        extractor = new ContentExtractor();

        parentPort.postMessage({ type: 'ready' });
        console.log('[SearchWorker] Ready');
    } catch (e) {
        parentPort.postMessage({ type: 'error', error: e.message });
    }
}

// Handle Messages from Main Thread
parentPort.on('message', async (msg) => {
    if (!embedder) await initialize();

    try {
        switch (msg.type) {
            case 'embed_batch':
                // msg.documents: [{ id, content, metadata }]
                const docs = msg.documents;
                const results = [];
                
                for (const doc of docs) {
                    try {
                        let text = doc.content;
                        
                        // Handle binary extraction inside worker?
                        // Or assume main thread sent raw text?
                        // "Heavy Lifter" implies we should do extraction here if possible.
                        // If path is provided, we can extract.
                        if (!text && doc.tempPath) {
                             text = await extractor.extract(doc.tempPath);
                             // Clean up temp file? Or leave for main thread?
                             // Best if worker just reads.
                        }

                        if (text) {
                            const vector = await embedder.embed(text);
                            // Store in ACORN (Disk Write)
                            await acornIndex.add(doc.id, vector, { ...doc.metadata, content: text });
                            results.push({ id: doc.id, success: true });
                        } else {
                            results.push({ id: doc.id, success: false, error: 'No content' });
                        }
                    } catch (e) {
                        results.push({ id: doc.id, success: false, error: e.message });
                    }
                    
                    // Report progress per doc
                    parentPort.postMessage({ type: 'progress', processed: results.length, total: docs.length });
                }
                
                parentPort.postMessage({ type: 'batch_complete', results });
                break;

            case 'search':
                // msg.query, msg.topK
                const vector = await embedder.embed(msg.query);
                const searchResults = await acornIndex.search(vector, msg.filters, msg.topK);
                parentPort.postMessage({ type: 'search_complete', requestId: msg.requestId, results: searchResults });
                break;
        }
    } catch (e) {
        parentPort.postMessage({ type: 'error', error: e.message });
    }
});

initialize();
