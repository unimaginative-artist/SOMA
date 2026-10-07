import React, { useState, useEffect } from 'react';
import { queryForecaster, queryForecasterWithConsensus } from './services/forecasterService.js';
import { getCachedConsensus } from './services/consensusAggregator.js';
import {
    Activity, TrendingUp, BarChart3, ShieldAlert, Radar, BrainCircuit, Globe, Database, Calendar, Eye,
    Sliders, TrendingDown, Timer, ChevronRight, ArrowRightLeft, Users, Layers, Target, RefreshCw, Flame,
    Swords, Search, HelpCircle, AlertTriangle, FileText, CheckCircle2
} from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { GameStatus } from './types.js';
import { INITIAL_GAMES } from './services/mockData.js';
import { analyzeGameWithGemini } from './services/geminiService.js';
import { runOracleSimulation } from './services/oracleService.js';
import { fetchLiveGames } from './services/liveGameService.js';
import ProbabilityChart from './components/ProbabilityChart.jsx';
import EdgeMeter from './components/EdgeMeter.jsx';
import TheGoalView from './views/TheGoalView.jsx';

// ... (Existing Imports) ...
// Note: We need to rename existing imports if we are overwriting the whole file or careful replacement.
// Since this is a partial replace, I'll be careful. 
// Wait, I need to inject the new components BEFORE 'ForecasterApp'.

// --- NEW COMPONENT: ForecastResultView ---

