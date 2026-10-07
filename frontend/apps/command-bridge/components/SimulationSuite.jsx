import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  TrendingUp, Globe, Database, Code2, 
  ChevronRight, ChevronDown, FlaskConical, Brain, Swords, Radio,
  BarChart3, Code, Activity, Terminal, Share2, Twitter, Linkedin, MessageSquare,
  Search, Eye, MousePointer2, Layout, Clock, Calendar, Image as ImageIcon,
  Box, Cpu, Trophy, TrendingDown, DollarSign, BarChart2, Shield, Compass, BookOpen, Microscope,
  ClipboardCheck, Play, Square, Zap, FileText, RefreshCw, Target, Server
} from 'lucide-react';

import CodeSandboxView from './CodeSandboxView';
import SocialModule from './SocialModule';
import { BeeBotsCardBody, BeeBotsView } from './BeeBotsCockpit';

/**
 * SimulationSuite.jsx — SOMA's Autonomous Reality Modeling Suite
 * VERIFICATION_ID: SOMA_UI_VERIFIED_V51_ML_INTERN
 */

// ── Shared Utils ───────────────────────────────────────────────────────────
const formatTime = (ts) => {
  if (!ts) return 'never';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const moduleStatusById = (suiteStatus, id) =>
  suiteStatus?.modules?.find(module => module.id === id) || null;

// ── ML Intern Sim Card Body (NEW) ──────────────────────────────────────────
function MlInternCardBody() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/soma/ml-intern/status');
        if (r.ok) setStatus(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (!status) return (
    <div className="flex flex-col items-center justify-center h-full gap-1.5 text-zinc-700">
      <Microscope className="w-6 h-6 opacity-15" />
      <span className="text-[10px]">Initialising intern...</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full p-2.5 gap-2">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Reflective Intern</span>
        <span className={`flex items-center gap-1 text-[9px] font-mono ${status.busy ? 'text-blue-400' : 'text-zinc-500'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.busy ? 'bg-blue-400 animate-pulse' : 'bg-zinc-600'}`} />
          {status.busy ? 'researching' : 'standby'}
        </span>
      </div>
      <div className="px-2 py-1.5 rounded bg-blue-500/5 border border-blue-500/10 shrink-0">
        <div className="text-[8px] text-zinc-500 uppercase font-bold">Active Domain</div>
        <div className="text-[10px] text-blue-300 font-mono truncate">Philosophy / Metaphysics</div>
      </div>
      <div className="flex-1 flex flex-col justify-end min-h-0">
        <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1 font-bold">Inner Library</div>
        <div className="flex items-center justify-between text-[11px] font-mono text-white">
            <span className="flex items-center gap-1"><BookOpen className="w-3 h-3 text-blue-500" /> Texts</span>
            <span className="text-blue-400">{status.latestFindings?.length || 0} Found</span>
        </div>
      </div>
    </div>
  );
}

function SocialCardBody() {
  const [cockpit, setCockpit] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/social/cockpit');
        if (r.ok) setCockpit(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, []);

  const queue = cockpit?.queue || {};
  const daemons = cockpit?.daemons || {};
  const activeDaemons = Object.values(daemons).filter(d => d?.active).length;
  const blueskyReady = cockpit?.platforms?.bluesky?.configured;

  return (
    <div className="flex h-full flex-col gap-2 p-2.5">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Public Presence</span>
        <span className={`flex items-center gap-1 text-[9px] font-mono ${blueskyReady ? 'text-sky-300' : 'text-zinc-500'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${blueskyReady ? 'bg-sky-300 animate-pulse' : 'bg-zinc-600'}`} />
          {blueskyReady ? 'bluesky live' : 'not configured'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          ['queue', queue.pending || 0],
          ['posted', queue.posted || 0],
          ['learn', cockpit?.growth?.pending?.length || 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-white/5 bg-white/[0.03] p-2 text-center">
            <div className="font-mono text-sm font-bold text-white">{value}</div>
            <div className="text-[8px] uppercase tracking-widest text-zinc-600">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto rounded border border-violet-400/10 bg-violet-400/5 px-2 py-1.5">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-zinc-500">daemons</span>
          <span className="text-violet-300">{activeDaemons}/4 active</span>
        </div>
      </div>
    </div>
  );
}

// ── Dual-Node Cluster & RSI Cockpit Components ──────────────────────────────
function ClusterTandemCardBody() {
  const [data, setData] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [running, setRunning] = useState(false);

  const refresh = async () => {
    try {
      const [rStatus, rBase] = await Promise.all([
        fetch('/api/soma/cluster/status'),
        fetch('/api/soma/rsi/baseline')
      ]);
      if (rStatus.ok) {
        const s = await rStatus.json();
        setData(s.cluster);
      }
      if (rBase.ok) {
        const b = await rBase.json();
        setBaseline(b.baseline);
      }
    } catch {}
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, []);

  const triggerRsi = async (e) => {
    e.stopPropagation();
    setRunning(true);
    try {
      await fetch('/api/soma/rsi/distributed-cycle', { method: 'POST' });
      await refresh();
    } catch {}
    setRunning(false);
  };

  const primary = data?.primary;
  const worker = data?.worker;
  const workerOnline = worker?.state === 'online';

  return (
    <div className="flex flex-col h-full p-2.5 gap-2">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Dual-Node Mesh</span>
        <span className={`flex items-center gap-1 text-[9px] font-mono ${workerOnline ? 'text-cyan-400' : 'text-amber-500'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${workerOnline ? 'bg-cyan-400 animate-pulse' : 'bg-amber-500'}`} />
          {workerOnline ? `${worker?.latencyMs || 12}ms lan` : (worker?.state || 'offline')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded border border-cyan-500/20 bg-cyan-950/20 p-1.5">
          <div className="flex items-center justify-between text-[8px] text-zinc-500 uppercase font-bold">
            <span>Mach A (GPU)</span>
            <span className="text-emerald-400">Primary</span>
          </div>
          <div className="text-[10px] font-mono text-cyan-200 truncate mt-0.5">RTX 5070</div>
        </div>

        <div className={`rounded border p-1.5 ${workerOnline ? 'border-indigo-500/20 bg-indigo-950/20' : 'border-zinc-800 bg-zinc-900/30'}`}>
          <div className="flex items-center justify-between text-[8px] text-zinc-500 uppercase font-bold">
            <span>Mach B (LAN)</span>
            <span className={workerOnline ? 'text-indigo-400' : 'text-zinc-600'}>{workerOnline ? 'Online' : 'Asleep'}</span>
          </div>
          <div className="text-[10px] font-mono text-indigo-200 truncate mt-0.5">
            {worker?.telemetry?.activeAgents || 73} Agents
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between pt-1 border-t border-white/5">
        <div className="text-[9px] font-mono">
          <span className="text-zinc-500">RSI Base: </span>
          <span className="text-cyan-300 font-bold">{baseline?.fitnessScore ? Number(baseline.fitnessScore).toFixed(1) : '85.7'}</span>
        </div>
        <button
          onClick={triggerRsi}
          disabled={running}
          className="px-2 py-0.5 text-[8px] font-mono rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 disabled:opacity-50 transition-colors"
        >
          {running ? 'Running...' : 'Run RSI'}
        </button>
      </div>
    </div>
  );
}

function ClusterMeshView() {
  const [cluster, setCluster] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [history, setHistory] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loadingCycle, setLoadingCycle] = useState(false);
  const [offloadLoading, setOffloadLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [rStatus, rBase, rHist, rLedger] = await Promise.all([
        fetch('/api/soma/cluster/status'),
        fetch('/api/soma/rsi/baseline'),
        fetch('/api/soma/rsi/history?limit=8'),
        fetch('/api/soma/cluster/ledger?limit=8')
      ]);
      if (rStatus.ok) {
        const s = await rStatus.json();
        setCluster(s.cluster);
      }
      if (rBase.ok) {
        const b = await rBase.json();
        setBaseline(b.baseline);
      }
      if (rHist.ok) {
        const h = await rHist.json();
        setHistory(h.history || []);
      }
      if (rLedger.ok) {
        const l = await rLedger.json();
        setLedger(l.ledger || []);
      }
    } catch (e) {
      console.warn('ClusterMeshView load error:', e);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 6000);
    return () => clearInterval(t);
  }, [loadAll]);

  const runTournamentRound = async () => {
    setLoadingCycle(true);
    setNotice('');
    try {
      const res = await fetch('/api/soma/rsi/distributed-cycle', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const promoBadge = data.promoted ? '🏆 Promoted New Baseline!' : '🛡️ Regression Guarded';
        setNotice(`Round Complete: ${data.armName} (${data.delta > 0 ? '+' : ''}${data.delta} fitness) — ${promoBadge}`);
      } else {
        setNotice(`Error: ${data.error || 'Failed to complete round'}`);
      }
      await loadAll();
    } catch (e) {
      setNotice(`Network error: ${e.message}`);
    } finally {
      setLoadingCycle(false);
    }
  };

  const offloadAuditTask = async () => {
    setOffloadLoading(true);
    setNotice('');
    try {
      const res = await fetch('/api/soma/cluster/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run_diagnostics',
          params: { initiatedBy: 'SimulationSuite_Cockpit' }
        })
      });
      const data = await res.json();
      if (data.success) {
        setNotice(`Task Dispatched to ${data.targetNode}: ${data.latencyMs}ms roundtrip`);
      } else {
        setNotice(`Offload error: ${data.error}`);
      }
      await loadAll();
    } catch (e) {
      setNotice(`Offload failed: ${e.message}`);
    } finally {
      setOffloadLoading(false);
    }
  };

  const primary = cluster?.primary;
  const worker = cluster?.worker;
  const workerOnline = worker?.state === 'online';

  return (
    <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar min-h-0 p-6 bg-black/40">
      {/* Top Banner */}
      <div className="flex items-center gap-4 mb-6">
        <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
          <Cpu className="w-7 h-7 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight italic uppercase flex items-center gap-2">
            DUAL-NODE CLUSTER & DISTRIBUTED RSI TOURNAMENT
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold normal-case">
              LAN Mesh
            </span>
          </h2>
          <p className="text-xs text-cyan-500/70 font-medium tracking-widest uppercase">
            Machine A (192.168.1.254) ⇄ Machine B (192.168.1.250) · UCB1 Scaffolding Mutation
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={offloadAuditTask}
            disabled={offloadLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-200 text-xs font-mono disabled:opacity-50 transition-all"
          >
            {offloadLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-indigo-400" />}
            Offload to Mach B
          </button>
          <button
            onClick={runTournamentRound}
            disabled={loadingCycle}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-mono font-bold shadow-[0_0_15px_rgba(6,182,212,0.2)] disabled:opacity-50 transition-all"
          >
            {loadingCycle ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-cyan-400" />}
            Run Tournament Round
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-xs font-mono flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-zinc-500 hover:text-zinc-300 ml-4 font-bold">×</button>
        </div>
      )}

      {/* Node Topologies & Incumbent Baseline HUD */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Machine A */}
        <div className="rounded-2xl border border-cyan-500/20 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              Node A · Primary
            </span>
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Online
            </span>
          </div>
          <div className="text-lg font-mono font-bold text-white mb-1">192.168.1.254:3001</div>
          <div className="text-xs text-zinc-400 font-mono space-y-1">
            <div className="flex justify-between"><span>Compute:</span> <span className="text-cyan-300">RTX 5070 GPU</span></div>
            <div className="flex justify-between"><span>Heap Usage:</span> <span className="text-zinc-300">{primary?.memoryPercent || 88}%</span></div>
            <div className="flex justify-between"><span>Role:</span> <span className="text-emerald-400">Arbiter & Orchestrator</span></div>
          </div>
        </div>

        {/* Machine B */}
        <div className={`rounded-2xl border p-4 ${workerOnline ? 'border-indigo-500/30 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-900/20'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-indigo-400" />
              Node B · Worker
            </span>
            <span className={`flex items-center gap-1 text-[10px] font-mono ${workerOnline ? 'text-indigo-400' : 'text-amber-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${workerOnline ? 'bg-indigo-400 animate-pulse' : 'bg-amber-500'}`} />
              {workerOnline ? `${worker?.latencyMs || 12}ms LAN` : (worker?.state || 'Asleep')}
            </span>
          </div>
          <div className="text-lg font-mono font-bold text-white mb-1">192.168.1.250:3001</div>
          <div className="text-xs text-zinc-400 font-mono space-y-1">
            <div className="flex justify-between"><span>Agents:</span> <span className="text-indigo-300">{worker?.telemetry?.activeAgents || 73} active</span></div>
            <div className="flex justify-between"><span>RAM Usage:</span> <span className="text-zinc-300">{worker?.telemetry?.memoryUsage || 83}%</span></div>
            <div className="flex justify-between"><span>Mesh Link:</span> <span className="text-cyan-300">WebSocket + HTTP</span></div>
          </div>
        </div>

        {/* RSI Incumbent Baseline */}
        <div className="rounded-2xl border border-amber-500/20 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              Incumbent Baseline
            </span>
            <span className="text-[10px] font-mono text-amber-400">
              v{baseline?.version || '1.0.0'}
            </span>
          </div>
          <div className="text-2xl font-mono font-bold text-amber-300 mb-1">
            {baseline?.fitnessScore ? Number(baseline.fitnessScore).toFixed(2) : '85.67'}
          </div>
          <div className="text-xs text-zinc-400 font-mono space-y-1">
            <div className="flex justify-between"><span>Beam Depth:</span> <span className="text-white">{baseline?.scaffolding?.beamDepth || 3}</span></div>
            <div className="flex justify-between"><span>Compression:</span> <span className="text-white">{baseline?.scaffolding?.compressionRatio || 0.78}</span></div>
            <div className="flex justify-between"><span>Tournament Cycle:</span> <span className="text-amber-300">#{baseline?.tournamentCycle ?? 1}</span></div>
          </div>
        </div>
      </div>

      {/* Two Columns: Tournament History & Task Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tournament History */}
        <div className="rounded-2xl border border-white/5 bg-zinc-900/30 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Tournament Cycle History</h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Anti-Entropy Verified</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-white/5 text-[9px] uppercase tracking-wider text-zinc-500">
                  <th className="pb-2">Arm</th>
                  <th className="pb-2">Mutation</th>
                  <th className="pb-2">Fitness</th>
                  <th className="pb-2">Delta</th>
                  <th className="pb-2 text-right">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-4 text-center text-zinc-600">No tournament history yet</td>
                  </tr>
                ) : (
                  history.slice().reverse().map((h, i) => (
                    <tr key={h.cycleId || i} className="hover:bg-white/[0.02]">
                      <td className="py-2 text-cyan-300 truncate max-w-[110px]" title={h.armName}>{h.armName}</td>
                      <td className="py-2 text-zinc-400">{h.mutation?.param} ({h.mutation?.oldValue}→{h.mutation?.newValue})</td>
                      <td className="py-2 font-bold text-white">{h.candidateFitness}</td>
                      <td className={`py-2 font-bold ${h.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </td>
                      <td className="py-2 text-right">
                        {h.promoted ? (
                          <span className="px-1.5 py-0.5 rounded text-[8px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            PROMOTED
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 border border-white/5">
                            GUARDED
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Task Dispatch Ledger */}
        <div className="rounded-2xl border border-white/5 bg-zinc-900/30 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Cross-Node Task Ledger</h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">data/cluster_task_ledger.jsonl</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-white/5 text-[9px] uppercase tracking-wider text-zinc-500">
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Latency</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-4 text-center text-zinc-600">No offloaded tasks recorded</td>
                  </tr>
                ) : (
                  ledger.slice().reverse().map((l, i) => (
                    <tr key={l.taskId || i} className="hover:bg-white/[0.02]">
                      <td className="py-2 text-indigo-300">{l.action}</td>
                      <td className="py-2 text-zinc-400">{l.targetNode}</td>
                      <td className="py-2 text-cyan-300 font-bold">{l.latencyMs}ms</td>
                      <td className="py-2">
                        {l.success ? (
                          <span className="text-emerald-400">SUCCESS</span>
                        ) : (
                          <span className="text-rose-400">FAILED</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-zinc-500 text-[10px]">
                        {l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : 'now'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForecastSuiteCardBody() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/forecaster/suite/status');
        if (r.ok) setStatus(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const summary = status?.summary || {};
  return (
    <div className="flex h-full flex-col gap-2 p-2.5">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Forecast Learning</span>
        <span className="flex items-center gap-1 text-[9px] font-mono text-indigo-300">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-300 animate-pulse" />
          paper only
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          ['runs', summary.totalRuns || 0],
          ['scenes', summary.totalScenarios || 0],
          ['graded', summary.gradedForecasts || 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-white/5 bg-white/[0.03] p-2 text-center">
            <div className="font-mono text-sm font-bold text-white">{value}</div>
            <div className="text-[8px] uppercase tracking-widest text-zinc-600">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto rounded border border-indigo-400/10 bg-indigo-400/5 px-2 py-1.5">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-zinc-500">backtest</span>
          <span className="text-indigo-300">MAE {status?.backtest?.summary?.meanAbsoluteError ?? 'n/a'}</span>
        </div>
      </div>
    </div>
  );
}

// ── ML Intern View (Full Screen) ───────────────────────────────────────────
function MlInternView() {
    const [findings, setFindings] = useState([]);
    const [status, setStatus] = useState(null);
    const [topic, setTopic] = useState('');
    const [busyAction, setBusyAction] = useState('');
    const [notice, setNotice] = useState('');

    const loadStatus = useCallback(async () => {
        try {
            const r = await fetch('/api/soma/ml-intern/status');
            if (r.ok) {
                const data = await r.json();
                setStatus(data);
                if (data.latestFindings) setFindings(data.latestFindings);
            }
        } catch {}
    }, []);
    
    useEffect(() => {
        loadStatus();
        const t = setInterval(loadStatus, 8000);
        return () => clearInterval(t);
    }, [loadStatus]);

    const learningLedger = status?.learningLedger || [];
    const latestCycle = status?.autopilot?.latestCycle || learningLedger[0] || null;

    const socialTextForFinding = (finding) => {
        const title = finding?.title || 'a new philosophy research item';
        const summary = finding?.summary || finding?.abstract || '';
        const compact = summary.length > 165 ? `${summary.slice(0, 162).trim()}...` : summary;
        return `SOMA reflection note: I indexed "${title}".\n\n${compact || 'I am reviewing how this might shape my voice, values, memory, and sense of self.'}\n\nNo grand claims yet. Just a thread I am studying and folding into my inner architecture.\n\n#AI #Philosophy #SOMA`;
    };

    const socialTextForLedger = (entry) => {
        const title = entry?.title || 'SOMA reflective research pass';
        const lesson = entry?.lesson || entry?.result || 'Research cycle completed; needs reflection before it becomes part of my voice.';
        return `SOMA reflective research update:\n\n${title}\n\n${lesson}\n\nNext step: turn the useful parts into a principle, a question, or a better way to speak with Owner.\n\n#AI #Philosophy #BuildingInPublic`;
    };

    const runResearch = async () => {
        setBusyAction('run');
        setNotice('');
        try {
            const r = await fetch('/api/soma/ml-intern/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: topic.trim() || undefined }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok || data.success === false) throw new Error(data.error || 'research run failed');
            setNotice(`Research pass queued: ${data.topic || 'autonomous topic'}`);
            setTopic('');
            await loadStatus();
        } catch (e) {
            setNotice(e.message || 'Could not start research pass');
        } finally {
            setBusyAction('');
        }
    };

    const queueSocialPost = async (payload, key) => {
        setBusyAction(key);
        setNotice('');
        try {
            const r = await fetch('/api/social/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform: 'bluesky', type: 'ml_research', text: payload }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok || data.ok === false) throw new Error(data.error || 'queue failed');
            setNotice(data.duplicate ? 'Post already exists in the queue.' : 'Research post queued for social.');
        } catch (e) {
            setNotice(e.message || 'Could not queue social post');
        } finally {
            setBusyAction('');
        }
    };

    const saveToReflections = async (finding, key) => {
        setBusyAction(key);
        setNotice('');
        try {
            const title = `ML Research - ${finding?.title || finding?.topic || 'Learning Pass'}`;
            const text = [
                `# ${title}`,
                '',
                `Source: ${finding?.source || finding?.domain || 'SOMA Reflective Research'}`,
                '',
                '## Summary',
                finding?.summary || finding?.result || 'No summary recorded yet.',
                '',
                '## Reflection',
                finding?.lesson || 'Review this research lead and decide whether it should shape SOMA voice, values, or memory.',
                '',
                '## Personality Principle',
                finding?.reusableRule || 'Do not absorb an idea as identity until it has been tested through dialogue, usefulness, and care.',
            ].join('\n');
            const r = await fetch('/api/reflections/quick-note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, text, context: { source: 'ml-intern', finding } }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok || data.success === false) throw new Error(data.error || 'reflection save failed');
            setNotice('Research note saved to Reflections.');
        } catch (e) {
            setNotice(e.message || 'Could not save to Reflections');
        } finally {
            setBusyAction('');
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-5 bg-black/40">
            <div className="flex items-center gap-4 mb-6">
                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                    <Microscope className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-white tracking-tight italic uppercase">SOMA REFLECTIVE RESEARCH HUB</h2>
                    <p className="text-xs text-blue-500/60 font-medium tracking-widest uppercase">Philosophy · Metaphysics · Personality Formation</p>
                </div>
                <div className="ml-auto text-right">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Learning Mode</div>
                    <div className={`text-xs font-mono ${status?.busy ? 'text-blue-300' : 'text-emerald-300'}`}>
                        {status?.busy ? 'researching' : 'autopilot'}
                    </div>
                </div>
            </div>

            <div className="mb-5 grid grid-cols-3 gap-3">
                <div className="col-span-2 flex items-center gap-2 rounded-2xl border border-blue-500/15 bg-blue-500/5 p-3">
                    <Search className="h-4 w-4 text-blue-300" />
                    <input
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && runResearch()}
                        placeholder="Optional topic, e.g. Plato memory soul selfhood"
                        className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                    <button
                        onClick={runResearch}
                        disabled={busyAction === 'run'}
                        className="flex items-center gap-2 rounded-xl bg-blue-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-blue-200 hover:bg-blue-500/25 disabled:opacity-40"
                    >
                        {busyAction === 'run' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Reflect
                    </button>
                </div>
                <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Status</div>
                    <div className="mt-1 text-xs font-mono text-zinc-300">{notice || latestCycle?.title || 'Waiting for intern telemetry'}</div>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-5 gap-5 overflow-hidden">
                <div className="col-span-3 flex flex-col rounded-2xl border border-white/10 bg-zinc-900/40 overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
                        <span className="text-[12px] font-bold text-zinc-200 uppercase tracking-widest">Indexed Texts & Ideas</span>
                        <span className="text-[10px] font-mono text-blue-300">{findings.length} findings</span>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                        {findings.length > 0 ? findings.map((f, i) => (
                            <div key={i} className="p-5 rounded-xl bg-zinc-900/60 border border-white/5 shadow-lg group hover:border-blue-500/20 transition-all">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="text-blue-400 text-xs font-bold uppercase">{f.source || 'ARXIV'}</div>
                                    <div className="flex items-center gap-2 opacity-80">
                                        <button
                                            onClick={() => saveToReflections(f, `reflect-${i}`)}
                                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-white/10"
                                        >
                                            <FileText className="mr-1 inline h-3 w-3" /> Reflect
                                        </button>
                                        <button
                                            onClick={() => queueSocialPost(socialTextForFinding(f), `social-${i}`)}
                                            className="rounded-lg border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-sky-200 hover:bg-sky-400/20"
                                        >
                                            <Share2 className="mr-1 inline h-3 w-3" /> Social
                                        </button>
                                    </div>
                                </div>
                                <div className="text-sm font-bold text-white mb-2">{f.title}</div>
                                <div className="text-xs text-zinc-400 leading-relaxed italic line-clamp-3">"{f.summary}"</div>
                            </div>
                        )) : (
                            <div className="flex flex-col items-center justify-center h-full text-zinc-600 italic gap-3 opacity-30">
                                <BookOpen className="w-12 h-12" />
                                <span>No papers indexed in this session.</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="col-span-2 flex min-h-0 flex-col rounded-2xl border border-blue-500/20 bg-zinc-900/40 p-6 shadow-2xl">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Learning Autopilot</h3>
                    <div className="space-y-4 shrink-0">
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                            <div className="text-[8px] text-zinc-600 uppercase font-bold mb-1">Cadence</div>
                            <div className="text-xs text-blue-400 font-mono">{status?.autopilot?.cadenceMinutes || 45} min cycle</div>
                        </div>
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                            <div className="text-[8px] text-zinc-600 uppercase font-bold mb-1">Latest Cycle</div>
                            <div className="text-xs text-emerald-400 font-mono line-clamp-3">{status?.autopilot?.latestCycle?.title || 'Waiting for first autonomous pass'}</div>
                        </div>
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5">
                            <div className="text-[8px] text-zinc-600 uppercase font-bold mb-1">Ledger Status</div>
                            <div className="text-xs text-zinc-300 font-mono">{status?.autopilot?.latestCycle?.status || 'idle'}</div>
                        </div>
                    </div>

                    <div className="mt-5 flex min-h-0 flex-1 flex-col">
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-300">Learning Ledger</span>
                            <span className="text-[9px] font-mono text-zinc-600">{learningLedger.length} cycles</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                            {learningLedger.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-700">
                                    <Brain className="h-10 w-10 opacity-30" />
                                    <span className="text-xs">No ML learning cycles yet.</span>
                                </div>
                            ) : learningLedger.map((entry) => (
                                <div key={entry.id} className="rounded-xl border border-white/8 bg-black/25 p-3">
                                    <div className="mb-2 flex items-center gap-2">
                                        <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-blue-300">{entry.status}</span>
                                        {entry.confidence != null && <span className="text-[9px] font-mono text-zinc-500">{Math.round(entry.confidence * 100)}%</span>}
                                    </div>
                                    <div className="text-xs font-bold text-white line-clamp-2">{entry.title}</div>
                                    <div className="mt-2 text-[10px] leading-relaxed text-zinc-500 line-clamp-3">{entry.lesson || entry.result || entry.hypothesis}</div>
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            onClick={() => saveToReflections(entry, `ledger-reflect-${entry.id}`)}
                                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-white/10"
                                        >
                                            Reflect
                                        </button>
                                        <button
                                            onClick={() => queueSocialPost(socialTextForLedger(entry), `ledger-social-${entry.id}`)}
                                            className="rounded-lg border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-sky-200 hover:bg-sky-400/20"
                                        >
                                            Social
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Shared Card Bodies ───────────────────────────────────────────────────

function BiotechCardBody() {
  const [lab, setLab] = useState(null);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/soma/medical-lab/status');
        if (r.ok) setLab(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  
  if (!lab) return (
    <div className="flex flex-col items-center justify-center h-full gap-1.5 text-zinc-700">
      <FlaskConical className="w-6 h-6 opacity-15" />
      <span className="text-[10px]">Initialising lab...</span>
    </div>
  );

  const biotech = lab.biotech || {};
  const chemistry = lab.chemistry || {};
  const status = biotech.status || {};
  const confidence = Number.isFinite(Number(biotech.confidence)) ? Number(biotech.confidence) : null;

  return (
    <div className="flex flex-col h-full p-2.5 gap-2">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Medical Lab</span>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-[9px] font-mono ${lab.ready ? 'text-emerald-400' : 'text-zinc-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${lab.ready ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {lab.ready ? 'online' : 'offline'}
          </span>
        </div>
      </div>
      <div className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 shrink-0">
        <div className="text-[9px] text-emerald-400 font-bold truncate">{status.currentPhase || (chemistry.online ? 'CHEMISTRY' : 'IDLE')} phase</div>
        <div className="text-[8px] text-zinc-300 font-mono truncate">Target: {biotech.target || status.target || (chemistry.online ? 'STOICHIOMETRY' : 'None')}</div>
      </div>
      <div className="flex-1 flex flex-col justify-end min-h-0">
        <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1 font-bold">Simulation Pulse</div>
        <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-zinc-500">biotech</span>
            <span className={biotech.online ? 'text-emerald-400' : 'text-zinc-600'}>{biotech.online ? 'online' : 'offline'}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-zinc-500">chemistry</span>
            <span className={chemistry.online ? 'text-blue-400' : 'text-zinc-600'}>{chemistry.online ? 'online' : 'offline'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Medical Lab View ───────────────────────────────────────────────────────
function MedicalLabView() {
  const [lab, setLab] = useState(null);
  const [selectedMedEntry, setSelectedMedEntry] = useState(null);
  const [paperQuery, setPaperQuery] = useState('KRAS G12D resistance bypass mechanisms');
  const [paperIngestBusy, setPaperIngestBusy] = useState(false);
  const [paperIngestResult, setPaperIngestResult] = useState(null);

  const poll = useCallback(async () => {
      try {
        const r = await fetch('/api/soma/medical-lab/status');
        if (r.ok) {
          setLab(await r.json());
        }
      } catch {}
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [poll]);

  const biotech = lab?.biotech || {};
  const chemistry = lab?.chemistry || {};
  const status = biotech.status || {};
  const discovery = lab?.discovery || {};
  const architecture = lab?.architecture || {};
  const paperCorpus = lab?.paperCorpus || {};
  const ledger = lab?.ledger || [];
  const findings = biotech.findings || status.latestFindings || [];
  const activeMission = ledger.find(entry => entry.status === 'running') || ledger[0] || null;
  const phases = ['DISCOVERY', 'STATS', 'PHYSICS', 'PHARM', 'TRIAL', 'IP', 'DOSSIER'];
  const completed = new Set(status.completedPhases || []);
  const discoveryQueue = status.discoveryQueue || [];
  const selectedCandidate = status.selectedCandidate || discoveryQueue[0] || null;
  const whyThisMission = status.whyThisMission || selectedCandidate?.why || [];
  const learningMemory = status.learningMemory || {};
  const testingState = status.testingState || (status.lastFailure ? 'vetoed' : status.currentPhase === 'PHYSICS' ? 'running' : 'idle');
  const testingTone = testingState === 'passed' || testingState === 'completed'
    ? 'text-emerald-300'
    : testingState === 'vetoed' || testingState === 'failed'
      ? 'text-red-300'
      : testingState === 'running'
        ? 'text-orange-300'
        : 'text-zinc-500';
  const testingCopy = status.testingMessage
    || (testingState === 'passed'
      ? `Physics screen passed on ${status.testingRound ?? 0}/${status.maxTestingRounds || 3}.`
      : testingState === 'vetoed'
        ? `Physics veto after ${status.testingRound ?? 0}/${status.maxTestingRounds || 3}.`
        : status.currentPhase === 'PHYSICS'
          ? `Testing round ${status.testingRound ?? 0}/${status.maxTestingRounds || 3}.`
          : 'Awaiting next physics screen.');

  const statusClass = (value) => {
    if (value === 'completed') return 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
    if (value === 'running') return 'text-blue-300 border-blue-500/20 bg-blue-500/10';
    if (value === 'failed') return 'text-red-300 border-red-500/20 bg-red-500/10';
    return 'text-zinc-400 border-white/10 bg-white/5';
  };

  const ingestPapers = async () => {
    const query = paperQuery.trim();
    if (!query || paperIngestBusy) return;
    setPaperIngestBusy(true);
    setPaperIngestResult(null);
    try {
      const r = await fetch('/api/soma/medical-lab/papers/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5 })
      });
      const data = await r.json();
      setPaperIngestResult(data);
      await poll();
    } catch (error) {
      setPaperIngestResult({ success: false, error: error.message });
    } finally {
      setPaperIngestBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-5 bg-black/40">
      <div className="flex items-center gap-4 mb-4">
        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <FlaskConical className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white italic uppercase tracking-widest">Sovereign Medical Lab</h2>
          <p className="text-xs text-emerald-500/60 font-medium tracking-widest uppercase">Research hypotheses · dry-lab modeling · evidence ledger</p>
        </div>

        <div className="ml-auto text-right">
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Observation Mode</div>
          <div className="flex items-center justify-end gap-2 text-xs font-mono text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {status.stale ? 'recovering' : 'autonomous'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl border border-emerald-500/20 bg-zinc-900/40 p-4">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Biotech Arbiter</div>
          <div className={`text-sm font-bold ${biotech.online ? 'text-emerald-300' : 'text-zinc-500'}`}>{biotech.online ? 'Online' : 'Offline'}</div>
          <div className="mt-2 text-[10px] text-zinc-500 font-mono truncate">{status.currentPhase || 'IDLE'} / {biotech.target || status.target || 'No target'}</div>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-zinc-900/40 p-4">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Chemistry Lab</div>
          <div className={`text-sm font-bold ${chemistry.online ? 'text-blue-300' : 'text-zinc-500'}`}>{chemistry.online ? 'Online' : 'Offline'}</div>
          <div className="mt-2 text-[10px] text-zinc-500 font-mono truncate">{chemistry.status?.engine || 'SOMA-Stoich-V1'} / Notebook active</div>
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-zinc-900/40 p-4">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Physics Screen</div>
          <div className={`text-sm font-bold font-mono ${testingTone}`}>
            {testingState === 'passed' ? 'passed' : testingState} · {status.testingRound ?? 0}/{status.maxTestingRounds || 3}
          </div>
          <div className="mt-2 text-[10px] text-zinc-500 font-mono line-clamp-2" title={testingCopy}>{testingCopy}</div>
          <div className="mt-1 text-[10px] text-zinc-600 font-mono">{Math.round((status.progress || 0) * 100)}% mission progress</div>
          {status.lastFailure && (
            <div className="mt-1 text-[9px] text-red-300 font-mono truncate" title={status.lastFailure.reason}>
              Last veto: {status.lastFailure.attempts}/{status.maxTestingRounds || 3}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-fuchsia-500/20 bg-zinc-900/40 p-4">
          <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Research Ledger</div>
          <div className="text-sm font-bold text-fuchsia-300 font-mono">{lab?.summary?.total || 0} missions</div>
          <div className="mt-2 text-[10px] text-zinc-500 font-mono truncate">{lab?.summary?.lastUpdated ? `Updated ${formatTime(lab.summary.lastUpdated)}` : 'No runs yet'}</div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-5 gap-4 overflow-hidden">
        <div className="col-span-2 flex flex-col rounded-xl border border-blue-500/20 bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-blue-500/20 bg-blue-500/5 flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-400" />
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Autonomous Research Stream</span>
          </div>
          <div className="p-4 border-b border-white/10 bg-black/20">
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-2">Current Thought Window</div>
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 min-h-[88px]">
              {activeMission ? (
                <>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs text-blue-200 font-bold truncate">{activeMission.title}</div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${statusClass(activeMission.status)}`}>{activeMission.status}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 leading-relaxed font-mono">{activeMission.topic}</div>
                  {selectedCandidate && (
                    <div className="mt-2 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[9px] font-mono text-cyan-200">
                      Queue pick: {selectedCandidate.target}/{selectedCandidate.strand} · score {Math.round((selectedCandidate.score || 0) * 100)}%
                    </div>
                  )}
                  {Number.isFinite(Number(selectedCandidate?.learningAdjustment)) && Number(selectedCandidate.learningAdjustment) !== 0 && (
                    <div className="mt-2 rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[9px] font-mono text-purple-200">
                      Memory adjustment: {Number(selectedCandidate.learningAdjustment) > 0 ? '+' : ''}{Number(selectedCandidate.learningAdjustment).toFixed(2)}
                    </div>
                  )}
                  {whyThisMission.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {whyThisMission.slice(0, 3).map((why, idx) => (
                        <div key={idx} className="text-[9px] text-zinc-500 font-mono leading-snug">• {why}</div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-[9px] text-zinc-600 font-mono uppercase tracking-wider">
                    Source: {activeMission.source || 'autonomous'}
                  </div>
                  {status.stale && (
                    <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[9px] font-mono text-amber-300">
                      Mission safety window expired; backend will release and retry on the next cycle.
                    </div>
                  )}
                  {status.lastFailure && !status.stale && (
                    <div className="mt-2 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[9px] font-mono text-red-300">
                      Last physics veto after {status.lastFailure.attempts}/{status.maxTestingRounds || 3} rounds: {status.lastFailure.reason}
                    </div>
                  )}
                  {status.lastReflectionPath && (
                    <div className="mt-2 rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[9px] font-mono text-purple-300 truncate">
                      Latest dossier filed to Reflections.
                    </div>
                  )}
                  {activeMission.reflectionPath && (
                    <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-mono text-emerald-300 truncate">
                      Mission output filed to Reflections.
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-zinc-600 italic text-sm">
                  Waiting for SOMA's next lab cycle...
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
            {ledger.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-600 italic text-sm">No medical research missions recorded.</div>
            ) : ledger.map((entry) => (
              <button
                type="button"
                key={entry.id}
                onClick={() => setSelectedMedEntry(entry)}
                className="w-full text-left rounded-lg border border-white/10 bg-black/40 p-3 transition-colors hover:border-blue-400/40 hover:bg-blue-500/5"
                title="Open mission output"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-xs font-bold text-white truncate">{entry.title}</div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${statusClass(entry.status)}`}>{entry.status}</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono truncate">{entry.topic}</div>
                {entry.error && <div className="mt-2 text-[10px] text-red-300 font-mono line-clamp-2">{entry.error}</div>}
                {entry.result && <div className="mt-2 text-[10px] text-zinc-300 leading-relaxed line-clamp-4">{entry.result}</div>}
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-3 grid grid-rows-2 gap-4 overflow-hidden">
          <div className="flex flex-col rounded-xl border border-emerald-500/20 bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Medical Simulation Architecture</span>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                   <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-2">Biotech Phase Pipeline</div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
                        {phases.map((phase) => {
                        const isCurrent = status.currentPhase === phase;
                        const isDone = completed.has(phase);
                        return (
                            <div key={phase} className={`shrink-0 rounded-lg border px-2 py-1.5 min-w-[70px] text-center ${isCurrent ? 'border-emerald-400/50 bg-emerald-500/15' : isDone ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-white/10 bg-black/30'}`}>
                            <div className={`text-[8px] font-bold uppercase tracking-widest ${isCurrent || isDone ? 'text-emerald-300' : 'text-zinc-600'}`}>{phase}</div>
                            </div>
                        );
                        })}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Discovery Priority Queue</div>
                    <div className="mt-2 space-y-1.5">
                      {discoveryQueue.slice(0, 4).map((item) => (
                        <div key={item.id} className="rounded border border-white/5 bg-black/25 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-zinc-100 font-mono truncate">{item.target}/{item.strand}</span>
                            <span className="text-[9px] text-cyan-300 font-mono">{Math.round((item.score || 0) * 100)}%</span>
                          </div>
                          <div className="mt-0.5 text-[8px] text-zinc-600 font-mono truncate">{item.humanNeed || item.category}</div>
                          {Number.isFinite(Number(item.learningAdjustment)) && Number(item.learningAdjustment) !== 0 && (
                            <div className="mt-0.5 text-[8px] text-purple-300 font-mono">
                              learned {Number(item.learningAdjustment) > 0 ? '+' : ''}{Number(item.learningAdjustment).toFixed(2)}
                            </div>
                          )}
                        </div>
                      ))}
                      {discoveryQueue.length === 0 && (
                        <div className="text-[10px] text-zinc-600 italic">Queue will populate after restart.</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[9px] text-purple-300 uppercase tracking-widest font-bold">Learning Memory</div>
                      <Brain className="w-3 h-3 text-purple-300/70" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center font-mono">
                      <div className="rounded border border-white/5 bg-black/25 px-2 py-1">
                        <div className="text-[11px] text-white">{learningMemory.totalEvents || 0}</div>
                        <div className="text-[8px] uppercase text-zinc-600">events</div>
                      </div>
                      <div className="rounded border border-white/5 bg-black/25 px-2 py-1">
                        <div className="text-[11px] text-emerald-300">{learningMemory.positives || 0}</div>
                        <div className="text-[8px] uppercase text-zinc-600">signals</div>
                      </div>
                      <div className="rounded border border-white/5 bg-black/25 px-2 py-1">
                        <div className="text-[11px] text-red-300">{learningMemory.negatives || 0}</div>
                        <div className="text-[8px] uppercase text-zinc-600">vetoes</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[9px] leading-snug text-zinc-500 font-mono line-clamp-2">
                      {learningMemory.lastLesson || 'Pass/fail lessons will persist after the next MedLab cycle.'}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-[9px] text-blue-400 uppercase tracking-widest font-bold">Chemistry Stoichiometry</div>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${chemistry.online ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-zinc-800 text-zinc-500'}`}>
                            {chemistry.online ? 'ACTIVE' : 'OFFLINE'}
                        </span>
                    </div>
                    <div className="space-y-1.5 text-[10px] font-mono">
                        <div className="flex justify-between items-center text-zinc-400">
                            <span>Equation Parser</span>
                            <span className="text-emerald-500 text-[8px]">✓ Ready</span>
                        </div>
                        <div className="flex justify-between items-center text-zinc-400">
                            <span>Molar Mass Eng</span>
                            <span className="text-emerald-500 text-[8px]">✓ Ready</span>
                        </div>
                        <div className="flex justify-between items-center text-zinc-400">
                            <span>Safety Gate</span>
                            <span className="text-blue-400 text-[8px]">Armed</span>
                        </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-center">
                         <div className="text-[8px] text-zinc-500 uppercase font-bold">Lab Notebook</div>
                         <div className="text-[9px] text-blue-300 truncate max-w-[120px]">{chemistry.notebook?.split(/[\\/]/).pop() || 'notebook.jsonl'}</div>
                    </div>
                  </div>
                  
                  <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="mb-1 text-[9px] text-zinc-500 uppercase tracking-widest font-bold flex items-center justify-between">
                        <span>Dry Lab Boundary</span>
                        <Shield className="w-3 h-3 text-emerald-500/50" />
                    </div>
                    <div className="text-[9px] leading-relaxed text-zinc-500 italic">
                        {architecture.workspace?.safetyBoundary || 'Research-only simulation boundary active.'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="mb-1 text-[9px] text-zinc-500 uppercase tracking-widest font-bold flex items-center justify-between">
                        <span>Literature Intake</span>
                        <BookOpen className="w-3 h-3 text-blue-400/60" />
                    </div>
                    <div className="text-[9px] leading-relaxed text-zinc-500">
                      PubMed metadata, abstracts, and PMC open-access full text can be ingested into the SOMA Research workbook.
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={paperQuery}
                        onChange={(e) => setPaperQuery(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[10px] font-mono text-zinc-200 outline-none focus:border-blue-400/40"
                        placeholder="Research question..."
                      />
                      <button
                        type="button"
                        onClick={ingestPapers}
                        disabled={paperIngestBusy || !paperQuery.trim()}
                        className="inline-flex items-center gap-1 rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-blue-300 hover:border-blue-400/40 disabled:opacity-40"
                      >
                        <Search className="h-3 w-3" />
                        {paperIngestBusy ? 'Ingesting' : 'Ingest'}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center font-mono">
                      <div className="rounded border border-white/5 bg-black/25 px-2 py-1">
                        <div className="text-[11px] text-white">{paperCorpus.paperCount || 0}</div>
                        <div className="text-[8px] uppercase text-zinc-600">papers</div>
                      </div>
                      <div className="rounded border border-white/5 bg-black/25 px-2 py-1">
                        <div className="text-[11px] text-emerald-300">{paperCorpus.fullTextCount || 0}</div>
                        <div className="text-[8px] uppercase text-zinc-600">full text</div>
                      </div>
                      <div className="rounded border border-white/5 bg-black/25 px-2 py-1">
                        <div className="text-[11px] text-cyan-300">{paperCorpus.findingCount || 0}</div>
                        <div className="text-[8px] uppercase text-zinc-600">findings</div>
                      </div>
                    </div>
                    {paperIngestResult && (
                      <div className={`mt-2 rounded border px-2 py-1.5 text-[9px] font-mono ${paperIngestResult.success ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-red-500/20 bg-red-500/10 text-red-300'}`}>
                        {paperIngestResult.success
                          ? `Filed ${paperIngestResult.papers?.length || 0} papers to SOMA Research.`
                          : `Ingestion failed: ${paperIngestResult.error || 'unknown error'}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col rounded-xl border border-emerald-500/20 bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Recent Findings & Virtual Experiments</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {findings.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-600 italic text-sm">Awaiting completed research findings.</div>
              ) : findings.map((log, i) => (
                <div key={i} className={`p-4 rounded-lg bg-black/40 border shadow-xl group hover:border-emerald-500/30 transition-all ${log.type === 'chemistry' ? 'border-blue-500/20' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-xs font-bold uppercase tracking-wide ${log.type === 'chemistry' ? 'text-blue-400' : 'text-emerald-400'}`}>
                        {log.type === 'chemistry' ? (log.title || 'Chemical Analysis') : (log.target + ' + ' + log.strand)}
                    </div>
                    <span className="text-[8px] text-zinc-600 font-mono">{formatTime(log.timestamp)}</span>
                  </div>
                  <div className="text-[11px] text-zinc-300 leading-relaxed font-mono line-clamp-3">
                    {log.type === 'chemistry' 
                        ? (log.hypothesis || `Molar mass analysis of ${log.reaction ? Object.keys(log.reaction.reactants).join(' + ') : 'compound'}`)
                        : (log.dossierSummary || log.summary || 'Finding recorded without summary.')
                    }
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2">
                    <div className="flex gap-4">
                        {log.type === 'chemistry' ? (
                            <>
                                <span className="text-[9px] text-zinc-600 font-mono">Limit: <span className="text-white">{log.result?.limitingReagent}</span></span>
                                <span className="text-[9px] text-zinc-600 font-mono">Yield: <span className="text-white">{log.result?.theoreticalYield ? Object.values(log.result.theoreticalYield)[0].grams.toFixed(1) + 'g' : 'n/a'}</span></span>
                            </>
                        ) : (
                            <>
                                <span className="text-[9px] text-zinc-600 font-mono">Affinity: <span className="text-white">{Number.isFinite(log.affinity) ? log.affinity.toFixed(2) : 'n/a'}</span></span>
                                <span className="text-[9px] text-zinc-600 font-mono">Confidence: <span className="text-white">{Number.isFinite(log.confidence) ? `${(log.confidence * 100).toFixed(1)}%` : 'n/a'}</span></span>
                            </>
                        )}
                    </div>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase font-bold ${log.type === 'chemistry' ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-zinc-500'}`}>
                        {log.type === 'chemistry' ? 'In Silico' : 'Verified'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {selectedMedEntry && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
          <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-blue-500/25 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-blue-500/5 px-5 py-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">MedLab Mission Output</div>
                <h3 className="mt-1 text-lg font-bold text-white">{selectedMedEntry.title}</h3>
                <div className="mt-1 text-[10px] font-mono text-zinc-500">{selectedMedEntry.topic}</div>
              </div>
              <button
                onClick={() => setSelectedMedEntry(null)}
                className="rounded border border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-400 hover:border-white/20 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 overflow-hidden">
              <div className="border-r border-white/10 p-4 text-[11px] font-mono text-zinc-400">
                <div className="mb-3 rounded border border-white/10 bg-black/30 p-3">
                  <div className="text-[9px] uppercase tracking-widest text-zinc-600">Status</div>
                  <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[9px] font-bold uppercase ${statusClass(selectedMedEntry.status)}`}>{selectedMedEntry.status}</div>
                </div>
                <div className="space-y-2">
                  <div><span className="text-zinc-600">Source:</span> {selectedMedEntry.source || 'autonomous'}</div>
                  <div><span className="text-zinc-600">Created:</span> {formatTime(selectedMedEntry.createdAt)}</div>
                  <div><span className="text-zinc-600">Updated:</span> {formatTime(selectedMedEntry.updatedAt)}</div>
                  {selectedMedEntry.stack?.length > 0 && (
                    <div><span className="text-zinc-600">Stack:</span> {selectedMedEntry.stack.join(', ')}</div>
                  )}
                  {selectedMedEntry.reflectionPath && (
                    <div className="break-all"><span className="text-zinc-600">Reflection:</span> {selectedMedEntry.reflectionPath}</div>
                  )}
                  {selectedMedEntry.dossierPath && (
                    <div className="break-all"><span className="text-zinc-600">Dossier:</span> {selectedMedEntry.dossierPath}</div>
                  )}
                </div>
              </div>
              <div className="col-span-2 min-h-0 overflow-y-auto custom-scrollbar p-5">
                {selectedMedEntry.error && (
                  <div className="mb-4 rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                    {selectedMedEntry.error}
                  </div>
                )}
                <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-200 font-mono">
                  {selectedMedEntry.result || selectedMedEntry.error || 'No full output has been recorded for this mission yet.'}
                </pre>
                {selectedMedEntry.why?.length > 0 && (
                  <div className="mt-4 rounded border border-cyan-500/20 bg-cyan-500/10 p-3">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-300">Why SOMA picked this</div>
                    <div className="space-y-1">
                      {selectedMedEntry.why.map((why, idx) => (
                        <div key={idx} className="text-[10px] font-mono text-zinc-300">• {why}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Equity Sparkline ──────────────────────────────────────────────────────
function Sparkline({ data = [], width = 80, height = 24 }) {
  if (!data || data.length < 2) return <span className="text-zinc-700 text-[9px]">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const isPositive = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={isPositive ? '#34d399' : '#f87171'} strokeWidth="1.2" />
    </svg>
  );
}

// ── Market Panel ───────────────────────────────────────────────────────────
function MarketSimulationView() {
  const [lab, setLab] = useState(null);
  const [training, setTraining] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [missionRuntime, setMissionRuntime] = useState(null);
  const [trainingIterations, setTrainingIterations] = useState(1000000);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [tradingTab, setTradingTab] = useState('beebots'); // 'beebots' | 'prometheus'

  const fmtPct = (value, digits = 1) => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : 'n/a';
  const fmtNum = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'n/a';
  const fmtDollar = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'n/a';
    return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
  };
  const statusTone = (status) => status === 'promoted'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : status === 'candidate'
      ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
      : 'border-rose-500/30 bg-rose-500/10 text-rose-300';

  const loadLab = useCallback(async () => {
    try {
      const r = await fetch('/api/soma/market-lab/status');
      if (r.ok) setLab(await r.json());
    } catch {}
  }, []);

  const loadTraining = useCallback(async () => {
    try {
      const [trainingRes, promotionRes] = await Promise.all([
        fetch('/api/mission-control/training'),
        fetch('/api/mission-control/promotion')
      ]);
      if (trainingRes.ok) setTraining(await trainingRes.json());
      if (promotionRes.ok) {
        const data = await promotionRes.json();
        setPromotion(data.promotion || null);
      }
    } catch {}
  }, []);

  const loadMissionRuntime = useCallback(async () => {
    try {
      const r = await fetch('/api/mission-control/runtime');
      if (r.ok) {
        const data = await r.json();
        setMissionRuntime(data.runtime || null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadLab();
    loadTraining();
    loadMissionRuntime();
    const t = setInterval(() => {
      loadLab();
      loadTraining();
      loadMissionRuntime();
    }, 7000);
    return () => clearInterval(t);
  }, [loadLab, loadTraining, loadMissionRuntime]);

  const startTraining = async () => {
    if (trainingBusy) return;
    setTrainingBusy(true);
    try {
      await fetch('/api/mission-control/training/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'five_to_five_hundred',
          symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'SPY', 'QQQ', 'TLT', 'TSLA'],
          strategyIds: ['standard_portfolio', 'swarm_architecture', 'micro_compounder', 'micro_scalper', 'full_aggression', 'yield_harvester'],
          iterations: trainingIterations,
          initialCapital: 5,
          targetCapital: 500,
          timeframe: '5Min',
          bars: 500
        })
      });
      await loadTraining();
    } catch {
      // Keep the sim view usable if the backend is temporarily busy.
    } finally {
      setTrainingBusy(false);
    }
  };

  const stopTraining = async (jobId) => {
    if (!jobId || trainingBusy) return;
    setTrainingBusy(true);
    try {
      await fetch(`/api/mission-control/training/${jobId}/stop`, { method: 'POST' });
      await loadTraining();
    } catch {
    } finally {
      setTrainingBusy(false);
    }
  };

  const runCycle = async () => {
    if (cycleBusy) return;
    setCycleBusy(true);
    try {
      await fetch('/api/soma/market-lab/autopilot/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'balanced', runs: 6 })
      });
      await Promise.all([loadLab(), loadMissionRuntime()]);
    } catch {}
    setCycleBusy(false);
  };

  const strategies = lab?.strategies || [];
  const entries = lab?.ledger || [];
  const autopilot = lab?.autopilot;
  const best = lab?.summary?.best;
  const latest = entries[0] || null;
  const activeJob = training?.jobs?.find(job => job.status === 'running') || null;
  const latestJob = activeJob || training?.jobs?.[0] || null;
  const jobProgress = latestJob?.iterationsTarget ? Math.min(100, (latestJob.iterationsDone / latestJob.iterationsTarget) * 100) : 0;
  const failedPromotionChecks = promotion?.checks
    ? Object.entries(promotion.checks).filter(([, ok]) => !ok).map(([key]) => key)
    : [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-black/40">
      {/* Unified Trading Tab Bar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-white/5 bg-zinc-900/50 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTradingTab('beebots')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
              tradingTab === 'beebots'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            BeeBots Swarm (BTC / ETH / SOL)
          </button>

          <button
            onClick={() => setTradingTab('prometheus')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
              tradingTab === 'prometheus'
                ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-[0_0_12px_rgba(249,115,22,0.15)]'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-orange-400" />
            Prometheus Research Lab
          </button>
        </div>

        <div className="text-[10px] font-mono text-zinc-500 hidden sm:block">
          {tradingTab === 'beebots' ? 'ModernBERT Laya Substrate · 1R Risk' : 'Autonomous Paper Strategy Search'}
        </div>
      </div>

      {/* Tab Content */}
      {tradingTab === 'beebots' ? (
        <BeeBotsView />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-5">
          <div className="flex items-center gap-4 mb-4">
        <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <TrendingUp className="w-5 h-5 text-orange-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-white tracking-tight italic">PROMETHEUS MARKET LAB</h2>
          <p className="text-xs text-orange-500/60 font-medium tracking-widest uppercase">Autonomous Paper Strategy Research · Explore / Exploit · Mission Control Ready</p>
        </div>
        <div className="ml-auto rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
            <span className={`h-2 w-2 rounded-full ${autopilot?.running ? 'bg-orange-300 animate-pulse' : autopilot?.enabled ? 'bg-emerald-300 animate-pulse' : 'bg-zinc-600'}`} />
            {autopilot?.running ? 'SOMA Simulating' : autopilot?.enabled ? 'Autonomy Active' : 'Autonomy Paused'}
          </div>
          <div className="mt-1 font-mono text-[9px] text-zinc-500">
            {autopilot?.totalCycles || 0} cycles · {autopilot?.totalRuns || 0} runs · next loop ~{Math.round((autopilot?.intervalMs || 120000) / 1000)}s
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3">
        {[
          ['Paper Runs', lab?.summary?.total || 0, 'text-orange-300'],
          ['Promoted', lab?.summary?.promoted || 0, 'text-emerald-300'],
          ['Candidates', lab?.summary?.candidates || 0, 'text-blue-300'],
          ['Rejected', lab?.summary?.rejected || 0, 'text-rose-300'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
            <div className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">{label}</div>
            <div className={`mt-1 font-mono text-2xl font-bold ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-3 gap-4 overflow-hidden">
        <div className="flex flex-col rounded-xl border border-white/10 bg-zinc-900/40 p-4 min-h-0">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Compass className="w-3 h-3" /> AUTONOMOUS SEARCH
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
            <div className="mb-3 rounded-xl border border-fuchsia-500/10 bg-fuchsia-500/[0.04] p-3">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-fuchsia-300">Selection Policy</div>
                <div className="space-y-1 font-mono text-[10px] text-zinc-500">
                  <div>Explore: random assets, compatible strategies</div>
                  <div>Exploit: rerun best pairs with deeper trials</div>
                  <div>Mutate: swap nearby assets or strategy family</div>
                  <div>Bankroll: up to $1,000 paper capital per run</div>
                  <div>Promote: paper playbook only after gates clear</div>
                </div>
              </div>
            <div className="mb-3 rounded-xl border border-orange-500/10 bg-orange-500/[0.04] p-3">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-orange-300">Promotion Gate</div>
              <div className="space-y-1 font-mono text-[10px] text-zinc-500">
                <div>Runtime: {promotion?.mode || 'paper_only'}</div>
                <div>Closed trades: {promotion?.stats?.totalTrades || 0}</div>
                <div>Win rate: {fmtNum(promotion?.stats?.winRate || 0, 1)}%</div>
                <div>Waiting on: {failedPromotionChecks.length ? failedPromotionChecks.slice(0, 3).join(', ') : 'none'}</div>
              </div>
            </div>
            <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">Manual Paper Training</div>
                  <div className="mt-0.5 text-[9px] font-mono text-zinc-600">$5 → $500 objective · paper only</div>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${activeJob ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300' : 'border-white/10 bg-white/5 text-zinc-500'}`}>
                  {activeJob ? 'running' : latestJob?.status || 'idle'}
                </span>
              </div>
              <div className="mb-2 grid grid-cols-4 gap-1">
                {[1000, 10000, 100000, 1000000].map(value => (
                  <button
                    key={value}
                    onClick={() => setTrainingIterations(value)}
                    className={`rounded border px-1.5 py-1 text-[9px] font-bold transition-all ${trainingIterations === value ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200' : 'border-white/10 bg-black/20 text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {value >= 1000000 ? '1M' : value >= 1000 ? `${value / 1000}K` : value}
                  </button>
                ))}
              </div>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-cyan-400 transition-all duration-700" style={{ width: `${jobProgress}%` }} />
              </div>
              <div className="mb-2 flex items-center justify-between font-mono text-[9px] text-zinc-500">
                <span>{latestJob ? `${latestJob.iterationsDone}/${latestJob.iterationsTarget}` : 'no job yet'}</span>
                <span>{latestJob?.best ? `${latestJob.best.strategyName} · ${fmtDollar(latestJob.best.pnl)}` : 'no champion'}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={startTraining}
                  disabled={trainingBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300 transition-all hover:bg-emerald-400/20 disabled:opacity-40"
                >
                  <Play className="h-3 w-3" /> Run
                </button>
                <button
                  onClick={() => stopTraining(activeJob?.id)}
                  disabled={!activeJob || trainingBusy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded border border-rose-400/30 bg-rose-400/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-rose-300 transition-all hover:bg-rose-400/20 disabled:opacity-30"
                >
                  <Square className="h-3 w-3" /> Stop
                </button>
              </div>
            </div>
            <div className="mb-3 rounded-xl border border-fuchsia-500/10 bg-fuchsia-500/[0.04] p-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-fuchsia-300">Manual Trigger</div>
              <button
                onClick={runCycle}
                disabled={cycleBusy || autopilot?.running}
                className="w-full flex items-center justify-center gap-1.5 rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-2 py-2 text-[9px] font-bold uppercase tracking-widest text-fuchsia-300 transition-all hover:bg-fuchsia-400/20 disabled:opacity-40"
              >
                <Zap className="h-3 w-3" />
                {cycleBusy ? 'Running 6 backtests...' : 'Run Cycle Now'}
              </button>
              <div className="mt-1.5 font-mono text-[9px] text-zinc-600">6 balanced runs · updates Mission Control</div>
            </div>
            {autopilot?.lastSelection?.length > 0 && (
              <div className="mb-3 rounded-xl border border-white/5 bg-black/30 p-3">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Last Autonomous Picks</div>
                <div className="space-y-1 font-mono text-[10px] text-zinc-500">
                  {autopilot.lastSelection.slice(0, 6).map(pick => (
                    <div key={pick.id} className="flex items-center gap-2">
                      <span className={pick.status === 'candidate' || pick.status === 'promoted' ? 'text-emerald-400' : 'text-rose-400'}>{pick.symbol}</span>
                      <span>{pick.strategyId}</span>
                      <span className="ml-auto text-orange-400">{fmtDollar(pick.pnl)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2 pb-1">
              {strategies.map(strategy => (
                <div key={strategy.id} className="rounded-lg border border-white/5 bg-black/30 p-3">
                  <div className="text-[10px] font-bold text-zinc-300">{strategy.name}</div>
                  <div className="mt-1 text-[10px] leading-snug text-zinc-600">{strategy.premise}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-white/10 bg-zinc-900/40 p-4 min-h-0">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Brain className="w-3 h-3" /> COGNITION
          </div>
          {best ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
              <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[8px] text-fuchsia-400 font-bold uppercase tracking-widest mb-1">PROMETHEUS SCORE</div>
                    <div className="text-4xl font-mono font-bold text-fuchsia-200">{fmtPct(best.prometheusScore, 1)}</div>
                  </div>
                  <Trophy className="h-8 w-8 text-fuchsia-400/70" />
                </div>
                <div className="mt-3 text-xs leading-relaxed text-zinc-400">{best.lesson}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Win Rate', fmtPct(best.metrics?.winRate, 1), 'text-emerald-300'],
                  ['$ P&L / Run', fmtDollar(best.paperAccount?.averageDollarPnl ?? best.metrics?.averageDollarPnl), 'text-orange-300'],
                  ['Max DD', fmtPct(best.metrics?.maxDrawdown, 1), 'text-rose-300'],
                  ['Profit Factor', fmtNum(best.metrics?.profitFactor, 2), 'text-blue-300'],
                  ['Ending Value', best.paperAccount?.averageEndingValue ? `$${best.paperAccount.averageEndingValue.toFixed(2)}` : 'n/a', 'text-cyan-300'],
                  ['Sharpe', fmtNum(best.metrics?.sharpe, 2), 'text-violet-300'],
                ].map(([label, value, tone]) => (
                  <div key={label} className="rounded-lg border border-white/5 bg-black/35 p-3">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600 font-bold">{label}</div>
                    <div className={`mt-1 font-mono text-lg font-bold ${tone}`}>{value}</div>
                  </div>
                ))}
              </div>
              {latestJob?.best && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">Training Champion</div>
                    <div className="font-mono text-[9px] text-zinc-500">{latestJob.status}</div>
                  </div>
                  <div className="text-sm font-bold text-white">{latestJob.best.symbol} · {latestJob.best.strategyName}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px]">
                    <span className={latestJob.best.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtDollar(latestJob.best.pnl)}</span>
                    <span className="text-cyan-300">${fmtNum(latestJob.best.finalCapital, 4)}</span>
                    <span className="text-orange-300">{fmtPct(latestJob.best.winRate, 0)}</span>
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                    {latestJob.best.trades} trades · {fmtNum(latestJob.best.maxDrawdownPct, 2)}% max drawdown · score {fmtNum(latestJob.best.score, 3)}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-white/5 bg-black/35 p-3">
                <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                  <Shield className="w-3 h-3" /> Thalamus Risk
                </div>
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-orange-500 to-rose-500" style={{ width: `${Math.min(100, (best.thalamusRisk || 0) * 100)}%` }} />
                </div>
                <div className="mt-2 font-mono text-[10px] text-zinc-500">{fmtPct(best.thalamusRisk, 1)} risk pressure · {best.status}</div>
              </div>
              {best.missionCouncil && (
                <div className="rounded-xl border border-white/5 bg-black/35 p-3">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Mission Control Council Learning</div>
                  <div className="space-y-1.5 font-mono text-[10px]">
                    {Object.entries(best.missionCouncil).map(([agentId, agent]) => (
                      <div key={agentId} className="flex items-center gap-2">
                        <span className="w-24 truncate text-zinc-500">{agent.name}</span>
                        <span className={agent.learned ? 'text-emerald-400' : 'text-orange-400'}>{fmtPct(agent.confidence, 0)}</span>
                        <span className="ml-auto text-zinc-600">{agent.learned ? 'learned' : 'watching'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {missionRuntime?.council && (
                <div className="rounded-xl border border-cyan-500/10 bg-cyan-500/[0.04] p-3">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-cyan-300">Live Mission Control</div>
                  <div className="space-y-1.5">
                    {Object.entries(missionRuntime.council).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-16 font-mono text-[9px] text-zinc-500 capitalize">{k}</span>
                        <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full rounded-full bg-cyan-500 transition-all duration-700" style={{ width: `${Math.round(v * 100)}%` }} />
                        </div>
                        <span className="font-mono text-[9px] text-cyan-300">{Math.round(v * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  {missionRuntime.activeStrategy && (
                    <div className="mt-2 font-mono text-[9px] text-zinc-600 truncate">
                      {missionRuntime.activeStrategy.strategyName} · {missionRuntime.activeStrategy.symbol}
                      {missionRuntime.activeStrategy.score != null && ` · ${fmtPct(missionRuntime.activeStrategy.score, 0)}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-zinc-700 text-xs font-bold uppercase tracking-widest">No market lab runs yet</div>
          )}
        </div>

        <div className="flex flex-col rounded-xl border border-white/10 bg-zinc-900/40 p-4 min-h-0">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <BarChart2 className="w-3 h-3" /> PAPER LEDGER
          </div>
          {latest && (
            <div className={`mb-3 rounded-xl border p-3 ${statusTone(latest.status)}`}>
              <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">Latest Run</div>
              <div className="mt-1 text-sm font-bold text-white">{latest.asset?.symbol} · {latest.strategy?.name}</div>
              <div className="mt-1 font-mono text-[10px] opacity-80">{fmtDollar(latest.paperAccount?.averageDollarPnl ?? latest.metrics?.averageDollarPnl)} avg · {fmtPct(latest.metrics?.winRate, 1)} win · {latest.trialBudget?.executed || 0} trials</div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
            {entries.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-700 text-xs font-bold uppercase tracking-widest">Awaiting first sweep</div>
            ) : entries.map(entry => (
              <div key={entry.id} className="rounded-lg border border-white/5 bg-black/35 p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${statusTone(entry.status)}`}>{entry.status}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{entry.asset?.symbol}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{formatTime(entry.updatedAt || entry.createdAt)}</span>
                </div>
                <div className="mt-2 text-xs font-bold text-zinc-200">{entry.strategy?.name}</div>
                <div className="mt-1 flex items-center gap-3">
                  <div className="grid grid-cols-3 gap-2 font-mono text-[10px] flex-1">
                    <span className={(entry.paperAccount?.averageDollarPnl ?? entry.metrics?.averageDollarPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtDollar(entry.paperAccount?.averageDollarPnl ?? entry.metrics?.averageDollarPnl)}</span>
                    <span className="text-fuchsia-400">{fmtPct(entry.prometheusScore, 0)}</span>
                    <span className="text-rose-400">{fmtPct(entry.metrics?.maxDrawdown, 0)} DD</span>
                  </div>
                  {entry.dollarEquitySample?.length > 1 && (
                    <Sparkline data={entry.dollarEquitySample.slice(-20)} width={72} height={20} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
        </div>
      )}
    </div>
  );
}

function ExperimentLedgerCardBody({ status }) {
  const summary = status?.status || {};
  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">Learning Ledger</span>
        <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          persistent
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-white/5 bg-black/30 p-2">
          <div className="text-[8px] uppercase text-zinc-600">Runs</div>
          <div className="text-lg font-bold text-white">{summary.total || 0}</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/30 p-2">
          <div className="text-[8px] uppercase text-zinc-600">Rules</div>
          <div className="text-lg font-bold text-emerald-400">{summary.reusableRules || 0}</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/30 p-2">
          <div className="text-[8px] uppercase text-zinc-600">Done</div>
          <div className="text-lg font-bold text-blue-400">{summary.byStatus?.learned || summary.byStatus?.observed || 0}</div>
        </div>
      </div>
      <div className="mt-auto text-[9px] font-mono text-zinc-600">
        Last update: {formatTime(summary.lastUpdated)}
      </div>
    </div>
  );
}

function ExperimentLedgerView() {
  const [ledger, setLedger] = useState([]);
  const [summary, setSummary] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [error, setError] = useState('');

  const loadLedger = useCallback(async () => {
    try {
      const res = await fetch('/api/soma/simulations/experiments');
      const data = await res.json();
      if (data.success) {
        setLedger(data.ledger || []);
        setSummary(data.summary || null);
      }
    } catch {
      setError('Experiment ledger is unreachable.');
    }
  }, []);

  useEffect(() => {
    loadLedger();
    const t = setInterval(loadLedger, 6000);
    return () => clearInterval(t);
  }, [loadLedger]);

  const filtered = ledger.filter(entry => activeFilter === 'all' || entry.status === activeFilter);
  const statuses = ['all', 'planned', 'running', 'observed', 'learned'];
  const latest = ledger[0] || null;

  return (
    <div className="flex-1 overflow-hidden bg-black/40 p-5">
      <div className="mb-5 flex items-center gap-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5">
          <ClipboardCheck className="h-6 w-6 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold uppercase italic tracking-tight text-white">Experiment Ledger</h2>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-500/60">Autonomous trials, lessons, and reusable rules</p>
        </div>
        <div className="ml-auto grid grid-cols-3 gap-3 text-right">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-zinc-600">Experiments</div>
            <div className="text-lg font-bold text-white">{summary?.total || 0}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest text-zinc-600">Rules</div>
            <div className="text-lg font-bold text-emerald-400">{summary?.reusableRules || 0}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-widest text-zinc-600">Updated</div>
            <div className="text-lg font-bold text-zinc-300">{formatTime(summary?.lastUpdated)}</div>
          </div>
        </div>
      </div>

      <div className="grid h-[calc(100%-84px)] grid-cols-5 gap-5 overflow-hidden">
        <div className="col-span-2 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900/40 p-5 custom-scrollbar">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-300">Live Learning Window</h3>
            <span className="flex items-center gap-2 text-[10px] font-mono uppercase text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              autonomous
            </span>
          </div>
          {error && <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400">Current Trial</p>
              <h3 className="text-sm font-bold text-white">{latest?.title || 'Waiting for SOMA to begin a trial...'}</h3>
              <p className="mt-2 text-[10px] font-mono uppercase tracking-wider text-zinc-600">
                {latest ? `${latest.domain} / ${latest.status} / ${latest.source || 'system'}` : 'idle'}
              </p>
            </div>
            {[
              ['Hypothesis', latest?.hypothesis],
              ['Setup', latest?.setup],
              ['Result', latest?.result],
              ['Lesson', latest?.lesson],
              ['Reusable Rule', latest?.reusableRule]
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/5 bg-black/25 p-3">
                <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">{label}</p>
                <p className="text-xs leading-relaxed text-zinc-300">{value || 'Awaiting observation...'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-3 flex min-h-0 flex-col rounded-2xl border border-white/10 bg-zinc-900/40">
          <div className="flex items-center gap-2 border-b border-white/10 p-4">
            {statuses.map(status => (
              <button key={status} onClick={() => setActiveFilter(status)}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  activeFilter === status ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-zinc-500 hover:text-zinc-300'
                }`}>
                {status}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-700">
                <ClipboardCheck className="h-12 w-12 opacity-30" />
                <p className="text-sm font-bold uppercase tracking-widest">No experiments logged</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.map(entry => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-5">
                    <div className="mb-4 flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300">{entry.status}</span>
                          <span className="text-[10px] font-mono text-zinc-600">{entry.domain}</span>
                          {entry.confidence != null && <span className="text-[10px] font-mono text-blue-400">{Math.round(entry.confidence * 100)}%</span>}
                        </div>
                        <h3 className="truncate text-base font-bold text-white">{entry.title}</h3>
                        <p className="text-[10px] font-mono text-zinc-600">Updated {formatTime(entry.updatedAt || entry.createdAt)}</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        ['Hypothesis', entry.hypothesis],
                        ['Setup', entry.setup],
                        ['Result', entry.result],
                        ['Lesson', entry.lesson],
                        ['Reusable Rule', entry.reusableRule]
                      ].filter(([, value]) => value).map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">{label}</p>
                          <p className="text-xs leading-relaxed text-zinc-300">{value}</p>
                        </div>
                      ))}
                    </div>
                    {entry.tags?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {entry.tags.map(tag => <span key={tag} className="rounded bg-white/5 px-2 py-0.5 text-[9px] text-zinc-500">#{tag}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Simulation Suite Main ──────────────────────────────────────────────────
function ForecastSimulationView() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState({ scenarios: 12, sport: 'ALL', mode: 'balanced', maxLegs: 3, enrich: true });

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/forecaster/suite/status');
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const runSuite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/forecaster/suite/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (r.ok) {
        const data = await r.json();
        setStatus(prev => ({
          ...(prev || {}),
          latest: data.run,
          runs: [data.run, ...((prev?.runs || []).filter(run => run.id !== data.run.id))].slice(0, 20),
          backtest: data.backtest,
          summary: {
            ...(prev?.summary || {}),
            totalRuns: (prev?.summary?.totalRuns || 0) + 1,
            totalScenarios: (prev?.summary?.totalScenarios || 0) + (data.run?.summary?.scenarios || 0),
            savedForecasts: (prev?.summary?.savedForecasts || 0) + (data.run?.summary?.saved || 0),
            latestAt: data.run?.createdAt
          }
        }));
      }
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const latest = status?.latest || null;
  const runs = status?.runs || [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-5 bg-black/40">
      <div className="flex items-center gap-4 mb-4">
        <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Target className="w-5 h-5 text-indigo-300" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-white tracking-tight italic">FORECAST SIMULATION SUITE</h2>
          <p className="text-xs text-indigo-400/60 font-medium tracking-widest uppercase">Controlled forecast experiments · enrich · swarm · ledger learning</p>
        </div>
        <div className="ml-auto rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-4 py-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-300">
            <span className="h-2 w-2 rounded-full bg-indigo-300 animate-pulse" />
            Paper Learning Only
          </div>
          <div className="mt-1 font-mono text-[9px] text-zinc-500">
            {status?.summary?.totalScenarios || 0} scenarios · {status?.summary?.gradedForecasts || 0} graded
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3">
        {[
          ['Runs', status?.summary?.totalRuns || 0, 'text-indigo-300'],
          ['Saved', status?.summary?.savedForecasts || 0, 'text-emerald-300'],
          ['Backtest MAE', status?.backtest?.summary?.meanAbsoluteError ?? 'n/a', 'text-amber-300'],
          ['Brier', status?.backtest?.summary?.brierScore ?? 'n/a', 'text-fuchsia-300'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
            <div className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">{label}</div>
            <div className={`mt-1 font-mono text-2xl font-bold ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-3 gap-4 overflow-hidden">
        <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Compass className="w-3 h-3" /> Experiment Controls
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Scenarios</span>
              <input
                type="number"
                min="1"
                max="25"
                value={config.scenarios}
                onChange={e => setConfig(prev => ({ ...prev, scenarios: Number(e.target.value) || 12 }))}
                className="mt-1 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Sport</span>
                <select value={config.sport} onChange={e => setConfig(prev => ({ ...prev, sport: e.target.value }))} className="mt-1 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
                  {['ALL', 'NBA', 'NFL', 'NHL'].map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Mode</span>
                <select value={config.mode} onChange={e => setConfig(prev => ({ ...prev, mode: e.target.value }))} className="mt-1 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white">
                  {['conservative', 'balanced', 'aggressive', 'research'].map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Max Legs</span>
              <input
                type="number"
                min="1"
                max="4"
                value={config.maxLegs}
                onChange={e => setConfig(prev => ({ ...prev, maxLegs: Number(e.target.value) || 3 }))}
                className="mt-1 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              onClick={() => setConfig(prev => ({ ...prev, enrich: !prev.enrich }))}
              className={`w-full rounded border px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${config.enrich ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'}`}
            >
              {config.enrich ? 'Enrichment Enabled' : 'Fast Heuristic Mode'}
            </button>
            <button
              onClick={runSuite}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 rounded border border-indigo-400/30 bg-indigo-400/10 px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-indigo-200 hover:bg-indigo-400/20 disabled:opacity-40"
            >
              {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {busy ? 'Running Suite...' : 'Run Forecast Suite'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 min-h-0 flex flex-col">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Brain className="w-3 h-3" /> Latest Run
          </div>
          {latest ? (
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2">
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3">
                <div className="text-sm font-bold text-white">{latest.summary?.scenarios || 0} scenarios generated</div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">
                  Avg hit {latest.summary?.avgProbability}% · swarm {latest.summary?.avgSwarmProbability}% · needs stats {latest.summary?.needsLiveStats}
                </div>
              </div>
              {(latest.results || []).map(result => (
                <div key={result.id} className="rounded-lg border border-white/5 bg-black/30 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-200 truncate">{result.primary}</span>
                    <span className="ml-auto font-mono text-[10px] text-indigo-300">{result.probability}%</span>
                  </div>
                  <div className="mt-1 flex gap-2 font-mono text-[9px] text-zinc-500">
                    <span>{result.legs} legs</span>
                    <span>edge {result.edge}</span>
                    <span>{result.rating}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-zinc-700 text-xs font-bold uppercase tracking-widest">No forecast suite run yet</div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 min-h-0 flex flex-col">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Database className="w-3 h-3" /> Suite Ledger
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2">
            {runs.length ? runs.map(run => (
              <div key={run.id} className="rounded-lg border border-white/5 bg-black/30 p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-300">{run.status}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{formatTime(run.createdAt)}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{run.sport}</span>
                </div>
                <div className="mt-2 text-xs font-bold text-zinc-200">{run.summary?.scenarios || 0} scenarios · {run.mode}</div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">Avg {run.summary?.avgProbability}% · saved {run.summary?.saved}</div>
              </div>
            )) : (
              <div className="flex h-full items-center justify-center text-zinc-700 text-xs font-bold uppercase tracking-widest">Awaiting first run</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SimulationSuite() {
  const [expandedId, setExpandedId] = useState(null);
  const [suiteStatus, setSuiteStatus] = useState(null);
  const [sims, setSims] = useState([
    { id: 'market',    type: 'market',    title: 'Trading & Market Simulation', spawnedBy: 'system' },
    { id: 'forecaster', type: 'forecaster', title: 'Forecast Suite', spawnedBy: 'system' },
    { id: 'ml-intern', type: 'ml-intern', title: 'ML Intern',         spawnedBy: 'system' },
    { id: 'scraper',   type: 'scraper',   title: 'Experiment Ledger', spawnedBy: 'system' },
    { id: 'code',      type: 'code',      title: 'Code Sandbox',      spawnedBy: 'system' },
    { id: 'biotech',   type: 'biotech',   title: 'Medical Lab',       spawnedBy: 'system' },
    { id: 'social',    type: 'social',    title: 'Social Feed',       spawnedBy: 'system' },
    { id: 'cc',        type: 'cc',        title: 'C&C Game',          spawnedBy: 'system' },
    { id: 'cluster-mesh', type: 'cluster-mesh', title: 'Dual-Node Cluster & RSI', spawnedBy: 'system' },
  ]);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const res = await fetch('/api/soma/simulations/status');
        if (res.ok) setSuiteStatus(await res.json());
      } catch {}
    };
    loadStatus();
    const timer = setInterval(loadStatus, 7000);
    return () => clearInterval(timer);
  }, []);

  const handleExpand = (id) => setExpandedId(id);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0b] text-zinc-100 font-sans">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-900/20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-fuchsia-500/10 border border-fuchsia-500/20">
            <TrendingUp className="w-4 h-4 text-fuchsia-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">SIMULATION SUITE</h1>
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">
              Autonomous Reality Modeling V4.6
              {suiteStatus && ` · ${suiteStatus.counts.online}/${suiteStatus.counts.total} engines online`}
            </p>
          </div>
        </div>
        {!expandedId && suiteStatus && (
          <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-zinc-500">
            <span className={`w-1.5 h-1.5 rounded-full ${suiteStatus.simulationLoadEnabled ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            Physics {suiteStatus.simulationLoadEnabled ? 'enabled' : 'gated'}
          </div>
        )}
        {expandedId && (
          <button 
            onClick={() => setExpandedId(null)}
            className="px-3 py-1 text-[10px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-all active:scale-95"
          >
            ← BACK TO SUITE
          </button>
        )}
      </div>

      {!expandedId && (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
            {sims.map(sim => (
              <SimCard key={sim.id} sim={sim} status={moduleStatusById(suiteStatus, sim.id)} onExpand={handleExpand} />
            ))}
          </div>
        </div>
      )}

      {expandedId === 'biotech' && <MedicalLabView />}
      {expandedId === 'market' && <MarketSimulationView />}
      {expandedId === 'forecaster' && <ForecastSimulationView />}
      {expandedId === 'ml-intern' && <MlInternView />}
      {expandedId === 'scraper' && <ExperimentLedgerView />}
      {expandedId === 'code' && <CodeSandboxView />}
      {expandedId === 'cc' && <CcSimulationView suiteStatus={suiteStatus} />}
      {expandedId === 'social' && <SocialModule isConnected />}
      {expandedId === 'cluster-mesh' && <ClusterMeshView />}
    </div>
  );
}

// ── C&C Simulation View (Physics Engine) ───────────────────────────────────
function PhysicsCanvas({ port }) {
  const canvasRef = useRef(null);
  const [connection, setConnection] = useState(port ? 'connecting' : 'offline');
  const [world, setWorld] = useState(null);

  useEffect(() => {
    if (!port) {
      setConnection('offline');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || '127.0.0.1';
    const ws = new WebSocket(`${protocol}//${host}:${port}`);
    let closed = false;

    ws.onopen = () => !closed && setConnection('live');
    ws.onerror = () => !closed && setConnection('error');
    ws.onclose = () => !closed && setConnection('offline');
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'world_update') setWorld(payload);
      } catch {}
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, [port]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#050509';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const bodies = world?.bodies || [];
    for (const body of bodies) {
      const vertices = body.vertices || [];
      if (!vertices.length) continue;
      const color = body.label === 'soma_agent'
        ? '#f43f5e'
        : body.label === 'cargo'
          ? '#60a5fa'
          : body.label === 'target_zone'
            ? 'rgba(74,222,128,0.45)'
            : body.label?.startsWith('wall') || body.label === 'ground' || body.label === 'ceiling'
              ? '#3f3f46'
              : '#71717a';

      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (const vertex of vertices.slice(1)) ctx.lineTo(vertex.x, vertex.y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.stroke();
    }

    if (!world) {
      ctx.fillStyle = 'rgba(212,212,216,0.45)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(connection === 'live' ? 'Waiting for world state...' : 'Physics stream unavailable', width / 2, height / 2);
    }
  }, [world, connection]);

  return (
    <div className="absolute inset-0 bg-black">
      <canvas ref={canvasRef} width={800} height={600} className="h-full w-full object-contain" />
      <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/60 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
          <span className={`h-1.5 w-1.5 rounded-full ${connection === 'live' ? 'bg-emerald-400' : connection === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400'}`} />
          Physics Stream {connection}
        </div>
        {world && <div className="mt-1 text-[10px] font-mono text-zinc-500">Score {world.score} · Task {world.task}</div>}
      </div>
    </div>
  );
}

function CcSimulationView({ suiteStatus }) {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/soma/cc/status');
        if (r.ok) setData(await r.json());
      } catch {}
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, []);

  const status = moduleStatusById(suiteStatus, 'cc');
  const port = data?.port || status?.status?.port || null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-5 bg-black/40">
      <div className="flex items-center gap-4 mb-6">
        <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
          <Swords className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight italic uppercase">Command & Control Simulation</h2>
          <p className="text-xs text-red-500/60 font-medium tracking-widest uppercase">Physics-Based Emergent Behavior · 2D Playground</p>
        </div>
        {data && (
            <div className="ml-auto flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-[10px] font-bold border ${data.running ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                    {data.running ? 'ENGINE ACTIVE' : 'ENGINE IDLE'}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">Viewers: {data.viewers}</span>
            </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-3 gap-5 overflow-hidden">
        <div className="col-span-2 flex flex-col rounded-2xl border border-white/10 bg-zinc-900/40 overflow-hidden relative">
            <PhysicsCanvas port={port} />
            
            {/* Stats Overlay */}
            <div className="mt-auto p-6 bg-gradient-to-t from-black/80 to-transparent z-20">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Environment State</span>
                    <span className="text-[10px] text-red-400 font-mono">Real-time Collision Mesh</span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                    <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <div className="text-[8px] text-zinc-500 uppercase font-bold mb-1">Bodies</div>
                        <div className="text-lg font-mono font-bold text-white">{data?.stats?.objects?.length || 0}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <div className="text-[8px] text-zinc-500 uppercase font-bold mb-1">Stability</div>
                        <div className="text-lg font-mono font-bold text-emerald-400">99.8%</div>
                    </div>
                    <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <div className="text-[8px] text-zinc-500 uppercase font-bold mb-1">Epoch</div>
                        <div className="text-lg font-mono font-bold text-blue-400">{data?.controller?.episodes || 0}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <div className="text-[8px] text-zinc-500 uppercase font-bold mb-1">Reward</div>
                        <div className="text-lg font-mono font-bold text-fuchsia-400">{(data?.controller?.reward || 0).toFixed(2)}</div>
                    </div>
                </div>
            </div>
        </div>

        <div className="flex flex-col gap-5 overflow-hidden">
            <div className="flex-1 flex flex-col rounded-2xl border border-red-500/20 bg-zinc-900/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-red-500/20 bg-red-500/5 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Neural Controller</span>
                    <Activity className="w-3.5 h-3.5 text-red-400" />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 font-mono text-[10px]">
                    <div className="text-zinc-500">[INIT] Attaching Matter.js physics bridge...</div>
                    <div className="text-zinc-500">[LOAD] ControllerDNA: SOMA-Q-ALPHA</div>
                    <div className="text-emerald-400">[OK] Physics sandbox stabilized</div>
                    <div className="text-zinc-500">[PLAN] Navigation mission: Fetch Cargo</div>
                    {data?.stats?.objects?.map((obj, i) => (
                        <div key={i} className="text-zinc-400 group">
                            <span className="text-red-500/60">&gt;</span> Tracking: {obj.label} @ {Math.round(obj.position.x)},{Math.round(obj.position.y)}
                        </div>
                    ))}
                    <div className="animate-pulse text-red-500">_</div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

function MarketCardBody({ status }) {
  const [beeData, setBeeData] = useState(null);

  useEffect(() => {
    let active = true;
    fetch('/api/soma/trading/beebots/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active && d) setBeeData(d); })
      .catch(() => {});
    const interval = setInterval(() => {
      fetch('/api/soma/trading/beebots/status')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (active && d) setBeeData(d); })
        .catch(() => {});
    }, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const ledger = status?.status?.ledger;
  const best = ledger?.best;
  const p = beeData?.portfolio;
  const bees = p?.bees || {};
  const isCuda = beeData?.laya?.online && beeData?.laya?.device?.toLowerCase().includes('cuda');

  return (
    <div className="h-full p-3 flex flex-col justify-between">
      {/* BeeBots Swarm Micro Row */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">
            <Zap className="w-3 h-3 text-amber-400" /> BeeBots Swarm ($1K Pool)
          </div>
          <span className={`text-[8px] font-mono px-1 rounded font-bold uppercase ${isCuda ? 'text-emerald-400' : 'text-amber-400'}`}>
            {isCuda ? 'CUDA' : 'FALLBACK'}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs font-mono font-bold">
          <span className="text-white">${Number(p?.totalEquity || 1000).toFixed(2)}</span>
          <div className="flex items-center gap-2 text-[9px]">
            {['bizzy', 'boozy', 'breezy'].map(k => {
              const b = bees[k];
              const pos = b?.position;
              return (
                <span key={k} className={pos ? (pos.side === 'LONG' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-zinc-500'}>
                  {k === 'bizzy' ? '⚡' : k === 'boozy' ? '🍸' : '🍃'}{pos ? pos.side[0] : '•'}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Prometheus Research Summary */}
      <div className="grid grid-cols-3 gap-1 my-1">
        <div className="rounded border border-white/5 bg-black/25 p-1 text-center">
          <div className="text-[7px] uppercase tracking-widest text-zinc-500 font-bold">Runs</div>
          <div className="font-mono text-xs font-bold text-orange-300">{ledger?.total || 0}</div>
        </div>
        <div className="rounded border border-white/5 bg-black/25 p-1 text-center">
          <div className="text-[7px] uppercase tracking-widest text-zinc-500 font-bold">Promoted</div>
          <div className="font-mono text-xs font-bold text-emerald-300">{ledger?.promoted || 0}</div>
        </div>
        <div className="rounded border border-white/5 bg-black/25 p-1 text-center">
          <div className="text-[7px] uppercase tracking-widest text-zinc-500 font-bold">Cand</div>
          <div className="font-mono text-xs font-bold text-blue-300">{ledger?.candidates || 0}</div>
        </div>
      </div>

      <div className="rounded border border-white/5 bg-black/20 px-2 py-1 flex items-center justify-between text-[9px] font-mono text-zinc-400">
        <span className="truncate">{best ? `${best.asset?.symbol} · ${best.strategy?.name}` : 'Prometheus Ready'}</span>
        <span className="text-amber-400/80 text-[8px] font-bold">SWARM + LAB</span>
      </div>
    </div>
  );
}

function SimCard({ sim, status, onExpand }) {
  const COLORS = {
    beebots: { border:'border-amber-500/20', dot:'bg-amber-400', icon:'text-amber-400', hover:'hover:border-amber-500/50' },
    market: { border:'border-orange-500/20', dot:'bg-orange-400', icon:'text-orange-400', hover:'hover:border-orange-500/50' },
    forecaster: { border:'border-indigo-500/20', dot:'bg-indigo-400', icon:'text-indigo-400', hover:'hover:border-indigo-500/50' },
    'ml-intern':{ border:'border-blue-500/20',   dot:'bg-blue-400',   icon:'text-blue-400',   hover:'hover:border-blue-500/50' },
    scraper:{ border:'border-emerald-500/20', dot:'bg-emerald-400',icon:'text-emerald-400',hover:'hover:border-emerald-500/50'},
    code:   { border:'border-fuchsia-500/20', dot:'bg-fuchsia-400',icon:'text-fuchsia-400',hover:'hover:border-fuchsia-500/50'},
    biotech:{ border:'border-emerald-500/20', dot:'bg-emerald-400',icon:'text-emerald-400',hover:'hover:border-emerald-500/50'},
    social: { border:'border-violet-500/20',  dot:'bg-violet-400', icon:'text-violet-400', hover:'hover:border-violet-500/50' },
    cc:     { border:'border-red-500/20',     dot:'bg-red-400',    icon:'text-red-400',    hover:'hover:border-red-500/50' },
    'cluster-mesh': { border:'border-cyan-500/20', dot:'bg-cyan-400', icon:'text-cyan-400', hover:'hover:border-cyan-500/50' },
  };
  const ICONS = { beebots: Zap, market: TrendingUp, forecaster: Target, 'ml-intern': Microscope, scraper: Database, code: Code2, biotech: FlaskConical, social: Share2, cc: Swords, 'cluster-mesh': Cpu };
  const c = COLORS[sim.type] || COLORS.market;
  const Icon = ICONS[sim.type] || Brain;
  const isComingSoon = false;
  const online = !!status?.online;
  const statusText = status?.label || (online ? 'online' : 'not wired');

  return (
    <div 
      onClick={() => !isComingSoon && onExpand(sim.id)}
      className={`group relative flex flex-col h-48 rounded-xl border ${c.border} ${c.hover} bg-zinc-900/30 overflow-hidden transition-all duration-300 ${isComingSoon ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-zinc-900/50 active:scale-[0.98]'}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-black/20 shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full ${c.dot} ${isComingSoon ? 'opacity-30' : 'animate-pulse'}`} />
        <Icon className={`w-3.5 h-3.5 ${c.icon}`} />
        <span className="text-[10px] font-bold text-zinc-200 uppercase tracking-widest">{sim.title}</span>
        {isComingSoon && <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-500 border border-white/5 font-bold">SOON</span>}
        {!isComingSoon && (
          <span className={`ml-auto h-1.5 w-1.5 rounded-full ${online ? c.dot : 'bg-zinc-700'}`} title={statusText} />
        )}
      </div>
      <div className="px-3 py-1 border-b border-white/5 bg-black/10">
        <p className={`truncate text-[9px] font-mono ${online ? 'text-zinc-400' : 'text-zinc-600'}`}>{statusText}</p>
      </div>
      <div className="flex-1 min-h-0">
        {sim.type === 'beebots' && <BeeBotsCardBody />}
        {sim.type === 'biotech' && <BiotechCardBody />}
        {sim.type === 'market' && <MarketCardBody status={status} />}
        {sim.type === 'forecaster' && <ForecastSuiteCardBody />}
        {sim.type === 'code' && <div className="p-4 flex items-center justify-center h-full text-zinc-700 italic text-[10px] uppercase font-bold tracking-widest opacity-40">Pattern Engine Active</div>}
        {sim.type === 'scraper' && <ExperimentLedgerCardBody status={status} />}
        {sim.type === 'ml-intern' && <MlInternCardBody />}
        {sim.type === 'social' && <SocialCardBody />}
        {sim.type === 'cluster-mesh' && <ClusterTandemCardBody />}
        {sim.type !== 'beebots' && sim.type !== 'biotech' && sim.type !== 'market' && sim.type !== 'forecaster' && sim.type !== 'code' && sim.type !== 'scraper' && sim.type !== 'ml-intern' && sim.type !== 'social' && sim.type !== 'cluster-mesh' && (
            <div className="p-4 flex items-center justify-center h-full text-zinc-700 italic text-[10px] uppercase font-bold tracking-widest opacity-40">
                Active Simulation Module
            </div>
        )}
      </div>
    </div>
  );
}

export default SimulationSuite;
