import { GameStatus } from '../types.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberFromLine = value => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value || '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

// Kept under the existing export name to avoid breaking callers. This is a
// deterministic market baseline, not an AI or proprietary prediction model.
export const analyzeGameWithGemini = async (game) => {
    const spread = numberFromLine(game.marketOdds?.spread);
    const total = numberFromLine(game.marketOdds?.total) || 215;
    const expectedMargin = -spread;
    const impliedHomeScore = Math.round((total + expectedMargin) / 2);
    const impliedAwayScore = Math.round((total - expectedMargin) / 2);
    const isLive = game.status === GameStatus.LIVE || game.status === GameStatus.FINISHED;
    const currentMargin = isLive ? Number(game.homeScore || 0) - Number(game.awayScore || 0) : expectedMargin;
    const marginDelta = currentMargin - expectedMargin;
    const realityDrift = isLive ? Math.min(100, Math.round((Math.abs(marginDelta) / 15) * 100)) : 0;
    const modelWinProbHome = clamp(0.5 - spread * 0.03, 0.01, 0.99);

    return {
        gameId: game.id,
        analysisBasis: 'market-implied-baseline',
        modelWinProbHome,
        modelWinProbAway: 1 - modelWinProbHome,
        impliedProbHome: modelWinProbHome,
        edge: 0,
        kellyStake: 0,
        confidence: isLive ? 45 : 30,
        reasoning: isLive
            ? `Market baseline only: current margin differs from the listed spread by ${Math.abs(marginDelta).toFixed(1)} points. No trained predictive edge has been verified.`
            : `Market baseline only: spread and total imply approximately ${impliedHomeScore}-${impliedAwayScore}. No trained predictive edge has been verified.`,
        volatilityIndex: isLive ? realityDrift : 0,
        projectedScoreHome: isLive ? Number(game.homeScore || impliedHomeScore) : impliedHomeScore,
        projectedScoreAway: isLive ? Number(game.awayScore || impliedAwayScore) : impliedAwayScore,
        realityDrift,
        propPredictions: (game.props || []).map(prop => ({
            propId: prop.id,
            modelProjection: prop.line,
            modelProbOver: 0.5,
            modelProbUnder: 0.5,
            drift: 0,
            recommendation: 'HOLD',
            basis: 'market-line-only'
        }))
    };
};
