import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Cpu, FlaskConical, RefreshCw, Shield, Target } from 'lucide-react';
import AgenticProofPanel from './AgenticProofPanel.jsx';

const stateTone = {
  ready: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300',
  degraded: 'border-amber-500/20 bg-amber-500/5 text-amber-300',
  blocked: 'border-rose-500/25 bg-rose-500/5 text-rose-300',
  offline: 'border-zinc-700 bg-zinc-900/30 text-zinc-500'
};

function ageLabel(timestamp) {
  if (!timestamp) return '--';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

function normalizePayload(payload) {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return { success: false, error: 'Core snapshot returned an unreadable payload' };
  }
}

const CoreSystemsOverview = ({ isConnected }) => {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isConnected) return;
    try {
      const response = await fetch('/api/soma/core-systems/snapshot');
      const data = normalizePayload(await response.json());
      if (!response.ok || !data.success) throw new Error(data.error || 'Snapshot unavailable');
      setSnapshot(data);
      setError(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) {
      setLoading(false);
      setError('Backend disconnected');
      return undefined;
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [isConnected, load]);

  if (loading) {
    return <div className="rounded-xl border border-white/5 bg-[#151518]/60 p-5 text-xs text-zinc-500">Loading core readiness...</div>;
  }

  const readiness = snapshot?.readiness || { state: 'offline', components: [], issues: [] };
  const goals = snapshot?.goals || {};
  const audit = snapshot?.trainingAudit || {};
  const domains = Object.values(snapshot?.learning?.scoreboard?.domains || {}).slice(0, 6);
  const selfMod = snapshot?.safety?.selfMod || {};
  const nemesis = snapshot?.safety?.nemesis || {};

  return (
    <div className="rounded-xl border border-white/5 bg-[#151518]/60 backdrop-blur-md p-5 shadow-lg space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center text-sm font-semibold uppercase tracking-wider text-zinc-100">
            <Cpu className="mr-2 h-4 w-4 text-cyan-400" /> Runtime Readiness
          </h3>
          <p className="mt-1 text-[10px] text-zinc-500">Connected state, proof flow, and export hygiene from one backend snapshot.</p>
        </div>
        <div className="flex items-center gap-2">
          {snapshot?.generatedAt && <span className="text-[9px] font-mono text-zinc-600">{ageLabel(snapshot.generatedAt)}</span>}
          <button onClick={load} title="Refresh snapshot" className="rounded border border-white/10 p-1.5 text-zinc-400 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${stateTone[readiness.state] || stateTone.offline}`}>
            {readiness.state}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {readiness.issues.length > 0 && (
        <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-amber-400">Degraded / Blocked</div>
          {readiness.issues.slice(0, 4).map((issue, index) => (
            <div key={`${issue.source}-${index}`} className="text-[10px] text-zinc-400">
              <span className="text-amber-300">{issue.source}:</span> {issue.detail}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {readiness.components.map(component => (
          <React.Fragment key={component.id}>
            <div className={`rounded-lg border px-3 py-2 ${stateTone[component.state] || stateTone.offline}`}>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                <span>{component.label}</span>
                {component.ready ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              </div>
              <div className="mt-1 truncate text-[10px] font-normal text-zinc-400" title={component.detail}>{component.detail}</div>
            </div>
            {component.id === 'market' && (
              <div className="col-span-2 lg:col-span-4">
                <AgenticProofPanel />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-white/5 bg-black/20 p-3">
          <div className="mb-3 flex items-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <Target className="mr-1.5 h-3.5 w-3.5 text-cyan-400" /> Goal Evidence
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['Active', goals.active], ['Verified', goals.verified], ['Failed', goals.verificationFailed], ['Unbound', goals.missingContract]].map(([label, value]) => (
              <div key={label}>
                <div className="text-base font-mono text-zinc-100">{value ?? 0}</div>
                <div className="text-[8px] uppercase text-zinc-600">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/5 bg-black/20 p-3">
          <div className="mb-3 flex items-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <FlaskConical className="mr-1.5 h-3.5 w-3.5 text-violet-400" /> Training Hygiene
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Rows', audit.totalRows], ['Secrets', audit.suspectRows], ['Weak', audit.weakEvidenceRows]].map(([label, value]) => (
              <div key={label}>
                <div className={`text-base font-mono ${label !== 'Rows' && value > 0 ? 'text-rose-300' : 'text-zinc-100'}`}>{value ?? 0}</div>
                <div className="text-[8px] uppercase text-zinc-600">{label}</div>
              </div>
            ))}
          </div>
          {audit.invalidRows > 0 && <div className="mt-2 text-[10px] text-rose-300">{audit.invalidRows} malformed export rows require review.</div>}
        </div>

        <div className="rounded-lg border border-white/5 bg-black/20 p-3">
          <div className="mb-3 flex items-center text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <Shield className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> Modification Safety
          </div>
          <div className="space-y-1 text-[10px] text-zinc-400">
            <div className="flex justify-between"><span>Ledger</span><span className={selfMod.online ? 'text-emerald-300' : 'text-amber-300'}>{selfMod.online ? 'connected' : 'offline'}</span></div>
            <div className="flex justify-between"><span>Implemented</span><span className="font-mono text-zinc-200">{selfMod.implemented ?? 0}</span></div>
            <div className="flex justify-between"><span>Contested</span><span className="font-mono text-zinc-200">{selfMod.contestedCount ?? 0}</span></div>
            <div className="flex justify-between"><span>NEMESIS evals</span><span className="font-mono text-zinc-200">{nemesis.totalEvals ?? 0}</span></div>
          </div>
        </div>
      </div>

      {domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Competency</span>
          {domains.map(domain => (
            <span key={domain.category} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1 text-[9px] text-zinc-400">
              {domain.category}: <span className="text-cyan-300">{domain.promotionLevel}</span> ({domain.verified}/{domain.attempts})
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default CoreSystemsOverview;
