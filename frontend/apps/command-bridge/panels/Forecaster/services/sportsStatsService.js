/**
 * Unified Sports Stats Service
 * Fetches real player statistics across NBA, NFL, NHL, and Soccer
 * Calculates averages, variance, and predictions based on actual game data
 */

import {
    calculateStatistics,
    getVolatilityLevel,
    getConfidenceLevel
} from './nbaStatsService.js';

// API endpoints for different sports
const APIS = {
    NBA: 'https://www.balldontlie.io/api/v1',
    NFL: 'https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com',
    NHL: 'https://api-web.nhle.com/v1',
    SOCCER: 'https://api-football-v1.p.rapidapi.com/v3'
};

/**
 * Detect sport and stat type from natural language query
 * @param {string} query - Natural language query
 * @returns {Object} Parsed query info
 */
export const parseQuery = (query) => {
    const lowerQuery = query.toLowerCase();
    
    // Extract player name (assumes format: "Player Name stat")
    let playerName = '';
    let sport = null;
    let statType = null;
    
    // Detect sport
    if (lowerQuery.includes('nba') || lowerQuery.includes('basketball')) {
        sport = 'NBA';
    } else if (lowerQuery.includes('nfl') || lowerQuery.includes('football') || 
               lowerQuery.includes('yards') || lowerQuery.includes('touchdown')) {
        sport = 'NFL';
    } else if (lowerQuery.includes('nhl') || lowerQuery.includes('hockey') || 
               lowerQuery.includes('goal') || lowerQuery.includes('assist')) {
        sport = 'NHL';
    } else if (lowerQuery.includes('soccer') || lowerQuery.includes('premier league') ||
               lowerQuery.includes('la liga') || lowerQuery.includes('uefa')) {
        sport = 'SOCCER';
    }
    
    // Detect stat type
    if (lowerQuery.includes('point')) {
        statType = 'points';
    } else if (lowerQuery.includes('assist')) {
        statType = 'assists';
    } else if (lowerQuery.includes('rebound')) {
        statType = 'rebounds';
    } else if (lowerQuery.includes('passing yard') || lowerQuery.includes('pass yard')) {
        statType = 'passingYards';
    } else if (lowerQuery.includes('rushing yard') || lowerQuery.includes('rush yard')) {
        statType = 'rushingYards';
    } else if (lowerQuery.includes('receiving yard')) {
        statType = 'receivingYards';
    } else if (lowerQuery.includes('touchdown')) {
        statType = 'touchdowns';
    } else if (lowerQuery.includes('goal')) {
        statType = 'goals';
    } else if (lowerQuery.includes('shot')) {
        statType = 'shots';
    }
    
    // Extract player name (everything before stat keywords)
    const statKeywords = ['point', 'assist', 'rebound', 'yard', 'touchdown', 'goal', 'shot', 'get', 'have', 'score'];
    const words = query.split(' ');
    const nameWords = [];
    
    for (const word of words) {
        const lowerWord = word.toLowerCase();
        if (statKeywords.some(keyword => lowerWord.includes(keyword))) {
            break;
        }
        if (!['how', 'many', 'will', 'what', 'does', 'nba', 'nfl', 'nhl', 'vs', 'against'].includes(lowerWord)) {
            nameWords.push(word);
        }
    }
    
    playerName = nameWords.join(' ').trim();
    
    return {
        playerName,
        sport: sport || 'NBA', // Default to NBA
        statType: statType || 'points', // Default to points
        originalQuery: query
    };
};

/**
 * Fetch player stats from appropriate API based on sport
 * @param {string} playerName - Player's name
 * @param {string} sport - Sport type (NBA, NFL, NHL, SOCCER)
 * @returns {Promise<Object>} Player stats and averages
 */
export const getPlayerStats = async (playerName, sport) => {
    console.log(`[Sports Stats] Fetching ${sport} stats for ${playerName}`);
    
    switch (sport) {
        case 'NBA':
            return await getNBAStats(playerName);
        case 'NFL':
            return await getNFLStats(playerName);
        case 'NHL':
            return await getNHLStats(playerName);
        case 'SOCCER':
            return await getSoccerStats(playerName);
        default:
            throw new Error(`Unsupported sport: ${sport}`);
    }
};

/**
 * NBA Stats (using balldontlie API)
 */
