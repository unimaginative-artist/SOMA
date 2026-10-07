import React, { useCallback, useEffect, useId, useState } from 'react';
import { Activity, FlaskConical, Pause, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { jsonRequest } from '../utils/jsonRequest';

const money = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const number = value => value == null ? '—' : Number(value).toFixed(2);

export default function TradingEcosystemPanel({ initialSymbol = 'ETH-USD' }) {
    const symbolSelectId = useId();
    const [symbol, setSymbol] = useState(['SOL-USD', 'BTC-USD', 'ETH-USD'].includes(initialSymbol) ? initialSymbol : 'ETH-USD');
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState('');
    const refresh = useCallback(async () => {
        try {
            const data = await jsonRequest('/api/trading-ecosystem/status');
            if (!data.success) throw new Error(data.error || 'Ecosystem unavailable');
            setState(data.ecosystem);
            setError('');
        } catch (error) { setError(error.message); }
    }, []);
    useEffect(() => { refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, [refresh]);
    const action = async (endpoint, body, key) => {
        setBusy(key); setNotice(''); setError('');
        try {
            const result = await jsonRequest(`/api/trading-ecosystem/${endpoint}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            if (!result.success) throw new Error(result.error || 'Request failed');
            setNotice(result.result?.submitted ? 'Focused experiment requested. SOMA will audit it before enabling entries.' : endpoint === 'research' ? 'Historical report saved to the shared research record. No promotion or trading was triggered.'
                : endpoint === 'paper/pause' ? 'New entries paused. Any open position stays protected until it closes.'
                    : 'Paper experiment engaged. Live execution remains disabled.');
            await refresh();
        } catch (error) { setError(error.message); }
        finally { setBusy(''); }
    };
    const sessions = state?.lanes.flatMap(lane => lane.sessions) || [];
    const occupied = sessions.find(session => session.symbol === symbol && (session.isRunning || session.openPositions?.length));
    const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
    return <section className="p-4 space-y-4 text-zinc-200" aria-label="Trading ecosystem">
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400">Mission Control ↔ Market Lab</div>
                <h2 className="mt-1 text-lg font-semibold text-white">Trading ecosystem</h2>
                <p className="mt-1 text-xs text-zinc-400">One paper executor. Separate strategy evidence.</p>
            </div>
            <span className="flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300"><ShieldCheck size={12} /> PAPER ONLY</span>
        </header>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-zinc-400">
            Historical test → paper experiment → closed-trade feedback. Simulated wins never become forward wins.
            Live promotion is disabled here. Grid stays research-only.
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-zinc-400" htmlFor={symbolSelectId}>Experiment pair</label>
            <select id={symbolSelectId} value={symbol} onChange={event => setSymbol(event.target.value)} disabled={Boolean(busy)} className="rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white">
                {['SOL-USD', 'BTC-USD', 'ETH-USD'].map(symbol => <option key={symbol}>{symbol}</option>)}
            </select>
            <button aria-label="Refresh ecosystem" onClick={refresh} className="rounded-lg p-2 hover:bg-white/10"><RefreshCw size={14} /></button>
        </div>
        {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-200">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-200">{notice}</p>}
        {!state && !error && <p className="text-xs text-zinc-400">Loading shared execution and research evidence…</p>}
        {state?.mission?.controlled && <div className="rounded-lg border border-cyan-400/20 p-3 text-xs text-cyan-200">
            SOMA Autopilot: {state.mission.phase} — {state.mission.message}
            <p className="mt-1 text-zinc-400">These are the same experiments audited by Mission Control. Historical research stays available while the mission runs. Pause it before manually starting a different recipe.</p>
        </div>}
        <div className="space-y-3">
            {state?.lanes.map(lane => {
                const experiment = lane.experiments.find(experiment => experiment.symbol === symbol);
                const report = experiment?.research;
                const evaluation = report?.evaluation;
                const running = lane.sessions.filter(session => session.isRunning || session.openPositions?.length);
                return <article key={lane.id} className="rounded-xl border border-white/10 bg-zinc-950/60 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 font-semibold text-sm">{lane.researchOnly ? <FlaskConical size={16} className="text-amber-300" /> : <Activity size={16} className="text-cyan-300" />}{lane.label}</h3>
                        <span className="text-[10px] text-zinc-400">{lane.timeframe} · {lane.researchOnly ? 'QUARANTINED' : 'UNPROVEN'}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-400">{lane.description}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-white/[0.03] p-2.5"><div className="text-zinc-500">Forward closes · this version</div><div className="mt-1 font-mono">{experiment?.forward.trades || 0} · {money(experiment?.forward.netPnl)}</div></div>
                        <div className="rounded-lg bg-white/[0.03] p-2.5"><div className="text-zinc-500">Historical evaluation</div><div className="mt-1 font-mono">{evaluation ? money(evaluation.totalNetPnlUsd ?? evaluation.totalPnl) : 'Not tested'}</div></div>
                    </div>
                    <p className="break-all font-mono text-[9px] text-zinc-500">{experiment?.version}</p>
                    {report && <details className="text-xs text-zinc-400">
                        <summary className="cursor-pointer text-cyan-300">Historical test details · not forward evidence</summary>
                        <div className="mt-2 space-y-1 leading-relaxed">
                            <p>{report.bars} Alpaca candles · 70/30 historical split · {new Date(report.createdAt).toLocaleString()}</p>
                            <p>Development: {money(report.development.totalNetPnlUsd ?? report.development.totalPnl)} · Evaluation: {money(evaluation.totalNetPnlUsd ?? evaluation.totalPnl)}</p>
                            {lane.researchOnly ? <p>Realized {money(evaluation.totalRealizedPnlUsd)} · open inventory {money(evaluation.unrealizedPnlUsd)} · drawdown {number(evaluation.maxDrawdownPct)}%</p>
                                : <p>Observed closes {evaluation.observedCloses} · boundary liquidations {evaluation.boundaryLiquidations} · profit factor {number(evaluation.profitFactor)}</p>}
                            {report.limitations.map(text => <p key={text}>• {text}</p>)}
                        </div>
                    </details>}
                    <div className="flex flex-wrap gap-2">
                        <button className={`${buttonClass} border-cyan-400/20 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20`} disabled={Boolean(busy) || state.researchJob?.running} onClick={() => action('research', { lane: lane.id, symbol }, `research-${lane.id}`)}>
                            <FlaskConical size={13} />{busy === `research-${lane.id}` ? 'Testing…' : 'Run historical test'}
                        </button>
                        {!lane.researchOnly && <button className={`${buttonClass} border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20`} disabled={Boolean(busy) || Boolean(occupied) || !state.executionReady || Boolean(error)} onClick={() => action('paper/start', { lane: lane.id, symbol }, `start-${lane.id}`)}>
                            <Play size={13} />{busy === `start-${lane.id}` ? 'Starting…' : 'Start paper experiment'}
                        </button>}
                    </div>
                    {!lane.researchOnly && occupied && <p className="text-[10px] text-amber-300/80">{symbol} already has an owner. No overlapping engine positions are allowed.</p>}
                    {running.map(session => <div key={session.symbol} className="rounded-lg border border-white/10 p-2.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2"><span>{session.symbol} · {session.config?.entriesPaused ? 'protecting / paused' : 'paper active'}</span>
                            <button disabled={Boolean(busy) || session.config?.entriesPaused || !session.paperMode} onClick={() => action('paper/pause', { symbol: session.symbol }, `pause-${session.symbol}`)} className="flex items-center gap-1 text-amber-300 disabled:opacity-40"><Pause size={12} /> Pause entries</button></div>
                        <p className="mt-1 text-zinc-500">{session.openPositions?.length || 0} open · {session.stats?.totalDecisions || 0} decisions · realized {money(session.stats?.sessionPnL)}</p>
                        <p className="mt-1 break-all text-[10px] text-zinc-500">Session version {session.config?.strategyVersion || 'legacy'} · {session.forward?.trades || 0} version closes · {money(session.forward?.netPnl)}</p>
                        <p className="mt-1 text-[10px] text-zinc-500">{session.lastSignal?.reason || session.lastBlockReason?.reason || 'Waiting for the next decision.'}</p>
                    </div>)}
                </article>;
            })}
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">Each session has an isolated virtual balance and a versioned ledger. A catalog experiment is capped at $250 per position. Existing legacy sessions keep their own limits and history.</p>
    </section>;
}
