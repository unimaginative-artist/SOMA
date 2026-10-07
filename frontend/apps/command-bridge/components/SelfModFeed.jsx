import React, { useState, useEffect, useCallback } from 'react';
import { Wrench, AlertTriangle, Archive, ShieldCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import somaBackend from '../somaBackend';

const STATE_LABEL = {
    '/':  { label: 'TRUE',      color: 'text-emerald-400' },
    '|':  { label: 'UNCERTAIN', color: 'text-amber-400'   },
    '\\': { label: 'FALSE',     color: 'text-red-400'     },
};

function PoseidonGlyph({ state }) {
    const s = STATE_LABEL[state] || STATE_LABEL['|'];
    return <span className={`font-mono font-bold text-sm ${s.color}`} title={s.label}>{state}</span>;
}

function NemesisStatus({ nemesis }) {
    if (!nemesis) return null;
    return (
        <div className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-red-950/30 border border-red-900/30 mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <div className="min-w-0">
                <span className="text-red-300 text-[11px] font-bold uppercase tracking-wider">NEMESIS</span>
                {nemesis.totalEvals != null && <span className="text-zinc-500 text-[10px] ml-2">{nemesis.totalEvals} evaluations</span>}
            </div>
            <div className={`ml-auto text-[10px] font-bold ${nemesis.online ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {nemesis.online ? (nemesis.avgScore != null ? `${Number(nemesis.avgScore).toFixed(2)} AVG` : 'ACTIVE') : 'OFFLINE'}
            </div>
        </div>
    );
}

// Mini SVG sparkline for score history
function ScoreSparkline({ scoreHistory }) {
    if (!scoreHistory?.length) return null;
    const W = 120, H = 28, PAD = 2;
    const scores = scoreHistory.map(s => s.score);
    const min = 0, max = 1;
    const pts = scores.map((s, i) => {
        const x = PAD + (i / Math.max(scores.length - 1, 1)) * (W - PAD * 2);
        const y = PAD + (1 - (s - min) / (max - min)) * (H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const last  = scores[scores.length - 1];
    const first = scores[0];
    const trending = last > first + 0.05 ? 'up' : last < first - 0.05 ? 'down' : 'flat';
    const lineColor = trending === 'up' ? '#34d399' : trending === 'down' ? '#f87171' : '#a1a1aa';
    const TrendIcon = trending === 'up' ? TrendingUp : trending === 'down' ? TrendingDown : Minus;

    return (
        <div className="flex items-center space-x-2">
            <svg width={W} height={H} className="shrink-0">
                {/* threshold line at 0.70 */}
                <line
                    x1={PAD} y1={PAD + (1 - 0.70) * (H - PAD * 2)}
                    x2={W - PAD} y2={PAD + (1 - 0.70) * (H - PAD * 2)}
                    stroke="#52525b" strokeWidth="0.5" strokeDasharray="2,2"
                />
                <polyline
                    points={pts}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                {/* last point dot */}
                {scores.length > 0 && (() => {
                    const i = scores.length - 1;
                    const x = PAD + (i / Math.max(scores.length - 1, 1)) * (W - PAD * 2);
                    const y = PAD + (1 - (last - min) / (max - min)) * (H - PAD * 2);
                    return <circle cx={x} cy={y} r="2" fill={lineColor} />;
                })()}
            </svg>
            <div className="flex flex-col items-end">
                <TrendIcon className={`w-3 h-3`} style={{ color: lineColor }} />
                <span className="text-[10px] font-mono" style={{ color: lineColor }}>
                    {last?.toFixed(2)}
                </span>
            </div>
        </div>
    );
}

export default function SelfModFeed({ isConnected }) {
    const [status, setStatus]               = useState(null);
    const [nemesis, setNemesis]             = useState(null);
    const [showContested, setShowContested] = useState(false);
    const [error, setError]                 = useState(null);

    const fetchAll = useCallback(async () => {
        if (!isConnected) return;
        try {
            const [smRes, nRes] = await Promise.allSettled([
                somaBackend.fetch('/api/soma/selfmod/status'),
                somaBackend.fetch('/api/soma/nemesis/status')
            ]);
            if (smRes.status === 'fulfilled') {
                setStatus(smRes.value);
                setError(null);
            }
            if (nRes.status === 'fulfilled') setNemesis(nRes.value);
            if (smRes.status === 'rejected') setError(smRes.reason?.message || 'Self-modification status unavailable');
        } catch (e) {
            setError(e.message);
        }
    }, [isConnected]);

    useEffect(() => {
        fetchAll();
        const id = setInterval(fetchAll, 20000);
        return () => clearInterval(id);
    }, [fetchAll]);

    const entries   = status?.recentEntries ?? [];
    const contested = status?.contested     ?? [];

    // Rolling average from trend data
    const latestAvg = status?.trend?.at(-1)?.avg;

    return (
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-zinc-100 font-semibold text-sm flex items-center uppercase tracking-wider">
                    <Wrench className="w-4 h-4 mr-2 text-fuchsia-400" /> Self-Modifications
                </h3>
                <div className="flex items-center space-x-3 text-[10px] text-zinc-500">
                    {status && (
                        <>
                            <span className="text-emerald-400">{status.implemented} passed</span>
                            <span>·</span>
                            <button
                                onClick={() => setShowContested(s => !s)}
                                className={`flex items-center space-x-1 hover:text-amber-400 transition-colors ${showContested ? 'text-amber-400' : ''}`}
                            >
                                <Archive className="w-3 h-3" />
                                <span>{status.contestedCount} shelved</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            <NemesisStatus nemesis={nemesis} />

            {/* Score trend row */}
            {status?.scoreHistory?.length > 0 && (
                <div className="flex items-center justify-between px-1 mb-3">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
                        NEMESIS score trend
                        {latestAvg != null && (
                            <span className={`ml-2 font-mono font-bold ${latestAvg >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                7-avg {latestAvg.toFixed(2)}
                            </span>
                        )}
                    </div>
                    <ScoreSparkline scoreHistory={status.scoreHistory} />
                </div>
            )}

            {!isConnected && <p className="text-zinc-500 text-xs text-center py-4">Offline</p>}
            {isConnected && !status && !error && <p className="text-zinc-500 text-xs text-center py-4 animate-pulse">Loading...</p>}
            {error && <p className="text-red-400 text-xs text-center py-4">{error}</p>}

            {status && (
                <div className="space-y-1 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {!showContested && entries.length === 0 && (
                        <p className="text-zinc-600 text-xs text-center py-4">No modifications yet</p>
                    )}

                    {!showContested && entries.map(e => (
                        <div key={e.id} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0 space-x-2">
                            <div className="flex items-center space-x-2 min-w-0">
                                <PoseidonGlyph state={e.poseidon} />
                                <span className="text-zinc-300 truncate font-mono text-[11px]">{e.filepath}</span>
                            </div>
                            <div className="flex items-center space-x-2 shrink-0 text-zinc-500">
                                {e.nemesisScore != null && (
                                    <span className={`font-mono ${e.nemesisScore >= 0.7 ? 'text-emerald-500' : 'text-red-400'}`}>
                                        ⚔{e.nemesisScore.toFixed(2)}
                                    </span>
                                )}
                                <span>{e.rounds}r</span>
                            </div>
                        </div>
                    ))}

                    {showContested && contested.length === 0 && (
                        <p className="text-zinc-600 text-xs text-center py-4">No contested changes</p>
                    )}

                    {showContested && contested.map(e => (
                        <div key={e.id} className="text-xs py-2 border-b border-white/5 last:border-0">
                            <div className="flex items-center space-x-2">
                                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                <span className="text-zinc-300 font-mono truncate">{e.filepath}</span>
                            </div>
                            {e.reason && <p className="text-zinc-600 mt-1 pl-5 truncate">{e.reason}</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
