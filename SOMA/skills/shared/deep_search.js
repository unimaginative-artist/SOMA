/**
 * Deep Search Skill (v2 - Hybrid Search Integration)
 * 
 * Leverages SOMA's HybridSearchArbiter and MnemonicIndexerArbiter
 * for high-performance file and knowledge retrieval.
 */

module.exports = {
    name: 'deep_search',
    description: 'Find files and knowledge using SOMA\'s hybrid vector + keyword search engine. Can initiate directory scans if needed.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The search query or keywords.'
            },
            searchPath: {
                type: 'string',
                description: 'Optional: Start a new scan on this specific directory if results are missing.'
            },
            mode: {
                type: 'string',
                enum: ['recall', 'scan', 'both'],
                default: 'both',
                description: 'Whether to just search memory (recall) or scan new folders (scan).'
            }
        },
        required: ['query']
    },
    execute: async ({ query, searchPath, mode = 'both' }, { system, logger }) => {
        const hybridSearch = system?.hybridSearch;
        const indexer = system?.indexer || system?.mnemonicIndexer;
        const results = [];
        let message = '';

        logger.info(`[DeepSearch] Initiating search for: "${query}" (mode: ${mode})`);

        // 1. QUERY EXISTING MEMORY (Hybrid Search)
        if (mode !== 'scan' && hybridSearch) {
            try {
                const searchResult = await hybridSearch.search(query, {}, { topK: 10 });
                if (searchResult.success && searchResult.results.length > 0) {
                    searchResult.results.forEach(r => {
                        results.push({
                            name: r.metadata?.name || r.id,
                            path: r.metadata?.path || r.id,
                            score: r.finalScore,
                            type: r.metadata?.type || 'knowledge'
                        });
                    });
                }
            } catch (e) {
                logger.error(`[DeepSearch] HybridSearch failed: ${e.message}`);
            }
        }

        // 2. TRIGGER SCAN IF REQUESTED AND NO RESULTS
        if (results.length === 0 && searchPath && indexer && mode !== 'recall') {
            message = `I couldn't find "${query}" in my current memory. Initiating a Deep Scan of 
${searchPath}
 now...

`;
            try {
                const scanResult = await indexer.scanDirectory(searchPath);
                message += `✅ Scan complete. Indexed ${scanResult.count} files in ${scanResult.duration}s. I am now processing the new data. Try your search again in a moment.`;
                
                return { success: true, message };
            } catch (e) {
                return { success: false, message: `Failed to scan directory: ${e.message}` };
            }
        }

        // 3. FORMAT RESULTS
        if (results.length > 0) {
            const formatted = results.map(r => 
                `- **${r.name}**
  
  
  (Match: ${(r.score * 100).toFixed(0)}%)`
            ).join('\n');

            return {
                success: true,
                message: `### 🔍 Search Results from Memory
I found the following matches using Hybrid Search:

${formatted}

*These results are pulled from my indexed knowledge base.*`
            };
        }

        return {
            success: true,
            message: `I couldn't find any documents related to "${query}" in my current memory. ${searchPath ? `The scan of ${searchPath} didn't yield immediate matches.` : "Would you like me to scan a specific folder for you?"}`
        };
    }
};