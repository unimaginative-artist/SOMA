import React, { useMemo, useState, useEffect } from 'react';
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const decimalToAmerican = (decimalOdds = 1.91) => {
    const odds = Math.max(Number(decimalOdds) || 1.91, 1.01);
    if (odds >= 2) return `+${Math.round((odds - 1) * 100)}`;
    return `${Math.round(-100 / (odds - 1))}`;
};
const americanToDecimal = (americanOdds = -110) => {
    const odds = Number(americanOdds);
    if (!Number.isFinite(odds) || odds === 0) return 1.91;
    return odds > 0 ? 1 + (odds / 100) : 1 + (100 / Math.abs(odds));
};
const probToAmerican = (prob = 0.5) => {
    const p = clamp(Number(prob) || 0.5, 0.01, 0.99);
    if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
    return Math.round(((1 - p) / p) * 100);
};
const parseSlipText = (text = '') => {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const legs = [];
    const unparsed = [];

    lines.forEach((line) => {
        const cleaned = line.replace(/\s+/g, ' ');
        const oddsMatch = cleaned.match(/([+-]\d{3,4})\b/);
        const ouMatch = cleaned.match(/\b(over|under|o|u)\s*([0-9]+(?:\.[0-9]+)?)/i);
        const spreadMatch = !ouMatch && cleaned.match(/\b([+-][0-9]+(?:\.[0-9]+)?)\b/);
        const moneyline = /\b(ml|moneyline)\b/i.test(cleaned);

        if (!ouMatch && !spreadMatch && !moneyline) {
            unparsed.push(line);
            return;
        }

        const statMatch = cleaned.match(/\b(passing yards|rushing yards|receiving yards|points|rebounds|assists|goals|shots|strikeouts|total|spread|moneyline)\b/i);
        const side = ouMatch ? (/^(u|under)$/i.test(ouMatch[1]) ? 'under' : 'over') : (spreadMatch ? 'spread' : 'moneyline');
        const lineValue = ouMatch ? Number(ouMatch[2]) : (spreadMatch ? Math.abs(Number(spreadMatch[1])) : 0);
        const entity = cleaned
            .replace(/\b(over|under|o|u)\s*[0-9]+(?:\.[0-9]+)?/ig, '')
            .replace(/[+-]\d{3,4}\b/g, '')
            .replace(/\b(ml|moneyline)\b/ig, '')
            .replace(/\b(passing yards|rushing yards|receiving yards|points|rebounds|assists|goals|shots|strikeouts|total|spread)\b/ig, '')
            .replace(/\s+/g, ' ')
            .trim() || 'Parsed leg';

        legs.push({
            entity,
            stat: statMatch?.[1] || (moneyline ? 'Moneyline' : 'Parsed Market'),
            value: lineValue,
            line: lineValue,
            side,
            odds: americanToDecimal(oddsMatch ? oddsMatch[1] : -110),
            modelProb: 0.55,
            confidenceScore: 0.55,
            volatility: 'MEDIUM',
            sampleSize: 0,
            source: 'paste-slip'
        });
    });

    return { legs, unparsed };
};
const qualityColor = (score) => score >= 78 ? 'text-emerald-400' : score >= 58 ? 'text-amber-400' : 'text-rose-400';
const dataBadgeClass = (badge = '') => {
    if (/real|live|recent|found|connected/.test(badge)) return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
    if (/missing|needs|heuristic|not_|pending|thin|partial/.test(badge)) return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
    if (/error|unavailable/.test(badge)) return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
    return 'border-white/10 bg-white/5 text-slate-400';
};
const modeAdjustments = {
    conservative: { label: 'Conservative', multiplier: 0.92, maxLegs: 3 },
    balanced: { label: 'Balanced', multiplier: 1, maxLegs: 4 },
    aggressive: { label: 'Aggressive', multiplier: 1.06, maxLegs: 6 },
    research: { label: 'Research Only', multiplier: 1, maxLegs: 99 }
};

const getLegQuality = (leg) => {
    const confidence = Number(leg.confidenceScore || 0.55);
    const volatilityPenalty = String(leg.volatility || '').toUpperCase() === 'HIGH' ? 20 : String(leg.volatility || '').toUpperCase() === 'LOW' ? 0 : 8;
    const margin = Math.abs(Number(leg.value || 0) - Number(leg.line || leg.value || 0));
    const marginBoost = clamp(margin * 2, 0, 14);
    const sampleBoost = clamp((Number(leg.sampleSize || 0) / 10) * 10, 0, 10);
    return clamp(Math.round((confidence * 78) + marginBoost + sampleBoost - volatilityPenalty), 5, 99);
};

const getLegProbability = (leg, mode = 'balanced') => {
    const base = Number(leg.modelProb || leg.confidenceScore || 0.55);
    const line = Number(leg.line || leg.value || 0);
    const projection = Number(leg.value || line);
    const direction = leg.side === 'under' ? -1 : 1;
    const margin = (projection - line) * direction;
    const marginBoost = clamp(margin / Math.max(8, Math.abs(projection || 1) * 0.18), -0.14, 0.14);
    const volatilityPenalty = String(leg.volatility || '').toUpperCase() === 'HIGH' ? 0.08 : String(leg.volatility || '').toUpperCase() === 'LOW' ? 0.01 : 0.04;
    const modeBoost = modeAdjustments[mode]?.multiplier || 1;
    return clamp((base + marginBoost - volatilityPenalty) * modeBoost, 0.05, 0.92);
};

const buildParlayDiagnostics = (legs, mode) => {
    const enriched = legs.map((leg, index) => {
        const quality = getLegQuality(leg);
        const modelProb = getLegProbability(leg, mode);
        return { ...leg, index, quality, modelProb };
    });
    const weakLink = [...enriched].sort((a, b) => (a.quality * a.modelProb) - (b.quality * b.modelProb))[0] || null;
    const correlationPairs = [];
    for (let i = 0; i < enriched.length; i += 1) {
        for (let j = i + 1; j < enriched.length; j += 1) {
            const sameEntity = enriched[i].entity && enriched[i].entity === enriched[j].entity;
            const sameGame = enriched[i].gameId && enriched[i].gameId === enriched[j].gameId;
            if (sameEntity || sameGame) correlationPairs.push({ from: i + 1, to: j + 1, reason: sameEntity ? 'same entity' : 'same game' });
        }
    }
    const suggestions = [];
    if (weakLink && weakLink.quality < 55) suggestions.push(`Remove or rework ${weakLink.entity}: low leg quality.`);
    if (correlationPairs.length) suggestions.push('Review same-game/entity links before trusting the combined probability.');
    if (enriched.length > (modeAdjustments[mode]?.maxLegs || 4)) suggestions.push(`${modeAdjustments[mode]?.label || 'This'} mode prefers fewer legs.`);
    if (enriched.length >= 4) suggestions.push('Try a smaller 2-3 leg version and compare hit chance.');
    if (!suggestions.length) suggestions.push('Structure is clean enough to track, but still needs outcome grading.');
    return { enriched, weakLink, correlationPairs, suggestions };
};

