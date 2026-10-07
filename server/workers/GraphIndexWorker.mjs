import { buildGraphRetrievalIndex } from '../../core/GraphCognitiveSubstrate.js';

const [, , graphPath, dbPath] = process.argv;
if (!graphPath || !dbPath) {
    console.error('Usage: GraphIndexWorker.mjs <graph.json> <index.sqlite>');
    process.exit(2);
}

try {
    const result = buildGraphRetrievalIndex(graphPath, dbPath);
    process.stdout.write(JSON.stringify(result));
} catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
}
