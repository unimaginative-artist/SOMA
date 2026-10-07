import { GameStatus } from '../types';
import { getCachedConsensus } from './consensusAggregator.js';
import { queryRealSportsData, parseQuery } from './sportsStatsService.js';

/**
 * Forecaster Intelligence Service
 * 
 * Handles natural language queries and returns probabilistic projections.
 * Integrates with consensus aggregator to combine predictions from multiple sources.
 * Falls back to backend API.
 */


export const queryForecaster = async (query) => {
    console.log(`[Forecaster] Analyzing query: "${query}"`);

    try {
        // Try real sports data first
        console.log('[Forecaster] Fetching real sports data...');
        const realData = await queryRealSportsData(query);
        console.log('[Forecaster] Real sports data retrieved successfully');
        return realData;
    } catch (realDataError) {
        console.warn('[Forecaster] Real data unavailable, trying backend API:', realDataError.message);
        
        try {
            // Try backend API
            const response = await fetch('/api/forecaster/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: query })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.prediction) {
                    console.log('[Forecaster] Using backend prediction');
                    return data.prediction;
                }
            }
        } catch (error) {
            console.warn('[Forecaster] Backend error:', error.message);
        }

        // --- DE-MOCKED: No more simulation fallback ---
        throw new Error(`Forecaster Unavailable: Could not retrieve real-time or backend prediction for "${query}".`);
    }
};

/**
 * Enhanced query with consensus aggregation from web sources
 * @param {string} query - Natural language query
 * @param {boolean} useConsensus - Whether to aggregate web predictions
 * @returns {Object} Enhanced prediction with consensus data
 */
export const queryForecasterWithConsensus = async (query, useConsensus = true) => {
    console.log(`[Forecaster] Enhanced query with consensus=${useConsensus}`);
    
    // Get base prediction
    const basePrediction = await queryForecaster(query);
    
    if (!useConsensus) {
        return basePrediction;
    }
    
    try {
        // Get consensus from web sources
        const consensusResult = await getCachedConsensus(query, {
            timeout: 8000,
            minSources: 2
        });
        
        if (consensusResult.success && consensusResult.consensus.consensus) {
            const consensus = consensusResult.consensus;
            
            // Blend base prediction with consensus
            const blendedValue = (basePrediction.prediction.expectedValue * 0.4) + 
                                 (consensus.consensus * 0.6); // Weight consensus higher
            
            // Calculate new range based on consensus variance
            const combinedStdDev = (consensus.standardDeviation + 
                                   (basePrediction.prediction.range.high - basePrediction.prediction.expectedValue)) / 2;
            
            return {
                ...basePrediction,
                prediction: {
                    ...basePrediction.prediction,
                    expectedValue: Math.round(blendedValue * 10) / 10,
                    range: {
                        low: Math.round((blendedValue - combinedStdDev) * 10) / 10,
                        high: Math.round((blendedValue + combinedStdDev) * 10) / 10
                    },
                    confidenceScore: consensus.confidence,
                    confidence: consensus.interpretation.confidence
                },
                consensus: {
                    enabled: true,
                    sources: consensus.sources,
                    webConsensus: consensus.consensus,
                    disagreement: consensus.disagreement,
                    breakdown: {
                        models: consensus.modelAvg,
                        markets: consensus.marketAvg,
                        experts: consensus.expertAvg
                    },
                    insights: consensus.interpretation.insights,
                    recommendation: consensus.interpretation.recommendation
                },
                reasoning: {
                    ...basePrediction.reasoning,
                    keyDrivers: [
                        ...basePrediction.reasoning.keyDrivers,
                        {
                            name: "Web Consensus",
                            impact: consensus.disagreement < 0.15 ? "POSITIVE" : "NEUTRAL",
                            description: `${consensus.sources} sources agree at ${consensus.consensus} (${consensus.interpretation.agreement} consensus)`
                        }
                    ],
                    signals: [
                        ...basePrediction.reasoning.signals,
                        ...consensus.interpretation.insights.map(insight => ({
                            type: insight.type,
                            sentiment: insight.severity === 'HIGH' ? 'NEGATIVE' : 'NEUTRAL',
                            text: insight.message
                        }))
                    ]
                },
                modelId: "FORECASTER-V4-CONSENSUS"
            };
        }
    } catch (error) {
        console.warn('[Forecaster] Consensus aggregation failed:', error);
    }
    
    // Return base prediction if consensus fails
    return {
        ...basePrediction,
        consensus: {
            enabled: false,
            error: 'Consensus aggregation unavailable'
        }
    };
};
