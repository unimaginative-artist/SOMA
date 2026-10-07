const { HybridDB } = require('./HybridDB.cjs');
const path = require('path');

class InvertedIndex {
  constructor(config = {}) {
    this.config = config;
    // Connect to same DB (WAL mode handles concurrency)
    this.db = new HybridDB(path.join(process.cwd(), '.soma', 'storage'), 5000);
  }

  add(docId, content, metadata = {}) {
    if (!content) return;

    const tokens = this._tokenize(content);
    if (tokens.length === 0) return;

    // Calculate term frequencies for this document
    const termFreqs = {};
    for (const token of tokens) {
      termFreqs[token] = (termFreqs[token] || 0) + 1;
    }

    // Bulk insert into SQLite
    this.db.addKeywords(docId, termFreqs);
  }

  search(query, options = {}) {
    const { operator = 'OR', maxResults = 100 } = options;
    
    // 1. Tokenize query
    const terms = this._tokenize(query);
    if (terms.length === 0) return [];

    // 2. Fetch all matching rows from DB
    // Rows: [{ doc_id, term, frequency }, ...]
    const matches = this.db.searchKeywords(terms);

    // 3. Score results
    // Simple sum of frequencies for now (BM25 is handled by BM25Ranker class which uses this data)
    // But BM25Ranker expects `search` to return docs.
    
    const docScores = new Map();

    for (const row of matches) {
        const current = docScores.get(row.doc_id) || { docId: row.doc_id, score: 0, matches: 0 };
        current.score += row.frequency; // TF-based score
        current.matches++;
        docScores.set(row.doc_id, current);
    }

    let results = Array.from(docScores.values());

    // 4. Handle Operator (AND)
    if (operator === 'AND') {
        results = results.filter(r => r.matches === terms.length);
    }

    // 5. Sort by score
    results.sort((a, b) => b.score - a.score);

    // 6. Hydrate metadata/content for top results (chunk-level)
    const top = results.slice(0, maxResults);
    for (const result of top) {
        const chunk = this.db.getChunk(result.docId);
        if (chunk) {
            result.metadata = chunk.metadata;
            result.content = chunk.content;
        }
    }

    return top;
  }

  _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2) // Skip tiny words
      .slice(0, 1000); // Limit tokens per doc for sanity check
  }

  getStats() {
      // InvertedIndex stats are part of the VectorDB now
      return { status: 'persistent (sqlite)' };
  }
}

module.exports = { InvertedIndex };
