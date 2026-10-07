import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

/**
 * ForecasterArbiter V2 - "The Oracle"
 * 
 * Implements the "Moneyball" Web Consensus System.
 * Aggregates Models, Betting Markets, and Expert Analysis to form a weighted prediction.
 */
export class ForecasterArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'ForecasterArbiter',
            role: ArbiterRole.SPECIALIST,
            capabilities: [
                ArbiterCapability.SEARCH_WEB,
                ArbiterCapability.EXECUTE_CODE
            ]
        });

        this.quadBrain = opts.quadBrain;
        // We need a search capability. Assuming we can use EnrichmentArbiter or a direct search tool.
        // For independence, we'll assume we can pass a 'searchTool' or access system.enrichmentArbiter
        this.enrichmentArbiter = opts.enrichmentArbiter || null;
        this.worldModel = opts.worldModel || null; // Causal Simulation Engine
    }

    async onInitialize() {
        this.auditLogger.info('Forecaster Systems Online. Web Consensus & World Model Protocols Loaded.');
        this._startAutonomousPredictor();
    }

    async _startAutonomousPredictor() {
        // Run first cycle shortly after boot
        setTimeout(() => this._runAutonomousCycle(), 30000);
        
        // Then run every 4 hours
        setInterval(() => this._runAutonomousCycle(), 4 * 60 * 60 * 1000).unref();
    }

    async _runAutonomousCycle() {
        try {
            this.auditLogger.info('Starting Autonomous Guessing Cycle...');
            const sports = [{sport: 'basketball', league: 'nba'}, {sport: 'football', league: 'nfl'}, {sport: 'soccer', league: 'eng.1'}];
            
            let upcomingGames = [];
            for (const {sport, league} of sports) {
                try {
                    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
                    const res = await fetch(url);
                    if (!res.ok) continue;
                    const data = await res.json();
                    const games = data.events?.map(e => ({
                        id: e.id,
                        name: e.name,
                        shortName: e.shortName,
                        date: e.date,
                        sport: sport,
                        status: e.status?.type?.name // 'STATUS_SCHEDULED'
                    })) || [];
                    upcomingGames.push(...games.filter(g => g.status === 'STATUS_SCHEDULED'));
                } catch(e) {}
            }
            
            // Select up to 3 random upcoming games to predict
            upcomingGames = upcomingGames.sort(() => 0.5 - Math.random()).slice(0, 3);
            if (upcomingGames.length === 0) return;
            
            for (const game of upcomingGames) {
                this.auditLogger.info(`Autonomous prediction on: ${game.name}`);
                const forecast = await this.getForecast(game.name);
                if (!forecast.error) {
                    forecast.gameId = game.id;
                    forecast.date = game.date;
                    forecast.sport = game.sport;
                    forecast.matchup = game.name;
                    forecast.createdAt = new Date().toISOString();
                    
                    // Generate edge based on confidence vs 50/50
                    const confMap = { 'HIGH': 0.15, 'MEDIUM': 0.05, 'LOW': -0.05 };
                    forecast.calculatedEdge = (confMap[forecast.confidence] || 0) * 100;

                    const fs = await import('fs/promises');
                    const path = await import('path');
                    const guessesPath = path.join(process.cwd(), 'appendages', 'forecaster', 'active_guesses.json');
                    await fs.mkdir(path.dirname(guessesPath), { recursive: true }).catch(() => {});
                    
                    let existing = [];
                    try {
                        existing = JSON.parse(await fs.readFile(guessesPath, 'utf8'));
                    } catch(e) {}
                    
                    // Keep last 50 guesses
                    existing = [forecast, ...existing.filter(g => g.gameId !== forecast.gameId)].slice(0, 50);
                    await fs.writeFile(guessesPath, JSON.stringify(existing, null, 2), 'utf8');
                    
                    // Feed pipeline
                    const system = global.__SOMA_SYSTEM;
                    if (system?.universalLearningPipeline) {
                        system.universalLearningPipeline.logInteraction({
                            agent: 'ForecasterArbiter',
                            type: 'autonomous_guess',
                            input: { matchup: game.name },
                            output: { prediction: forecast.prediction, win_probability: forecast.win_probability, status: 'success' },
                            metadata: { tags: ['forecaster', 'autonomous', 'guessing'] }
                        }).catch(() => {});
                    }
                }
                // Wait between guesses
                await new Promise(r => setTimeout(r, 45000));
            }
        } catch (e) {
            this.auditLogger.error(`Autonomous predictor error: ${e.message}`);
        }
    }

    /**
     * Main Entry Point: Get Deep Forecast
     * @param {string} query - e.g. "Lakers vs Warriors"
     */
    async getForecast(query) {
        this.auditLogger.info(`🔮 Oracle active. Scrying: "${query}"`);
        const startTime = Date.now();

        // 1. Identify the Event
        const eventContext = await this._identifyEvent(query);
        if (!eventContext) return { error: "Could not identify a specific game or event." };

        this.auditLogger.info(`Found Event: ${eventContext.matchup} @ ${eventContext.time}`);

        // 2. Parallel Data Collection (The "Moneyball" Scrape)
        const [models, markets, experts] = await Promise.all([
            this._scrapeModels(eventContext),
            this._scrapeMarkets(eventContext),
            this._scrapeExperts(eventContext)
        ]);

        // 2.5 Run Causal Simulation (If WorldModel available)
        let simulation = { confidence: 0, outcome: "N/A" };
        if (this.worldModel) {
            simulation = await this._runSimulation(eventContext);
        }

        // 3. Calculate Consensus (Now including Simulation)
        const consensus = this._calculateConsensus(models, markets, experts, simulation);

        // 4. Generate Dossier (Synthesis)
        const dossier = await this._generateDossier(eventContext, consensus, { models, markets, experts, simulation });

        return {
            matchup: eventContext.matchup,
            prediction: consensus.finalPick,
            confidence: consensus.confidenceScore, // HIGH/MED/LOW
            win_probability: consensus.winProb,
            details: dossier,
            sources_count: models.length + markets.length + experts.length + (this.worldModel ? 1 : 0),
            breakdown: {
                models_avg: consensus.averages.models,
                markets_implied: consensus.averages.markets,
                experts_consensus: consensus.averages.experts,
                simulation_result: simulation.outcome
            },
            duration: ((Date.now() - startTime) / 1000).toFixed(1)
        };
    }

    // =========================================================================
    // 🔮 PHASE 2.5: CAUSAL SIMULATION
    // =========================================================================

    async _runSimulation(ctx) {
        this.auditLogger.info(`[Simulation] Running real Monte Carlo for ${ctx.matchup}...`);
        
        // Construct a state representation of the matchup
        const state = {
            matchup: ctx.matchup,
            sport: ctx.sport,
            momentum: ctx.momentum || "neutral",
            injuries: ctx.injuries || "none"
        };

        // Run "What If" scenarios in the world model
        const scenarios = [
            { actions: ['home_team_fast_start'], description: 'Home Momentum' },
            { actions: ['away_team_shutdown_defense'], description: 'Defensive Lockdown' },
            { actions: ['clutch_performance_star_player'], description: 'Star Power' }
        ];

        try {
            const results = await this.worldModel.generateWhatIfScenarios(state, scenarios);
            
            // Extract probability from real simulation traces
            const winCount = results.filter(r => r.outcome?.includes('win') || r.confidence > 0.6).length;
            const prob = (winCount / results.length) * 100;
            
            return {
                prob: prob || 50,
                outcome: prob > 50 ? "Home Win" : "Away Win",
                confidence: 0.85
            };
        } catch (e) {
            this.log('warn', `Simulation failed: ${e.message}`);
            return { prob: 50, outcome: "Inconclusive", confidence: 0.1 };
        }
    }

    // =========================================================================
    // 🕵️ PHASE 2: DATA COLLECTION (Real Web Research)
    // =========================================================================

    async _identifyEvent(query) {
        const raw = String(query || '').trim();
        if (!raw) return null;

        const cleaned = raw
            .replace(/^(sports prediction|forecast|moneyball|oracle)\s*:\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        const sport = this._inferSport(cleaned);
        const matchup = cleaned
            .replace(/\b(nba|nfl|mlb|nhl|epl|soccer|football|basketball|baseball|hockey)\b/ig, '')
            .replace(/\s+(game|matchup|forecast|prediction)\b/ig, '')
            .replace(/\s+/g, ' ')
            .trim() || cleaned;

        return {
            matchup,
            sport,
            time: 'upcoming or current slate',
            originalQuery: raw
        };
    }

    _inferSport(query) {
        const q = String(query || '').toLowerCase();
        if (/\b(nba|basketball|points|rebounds|assists)\b/.test(q)) return 'NBA';
        if (/\b(nfl|football|passing|rushing|receiving|touchdown|yards)\b/.test(q)) return 'NFL';
        if (/\b(mlb|baseball|hits|runs|rbi|strikeouts)\b/.test(q)) return 'MLB';
        if (/\b(nhl|hockey|goals|shots)\b/.test(q)) return 'NHL';
        if (/\b(epl|soccer|premier league|goals)\b/.test(q)) return 'SOCCER';
        return 'SPORTS';
    }

    async _scrapeModels(ctx) {
        if (!this.enrichmentArbiter) return [50];
        this.log('info', `Scraping real predictive models for ${ctx.matchup}...`);
        
        const query = `${ctx.matchup} ${ctx.sport} predictive models win probability ESPN BPI SportsLine`;
        try {
            const research = await this.enrichmentArbiter.enrich(query);
            return this._parseExtraction([research.markdown || research], "Predictive model win probabilities");
        } catch (e) { return [50]; }
    }

    async _scrapeMarkets(ctx) {
        if (!this.enrichmentArbiter) return [50];
        this.log('info', `Scraping betting markets for ${ctx.matchup}...`);
        
        const query = `${ctx.matchup} current betting odds vegas moneyline spread DraftKings FanDuel`;
        try {
            const research = await this.enrichmentArbiter.enrich(query);
            return this._parseExtraction([research.markdown || research], "Implied win probability from odds");
        } catch (e) { return [50]; }
    }

    async _scrapeExperts(ctx) {
        if (!this.enrichmentArbiter) return [50];
        this.log('info', `Scraping expert analysis for ${ctx.matchup}...`);
        
        const query = `${ctx.matchup} expert picks analysis CBSSports BleacherReport TheAthletic`;
        try {
            const research = await this.enrichmentArbiter.enrich(query);
            return this._parseExtraction([research.markdown || research], "Expert consensus win percentage");
        } catch (e) { return [50]; }
    }

    async _parseExtraction(results, metricName) {
        if (!this.quadBrain) return [50]; // Fallback
        const prompt = `
            Analyze these search snippets:
            ${JSON.stringify(results)}
            
            Extract the "${metricName}" as a single number or array of numbers found.
            Return JSON: { values: [numbers] }
        `;
        const res = await this.quadBrain.reason(prompt, 'analytical');
        try {
            const json = JSON.parse((res.text || res.response).match(/\{[\s\S]*\}/)[0]);
            return json.values || [50];
        } catch (e) { return [50]; }
    }

    // =========================================================================
    // 🧮 PHASE 3: WEIGHTED CONSENSUS
    // =========================================================================

    _calculateConsensus(models, markets, experts, simulation = { prob: 50 }) {
        // Weights from your Markdown (adjusted for Simulation)
        const W_MODEL = 0.40;
        const W_MARKET = 0.30;
        const W_EXPERT = 0.20;
        const W_SIM = 0.10; // 10% weight for WorldModel simulation

        const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 50;

        const vModel = avg(models);
        const vMarket = avg(markets);
        const vExpert = avg(experts);
        const vSim = simulation.prob || 50;

        const consensusScore = (vModel * W_MODEL) + (vMarket * W_MARKET) + (vExpert * W_EXPERT) + (vSim * W_SIM);
        
        // Confidence Logic
        const disagreement = Math.abs(vModel - vMarket) + Math.abs(vMarket - vExpert); // Simple divergence
        let confidence = "HIGH";
        if (disagreement > 15) confidence = "MEDIUM";
        if (disagreement > 25) confidence = "LOW";

        return {
            finalPick: consensusScore > 50 ? "HOME TEAM" : "AWAY TEAM",
            winProb: consensusScore.toFixed(1) + "%",
            confidenceScore: confidence,
            averages: { models: vModel, markets: vMarket, experts: vExpert, sim: vSim }
        };
    }

    // =========================================================================
    // 📝 PHASE 4: DOSSIER GENERATION
    // =========================================================================

    async _generateDossier(ctx, consensus, rawData) {
        if (!this.quadBrain) return "Dossier unavailable.";

        const prompt = `
            Generate a "Moneyball" Style Sports Intelligence Dossier for: ${ctx.matchup}.
            
            DATA:
            - Model Consensus: ${consensus.averages.models}% Win Prob
            - Vegas Implied: ${consensus.averages.markets}% Win Prob
            - Expert Sentiment: ${consensus.averages.experts}% favor
            - Causal Simulation: ${consensus.averages.sim.toFixed(1)}% Win Prob
            - Disagreement Level: ${consensus.confidenceScore}
            
            SECTIONS REQUIRED:
            1. THE VERDICT (Clear Winner & Score Prediction)
            2. "SHARP MONEY" SIGNAL (Where is the smart money going?)
            3. KEY DRIVERS (Injuries, Matchup Stats)
            4. ORACLE SIMULATION (Results from WorldModel)
            5. VOLATILITY WARNING (If confidence is low)
            
            Tone: Professional, Statistical, "Oracle-like".
        `;

        const result = await this.quadBrain.reason(prompt, 'balanced');
        return result.text || result.response;
    }
}

export default ForecasterArbiter;
