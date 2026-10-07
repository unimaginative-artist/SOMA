import React, { useState, useEffect } from 'react';
import { Server, Cpu, Database, Wifi, Clock, AlertCircle, CheckCircle, Activity } from 'lucide-react';

const API = '/api/soma';

function StatusDot({ ok, label }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-zinc-500 text-[11px]">{label}</span>
      <span className={`text-[10px] font-bold ${ok ? 'text-emerald-400' : 'text-zinc-600'}`}>
        {ok ? 'ONLINE' : 'OFFLINE'}
      </span>
    </div>
  );
}

export default function BootHealthWidget({ isConnected }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const inFlight = { current: false };
    const fetch_ = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      fetch(`${API}/boot-health`)
        .then(r => r.json())
        .then(d => { setHealth(d); setError(null); })
        .catch(e => setError(e.message))
        .finally(() => { inFlight.current = false; });
    };
    fetch_();
    const t = setInterval(fetch_, 30_000);
    return () => clearInterval(t);
  }, []);

  const cardClass = 'bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg';

  if (error) return (
    <div className={`${cardClass} flex items-center space-x-3 text-red-400`}>
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span className="text-xs">Boot health unavailable</span>
    </div>
  );

  if (!health) return (
    <div className={`${cardClass} flex items-center space-x-3 text-zinc-600`}>
      <Activity className="w-4 h-4 animate-pulse shrink-0" />
      <span className="text-xs">Loading system health...</span>
    </div>
  );

  const memPct = health.memory
    ? Math.round((health.memory.heapUsedMB / health.memory.heapTotalMB) * 100)
    : 0;

  return (
    <div className={cardClass}>
      <h3 className="text-zinc-100 font-semibold text-sm flex items-center mb-4 uppercase tracking-wider">
        <Server className="w-4 h-4 mr-2 text-fuchsia-400" /> Boot Health
      </h3>

      {/* Uptime + Memory */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-zinc-900/50 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-1">
            <Clock className="w-3 h-3 text-blue-400" />
            <span className="text-zinc-500 text-[10px] uppercase tracking-widest">Uptime</span>
          </div>
          <div className="text-zinc-100 font-mono text-sm font-bold">{health.uptimeHuman}</div>
        </div>
        <div className="bg-zinc-900/50 rounded-lg p-3">
          <div className="flex items-center space-x-2 mb-1">
            <Database className="w-3 h-3 text-purple-400" />
            <span className="text-zinc-500 text-[10px] uppercase tracking-widest">Heap</span>
          </div>
          <div className="text-zinc-100 font-mono text-sm font-bold">{health.memory?.heapUsedMB}MB</div>
          <div className="w-full bg-zinc-800 rounded-full h-1 mt-1">
            <div
              className={`h-1 rounded-full ${memPct > 80 ? 'bg-red-500' : memPct > 60 ? 'bg-amber-500' : 'bg-purple-500'}`}
              style={{ width: `${memPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* System counts */}
      <div className="flex items-center space-x-4 mb-4 text-[11px]">
        <span className="text-emerald-400 font-bold">{health.systems?.loaded} loaded</span>
        {health.systems?.failed > 0 && (
          <span className="text-red-400 font-bold">{health.systems.failed} failed</span>
        )}
        <span className="text-zinc-600">/ {health.systems?.total} total</span>
        {health.maxQueue?.pending > 0 && (
          <span className="text-amber-400 font-bold ml-auto">{health.maxQueue.pending} MAX queued</span>
        )}
      </div>

      {/* Core system status dots */}
      <div className="space-y-0 mb-4">
        <StatusDot ok={health.core?.quadBrain}   label="QuadBrain" />
        <StatusDot ok={health.core?.memory}      label="Memory (Mnemonic)" />
        <StatusDot ok={health.core?.steve}       label="Steve (Agentic Worker)" />
        <StatusDot ok={health.core?.selfMod}     label="Self-Modification" />
        <StatusDot ok={health.core?.webScraper}  label="Web Scraper (Dendrite)" />
        <StatusDot ok={health.core?.ollamaTrainer} label="Ollama Auto-Trainer" />
      </div>

      {/* Trainer status */}
      {health.trainer && (
        <div className="bg-zinc-900/40 rounded-lg px-3 py-2 mb-3 text-[10px]">
          <span className="text-zinc-500 uppercase tracking-widest">Trainer · </span>
          <span className="text-zinc-300 font-mono">{health.trainer.activeModel}</span>
          {health.trainer.promotedBeyondBase && (
            <span className="text-fuchsia-400 ml-2 font-bold">CUSTOM MODEL</span>
          )}
          <span className="text-zinc-600 ml-2">v{health.trainer.currentVersion}</span>
          <span className="text-zinc-500 ml-2">· {health.trainer.conversationsCollected}/{health.trainer.conversationsCollected + health.trainer.conversationsNeeded} convos</span>
        </div>
      )}

      {/* Heartbeat */}
      {health.heartbeat && (
        <div className="text-[10px] text-zinc-600 flex items-center space-x-2">
          <Activity className={`w-3 h-3 ${health.heartbeat.running ? 'text-emerald-400 animate-pulse' : 'text-zinc-700'}`} />
          <span>{health.heartbeat.running ? 'Heartbeat running' : 'Heartbeat stopped'}</span>
          <span className="text-zinc-700">·</span>
          <span>{health.heartbeat.tasksExecuted} tasks / {health.heartbeat.cycles} cycles</span>
        </div>
      )}
    </div>
  );
}
