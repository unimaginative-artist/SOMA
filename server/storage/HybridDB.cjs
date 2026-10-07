
const { VectorDB } = require('./VectorDB.cjs');

class HybridDB {
    constructor(storagePath, cacheSize = 1000) {
        this.disk = new VectorDB(storagePath);
        
        // LRU Cache (Hot Tier)
        this.cache = new Map();
        this.cacheSize = cacheSize;
        
        // Performance Telemetry
        this.stats = { hits: 0, misses: 0, writes: 0 };
        
        console.log(`[HybridDB] Initialized with Cache Size: ${cacheSize}`);
    }

    // --- Document Ops (Hybrid) ---

    addDocument(doc) {
        this.disk.addDocument(doc);
        this._cacheSet(`doc:${doc.id}`, doc);
        this.stats.writes++;
    }

    getDocument(id) {
        if (this.cache.has(`doc:${id}`)) {
            this.stats.hits++;
            // console.log(`[HybridDB] ⚡ Cache Hit: doc:${id}`); // Optional: Too verbose?
            this._cacheTouch(`doc:${id}`);
            return this.cache.get(`doc:${id}`);
        }

        this.stats.misses++;
        // console.log(`[HybridDB] 💾 Disk Read: doc:${id}`);
        const doc = this.disk.getDocument(id);
        if (doc) {
            this._cacheSet(`doc:${id}`, doc);
        }
        return doc;
    }

    // --- Chunk Ops (Hybrid) ---

    addChunk(chunk) {
        this.disk.addChunk(chunk);
        this._cacheSet(`chunk:${chunk.id}`, chunk);
        this.stats.writes++;
    }

    getChunk(id) {
        if (this.cache.has(`chunk:${id}`)) {
            this.stats.hits++;
            if (this.stats.hits % 10 === 0) process.stdout.write('⚡'); // Visual heartbeat for cache
            this._cacheTouch(`chunk:${id}`);
            return this.cache.get(`chunk:${id}`);
        }

        this.stats.misses++;
        if (this.stats.misses % 10 === 0) process.stdout.write('💾'); // Visual heartbeat for disk
        const chunk = this.disk.getChunk(id);
        if (chunk) {
            this._cacheSet(`chunk:${id}`, chunk);
        }
        return chunk;
    }

    // --- Passthrough to Disk ---
    addKeywords(docId, termFreqMap) { return this.disk.addKeywords(docId, termFreqMap); }
    searchKeywords(terms) { return this.disk.searchKeywords(terms); }
    
    getStats() { 
        return { 
            ...this.disk.getStats(), 
            cacheCount: this.cache.size,
            cacheHits: this.stats.hits,
            cacheMisses: this.stats.misses,
            cacheRatio: this.stats.hits / (this.stats.hits + this.stats.misses || 1)
        }; 
    }

    // --- Cache Management (LRU) ---

    _cacheSet(key, value) {
        if (this.cache.size >= this.cacheSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, value);
    }

    _cacheTouch(key) {
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
    }
}

module.exports = { HybridDB };
