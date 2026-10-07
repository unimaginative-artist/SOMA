
class TextChunker {
    constructor(config = {}) {
        this.chunkSize = config.chunkSize || 500; // Tokens (approx words)
        this.overlap = config.overlap || 50;
    }

    chunk(text, metadata = {}) {
        if (!text) return [];

        const words = text.split(/\s+/);
        const chunks = [];
        
        for (let i = 0; i < words.length; i += (this.chunkSize - this.overlap)) {
            const chunkWords = words.slice(i, i + this.chunkSize);
            if (chunkWords.length < 10) continue; // Skip tiny chunks

            const chunkText = chunkWords.join(' ');
            
            chunks.push({
                content: chunkText,
                metadata: {
                    ...metadata,
                    chunkIndex: chunks.length,
                    totalChunks: Math.ceil(words.length / (this.chunkSize - this.overlap)),
                    startOffset: i,
                    endOffset: i + chunkWords.length
                }
            });
        }

        return chunks;
    }
}

module.exports = { TextChunker };
