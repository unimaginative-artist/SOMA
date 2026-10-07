// import { GoogleGenAI, Type } from "@google/genai"; // COMMENTED OUT TO PREVENT CRASH
import { GameStatus } from '../types.js';

// NOTE: In a real app, this would be a server-side call to protect the key.
const ai = null; // FORCE MOCK MODE

export const analyzeGameWithGemini = async (game) => {
    // ALWAYS USE MOCK DATA FOR NOW TO RESTORE SYSTEM STABILITY
    // The previous implementation imported a Node.js library (@google/genai) which crashed the Vite frontend.

    console.warn("Using Forecaster Mock Engine (System Stability Mode)");

    // Generate mock predictions for props based on the game data
    const mockPropPredictions = game.props.map(p => ({
        propId: p.id,
        modelProjection: p.line * (1 + (Math.random() * 0.2 - 0.1)),
        modelProbOver: Math.random(),
        modelProbUnder: Math.random(),
        drift: Math.random() * 0.15,
        recommendation: (Math.random() > 0.5 ? 'OVER' : 'UNDER')
    }));

    // Calculate Dynamic Reality Drift
    // How far is the actual game state from the pre-game market expectation?
    const spread = game.marketOdds?.spread || 0;
    // Handle "OFF" or string spreads
    const numericSpread = typeof spread === 'string' ? parseFloat(spread) || 0 : spread;

    let currentMargin = 0;
    if (game.status === GameStatus.LIVE || game.status === GameStatus.FINISHED) {
        currentMargin = (game.homeScore || 0) - (game.awayScore || 0);
    }

    // Spread is usually "Home -5.5" (Home favored) -> Margin should be +5.5 to cover.
    // If spread is -5.5, Expected Margin is +5.5.
    // If spread is +3.0, Expected Margin is -3.0.
    const expectedMargin = -numericSpread;

    // Drift = Difference between current reality (margin) and expectation.
    // Normalized somewhat arbitrarily for "Impact" (0-100 scale).
    // Pre-game, drift is 0 unless there's line movement (which we don't track history of yet).
    let driftValue = 0;
    if (game.status === GameStatus.LIVE) {
        driftValue = Math.abs(currentMargin - expectedMargin);
        // Scale: A 10 point swing is "High Drift" (e.g. 50%)
        driftValue = Math.min(100, Math.round((driftValue / 15) * 100));
    } else if (game.status === GameStatus.SCHEDULED) {
        // Pre-game "Drift" could be Line Movement. Let's mock a small realistic deviation.
        driftValue = Math.floor(Math.random() * 10);
    }

    // Dynamic Win Prob based on Score (Simple heuristic)
    // If Home is leading by 10, prob ~ 80%. 
    // This is VERY rough, just for UI demo.
    let wpHome = 0.5;
    if (game.status === GameStatus.LIVE) {
        const sigmoid = (x) => 1 / (1 + Math.exp(-x));
        // Simple logistic function of score diff
        wpHome = sigmoid(currentMargin / 10); // 10 pts diff = ~73% win prob
    } else {
        // Derived from moneyline or spread
        // Standard approximation: Win% = 0.5 - (Spread * 0.03)
        wpHome = 0.5 - (numericSpread * 0.03);
    }
    wpHome = Math.max(0.01, Math.min(0.99, wpHome));

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                gameId: game.id,
                modelWinProbHome: wpHome,
                modelWinProbAway: 1 - wpHome,
                impliedProbHome: 0.5 - (numericSpread * 0.03), // Simple proxy
                edge: Math.abs(wpHome - (0.5 - (numericSpread * 0.03))),
                kellyStake: 0.025,
                confidence: game.status === GameStatus.SCHEDULED ? 74 : 82,
                reasoning: game.status === GameStatus.SCHEDULED
                    ? `FORECASTER (PRE-GAME): Market implies ${game.homeTeam.shortName} by ${Math.abs(numericSpread)}. Our models see value due to recent defensive efficiency trends.`
                    : `FORECASTER (LIVE): Reality Drift of ${driftValue}% detected. ${currentMargin > expectedMargin ? game.homeTeam.shortName : game.awayTeam.shortName} outperforming expectations by ${Math.abs(currentMargin - expectedMargin).toFixed(1)} points.`,
                volatilityIndex: game.status === GameStatus.LIVE ? 60 : 30, // Higher vol live
                projectedScoreHome: game.status === GameStatus.LIVE ? Math.max(game.homeScore, Math.round(game.homeScore * 1.5)) : 110,
                projectedScoreAway: game.status === GameStatus.LIVE ? Math.max(game.awayScore, Math.round(game.awayScore * 1.5)) : 105,
                realityDrift: driftValue,
                propPredictions: mockPropPredictions
            });
        }, 800); // Faster think time
    });
};
