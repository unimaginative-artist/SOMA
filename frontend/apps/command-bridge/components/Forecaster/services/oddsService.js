/**
 * Odds Service — The Odds API wrapper + edge calculation
 * Proxies through SOMA backend to protect the API key.
 * Free tier: 500 requests/month. Results are cached for 10 minutes.
 */

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

function getCached(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    return null;
}
function setCache(key, data) {
    cache.set(key, { data, ts: Date.now() });
}

/**
 * Convert American odds to implied probability (0-1).
 * @param {number} americanOdds
 * @returns {number} implied probability
 */
export function americanToProb(americanOdds) {
    if (americanOdds === null || americanOdds === undefined || isNaN(americanOdds)) return 0.5;
    if (americanOdds > 0) return 100 / (americanOdds + 100);
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

/**
 * Convert implied probability to American odds.
 * @param {number} prob (0-1)
 * @returns {number} American odds
 */
export function probToAmerican(prob) {
    if (prob <= 0 || prob >= 1) return 0;
    if (prob >= 0.5) return Math.round(-prob / (1 - prob) * 100);
    return Math.round((1 - prob) / prob * 100);
}

/**
 * Calculate edge: our model's probability minus market's implied probability.
 * Positive = value bet (model thinks it's more likely than market does).
 * @param {number} modelProb (0-1)
 * @param {number} marketOdds (American)
 * @returns {{ edge: number, impliedProb: number, edgePct: string, hasValue: boolean }}
 */
export function calculateEdge(modelProb, marketOdds) {
    const impliedProb = americanToProb(marketOdds);
    const edge = modelProb - impliedProb;
    return {
        edge,
        impliedProb,
        edgePct: (edge * 100).toFixed(1),
        hasValue: edge > 0.03, // 3% edge threshold for "value bet"
        rating: edge > 0.1 ? 'STRONG' : edge > 0.05 ? 'MODERATE' : edge > 0.02 ? 'SLIGHT' : 'NONE'
    };
}

/**
 * Fetch current odds for a sport from SOMA backend.
 * @param {string} sport e.g. 'basketball_nba', 'americanfootball_nfl', 'icehockey_nhl'
 * @param {string} markets e.g. 'h2h,spreads,totals'
 * @returns {Array} array of game odds objects
 */
export async function fetchOdds(sport = 'basketball_nba', markets = 'h2h,spreads,totals') {
    const key = `odds:${sport}:${markets}`;
    const cached = getCached(key);
    if (cached) return cached;

    try {
        const res = await fetch(`/api/forecaster/odds?sport=${sport}&markets=${markets}`, {
            signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Odds API error');
        setCache(key, data.data);
        return data.data;
    } catch (e) {
        console.warn('[OddsService] fetchOdds failed:', e.message);
        return [];
    }
}

/**
 * Find best available line for a specific team from odds data.
 * @param {Array} oddsData
 * @param {string} teamName
 * @returns {{ bestMoneyline: number, bestBook: string, impliedProb: number } | null}
 */
export function findBestLine(oddsData, teamName) {
    const lower = teamName.toLowerCase();
    for (const game of oddsData) {
        const isHome = game.home_team?.toLowerCase().includes(lower);
        const isAway = game.away_team?.toLowerCase().includes(lower);
        if (!isHome && !isAway) continue;

        let bestOdds = null;
        let bestBook = null;
        for (const bm of (game.bookmakers || [])) {
            const h2h = bm.markets?.find(m => m.key === 'h2h');
            if (!h2h) continue;
            const outcome = h2h.outcomes?.find(o => o.name?.toLowerCase().includes(lower));
            if (!outcome) continue;
            const price = outcome.price;
            if (bestOdds === null || (price > 0 ? price > bestOdds : price > bestOdds)) {
                bestOdds = price;
                bestBook = bm.title;
            }
        }
        if (bestOdds !== null) {
            return { bestMoneyline: bestOdds, bestBook, impliedProb: americanToProb(bestOdds) };
        }
    }
    return null;
}

/**
 * Extract spread + total for a specific matchup.
 * @param {Array} oddsData
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {{ spread: number|null, total: number|null, bookmaker: string|null }}
 */
export function extractSpreadAndTotal(oddsData, homeTeam, awayTeam) {
    const homeLower = homeTeam?.toLowerCase();
    const awayLower = awayTeam?.toLowerCase();
    for (const game of oddsData) {
        const matchesHome = game.home_team?.toLowerCase().includes(homeLower) || homeLower?.includes(game.home_team?.toLowerCase());
        const matchesAway = game.away_team?.toLowerCase().includes(awayLower) || awayLower?.includes(game.away_team?.toLowerCase());
        if (!matchesHome && !matchesAway) continue;

        let spread = null, total = null, bookmaker = null;
        for (const bm of (game.bookmakers || [])) {
            const spreadMkt = bm.markets?.find(m => m.key === 'spreads');
            const totalMkt = bm.markets?.find(m => m.key === 'totals');
            if (spreadMkt) {
                const homeOutcome = spreadMkt.outcomes?.find(o => o.name?.toLowerCase().includes(homeLower));
                if (homeOutcome?.point != null) spread = homeOutcome.point;
            }
            if (totalMkt) {
                const overOutcome = totalMkt.outcomes?.find(o => o.name === 'Over');
                if (overOutcome?.point != null) total = overOutcome.point;
            }
            if (spread !== null || total !== null) { bookmaker = bm.title; break; }
        }
        return { spread, total, bookmaker, gameId: game.id };
    }
    return { spread: null, total: null, bookmaker: null };
}

/**
 * Identify value bets from a list of predictions vs market odds.
 * @param {Array} predictions - [{ entity, stat, modelProb, marketOdds }]
 * @returns {Array} sorted by edge descending, flagged with hasValue
 */
export function identifyValueBets(predictions) {
    return predictions
        .map(p => ({
            ...p,
            ...calculateEdge(p.modelProb || 0.5, p.marketOdds || -110)
        }))
        .filter(p => p.hasValue)
        .sort((a, b) => b.edge - a.edge);
}
