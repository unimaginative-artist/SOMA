// AnalyzeAgent.cjs
// Specialized MicroAgent for text and data analysis

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

class AnalyzeAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'analyze' });
  }
  
  /**
   * Execute analysis task
   * Task format:
   * {
   *   analysis: 'sentiment' | 'keywords' | 'statistics' | 'structure' | 'custom',
   *   data: string | object | array,
   *   params: {}
   * }
   */
  async execute(task) {
    const { analysis, data, params = {} } = task;
    
    if (!analysis) {
      throw new Error('Task must include analysis type');
    }
    
    if (data === undefined || data === null) {
      throw new Error('Task must include data');
    }
    
    this.logger.info(`[AnalyzeAgent:${this.id}] Analyzing: ${analysis}`);
    
    switch (analysis) {
      case 'sentiment':
        return this._analyzeSentiment(data, params);
      
      case 'keywords':
        return this._extractKeywords(data, params);
      
      case 'statistics':
        return this._computeStatistics(data, params);
      
      case 'structure':
        return this._analyzeStructure(data, params);
      
      case 'patterns':
        return this._findPatterns(data, params);
      
      case 'custom':
        if (!params.fn || typeof params.fn !== 'function') {
          throw new Error('Custom analysis requires params.fn function');
        }
        return params.fn(data, params);
      
      default:
        throw new Error(`Unknown analysis type: ${analysis}`);
    }
  }
  
  _analyzeSentiment(text, params) {
    if (typeof text !== 'string') {
      throw new Error('Sentiment analysis requires string input');
    }
    
    const lowerText = text.toLowerCase();
    
    // Simple keyword-based sentiment (can be enhanced with ML models)
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'best', 'happy', 'perfect'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'poor', 'disappointing', 'sad', 'angry'];
    
    let positiveScore = 0;
    let negativeScore = 0;
    
    positiveWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) positiveScore += matches.length;
    });
    
    negativeWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) negativeScore += matches.length;
    });
    
    const total = positiveScore + negativeScore;
    const score = total > 0 ? (positiveScore - negativeScore) / total : 0;
    
    let sentiment = 'neutral';
    if (score > 0.2) sentiment = 'positive';
    else if (score < -0.2) sentiment = 'negative';
    
    return {
      sentiment,
      score,
      confidence: Math.abs(score),
      positiveCount: positiveScore,
      negativeCount: negativeScore
    };
  }
  
  _extractKeywords(text, params) {
    if (typeof text !== 'string') {
      throw new Error('Keyword extraction requires string input');
    }
    
    const { topN = 10, minLength = 3 } = params;
    
    // Tokenize and clean
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= minLength);
    
    // Common stopwords
    const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'can', 'this', 'that', 'these', 'those']);
    
    // Count word frequencies
    const frequency = {};
    words.forEach(word => {
      if (!stopwords.has(word)) {
        frequency[word] = (frequency[word] || 0) + 1;
      }
    });
    
    // Sort by frequency
    const keywords = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([word, count]) => ({ word, count, score: count / words.length }));
    
    return {
      keywords,
      totalWords: words.length,
      uniqueWords: Object.keys(frequency).length
    };
  }
  
  _computeStatistics(data, params) {
    if (!Array.isArray(data)) {
      throw new Error('Statistics computation requires array input');
    }
    
    const { key } = params;
    
    // Extract numeric values
    const values = data
      .map(item => {
        if (key && typeof item === 'object') {
          return item[key];
        }
        return item;
      })
      .filter(v => typeof v === 'number' && !isNaN(v));
    
    if (values.length === 0) {
      return { error: 'No numeric values found' };
    }
    
    // Compute statistics
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = sum / values.length;
    
    // Variance and standard deviation
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Median
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    
    // Quartiles
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    
    return {
      count: values.length,
      sum,
      mean,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      range: sorted[sorted.length - 1] - sorted[0],
      variance,
      stdDev,
      q1,
      q3,
      iqr,
      outliers: values.filter(v => v < (q1 - 1.5 * iqr) || v > (q3 + 1.5 * iqr)).length
    };
  }
  
  _analyzeStructure(data, params) {
    const structure = {
      type: Array.isArray(data) ? 'array' : typeof data,
      size: 0,
      depth: 0,
      properties: []
    };
    
    if (Array.isArray(data)) {
      structure.size = data.length;
      
      if (data.length > 0) {
        const firstItem = data[0];
        structure.itemType = typeof firstItem;
        
        if (typeof firstItem === 'object' && firstItem !== null) {
          structure.properties = Object.keys(firstItem);
          structure.depth = this._getDepth(firstItem);
        }
      }
    } else if (typeof data === 'object' && data !== null) {
      structure.properties = Object.keys(data);
      structure.size = structure.properties.length;
      structure.depth = this._getDepth(data);
    } else {
      structure.size = typeof data === 'string' ? data.length : 1;
    }
    
    return structure;
  }
  
  _getDepth(obj, currentDepth = 1) {
    if (typeof obj !== 'object' || obj === null) {
      return currentDepth;
    }
    
    const depths = Object.values(obj).map(value => 
      this._getDepth(value, currentDepth + 1)
    );
    
    return depths.length > 0 ? Math.max(...depths) : currentDepth;
  }
  
  _findPatterns(data, params) {
    if (typeof data === 'string') {
      return this._findTextPatterns(data, params);
    } else if (Array.isArray(data)) {
      return this._findArrayPatterns(data, params);
    } else {
      throw new Error('Pattern finding requires string or array input');
    }
  }
  
  _findTextPatterns(text, params) {
    const { patterns = [] } = params;
    const results = {};
    
    // Default patterns if none provided
    const defaultPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      url: /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g,
      phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      date: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g
    };
    
    const patternsToUse = patterns.length > 0 ? patterns : Object.keys(defaultPatterns);
    
    patternsToUse.forEach(pattern => {
      if (typeof pattern === 'string' && defaultPatterns[pattern]) {
        const matches = text.match(defaultPatterns[pattern]);
        results[pattern] = matches || [];
      } else if (pattern instanceof RegExp) {
        const matches = text.match(pattern);
        results.custom = matches || [];
      }
    });
    
    return results;
  }
  
  _findArrayPatterns(data, params) {
    const { key } = params;
    
    // Frequency analysis
    const frequency = {};
    data.forEach(item => {
      const value = key && typeof item === 'object' ? item[key] : item;
      const valueStr = JSON.stringify(value);
      frequency[valueStr] = (frequency[valueStr] || 0) + 1;
    });
    
    // Find most common
    const sorted = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({
        value: JSON.parse(value),
        count,
        frequency: count / data.length
      }));
    
    return {
      mostCommon: sorted.slice(0, 10),
      unique: sorted.length,
      total: data.length
    };
  }
}

module.exports = { AnalyzeAgent };
