import React, { useEffect, useState } from 'react';
import { ScrollText, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';

export const LifecycleJournalPanel = () => {
    const [events, setEvents] = useState([]);
    const [promotion, setPromotion] = useState(null);
    const [training, setTraining] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [journalRes, promotionRes, trainingRes] = await Promise.all([
                    fetch('/api/mission-control/journal?limit=40'),
                    fetch('/api/mission-control/promotion'),
                    fetch('/api/mission-control/training')
                ]);
                const journal = await journalRes.json();
                const promotionData = await promotionRes.json();
                const trainingData = await trainingRes.json();
                if (cancelled) return;
                setEvents(journal.events || []);
                setPromotion(promotionData.promotion || null);
                setTraining(trainingData || null);
            } catch {
                if (!cancelled) {
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
    }, []);

    const failedChecks = promotion?.checks
        ? Object.entries(promotion.checks).filter(([, ok]) => !ok).map(([name]) => name)
        : [];
    const activeJob = training?.jobs?.find(job => job.status === 'running') || training?.jobs?.[0] || null;

    return (
        <div className="h-full flex flex-col bg-[#151518]/40">
            <div className="p-3 border-b border-white/5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-cyan-300" />
                    Execution Journal
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded border border-white/10 bg-black/25 p-2">
                        <div className="flex items-center gap-1 text-zinc-500 uppercase font-bold">
                            <ShieldCheck className="w-3 h-3" />
                            Promotion
                        </div>
                        <div className={promotion?.approved ? 'text-emerald-300 font-mono mt-1' : 'text-amber-300 font-mono mt-1'}>
                            {promotion?.mode || 'checking'}
                        </div>
                    </div>
                    <div className="rounded border border-white/10 bg-black/25 p-2">
                        <div className="flex items-center gap-1 text-zinc-500 uppercase font-bold">
                            <Clock className="w-3 h-3" />
                            Training
                        </div>
                        <div className="text-cyan-300 font-mono mt-1">
                            {activeJob ? `${activeJob.iterationsDone}/${activeJob.iterationsTarget}` : 'idle'}
                        </div>
                    </div>
                </div>
                {failedChecks.length > 0 && (
                    <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/10 p-2 text-[10px] text-amber-200 flex gap-2">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>Paper gate waiting on: {failedChecks.join(', ')}</span>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {events.length === 0 ? (
                    <div className="text-center text-xs text-zinc-600 py-8">
                        No lifecycle events yet. Start paper autonomous trading to populate the replay trail.
                    </div>
                ) : events.map(event => (
                    <div key={event.id} className="rounded border border-white/10 bg-black/25 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">{event.stage}</span>
                            <span className="text-[9px] font-mono text-zinc-600">{new Date(event.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-400">
                            {event.symbol || 'Mission Control'} · {event.status || 'info'} · {event.actor || 'SOMA'}
                        </div>
                        {event.payload && Object.keys(event.payload).length > 0 && (
                            <pre className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap text-[9px] leading-relaxed text-zinc-500">
                                {JSON.stringify(event.payload, null, 2)}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
