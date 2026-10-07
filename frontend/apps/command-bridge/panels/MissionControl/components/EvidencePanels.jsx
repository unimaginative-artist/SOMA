import React, { useEffect, useMemo, useState } from 'react';
import { Database, ScrollText, ShieldCheck, Activity, Search } from 'lucide-react';

const typeLabel = {
    market_data: 'Market Data',
    deep_scan: 'Deep Scan',
    simulation: 'Simulation',
    strategy_registry: 'Strategy',
    autonomous_decision: 'Decision',
    paper_trade: 'Paper Trade',
    manual_broker_order: 'Broker Order',
    performance: 'Performance',
    promotion: 'Promotion',
    live_execution: 'Live',
    system: 'System'
};

const typeColor = {
    market_data: 'text-blue-300 border-blue-500/20 bg-blue-500/10',
    deep_scan: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10',
    simulation: 'text-fuchsia-300 border-fuchsia-500/20 bg-fuchsia-500/10',
    autonomous_decision: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
    paper_trade: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
    manual_broker_order: 'text-orange-300 border-orange-500/20 bg-orange-500/10',
    performance: 'text-lime-300 border-lime-500/20 bg-lime-500/10',
    promotion: 'text-violet-300 border-violet-500/20 bg-violet-500/10',
};

const shortId = id => id ? `${id.slice(0, 8)}...${id.slice(-4)}` : 'none';
const formatTime = ts => {
    const time = Date.parse(ts);
    return Number.isFinite(time) ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
};

