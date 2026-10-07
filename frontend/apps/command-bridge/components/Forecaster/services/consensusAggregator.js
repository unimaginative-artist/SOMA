/**
 * Consensus Prediction Aggregator
 * 
 * Scrapes predictions from multiple sources (expert sites, betting markets, 
 * statistical models) and creates a weighted consensus prediction.
 * 
 * Data Sources:
 * - FiveThirtyEight (statistical models)
 * - The Athletic (expert analysis)
 * - Vegas Insider (betting consensus)
 * - ESPN Analytics (BPI, FPI, etc.)
 * - Twitter sentiment (optional)
 */

const PREDICTION_SOURCES = [
    {
        name: 'FiveThirtyEight',
        url: 'https://projects.fivethirtyeight.com',
        weight: 0.25,
        reliability: 0.85,
        type: 'MODEL'
    },
    {
        name: 'ESPN_BPI',
        url: 'https://www.espn.com/nba/bpi',
        weight: 0.20,
        reliability: 0.80,
        type: 'MODEL'
    },
    {
        name: 'VegasInsider',
        url: 'https://www.vegasinsider.com',
        weight: 0.30,
        reliability: 0.90, // Market is usually efficient
        type: 'MARKET'
    },
    {
        name: 'Covers',
        url: 'https://www.covers.com/sport/basketball/nba',
        weight: 0.15,
        reliability: 0.75,
        type: 'EXPERT'
    },
    {
        name: 'ActionNetwork',
        url: 'https://www.actionnetwork.com',
        weight: 0.10,
        reliability: 0.70,
        type: 'EXPERT'
    }
];

/**
 * Scrape prediction from a single source
 * @param {Object} source - Source configuration
 * @param {string} query - Query string (e.g. "Mahomes passing yards")
 * @returns {Object} Prediction data
 */