const getNBAStats = async (playerName) => {
    try {
        // Search for player
        const searchResponse = await fetch(`${APIS.NBA}/players?search=${encodeURIComponent(playerName)}`);
        const searchData = await searchResponse.json();
        
        if (!searchData.data || searchData.data.length === 0) {
            throw new Error('Player not found');
        }
        
        const player = searchData.data[0];
        const playerId = player.id;
        
        // Get season averages
        const avgResponse = await fetch(`${APIS.NBA}/season_averages?season=2024&player_ids[]=${playerId}`);
        const avgData = await avgResponse.json();
        
        // Get recent games
        const gamesResponse = await fetch(`${APIS.NBA}/stats?seasons[]=2024&player_ids[]=${playerId}&per_page=15`);
        const gamesData = await gamesResponse.json();
        
        const recentGames = gamesData.data || [];
        
        return {
            player: {
                name: `${player.first_name} ${player.last_name}`,
                team: player.team.full_name,
                position: player.position
            },
            seasonAverages: avgData.data[0] || {},
            recentGames: recentGames.map(g => ({
                date: g.game.date,
                opponent: g.game.visitor_team.id === g.team.id ? g.game.home_team.abbreviation : g.game.visitor_team.abbreviation,
                points: g.pts,
                assists: g.ast,
                rebounds: g.reb,
                minutes: g.min
            })),
            sport: 'NBA'
        };
    } catch (error) {
        console.error('[NBA Stats] Error:', error);
        throw error;
    }
};

/**
 * NFL Stats (ESPN public API as fallback)
 */
const getNFLStats = async (playerName) => {
    try {
        // Use ESPN's public API
        const searchResponse = await fetch(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=1&league=nfl`);
        const searchData = await searchResponse.json();
        
        if (!searchData.results || searchData.results.length === 0) {
            throw new Error('Player not found');
        }
        
        const result = searchData.results[0];
        
        // Get player stats from ESPN
        const statsResponse = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/${result.id}/statistics`);
        const statsData = await statsResponse.json();
        
        // Parse stats based on position
        const stats = statsData.statistics?.[0]?.splits?.categories || [];
        
        return {
            player: {
                name: result.name,
                team: result.team?.name || 'Unknown',
                position: result.position || 'Unknown'
            },
            stats: stats,
            sport: 'NFL'
        };
    } catch (error) {
        console.error('[NFL Stats] Error:', error);
        throw error;
    }
};

/**
 * NHL Stats (using NHL official API)
 */
const getNHLStats = async (playerName) => {
    try {
        // Search for player
        const searchResponse = await fetch(`https://suggest.svc.nhl.com/svc/suggest/v1/minplayers/${encodeURIComponent(playerName)}/99999`);
        const searchData = await searchResponse.json();
        
        if (!searchData.suggestions || searchData.suggestions.length === 0) {
            throw new Error('Player not found');
        }
        
        const playerId = searchData.suggestions[0].split('|')[0];
        
        // Get player stats
        const statsResponse = await fetch(`${APIS.NHL}/player/${playerId}/landing`);
        const statsData = await statsResponse.json();
        
        return {
            player: {
                name: `${statsData.firstName?.default} ${statsData.lastName?.default}`,
                team: statsData.currentTeamAbbrev,
                position: statsData.position
            },
            seasonStats: statsData.featuredStats?.regularSeason?.subSeason || {},
            recentGames: statsData.last5Games || [],
            sport: 'NHL'
        };
    } catch (error) {
        console.error('[NHL Stats] Error:', error);
        throw error;
    }
};

/**
 * Soccer Stats (using API-Football as fallback)
 */