function useEvidence(symbol, limit = 80, scope = 'symbol') {
    const [summary, setSummary] = useState(null);
    const [events, setEvents] = useState([]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const eventUrl = scope === 'global'
                    ? `/api/market-evidence/events?limit=${limit}`
                    : scope === 'all'
                        ? `/api/market-evidence/events?limit=${limit}`
                        : `/api/market-evidence/events?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
                const [summaryRes, eventsRes] = await Promise.all([
                    fetch('/api/market-evidence/summary'),
                    fetch(eventUrl)
                ]);
                const summaryData = await summaryRes.json();
                const eventsData = await eventsRes.json();
                if (cancelled) return;
                setSummary(summaryData.summary || null);
                setEvents(eventsData.events || []);
            } catch {
                if (!cancelled) {
                    setSummary(null);
                    setEvents([]);
                }
            }
        };
        load();
        const interval = setInterval(load, 8000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [symbol, limit, scope]);

    return { summary, events };
}

export function EvidenceBriefPanel({ symbol, missionRuntime, autonomousStatus }) {
    const { summary, events } = useEvidence(symbol, 120, 'all');
    const symbolEvents = events.filter(event => String(event.symbol || '').toUpperCase() === String(symbol || '').toUpperCase());
    const latestDeepScan = symbolEvents.find(event => event.type === 'deep_scan');
    const latestMarketData = symbolEvents.find(event => event.type === 'market_data');
    const latestDecision = symbolEvents.find(event => event.type === 'autonomous_decision');
    const latestPromotion = events.find(event => event.type === 'promotion') || (summary?.latest?.type === 'promotion' ? summary.latest : null);
    const promotion = missionRuntime?.lastPromotion || autonomousStatus?.missionControlRuntime?.lastPromotion || null;

    const health = useMemo(() => {
        const hasData = !!latestMarketData;
        const hasScan = !!latestDeepScan;
        const gateCount = promotion?.ladder?.nextBlockedBy?.length ?? null;
        if (hasData && hasScan && gateCount === 0) return { label: 'Evidence ready', color: 'text-emerald-300' };
        if (hasData && hasScan) return { label: 'Evidence building', color: 'text-amber-300' };
        return { label: 'Needs scan', color: 'text-zinc-400' };
    }, [latestMarketData, latestDeepScan, promotion]);

    return (
        <div className="h-full flex flex-col bg-[#151518]/40">
            <div className="p-3 border-b border-white/5">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    <Database className="w-4 h-4 text-cyan-300" />
                    Evidence Brief
                </h3>
                <div className={`mt-2 text-[11px] font-bold uppercase tracking-wide ${health.color}`}>{health.label}</div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                    <Metric label="Recent Evidence" value={summary?.totalRecent ?? 0} />
                    <Metric label="Symbol Events" value={symbolEvents.length} />
                    <Metric label="Promotion Tier" value={promotion?.activeTier || 'paper'} />
                    <Metric label="Blocked Gates" value={promotion?.ladder?.nextBlockedBy?.length ?? '--'} />
                </div>

                <EvidenceCard title="Latest Market Data" event={latestMarketData} />
                <EvidenceCard title="Latest Deep Scan" event={latestDeepScan} />
                <EvidenceCard title="Latest Decision" event={latestDecision} />
                <EvidenceCard title="Latest Promotion" event={latestPromotion} />
            </div>
        </div>
    );
}

function Metric({ label, value }) {
    return (
        <div className="rounded border border-white/5 bg-black/30 p-2">
            <div className="text-[8px] text-zinc-600 uppercase">{label}</div>
            <div className="text-sm font-mono font-bold text-white">{value}</div>
        </div>
    );
}

function EvidenceCard({ title, event }) {
    return (
        <div className="rounded border border-white/5 bg-black/25 p-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{title}</span>
                {event ? <span className="text-[9px] text-zinc-600">{formatTime(event.timestamp)}</span> : null}
            </div>
            {!event ? (
                <div className="mt-1 text-[10px] text-zinc-700">No evidence yet</div>
            ) : (
                <>
                    <div className="mt-1 flex items-center gap-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold ${typeColor[event.type] || 'text-zinc-300 border-white/10 bg-white/5'}`}>
                            {typeLabel[event.type] || event.type}
                        </span>
                        <span className="text-[9px] font-mono text-cyan-300">{shortId(event.evidenceId)}</span>
                    </div>
                    {event.parentEvidenceIds?.length > 0 && (
                        <div className="mt-1 text-[9px] text-zinc-600">
                            parent: {event.parentEvidenceIds.map(shortId).join(', ')}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export function EvidenceTimelinePanel({ symbol }) {
    const [scope, setScope] = useState('symbol');
    const { events } = useEvidence(symbol, 120, scope);
    const [filter, setFilter] = useState('all');
    const scopedEvents = scope === 'global' ? events.filter(event => !event.symbol) : events;
    const filtered = filter === 'all' ? scopedEvents : scopedEvents.filter(event => event.type === filter);
    const types = ['all', ...Array.from(new Set(scopedEvents.map(event => event.type)))];

    return (
        <div className="h-full flex flex-col bg-[#151518]/40">
            <div className="p-3 border-b border-white/5">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-cyan-300" />
                    Evidence Timeline
                </h3>
                <div className="mt-2 flex gap-1 overflow-x-auto custom-scrollbar">
                    {['symbol', 'global', 'all'].map(item => (
                        <button
                            key={item}
                            onClick={() => setScope(item)}
                            className={`px-2 py-1 rounded border text-[9px] font-bold uppercase whitespace-nowrap ${scope === item ? 'border-violet-400/40 bg-violet-400/10 text-violet-200' : 'border-white/5 bg-black/20 text-zinc-600 hover:text-zinc-300'}`}
                        >
                            {item === 'symbol' ? symbol : item}
                        </button>
                    ))}
                </div>
                <div className="mt-2 flex gap-1 overflow-x-auto custom-scrollbar">
                    {types.map(type => (
                        <button
                            key={type}
                            onClick={() => setFilter(type)}
                            className={`px-2 py-1 rounded border text-[9px] font-bold uppercase whitespace-nowrap ${filter === type ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : 'border-white/5 bg-black/20 text-zinc-600 hover:text-zinc-300'}`}
                        >
                            {type === 'all' ? 'All' : typeLabel[type] || type}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs">
                        <Search className="w-6 h-6 mb-2 opacity-60" />
                        No evidence yet for {scope === 'symbol' ? symbol : scope}
                    </div>
                ) : filtered.map(event => (
                    <div key={event.evidenceId} className="rounded border border-white/5 bg-black/25 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold ${typeColor[event.type] || 'text-zinc-300 border-white/10 bg-white/5'}`}>
                                {typeLabel[event.type] || event.type}
                            </span>
                            <span className="text-[9px] font-mono text-zinc-600">{formatTime(event.timestamp)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px]">
                            <span className="font-mono text-cyan-300">{shortId(event.evidenceId)}</span>
                            <span className="text-zinc-600">{event.source}</span>
                        </div>
                        {event.payload?.verdict && (
                            <div className="mt-1 text-[10px] text-zinc-400">
                                {event.payload.verdict.recommendation} · {Math.round((event.payload.verdict.confidence || 0) * 100)}%
                            </div>
                        )}
                        {event.payload?.reason && (
                            <div className="mt-1 text-[10px] text-zinc-500 line-clamp-2">{event.payload.reason}</div>
                        )}
                        {event.payload?.simulationContext?.bestStrategy && (
                            <div className="mt-1 text-[9px] text-fuchsia-300/80">
                                sim: {event.payload.simulationContext.bestStrategy.name || event.payload.simulationContext.bestStrategy.id}
                            </div>
                        )}
                        {event.parentEvidenceIds?.length > 0 && (
                            <div className="mt-1 text-[9px] text-zinc-600">
                                parents: {event.parentEvidenceIds.map(shortId).join(', ')}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
