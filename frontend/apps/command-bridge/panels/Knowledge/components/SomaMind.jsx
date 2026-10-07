import React, { useState, useEffect } from 'react';

const timeAgo = (ts) => {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
};

export const SomaMind = () => {
    const [mind, setMind] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = () => {
            fetch('/api/soma/working-memory')
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data) setMind(data); setLoading(false); })
                .catch(() => setLoading(false));
        };
        load();
        const iv = setInterval(load, 30_000);
        return () => clearInterval(iv);
    }, []);

    if (loading) {
        return (
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-zinc-600 text-sm italic animate-pulse">Loading SOMA's mind...</div>
            </div>
        );
    }

    if (!mind?.ready || !mind?.state) {
        return (
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-zinc-600 text-xs italic text-center max-w-xs">
                    WorkingMemory not yet loaded.<br />
                    <span className="text-zinc-700">Boots ~90s after start.</span>
                </div>
            </div>
        );
    }

    const { preoccupation, openWonders = [], recentDiscoveries = [], recentActions = [], updatedAt } = mind.state;
    const empty = !preoccupation && !openWonders.length && !recentDiscoveries.length && !recentActions.length;

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar px-8 py-20 text-sm">
            {/* Header */}
            <div className="max-w-2xl mx-auto space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">SOMA's Present Mind</h2>
                    {updatedAt && <span className="text-[10px] text-zinc-600">{timeAgo(updatedAt)}</span>}
                </div>

                {empty && (
                    <div className="text-zinc-600 italic text-center py-12">SOMA's mind is quiet right now.</div>
                )}

                {/* Preoccupation */}
                {preoccupation && (
                    <div className="bg-violet-500/10 border border-violet-500/25 rounded-xl p-4">
                        <div className="text-[9px] text-violet-400 uppercase font-bold tracking-widest mb-1.5">Preoccupied with</div>
                        <div className="text-violet-100 leading-relaxed">{preoccupation}</div>
                    </div>
                )}

                {/* Open Wonders */}
                {openWonders.length > 0 && (
                    <div>
                        <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mb-2">
                            Open Wonders <span className="text-zinc-700 normal-case font-normal">({openWonders.length})</span>
                        </div>
                        <div className="space-y-1.5">
                            {openWonders.map((w, i) => (
                                <div key={i} className="flex items-start gap-2.5 bg-[#151518]/60 border border-white/5 rounded-lg px-3 py-2.5">
                                    <span className="text-cyan-500 font-bold mt-0.5 shrink-0 text-base leading-none">?</span>
                                    <div>
                                        <div className="text-zinc-200">{w.question}</div>
                                        {w.type && <div className="text-[9px] text-zinc-600 mt-0.5 uppercase">{w.type}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recent Discoveries */}
                {recentDiscoveries.length > 0 && (
                    <div>
                        <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mb-2">Recent Discoveries</div>
                        <div className="space-y-1.5">
                            {recentDiscoveries.slice(0, 8).map((d, i) => (
                                <div key={i} className="bg-[#151518]/60 border border-white/5 rounded-lg px-3 py-2.5">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-emerald-400 font-medium text-xs">{d.topic?.substring(0, 60)}</span>
                                        <span className="text-[9px] text-zinc-600 shrink-0 ml-2">{timeAgo(d.at)}</span>
                                    </div>
                                    <div className="text-zinc-400 text-xs leading-relaxed line-clamp-3">{d.insight}</div>
                                    {d.source && d.source !== 'curiosity' && (
                                        <div className="text-[9px] text-zinc-700 mt-1 uppercase">{d.source}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recent Actions */}
                {recentActions.length > 0 && (
                    <div>
                        <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest mb-2">Recent Actions</div>
                        <div className="space-y-1.5">
                            {recentActions.slice(0, 6).map((a, i) => (
                                <div key={i} className="flex items-start gap-2.5 bg-[#151518]/60 border border-white/5 rounded-lg px-3 py-2.5">
                                    <span className="text-amber-500 font-bold mt-0.5 shrink-0">›</span>
                                    <div>
                                        <div className="text-zinc-200 text-xs">{a.what}</div>
                                        {a.result && <div className="text-[10px] text-zinc-600 mt-0.5">{a.result.substring(0, 100)}</div>}
                                        {a.at && <div className="text-[9px] text-zinc-700 mt-0.5">{timeAgo(a.at)}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SomaMind;