async function scrapeSingleSource(source, query) {
    try {
        // Use backend crawler service
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout per source
        
        const response = await fetch('/api/crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: source.url,
                query: query,
                extractors: {
                    prediction: '.prediction-value, .projection, .forecast',
                    confidence: '.confidence, .certainty',
                    reasoning: '.analysis, .explanation'
                }
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`[Consensus] Failed to scrape ${source.name}: HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();
        
        // Parse the scraped data
        return {
            source: source.name,
            type: source.type,
            prediction: parseFloat(data.prediction) || null,
            confidence: parseFloat(data.confidence) || 0.5,
            reasoning: data.reasoning || '',
            weight: source.weight,
            reliability: source.reliability,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error(`[Consensus] Error scraping ${source.name}:`, error);
        return null;
    }
}

/**
 * Calculate weighted consensus from multiple predictions
 * @param {Array} predictions - Array of prediction objects
 * @returns {Object} Consensus prediction with statistics
 */
function calculateConsensus(predictions) {
    // Filter out null/invalid predictions
    const validPredictions = predictions.filter(p => p && p.prediction !== null);
    
    if (validPredictions.length === 0) {
        return {
            consensus: null,
            confidence: 0,
            sources: 0,
            error: 'No valid predictions found'
        };
    }

    // Calculate weighted average
    let weightedSum = 0;
    let totalWeight = 0;
    let confidenceSum = 0;

    validPredictions.forEach(pred => {
        const effectiveWeight = pred.weight * pred.reliability;
        weightedSum += pred.prediction * effectiveWeight;
        totalWeight += effectiveWeight;
        confidenceSum += pred.confidence * effectiveWeight;
    });

    const consensus = weightedSum / totalWeight;
    const avgConfidence = confidenceSum / totalWeight;

    // Calculate variance (how much sources disagree)
    const variance = validPredictions.reduce((sum, pred) => {
        return sum + Math.pow(pred.prediction - consensus, 2);
    }, 0) / validPredictions.length;

    const stdDev = Math.sqrt(variance);

    // Group by source type for analysis
    const byType = {
        MODEL: validPredictions.filter(p => p.type === 'MODEL'),
        MARKET: validPredictions.filter(p => p.type === 'MARKET'),
        EXPERT: validPredictions.filter(p => p.type === 'EXPERT')
    };

    return {
        // Core prediction
        consensus: Math.round(consensus * 10) / 10,
        confidence: avgConfidence,
        
        // Statistical measures
        range: {
            low: Math.round((consensus - stdDev) * 10) / 10,
            high: Math.round((consensus + stdDev) * 10) / 10
        },
        standardDeviation: Math.round(stdDev * 10) / 10,
        variance: Math.round(variance * 10) / 10,
        
        // Source breakdown
        sources: validPredictions.length,
        predictions: validPredictions,
        
        // Type analysis
        modelAvg: byType.MODEL.length > 0 
            ? byType.MODEL.reduce((sum, p) => sum + p.prediction, 0) / byType.MODEL.length 
            : null,
        marketAvg: byType.MARKET.length > 0 
            ? byType.MARKET.reduce((sum, p) => sum + p.prediction, 0) / byType.MARKET.length 
            : null,
        expertAvg: byType.EXPERT.length > 0 
            ? byType.EXPERT.reduce((sum, p) => sum + p.prediction, 0) / byType.EXPERT.length 
            : null,
        
        // Disagreement indicator
        disagreement: stdDev / consensus, // Coefficient of variation
        
        timestamp: Date.now()
    };
}

/**
 * Main function: Aggregate predictions from all sources
 * @param {string} query - Natural language query
 * @param {Object} options - Configuration options
 * @returns {Object} Consensus prediction with full breakdown
 */
export async function aggregateConsensus(query, options = {}) {
    console.log(`[Consensus] Aggregating predictions for: "${query}"`);
    
    const {
        timeout = 10000, // Max time to wait for all sources
        minSources = 2,  // Minimum sources required for consensus
        parallel = true  // Scrape in parallel or sequential
    } = options;

    try {
        // Scrape all sources
        const scrapePromises = PREDICTION_SOURCES.map(source => 
            scrapeSingleSource(source, query)
        );

        // Race against timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Consensus timeout')), timeout)
        );

        let predictions;
        if (parallel) {
            predictions = await Promise.race([
                Promise.allSettled(scrapePromises),
                timeoutPromise
            ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));
        } else {
            predictions = [];
            for (const promise of scrapePromises) {
                try {
                    const result = await Promise.race([promise, timeoutPromise]);
                    predictions.push(result);
                } catch {
                    predictions.push(null);
                }
            }
        }

        // Calculate consensus
        const consensus = calculateConsensus(predictions);

        if (consensus.sources < minSources) {
            console.warn(`[Consensus] Only ${consensus.sources} sources available, minimum is ${minSources}`);
        }

        // Add interpretation
        consensus.interpretation = interpretConsensus(consensus);

        return {
            success: true,
            consensus,
            query,
            timestamp: Date.now()
        };

    } catch (error) {
        console.error('[Consensus] Aggregation failed:', error);
        return {
            success: false,
            error: error.message,
            query
        };
    }
}

/**
 * Interpret consensus results for human-readable insights
 */
function interpretConsensus(consensus) {
    if (!consensus.consensus) {
        return {
            summary: 'Unable to establish consensus',
            confidence: 'NONE',
            recommendation: 'SKIP'
        };
    }

    const { disagreement, confidence, sources } = consensus;

    // Confidence interpretation
    let confidenceLevel = 'LOW';
    if (confidence > 0.75 && disagreement < 0.15) confidenceLevel = 'HIGH';
    else if (confidence > 0.6 && disagreement < 0.25) confidenceLevel = 'MEDIUM';

    // Agreement interpretation
    let agreement = 'STRONG';
    if (disagreement > 0.25) agreement = 'WEAK';
    else if (disagreement > 0.15) agreement = 'MODERATE';

    // Recommendation
    let recommendation = 'PASS';
    if (confidenceLevel === 'HIGH' && agreement === 'STRONG') recommendation = 'STRONG BUY';
    else if (confidenceLevel === 'MEDIUM' && agreement !== 'WEAK') recommendation = 'CONSIDER';

    // Compare model vs market
    let modelMarketGap = null;
    if (consensus.modelAvg && consensus.marketAvg) {
        modelMarketGap = Math.abs(consensus.modelAvg - consensus.marketAvg);
    }

    return {
        summary: `${sources} sources agree with ${agreement.toLowerCase()} consensus at ${consensus.consensus}`,
        confidence: confidenceLevel,
        agreement,
        recommendation,
        modelMarketGap,
        insights: generateInsights(consensus)
    };
}

/**
 * Generate actionable insights from consensus data
 */
function generateInsights(consensus) {
    const insights = [];

    if (consensus.modelAvg && consensus.marketAvg) {
        const gap = consensus.modelAvg - consensus.marketAvg;
        if (Math.abs(gap) > 5) {
            insights.push({
                type: 'DISCREPANCY',
                severity: 'HIGH',
                message: `Models ${gap > 0 ? 'higher' : 'lower'} than market by ${Math.abs(gap).toFixed(1)} (${((gap / consensus.marketAvg) * 100).toFixed(1)}%)`
            });
        }
    }

    if (consensus.disagreement > 0.3) {
        insights.push({
            type: 'VOLATILITY',
            severity: 'MEDIUM',
            message: `High disagreement between sources (CV: ${(consensus.disagreement * 100).toFixed(1)}%)`
        });
    }

    if (consensus.sources < 3) {
        insights.push({
            type: 'DATA_QUALITY',
            severity: 'LOW',
            message: `Limited source coverage (only ${consensus.sources} sources available)`
        });
    }

    return insights;
}

/**
 * Cached consensus to avoid redundant scraping
 */
const consensusCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedConsensus(query, options = {}) {
    const cacheKey = query.toLowerCase().trim();
    const cached = consensusCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        console.log('[Consensus] Using cached result');
        return cached;
    }

    const result = await aggregateConsensus(query, options);
    consensusCache.set(cacheKey, result);

    return result;
}
