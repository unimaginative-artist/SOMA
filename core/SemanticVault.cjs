/**
 * core/SemanticVault.cjs
 * 
 * Local Vector Store utility for SOMA.
 * Uses Ollama (nomic-embed-text) to generate embeddings and performs 
 * in-memory cosine similarity search to prevent the need for heavy DBs.
 */
const fs = require('fs').promises;
const path = require('path');

class SemanticVault {
    constructor(vaultPath) {
        this.vaultPath = vaultPath;
        this.embeddingsCache = new Map(); // filename -> { mtime, embedding, text }
        this.ollamaEndpoint = 'http://localhost:11434/api/embeddings';
        this.model = 'llama3.2:latest';
    }

    async _getEmbedding(text) {
        try {
            const response = await fetch(this.ollamaEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: this.model, prompt: text })
            });
            if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
            const data = await response.json();
            return data.embedding;
        } catch (e) {
            console.warn(`[SemanticVault] Failed to get embedding: ${e.message}`);
            return null;
        }
    }

    _cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async _syncVault() {
        await fs.mkdir(this.vaultPath, { recursive: true });
        const files = (await fs.readdir(this.vaultPath)).filter(f => f.endsWith('.md'));
        
        for (const file of files) {
            const fullPath = path.join(this.vaultPath, file);
            const stats = await fs.stat(fullPath);
            const cached = this.embeddingsCache.get(file);
            
            // Only embed if new or modified
            if (!cached || cached.mtime < stats.mtimeMs) {
                const content = await fs.readFile(fullPath, 'utf8');
                const stripped = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
                
                // Truncate to reasonable context window for nomic-embed
                const textToEmbed = stripped.slice(0, 4000); 
                const embedding = await _getEmbeddingSafe(this, textToEmbed);
                
                if (embedding) {
                    this.embeddingsCache.set(file, { mtime: stats.mtimeMs, embedding, text: stripped });
                }
            }
        }
        
        // Remove deleted files
        for (const cachedFile of this.embeddingsCache.keys()) {
            if (!files.includes(cachedFile)) this.embeddingsCache.delete(cachedFile);
        }
    }

    async search(query, limit = 5, threshold = 0.3) {
        if (!query || query.trim() === '') return [];
        
        await this._syncVault();
        
        const queryEmbedding = await this._getEmbedding(query);
        if (!queryEmbedding) {
            // Fallback to keyword search if Ollama is down
            return this._fallbackSearch(query, limit);
        }

        const results = [];
        for (const [filename, data] of this.embeddingsCache.entries()) {
            const score = this._cosineSimilarity(queryEmbedding, data.embedding);
            if (score >= threshold) {
                // Generate snippet
                const idx = data.text.toLowerCase().indexOf(query.toLowerCase().split(' ')[0]);
                const snippet = idx !== -1 
                    ? '...' + data.text.slice(Math.max(0, idx - 30), idx + 100).replace(/\n/g, ' ').trim() + '...'
                    : data.text.slice(0, 100).replace(/\n/g, ' ').trim() + '...';
                
                results.push({ name: filename, score, snippet });
            }
        }

        return results.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    _fallbackSearch(query, limit) {
        const results = [];
        const q = query.toLowerCase();
        for (const [filename, data] of this.embeddingsCache.entries()) {
            const idx = data.text.toLowerCase().indexOf(q);
            if (idx !== -1 || filename.toLowerCase().includes(q)) {
                const snippet = idx !== -1 
                    ? '...' + data.text.slice(Math.max(0, idx - 30), idx + 100).replace(/\n/g, ' ').trim() + '...'
                    : data.text.slice(0, 100).replace(/\n/g, ' ').trim() + '...';
                results.push({ name: filename, score: 0.1, snippet });
            }
        }
        return results.slice(0, limit);
    }
}

async function _getEmbeddingSafe(instance, text) {
    return await instance._getEmbedding(text);
}

module.exports = SemanticVault;
