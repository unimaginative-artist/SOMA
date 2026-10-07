import React, { useEffect, useState } from 'react';
import { Activity, Cpu, HardDrive, Server, Terminal, Wifi } from 'lucide-react';

type RuntimeSnapshot = {
  status?: string;
  cpu?: number;
  ram?: number;
  gpu?: number | null;
  network?: number;
  memory?: { heapUsed?: number; rss?: number };
  agents?: Array<{ id?: string; name?: string; status?: unknown; load?: number }>;
  counts?: { arbiters?: number; fragments?: number };
};

type ActivityEvent = {
  id?: string;
  timestamp?: number;
  agent?: string;
  action?: string;
  evidenceStatus?: string;
};

const SystemMonitoring: React.FC = () => {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [history, setHistory] = useState<{ cpu: number[]; ram: number[]; heap: number[] }>({ cpu: [], ram: [], heap: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [systemResponse, eventResponse] = await Promise.all([
          fetch('/api/system/state'),
          fetch('/api/activity/recent?limit=12')
        ]);
        const systemData = await systemResponse.json();
        const eventData = await eventResponse.json();
        if (!systemResponse.ok || !systemData?.success) throw new Error(systemData?.error || 'System snapshot unavailable');
        if (!live) return;
        const next: RuntimeSnapshot = systemData.snapshot;
        setSnapshot(next);
        setEvents(Array.isArray(eventData?.feed) ? eventData.feed : []);
        setHistory(previous => ({
          cpu: [...previous.cpu.slice(-19), Number(next.cpu || 0)],
          ram: [...previous.ram.slice(-19), Number(next.ram || 0)],
          heap: [...previous.heap.slice(-19), Number(next.memory?.heapUsed || 0)]
        }));
        setError(null);
      } catch (requestError: any) {
        if (live) setError(requestError.message || 'Runtime unavailable');
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, []);

  const agents = snapshot?.agents || [];

  return (
    <div className="h-full grid grid-cols-12 grid-rows-12 gap-6 p-1">
      <div className="col-span-12 row-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard title="CPU LOAD" value={snapshot ? `${snapshot.cpu || 0}%` : '--'} data={history.cpu} color="#D8B4FE" icon={Cpu} />
        <MetricCard title="RAM LOAD" value={snapshot ? `${snapshot.ram || 0}%` : '--'} data={history.ram} color="#34D399" icon={HardDrive} />
        <MetricCard title="NODE HEAP" value={snapshot ? `${snapshot.memory?.heapUsed || 0} MB` : '--'} data={history.heap} color="#F472B6" icon={Activity} />
        <MetricCard title="NETWORK LOAD" value={snapshot ? `${snapshot.network || 0}%` : '--'} data={history.cpu.map(() => Number(snapshot?.network || 0))} color="#60A5FA" icon={Wifi} />
      </div>

      <div className="col-span-12 lg:col-span-8 row-span-5 glass-panel rounded-3xl p-6 flex flex-col relative overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-cyber-white flex items-center gap-2 tracking-widest">
            <Terminal className="w-4 h-4 text-cyber-primary" /> VERIFIED_ACTIVITY_STREAM
          </h3>
          <span className={`text-[10px] px-2 py-1 rounded border ${error ? 'text-rose-300 border-rose-500/20 bg-rose-500/10' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10'}`}>
            {error ? 'DISCONNECTED' : 'API CONNECTED'}
          </span>
        </div>
        <div className="flex-1 bg-black/40 rounded-xl border border-white/5 p-4 font-mono text-xs overflow-y-auto custom-scrollbar">
          {error && <div className="text-rose-300">{error}</div>}
          {!error && events.length === 0 && <div className="text-cyber-muted">No recorded runtime events.</div>}
          {events.map((event, index) => (
            <div key={`${event.id || index}-${event.timestamp || 0}`} className="text-cyber-primary/70 border-b border-white/5 py-1">
              <span className="text-cyber-muted opacity-60 mr-3">{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '--'}</span>
              {event.agent || 'System'}: {event.action || 'activity'}
              {event.evidenceStatus && <span className="ml-2 text-[10px] text-emerald-300">[{event.evidenceStatus}]</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="col-span-12 lg:col-span-4 row-span-5 glass-panel rounded-3xl p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-6">
          <Server className="w-4 h-4 text-cyber-primary" />
          <h3 className="text-sm font-bold text-cyber-white tracking-widest">REGISTERED_AGENTS</h3>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-3 content-start">
          {agents.slice(0, 6).map((agent, index) => (
            <div key={agent.id || index} className="bg-white/5 rounded-lg p-3 border border-white/5 flex flex-col gap-2">
              <div className="flex justify-between items-center gap-1">
                <span title={agent.name} className="truncate text-[10px] text-cyber-muted font-mono">{agent.name || agent.id}</span>
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
              </div>
              <div className="h-1 w-full bg-black/50 rounded-full overflow-hidden">
                <div className="h-full bg-cyber-primary/50" style={{ width: `${Math.max(0, Math.min(100, Number(agent.load || 0)))}%` }} />
              </div>
            </div>
          ))}
          {!agents.length && <div className="col-span-2 text-xs text-cyber-muted">No registered agents reported.</div>}
        </div>
        <div className="mt-4 pt-4 border-t border-white/10 text-xs text-cyber-muted space-y-2">
          <div className="flex justify-between"><span>Registered agents</span><span className="font-mono text-cyber-white">{agents.length}</span></div>
          <div className="flex justify-between"><span>Runtime status</span><span className="font-mono text-emerald-400">{snapshot?.status || '--'}</span></div>
        </div>
      </div>

      <div className="col-span-12 row-span-4 glass-panel rounded-3xl p-6 relative overflow-hidden">
        <h3 className="text-sm font-bold text-cyber-white tracking-widest mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyber-primary" /> REPORTED_AGENT_LOAD
        </h3>
        <div className="flex items-end justify-between gap-2 h-32 px-2">
          {agents.slice(0, 24).map((agent, index) => (
            <div key={agent.id || index} title={`${agent.name || agent.id}: ${agent.load || 0}%`} className="flex-1 h-full flex flex-col justify-end">
              <div className="w-full bg-gradient-to-t from-cyber-primary/20 to-cyber-vivid/80 rounded-t-sm" style={{ height: `${Math.max(2, Math.min(100, Number(agent.load || 0)))}%` }} />
            </div>
          ))}
          {!agents.length && <div className="text-xs text-cyber-muted">No agent load metrics reported by runtime.</div>}
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, data, color, icon: Icon }: any) => {
  const max = Math.max(...data, 1);
  return (
    <div className="bg-cyber-base/40 border border-white/5 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden">
      <Icon className="absolute right-3 top-3 w-12 h-12 opacity-10" />
      <div>
        <h4 className="text-[10px] font-bold text-cyber-muted tracking-widest mb-1">{title}</h4>
        <div className="text-2xl font-mono text-cyber-white font-bold">{value}</div>
      </div>
      <div className="h-12 mt-4 flex items-end gap-1">
        {data.map((item: number, index: number) => (
          <div key={index} style={{ height: `${Math.max(2, (item / max) * 100)}%`, backgroundColor: color }} className="flex-1 rounded-t-sm opacity-60" />
        ))}
      </div>
    </div>
  );
};

export default SystemMonitoring;
