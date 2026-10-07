
const { pipeline } = require('@xenova/transformers');

class LocalEmbedder {
    constructor(config = {}) {
        this.modelName = config.modelName || 'Xenova/all-MiniLM-L6-v2';
        this.pipeline = null;
        this.dimension = 384; // Standard for all-MiniLM-L6-v2
    }

    async initialize() {
        if (this.pipeline) return;
        
        console.log(`[LocalEmbedder] Loading model: ${this.modelName}...[32m[1m`);
        try {
            // Feature extraction pipeline
            this.pipeline = await pipeline('feature-extraction', this.modelName);
            console.log(`[LocalEmbedder] [32m[1m✅ Model loaded[0m`);
        } catch (error) {
            console.error(`[LocalEmbedder] [31m[1m❌ Failed to load model: ${error.message}[0m`);
            throw error;
        }
    }

    async embed(text) {
        if (!this.pipeline) await this.initialize();
        if (!text || typeof text !== 'string') throw new Error('Input text must be a non-empty string');

        // Clean text
        const cleanText = text.replace(/\n/g, ' ').trim();

        // Generate embedding
        // pooling: 'mean' averages the token embeddings to get sentence embedding
        // normalize: true ensures cosine similarity works with dot product
        const output = await this.pipeline(cleanText, { pooling: 'mean', normalize: true });
        
        // Convert Tensor to standard array
        return Array.from(output.data);
    }
}

module.exports = { LocalEmbedder };
