import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jsonRequest } from '../utils/jsonRequest';

export function useTradingMission() {
    const [mission, setMission] = useState(null);
    const [research, setResearch] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const revision = useRef(0);
    const refresh = useCallback(async () => {
        const version = revision.current;
        try {
            const data = await jsonRequest('/api/autonomous/mission/status', { signal: AbortSignal.timeout(10_000) });
            if (!data.success) throw new Error(data.error || 'Mission status unavailable');
            if (version === revision.current) { setMission(data.mission); setError(''); }
        } catch (error) { if (version === revision.current) setError(error.message); }
    }, []);
    useEffect(() => {
        refresh(); const timer = setInterval(refresh, 5000);
        return () => { clearInterval(timer); revision.current++; };
    }, [refresh]);
    useEffect(() => {
        let active = true;
        const readResearch = async () => {
            try {
                const data = await jsonRequest('/api/autonomous/research-status', { signal: AbortSignal.timeout(10_000) });
                if (active && data.success) setResearch(data);
            } catch { /* mission controls remain available when research status is offline */ }
        };
        readResearch();
        const timer = setInterval(readResearch, 30_000);
        return () => { active = false; clearInterval(timer); };
    }, []);
    const command = useCallback(async action => {
        if (pending.current) return false;
        pending.current = true; revision.current++; setBusy(true); setError('');
        try {
            const data = await jsonRequest(`/api/autonomous/mission/${action}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000)
            });
            if (!data.success) throw new Error(data.error || 'Mission command was not acknowledged');
            revision.current++; setMission(data.mission);
            return true;
        } catch (error) { setError(error.message); return false; }
        finally { pending.current = false; setBusy(false); }
    }, []);
    return { mission, research, error, busy, command, refresh };
}

const usd = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function TradingMissionPanel({ control, onInspectMarket, onOpenResearch }) {
    const { mission, error, busy, command } = control;
    const selected = mission?.selection;
    const research = control.research;
    const beeResearch = research?.discovery?.lastCycle?.beeResearch;
    const running = mission?.desired === 'running';
    const button = 'rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-40 hover:bg-white/10';
    return <section aria-label="SOMA autonomous paper mission" className="mx-4 mb-3 shrink-0 rounded-xl border border-cyan-400/20 bg-[#10151d] p-3 text-zinc-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 className="text-sm font-semibold">SOMA Autopilot <span className="ml-2 text-[10px] uppercase text-amber-300">Paper only</span></h2>
                <p className="mt-1 text-xs text-zinc-400">One click: audit → choose → paper trade → review. No strategy setup required.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button className={`${button} ${running ? 'text-amber-200' : 'bg-cyan-400/10 text-cyan-200'}`} disabled={busy || (!running && (!mission?.executionReady || Boolean(error)))} onClick={() => command(running ? 'pause' : 'run')}>
                    {busy ? 'Sending…' : running ? 'Pause entries' : 'Run SOMA'}
                </button>
                <button className={button} disabled={busy || !mission || mission.auditRunning} onClick={() => command('audit')}>{mission?.auditRunning ? 'Auditing…' : 'Audit / scan now'}</button>
                {onOpenResearch && <button className={button} onClick={onOpenResearch}>Research & experiments</button>}
            </div>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-rose-300">Connection/command not confirmed: {error}. Last displayed state may be stale.</p>}
        <div className="mt-2 text-xs" role="status">
            <span className="mr-2 font-mono uppercase text-cyan-300">{mission?.phase || 'Connecting'}</span>
            {mission?.message || 'Reading the executor’s acknowledged state…'}
        </div>
        {mission && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <span>Entries: {mission.entriesActive ? 'authorized' : 'not active'}</span>
            <span>Open positions monitored: {mission.protectedPositions}</span>
            <span>Maximum new position: {usd(mission.limits.maxPositionNotional)}</span>
            <span>Selection: {selected ? `${selected.candidate.symbol} · ${selected.candidate.strategyId}` : 'none yet'}</span>
            {selected && onInspectMarket && <button className="text-cyan-300 underline" onClick={() => onInspectMarket(selected.candidate.symbol)}>View selected market</button>}
        </div>}
        {research && <div className="mt-2 rounded border border-white/10 p-2 text-[11px] text-zinc-400">
            <span>Research: {research.discovery?.experimentIndex ?? 0} cycles · {research.latestAuditSummary?.researchPassed ?? 0}/{research.latestAuditSummary?.audited ?? 0} passed the last audit · {research.diagnosticShadow?.candidates?.length ?? 0} diagnostic shadows (no orders).</span>
            {research.daemon?.lastDeferredReason && <span className="block text-amber-300">Heavy research deferred: {research.daemon.lastDeferredReason}</span>}
            {beeResearch && <div className="mt-2 border-t border-white/10 pt-2">
                <span className="text-cyan-200">BeeBots / OKX proxy: {beeResearch.status.replaceAll('_', ' ')} · no order or promotion authority</span>
                {beeResearch.status === 'diagnostic_complete'
                    ? <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{Object.entries(beeResearch.bees || {}).map(([bee, row]) =>
                        <span key={bee}>{bee}: holdout {row.holdout?.trades ?? 0} trades, {usd(row.holdout?.totalPnl)} net, PF {Number(row.holdout?.profitFactor ?? 0).toFixed(2)}</span>)}</div>
                    : <span className="block text-amber-300">{beeResearch.error || 'Proxy evidence unavailable'}</span>}
                <span className="block text-zinc-500">{beeResearch.limitation || 'Bee research remains separate from executable paper evidence.'}</span>
            </div>}
        </div>}
        <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-zinc-400">Audit evidence and decisions {mission?.audit?.rows?.length ? `(${mission.audit.rows.length} recipes checked)` : ''}</summary>
            <div className="mt-2 max-h-60 space-y-2 overflow-auto">
                <p className="text-zinc-500">Browsing charts and scans does not change the running recipe. An unproven paper experiment is not a profit claim. Pause blocks new entries; it does not liquidate open positions.</p>
                <p className="text-zinc-500">{mission?.audit?.scope}</p>
                {mission?.audit?.rows?.map(row => <div key={row.candidate.key} className="rounded border border-white/10 p-2">
                    <div className="flex flex-wrap justify-between gap-2"><span>{row.candidate.symbol} / {row.candidate.strategyId}</span><span className={row.eligible ? 'text-cyan-300' : 'text-amber-300'}>{row.eligible ? row.evidenceClass.replaceAll('_', ' ') : 'not eligible'}</span></div>
                    <p className="mt-1 text-zinc-400">Version {row.candidate.id} · Paper: {row.forward.trades} closes / {usd(row.forward.netPnl)} net · Historical evaluation: {usd(row.historical?.netPnl)} / {row.historical?.observedCloses ?? 0} natural closes</p>
                    {row.forward.trades > 0 && row.forward.costReconciliation && <p className="text-zinc-500">Recorded round-trip fees: {row.forward.costReconciliation.observedRoundTripFeeBps?.toFixed(1) ?? 'unknown'} bps · Model: {row.forward.costReconciliation.modeledRoundTripFeeBps} bps · Entry slippage: {row.forward.costReconciliation.averageAbsoluteEntrySlippageBps?.toFixed(1) ?? 'unknown'} bps{row.forward.costReconciliation.warning ? ' · Fee evidence needs review' : ''}</p>}
                    <p className="text-zinc-500">{row.reasons.join('; ') || 'Passed paper entry checks; subject to fresh quotes and execution risk gates.'}</p>
                </div>)}
                {mission?.audit?.errors?.map((item, i) => <p className="text-amber-300" key={`error-${i}`}>{item.candidateKey}: {item.error}</p>)}
                {mission?.audit?.excluded?.map((item, i) => <p className="text-zinc-500" key={`excluded-${i}`}>{item.source}: {item.reason}</p>)}
                {mission?.events?.slice(0, 5).map((event, i) => <p className="text-zinc-400" key={`event-${i}`}>{new Date(event.at).toLocaleTimeString()} — {event.message}</p>)}
            </div>
        </details>
    </section>;
}
