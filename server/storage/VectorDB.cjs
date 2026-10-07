
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class VectorDB {
    constructor(storagePath) {
        this.dbPath = path.join(storagePath, 'soma_knowledge.db');
        this.db = null;
        this.initialize();
    }

    initialize() {
        // Ensure directory exists
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL'); // High performance mode

        // 1. Documents Table (Metadata)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                path TEXT,
                name TEXT,
                type TEXT,
                content TEXT, -- Full text content (optional, or chunks)
                metadata JSON,
                indexed_at INTEGER
            )
        `);

        // 2. Chunks Table (Vector Metadata)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                doc_id TEXT,
                chunk_index INTEGER,
                content TEXT,
                metadata JSON,
                FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
            )
        `);

        // 3. Inverted Index (Keywords -> Doc IDs)
        // A optimized mapping for BM25
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS inverted_index (
                term TEXT,
                doc_id TEXT,
                frequency INTEGER,
                PRIMARY KEY (term, doc_id)
            )
        `);
        
        // Indexes for speed
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_inv_term ON inverted_index(term)');
    }

    // --- Document Ops ---

    addDocument(doc) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO documents (id, path, name, type, content, metadata, indexed_at)
            VALUES (@id, @path, @name, @type, @content, @metadata, @indexed_at)
        `);
        stmt.run({
            id: doc.id,
            path: doc.path,
            name: doc.name,
            type: doc.metadata?.type || 'unknown',
            content: doc.content || '',
            metadata: JSON.stringify(doc.metadata || {}),
            indexed_at: Date.now()
        });
    }

    getDocument(id) {
        const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, metadata: JSON.parse(row.metadata) };
    }

    // --- Chunk Ops ---

    addChunk(chunk) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO chunks (id, doc_id, chunk_index, content, metadata)
            VALUES (@id, @doc_id, @chunk_index, @content, @metadata)
        `);
        stmt.run({
            id: chunk.id,
            doc_id: chunk.docId,
            chunk_index: chunk.index,
            content: chunk.content,
            metadata: JSON.stringify(chunk.metadata || {})
        });
    }

    getChunk(id) {
        const row = this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(id);
        if (!row) return null;
        return { ...row, metadata: JSON.parse(row.metadata) };
    }

    // --- Inverted Index Ops (Bulk) ---

    addKeywords(docId, termFreqMap) {
        const insert = this.db.prepare(`
            INSERT OR REPLACE INTO inverted_index (term, doc_id, frequency)
            VALUES (@term, @doc_id, @freq)
        `);

        const transaction = this.db.transaction((terms) => {
            for (const [term, freq] of Object.entries(terms)) {
                insert.run({ term, doc_id: docId, freq });
            }
        });

        transaction(termFreqMap);
    }

    searchKeywords(terms) {
        // Find docs that contain ANY of the terms
        const placeholders = terms.map(() => '?').join(',');
        const query = `
            SELECT doc_id, term, frequency 
            FROM inverted_index 
            WHERE term IN (${placeholders})
        `;
        return this.db.prepare(query).all(...terms);
    }

    getStats() {
        const docCount = this.db.prepare('SELECT COUNT(*) as c FROM documents').get().c;
        const chunkCount = this.db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
        const termCount = this.db.prepare('SELECT COUNT(*) as c FROM inverted_index').get().c;
        return { docCount, chunkCount, termCount };
    }
}

module.exports = { VectorDB };
