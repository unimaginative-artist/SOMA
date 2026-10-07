import React, { useState, useEffect, useCallback } from 'react';
import { Activity, AlertTriangle, CheckCircle, XCircle, Eye, Radio, Cpu, Brain, Layers } from 'lucide-react';
import somaBackend from '../somaBackend';

const LOBE_COLORS = {
    LOGOS: 'text-sky-400',
    AURORA: 'text-fuchsia-400',
    THALAMUS: 'text-amber-400',
    PROMETHEUS: 'text-emerald-400',
    unlobed: 'text-zinc-500',
};

function DaemonRow({ name, d }) {
    const icon = d.circuitBroken
        ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        : d.status === 'running' || d.status === 'active'
            ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            : d.status === 'stopped'
                ? <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;

    return (
        <div className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0">
            <div className="flex items-center space-x-2 min-w-0">
                {icon}
                <span className="text-zinc-300 font-mono truncate">{name}</span>
            </div>
            <div className="flex items-center space-x-2 text-zinc-500 shrink-0 ml-2">
                {(d.restarts ?? d.restartCount) > 0 && (
                    <span className="text-amber-400">↺{d.restarts ?? d.restartCount}</span>
                )}
                <span className="capitalize text-[10px]">
                    {d.circuitBroken ? 'circuit open' : (d.status ?? 'unknown')}
                </span>
            </div>
        </div>
    );
}

function LobeBar({ lobes, total }) {
    if (!lobes || total === 0) return null;
    const lobeNames = ['LOGOS', 'AURORA', 'THALAMUS', 'PROMETHEUS', 'unlobed'];
    return (
        <div className="space-y-1.5">
            {lobeNames.map(lobe => {
                const count = lobes[lobe] ?? 0;
                if (count === 0) return null;
                const pct = Math.round((count / total) * 100);
                return (
                    <div key={lobe} className="flex items-center space-x-2 text-[10px]">
                        <span className={`w-20 shrink-0 font-mono uppercase ${LOBE_COLORS[lobe] ?? 'text-zinc-500'}`}>{lobe}</span>
                        <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${
                                    lobe === 'LOGOS' ? 'bg-sky-500' :
                                    lobe === 'AURORA' ? 'bg-fuchsia-500' :
                                    lobe === 'THALAMUS' ? 'bg-amber-500' :
                                    lobe === 'PROMETHEUS' ? 'bg-emerald-500' :
                                    'bg-zinc-600'
                                }`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <span className="text-zinc-500 w-8 text-right">{count}</span>
                    </div>
                );
            })}
        </div>
    );
}

export default function PerceptionPanel({ isConnected }) {
    const [health, setHealth] = useState(null);
    const [error, setError] = useState(null);

    const fetchHealth = useCallback(async () => {
        if (!isConnected) return;
        try {
            const data = await somaBackend.fetch('/api/perception/health');
            if (data?.success) {
                setHealth(data);
                setError(null);
            } else {
                setError(data?.error || 'Perception status unavailable');
            }
        } catch (e) {
            setError(e.message);
        }
    }, [isConnected]);

    useEffect(() => {
        fetchHealth();
        const id = setInterval(fetchHealth, 15000);
        return () => clearInterval(id);
    }, [fetchHealth]);

    // Support both old (object) and new (array) daemon formats
    const daemonEntries = health?.daemons?.list
        ? health.daemons.list.map(d => [d.name, d])
        : health?.daemons
            ? Object.entries(health.daemons)
            : [];

    const arbiterTotal = health?.arbiters?.total ?? 0;
    const lobes = health?.arbiters?.lobes;
    const heapMB = health?.memory?.heapMB;
    const heapMax = health?.memory?.heapMaxMB;
    const attentionFocus = health?.attention?.focus;
    const attentionEngine = health?.attention?.engine;
    const signalCount = health?.signals?.recentCount ?? 0;

    return (
        <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg">
            <h3 className="text-zinc-100 font-semibold text-sm flex items-center mb-4 uppercase tracking-wider">
                <Eye className="w-4 h-4 mr-2 text-cyan-400" /> Perception Layer
            </h3>

            {!isConnected && (
                <p className="text-zinc-500 text-xs text-center py-4">Offline</p>
            )}
            {isConnected && !health && !error && (
                <p className="text-zinc-500 text-xs text-center py-4 animate-pulse">Loading...</p>
            )}
            {error && (
                <p className="text-red-400 text-xs text-center py-4">{error}</p>
            )}

            {health && (
                <div className="space-y-5">

                    {/* Daemons */}
                    <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-2 flex items-center justify-between">
                            <span>Daemons</span>
                            {health.daemons && (
                                <span className="text-zinc-600">
                                    {health.daemons.active ?? daemonEntries.filter(([,d]) => d.status === 'running' || d.status === 'active').length}/
                                    {health.daemons.total ?? daemonEntries.length}
                                </span>
                            )}
                        </p>
                        {daemonEntries.length > 0
                            ? daemonEntries.map(([name, d]) => <DaemonRow key={name} name={name} d={d} />)
                            : <p className="text-zinc-600 text-xs text-center py-2">No daemons registered</p>
                        }
                    </div>

                    {/* Arbiters + Lobe Breakdown */}
                    {arbiterTotal > 0 && (
                        <div>
                            <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-2 flex items-center justify-between">
                                <span className="flex items-center"><Brain className="w-3 h-3 mr-1" />Arbiters</span>
                                <span className="text-zinc-400 font-mono">{arbiterTotal}</span>
                            </p>
                            <LobeBar lobes={lobes} total={arbiterTotal} />
                        </div>
                    )}

                    {/* Attention */}
                    <div>
                        <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-2 flex items-center">
                            <Radio className="w-3 h-3 mr-1" />Attention
                            {attentionEngine && (
                                <span className={`ml-auto text-[10px] ${attentionEngine === 'active' ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {attentionEngine}
                                </span>
                            )}
                        </p>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300 font-mono truncate">
                                {attentionFocus ?? 'unfocused'}
                            </span>
                            {signalCount > 0 && (
                                <span className="text-zinc-500 text-[10px] ml-2 shrink-0">{signalCount} signals</span>
                            )}
                        </div>
                    </div>

                    {/* Memory */}
                    {heapMB != null && (
                        <div>
                            <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-1.5 flex items-center">
                                <Cpu className="w-3 h-3 mr-1" />Heap
                            </p>
                            <div className="flex items-center space-x-2">
                                <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            heapMax && (heapMB / heapMax) > 0.85 ? 'bg-red-500' :
                                            heapMax && (heapMB / heapMax) > 0.65 ? 'bg-amber-500' :
                                            'bg-cyan-500'
                                        }`}
                                        style={{ width: heapMax ? `${Math.min(100, (heapMB / heapMax) * 100).toFixed(0)}%` : '0%' }}
                                    />
                                </div>
                                <span className="text-zinc-400 text-[10px] font-mono shrink-0">
                                    {heapMB}MB{heapMax ? ` / ${heapMax}MB` : ''}
                                </span>
                            </div>
                        </div>
                    )}

                </div>
            )}
        </div>
    );
}
