/**
 * BM25Ranker - Best Matching 25 Ranking Algorithm
 *
 * BM25 is a probabilistic ranking function used by search engines
 * to estimate the relevance of documents to a given search query.
 *
 * Better than TF-IDF for:
 * - Long documents (like medical papers)
 * - Repeated terms (saturation function prevents over-weighting)
 * - Variable document lengths (normalization)
 *
 * References:
 * - Robertson et al. "Okapi at TREC-3"
 * - Used by Elasticsearch, Lucene, RediSearch
 */

const natural = require('natural');
const stopword = require('stopword');

class BM25Ranker {
  constructor(config = {}) {
    // BM25 parameters
    this.k1 = config.k1 || 1.5;  // Term frequency saturation parameter (1.2-2.0)
    this.b = config.b || 0.75;   // Length normalization parameter (0-1)

    this.stemmer = natural.PorterStemmer;
    this.tokenizer = new natural.WordTokenizer();

    // Statistics
    this.documentStats = new Map();  // docId -> { length, terms }
    this.termDocFreq = new Map();    // term -> number of docs containing it
    this.totalDocs = 0;
    this.avgDocLength = 0;
  }

  /**
   * Index a document for BM25 scoring
   */
  indexDocument(docId, content) {
    // Tokenize and stem
    const tokens = this._tokenize(content);
    const stems = tokens.map(t => this.stemmer.stem(t.toLowerCase()));

    // Count term frequencies
    const termFrequencies = new Map();
    for (const stem of stems) {
      termFrequencies.set(stem, (termFrequencies.get(stem) || 0) + 1);
    }

    // Update document stats
    this.documentStats.set(docId, {
      length: stems.length,
      termFrequencies
    });

    // Update term document frequencies
    for (const term of termFrequencies.keys()) {
      this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
    }

    // Update global stats
    this.totalDocs++;
    this._updateAvgDocLength();

    return { success: true, docId, terms: stems.length };
  }

  /**
   * Score a single document against a query
   */
  score(docId, queryTerms) {
    const docStats = this.documentStats.get(docId);
    if (!docStats) return 0;

    const { length, termFrequencies } = docStats;

    let score = 0;

    for (const queryTerm of queryTerms) {
      const stem = this.stemmer.stem(queryTerm.toLowerCase());

      // Get term frequency in this document
      const tf = termFrequencies.get(stem) || 0;
      if (tf === 0) continue;

      // Get document frequency (how many docs contain this term)
      const df = this.termDocFreq.get(stem) || 0;
      if (df === 0) continue;

      // Calculate IDF (Inverse Document Frequency)
      const idf = Math.log(
        (this.totalDocs - df + 0.5) / (df + 0.5) + 1.0
      );

      // Calculate normalized term frequency
      const numerator = tf * (this.k1 + 1);
      const denominator =
        tf + this.k1 * (1 - this.b + this.b * (length / this.avgDocLength));

      const termScore = idf * (numerator / denominator);

      score += termScore;
    }

    return score;
  }

  /**
   * Score multiple documents and return ranked list
   */
  rankDocuments(documentIds, queryTerms) {
    const scored = documentIds.map(docId => ({
      docId,
      score: this.score(docId, queryTerms)
    }));

    // Sort by score (descending)
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Score search results (used with InvertedIndex results)
   */
  scoreResults(results, queryTerms) {
    return results.map(result => ({
      ...result,
      bm25Score: this.score(result.docId, queryTerms)
    }));
  }

  /**
   * Remove document from index
   */
  removeDocument(docId) {
    const docStats = this.documentStats.get(docId);
    if (!docStats) {
      return { success: false, error: 'Document not found' };
    }

    // Update term document frequencies
    for (const term of docStats.termFrequencies.keys()) {
      const df = this.termDocFreq.get(term) || 0;
      if (df > 1) {
        this.termDocFreq.set(term, df - 1);
      } else {
        this.termDocFreq.delete(term);
      }
    }

    // Remove document stats
    this.documentStats.delete(docId);

    // Update global stats
    this.totalDocs--;
    this._updateAvgDocLength();

    return { success: true, docId };
  }

  /**
   * Get IDF (Inverse Document Frequency) for a term
   * Useful for understanding term importance
   */
  getIDF(term) {
    const stem = this.stemmer.stem(term.toLowerCase());
    const df = this.termDocFreq.get(stem) || 0;

    if (df === 0) return 0;

    return Math.log(
      (this.totalDocs - df + 0.5) / (df + 0.5) + 1.0
    );
  }

  /**
   * Get term statistics
   */
  getTermStats(term) {
    const stem = this.stemmer.stem(term.toLowerCase());
    const df = this.termDocFreq.get(stem) || 0;

    return {
      term,
      stem,
      documentFrequency: df,
      idf: this.getIDF(term),
      percentageOfDocs: this.totalDocs > 0 ? (df / this.totalDocs) * 100 : 0
    };
  }

  /**
   * Explain BM25 score for debugging
   */
  explain(docId, queryTerms) {
    const docStats = this.documentStats.get(docId);
    if (!docStats) {
      return { error: 'Document not found' };
    }

    const { length, termFrequencies } = docStats;
    const explanation = {
      docId,
      docLength: length,
      avgDocLength: this.avgDocLength,
      lengthNorm: length / this.avgDocLength,
      k1: this.k1,
      b: this.b,
      terms: []
    };

    let totalScore = 0;

    for (const queryTerm of queryTerms) {
      const stem = this.stemmer.stem(queryTerm.toLowerCase());
      const tf = termFrequencies.get(stem) || 0;
      const df = this.termDocFreq.get(stem) || 0;

      if (df === 0) {
        explanation.terms.push({
          term: queryTerm,
          stem,
          found: false,
          reason: 'Term not in any document'
        });
        continue;
      }

      const idf = Math.log(
        (this.totalDocs - df + 0.5) / (df + 0.5) + 1.0
      );

      const numerator = tf * (this.k1 + 1);
      const denominator =
        tf + this.k1 * (1 - this.b + this.b * (length / this.avgDocLength));

      const termScore = idf * (numerator / denominator);
      totalScore += termScore;

      explanation.terms.push({
        term: queryTerm,
        stem,
        found: tf > 0,
        termFrequency: tf,
        documentFrequency: df,
        idf: idf.toFixed(4),
        normalized_tf: (numerator / denominator).toFixed(4),
        termScore: termScore.toFixed(4)
      });
    }

    explanation.totalScore = totalScore.toFixed(4);

    return explanation;
  }

  /**
   * Tokenize text with stop word removal
   */
  _tokenize(text) {
    if (!text) return [];

    // Basic tokenization
    const tokens = this.tokenizer.tokenize(text.toLowerCase());

    // Remove stop words
    const filtered = stopword.removeStopwords(tokens);

    // Remove single characters and numbers
    return filtered.filter(t => t.length > 1 && !/^\d+$/.test(t));
  }

  /**
   * Update average document length
   */
  _updateAvgDocLength() {
    if (this.totalDocs === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const stats of this.documentStats.values()) {
      totalLength += stats.length;
    }

    this.avgDocLength = totalLength / this.totalDocs;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalDocuments: this.totalDocs,
      avgDocLength: this.avgDocLength,
      uniqueTerms: this.termDocFreq.size,
      k1: this.k1,
      b: this.b
    };
  }

  /**
   * Reset the ranker
   */
  reset() {
    this.documentStats.clear();
    this.termDocFreq.clear();
    this.totalDocs = 0;
    this.avgDocLength = 0;
  }
}

module.exports = { BM25Ranker };
