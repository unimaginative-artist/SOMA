import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, Pause, Play, Server, TrendingUp, RotateCcw, MessageSquareWarning } from 'lucide-react';

export default function ClusterOperations() {
  const [data, setData] = useState(null);
  const [improvements, setImprovements] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [clusterRes, improvementRes] = await Promise.all([
        fetch('/api/maintenance/cluster/status'),
        fetch('/api/asi/improvement-scorecard'),
      ]);
      const body = await clusterRes.json();
      if (!clusterRes.ok) throw new Error(body.error || `HTTP ${clusterRes.status}`);
      setData(body.cluster);
      if (improvementRes.ok) setImprovements(await improvementRes.json());
      setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);
  const control = async action => {
    setBusy(true);
    try {
      const res = await fetch(`/api/maintenance/cluster/control/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const coordinator = data?.coordinator || {};
  const workers = coordinator.workers || [];
  const score = improvements?.summary || {};
  const recentImprovements = improvements?.records || [];
  return <div className="h-full overflow-y-auto bg-[#09090b] p-6 text-zinc-100">
    <div className="mb-6 flex items-center justify-between">
      <div><h2 className="text-2xl font-bold">MAX Cluster Operations</h2><p className="mt-1 text-sm text-zinc-500">Authenticated execution, leases, budgets, and promotion evidence.</p></div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => control('refresh')} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5"><RefreshCw className="mr-2 inline h-4 w-4"/>Refresh</button>
        <button disabled={busy} onClick={() => control(coordinator.paused ? 'resume' : 'pause')} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{coordinator.paused ? <Play className="mr-2 inline h-4 w-4"/> : <Pause className="mr-2 inline h-4 w-4"/>}{coordinator.paused ? 'Resume' : 'Emergency pause'}</button>
      </div>
    </div>
    {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
    <div className="mb-6 grid grid-cols-4 gap-4">
      {[
        ['Coordinator', coordinator.nodeId || '--'], ['Online workers', coordinator.activeRemoteWorkers ?? 0],
        ['Dispatched', coordinator.totalTasksDispatched ?? 0], ['State', coordinator.paused ? 'PAUSED' : 'ACTIVE']
      ].map(([label,value]) => <div key={label} className="rounded-xl border border-white/5 bg-white/[.03] p-4"><div className="text-[10px] uppercase tracking-widest text-zinc-600">{label}</div><div className="mt-2 font-mono text-lg">{value}</div></div>)}
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      {workers.map(worker => <div key={worker.id} className="rounded-xl border border-white/5 bg-[#111114] p-5">
        <div className="flex items-center justify-between"><div className="flex items-center gap-3"><Server className="h-5 w-5 text-fuchsia-400"/><div><div className="font-semibold">{worker.id}</div><div className="text-xs text-zinc-600">{worker.url}</div></div></div><span className={`rounded-full px-2 py-1 text-[10px] uppercase ${worker.status === 'online' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{worker.status}</span></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-zinc-400"><span>CPU {worker.runtime?.resources?.cpuCores || '--'}</span><span>Running {worker.runtime?.running ?? '--'}</span><span>Done {worker.completedTasks || 0}</span></div>
        <div className="mt-3 flex flex-wrap gap-1">{(worker.capabilities || []).map(c => <span key={c} className="rounded bg-white/5 px-2 py-1 text-[10px] text-zinc-500">{c}</span>)}</div>
      </div>)}
      {!workers.length && <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-zinc-600"><Activity className="mx-auto mb-3 h-8 w-8"/>No configured workers reported.</div>}
    </div>
    <div className="mt-6 flex items-center gap-2 text-xs text-zinc-600"><ShieldCheck className="h-4 w-4 text-emerald-500"/>Worker receipts require HMAC verification; SOMA promotions require the governed pipeline.</div>
    <section className="mt-8 border-t border-white/5 pt-7">
      <div className="mb-4 flex items-end justify-between">
        <div><h3 className="flex items-center gap-2 text-lg font-semibold"><TrendingUp className="h-5 w-5 text-emerald-400"/>Self-Improvement Scorecard</h3><p className="mt-1 text-xs text-zinc-500">Measured candidates, human corrections, governed rollback, and 7/30-day survival.</p></div>
        <span className="text-[10px] uppercase tracking-widest text-zinc-600">No benchmark, no promotion</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ['Promotions', score.totalPromotions ?? 0], ['Probation', score.inProbation ?? 0],
          ['Accepted', score.accepted ?? 0], ['Rolled back', score.rolledBack ?? 0],
          ['Survived 7d', score.survived7d ?? 0], ['Survived 30d', score.survived30d ?? 0],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-white/5 bg-white/[.025] p-3"><div className="text-[9px] uppercase tracking-widest text-zinc-600">{label}</div><div className="mt-1 font-mono text-xl">{value}</div></div>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-white/5 bg-[#111114] px-4 py-3 text-xs text-zinc-400">
        <span className="flex items-center gap-2"><MessageSquareWarning className="h-4 w-4 text-amber-400"/>Corrections {score.humanCorrections ?? 0}/{score.feedbackCount ?? 0} ({Math.round((score.correctionRate || 0) * 100)}%)</span>
        <span className="flex items-center gap-2"><RotateCcw className="h-4 w-4 text-fuchsia-400"/>Long-term rollback only targets the newest attributable code promotion.</span>
      </div>
      <div className="mt-4 space-y-2">
        {recentImprovements.slice(0, 5).map(item => {
          const last = item.checkpoints?.at(-1);
          return <div key={item.id} className="grid gap-2 rounded-lg border border-white/5 bg-white/[.02] p-3 text-xs md:grid-cols-[1fr_auto_auto]">
            <div><div className="font-mono text-zinc-300">{item.id}</div><div className="mt-1 truncate text-zinc-600">{(item.files || []).join(', ') || item.kind}</div></div>
            <span className={`self-center rounded-full px-2 py-1 text-[10px] uppercase ${item.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-300' : item.status === 'rolled_back' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{item.status}</span>
            <span className="self-center text-zinc-500">{last ? `${last.label}: ${last.passed ? 'passed' : last.action}` : 'awaiting checkpoint'}</span>
          </div>;
        })}
        {!recentImprovements.length && <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-zinc-600">No governed promotion has entered the scorecard yet.</div>}
      </div>
    </section>
  </div>;
}
