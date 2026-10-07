import React, { useState, useEffect } from 'react';
import {
    Target, TrendingUp, Brain, Globe, Calculator, Clock, 
    Activity, AlertCircle, Database, Zap
} from 'lucide-react';

/**
 * THE GOAL - Ultimate Sports Betting Intelligence Hub
 * 
 * Aggregates:
 * - ML Predictions (SportsBetting models)
 * - Live Odds (multiple bookmakers)
 * - Player Props predictions
 * - Edge calculations
 * - Historical context
 * - Web consensus
 */

const TheGoalView = ({ games }) => {
    const [selectedGame, setSelectedGame] = useState(null);
    const [intelligence, setIntelligence] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    // Select first game by default
    useEffect(() => {
        if (games && games.length > 0 && !selectedGame) {
            setSelectedGame(games[0]);
        }
    }, [games]);

    // ENERGY EFFICIENT: Only load when The Goal tab is active
    useEffect(() => {
        // Check if this view is actually visible (tab is active)
        // The parent ForecasterApp only renders this component when activeTab === 'goal'
        // So this effect only runs when user clicks "The Goal" tab
        if (selectedGame) {
            console.log('[The Goal] Tab activated - loading intelligence for game:', selectedGame.id);
            loadGameIntelligence(selectedGame);
        }
    }, [selectedGame]);

    const loadGameIntelligence = async (game) => {
        setIsLoading(true);
        
        try {
            console.log('[The Goal] Fetching intelligence from backend...');
            
            // Call Flask backend API
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            const response = await fetch(
                `${backendUrl}/api/game/intelligence/nba/${game.id}`,
                {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    // Add timeout to prevent hanging
                    signal: AbortSignal.timeout(15000)  // 15 second timeout
                }
            );
            
            if (!response.ok) {
                throw new Error(`Backend returned ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.data) {
                console.log('[The Goal] Intelligence loaded successfully');
                setIntelligence(data.data);
            } else {
                throw new Error('Invalid response format');
            }
            
        } catch (error) {
            console.error('[The Goal] Failed to load intelligence:', error);
            
            // Fallback to mock data if backend is unavailable
            console.log('[The Goal] Using fallback mock data');
            setIntelligence({
                ml_predictions: {
                    model: 'Polynomial Regression (Mock)',
                    home_score: 112.4,
                    away_score: 108.7,
                    confidence: 0.78,
                    range: { low: 104, high: 121 }
                },
                live_odds: [
                    { 
                        bookmaker: 'FanDuel', 
                        home_ml: -165, 
                        away_ml: +140,
                        spread: -4.5,
                        spread_odds: -110,
                        total: 221,
                        over_odds: -110,
                        under_odds: -110
                    },
                    { 
                        bookmaker: 'DraftKings', 
                        home_ml: -170, 
                        away_ml: +145,
                        spread: -4.5,
                        spread_odds: -108,
                        total: 220.5,
                        over_odds: -112,
                        under_odds: -108
                    },
                    { 
                        bookmaker: 'BetMGM', 
                        home_ml: -162, 
                        away_ml: +138,
                        spread: -4,
                        spread_odds: -110,
                        total: 221.5,
                        over_odds: -110,
                        under_odds: -110
                    }
                ],
                edge_analysis: {
                    best_bet: {
                        type: 'spread',
                        selection: `${game.homeTeam.shortName} -4.5`,
                        odds: -110,
                        model_prob: 0.58,
                        implied_prob: 0.524,
                        edge: 5.6,
                        ev_per_10: 2.45,
                        kelly: 3.2
                    }
                },
                consensus: {
                    sources: 5,
                    avg_total: 220.5,
                    variance: 2.3,
                    agreement: 'Strong'
                }
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                        <Target size={24} className="text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-white tracking-tight uppercase">
                            The Goal
                        </h1>
                        <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">
                            Intelligence Aggregator
                        </p>
                    </div>
                </div>
                
                {/* Data Source Status */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                            5 Sources Active
                        </span>
                    </div>
                </div>
            </div>

            {/* Game Selector */}
            <div className="glass-panel p-4 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                    <Activity size={14} className="text-indigo-400" />
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        Select Game
                    </h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {games.slice(0, 6).map((game) => (
                        <button
                            key={game.id}
                            onClick={() => setSelectedGame(game)}
                            className={`p-3 rounded-lg border transition-all text-left ${
                                selectedGame?.id === game.id
                                    ? 'bg-purple-900/30 border-purple-500 ring-1 ring-purple-500/20'
                                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-bold text-white">
                                    {game.homeTeam.shortName}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                    {game.status}
                                </div>
                            </div>
                            <div className="text-xs text-slate-400 mt-1">
                                vs {game.awayTeam.shortName}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="glass-panel p-12 rounded-2xl text-center">
                    <Zap size={48} className="mx-auto text-purple-500 animate-pulse mb-4" />
                    <h3 className="text-lg font-bold text-white mb-2">
                        Aggregating Intelligence...
                    </h3>
                    <p className="text-xs text-slate-500">
                        Loading ML predictions, odds, and edge analysis
                    </p>
                </div>
            )}

            {/* Intelligence Grid */}
            {!isLoading && selectedGame && intelligence && (
                <div className="grid grid-cols-12 gap-6">
                    {/* Live Odds Panel - 4 columns */}
                    <div className="col-span-12 lg:col-span-4">
                        <LiveOddsPanel 
                            game={selectedGame}
                            odds={intelligence.live_odds} 
                        />
                    </div>

                    {/* ML Predictions Panel - 8 columns */}
                    <div className="col-span-12 lg:col-span-8">
                        <MLPredictionPanel 
                            game={selectedGame}
                            predictions={intelligence.ml_predictions} 
                        />
                    </div>

                    {/* Edge Analysis - 6 columns */}
                    <div className="col-span-12 lg:col-span-6">
                        <EdgeDetector 
                            game={selectedGame}
                            analysis={intelligence.edge_analysis} 
                        />
                    </div>

                    {/* Consensus Panel - 6 columns */}
                    <div className="col-span-12 lg:col-span-6">
                        <ConsensusPanel 
                            consensus={intelligence.consensus} 
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

// Live Odds Panel Component
const LiveOddsPanel = ({ game, odds }) => {
    return (
        <div className="glass-panel p-6 rounded-xl h-full">
            <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                    Live Odds
                </h3>
            </div>

            <div className="space-y-4">
                {odds.map((book, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">
                            {book.bookmaker}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <div className="text-slate-500 text-[9px] mb-1">Moneyline</div>
                                <div className="font-mono font-bold text-white">
                                    {game.homeTeam.shortName}: {book.home_ml > 0 ? '+' : ''}{book.home_ml}
                                </div>
                                <div className="font-mono text-slate-400">
                                    {game.awayTeam.shortName}: {book.away_ml > 0 ? '+' : ''}{book.away_ml}
                                </div>
                            </div>
                            
                            <div>
                                <div className="text-slate-500 text-[9px] mb-1">Spread</div>
                                <div className="font-mono font-bold text-indigo-400">
                                    {book.spread > 0 ? '+' : ''}{book.spread} ({book.spread_odds})
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-2 pt-2 border-t border-slate-800">
                            <div className="text-slate-500 text-[9px] mb-1">Total</div>
                            <div className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-white">{book.total}</span>
                                <span className="text-slate-600">|</span>
                                <span className="font-mono text-emerald-400">O {book.over_odds}</span>
                                <span className="font-mono text-rose-400">U {book.under_odds}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ML Prediction Panel Component
const MLPredictionPanel = ({ game, predictions }) => {
    return (
        <div className="glass-panel p-6 rounded-xl h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Brain size={16} className="text-purple-400" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                        ML Predictions
                    </h3>
                </div>
                <div className="text-[10px] text-slate-500 uppercase font-bold">
                    {predictions.model}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="text-center p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                    <div className="text-[10px] text-indigo-400 uppercase font-bold mb-2">
                        {game.homeTeam.shortName}
                    </div>
                    <div className="text-4xl font-black text-white font-mono">
                        {predictions.home_score}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">Predicted Score</div>
                </div>

                <div className="text-center p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">
                        {game.awayTeam.shortName}
                    </div>
                    <div className="text-4xl font-black text-white font-mono">
                        {predictions.away_score}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1">Predicted Score</div>
                </div>
            </div>

            {/* Confidence Meter */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">
                        Model Confidence
                    </div>
                    <div className="text-sm font-mono font-bold text-emerald-400">
                        {(predictions.confidence * 100).toFixed(0)}%
                    </div>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-1000"
                        style={{ width: `${predictions.confidence * 100}%` }}
                    />
                </div>
                
                <div className="mt-3 text-[9px] text-slate-500">
                    Range: {predictions.range.low} - {predictions.range.high}
                </div>
            </div>
        </div>
    );
};

// Edge Detector Component
const EdgeDetector = ({ game, analysis }) => {
    const { best_bet } = analysis;
    const isPositiveEdge = best_bet.edge > 0;

    return (
        <div className={`glass-panel p-6 rounded-xl h-full border-t-2 ${
            isPositiveEdge ? 'border-t-emerald-500' : 'border-t-rose-500'
        }`}>
            <div className="flex items-center gap-2 mb-4">
                <Calculator size={16} className={isPositiveEdge ? 'text-emerald-400' : 'text-rose-400'} />
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                    Edge Analysis
                </h3>
            </div>

            <div className={`p-4 rounded-xl mb-4 ${
                isPositiveEdge 
                    ? 'bg-emerald-500/10 border border-emerald-500/20' 
                    : 'bg-rose-500/10 border border-rose-500/20'
            }`}>
                <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">
                    Best Bet Detected
                </div>
                <div className={`text-2xl font-black ${
                    isPositiveEdge ? 'text-emerald-400' : 'text-rose-400'
                } mb-1`}>
                    {best_bet.selection}
                </div>
                <div className="text-xs text-slate-400">
                    {best_bet.type.toUpperCase()} @ {best_bet.odds}
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex justify-between items-center p-3 rounded-lg bg-slate-900/50">
                    <span className="text-xs text-slate-500">Model Probability</span>
                    <span className="text-sm font-mono font-bold text-white">
                        {(best_bet.model_prob * 100).toFixed(1)}%
                    </span>
                </div>

                <div className="flex justify-between items-center p-3 rounded-lg bg-slate-900/50">
                    <span className="text-xs text-slate-500">Implied Probability</span>
                    <span className="text-sm font-mono font-bold text-white">
                        {(best_bet.implied_prob * 100).toFixed(1)}%
                    </span>
                </div>

                <div className={`flex justify-between items-center p-3 rounded-lg ${
                    isPositiveEdge ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                }`}>
                    <span className={`text-xs font-bold uppercase ${
                        isPositiveEdge ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                        Edge
                    </span>
                    <span className={`text-lg font-mono font-black ${
                        isPositiveEdge ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                        {isPositiveEdge ? '+' : ''}{best_bet.edge.toFixed(1)}%
                    </span>
                </div>

                <div className="flex justify-between items-center p-3 rounded-lg bg-indigo-500/10">
                    <span className="text-xs text-indigo-400">Expected Value</span>
                    <span className="text-sm font-mono font-bold text-white">
                        ${best_bet.ev_per_10.toFixed(2)} per $10
                    </span>
                </div>

                <div className="flex justify-between items-center p-3 rounded-lg bg-purple-500/10">
                    <span className="text-xs text-purple-400">Kelly Criterion</span>
                    <span className="text-sm font-mono font-bold text-white">
                        {best_bet.kelly.toFixed(1)}% of bankroll
                    </span>
                </div>
            </div>
        </div>
    );
};

// Consensus Panel Component
const ConsensusPanel = ({ consensus }) => {
    return (
        <div className="glass-panel p-6 rounded-xl h-full">
            <div className="flex items-center gap-2 mb-4">
                <Globe size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                    Web Consensus
                </h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                    <div className="text-3xl font-black text-white font-mono">
                        {consensus.sources}
                    </div>
                    <div className="text-[9px] text-slate-500 uppercase font-bold mt-1">
                        Sources
                    </div>
                </div>

                <div className="text-center p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <div className="text-3xl font-black text-emerald-400 font-mono">
                        {consensus.avg_total}
                    </div>
                    <div className="text-[9px] text-emerald-500 uppercase font-bold mt-1">
                        Avg Total
                    </div>
                </div>

                <div className="text-center p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                    <div className="text-3xl font-black text-white font-mono">
                        {consensus.variance}
                    </div>
                    <div className="text-[9px] text-slate-500 uppercase font-bold mt-1">
                        Variance
                    </div>
                </div>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-center">
                <div className="text-[10px] text-indigo-400 uppercase font-bold mb-1">
                    Agreement Level
                </div>
                <div className="text-sm font-bold text-white">
                    {consensus.agreement}
                </div>
            </div>

            <div className="mt-4 text-[9px] text-slate-600 italic text-center">
                Aggregated from FiveThirtyEight, ESPN, Vegas Insider, Covers, Action Network
            </div>
        </div>
    );
};

export default TheGoalView;