const ParlaySidebar = ({ legs, onRemove, onClear, onUpdateLeg }) => {
    const [isSimulating, setIsSimulating] = useState(false);
    const [analysis, setAnalysis] = useState(null);
    const [mode, setMode] = useState('balanced');
    const [ledger, setLedger] = useState(() => {
        try { return JSON.parse(localStorage.getItem('soma.forecaster.parlayLedger') || '[]').slice(0, 6); }
        catch { return []; }
    });
    const [calibration, setCalibration] = useState(null);
    const [lineOverrides, setLineOverrides] = useState({});
    const [enrichingIndex, setEnrichingIndex] = useState(null);
    const [matrix, setMatrix] = useState([]);
    const [covariance, setCovariance] = useState(null);
    const [lineShopStatus, setLineShopStatus] = useState(null);
    const [lineShopLines, setLineShopLines] = useState([]);
    const [isSwarming, setIsSwarming] = useState(false);
    const [swarmResult, setSwarmResult] = useState(null);

    // Reset analysis when legs change
    useEffect(() => {
        setAnalysis(null);
        setSwarmResult(null);
    }, [legs, mode, lineOverrides]);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/forecaster/ledger')
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (cancelled || !data?.success) return;
                setLedger((data.entries || []).slice(0, 8));
                setCalibration(data.calibration || null);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!legs.length) return;
        let cancelled = false;
        fetch('/api/forecaster/correlation-matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ legs })
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (!cancelled && data?.success) {
                    setMatrix(data.matrix || []);
                    setCovariance(data.covariance || null);
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [legs]);

    const adjustedLegs = legs.map((leg, index) => ({
        ...leg,
        line: lineOverrides[index] ?? leg.line ?? leg.value
    }));
    const diagnostics = useMemo(() => buildParlayDiagnostics(adjustedLegs, mode), [adjustedLegs, mode]);
    if (legs.length === 0) return null;
    const totalOdds = adjustedLegs.reduce((acc, leg) => acc * (leg.odds || 1.91), 1);
    const impliedProb = (1 / totalOdds) * 100;
    const modelParlayProb = diagnostics.enriched.reduce((acc, leg) => acc * (leg.modelProb || 0.5), 1);
    const fairAmerican = probToAmerican(modelParlayProb);
    const marketEdge = (modelParlayProb * 100) - impliedProb;

    const saveScenario = async () => {
        const scenario = {
            id: `forecast-${Date.now()}`,
            createdAt: new Date().toISOString(),
            type: 'parlay_scenario',
            mode,
            legs: diagnostics.enriched.map(leg => ({
                entity: leg.entity,
                stat: leg.stat,
                value: leg.value,
                line: leg.line,
                side: leg.side,
                odds: leg.odds,
                quality: leg.quality,
                modelProb: leg.modelProb,
                confidenceScore: leg.confidenceScore,
                sport: leg.sport,
                marketType: leg.marketType,
                team: leg.team,
                sampleSize: leg.sampleSize,
                volatility: leg.volatility,
                sourceStatus: leg.sourceStatus,
                dataFreshness: leg.dataFreshness,
                dataSources: leg.dataSources,
                contextStatus: leg.contextStatus,
                contextSignals: leg.contextSignals
            })),
            analysis,
            swarm: swarmResult
        };
        const next = [scenario, ...ledger].slice(0, 8);
        setLedger(next);
        localStorage.setItem('soma.forecaster.parlayLedger', JSON.stringify(next));
        try {
            const res = await fetch('/api/forecaster/ledger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scenario)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setLedger(prev => [data.entry, ...prev.filter(item => item.id !== data.entry.id)].slice(0, 8));
                    setCalibration(data.calibration || null);
                }
            }
        } catch (e) {
            console.warn('[Forecaster] Backend ledger save failed; kept local scenario.', e.message);
        }
    };

    const gradeScenario = async (id, hit) => {
        const next = ledger.map(item => item.id === id ? { ...item, grade: { status: 'graded', hit } } : item);
        setLedger(next);
        localStorage.setItem('soma.forecaster.parlayLedger', JSON.stringify(next));
        try {
            const res = await fetch(`/api/forecaster/ledger/${encodeURIComponent(id)}/grade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hit })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setLedger(prev => prev.map(item => item.id === id ? data.entry : item));
                    setCalibration(data.calibration || null);
                }
            }
        } catch (e) {
            console.warn('[Forecaster] Backend grading failed; kept local grade.', e.message);
        }
    };

    const updateLeg = (index, patch) => {
        onUpdateLeg?.(index, patch);
    };

    const enrichLeg = async (index, leg) => {
        setEnrichingIndex(index);
        try {
            const res = await fetch('/api/forecaster/enrich-leg', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leg })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.leg) updateLeg(index, data.leg);
            }
        } catch (e) {
            console.warn('[Forecaster] Leg enrichment failed:', e.message);
        } finally {
            setEnrichingIndex(null);
        }
    };

    const enrichAllLegs = async () => {
        for (const [index, leg] of diagnostics.enriched.entries()) {
            await enrichLeg(index, leg);
        }
    };

    const runLineShop = async () => {
        setLineShopStatus('checking');
        setLineShopLines([]);
        try {
            const res = await fetch('/api/forecaster/line-shop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ legs: diagnostics.enriched })
            });
            const data = res.ok ? await res.json() : null;
            if (data?.success) {
                setLineShopLines(data.lines || []);
                if (data.providerStatus === 'missing_key') {
                    setLineShopStatus(`${data.lines?.length || 0} checked; add ODDS_API_KEY`);
                } else {
                    const matched = (data.lines || []).filter(line => line.status === 'matched').length;
                    setLineShopStatus(`${matched}/${data.lines?.length || 0} matched`);
                }
            } else {
                setLineShopStatus('unavailable');
            }
        } catch {
            setLineShopStatus('unavailable');
        }
    };

    const runSimulation = async () => {
        setIsSimulating(true);
        
        try {
            // Use the SOMA backend route so the simulator still works when the
            // standalone Prophet Flask service is not running.
            const res = await fetch('/api/forecaster/parlay-simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    legs: diagnostics.enriched.map(l => ({
                        entity: l.entity,
                        stat: l.stat,
                        value: l.value,
                        line: l.line,
                        side: l.side || 'over',
                        odds: l.odds || 1.91,
                        modelProb: l.modelProb,
                        quality: l.quality,
                        gameId: l.gameId,
                        sport: l.sport,
                        marketType: l.marketType,
                        sampleSize: l.sampleSize,
                        volatility: l.volatility,
                        sourceStatus: l.sourceStatus,
                        dataFreshness: l.dataFreshness,
                        dataSources: l.dataSources,
                        contextSignals: l.contextSignals
                    })),
                    iterations: 10000
                })
            });

            if (res.ok) {
                const data = await res.json();
                setAnalysis({
                    trueProb: data.trueProb,
                    edge: data.edge,
                    correlation: data.correlation,
                    rating: data.rating,
                    warnings: data.warnings || [],
                    weakLink: data.weakLink || diagnostics.weakLink,
                    suggestions: data.suggestions || diagnostics.suggestions,
                    calibration: data.calibration || null
                });
                if (data.covariance) setCovariance(data.covariance);
            } else {
                console.error("Simulation failed");
            }
        } catch (e) {
            console.error("Simulation error", e);
        } finally {
            setIsSimulating(false);
        }
    };

    const runSwarmSimulation = async () => {
        setIsSwarming(true);
        setSwarmResult(null);
        try {
            const res = await fetch('/api/forecaster/swarm-simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    rounds: 120,
                    legs: diagnostics.enriched.map(l => ({
                        entity: l.entity,
                        stat: l.stat,
                        value: l.value,
                        line: l.line,
                        side: l.side || 'over',
                        odds: l.odds || 1.91,
                        modelProb: l.modelProb,
                        confidenceScore: l.confidenceScore,
                        quality: l.quality,
                        sampleSize: l.sampleSize,
                        volatility: l.volatility,
                        gameId: l.gameId,
                        team: l.team,
                        sport: l.sport,
                        marketType: l.marketType,
                        sourceStatus: l.sourceStatus,
                        dataFreshness: l.dataFreshness,
                        dataSources: l.dataSources,
                        contextSignals: l.contextSignals
                    }))
                })
            });
            const data = res.ok ? await res.json() : null;
            if (data?.success) setSwarmResult(data);
        } catch (e) {
            console.warn('[Forecaster] Swarm simulation failed:', e.message);
        } finally {
            setIsSwarming(false);
        }
    };

    return (
        <div className="fixed right-6 bottom-6 w-[360px] bg-[#0E0E11] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-right duration-300 flex flex-col max-h-[84vh]">
            <div className="p-4 border-b border-white/5 bg-indigo-600/10 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white">Parlay Simulator</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={enrichAllLegs}
                        disabled={enrichingIndex !== null}
                        className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[9px] uppercase font-bold"
                    >
                        Enrich All
                    </button>
                    <button
                        onClick={runLineShop}
                        className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[9px] uppercase font-bold"
                    >
                        Lines
                    </button>
                    <button
                        onClick={runSwarmSimulation}
                        disabled={isSwarming}
                        className="px-2 py-1 rounded bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20 text-[9px] uppercase font-bold disabled:opacity-50"
                    >
                        {isSwarming ? 'Swarm...' : 'Swarm'}
                    </button>
                    <span className="text-[10px] font-mono text-indigo-300">{legs.length} LEGS</span>
                </div>
            </div>
            
            <div className="p-3 border-b border-white/5 bg-slate-950/60">
                <div className="grid grid-cols-4 gap-1">
                    {Object.entries(modeAdjustments).map(([id, cfg]) => (
                        <button
                            key={id}
                            onClick={() => setMode(id)}
                            className={`py-2 rounded-md text-[8px] font-bold uppercase tracking-wider ${mode === id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-500 hover:text-slate-200'}`}
                        >
                            {cfg.label}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="overflow-y-auto p-2 space-y-2 flex-1 custom-scrollbar">
                {diagnostics.enriched.map((leg, idx) => (
                    <div key={idx} className="p-3 bg-white/5 rounded-lg border border-white/5 relative group">
                        <button 
                            onClick={() => onRemove(idx)}
                            className="absolute top-2 right-2 text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <TrendingDown size={12} />
                        </button>
                        <div className="text-xs font-bold text-white mb-1 pr-5">{leg.entity}</div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            <input
                                value={leg.entity || ''}
                                onChange={(e) => updateLeg(idx, { entity: e.target.value })}
                                className="bg-slate-950/70 border border-white/5 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-indigo-500/50"
                            />
                            <input
                                value={leg.stat || ''}
                                onChange={(e) => updateLeg(idx, { stat: e.target.value })}
                                className="bg-slate-950/70 border border-white/5 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-indigo-500/50"
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-400 uppercase">{leg.stat}</span>
                            <span className="text-sm font-mono font-bold text-emerald-400">{leg.value}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3 text-[9px] font-mono">
                            <div>
                                <div className="text-slate-600 uppercase">Quality</div>
                                <div className={qualityColor(leg.quality)}>{leg.quality}/100</div>
                            </div>
                            <div>
                                <div className="text-slate-600 uppercase">Hit Est.</div>
                                <div className="text-white">
                                    {(leg.modelProb * 100).toFixed(1)}%
                                    {Number.isFinite(Number(leg.probabilityDelta)) && Number(leg.probabilityDelta) !== 0 && (
                                        <span className={Number(leg.probabilityDelta) > 0 ? 'text-emerald-400 ml-1' : 'text-rose-400 ml-1'}>
                                            {Number(leg.probabilityDelta) > 0 ? '+' : ''}{Number(leg.probabilityDelta).toFixed(1)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div>
                                <div className="text-slate-600 uppercase">Odds</div>
                                <div className="text-slate-300">{decimalToAmerican(leg.odds)}</div>
                            </div>
                        </div>
                        {(leg.sampleSize || leg.average) && (
                            <div className="grid grid-cols-3 gap-2 mt-2 text-[9px] font-mono">
                                <div>
                                    <div className="text-slate-600 uppercase">Sample</div>
                                    <div className="text-slate-300">{leg.sampleSize || 0}</div>
                                </div>
                                <div>
                                    <div className="text-slate-600 uppercase">Avg</div>
                                    <div className="text-slate-300">{Number(leg.average || 0).toFixed(1)}</div>
                                </div>
                                <div>
                                    <div className="text-slate-600 uppercase">Vol</div>
                                    <div className={leg.volatility === 'HIGH' ? 'text-rose-400' : leg.volatility === 'LOW' ? 'text-emerald-400' : 'text-amber-400'}>{leg.volatility || 'UNK'}</div>
                                </div>
                            </div>
                        )}
                        <div className="mt-3">
                            <div className="grid grid-cols-3 gap-2 mb-2">
                                <label className="text-[8px] text-slate-600 uppercase">
                                    Line
                                    <input
                                        type="number"
                                        value={Number(leg.line || 0)}
                                        onChange={(e) => {
                                            const value = Number(e.target.value);
                                            setLineOverrides(prev => ({ ...prev, [idx]: value }));
                                            updateLeg(idx, { line: value, value });
                                        }}
                                        className="mt-1 w-full bg-slate-950/70 border border-white/5 rounded px-1 py-1 text-[10px] text-white"
                                    />
                                </label>
                                <label className="text-[8px] text-slate-600 uppercase">
                                    Side
                                    <select
                                        value={leg.side || 'over'}
                                        onChange={(e) => updateLeg(idx, { side: e.target.value })}
                                        className="mt-1 w-full bg-slate-950/70 border border-white/5 rounded px-1 py-1 text-[10px] text-white"
                                    >
                                        <option value="over">over</option>
                                        <option value="under">under</option>
                                        <option value="spread">spread</option>
                                        <option value="moneyline">ml</option>
                                    </select>
                                </label>
                                <label className="text-[8px] text-slate-600 uppercase">
                                    Odds
                                    <input
                                        type="number"
                                        value={Number(String(decimalToAmerican(leg.odds)).replace('+', ''))}
                                        onChange={(e) => updateLeg(idx, { odds: americanToDecimal(Number(e.target.value)) })}
                                        className="mt-1 w-full bg-slate-950/70 border border-white/5 rounded px-1 py-1 text-[10px] text-white"
                                    />
                                </label>
                            </div>
                            <div className="flex justify-between text-[9px] text-slate-500 uppercase">
                                <span>What-if line</span>
                                <span className="text-slate-300">{Number(leg.line || 0).toFixed(1)}</span>
                            </div>
                            <input
                                type="range"
                                min={Math.max(0, Number(leg.value || 0) - 25)}
                                max={Number(leg.value || 0) + 25}
                                step="0.5"
                                value={Number(leg.line || leg.value || 0)}
                                onChange={(e) => setLineOverrides(prev => ({ ...prev, [idx]: Number(e.target.value) }))}
                                className="w-full accent-indigo-500"
                            />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="text-[9px] text-slate-500">
                                <span className="uppercase text-slate-600">Data</span> {leg.sourceStatus || 'not enriched'}
                            </div>
                            <button
                                onClick={() => enrichLeg(idx, leg)}
                                disabled={enrichingIndex === idx}
                                className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[9px] uppercase font-bold"
                            >
                                {enrichingIndex === idx ? 'Enriching' : 'Enrich'}
                            </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                            {([...(leg.dataSources || []), leg.contextStatus].filter(Boolean).slice(0, 4)).map(source => (
                                <span key={source} className={`px-1.5 py-0.5 rounded border text-[8px] uppercase tracking-wider ${dataBadgeClass(source)}`}>
                                    {String(source).replace(/_/g, '-')}
                                </span>
                            ))}
                            {!leg.dataSources?.length && !leg.contextStatus && (
                                <span className={`px-1.5 py-0.5 rounded border text-[8px] uppercase tracking-wider ${dataBadgeClass('heuristic')}`}>
                                    heuristic
                                </span>
                            )}
                        </div>
                        {leg.contextSignals?.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {leg.contextSignals.slice(0, 2).map((signal, signalIdx) => (
                                    <div key={`${signal.headline}-${signalIdx}`} className="text-[9px] text-slate-400 truncate">
                                        <span className="text-amber-300 uppercase">{signal.type}</span> {signal.headline}
                                    </div>
                                ))}
                            </div>
                        )}
                        {leg.enrichmentNotes && (
                            <div className="mt-2 text-[9px] text-slate-500 italic">{leg.enrichmentNotes}</div>
                        )}
                    </div>
                ))}

                <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Correlation Map</div>
                        <span className={`px-1.5 py-0.5 rounded border text-[8px] uppercase ${dataBadgeClass(covariance?.maturity || 'rule_based')}`}>
                            {covariance?.maturity || 'rule based'}
                        </span>
                    </div>
                    {matrix.length ? matrix.map((pair, idx) => (
                        <div key={idx} className="text-[10px] text-amber-300 flex justify-between border-b border-white/5 py-1 last:border-0">
                            <span>Leg {pair.from + 1} to Leg {pair.to + 1}</span>
                            <span>{pair.score} | {pair.covarianceType || pair.confidence}</span>
                        </div>
                    )) : <div className="text-[10px] text-slate-600">No obvious same-game/entity links.</div>}
                    {lineShopStatus && (
                        <div className="mt-2 text-[9px] text-emerald-300 border-t border-white/5 pt-2">Line shop: {lineShopStatus}</div>
                    )}
                    {lineShopLines.slice(0, 3).map((line) => (
                        <div key={line.index} className="mt-1 text-[9px] text-slate-400 flex justify-between gap-2">
                            <span className="truncate">{line.entity}</span>
                            <span className={line.status === 'matched' ? 'text-emerald-300' : 'text-slate-600'}>
                                {line.bestAvailable ? `${line.bestAvailable.bookmaker} ${decimalToAmerican(line.bestAvailable.odds)}` : line.status}
                            </span>
                        </div>
                    ))}
                </div>

                {swarmResult && (
                    <div className="p-3 rounded-lg bg-fuchsia-950/20 border border-fuchsia-500/20">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Users size={13} className="text-fuchsia-300" />
                                <span className="text-[10px] text-fuchsia-300 uppercase font-bold tracking-widest">Forecast Swarm</span>
                            </div>
                            <span className="text-[10px] font-mono text-white">{swarmResult.consensus?.probability}%</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="rounded bg-black/30 border border-white/5 p-2">
                                <div className="text-[8px] text-slate-600 uppercase font-bold">Band</div>
                                <div className="text-[10px] text-slate-200 font-mono">{swarmResult.consensus?.low}-{swarmResult.consensus?.high}%</div>
                            </div>
                            <div className="rounded bg-black/30 border border-white/5 p-2">
                                <div className="text-[8px] text-slate-600 uppercase font-bold">Disagree</div>
                                <div className="text-[10px] text-amber-300 font-mono">{swarmResult.consensus?.disagreement}%</div>
                            </div>
                            <div className="rounded bg-black/30 border border-white/5 p-2">
                                <div className="text-[8px] text-slate-600 uppercase font-bold">Rating</div>
                                <div className="text-[10px] text-fuchsia-200 font-mono">{swarmResult.consensus?.rating}</div>
                            </div>
                        </div>
                        <div className="text-[10px] text-slate-300 leading-snug mb-3">
                            {swarmResult.consensus?.recommendation}
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                            {(swarmResult.agents || []).map(agent => (
                                <div key={agent.id} className="grid grid-cols-[1fr_auto] gap-2 text-[9px] border-t border-white/5 pt-1">
                                    <div>
                                        <span className="text-slate-200 font-bold">{agent.name}</span>
                                        <span className="text-slate-600"> / {agent.stance}</span>
                                    </div>
                                    <span className="font-mono text-fuchsia-200">{agent.probability}%</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 text-[9px] text-slate-500 italic">
                            {swarmResult.evidence?.note}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                            {(swarmResult.evidence?.sources?.badges || []).slice(0, 5).map(source => (
                                <span key={source} className={`px-1.5 py-0.5 rounded border text-[8px] uppercase tracking-wider ${dataBadgeClass(source)}`}>
                                    {String(source).replace(/_/g, '-')}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Analysis Section */}
            {analysis && (
                <div className="p-4 bg-emerald-900/10 border-y border-emerald-500/20 animate-in fade-in shrink-0">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">SOMA Hit-Rate Model</span>
                        <span className="text-xs font-black text-white px-2 py-0.5 bg-emerald-500 rounded text-black">{analysis.rating}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center mb-2">
                        <div className="bg-slate-900/50 rounded p-1">
                            <div className="text-[9px] text-slate-500 uppercase">Implied Prob</div>
                            <div className="font-mono text-slate-300 text-xs">{impliedProb.toFixed(1)}%</div>
                        </div>
                        <div className="bg-emerald-900/30 rounded p-1 border border-emerald-500/30">
                            <div className="text-[9px] text-emerald-400 uppercase">Hit Chance</div>
                            <div className="font-mono text-white text-xs font-bold">{analysis.trueProb}%</div>
                        </div>
                    </div>
                    <div className="text-[9px] text-center text-emerald-300/80 italic">
                        {analysis.correlation}
                    </div>
                    {analysis.weakLink && (
                        <div className="mt-3 p-2 rounded bg-rose-500/10 border border-rose-500/20">
                            <div className="text-[9px] text-rose-300 uppercase font-bold">Weak Link</div>
                            <div className="text-xs text-white">{analysis.weakLink.entity}</div>
                            <div className="text-[10px] text-slate-400">{analysis.weakLink.stat} | quality {analysis.weakLink.quality}/100</div>
                        </div>
                    )}
                    <div className="mt-3 space-y-1">
                        {(analysis.suggestions || diagnostics.suggestions).slice(0, 3).map((item, idx) => (
                            <div key={idx} className="text-[10px] text-slate-300 flex gap-2">
                                <span className="text-indigo-400">•</span>{item}
                            </div>
                        ))}
                    </div>
                    {analysis.calibration && (
                        <div className="mt-3 grid grid-cols-3 gap-2 text-[9px] font-mono">
                            <div className="rounded bg-black/20 border border-white/5 p-1">
                                <div className="text-slate-600 uppercase">Covar</div>
                                <div className="text-slate-300">{analysis.calibration.covarianceMaturity || covariance?.maturity || 'rule'}</div>
                            </div>
                            <div className="rounded bg-black/20 border border-white/5 p-1">
                                <div className="text-slate-600 uppercase">Corr Drag</div>
                                <div className="text-amber-300">{analysis.calibration.correlationPenalty ?? 0}%</div>
                            </div>
                            <div className="rounded bg-black/20 border border-white/5 p-1">
                                <div className="text-slate-600 uppercase">Quality Drag</div>
                                <div className="text-amber-300">{analysis.calibration.qualityPenalty ?? 0}%</div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="p-4 border-t border-white/10 bg-slate-900/50 shrink-0">
                <div className="flex justify-between items-end mb-4">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Combined Market Odds</span>
                    <span className="text-xl font-mono font-bold text-white">+{((totalOdds - 1) * 100).toFixed(0)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="rounded bg-slate-950/70 border border-white/5 p-2">
                        <div className="text-[8px] text-slate-600 uppercase font-bold">SOMA Prob</div>
                        <div className="text-xs text-white font-mono">{(modelParlayProb * 100).toFixed(1)}%</div>
                    </div>
                    <div className="rounded bg-slate-950/70 border border-white/5 p-2">
                        <div className="text-[8px] text-slate-600 uppercase font-bold">Fair Odds</div>
                        <div className="text-xs text-indigo-300 font-mono">{fairAmerican > 0 ? `+${fairAmerican}` : fairAmerican}</div>
                    </div>
                    <div className="rounded bg-slate-950/70 border border-white/5 p-2">
                        <div className="text-[8px] text-slate-600 uppercase font-bold">Gap</div>
                        <div className={`text-xs font-mono ${marketEdge >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{marketEdge >= 0 ? '+' : ''}{marketEdge.toFixed(1)}%</div>
                    </div>
                </div>
                
                {!analysis ? (
                    <button 
                        onClick={runSimulation}
                        disabled={isSimulating}
                        className="w-full mb-3 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                    >
                        {isSimulating ? <RefreshCw size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
                        {isSimulating ? 'Running Hit-Rate Model...' : 'Analyze Correlation'}
                    </button>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onClear} className="px-3 py-3 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors">
                            Clear
                        </button>
                        <button onClick={saveScenario} className="px-3 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[10px] font-bold text-black uppercase tracking-wider transition-colors shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2">
                            Save Scenario <Target size={12} />
                        </button>
                    </div>
                )}
                {ledger.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-white/5">
                        <div className="flex justify-between items-center mb-2">
                            <div className="text-[9px] text-slate-500 uppercase font-bold">Outcome Ledger</div>
                            {calibration?.graded > 0 && (
                                <div className="text-[9px] text-emerald-400 font-mono">
                                    {calibration.hitRate}% hit | Brier {calibration.brierScore}
                                </div>
                            )}
                        </div>
                        <div className="space-y-1 max-h-20 overflow-y-auto custom-scrollbar">
                            {ledger.slice(0, 3).map(item => (
                                <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 text-[10px] text-slate-500 items-center">
                                    <span>{item.legs.length} legs | {modeAdjustments[item.mode]?.label} | {item.analysis?.trueProb ?? '?'}%</span>
                                    {item.grade?.status === 'graded' ? (
                                        <span className={item.grade.hit ? 'text-emerald-400' : 'text-rose-400'}>{item.grade.hit ? 'hit' : 'miss'}</span>
                                    ) : (
                                        <span className="flex gap-1">
                                            <button onClick={() => gradeScenario(item.id, true)} className="px-1 rounded bg-emerald-500/10 text-emerald-300">H</button>
                                            <button onClick={() => gradeScenario(item.id, false)} className="px-1 rounded bg-rose-500/10 text-rose-300">M</button>
                                            <button
                                                onClick={async () => {
                                                    const res = await fetch(`/api/forecaster/ledger/${encodeURIComponent(item.id)}/auto-grade`, { method: 'POST' });
                                                    const data = res.ok ? await res.json() : null;
                                                    if (data?.success) {
                                                        setLedger(prev => prev.map(row => row.id === item.id ? data.entry : row));
                                                        setCalibration(data.calibration || null);
                                                    }
                                                }}
                                                className="px-1 rounded bg-indigo-500/10 text-indigo-300"
                                            >
                                                A
                                            </button>
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
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
                            line: prediction.expectedValue,
                            side: 'over',
                            odds: 1.91, // Default market reference until real line data is attached.
                            modelProb: prediction.confidenceScore || 0.55,
                            confidenceScore: prediction.confidenceScore || 0.55,
                            volatility: prediction.volatility || 'MEDIUM',
                            sampleSize: comparables.length,
                            sourceStatus: comparables.length ? 'partial-stats-attached' : 'needs-live-stats',
                            dataFreshness: result.isBase === false ? 'web-consensus' : 'base-model',
                            dataSources: [
                                result.isBase === false ? 'web-consensus' : 'base-model',
                                comparables.length ? 'comparables' : 'needs-live-stats'
                            ],
                            sourceProof: {
                                context: interpretation.context,
                                drivers: reasoning.keyDrivers || [],
                                comparables
                            }
                        })}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all hover:scale-105"
                    >
                        <Layers size={14} /> Add to Simulator
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

                    {/* Source / Proof Panel */}
                    <div className="glass-panel p-6 rounded-xl">
                        <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Database size={16} className="text-emerald-500" /> Source Proof
                        </h3>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                                <div className="text-[9px] text-slate-500 uppercase font-bold">Sample</div>
                                <div className="text-lg font-mono font-bold text-white">{comparables.length || 0}</div>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                                <div className="text-[9px] text-slate-500 uppercase font-bold">Freshness</div>
                                <div className="text-lg font-mono font-bold text-emerald-400">{result.timestamp ? 'Live' : 'Unknown'}</div>
                            </div>
                        </div>
                        <div className="space-y-2 text-[10px] text-slate-400">
                            <div className="flex justify-between gap-3">
                                <span className="text-slate-600 uppercase">Context</span>
                                <span className="text-right">{interpretation.context || 'Unavailable'}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                                <span className="text-slate-600 uppercase">Model</span>
                                <span className="text-right">{result.modelId || 'FORECASTER'}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                                <span className="text-slate-600 uppercase">Range</span>
                                <span className="text-right">{prediction.range?.low ?? '?'} - {prediction.range?.high ?? '?'}</span>
                            </div>
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

const SimulationFeedView = ({ feed, meta, isLoading, onRefresh }) => (
    <div className="space-y-6 animate-in fade-in zoom-in duration-300">
        <div className="flex items-end justify-between">
            <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Simulation Evidence Feed</h2>
                <p className="text-slate-400 text-xs mt-1">Read-only simulation context from SOMA ledgers. Evidence only, not live picks.</p>
            </div>
            <button
                onClick={onRefresh}
                disabled={isLoading}
                className="px-3 py-1.5 bg-cyan-600/10 hover:bg-cyan-600/20 rounded text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-500/30 flex items-center gap-2 disabled:opacity-50"
            >
                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh
            </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
                ['Total', meta?.counts?.total ?? 0],
                ['Market Lab', meta?.counts?.market ?? 0],
                ['Simulation Suite', meta?.counts?.simulations ?? 0],
                ['Code Trials', meta?.counts?.code ?? 0],
            ].map(([label, value]) => (
                <div key={label} className="glass-panel p-3 rounded-xl border border-white/5">
                    <div className="text-[9px] text-slate-600 uppercase font-bold tracking-widest">{label}</div>
                    <div className="text-lg font-mono text-white">{value}</div>
                </div>
            ))}
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <div className="font-bold uppercase tracking-widest text-[10px] mb-1">Boundary</div>
            {meta?.policy?.notice || 'Simulation feed is evidence only. It does not execute trades or create forecasts by itself.'}
        </div>

        {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-600">
                <RefreshCw className="animate-spin" size={28} />
                <div className="text-xs uppercase tracking-widest">Loading simulation ledgers...</div>
            </div>
        )}

        {!isLoading && feed.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-600">
                <Database size={32} className="opacity-40" />
                <div className="text-xs uppercase tracking-widest">No simulation evidence found</div>
            </div>
        )}

        <div className="space-y-3">
            {feed.map(item => {
                const confidence = Number(item.confidence);
                const confidenceText = Number.isFinite(confidence)
                    ? `${(confidence <= 1 ? confidence * 100 : confidence).toFixed(0)}%`
                    : 'n/a';
                const itemTime = item.timestamp || item.updatedAt || item.createdAt;
                const statusTone = item.status === 'promoted' || item.status === 'candidate' || item.status === 'developed_patch'
                    ? 'text-emerald-300 border-emerald-500/20 bg-emerald-500/8'
                    : item.status === 'rejected' || item.status === 'patch_rejected'
                    ? 'text-rose-300 border-rose-500/20 bg-rose-500/8'
                    : 'text-slate-300 border-white/8 bg-slate-900/60';
                return (
                    <div key={`${item.source}-${item.id}`} className={`rounded-xl border p-4 ${statusTone}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-cyan-300">{item.source}</span>
                                    <span className="text-[10px] uppercase tracking-widest text-slate-500">{item.kind}</span>
                                    <span className="text-[9px] px-2 py-0.5 rounded bg-black/20 border border-white/10 uppercase font-bold">{item.status}</span>
                                </div>
                                <h3 className="text-sm font-bold text-white mt-1 truncate">{item.title}</h3>
                                {item.target && <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">target: {item.target}</div>}
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-[9px] uppercase tracking-widest text-slate-600">Confidence</div>
                                <div className="text-lg font-mono text-white">{confidenceText}</div>
                            </div>
                        </div>

                        {item.metrics && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                                {Object.entries(item.metrics).filter(([, value]) => value !== undefined && value !== null).slice(0, 4).map(([key, value]) => (
                                    <div key={key} className="rounded bg-black/20 border border-white/5 px-2 py-1.5">
                                        <div className="text-[8px] text-slate-600 uppercase tracking-wider">{key}</div>
                                        <div className="text-[10px] font-mono text-slate-300">{String(value)}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {item.evidence?.length > 0 && (
                            <div className="mt-3 space-y-1">
                                {item.evidence.slice(0, 5).map((line, i) => (
                                    <div key={i} className="flex items-start gap-2 text-[10px] text-slate-400">
                                        <FileText size={11} className="text-slate-600 shrink-0 mt-0.5" />
                                        <span>{String(line)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="mt-3 flex items-center justify-between text-[9px] text-slate-600 font-mono">
                            <span className="truncate">{item.sourceLedger}</span>
                            <span>{itemTime ? new Date(itemTime).toLocaleString() : 'undated'}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

const OracleView = ({ games, dossier, isLoading, activeGuesses }) => {
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

                {/* SOMA's Autonomous Active Picks */}
                {activeGuesses.length > 0 && (
                    <div className="glass-panel p-6 rounded-2xl border-indigo-500/20 bg-indigo-900/5 shadow-[0_0_50px_rgba(99,102,241,0.05)] mt-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                            <BrainCircuit size={100} />
                        </div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
                            <Zap size={20} className="text-emerald-400" /> SOMA's Active Picks
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                            {activeGuesses.map((guess, idx) => (
                                <div key={idx} className="bg-[#09090b]/80 border border-white/5 rounded-xl p-5 hover:border-indigo-500/30 transition-colors">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{guess.sport || 'SPORTS'}</div>
                                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                            guess.confidence === 'HIGH' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                                            guess.confidence === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                                            'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                        }`}>
                                            {guess.confidence} CONFIDENCE
                                        </div>
                                    </div>
                                    <div className="text-lg font-bold text-white mb-2">{guess.matchup}</div>
                                    <div className="flex items-center gap-2 text-sm text-slate-300 mb-4">
                                        <Target size={14} className="text-slate-500" />
                                        Prediction: <span className="text-white font-medium">{guess.prediction}</span>
                                    </div>
                                    <div className="flex justify-between items-end border-t border-white/5 pt-4 mt-auto">
                                        <div>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Win Prob</div>
                                            <div className="text-lg font-mono text-emerald-400">{(guess.win_probability * 100).toFixed(1)}%</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Calculated Edge</div>
                                            <div className={`text-lg font-mono ${guess.calculatedEdge > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                {guess.calculatedEdge > 0 ? '+' : ''}{guess.calculatedEdge?.toFixed(1) || '0.0'}%
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

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
    const [gameSource, setGameSource] = useState({ source: 'loading', detail: 'Checking current schedule source.' });
    
    // Query interface states
    const [query, setQuery] = useState('');
    const [isQuerying, setIsQuerying] = useState(false);
    const [forecastResult, setForecastResult] = useState(null);
    const useConsensus = true; // Always use web consensus
    const [isEnhancing, setIsEnhancing] = useState(false); // Background consensus enhancement
    const [scrapingStatus, setScrapingStatus] = useState(''); // Track scraping progress
    const [slipText, setSlipText] = useState('');
    const [slipParseResult, setSlipParseResult] = useState(null);
    const [performance, setPerformance] = useState(null);
    const [simulationFeed, setSimulationFeed] = useState([]);
    const [simulationFeedMeta, setSimulationFeedMeta] = useState(null);
    const [isSimulationFeedLoading, setIsSimulationFeedLoading] = useState(false);
    
    // Oracle State
    const [oracleDossier, setOracleDossier] = useState(null);
    const [isOracleLoading, setIsOracleLoading] = useState(false);

    // Active Autonomous Guesses
    const [activeGuesses, setActiveGuesses] = useState([]);

    // Parlay Simulator State
    const [parlayLegs, setParlayLegs] = useState([]);

    const addToParlay = (leg) => {
        setParlayLegs(prev => [...prev, leg]);
    };

    const removeLeg = (index) => {
        setParlayLegs(prev => prev.filter((_, i) => i !== index));
    };

    const updateParlayLeg = (index, patch) => {
        setParlayLegs(prev => prev.map((leg, i) => i === index ? { ...leg, ...patch } : leg));
    };

    const clearParlay = () => setParlayLegs([]);

    const handleSlipAnalyze = () => {
        const parsed = parseSlipText(slipText);
        setSlipParseResult(parsed);
        if (parsed.legs.length) {
            setParlayLegs(prev => [...prev, ...parsed.legs]);
        }
    };

    // Real-time data ingestion
    useEffect(() => {
        const loadGames = async () => {
            try {
                const result = await fetchLiveGames();
                if (result?.games?.length > 0) {
                    setGames(result.games);
                    setGameSource({ source: result.source, detail: result.detail });
                }
            } catch (err) {
                console.error("[Forecaster] Failed to load live games:", err);
                setGameSource({ source: 'error', detail: 'Game source unavailable.' });
            }
        };

        loadGames(); // Initial load
        const pollInterval = setInterval(loadGames, 30000); // Poll every 30s for real updates

        return () => {
            clearInterval(pollInterval);
        };
    }, []);

    useEffect(() => {
        fetch('/api/forecaster/performance')
            .then(res => res.json())
            .then(data => data.success && setPerformance(data.performance))
            .catch(() => {});
    }, []);

    const loadSimulationFeed = async () => {
        setIsSimulationFeedLoading(true);
        try {
            const res = await fetch('/api/forecaster/simulation-feed?limit=40');
            const data = await res.json();
            if (res.ok && data.success) {
                setSimulationFeed(data.feed || []);
                setSimulationFeedMeta({ counts: data.counts, policy: data.policy, generatedAt: data.generatedAt });
            }
        } catch (error) {
            console.warn('[Forecaster] Simulation feed unavailable:', error.message);
        } finally {
            setIsSimulationFeedLoading(false);
        }
    };

    useEffect(() => {
        loadSimulationFeed();
        const t = setInterval(loadSimulationFeed, 30000);
        return () => clearInterval(t);
    }, []);

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
                setOracleDossier(data.forecast || data.dossier); // { matchup, prediction, confidence, details }
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

        if (activeTab === 'simulations') {
            return (
                <SimulationFeedView
                    feed={simulationFeed}
                    meta={simulationFeedMeta}
                    isLoading={isSimulationFeedLoading}
                    onRefresh={loadSimulationFeed}
                />
            );
        }

        // 1. Oracle View
        if (activeTab === 'oracle') {
            return <OracleView games={games} dossier={oracleDossier} isLoading={isOracleLoading} activeGuesses={activeGuesses} />;
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
                        <div className="mt-4 flex justify-center items-center gap-2 opacity-80">
                            <Database size={10} className={gameSource.source === 'espn' ? 'text-emerald-400' : 'text-amber-400'} />
                            <span className={`text-[9px] uppercase tracking-widest ${gameSource.source === 'espn' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {gameSource.source === 'espn' ? 'Schedule source: ESPN proxy' : 'Sample data - simulation only'}
                            </span>
                            <span className="text-[9px] text-slate-500 normal-case" title={gameSource.detail}>{gameSource.detail}</span>
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
                        <h1 className="text-4xl font-black text-white tracking-tight">Forecast OS</h1>
                        <p className="text-sm text-slate-500 max-w-xl mx-auto">
                            Ask for a projection, paste a slip, simulate the structure, then save it for grading.
                        </p>

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

                        <div className="grid grid-cols-5 gap-2 text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                            {['Ask', 'Analyze', 'Simulate', 'Optimize', 'Grade'].map((step, idx) => (
                                <div key={step} className="py-2 rounded-lg bg-white/5 border border-white/5">
                                    {idx + 1}. {step}
                                </div>
                            ))}
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

                <div className="glass-panel rounded-2xl border-white/5 p-5">
                    <div className="flex items-center justify-between gap-4 mb-4">
                        <div>
                            <div className="flex items-center gap-2 text-indigo-400">
                                <FileText size={16} />
                                <span className="text-xs font-bold uppercase tracking-[0.2em]">Paste Slip Analyzer</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">Paste lines from a slip and SOMA converts them into simulator legs.</p>
                        </div>
                        <button
                            onClick={handleSlipAnalyze}
                            disabled={!slipText.trim()}
                            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[10px] font-bold uppercase tracking-widest"
                        >
                            Add to Simulator
                        </button>
                    </div>
                    <textarea
                        value={slipText}
                        onChange={(e) => setSlipText(e.target.value)}
                        placeholder={`Example:\nPatrick Mahomes over 264.5 passing yards -110\nTravis Kelce over 58.5 receiving yards +105\nChiefs moneyline -135`}
                        className="w-full min-h-24 resize-y rounded-xl bg-[#0E0E11] border border-white/10 p-4 text-xs text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/50"
                    />
                    {slipParseResult && (
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                            <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                Parsed {slipParseResult.legs.length} leg(s)
                            </span>
                            {slipParseResult.unparsed.length > 0 && (
                                <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    {slipParseResult.unparsed.length} line(s) need review
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="glass-panel rounded-2xl border-white/5 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-emerald-400">
                            <BarChart3 size={16} />
                            <span className="text-xs font-bold uppercase tracking-[0.2em]">Forecast Performance</span>
                        </div>
                        <span className="text-[10px] text-slate-600 uppercase">
                            {performance?.dataQuality?.gradedEntries || 0} graded / {performance?.dataQuality?.ledgerEntries || 0} saved
                        </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Hit Rate</div>
                            <div className="text-lg font-mono text-white">{performance?.calibration?.hitRate ?? 'N/A'}{performance?.calibration?.hitRate != null ? '%' : ''}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Avg Pred</div>
                            <div className="text-lg font-mono text-indigo-300">{performance?.calibration?.avgPredicted ?? 'N/A'}{performance?.calibration?.avgPredicted != null ? '%' : ''}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Brier</div>
                            <div className="text-lg font-mono text-emerald-300">{performance?.calibration?.brierScore ?? 'N/A'}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Status</div>
                            <div className="text-xs text-slate-400 mt-1">{performance?.dataQuality?.note || 'No graded data yet.'}</div>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Backtest MAE</div>
                            <div className="text-lg font-mono text-amber-300">{performance?.backtest?.summary?.meanAbsoluteError ?? 'N/A'}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Learning Adj</div>
                            <div className="text-lg font-mono text-fuchsia-300">
                                {Number.isFinite(Number(performance?.learning?.global?.adjustment)) ? `${performance.learning.global.adjustment > 0 ? '+' : ''}${performance.learning.global.adjustment}%` : 'N/A'}
                            </div>
                        </div>
                        <div className="p-3 rounded-lg bg-slate-950/70 border border-white/5">
                            <div className="text-[9px] text-slate-600 uppercase font-bold">Learning Mode</div>
                            <div className="text-xs text-slate-400 mt-1">{performance?.learning?.note || 'Waiting on graded outcomes.'}</div>
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
                        { id: 'simulations', label: 'Sim Feed', icon: Database },
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

            <ParlaySidebar legs={parlayLegs} onRemove={removeLeg} onClear={clearParlay} onUpdateLeg={updateParlayLeg} />
        </div>
    );
}
