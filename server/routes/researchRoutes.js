
import express from 'express';
import { ContentExtractor } from '../utils/ContentExtractor.js';

const router = express.Router();
const extractor = new ContentExtractor();

export default function(system) {
    // Helper to get the arbiter
    const getArbiter = () => system.hybridSearchArbiter || system.hybridSearch;

    // POST /api/research/query
    router.post('/query', async (req, res) => {
        try {
            const arbiter = getArbiter();
            if (!arbiter) {
                return res.status(503).json({ success: false, error: 'Hybrid Search Arbiter not initialized' });
            }

            const { query, filters, options, topK } = req.body;
            
            // Allow override of topK via options or root param
            const searchOptions = {
                topK: topK || 20,
                ...options
            };

            const results = await arbiter.search(query, filters, searchOptions);
            res.json(results);

        } catch (error) {
            console.error('[Research API] Query error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/research/ingest
    router.post('/ingest', async (req, res) => {
        try {
            const arbiter = getArbiter();
            if (!arbiter) {
                return res.status(503).json({ success: false, error: 'Hybrid Search Arbiter not initialized' });
            }

            const { documents, options } = req.body;
            
            if (!Array.isArray(documents)) {
                return res.status(400).json({ success: false, error: 'documents must be an array' });
            }

            // Pre-process documents: Handle Base64 decoding for binary files
            for (const doc of documents) {
                if (doc.encoding === 'base64' && doc.content) {
                    try {
                        const buffer = Buffer.from(doc.content, 'base64');
                        // Use Extractor directly on buffer if possible, or save temp?
                        // ContentExtractor currently takes a filePath.
                        // We need to extend ContentExtractor to support Buffers, OR write temp file.
                        // Since we are "Superhuman", let's be efficient and use Buffers if the library supports it.
                        // pdf-parse supports buffer. mammoth supports buffer.
                        // But our `extractor.extract(filePath)` expects a path.
                        
                        // Hack: Write to temp file for now to reuse existing logic
                        // In production, we'd refactor Extractor to take Buffer.
                        // Actually, let's just write to temp, it's safer for diverse formats.
                        
                        const tempPath = `./tmp/${doc.name}`; // Ensure tmp exists
                        const fs = await import('fs/promises');
                        // Ensure tmp dir
                        await fs.mkdir('./tmp', { recursive: true });
                        await fs.writeFile(tempPath, buffer);
                        
                        const extractedText = await extractor.extract(tempPath);
                        
                        // Clean up
                        await fs.unlink(tempPath);
                        
                        if (extractedText) {
                            doc.content = extractedText;
                            doc.encoding = 'utf-8'; // Reset
                        } else {
                            // Extraction failed or empty
                            console.warn(`[Ingest] Could not extract text from ${doc.name}`);
                            doc.content = ""; // Skip indexing content
                        }
                    } catch (e) {
                        console.error(`[Ingest] Base64 processing error for ${doc.name}:`, e);
                        doc.content = "";
                    }
                }
            }

            // Use batch indexing if available, else loop
            let results;
            if (typeof arbiter.indexBatch === 'function') {
                results = await arbiter.indexBatch(documents, options);
            } else {
                // Fallback loop
                let successful = 0;
                let failed = 0;
                const errors = [];
                
                for (const doc of documents) {
                    if (!doc.content) continue; // Skip empty
                    const result = await arbiter.indexDocument(doc);
                    if (result.success) successful++;
                    else {
                        failed++;
                        errors.push(result.error);
                    }
                }
                results = { total: documents.length, successful, failed, errors };
            }

            res.json({ success: true, results });

        } catch (error) {
            console.error('[Research API] Ingest error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /api/research/stats
    router.get('/stats', (req, res) => {
        const arbiter = getArbiter();
        if (!arbiter) {
            return res.json({ success: true, stats: { status: 'loading', documents: 0, message: 'Search arbiter loading...' } });
        }
        res.json({ success: true, stats: arbiter.getStatus() });
    });

    // GET /api/research/tags
    router.get('/tags', (req, res) => {
        const arbiter = getArbiter();
        if (!arbiter) {
            return res.status(503).json({ success: false, error: 'Hybrid Search Arbiter not initialized' });
        }
        
        const { prefix, limit } = req.query;
        const tags = arbiter.getAllTags({ 
            prefix: prefix || '', 
            limit: parseInt(limit) || 100 
        });
        
        res.json({ success: true, tags });
    });

    // POST /api/research/cache/clear
    router.post('/cache/clear', (req, res) => {
        const arbiter = getArbiter();
        if (!arbiter) {
            return res.status(503).json({ success: false, error: 'Hybrid Search Arbiter not initialized' });
        }
        
        const result = arbiter.clearCache();
        res.json(result);
    });

    // POST /api/research/patterns
    // Analyze corpus for topics, clusters, and gaps
    router.post('/patterns', async (req, res) => {
        const arbiter = getArbiter();
        if (!arbiter) {
            return res.status(503).json({ success: false, error: 'Hybrid Search Arbiter not initialized' });
        }

        try {
            const { k } = req.body;
            const result = await arbiter.detectPatterns({ k: k || 10 });
            res.json(result);
        } catch (error) {
            console.error('[Research API] Pattern detection error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}
