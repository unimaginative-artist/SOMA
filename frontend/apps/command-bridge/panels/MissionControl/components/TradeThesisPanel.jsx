import React from 'react';
import { CheckCircle, Circle, Database, Shield, Target, XCircle } from 'lucide-react';

const LIFECYCLE = [
    { id: 'draft', label: 'Draft' },
    { id: 'enriched', label: 'Enriched' },
    { id: 'simulated', label: 'Sim' },
    { id: 'paper_ready', label: 'Ready' },
    { id: 'paper_active', label: 'Paper' },
    { id: 'closed', label: 'Closed' },
    { id: 'reviewed', label: 'Reviewed' },
    { id: 'promoted', label: 'Promoted' }
];

const NEXT_ACTION = {
    draft: 'Run Deep Scan',
    enriched: 'Run Backtest',
    simulated: 'Pass gates for paper readiness',
    paper_ready: 'Start paper session',
    paper_active: 'Close and review paper session',
    closed: 'Review outcome',
    reviewed: 'Promote or reject',
    promoted: 'Monitor promoted strategy',
    rejected: 'Create a new thesis'
};

const statusStyles = {
    draft: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300',
    enriched: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
    simulated: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
    paper_ready: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    paper_active: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    closed: 'border-purple-500/20 bg-purple-500/10 text-purple-300',
    reviewed: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300',
    promoted: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200',
    rejected: 'border-rose-500/20 bg-rose-500/10 text-rose-300'
};

const normalizeStatus = status => {
    const raw = String(status || 'draft').toLowerCase();
    if (raw === 'approved') return 'paper_ready';
    if (raw === 'active') return 'paper_active';
    return raw;
};

const fmtPrice = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'N/A';
    return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(4);
};

const ListBlock = ({ title, items = [], empty = 'None recorded' }) => (
    <div className="rounded border border-white/5 bg-black/25 p-2">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-widest text-zinc-600">{title}</div>
        {items.length ? (
            <div className="space-y-1">
                {items.slice(0, 5).map((item, idx) => (
                    <div key={`${title}-${idx}`} className="text-[10px] leading-snug text-zinc-300">
                        {item}
                    </div>
                ))}
            </div>
        ) : (
            <div className="text-[10px] italic text-zinc-600">{empty}</div>
        )}
    </div>
);

const GateRow = ({ ok, label }) => (
    <div className="flex items-center gap-1.5 text-[10px]">
        {ok ? <CheckCircle className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-rose-400" />}
        <span className={ok ? 'text-zinc-300' : 'text-zinc-500'}>{label}</span>
    </div>
);

export const TradeThesisPanel = ({ thesis }) => {
    if (!thesis) {
        return (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <Target className="mb-3 h-8 w-8 text-zinc-700" />
                <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">No Active Thesis</div>
                <p className="mt-2 max-w-xs text-[10px] leading-relaxed text-zinc-600">
                    Run Interpret to create a draft thesis. Deep Scan will attach evidence and strengthen or reject it.
                </p>
            </div>
        );
    }

    const plan = thesis.entryPlan || {};
    const gates = thesis.qualityGates || {};
    const status = normalizeStatus(thesis.status);
    const statusClass = statusStyles[status] || statusStyles.draft;
    const activeIndex = Math.max(0, LIFECYCLE.findIndex(stage => stage.id === status));
    const nextAction = thesis.lifecycle?.nextAction || NEXT_ACTION[status] || 'Continue';

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-cyan-300" />
                        <div className="text-xs font-bold text-white">{thesis.symbol}</div>
                        <div className={`rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${statusClass}`}>
                            {status.replace('_', ' ')}
                        </div>
                    </div>
                    <div className="mt-1 text-[9px] uppercase tracking-wider text-zinc-600">
                        {thesis.source} / {thesis.timeframe} / {thesis.mode}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">Confidence</div>
                    <div className="text-lg font-mono font-bold text-cyan-300">{Math.round((thesis.confidence || 0) * 100)}%</div>
                </div>
            </div>

            <div className="rounded border border-white/5 bg-black/25 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[8px] font-bold uppercase tracking-widest text-zinc-600">Lifecycle</div>
                    <div className="truncate text-[9px] font-mono text-cyan-300">{nextAction}</div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                    {LIFECYCLE.map((stage, idx) => {
                        const done = idx < activeIndex;
                        const active = idx === activeIndex;
                        return (
                            <div
                                key={stage.id}
                                className={`rounded border px-1.5 py-1 text-center text-[8px] font-bold uppercase tracking-wide ${
                                    active ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200'
                                        : done ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                                            : 'border-white/5 bg-zinc-900/40 text-zinc-600'
                                }`}
                                title={stage.label}
                            >
                                {stage.label}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/5 bg-black/30 p-2">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">Direction</div>
                    <div className={`text-sm font-bold ${plan.direction === 'BUY' ? 'text-emerald-400' : plan.direction === 'SELL' ? 'text-rose-400' : 'text-zinc-300'}`}>
                        {plan.direction || 'HOLD'}
                    </div>
                </div>
                <div className="rounded border border-white/5 bg-black/30 p-2">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">Entry</div>
                    <div className="text-sm font-mono font-bold text-white">${fmtPrice(plan.entry)}</div>
                </div>
                <div className="rounded border border-white/5 bg-black/30 p-2">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">Stop</div>
                    <div className="text-sm font-mono font-bold text-rose-300">${fmtPrice(plan.stopLoss)}</div>
                </div>
                <div className="rounded border border-white/5 bg-black/30 p-2">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">Target</div>
                    <div className="text-sm font-mono font-bold text-emerald-300">${fmtPrice(plan.takeProfit)}</div>
                </div>
            </div>

            <div className="rounded border border-white/5 bg-black/25 p-2">
                <div className="mb-2 flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-zinc-600">
                    <Shield className="h-3 w-3" />
                    Quality Gates
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                    <GateRow ok={gates.freshData} label="Fresh data" />
                    <GateRow ok={gates.hasEntry} label="Entry exists" />
                    <GateRow ok={gates.hasStop} label="Stop exists" />
                    <GateRow ok={gates.hasTarget} label="Target exists" />
                    <GateRow ok={gates.hasEvidence} label="Evidence attached" />
                    <GateRow ok={gates.riskDefined} label="Risk defined" />
                    <GateRow ok={gates.canBacktest || gates.canPaperTrade} label="Legal next step" />
                    <GateRow ok={thesis.executionReady} label="Paper ready" />
                </div>
            </div>

            <ListBlock title="Facts" items={thesis.facts} />
            <ListBlock title="Signals" items={thesis.signals} />
            <ListBlock title="Assumptions" items={thesis.assumptions} />
            <ListBlock title="Risks" items={thesis.risks} />

            <div className="rounded border border-cyan-500/10 bg-cyan-950/10 p-2">
                <div className="mb-1 flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-cyan-400">
                    <Database className="h-3 w-3" />
                    Evidence Refs
                </div>
                {thesis.evidenceRefs?.length ? (
                    <div className="space-y-1">
                        {thesis.evidenceRefs.map(ref => (
                            <div key={ref} className="truncate text-[10px] font-mono text-zinc-400">{ref}</div>
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 text-[10px] italic text-zinc-600">
                        <Circle className="h-2.5 w-2.5" />
                        Awaiting Deep Scan evidence
                    </div>
                )}
            </div>
        </div>
    );
};
