import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Cpu, Database, RefreshCw, ShieldCheck } from 'lucide-react';

const tone = {
  ready: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/5',
  degraded: 'text-amber-300 border-amber-500/20 bg-amber-500/5',
  failed: 'text-rose-300 border-rose-500/20 bg-rose-500/5'
};

function shortPath(value = '') {
  const text = String(value || '');
  const marker = 'The Stack';
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(idx) : text;
}

function normalizePayload(payload) {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return { success: false, error: 'Agentic proof returned an unreadable payload' };
  }
}

const AgenticProofPanel = ({ compact = false }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [auditing, setAuditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/soma/agentic-proof/status');
      const payload = normalizePayload(await response.json());
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Agentic proof unavailable');
      setData(payload);
      setError(null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  const runAudit = async () => {
    setAuditing(true);
    try {
      await fetch('/api/soma/agentic-proof/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      await load();
    } finally {
      setAuditing(false);
    }
  };

  const state = data?.state || (error ? 'failed' : 'degraded');
  const contracts = data?.contracts || [];
  const warnings = data?.warnings || [];
  const recentTruth = data?.truthLedger?.recent || [];

  return (
    <div className={`rounded-lg border border-white/5 bg-black/25 ${compact ? 'p-2' : 'p-3'} space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" /> Agentic Proof
          </div>
          {!compact && <div className="mt-1 text-[10px] text-zinc-600">Paths, contracts, watchdogs, and proof ledger.</div>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded border px-2 py-1 text-[9px] font-bold uppercase ${tone[state] || tone.degraded}`}>{state}</span>
          <button onClick={load} className="rounded border border-white/10 p-1 text-zinc-500 hover:text-zinc-200" title="Refresh proof">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1.5 text-[10px] text-rose-300">
          <AlertTriangle className="h-3 w-3" /> {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[
          ['SOMA', data?.watchdog?.somaHealthy],
          ['MAX', data?.watchdog?.maxHealthy || data?.watchdog?.max?.ok],
          ['Bridge', data?.watchdog?.bridgeOk]
        ].map(([label, ok]) => (
          <div key={label} className={`rounded border px-2 py-1.5 ${ok ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-amber-500/15 bg-amber-500/5'}`}>
            <div className="flex items-center justify-between text-[9px] font-bold uppercase text-zinc-500">
              {label}
              {ok ? <CheckCircle className="h-3 w-3 text-emerald-300" /> : <AlertTriangle className="h-3 w-3 text-amber-300" />}
            </div>
          </div>
        ))}
      </div>

      {!compact && data?.canonical && (
        <div className="space-y-1 rounded border border-white/5 bg-white/[0.02] p-2 text-[10px]">
          <div className="font-bold uppercase tracking-widest text-zinc-600">Canonical Paths</div>
          <div className="flex justify-between gap-3"><span className="text-zinc-500">SOMA</span><span className="truncate text-zinc-300">{shortPath(data.canonical.somaRoot)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-zinc-500">MAX</span><span className="truncate text-zinc-300">{shortPath(data.canonical.maxRoot)}</span></div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded border border-amber-500/15 bg-amber-500/[0.04] px-2 py-1.5 text-[10px] text-amber-300">
          {warnings.slice(0, compact ? 1 : 3).join(' · ')}
        </div>
      )}

      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {contracts.slice(0, compact ? 4 : 5).map(agent => (
          <div key={agent.name} className="rounded border border-white/5 bg-black/25 px-2 py-1.5">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase text-zinc-400">
              {agent.name}
              <span className={agent.online ? 'text-emerald-300' : 'text-zinc-600'}>{agent.online ? 'on' : 'off'}</span>
            </div>
            <div className="mt-0.5 truncate text-[9px] text-zinc-600">{agent.roles?.join(', ')}</div>
          </div>
        ))}
      </div>

      {!compact && (
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="rounded border border-white/5 bg-black/20 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
              <Database className="h-3 w-3" /> Truth Ledger
            </div>
            {recentTruth.length ? recentTruth.slice(-3).reverse().map(entry => (
              <div key={entry.id} className="truncate text-[10px] text-zinc-400">
                <span className={entry.status === 'verified' ? 'text-emerald-300' : 'text-amber-300'}>{entry.status}</span> · {entry.claim}
              </div>
            )) : <div className="text-[10px] text-zinc-600">No proof entries yet.</div>}
          </div>
          <div className="rounded border border-white/5 bg-black/20 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
              <Cpu className="h-3 w-3" /> Scheduler
            </div>
            <div className="text-[10px] text-zinc-400">CPU {Math.round((data?.scheduler?.cpuLoad || 0) * 100)}% · RAM {Math.round((data?.scheduler?.memoryUsed || 0) * 100)}%</div>
            <div className="text-[10px] text-zinc-500">Worker isolation: {data?.workers?.isolatedWorkerSupport ? 'available' : 'missing'}</div>
          </div>
        </div>
      )}

      <button
        onClick={runAudit}
        disabled={auditing}
        className="w-full rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:bg-cyan-500/15 disabled:opacity-50"
      >
        {auditing ? 'Auditing...' : 'Run Capability Audit'}
      </button>
    </div>
  );
};

export default AgenticProofPanel;
