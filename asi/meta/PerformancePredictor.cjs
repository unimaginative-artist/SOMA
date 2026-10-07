/**
 * PerformancePredictor.cjs
 * 
 * Specialized ASI-layer component for predicting reasoning success.
 * Helps SOMA decide IF and HOW to perform deep reasoning (Tree Search).
 * 
 * Objectives:
 * 1. Estimate probability of success for a reasoning task.
 * 2. Select the optimal Tree Search strategy (Beam vs Best-First).
 * 3. Optimize resource usage by skipping ASI for simple tasks.
 */

const fs = require('fs').promises;
const path = require('path');

class PerformancePredictor {
    constructor(config = {}) {
        this.name = 'PerformancePredictor';
        this.logger = config.logger || console;
        this.archivist = config.archivist; // For historical lookup
        
        // Success history: problemType -> { total, successes, avgScore }
        this.history = new Map();
        this.isInitialized = false;
        
        // Persistence path: data/asi/performance_stats.json
        this.persistenceDir = path.join(process.cwd(), 'data', 'asi');
        this.persistenceFile = path.join(this.persistenceDir, 'performance_stats.json');
    }

    async initialize() {
        this.logger.info(`[${this.name}] Initializing...`);
        await this.load();
        this.isInitialized = true;
    }

    /**
     * Load stats from disk
     */
    async load() {
        try {
            // Ensure directory exists
            await fs.mkdir(this.persistenceDir, { recursive: true });

            const data = await fs.readFile(this.persistenceFile, 'utf-8');
            const json = JSON.parse(data);
            
            // Convert array of entries back to Map
            this.history = new Map(json);
            this.logger.info(`[${this.name}] Loaded performance stats for ${this.history.size} problem types.`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error(`[${this.name}] Failed to load stats: ${error.message}`);
            } else {
                this.logger.info(`[${this.name}] No existing stats found. Starting fresh.`);
            }
        }
    }

    /**
     * Save stats to disk
     */
    async save() {
        try {
            // Convert Map to array of entries for JSON serialization
            const data = JSON.stringify(Array.from(this.history.entries()), null, 2);
            await fs.writeFile(this.persistenceFile, data, 'utf-8');
        } catch (error) {
            this.logger.error(`[${this.name}] Failed to save stats: ${error.message}`);
        }
    }

    /**
     * Predict success probability and recommend a strategy
     * @param {string} query 
     * @param {Object} context 
     */
    async predict(query, context = {}) {
        const problemType = this._categorizeProblem(query);
        const complexity = this._estimateComplexity(query);
        
        this.logger.info(`[${this.name}] Predicting for type: ${problemType}, complexity: ${complexity.toFixed(2)}`);

        // 1. Calculate base probability from history
        let successProbability = 0.7; // Baseline
        if (this.history.has(problemType)) {
            const stats = this.history.get(problemType);
            successProbability = stats.successes / stats.total;
        }

        // 2. Adjust for complexity
        // High complexity lowers probability of success but increases need for ASI
        if (complexity > 0.8) successProbability -= 0.2;
        if (complexity < 0.3) successProbability += 0.1;

        // 3. Determine recommended strategy
        let recommendedStrategy = 'beam'; // Default
        if (complexity > 0.7) {
            recommendedStrategy = 'best-first'; // More exhaustive for hard problems
        } else if (complexity < 0.4) {
            recommendedStrategy = 'breadth-first'; // Shallow but wide for easy variants
        }

        // 4. Decision: Use ASI or Fallback?
        const useASI = complexity > 0.5 || successProbability < 0.6;

        return {
            successProbability: Math.max(0.1, Math.min(0.99, successProbability)),
            recommendedStrategy,
            useASI,
            metadata: {
                problemType,
                complexity,
                reasoning: useASI ? 'Task complexity warrants deep reasoning.' : 'Standard reasoning sufficient.'
            }
        };
    }

    _categorizeProblem(query) {
        const q = query.toLowerCase();
        if (q.includes('code') || q.includes('function') || q.includes('implement')) return 'coding';
        if (q.includes('debug') || q.includes('fix') || q.includes('error')) return 'debugging';
        if (q.includes('refactor') || q.includes('optimize')) return 'optimization';
        if (q.includes('architecture') || q.includes('design')) return 'system-design';
        return 'general-reasoning';
    }

    _estimateComplexity(query) {
        // Simple heuristic: length + keyword density
        let score = Math.min(query.length / 500, 0.5); // Max 0.5 from length
        
        const complexKeywords = [
            'asynchronous', 'distributed', 'concurrency', 'recursion',
            'quantum', 'neural', 'optimization', 'refactor', 'bottleneck',
            'scaling', 'security', 'encryption', 'protocol'
        ];

        let keywordCount = 0;
        complexKeywords.forEach(k => {
            if (query.toLowerCase().includes(k)) keywordCount++;
        });

        score += Math.min(keywordCount * 0.1, 0.5); // Max 0.5 from keywords
        
        return Math.min(score, 1.0);
    }

    /**
     * Record an outcome to improve future predictions
     */
    async recordOutcome(problemType, score) {
        if (!this.history.has(problemType)) {
            this.history.set(problemType, { total: 0, successes: 0, avgScore: 0 });
        }
        
        const stats = this.history.get(problemType);
        stats.total++;
        if (score >= 0.7) stats.successes++;
        stats.avgScore = (stats.avgScore * (stats.total - 1) + score) / stats.total;
        
        // Persist immediately
        await this.save();
    }
}

module.exports = PerformancePredictor;
