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
            // Try backend API. /moneyball is the active SOMA route; /predict was
            // an older contract and silently broke the fallback path.
            const response = await fetch('/api/forecaster/moneyball', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.prediction) {
                    console.log('[Forecaster] Using backend prediction');
                    return data.prediction;
                }
                if (data.success && data.forecast) {
                    console.log('[Forecaster] Using backend forecast dossier');
                    return normalizeBackendForecast(query, data.forecast);
                }
            }
        } catch (error) {
            console.warn('[Forecaster] Backend error:', error.message);
        }

        // --- DE-MOCKED: No more simulation fallback ---
        throw new Error(`Forecaster Unavailable: Could not retrieve real-time or backend prediction for "${query}".`);
    }
};

const parsePercent = (value, fallback = 50) => {
    if (typeof value === 'number') return value;
    const parsed = Number.parseFloat(String(value || '').replace('%', ''));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBackendForecast = (query, forecast) => {
    const probability = parsePercent(forecast.win_probability || forecast.probability, 50);
    const confidence = String(forecast.confidence || 'MEDIUM').toUpperCase();

    return {
        interpretation: {
            entity: forecast.matchup || query,
            stat: 'Outcome Forecast',
            context: 'SOMA backend forecast dossier',
            intent: 'PROJECTION'
        },
        prediction: {
            expectedValue: probability,
            range: {
                low: Math.max(0, probability - 8),
                high: Math.min(100, probability + 8)
            },
            ceiling: Math.min(100, probability + 15),
            floor: Math.max(0, probability - 15),
            confidence,
            confidenceScore: confidence === 'HIGH' ? 0.85 : confidence === 'LOW' ? 0.45 : 0.65,
            volatility: confidence === 'LOW' ? 'HIGH' : 'MEDIUM',
            distributionType: 'BERNOULLI'
        },
        reasoning: {
            summary: forecast.details || forecast.prediction || 'Backend forecast returned without a detailed rationale.',
            keyDrivers: [
                {
                    name: 'SOMA Forecast Dossier',
                    impact: confidence === 'HIGH' ? 'POSITIVE' : 'NEUTRAL',
                    description: `${forecast.sources_count || 0} source groups contributed to this forecast.`
                }
            ],
            signals: []
        },
        comparables: [],
        timestamp: new Date().toISOString(),
        modelId: 'FORECASTER-BACKEND-DOSSIER'
    };
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

export const fetchActiveGuesses = async () => {
    try {
        const res = await fetch('/api/forecaster/guesses');
        const data = await res.json();
        return data.success ? data.guesses : [];
    } catch (e) {
        console.error('Failed to fetch active guesses', e);
        return [];
    }
};

