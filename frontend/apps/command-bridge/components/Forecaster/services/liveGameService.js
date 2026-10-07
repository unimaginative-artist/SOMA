import { GameStatus, Sport } from '../types.js';
import { INITIAL_GAMES } from './mockData.js';

// Use local backend proxy to bypass CORS
const API_BASE = '/api/market/espn';

const SPORT_CONFIG = {
    [Sport.NBA]: { sport: 'basketball', league: 'nba' },
    [Sport.NFL]: { sport: 'football', league: 'nfl' },
    [Sport.EPL]: { sport: 'soccer', league: 'eng.1' }, // Added EPL example
    // Add others as needed
};

export const fetchLiveGames = async () => {
    try {
        // Fetch supported sports in parallel
        const sportsToFetch = [Sport.NBA, Sport.NFL]; // Add others if needed
        const promises = sportsToFetch.map(s => fetchEndpoint(s));
        
        const results = await Promise.all(promises);
        const allGames = results.flat();

        if (allGames.length === 0) {
            console.warn("No live games found from API, checking for mock fallback...");
            // Only fallback if truly empty? Or maybe mix them?
            // For now, if API works but returns empty (off-season), that's valid.
            // But if API fails (returns null/undefined), fallback.
            // My fetchEndpoint returns [] on error, so we might get [] if all fail.
            // Let's fallback if empty just to show *something* for the demo.
             return INITIAL_GAMES;
        }

        return allGames;
    } catch (error) {
        console.error("Failed to fetch live games:", error);
        return INITIAL_GAMES; // Graceful degradation
    }
};

const fetchEndpoint = async (sportKey) => {
    const config = SPORT_CONFIG[sportKey];
    if (!config) return [];

    try {
        // Call local backend proxy: /api/market/espn/:sport/:league/scoreboard
        const url = `${API_BASE}/${config.sport}/${config.league}/scoreboard`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        return (data.events || []).map(event => mapEspnEventToGame(event, sportKey));
    } catch (e) {
        console.warn(`Error fetching ${sportKey}:`, e);
        return [];
    }
};

const mapEspnEventToGame = (event, sport) => {
    const competition = event.competitions[0];
    const homeComp = competition.competitors.find(c => c.homeAway === 'home');
    const awayComp = competition.competitors.find(c => c.homeAway === 'away');

    // Status Mapping
    let status = GameStatus.SCHEDULED;
    const state = event.status.type.state;
    if (state === 'in') status = GameStatus.LIVE;
    if (state === 'post') status = GameStatus.FINISHED;

    return {
        id: event.id,
        sport: sport,
        status: status,
        startTime: event.date, // ISO String
        quarter: status === GameStatus.LIVE ? `P${event.status.period}` : (status === GameStatus.FINISHED ? 'FINAL' : ''),
        clock: event.status.displayClock || '',

        homeTeam: {
            id: homeComp.team.id,
            name: homeComp.team.displayName,
            shortName: homeComp.team.abbreviation,
            record: homeComp.records?.[0]?.summary || '0-0',
            logoColor: `#${homeComp.team.color || '000000'}`,
            logoUrl: homeComp.team.logo
        },
        awayTeam: {
            id: awayComp.team.id,
            name: awayComp.team.displayName,
            shortName: awayComp.team.abbreviation,
            record: awayComp.records?.[0]?.summary || '0-0',
            logoColor: `#${awayComp.team.color || '000000'}`,
            logoUrl: awayComp.team.logo
        },

        homeScore: parseInt(homeComp.score || 0),
        awayScore: parseInt(awayComp.score || 0),

        // Default or mapped market odds (ESPN sometimes has this, often not in the basic feed)
        marketOdds: {
            provider: 'Consensus',
            homeMoneyline: -110, // Placeholder
            awayMoneyline: -110, // Placeholder
            spread: competition.odds?.[0]?.details || 'OFF',
            total: competition.odds?.[0]?.overUnder || 0,
            lastUpdated: new Date().toISOString()
        },

        // We can't easily get granular events/stats from the summary feed, so we initialize empty
        events: [],
        homePlayerStats: [],
        awayPlayerStats: [],
        props: []
    };
};
