import fs from 'fs';
import path from 'path';

export class VectorSearchService {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.documents = []; // Array of { id, filePath, content, embedding: Array }
    this.isReady = false;
    this.pipeline = null;
  }

  async initialize() {
    console.log('[VectorSearchService] Initializing Transformers.js...');
    try {
      const { pipeline } = await import('@xenova/transformers');
      // Use Xenova's lightweight MiniLM-L6
      this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.isReady = true;
      console.log('[VectorSearchService] Transformers.js ready.');
    } catch (e) {
      console.error('[VectorSearchService] Failed to load pipeline:', e);
    }
  }

  cosineSimilarity(a, b) {
    let dotProduct = 0.0, normA = 0.0, normB = 0.0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async createEmbedding(text) {
    if (!this.pipeline) return null;
    const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async startIndexing() {
    if (!this.isReady) {
      console.warn('[VectorSearchService] Cannot index, pipeline not ready.');
      return;
    }
    console.log('[VectorSearchService] Starting background semantic indexing...');
    this.documents = [];
    await this.scanDir(this.workspaceRoot);
    console.log(`[VectorSearchService] Semantic indexing complete. Indexed ${this.documents.length} chunks.`);
  }

  async scanDir(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build', 'brain'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanDir(fullPath);
      } else {
        const ext = path.extname(entry.name);
        if (['.js', '.ts', '.jsx', '.tsx', '.md', '.cjs'].includes(ext)) {
          await this.indexFile(fullPath);
        }
      }
    }
  }

  async indexFile(filePath) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      // Naive chunking for speed (max 1000 chars)
      const chunks = content.match(/[\s\S]{1,1000}/g) || [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];
        if (chunkContent.trim().length < 20) continue; // Skip tiny chunks
        const embedding = await this.createEmbedding(chunkContent);
        if (embedding) {
          this.documents.push({
            id: `${filePath}#chunk${i}`,
            filePath,
            content: chunkContent,
            embedding
          });
        }
      }
    } catch (e) {
      console.warn(`[VectorSearchService] Could not index ${filePath}: ${e.message}`);
    }
  }

  async search(query, limit = 5) {
    if (!this.isReady || this.documents.length === 0) return [];
    
    const queryEmbedding = await this.createEmbedding(query);
    if (!queryEmbedding) return [];

    const results = this.documents.map(doc => {
      const score = this.cosineSimilarity(queryEmbedding, doc.embedding);
      return { ...doc, score };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}

export default VectorSearchService;
