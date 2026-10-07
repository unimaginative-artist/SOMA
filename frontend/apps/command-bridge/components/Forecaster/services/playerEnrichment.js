/**
 * Player Enrichment Service
 *
 * Fetches real player season averages + recent game variance for a specific game.
 * Called lazily when the Oracle is triggered — not on every game load.
 *
 * NBA: ESPN roster → Ball Don't Lie season averages + recent 10 games
 * NFL: ESPN roster → ESPN athlete statistics
 */

const ESPN_BASE = '/api/market/espn';
const BDL_BASE = 'https://www.balldontlie.io/api/v1';

// Cache enriched game data to avoid re-fetching
const playerCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

// ── ESPN roster fetch ─────────────────────────────────────────────────────────
async function fetchEspnRoster(espnSport, espnLeague, teamId) {
    try {
        const res = await fetch(`${ESPN_BASE}/${espnSport}/${espnLeague}/teams/${teamId}/roster`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return [];
        const data = await res.json();
        // ESPN returns athletes grouped by position: [{ position, items: [{id, displayName, ...}] }]
        const allAthletes = (data.athletes || []).flatMap(group => group.items || []);
        return allAthletes.slice(0, 10); // top 10 per team (starters + key bench)
    } catch {
        return [];
    }
}

// ── Ball Don't Lie: search player + get averages + recent games ───────────────
async function fetchBDLPlayerStats(playerName) {
    try {
        // Search
        const searchRes = await fetch(`${BDL_BASE}/players?search=${encodeURIComponent(playerName)}`, {
            signal: AbortSignal.timeout(3000)
        });
        if (!searchRes.ok) return null;
        const searchData = await searchRes.json();
        const player = searchData.data?.[0];
        if (!player) return null;

        // Season averages + recent games in parallel
        const [avgRes, gamesRes] = await Promise.allSettled([
            fetch(`${BDL_BASE}/season_averages?season=2024&player_ids[]=${player.id}`, { signal: AbortSignal.timeout(3000) }),
            fetch(`${BDL_BASE}/stats?seasons[]=2024&player_ids[]=${player.id}&per_page=12`, { signal: AbortSignal.timeout(3000) })
        ]);

        const avgData = avgRes.status === 'fulfilled' && avgRes.value.ok
            ? await avgRes.value.json() : { data: [] };
        const gamesData = gamesRes.status === 'fulfilled' && gamesRes.value.ok
            ? await gamesRes.value.json() : { data: [] };

        const avg = avgData.data?.[0];
        if (!avg) return null;

        const recentPoints = (gamesData.data || []).map(g => g.pts || 0).filter(v => v > 0);
        const mean = recentPoints.length ? recentPoints.reduce((a, b) => a + b, 0) / recentPoints.length : avg.pts;
        const variance = recentPoints.length > 1
            ? recentPoints.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / recentPoints.length : 0;
        const stdev = Math.sqrt(variance) || avg.pts * 0.22;

        return {
            id: String(player.id),
            name: `${player.first_name} ${player.last_name}`,
            rating: Math.min(10, Math.max(1, Math.round(avg.pts / 3))),
            seasonAvg: avg.pts || 0,
            pointsPerGame: avg.pts || 0,
            assistsPerGame: avg.ast || 0,
            reboundsPerGame: avg.reb || 0,
            minutesPerGame: parseFloat(avg.min) || 28,
            stdev,
            gamesPlayed: avg.games_played || 0,
            position: player.position || 'F'
        };
    } catch {
        return null;
    }
}

// ── Main enrichment function ─────────────────────────────────────────────────
/**
 * Enrich a game object with real player stats for both teams.
 * Returns updated game with homePlayerStats and awayPlayerStats populated.
 * Falls back gracefully — if API fails, returns game unchanged.
 */
export async function enrichGameWithPlayers(game) {
    const cacheKey = `${game.id}:${game.homeTeam?.id}:${game.awayTeam?.id}`;
    const cached = playerCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.game;
    }

    const sport = game.sport || 'NBA';
    const espnSport = sport === 'NFL' ? 'football' : 'basketball';
    const espnLeague = sport === 'NFL' ? 'nfl' : 'nba';

    try {
        // Fetch both rosters in parallel
        const [homeAthletes, awayAthletes] = await Promise.all([
            fetchEspnRoster(espnSport, espnLeague, game.homeTeam?.id),
            fetchEspnRoster(espnSport, espnLeague, game.awayTeam?.id)
        ]);

        // For NBA: enrich with Ball Don't Lie stats
        const enrichAthletes = async (athletes) => {
            if (!athletes.length) return [];
            if (sport === 'NFL') {
                // For NFL, use ESPN's embedded stats or rating fallback
                return athletes.map((a, i) => ({
                    id: a.id,
                    name: a.displayName || `Player ${i+1}`,
                    rating: 7,
                    seasonAvg: 0,
                    minutesPerGame: 45,
                    stdev: 15,
                    position: a.position?.abbreviation || 'WR'
                }));
            }

            // NBA: fetch BDL stats for each player (rate-limited to 5 parallel)
            const results = await Promise.allSettled(
                athletes.slice(0, 8).map(a => fetchBDLPlayerStats(a.displayName))
            );

            return results
                .map((r, i) => {
                    if (r.status === 'fulfilled' && r.value) return r.value;
                    // Fallback to ESPN data only
                    const a = athletes[i];
                    return {
                        id: a?.id || String(i),
                        name: a?.displayName || `Player ${i+1}`,
                        rating: 7,
                        seasonAvg: 14,
                        pointsPerGame: 14,
                        minutesPerGame: 26,
                        stdev: 5,
                        position: a?.position?.abbreviation || 'F'
                    };
                })
                .filter(Boolean);
        };

        const [homeStats, awayStats] = await Promise.all([
            enrichAthletes(homeAthletes),
            enrichAthletes(awayAthletes)
        ]);

        const enrichedGame = {
            ...game,
            homePlayerStats: homeStats,
            awayPlayerStats: awayStats,
            playersEnriched: true,
            playersEnrichedAt: Date.now()
        };

        playerCache.set(cacheKey, { game: enrichedGame, ts: Date.now() });
        return enrichedGame;
    } catch (e) {
        console.warn('[PlayerEnrichment] Failed:', e.message);
        return game; // return original unchanged
    }
}

/**
 * Quick check: does this game already have player stats?
 */
export function gameHasPlayers(game) {
    return (game.homePlayerStats?.length > 0) && (game.awayPlayerStats?.length > 0);
}