// --- NEW COMPONENT: ParlaySidebar ---
const ParlaySidebar = ({ legs, onRemove, onClear }) => {
    const [isSimulating, setIsSimulating] = useState(false);
    const [analysis, setAnalysis] = useState(null);

    // Reset analysis when legs change
    useEffect(() => {
        setAnalysis(null);
    }, [legs]);

    if (legs.length === 0) return null;

    const totalOdds = legs.reduce((acc, leg) => acc * (leg.odds || 1.91), 1);
    const impliedProb = (1 / totalOdds) * 100;
    const potentialPayout = (100 * totalOdds).toFixed(2);

    const runSimulation = async () => {
        setIsSimulating(true);
        
        try {
            // Hit the Python Prophet Engine
            // Note: In dev this hits localhost:5000 via proxy or direct
            // Assuming Vite proxy is set or we use direct URL for now if proxy missing
            const res = await fetch('http://127.0.0.1:5000/api/simulate/parlay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    legs: legs.map(l => ({
                        entity: l.entity,
                        stat: l.stat,
                        odds: l.odds || 1.91
                    })),
                    iterations: 10000
                })
            });

            if (res.ok) {
                const data = await res.json();
                setAnalysis({
                    trueProb: data.trueProb,
                    edge: data.edge,
                    ev: 'N/A', // EV depends on stake, simplified here
                    correlation: data.correlation,
                    rating: data.rating
                });
            } else {
                console.error("Simulation failed");
            }
        } catch (e) {
            console.error("Simulation error", e);
        } finally {
            setIsSimulating(false);
        }
    };

    return (
        <div className="fixed right-6 bottom-6 w-80 bg-[#0E0E11] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-right duration-300 flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-white/5 bg-indigo-600/10 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white">Active Parlay</span>
                </div>
                <span className="text-[10px] font-mono text-indigo-300">{legs.length} LEGS</span>
            </div>
            
            <div className="overflow-y-auto p-2 space-y-2 flex-1 custom-scrollbar">
                {legs.map((leg, idx) => (
                    <div key={idx} className="p-3 bg-white/5 rounded-lg border border-white/5 relative group">
                        <button 
                            onClick={() => onRemove(idx)}
                            className="absolute top-2 right-2 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <TrendingDown size={12} />
                        </button>
                        <div className="text-xs font-bold text-white mb-1">{leg.entity}</div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-400 uppercase">{leg.stat}</span>
                            <span className="text-sm font-mono font-bold text-emerald-400">{leg.value}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Analysis Section */}
            {analysis && (
                <div className="p-4 bg-emerald-900/10 border-y border-emerald-500/20 animate-in fade-in shrink-0">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">SOMA Simulation</span>
                        <span className="text-xs font-black text-white px-2 py-0.5 bg-emerald-500 rounded text-black">{analysis.rating} RATING</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center mb-2">
                        <div className="bg-slate-900/50 rounded p-1">
                            <div className="text-[9px] text-slate-500 uppercase">Implied Prob</div>
                            <div className="font-mono text-slate-300 text-xs">{impliedProb.toFixed(1)}%</div>
                        </div>
                        <div className="bg-emerald-900/30 rounded p-1 border border-emerald-500/30">
                            <div className="text-[9px] text-emerald-400 uppercase">True Prob</div>
                            <div className="font-mono text-white text-xs font-bold">{analysis.trueProb}%</div>
                        </div>
                    </div>
                    <div className="text-[9px] text-center text-emerald-300/80 italic">
                        {analysis.correlation}
                    </div>
                </div>
            )}

            <div className="p-4 border-t border-white/10 bg-slate-900/50 shrink-0">
                <div className="flex justify-between items-end mb-4">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Combined Odds</span>
                    <span className="text-xl font-mono font-bold text-white">+{((totalOdds - 1) * 100).toFixed(0)}</span>
                </div>
                
                {!analysis ? (
                    <button 
                        onClick={runSimulation}
                        disabled={isSimulating}
                        className="w-full mb-3 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                    >
                        {isSimulating ? <RefreshCw size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
                        {isSimulating ? 'Running Monte Carlo...' : 'Analyze Correlation'}
                    </button>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onClear} className="px-3 py-3 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors">
                            Clear
                        </button>
                        <button className="px-3 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[10px] font-bold text-black uppercase tracking-wider transition-colors shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2">
                            Place Bet <Target size={12} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const ForecastResultView = ({ result, onBack, onAddToParlay }) => {
    if (!result) return null;

    // Safety checks for data structure
    const prediction = result.prediction || {};
    const interpretation = result.interpretation || {};
    const reasoning = result.reasoning || { keyDrivers: [], signals: [] };
    const comparables = result.comparables || [];
    
    // Provide defaults
    const isHighConfidence = prediction.confidence === 'HIGH';
    const isHighVol = prediction.volatility === 'HIGH';

    // Calculate position of EV relative to range for visualization
    const rangeSpan = (prediction.ceiling || 100) - (prediction.floor || 0);
    const evPercent = ((prediction.expectedValue || 50) - (prediction.floor || 0)) / rangeSpan * 100;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
            {/* Header / Nav */}
            <div className="flex items-center justify-between">
                <button onClick={onBack} className="text-slate-500 hover:text-white text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                    <ArrowRightLeft size={14} /> New Query
                </button>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => onAddToParlay({
                            entity: interpretation.entity,
                            stat: interpretation.stat,
                            value: prediction.expectedValue,
                            odds: 1.91 // Default/Mock odds
                        })}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all hover:scale-105"
                    >
                        <Layers size={14} /> Add to Parlay
                    </button>
                    
                    {/* Enhancement Status */}
                    {result.enhancing && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded bg-amber-500/10 border border-amber-500/30 animate-pulse">
                            <Globe size={12} className="text-amber-400 animate-spin" />
                            <span className="text-[9px] text-amber-400 font-bold uppercase">Scraping Web Sources...</span>
                        </div>
                    )}
                    {result.isBase === false && !result.enhancing && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30">
                            <Globe size={12} className="text-emerald-400" />
                            <span className="text-[9px] text-emerald-400 font-bold uppercase">Web Consensus Applied</span>
                        </div>
                    )}
                    {/* Confidence */}
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isHighConfidence ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
                        <span className="text-[10px] font-mono text-slate-400">
                            CONFIDENCE: <span className="text-white font-bold">{prediction.confidence}</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* Main Result Card */}
            <div className="glass-panel p-8 rounded-2xl border-t border-t-white/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none"></div>

                {/* Interpretation */}
                <div className="mb-8 relative z-10">
                    <div className="flex items-center gap-2 text-indigo-400 mb-2">
                        <BrainCircuit size={18} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Query Analysis</span>
                    </div>
                    <h2 className="text-3xl font-black text-white tracking-tight">
                        {interpretation.entity || 'Unknown'} <span className="text-slate-500">|</span> {interpretation.stat || 'Prediction'}
                    </h2>
                    <p className="text-slate-400 text-sm font-mono mt-1">{interpretation.context || 'Analysis'}</p>
                </div>

                {/* VISUALIZATION: The Probability Range */}
                <div className="relative py-12 px-4 mb-8 bg-slate-900/40 rounded-xl border border-white/5">
                    {/* Range Bar */}
                    <div className="h-2 bg-slate-800 rounded-full relative w-full">
                        {/* Confidence Interval (The 'Meat') */}
                        <div
                            className="absolute top-0 h-full bg-indigo-500/30 border-x border-indigo-500/50"
                            style={{
                                left: `${(((prediction.range?.low || 0) - (prediction.floor || 0)) / rangeSpan) * 100}%`,
                                width: `${(((prediction.range?.high || 100) - (prediction.range?.low || 0)) / rangeSpan) * 100}%`
                            }}
                        />
                        {/* EV Marker */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_15px_white] z-20 cursor-help group"
                            style={{ left: `${evPercent}%` }}
                        >
                            <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-white text-black text-xs font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                Expected: {prediction.expectedValue || 'N/A'}
                            </div>
                        </div>
                    </div>

                    {/* Labels */}
                    <div className="flex justify-between mt-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                        <div className="text-left">
                            <span className="block text-rose-400 font-bold">Floor</span>
                            {prediction.floor || 0}
                        </div>
                        <div className="text-center">
                            <span className="block text-indigo-400 font-bold">Likely Range</span>
                            {prediction.range?.low || 0} - {prediction.range?.high || 100}
                        </div>
                        <div className="text-right">
                            <span className="block text-emerald-400 font-bold">Ceiling</span>
                            {prediction.ceiling || 100}
                        </div>
                    </div>
                </div>

                {/* Primary Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Expected Value</div>
                        <div className="text-3xl font-black text-white">{prediction.expectedValue || 'N/A'}</div>
                        <div className="text-[10px] text-slate-500 mt-1">Weighted Mean</div>
                    </div>
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Uncertainty</div>
                        <div className={`text-xl font-bold font-mono ${isHighVol ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {prediction.volatility || 'MEDIUM'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">Variance Profile</div>
                    </div>
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Confidence Score</div>
                        <div className="text-xl font-bold font-mono text-indigo-400">
                            {((prediction.confidenceScore || 0.5) * 100).toFixed(0)}/100
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">Calibration</div>
                    </div>
                </div>
            </div>

            {/* Scraping Status Banner */}
            {result.enhancing && (
                <div className="glass-panel p-6 rounded-xl border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-center justify-center gap-3">
                        <Globe size={20} className="text-amber-400 animate-spin" />
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-amber-400 uppercase tracking-widest animate-pulse">
                                &gt;&gt;&gt; Scraping the web for the forecast &lt;&lt;&lt;
                            </h3>
                            <p className="text-xs text-slate-500 mt-2">
                                Aggregating predictions from FiveThirtyEight, Vegas Insider, ESPN, and more...
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Base vs Enhanced Comparison */}
            {result.baseComparison && (
                <div className="glass-panel p-6 rounded-xl border-emerald-500/20 bg-emerald-500/5">
                    <div className="flex items-center gap-2 text-emerald-400 mb-4">
                        <CheckCircle2 size={16} />
                        <h3 className="text-sm font-bold uppercase tracking-widest">Web Consensus Applied</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-6">
                        <div className="text-center p-4 rounded-lg bg-slate-900/50 border border-slate-800">
                            <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">Base Model</div>
                            <div className="text-2xl font-bold text-indigo-400 font-mono">{result.baseComparison.basePrediction}</div>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-emerald-900/20 border border-emerald-500/30 ring-1 ring-emerald-500/10">
                            <div className="text-[10px] text-emerald-400 uppercase font-bold mb-2">+ Web Consensus</div>
                            <div className="text-2xl font-bold text-white font-mono">{result.baseComparison.enhancedPrediction}</div>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-slate-900/50 border border-slate-800">
                            <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">Adjustment</div>
                            <div className={`text-lg font-bold font-mono ${
                                Math.abs(parseFloat(result.baseComparison.percentChange)) < 5 
                                    ? 'text-slate-400' 
                                    : parseFloat(result.baseComparison.percentChange) > 0 
                                        ? 'text-emerald-400' 
                                        : 'text-rose-400'
                            }`}>
                                {result.baseComparison.percentChange > 0 ? '+' : ''}{result.baseComparison.percentChange}%
                            </div>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-4 text-center italic">
                        Blended {result.consensus?.sources || 0} web sources with internal model
                    </p>
                </div>
            )}
            
            {/* Explanation & Drivers */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-7 space-y-6">
                    <div className="glass-panel p-6 rounded-xl">
                        <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                            <FileText size={16} className="text-indigo-500" /> Reasoning
                        </h3>
                        <p className="text-slate-300 text-sm leading-relaxed mb-6">
                            {reasoning.summary || 'Analysis pending...'}
                        </p>

                        <div className="space-y-3">
                            {(reasoning.keyDrivers || []).map((driver, idx) => (
                                <div key={idx} className="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-800">
                                    <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${driver.impact === 'POSITIVE' ? 'bg-emerald-500' : driver.impact === 'NEGATIVE' ? 'bg-rose-500' : 'bg-slate-500'}`} />
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-bold text-white">{driver.name}</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${driver.impact === 'POSITIVE' ? 'bg-emerald-500/10 text-emerald-400' : driver.impact === 'NEGATIVE' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-700 text-slate-400'}`}>
                                                {driver.impact}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500">{driver.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-5 space-y-6">
                    {/* Comparables */}
                    <div className="glass-panel p-6 rounded-xl">
                        <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Layers size={16} className="text-purple-500" /> Historic Analogs
                        </h3>
                        <div className="space-y-3">
                            {(comparables || []).map((comp, idx) => (
                                <div key={idx} className="flex justify-between items-center p-3 border-b border-white/5 last:border-0">
                                    <div>
                                        <div className="text-xs font-bold text-slate-200">{comp.player}</div>
                                        <div className="text-[10px] text-slate-500">{comp.game}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-mono font-bold text-white">{comp.result}</div>
                                        <div className="text-[9px] text-indigo-400">ACTUAL</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Signals */}
                    <div className="glass-panel p-6 rounded-xl">
                        <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Activity size={16} className="text-rose-500" /> Signals
                        </h3>
                        <div className="space-y-2">
                            {(reasoning.signals || []).map((signal, idx) => (
                                <div key={idx} className="text-xs text-slate-400 flex gap-2">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    {signal.text}
                                </div>
                            ))}
                            {(reasoning.signals || []).length === 0 && <div className="text-xs text-slate-600 italic">No strong signals detected.</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};




// --- Sub-Components ---

const WinProbabilityGauge = ({ homeProb, homeTeam, awayTeam }) => (
    <div className="relative h-4 bg-slate-800 rounded-full overflow-hidden flex cursor-help group">
        <div
            className="h-full bg-emerald-500 transition-all duration-1000 ease-out"
            style={{ width: `${homeProb * 100}%` }}
        />
        <div
            className="h-full bg-rose-500 transition-all duration-1000 ease-out"
            style={{ width: `${(1 - homeProb) * 100}%` }}
        />

        {/* Center Marker */}
        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white/20 z-10" />

        {/* Hover Tooltip */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-700 px-3 py-1 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
            {homeTeam}: {(homeProb * 100).toFixed(1)}% | {awayTeam}: {((1 - homeProb) * 100).toFixed(1)}%
        </div>
    </div>
);

const MetricCard = ({ label, value, trend, trendUp, icon: Icon }) => (
    <div className="glass-panel p-4 rounded-xl flex items-start justify-between border-l-4 border-l-indigo-500">
        <div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{label}</p>
            <h3 className="text-2xl font-black text-white mt-1 tracking-tight">{value}</h3>
            <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trendUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                {trendUp ? <TrendingUp size={12} /> : <Activity size={12} />}
                <span>{trend}</span>
            </div>
        </div>
        <div className="p-2 bg-slate-900 rounded-lg text-slate-500">
            <Icon size={20} />
        </div>
    </div>
);

const OddsBadge = ({ label, val, highlight = false, trend = 0 }) => (
    <div className={`flex flex-col items-center px-4 py-2 rounded-sm border transition-all duration-500 ${highlight ? 'bg-indigo-900/20 border-indigo-500/50 text-indigo-200' : 'bg-slate-900/50 border-slate-800 text-slate-400'} ${trend !== 0 ? 'ring-1 ring-offset-2 ring-offset-black ' + (trend > 0 ? 'ring-rose-500/50' : 'ring-emerald-500/50') : ''}`}>
        <span className="text-[10px] uppercase font-bold tracking-widest mb-1 opacity-70">{label}</span>
        <div className="flex items-center gap-1">
            <span className="font-mono text-sm font-bold">{val > 0 ? `+${val}` : val}</span>
            {trend !== 0 && (
                trend > 0 ? <TrendingUp size={10} className="text-rose-500" /> : <TrendingDown size={10} className="text-emerald-500" />
            )}
        </div>
    </div>
);

const DistributionVisualizer = ({ data, marketLine }) => (
    <div className="h-40 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
                <XAxis hide dataKey="value" />
                <YAxis hide />
                <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                    itemStyle={{ color: '#a855f7' }}
                    labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                    formatter={(value) => [value, 'Frequency']}
                    labelFormatter={(label) => `Outcome: ${label} pts`}
                />
                <Bar dataKey="count">
                    {data.map((entry, index) => (
                        <Cell
                            key={`cell-${index}`}
                            fill={entry.value > marketLine ? '#10b981' : '#a855f7'}
                            fillOpacity={0.6}
                        />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
        <div className="flex justify-between text-[8px] font-mono text-slate-600 uppercase tracking-widest mt-1">
            <span>Downside Probability</span>
            <span>Market Line: {marketLine}</span>
            <span>Ceiling Potential</span>
        </div>
    </div>
);

// --- View Components ---

const ScannerView = ({ games, onSelectGame, onOracleScan }) => (
    <div className="space-y-6 animate-in fade-in zoom-in duration-300">
        <div className="flex justify-between items-end">
            <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Global Drift Monitor</h2>
                <p className="text-slate-400 text-xs mt-1">Detecting divergence across {games.length * 4} active belief markets.</p>
            </div>
            <button className="px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 rounded text-[10px] font-bold uppercase tracking-wider text-indigo-400 border border-indigo-500/30 flex items-center gap-2">
                <Radar size={14} /> Scan: High Dislocation
            </button>
        </div>

        <div className="glass-panel rounded-xl overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-900/80 text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                    <tr>
                        <th className="px-6 py-4">Event Stream</th>
                        <th className="px-6 py-4">Consensus</th>
                        <th className="px-6 py-4">Forecaster</th>
                        <th className="px-6 py-4 text-right">Reality Drift</th>
                        <th className="px-6 py-4 text-right">Oracle</th>
                        <th className="px-6 py-4"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50 text-sm">
                    {games.map(game => (
                        <tr key={game.id} className="hover:bg-slate-800/20 transition-colors group">
                            <td className="px-6 py-4 cursor-pointer" onClick={() => onSelectGame(game)}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-0.5 h-8 rounded-full ${game.status === GameStatus.LIVE ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-700'}`}></div>
                                    <div>
                                        <div className="font-bold text-slate-200 text-xs">{game.homeTeam.shortName} <span className="text-slate-600">vs</span> {game.awayTeam.shortName}</div>
                                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{game.sport} • {game.status}</div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4 font-mono text-xs text-slate-400">
                                {game.marketOdds.homeMoneyline > 0 ? '+' : ''}{game.marketOdds.homeMoneyline}
                            </td>
                            <td className="px-6 py-4 font-mono text-xs text-indigo-400">
                                {game.forecasterProjection ? game.forecasterProjection.toFixed(3) : '--'}
                            </td>
                            <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    <span className="text-emerald-400 font-bold font-mono text-xs">{game.realityDrift ? game.realityDrift.toFixed(1) : '0.0'}%</span>
                                    <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500" style={{ width: `${game.realityDrift || 0}%` }}></div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onOracleScan(game); }}
                                    className="p-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all group/eye"
                                    title="Consult The Oracle (Deep Research)"
                                >
                                    <Eye size={16} className="group-hover/eye:scale-110 transition-transform" />
                                </button>
                            </td>
                            <td className="px-6 py-4 text-right">
                                <button className="text-slate-600 hover:text-white group-hover:translate-x-1 transition-all" onClick={() => onSelectGame(game)}>
                                    <ArrowRightLeft size={16} />
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const OracleView = ({ games, dossier, isLoading }) => {
    const [config, setConfig] = useState({
        fatigueLevel: 1.0,
        blowoutRisk: 0.1,
        injuryRisk: 0.05,
        weatherImpact: 1.0,
        paceModifier: 1.0,
        defenseIntensity: 1.0,
        platform: 'SLEEPER'
    });
    const [objective, setObjective] = useState('BEST_SLEEPER');
    const [isScrying, setIsScrying] = useState(false);
    const [results, setResults] = useState(null);
    const [focusedPlayer, setFocusedPlayer] = useState(null);

    // --- MODE 1: MONEYBALL DOSSIER (Deep Research) ---
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] animate-in fade-in duration-1000 relative overflow-hidden">
                <div className="absolute inset-0 bg-purple-900/10 blur-3xl animate-pulse"></div>
                <Eye size={64} className="text-purple-400 animate-bounce mb-8 relative z-10" />
                <h2 className="text-3xl font-black text-white tracking-widest relative z-10 uppercase mb-2">Consulting The Oracle</h2>
                <div className="flex flex-col items-center gap-2 text-xs font-mono text-purple-300/60 mt-4 relative z-10">
                    <span className="animate-pulse">Aggregating 100+ Web Models...</span>
                    <span className="animate-pulse delay-300">Calculating Consensus Weighting...</span>
                    <span className="animate-pulse delay-700">Synthesizing Dossier...</span>
                </div>
            </div>
        );
    }

    if (dossier) {
        return (
            <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Moneyball Dossier</h1>
                    <div className="flex gap-4">
                        <div className="bg-purple-900/20 border border-purple-500/30 px-4 py-2 rounded-lg flex items-center gap-3">
                            <span className="text-[10px] text-purple-400 font-bold uppercase tracking-widest">Confidence</span>
                            <span className={`font-mono font-bold ${dossier.confidence === 'HIGH' ? 'text-emerald-400' : 'text-amber-400'}`}>{dossier.confidence}</span>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg flex items-center gap-3">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sources Scanned</span>
                            <span className="font-mono font-bold text-white">{dossier.sources_count || '12'}</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-12 gap-8">
                    {/* LEFT: The Numbers */}
                    <div className="col-span-4 space-y-6">
                        <div className="glass-panel p-6 rounded-2xl border-t-4 border-t-purple-500">
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-2">Oracle Prediction</div>
                            <div className="text-4xl font-black text-white leading-none mb-2">{dossier.prediction}</div>
                            <div className="text-sm font-mono text-emerald-400">Win Prob: {dossier.win_probability}</div>
                        </div>

                        <div className="space-y-2">
                            <div className="glass-panel p-4 rounded-xl flex justify-between items-center">
                                <span className="text-xs text-slate-400 font-bold uppercase">Models</span>
                                <span className="font-mono text-white font-bold">{dossier.breakdown?.models_avg?.toFixed(1)}%</span>
                            </div>
                            <div className="glass-panel p-4 rounded-xl flex justify-between items-center border border-purple-500/30 bg-purple-500/5">
                                <span className="text-xs text-purple-300 font-bold uppercase">Markets (Vegas)</span>
                                <span className="font-mono text-purple-200 font-bold">{dossier.breakdown?.markets_implied?.toFixed(1)}%</span>
                            </div>
                            <div className="glass-panel p-4 rounded-xl flex justify-between items-center">
                                <span className="text-xs text-slate-400 font-bold uppercase">Experts</span>
                                <span className="font-mono text-white font-bold">{dossier.breakdown?.experts_consensus?.toFixed(1)}%</span>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: The Dossier Text */}
                    <div className="col-span-8">
                        <div className="glass-panel p-8 rounded-2xl h-full border border-white/5 bg-[#0a0a0c]">
                            <div className="prose prose-invert prose-sm max-w-none font-mono text-slate-300">
                                <pre className="whitespace-pre-wrap font-sans">{dossier.details}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- MODE 2: SIMULATION (Original) ---
    const handleScrye = async () => {
        setIsScrying(true);
        setResults(null);
        setFocusedPlayer(null);
        const res = await runOracleSimulation(games, config, objective);
        setIsScrying(false);
        setResults(res);
        if (res.length > 0) setFocusedPlayer(res[0]);
    };

    if (isScrying) {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] animate-in fade-in duration-1000 relative overflow-hidden">
                <div className="absolute inset-0 bg-purple-900/10 blur-3xl animate-pulse"></div>
                <Eye size={64} className="text-purple-400 animate-bounce mb-8 relative z-10" />
                <h2 className="text-3xl font-black text-white tracking-widest relative z-10 uppercase mb-2">Simulating Universes</h2>
                <div className="flex flex-col items-center gap-2 text-xs font-mono text-purple-300/60 mt-4 relative z-10">
                    <span className="animate-pulse">Iterating 5,000 Monte Carlo Paths...</span>
                    <span className="animate-pulse delay-300">Calculating Probability Density...</span>
                </div>
            </div>
        );
    }

    if (results) {
        return (
            <div className="grid grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom duration-500">
                {/* Left Rail: List */}
                <div className="col-span-12 lg:col-span-5 space-y-4">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-black text-white uppercase tracking-tight">The Report</h2>
                        <button onClick={() => setResults(null)} className="text-[10px] text-purple-400 uppercase font-bold tracking-widest hover:text-white flex items-center gap-2">
                            <RefreshCw size={12} /> New Scrye
                        </button>
                    </div>

                    <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar text-white">
                        {results.slice(0, 12).map((res, idx) => (
                            <div
                                key={idx}
                                onClick={() => setFocusedPlayer(res)}
                                className={`glass-panel p-4 rounded-xl cursor-pointer transition-all border-l-4 ${focusedPlayer?.playerId === res.playerId ? 'border-l-purple-500 bg-purple-900/10 ring-1 ring-purple-500/20' : 'border-l-transparent hover:border-l-purple-500/50 hover:bg-slate-900/30'}`}
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="font-bold text-sm">{res.playerName}</div>
                                        <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Reality Drift: {res.edge.toFixed(1)}</div>
                                    </div>
                                    <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${res.recommendation === 'SMASH' ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                        {res.recommendation}
                                    </div>
                                </div>
                                <div className="flex gap-4 mt-3">
                                    <div>
                                        <div className="text-[8px] text-slate-600 uppercase font-bold">Prob Over</div>
                                        <div className="text-xs font-mono text-slate-300">{res.overProbability.toFixed(1)}%</div>
                                    </div>
                                    <div>
                                        <div className="text-[8px] text-slate-600 uppercase font-bold">Projection</div>
                                        <div className="text-xs font-mono text-emerald-400">{res.oracleMean.toFixed(1)}</div>
                                    </div>
                                    <div className="ml-auto flex items-center">
                                        <ChevronRight size={14} className="text-slate-700" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Rail: Deep Focus Visuals */}
                <div className="col-span-12 lg:col-span-7">
                    {focusedPlayer ? (
                        <div className="glass-panel p-8 rounded-2xl border-purple-500/20 sticky top-24">
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <span className="text-[10px] text-purple-400 font-bold uppercase tracking-widest">Reality Lens Focus</span>
                                    <h3 className="text-3xl font-black text-white mt-1 uppercase tracking-tight">{focusedPlayer.playerName}</h3>
                                    <p className="text-slate-500 text-xs mt-2 font-mono">
                                        Simulation iterations converged with {focusedPlayer.overProbability.toFixed(1)}% confidence for the over outcome.
                                    </p>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] text-slate-600 uppercase font-bold">Market Discord</div>
                                    <div className="text-2xl font-black text-purple-400 font-mono">{(focusedPlayer.edge * 10).toFixed(0)}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-6 mb-8">
                                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-center">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Safety Floor</div>
                                    <div className="text-xl font-mono text-rose-400 font-bold">{(focusedPlayer.oracleMean - focusedPlayer.volatility).toFixed(1)}</div>
                                </div>
                                <div className="p-4 rounded-xl bg-purple-900/10 border border-purple-500/20 text-center ring-1 ring-purple-500/10">
                                    <div className="text-[10px] text-purple-300 uppercase font-bold mb-1">Optimized Mean</div>
                                    <div className="text-xl font-mono text-white font-bold">{focusedPlayer.oracleMean.toFixed(1)}</div>
                                </div>
                                <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-center">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Ceiling</div>
                                    <div className="text-xl font-mono text-emerald-400 font-bold">{(focusedPlayer.oracleMean + focusedPlayer.volatility).toFixed(1)}</div>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-slate-800">
                                <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-4 flex items-center gap-2">
                                    <Layers size={14} className="text-purple-500" /> Probability Density Function (PDF)
                                </h4>
                                <DistributionVisualizer data={focusedPlayer.distribution} marketLine={focusedPlayer.marketLine} />
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center glass-panel rounded-2xl border-dashed border-slate-800">
                            <span className="text-slate-600 font-mono text-xs uppercase tracking-widest">Select entity to view density profile</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom duration-500">
            <div className="text-center space-y-4">
                <Eye size={48} className="mx-auto text-purple-500 animate-pulse" />
                <h1 className="text-5xl font-black text-white tracking-tighter uppercase italic">The Oracle</h1>
                <p className="text-purple-300/70 text-sm max-w-xl mx-auto font-light leading-relaxed">
                    Define your constraints to reveal the most optimized possible reality across the current slate. The Oracle processes thousands of simulations to find the highest-confidence paths.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
                {/* Control Panel */}
                <div className="md:col-span-8 glass-panel p-8 rounded-2xl border-purple-500/20 space-y-8">
                    <div className="flex items-center gap-2 text-purple-400 pb-4 border-b border-purple-500/10">
                        <Sliders size={20} />
                        <h3 className="font-bold text-sm uppercase tracking-widest">Reality Synthesis Controls</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                        <div>
                            <div className="flex justify-between text-xs mb-3">
                                <span className="text-slate-400 uppercase font-bold tracking-wider">Fatigue Level</span>
                                <span className="text-purple-300 font-mono">{(config.fatigueLevel * 100).toFixed(0)}%</span>
                            </div>
                            <input
                                type="range" min="0.5" max="1.0" step="0.05"
                                value={config.fatigueLevel}
                                onChange={(e) => setConfig({ ...config, fatigueLevel: parseFloat(e.target.value) })}
                                className="w-full accent-purple-500 bg-slate-800 h-1 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between text-xs mb-3">
                                <span className="text-slate-400 uppercase font-bold tracking-wider">Game Pace</span>
                                <span className="text-purple-300 font-mono">{config.paceModifier > 1 ? 'High' : config.paceModifier < 1 ? 'Slow' : 'Neutral'}</span>
                            </div>
                            <input
                                type="range" min="0.8" max="1.2" step="0.05"
                                value={config.paceModifier}
                                onChange={(e) => setConfig({ ...config, paceModifier: parseFloat(e.target.value) })}
                                className="w-full accent-indigo-500 bg-slate-800 h-1 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between text-xs mb-3">
                                <span className="text-slate-400 uppercase font-bold tracking-wider">Blowout Risk</span>
                                <span className="text-purple-300 font-mono">{(config.blowoutRisk * 100).toFixed(0)}%</span>
                            </div>
                            <input
                                type="range" min="0" max="0.5" step="0.05"
                                value={config.blowoutRisk}
                                onChange={(e) => setConfig({ ...config, blowoutRisk: parseFloat(e.target.value) })}
                                className="w-full accent-purple-500 bg-slate-800 h-1 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between text-xs mb-3 flex items-center gap-2">
                                <Swords size={12} className="text-rose-500" />
                                <span className="text-slate-400 uppercase font-bold tracking-wider">Defensive Intensity</span>
                                <span className="ml-auto text-purple-300 font-mono">{config.defenseIntensity > 1 ? 'Lax' : config.defenseIntensity < 1 ? 'Elite' : 'Avg'}</span>
                            </div>
                            <input
                                type="range" min="0.8" max="1.2" step="0.05"
                                value={config.defenseIntensity}
                                onChange={(e) => setConfig({ ...config, defenseIntensity: parseFloat(e.target.value) })}
                                className="w-full accent-rose-500 bg-slate-800 h-1 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    </div>

                    <div className="pt-6">
                        <button
                            onClick={handleScrye}
                            className="w-full group relative py-5 bg-transparent overflow-hidden rounded-xl border border-purple-500/50"
                        >
                            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-indigo-900/40 via-purple-900/40 to-indigo-900/40 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                            <span className="relative flex items-center justify-center gap-4 font-black text-white uppercase tracking-[0.3em]">
                                <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-700" />
                                Initiate Scrye
                            </span>
                        </button>
                    </div>
                </div>

                {/* Objective Picker */}
                <div className="md:col-span-4 space-y-4">
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                        <Target size={18} />
                        <h3 className="font-bold text-xs uppercase tracking-widest">Reality Objective</h3>
                    </div>
                    {[
                        { id: 'BEST_SLEEPER', label: 'Market Discord', desc: 'Max edge vs Bookie', icon: Radar },
                        { id: 'HIGH_UPSIDE', label: 'Moonshot Ceiling', desc: '95th Percentile Focus', icon: Flame },
                        { id: 'SAFE_FLOOR', label: 'Safe Harbors', desc: 'Consistency & Floor', icon: ShieldAlert },
                        { id: 'MAX_POINTS', label: 'Raw Efficiency', desc: 'Highest Projected Mean', icon: Activity }
                    ].map((obj) => (
                        <button
                            key={obj.id}
                            onClick={() => setObjective(obj.id)}
                            className={`w-full text-left p-4 rounded-xl border transition-all flex items-center gap-4 ${objective === obj.id
                                ? 'bg-purple-900/30 border-purple-500 ring-1 ring-purple-500/20 text-white'
                                : 'bg-slate-900/50 border-transparent text-slate-500 hover:bg-slate-900 hover:text-slate-300'
                                }`}
                        >
                            <div className={`p-2 rounded-lg ${objective === obj.id ? 'bg-purple-500 text-white' : 'bg-slate-800'}`}>
                                <obj.icon size={16} />
                            </div>
                            <div>
                                <div className="font-bold text-sm tracking-tight">{obj.label}</div>
                                <div className="text-[10px] opacity-60 uppercase tracking-widest mt-0.5">{obj.desc}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- Main App ---

export default function ForecasterApp() {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [games, setGames] = useState(INITIAL_GAMES);
    const [selectedGame, setSelectedGame] = useState(null);
    const [prediction, setPrediction] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [oddsTrend, setOddsTrend] = useState({});
    const [useLiveData, setUseLiveData] = useState(false);
    
    // Query interface states
    const [query, setQuery] = useState('');
    const [isQuerying, setIsQuerying] = useState(false);
    const [forecastResult, setForecastResult] = useState(null);
    const useConsensus = true; // Always use web consensus
    const [isEnhancing, setIsEnhancing] = useState(false); // Background consensus enhancement
    const [scrapingStatus, setScrapingStatus] = useState(''); // Track scraping progress
    
    // Oracle State
    const [oracleDossier, setOracleDossier] = useState(null);
    const [isOracleLoading, setIsOracleLoading] = useState(false);

    // Parlay Builder State
    const [parlayLegs, setParlayLegs] = useState([]);

    const addToParlay = (leg) => {
        setParlayLegs(prev => [...prev, leg]);
    };

    const removeLeg = (index) => {
        setParlayLegs(prev => prev.filter((_, i) => i !== index));
    };

    const clearParlay = () => setParlayLegs([]);

    // Real-time data ingestion
    useEffect(() => {
        const loadGames = async () => {
            try {
                const liveGames = await fetchLiveGames();
                if (liveGames && liveGames.length > 0) {
                    setGames(liveGames);
                }
            } catch (err) {
                console.error("[Forecaster] Failed to load live games:", err);
            }
        };

        loadGames(); // Initial load
        const pollInterval = setInterval(loadGames, 30000); // Poll every 30s for real updates

        return () => {
            clearInterval(pollInterval);
        };
    }, []);

    const handleGameSelect = (game) => {
        setSelectedGame(game);
        setPrediction(null);
        setActiveTab('analysis');
    };

    const runAnalysis = async () => {
        if (!selectedGame) return;
        setIsAnalyzing(true);
        try {
            // Get base game analysis
            const basePred = await analyzeGameWithGemini(selectedGame);
            
            // If consensus is enabled, enhance prop predictions
            if (useConsensus && basePred.propPredictions && basePred.propPredictions.length > 0) {
                console.log('[Forecaster] Enhancing props with web consensus...');
                
                // Enhance each prop with consensus data
                const enhancedProps = await Promise.all(
                    basePred.propPredictions.map(async (prop) => {
                        try {
                            // Build query for this prop
                            const query = `${prop.propId} ${selectedGame.homeTeam.shortName} vs ${selectedGame.awayTeam.shortName}`;
                            
                            // Get consensus (with short timeout for props)
                            const consensus = await getCachedConsensus(query, {
                                timeout: 5000,
                                minSources: 1
                            });
                            
                            if (consensus.success && consensus.consensus.consensus) {
                                const webValue = consensus.consensus.consensus;
                                // Blend model + consensus
                                const blended = (prop.modelProjection * 0.5) + (webValue * 0.5);
                                
                                return {
                                    ...prop,
                                    modelProjection: blended,
                                    consensus: {
                                        enabled: true,
                                        value: webValue,
                                        sources: consensus.consensus.sources,
                                        confidence: consensus.consensus.confidence
                                    }
                                };
                            }
                        } catch (err) {
                            console.warn(`[Forecaster] Consensus failed for prop ${prop.propId}`);
                        }
                        return prop; // Return unchanged if consensus fails
                    })
                );
                
                setPrediction({
                    ...basePred,
                    propPredictions: enhancedProps,
                    consensusEnhanced: true
                });
            } else {
                setPrediction(basePred);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleQuerySubmit = async (e) => {
        e.preventDefault();
        if (!query.trim() || isQuerying) return;
        
        console.log('[Forecaster] Query submitted:', query, 'useConsensus:', useConsensus);
        setIsQuerying(true);
        setIsEnhancing(false);
        setForecastResult(null);
        setScrapingStatus('');
        
        try {
            // PHASE 1: Get instant base prediction
            console.log('[Forecaster] Phase 1: Getting base prediction...');
            setScrapingStatus('Analyzing query...');
            const baseResult = await queryForecaster(query);
            
            console.log('[Forecaster] Base result received:', baseResult);
            
            if (!baseResult || !baseResult.prediction) {
                throw new Error('Invalid result structure received');
            }
            
            // Show base result immediately
            setForecastResult({
                ...baseResult,
                isBase: true,
                enhancing: true
            });
            setIsQuerying(false);
            
            // PHASE 2: Enhance with consensus (always enabled)
            setIsEnhancing(true);
            setScrapingStatus('>>> Scraping the web for the forecast <<<');
            console.log('[Forecaster] Phase 2: Scraping web for consensus...');
            
            try {
                const consensusResult = await queryForecasterWithConsensus(query, true);
                
                console.log('[Forecaster] Enhanced result received:', consensusResult);
                setScrapingStatus('Web scraping complete!');
                
                // Update with consensus-enhanced result
                setForecastResult({
                    ...consensusResult,
                    isBase: false,
                    baseComparison: {
                        basePrediction: baseResult.prediction.expectedValue,
                        enhancedPrediction: consensusResult.prediction.expectedValue,
                        difference: Math.abs(consensusResult.prediction.expectedValue - baseResult.prediction.expectedValue),
                        percentChange: (((consensusResult.prediction.expectedValue - baseResult.prediction.expectedValue) / baseResult.prediction.expectedValue) * 100).toFixed(1)
                    }
                });
            } catch (consensusError) {
                console.warn('[Forecaster] Consensus enhancement failed:', consensusError);
                setScrapingStatus('Web scraping failed - using base model');
                // Keep base result, just mark enhancement as failed
                setForecastResult(prev => ({
                    ...prev,
                    enhancing: false,
                    consensusFailed: true
                }));
            } finally {
                setIsEnhancing(false);
                setTimeout(() => setScrapingStatus(''), 3000);
            }
        } catch (error) {
            console.error('[Forecaster] Query failed:', error);
            // Show error message to user
            setForecastResult({
                error: true,
                interpretation: {
                    entity: 'Error',
                    stat: 'Query Failed',
                    context: error.message || 'Unable to process query'
                },
                prediction: {
                    expectedValue: 0,
                    range: { low: 0, high: 0 },
                    ceiling: 0,
                    floor: 0,
                    confidence: 'LOW',
                    confidenceScore: 0,
                    volatility: 'HIGH'
                },
                reasoning: {
                    summary: `Query processing failed: ${error.message}. Please try a different query or toggle consensus off.`,
                    keyDrivers: [],
                    signals: []
                },
                comparables: []
            });
            setIsQuerying(false);
            setIsEnhancing(false);
        }
    };

    const handleOracleScan = async (game) => {
        setIsOracleLoading(true);
        setOracleDossier(null);
        setActiveTab('oracle');
        
        try {
            const matchup = `${game.homeTeam.fullName} vs ${game.awayTeam.fullName}`;
            const res = await fetch('/api/forecaster/moneyball', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchup })
            });
            
            if (res.ok) {
                const data = await res.json();
                setOracleDossier(data.dossier); // { matchup, prediction, confidence, details }
            }
        } catch (e) {
            console.error("Oracle scan failed", e);
        } finally {
            setIsOracleLoading(false);
        }
    };

    const renderContent = () => {
        // 0. The Goal View - Ultimate Betting Intelligence Hub
        if (activeTab === 'goal') {
            return <TheGoalView games={games} />;
        }

        // 1. Oracle View
        if (activeTab === 'oracle') {
            return <OracleView games={games} dossier={oracleDossier} isLoading={isOracleLoading} />;
        }

        // 2. Analysis View (Game Detail)
        if (activeTab === 'analysis' && selectedGame) {
            const isScheduled = selectedGame.status === GameStatus.SCHEDULED;
            const isLive = selectedGame.status === GameStatus.LIVE;

            return (
                <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                    {/* Header Back Button */}
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className="flex items-center gap-2 text-slate-500 hover:text-white mb-4 text-xs font-bold uppercase tracking-widest"
                    >
                        <ArrowRightLeft size={12} /> Return to Grid
                    </button>

                    {/* Game Header */}
                    <div className="glass-panel p-6 rounded-2xl relative overflow-hidden border-t border-t-white/10">

                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 animate-pulse' : isScheduled ? 'bg-indigo-500' : 'bg-slate-600'}`}></div>
                                <span className="text-slate-400 text-xs font-mono">{selectedGame.status} // {selectedGame.quarter} {selectedGame.clock}</span>
                            </div>
                            <div className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                                {isScheduled ? <Calendar size={12} /> : <Globe size={12} className="animate-pulse" />}
                                {isScheduled ? "Pre-Game Forecast Engine" : "Live Reality Stream"}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-8 items-center text-center">
                            <div className="flex flex-col items-center">
                                <h2 className="text-4xl font-black tracking-tighter text-white">{selectedGame.homeTeam.shortName}</h2>
                                <div className={`text-6xl font-mono font-bold mt-2 tracking-tighter ${isScheduled && !prediction ? 'text-slate-700' : 'text-slate-100'}`}>
                                    {isScheduled ? (prediction ? prediction.projectedScoreHome : '--') : selectedGame.homeScore}
                                </div>
                                {(isScheduled || (isLive && prediction)) && <span className="text-[9px] uppercase tracking-widest text-indigo-400 mt-2">Projected: {prediction?.projectedScoreHome}</span>}
                            </div>
                            <div className="flex flex-col items-center justify-center opacity-30">
                                <div className="h-12 w-px bg-white"></div>
                            </div>
                            <div className="flex flex-col items-center">
                                <h2 className="text-4xl font-black tracking-tighter text-white">{selectedGame.awayTeam.shortName}</h2>
                                <div className={`text-6xl font-mono font-bold mt-2 tracking-tighter ${isScheduled && !prediction ? 'text-slate-700' : 'text-slate-100'}`}>
                                    {isScheduled ? (prediction ? prediction.projectedScoreAway : '--') : selectedGame.awayScore}
                                </div>
                                {(isScheduled || (isLive && prediction)) && <span className="text-[9px] uppercase tracking-widest text-indigo-400 mt-2">Projected: {prediction?.projectedScoreAway}</span>}
                            </div>
                        </div>

                        {/* Live Market Strip with Trends */}
                        <div className="mt-8 pt-6 border-t border-slate-800 flex justify-center gap-8">
                            <OddsBadge label="Consensus Spread" val={selectedGame.marketOdds.spread} />
                            <OddsBadge label="Total" val={selectedGame.marketOdds.total} />
                            <OddsBadge label="Home ML" val={selectedGame.marketOdds.homeMoneyline} highlight trend={oddsTrend[selectedGame.id] || 0} />
                            <OddsBadge label="Away ML" val={selectedGame.marketOdds.awayMoneyline} />
                        </div>

                        {/* Data Source Strip for Forecasts */}
                        <div className="mt-4 flex justify-center items-center gap-2 opacity-60">
                            <Database size={10} className="text-slate-400" />
                            <span className="text-[9px] uppercase tracking-widest text-slate-500">
                                {isScheduled ? "Intel Aggregated: FanDuel • DraftKings • BetMGM • Historic DB (3y)" : "Sources: Live Play-by-Play • Optical Tracking • Market API"}
                            </span>
                        </div>
                    </div>

                    {/* Action Area */}
                    <div className="grid grid-cols-12 gap-6">
                        <div className="col-span-12 lg:col-span-8 space-y-6">
                            {/* Analysis Result */}
                            {prediction ? (
                                <div className="glass-panel p-6 rounded-2xl border-t-2 border-emerald-500 shadow-[0_0_50px_rgba(16,185,129,0.1)]">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                                <BrainCircuit size={20} className="text-emerald-400" />
                                                FORECASTER OUTPUT
                                            </h3>
                                            <p className="text-slate-500 text-xs mt-1 uppercase tracking-wider">Probability Field Generated</p>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-3xl font-mono font-bold text-emerald-400">{prediction.realityDrift > 0 ? '' : ''}{prediction.realityDrift}<span className="text-sm align-top opacity-50">%</span></div>
                                            <div className="text-[10px] text-emerald-500/80 uppercase tracking-widest font-bold">Reality Drift</div>
                                        </div>
                                    </div>

                                    {/* Live Progress Tracker (if Live) */}
                                    {isLive && (
                                        <div className="mb-6 p-4 bg-indigo-900/10 border border-indigo-500/20 rounded-xl">
                                            <div className="flex items-center gap-2 text-indigo-400 mb-3">
                                                <Timer size={14} />
                                                <span className="text-[10px] font-bold uppercase tracking-widest">Live Pace Tracker</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-8">
                                                <div>
                                                    <div className="flex justify-between text-[10px] mb-1">
                                                        <span className="text-slate-400">{selectedGame.homeTeam.shortName} Progress</span>
                                                        <span className="text-white font-mono">{selectedGame.homeScore} / {prediction.projectedScoreHome}</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                                        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (selectedGame.homeScore / prediction.projectedScoreHome) * 100)}%` }}></div>
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-[10px] mb-1">
                                                        <span className="text-slate-400">{selectedGame.awayTeam.shortName} Progress</span>
                                                        <span className="text-white font-mono">{selectedGame.awayScore} / {prediction.projectedScoreAway}</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                                        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (selectedGame.awayScore / prediction.projectedScoreAway) * 100)}%` }}></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4 mb-6">
                                        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                                            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Win Probability Model</div>
                                            <div className="flex justify-between items-end mb-2">
                                                <span className="text-xs font-bold text-white">{selectedGame.homeTeam.shortName}</span>
                                                <span className="text-3xl font-bold text-emerald-400">{(prediction.modelWinProbHome * 100).toFixed(1)}%</span>
                                                <span className="text-xs font-bold text-white">{selectedGame.awayTeam.shortName}</span>
                                            </div>
                                            <WinProbabilityGauge
                                                homeProb={prediction.modelWinProbHome}
                                                homeTeam={selectedGame.homeTeam.shortName}
                                                awayTeam={selectedGame.awayTeam.shortName}
                                            />
                                        </div>
                                        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                                            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Confidence Level</div>
                                            <div className="flex justify-between items-end">
                                                <span className="text-3xl font-bold text-indigo-400">{prediction.confidence}%</span>
                                                <span className="text-xs text-slate-500 mb-1 font-mono">Vol: {prediction.volatilityIndex}</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-slate-800 mt-3 rounded-full overflow-hidden">
                                                <div className="h-full bg-indigo-500" style={{ width: `${prediction.confidence}%` }}></div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-slate-800/30 rounded-lg border-l-2 border-indigo-500">
                                        <p className="text-slate-300 text-sm leading-relaxed font-mono">
                                            <span className="text-indigo-400 font-bold uppercase text-xs tracking-wider">Analysis // </span>
                                            {prediction.reasoning}
                                        </p>
                                    </div>

                                    {/* Belief Markets (Props) */}
                                    {prediction.propPredictions && prediction.propPredictions.length > 0 && (
                                        <div className="mt-8">
                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                    <Target size={14} /> Belief Markets (Props)
                                                </h4>
                                                {prediction.consensusEnhanced && (
                                                    <div className="flex items-center gap-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30">
                                                        <Globe size={12} className="text-emerald-400" />
                                                        <span className="text-[9px] text-emerald-400 font-bold uppercase">Consensus Enhanced</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="overflow-hidden rounded-lg border border-slate-800">
                                                <table className="w-full text-left">
                                                    <thead className="bg-slate-900 text-[10px] text-slate-500 uppercase font-bold">
                                                        <tr>
                                                            <th className="px-4 py-2">Market</th>
                                                            <th className="px-4 py-2 text-right">Line</th>
                                                            <th className="px-4 py-2 text-right">Forecaster</th>
                                                            <th className="px-4 py-2 text-right">Drift</th>
                                                            <th className="px-4 py-2 text-right">Signal</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-800 text-xs">
                                                        {prediction.propPredictions.map((prop, i) => (
                                                            <tr key={i} className="hover:bg-slate-800/50">
                                                                <td className="px-4 py-2 text-slate-300 font-bold">{prop.propId}</td>
                                                                <td className="px-4 py-2 text-right font-mono text-slate-500">-</td>
                                                                <td className="px-4 py-2 text-right font-mono text-indigo-400">{prop.modelProjection.toFixed(1)}</td>
                                                                <td className="px-4 py-2 text-right font-mono text-emerald-400">{(prop.drift * 100).toFixed(1)}%</td>
                                                                <td className={`px-4 py-2 text-right font-bold ${prop.recommendation === 'OVER' ? 'text-emerald-400' : prop.recommendation === 'UNDER' ? 'text-rose-400' : 'text-slate-600'}`}>
                                                                    {prop.recommendation}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center p-12 glass-panel rounded-2xl border-dashed border-slate-700/50">
                                    <BrainCircuit size={48} className={`text-slate-700 mb-4 ${isAnalyzing ? 'animate-pulse text-indigo-500' : ''}`} />
                                    <h3 className="text-white font-bold text-lg">{isAnalyzing ? 'Simulating Reality...' : 'Awaiting Target Selection'}</h3>
                                    <p className="text-slate-500 text-xs mt-2 max-w-xs text-center">
                                        {isAnalyzing 
                                            ? '>>> Scraping the web for the forecast <<<' 
                                            : 'Select a game event from the left rail to initiate deep forecaster analysis.'
                                        }
                                    </p>
                                    {!isAnalyzing && (
                                        <div className="flex flex-col items-center gap-3 mt-6">
                                            <button
                                                onClick={runAnalysis}
                                                disabled={isAnalyzing}
                                                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold uppercase tracking-widest text-white transition-all transform hover:scale-105 shadow-[0_0_20px_rgba(79,70,229,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                <Globe size={14} className="text-emerald-400" />
                                                Run Forecaster
                                                <span className="text-[9px] text-emerald-400">(+Web Consensus)</span>
                                            </button>
                                            <span className="text-[9px] text-slate-600 italic">Automatically aggregates 5+ web sources</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="col-span-12 lg:col-span-4 space-y-6">
                            <EdgeMeter edge={0.05} confidence={85} />
                        </div>
                    </div>
                </div>
            );
        }

        // If we have a forecast result, show it
        if (forecastResult) {
            return <ForecastResultView result={forecastResult} onBack={() => setForecastResult(null)} onAddToParlay={addToParlay} />;
        }

        return (
            <div className="space-y-8">
                {/* QUERY BAR */}
                <div className="flex flex-col items-center justify-center py-12 glass-panel rounded-2xl border-white/5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-indigo-900/10 blur-3xl rounded-full pointer-events-none transform scale-150 opacity-50"></div>
                    <div className="relative z-10 w-full max-w-2xl text-center space-y-6">
                        <div className="flex items-center justify-center gap-2 text-indigo-400 mb-2">
                            <BrainCircuit size={24} className="animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-[0.2em]">Forecaster Intelligence Layer</span>
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">Ask the Projection Engine</h1>

                        <form onSubmit={handleQuerySubmit} className="relative w-full max-w-xl mx-auto">
                            <div className="relative group">
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-1000 pointer-events-none"></div>
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="e.g. How many yards will Mahomes get vs Buffalo?"
                                    className="relative z-10 w-full bg-[#0E0E11] text-white placeholder:text-slate-600 pl-6 pr-14 py-4 rounded-xl border border-white/10 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm font-medium shadow-xl"
                                    disabled={isQuerying}
                                />
                                <button
                                    type="submit"
                                    disabled={!query.trim() || isQuerying}
                                    className="absolute z-20 right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all disabled:opacity-0 disabled:pointer-events-none"
                                >
                                    {isQuerying ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}
                                </button>
                            </div>
                        </form>

                        {/* Web Consensus Status */}
                        <div className="flex items-center justify-center gap-3">
                            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                                <Globe size={14} className="text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Web Consensus Always Active</span>
                            </div>
                            <span className="text-[9px] text-slate-600 italic">Aggregating 5+ sources automatically</span>
                        </div>
                        
                        {/* Scraping Status */}
                        {scrapingStatus && (
                            <div className="flex items-center justify-center gap-2 animate-pulse">
                                <RefreshCw size={14} className="text-amber-400 animate-spin" />
                                <span className="text-sm font-mono text-amber-400">{scrapingStatus}</span>
                            </div>
                        )}
                        
                        <div className="flex justify-center gap-4 text-[10px] text-slate-500 font-mono">
                            <span>Try: "CMC rushing yards"</span>
                            <span>•</span>
                            <span>"Luka points vs Boston"</span>
                            <span>•</span>
                            <span>"Chiefs win probability"</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 my-8">
                    <div className="h-px bg-white/5 flex-1" />
                    <span className="text-[10px] uppercase font-bold text-slate-600 tracking-widest">Global Market Monitor</span>
                    <div className="h-px bg-white/5 flex-1" />
                </div>

                <ScannerView games={games} onSelectGame={handleGameSelect} onOracleScan={handleOracleScan} />
            </div>
        );
    };

    return (
        <div className="bg-[#09090b] text-zinc-200 min-h-screen">
            <div className="flex h-16 border-b border-white/5 items-center px-6 sticky top-0 bg-[#09090b]/80 backdrop-blur-md z-50">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(79,70,229,0.5)]">
                        <BrainCircuit size={18} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-black tracking-tighter text-white italic uppercase">Forecaster <span className="text-indigo-500">Engine</span></h1>
                    </div>
                </div>

                <div className="ml-12 flex gap-1">
                    {[
                        { id: 'dashboard', label: 'Scanner', icon: Radar },
                        { id: 'oracle', label: 'The Oracle', icon: Eye },
                        { id: 'goal', label: 'The Goal', icon: Target },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${activeTab === tab.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-6">
                {renderContent()}
            </div>

            <ParlaySidebar legs={parlayLegs} onRemove={removeLeg} onClear={clearParlay} />
        </div>
    );
}
