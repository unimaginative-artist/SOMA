/**
 * SimIntelPanel.jsx
 *
 * Mission Control sidebar panel that surfaces SOMA's simulation training data.
 * Shows evaluator stats, graduated playbook, evolved protocols, and correlation
 * matrix. "Deploy" button loads a trained preset as the active strategy set.
 */

import React, { useState, useEffect } from 'react';
import { CheckCircle2, FlaskConical, Trophy, Dna, Zap, ChevronDown, ChevronUp, XCircle, Database } from 'lucide-react';

const fmt = (n, d = 3) => n == null ? '—' : typeof n === 'number' ? n.toFixed(d) : n;
const pct  = n => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const scoreColor = s => s >= 0.75 ? 'text-emerald-400' : s >= 0.60 ? 'text-amber-400' : 'text-zinc-400';

function ReportCardBadge({ card }) {
    if (!card) return null;
    const color = card.graduateEligible
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : card.grade === 'B' || card.grade === 'C'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    return (
        <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold ${color}`}>
            {card.grade} · {card.passedGates}/{card.totalGates}
        </span>
    );
}

function ReportCardDetails({ card }) {
    const [open, setOpen] = useState(false);
    if (!card) return null;

    return (
        <div className="mt-1.5">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex w-full items-center justify-between rounded border border-white/5 bg-black/20 px-2 py-1 text-left hover:bg-white/5"
            >
                <span className="text-[9px] text-zinc-500">{card.summary}</span>
                {open ? <ChevronUp className="h-3 w-3 text-zinc-500" /> : <ChevronDown className="h-3 w-3 text-zinc-500" />}
            </button>
            {open && (
                <div className="mt-1.5 space-y-1">
                    {(card.gates || []).map(gate => (
                        <div key={gate.id} className="flex items-center gap-1.5 rounded bg-black/25 px-2 py-1">
                            {gate.passed
                                ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                                : <XCircle className="h-3 w-3 shrink-0 text-amber-400" />}
                            <span className="min-w-[82px] text-[8px] font-bold uppercase text-zinc-500">{gate.label}</span>
                            <span className="truncate text-[8px] text-zinc-400">{gate.detail}</span>
                        </div>
                    ))}
                    <div className="rounded border border-cyan-500/10 bg-cyan-500/5 px-2 py-1 text-[9px] leading-snug text-cyan-200">
                        {card.nextAction}
                    </div>
                </div>
            )}
        </div>
    );
}

function CorrelationHeatmap({ matrix }) {
    const ids = Object.keys(matrix).slice(0, 8);
    if (!ids.length) return null;

    return (
        <div className="mt-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">Correlation Matrix</p>
            <div className="overflow-x-auto">
                <table className="text-[8px] font-mono border-collapse">
                    <thead>
                        <tr>
                            <th className="w-8" />
                            {ids.map(id => <th key={id} className="w-8 pb-1 text-zinc-500 font-normal">{id}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {ids.map(rowId => (
                            <tr key={rowId}>
                                <td className="pr-1 text-zinc-500 text-right">{rowId}</td>
                                {ids.map(colId => {
                                    if (rowId === colId) return <td key={colId} className="w-8 h-4 text-center bg-zinc-800/60 text-zinc-600">1.0</td>;
                                    const c = matrix[rowId]?.[colId];
                                    if (c == null) return <td key={colId} className="w-8 h-4 text-center bg-zinc-900 text-zinc-700">—</td>;
                                    const intensity = Math.abs(c);
                                    const bg = c > 0
                                        ? `rgba(16,185,129,${intensity * 0.5})`
                                        : `rgba(239,68,68,${intensity * 0.5})`;
                                    return (
                                        <td key={colId} className="w-8 h-4 text-center" style={{ backgroundColor: bg }}>
                                            <span className={c > 0.5 ? 'text-emerald-300' : c < -0.5 ? 'text-rose-300' : 'text-zinc-400'}>
                                                {c.toFixed(1)}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function EvolvedList({ evolved }) {
    const [open, setOpen] = useState(false);
    if (!evolved?.length) return null;

    return (
        <div className="mt-3">
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-fuchsia-500 hover:text-fuchsia-300 transition-colors"
            >
                <Dna className="w-3 h-3" />
                {evolved.length} Evolved Protocols
                {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {open && (
                <div className="mt-1.5 space-y-1">
                    {evolved.map(p => (
                        <div key={p.id} className="flex items-center gap-2 text-[9px] font-mono bg-fuchsia-900/20 border border-fuchsia-500/20 rounded px-2 py-1">
                            <span className="text-fuchsia-400">{p.id}</span>
                            <span className="text-zinc-600 ml-auto">←{p.parent}</span>
                            <span className="text-zinc-500">sz:{p.sizePct}</span>
                            <span className="text-zinc-500">tp:{p.takeProfit}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function SimIntelPanel({ onDeployStrategies }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [deployMsg, setDeployMsg] = useState('');
    const [showCorr, setShowCorr] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/soma/simulations/playbook-mc');
                if (res.ok) setData(await res.json());
            } catch {}
            setLoading(false);
        };
        load();
        const t = setInterval(load, 15_000);
        return () => clearInterval(t);
    }, []);

    const handleDeploy = () => {
        if (!data?.presets?.length || !onDeployStrategies) return;
        onDeployStrategies(data.presets);
        setDeployMsg(`Deployed ${data.presets.length} trained strategies`);
        setTimeout(() => setDeployMsg(''), 3000);
    };

    if (loading) return (
        <div className="flex items-center justify-center p-8 text-zinc-600 text-xs">
            Loading sim intel...
        </div>
    );

    if (!data?.online) return (
        <div className="p-4 text-center">
            <FlaskConical className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
            <p className="text-xs text-zinc-600">Simulation Evaluator not online</p>
            <p className="text-[10px] text-zinc-700 mt-1">Run SOMA and visit the Simulation tab to start training</p>
        </div>
    );

    const stats = data.stats || {};
    const playbook = data.playbook || [];
    const presets = data.presets || [];
    const evolved  = data.evolved || [];
    const corrMatrix = data.correlation || {};
    const deepScans = data.deepScans || [];
    const deepScanSummary = data.deepScanSummary || {};

    return (
        <div className="p-3 space-y-4 text-xs overflow-y-auto h-full custom-scrollbar">

            {/* Stats bar */}
            <div className="grid grid-cols-2 gap-2">
                {[
                    { label: 'Episodes',  value: stats.totalEpisodes?.toLocaleString() ?? '—', color: 'text-emerald-400' },
                    { label: 'Trades',    value: stats.totalTrades?.toLocaleString()   ?? '—', color: 'text-blue-400'    },
                    { label: 'Graduated', value: stats.graduated ?? '—',                       color: 'text-amber-400'   },
                    { label: 'Evolved',   value: stats.evolvedProtocols ?? '—',                color: 'text-fuchsia-400' },
                ].map(({ label, value, color }) => (
                    <div key={label} className="bg-black/30 border border-white/5 rounded p-2 text-center">
                        <div className="text-[8px] text-zinc-600 uppercase tracking-wider">{label}</div>
                        <div className={`font-mono text-sm font-bold ${color}`}>{value}</div>
                    </div>
                ))}
            </div>

            {/* Deploy button */}
            {presets.length > 0 && (
                <div>
                    <button
                        onClick={handleDeploy}
                        className="w-full py-2 rounded bg-gradient-to-r from-emerald-600/80 to-teal-600/80 hover:from-emerald-500 hover:to-teal-500 transition-all text-white text-[11px] font-bold tracking-wide flex items-center justify-center gap-1.5"
                    >
                        <Zap className="w-3.5 h-3.5" />
                        Deploy Top {Math.min(presets.length, 10)} Strategies
                    </button>
                    {deployMsg && (
                        <div className="mt-1.5 text-center text-[10px] text-emerald-400 animate-pulse">{deployMsg}</div>
                    )}
                </div>
            )}

            {/* Deep scan feedback loop */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                            Deep Scan Feedback
                        </span>
                    </div>
                    <span className="text-[8px] text-zinc-600">{deepScanSummary.total || 0} stored</span>
                </div>
                {deepScans.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 text-center py-3 border border-dashed border-zinc-800 rounded">
                        Run Deep Scan to seed simulation memory
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {deepScans.slice(0, 5).map(scan => (
                            <div key={scan.id} className="rounded border border-cyan-500/10 bg-cyan-950/10 px-2.5 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-bold text-white text-[10px]">{scan.symbol}</span>
                                    <span className={`text-[9px] font-bold ${/BUY/i.test(scan.verdict?.recommendation || '') ? 'text-emerald-400' : /SELL/i.test(scan.verdict?.recommendation || '') ? 'text-rose-400' : 'text-zinc-400'}`}>
                                        {scan.verdict?.recommendation || 'SCAN'}
                                    </span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between text-[8px] text-zinc-600">
                                    <span>{scan.simulationContext?.matchedRuns || 0} sim matches</span>
                                    <span>{Math.round((scan.verdict?.confidence || 0) * 100)}% confidence</span>
                                </div>
                                {scan.simulationContext?.bestStrategy && (
                                    <div className="mt-1 text-[8px] text-cyan-300/80 truncate">
                                        sim: {scan.simulationContext.bestStrategy.name || scan.simulationContext.bestStrategy.id}
                                        {' '}score {fmt(scan.simulationContext.bestStrategy.prometheusScore)}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Graduated playbook */}
            <div>
                <div className="flex items-center gap-1.5 mb-2">
                    <Trophy className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                        Graduated Playbook ({playbook.length})
                    </span>
                </div>
                {playbook.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 text-center py-3 border border-dashed border-zinc-800 rounded">
                        Training in progress — check back soon
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {playbook.slice(0, 15).map((entry, i) => (
                            <div key={entry.assetId + entry.protocolId + i}
                                className={`rounded border px-2.5 py-1.5 ${entry.evolved ? 'border-fuchsia-500/30 bg-fuchsia-900/10' : 'border-white/5 bg-black/20'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-mono font-bold text-white text-[10px]">{entry.assetId}</span>
                                        <span className="text-zinc-500">·</span>
                                        <span className="text-zinc-400 text-[9px]">
                                            {entry.evolved ? `${entry.evolvedFrom}→ev` : entry.protocolId}
                                        </span>
                                        {entry.evolved && <Dna className="w-2.5 h-2.5 text-fuchsia-400" />}
                                    </div>
                                    <span className={`font-mono font-bold text-[11px] ${scoreColor(entry.score)}`}>
                                        {fmt(entry.score)}
                                    </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2">
                                    <ReportCardBadge card={entry.reportCard} />
                                    {entry.reportCard && (
                                        <span className={`text-[8px] font-bold uppercase ${entry.reportCard.graduateEligible ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            {entry.reportCard.graduateEligible ? 'paper candidate' : 'blocked'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-3 mt-0.5 text-[8px] font-mono text-zinc-600">
                                    <span>WR {pct(entry.winRate)}</span>
                                    <span>SR {fmt(entry.sharpe, 2)}</span>
                                    <span>DD {pct(entry.maxDrawdown)}</span>
                                    <span>{entry.episodes}ep</span>
                                </div>
                                {entry.correlatedWith?.length > 0 && (
                                    <div className="mt-0.5 text-[8px] text-zinc-700">
                                        corr: {entry.correlatedWith.map(c => `${c.id}(${c.correlation > 0 ? '+' : ''}${c.correlation})`).join(' ')}
                                    </div>
                                )}
                                <ReportCardDetails card={entry.reportCard} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Evolved protocols */}
            <EvolvedList evolved={evolved} />

            {/* Correlation matrix toggle */}
            {Object.keys(corrMatrix).length > 0 && (
                <div>
                    <button
                        onClick={() => setShowCorr(c => !c)}
                        className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                        <BarChart2 className="w-3 h-3" />
                        Asset Correlations
                        {showCorr ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showCorr && <CorrelationHeatmap matrix={corrMatrix} />}
                </div>
            )}

        </div>
    );
}
