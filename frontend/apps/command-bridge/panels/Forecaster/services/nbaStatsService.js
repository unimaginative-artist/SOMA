/**
 * NBA Stats Service
 * Fetches real player statistics and calculates averages from actual game data
 */

const CURRENT_SEASON = '2024-25';
const NBA_API_BASE = 'https://stats.nba.com/stats';

// Headers required for NBA API
const NBA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nba.com/',
    'Origin': 'https://www.nba.com'
};

/**
 * Search for a player by name
 * @param {string} playerName - Player's name (e.g., "Devin Booker")
 * @returns {Promise<Object>} Player info with ID
 */
export const findPlayer = async (playerName) => {
    try {
        // Use balldontlie API as it's CORS-friendly
        const response = await fetch(`https://www.balldontlie.io/api/v1/players?search=${encodeURIComponent(playerName)}`);
        
        if (!response.ok) {
            throw new Error('Player search failed');
        }
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const player = data.data[0];
            return {
                id: player.id,
                name: `${player.first_name} ${player.last_name}`,
                team: player.team.full_name,
                position: player.position
            };
        }
        
        return null;
    } catch (error) {
        console.error('[NBA Stats] Player search failed:', error);
        return null;
    }
};

/**
 * Get player's season averages
 * @param {number} playerId - Player's ID
 * @returns {Promise<Object>} Season averages
 */
export const getPlayerSeasonAverages = async (playerId) => {
    try {
        // Use balldontlie API for season averages
        const response = await fetch(`https://www.balldontlie.io/api/v1/season_averages?season=2024&player_ids[]=${playerId}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch season averages');
        }
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const stats = data.data[0];
            return {
                gamesPlayed: stats.games_played,
                points: stats.pts,
                assists: stats.ast,
                rebounds: stats.reb,
                steals: stats.stl,
                blocks: stats.blk,
                turnovers: stats.turnover,
                fieldGoalPct: stats.fg_pct,
                threePointPct: stats.fg3_pct,
                freeThrowPct: stats.ft_pct,
                minutes: stats.min
            };
        }
        
        return null;
    } catch (error) {
        console.error('[NBA Stats] Season averages failed:', error);
        return null;
    }
};

/**
 * Get player's last N games for variance calculation
 * @param {number} playerId - Player's ID
 * @param {number} gameCount - Number of recent games to fetch
 * @returns {Promise<Array>} Recent game stats
 */
export const getRecentGames = async (playerId, gameCount = 10) => {
    try {
        // Use balldontlie API for game logs
        const response = await fetch(`https://www.balldontlie.io/api/v1/stats?seasons[]=2024&player_ids[]=${playerId}&per_page=${gameCount}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch recent games');
        }
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            return data.data.map(game => ({
                date: game.game.date,
                opponent: game.game.visitor_team.id === game.team.id 
                    ? game.game.home_team.abbreviation 
                    : game.game.visitor_team.abbreviation,
                points: game.pts,
                assists: game.ast,
                rebounds: game.reb,
                minutes: game.min
            }));
        }
        
        return [];
    } catch (error) {
        console.error('[NBA Stats] Recent games failed:', error);
        return [];
    }
};

/**
 * Calculate statistical variance and confidence intervals
 * @param {Array} values - Array of stat values
 * @returns {Object} Statistical measures
 */
export const calculateStatistics = (values) => {
    if (!values || values.length === 0) {
        return {
            mean: 0,
            median: 0,
            stdDev: 0,
            min: 0,
            max: 0,
            confidenceInterval: { low: 0, high: 0 }
        };
    }
    
    // Mean
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    // Standard Deviation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Median
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    
    // Min/Max
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    // 68% Confidence Interval (1 standard deviation)
    const confidenceInterval = {
        low: Math.max(0, mean - stdDev),
        high: mean + stdDev
    };
    
    // 95% Confidence Interval (2 standard deviations)
    const ceiling = mean + (2 * stdDev);
    const floor = Math.max(0, mean - (2 * stdDev));
    
    return {
        mean: Math.round(mean * 10) / 10,
        median: Math.round(median * 10) / 10,
        stdDev: Math.round(stdDev * 10) / 10,
        min,
        max,
        confidenceInterval: {
            low: Math.round(confidenceInterval.low * 10) / 10,
            high: Math.round(confidenceInterval.high * 10) / 10
        },
        ceiling: Math.round(ceiling * 10) / 10,
        floor: Math.round(floor * 10) / 10
    };
};

/**
 * Determine volatility level based on standard deviation
 * @param {number} stdDev - Standard deviation
 * @param {number} mean - Mean value
 * @returns {string} Volatility level
 */
export const getVolatilityLevel = (stdDev, mean) => {
    const coefficientOfVariation = stdDev / mean;
    
    if (coefficientOfVariation < 0.15) return 'LOW';
    if (coefficientOfVariation < 0.25) return 'MEDIUM';
    return 'HIGH';
};

/**
 * Determine confidence level based on data availability and variance
 * @param {number} gamesPlayed - Number of games in sample
 * @param {number} coefficientOfVariation - CV (stdDev / mean)
 * @returns {string} Confidence level
 */
export const getConfidenceLevel = (gamesPlayed, coefficientOfVariation) => {
    if (gamesPlayed < 5 || coefficientOfVariation > 0.3) return 'LOW';
    if (gamesPlayed < 15 || coefficientOfVariation > 0.2) return 'MEDIUM';
    return 'HIGH';
};