const getSoccerStats = async (playerName) => {
    try {
        // Note: This requires RapidAPI key, fallback to public sources
        // Using ESPN Soccer API as free alternative
        const searchResponse = await fetch(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=1&league=eng.1`);
        const searchData = await searchResponse.json();
        
        if (!searchData.results || searchData.results.length === 0) {
            throw new Error('Player not found');
        }
        
        const result = searchData.results[0];
        
        return {
            player: {
                name: result.name,
                team: result.team?.name || 'Unknown',
                position: result.position || 'Unknown'
            },
            sport: 'SOCCER'
        };
    } catch (error) {
        console.error('[Soccer Stats] Error:', error);
        throw error;
    }
};

/**
 * Build forecaster response from player stats
 * @param {Object} statsData - Player stats data
 * @param {string} statType - Type of stat to predict
 * @returns {Object} Forecaster prediction format
 */
export const buildForecastResponse = (statsData, statType) => {
    const { player, seasonAverages, recentGames, sport } = statsData;
    
    let statValues = [];
    let avgValue = 0;
    let statLabel = statType;
    
    // Extract the relevant stat from recent games
    if (sport === 'NBA') {
        if (statType === 'points') {
            statValues = recentGames.map(g => g.points);
            avgValue = seasonAverages.pts || 0;
            statLabel = 'Points';
        } else if (statType === 'assists') {
            statValues = recentGames.map(g => g.assists);
            avgValue = seasonAverages.ast || 0;
            statLabel = 'Assists';
        } else if (statType === 'rebounds') {
            statValues = recentGames.map(g => g.rebounds);
            avgValue = seasonAverages.reb || 0;
            statLabel = 'Rebounds';
        }
    }
    
    // Calculate statistics
    const stats = calculateStatistics(statValues.length > 0 ? statValues : [avgValue]);
    const volatility = getVolatilityLevel(stats.stdDev, stats.mean);
    const confidence = getConfidenceLevel(recentGames.length, stats.stdDev / stats.mean);
    
    // Build comparables from recent games
    const comparables = recentGames.slice(0, 5).map(game => ({
        player: player.name,
        game: `vs ${game.opponent}`,
        result: game[statType.toLowerCase()] || game.points,
        context: `${game.date}`
    }));
    
    return {
        interpretation: {
            entity: player.name,
            stat: statLabel,
            context: `${player.team} (${sport} ${seasonAverages.games_played || recentGames.length} games)`,
            intent: 'PROJECTION'
        },
        prediction: {
            expectedValue: stats.mean,
            range: stats.confidenceInterval,
            ceiling: stats.ceiling,
            floor: stats.floor,
            confidence: confidence,
            confidenceScore: confidence === 'HIGH' ? 0.85 : confidence === 'MEDIUM' ? 0.65 : 0.45,
            volatility: volatility,
            distributionType: 'NORMAL'
        },
        reasoning: {
            summary: `Based on ${recentGames.length} recent games. Season average: ${avgValue.toFixed(1)} ${statLabel.toLowerCase()}. Recent performance shows ${volatility.toLowerCase()} volatility with ${(stats.stdDev).toFixed(1)} standard deviation.`,
            keyDrivers: [
                {
                    name: 'Season Average',
                    impact: 'POSITIVE',
                    description: `Averaging ${avgValue.toFixed(1)} ${statLabel.toLowerCase()} per game this season`
                },
                {
                    name: 'Recent Form',
                    impact: stats.mean > avgValue ? 'POSITIVE' : 'NEGATIVE',
                    description: `Last ${recentGames.length} games avg: ${stats.mean.toFixed(1)} (${stats.mean > avgValue ? 'above' : 'below'} season avg)`
                },
                {
                    name: 'Consistency',
                    impact: volatility === 'LOW' ? 'POSITIVE' : volatility === 'HIGH' ? 'NEGATIVE' : 'NEUTRAL',
                    description: `${volatility} volatility - ${stats.stdDev.toFixed(1)} std dev`
                }
            ],
            signals: [
                {
                    type: 'TREND',
                    sentiment: stats.mean > avgValue ? 'POSITIVE' : 'NEGATIVE',
                    text: `Recent ${recentGames.length}-game average ${stats.mean > avgValue ? 'exceeds' : 'below'} season average`
                }
            ]
        },
        comparables: comparables,
        timestamp: new Date().toISOString(),
        modelId: `FORECASTER-REAL-DATA-${sport}`
    };
};

/**
 * Main query function - integrates all sports
 * @param {string} query - Natural language query
 * @returns {Promise<Object>} Prediction response
 */
export const queryRealSportsData = async (query) => {
    console.log(`[Sports Stats] Processing query: "${query}"`);
    
    try {
        // Parse the query
        const parsed = parseQuery(query);
        console.log('[Sports Stats] Parsed:', parsed);
        
        if (!parsed.playerName) {
            throw new Error('Could not identify player name from query');
        }
        
        // Fetch stats
        const statsData = await getPlayerStats(parsed.playerName, parsed.sport);
        
        // Build response
        const response = buildForecastResponse(statsData, parsed.statType);
        
        console.log('[Sports Stats] Response built successfully');
        return response;
        
    } catch (error) {
        console.error('[Sports Stats] Query failed:', error);
        throw error;
    }
};
