import React, { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, Zap, Wifi, Server, Database, Lock, Terminal } from 'lucide-react';

const generateDataPoint = (prev: number, min: number, max: number, volatility: number) => {
  const change = (Math.random() - 0.5) * volatility;
  let next = prev + change;
  return Math.max(min, Math.min(max, next));
};

const SystemMonitoring: React.FC = () => {
  // Mock Data States
  const [metrics, setMetrics] = useState({
    neuralLoad: 45,    // %
    tokenVelocity: 120, // t/s
    latency: 240,       // ms
    memory: 32          // GB
  });

  const [history, setHistory] = useState<{
    load: number[];
    tokens: number[];
    latency: number[];
  }>({
    load: Array(20).fill(45),
    tokens: Array(20).fill(120),
    latency: Array(20).fill(240),
  });

  const [systemLogs, setSystemLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Animation Loop
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => {
        const newLoad = generateDataPoint(prev.neuralLoad, 20, 95, 15);
        const newTokens = generateDataPoint(prev.tokenVelocity, 50, 400, 40);
        const newLatency = generateDataPoint(prev.latency, 150, 500, 30);
        
        setHistory(h => ({
          load: [...h.load.slice(1), newLoad],
          tokens: [...h.tokens.slice(1), newTokens],
          latency: [...h.latency.slice(1), newLatency],
        }));

        return {
          neuralLoad: newLoad,
          tokenVelocity: newTokens,
          latency: newLatency,
          memory: prev.memory
        };
      });

      // Random technical log generation
      if (Math.random() > 0.6) {
        const techLogs = [
            "GC_MAJOR_SWEEP: Reclaimed 45MB heap",
            "VECTOR_DB: Index shard #4 rebalanced",
            "HANDSHAKE_ACK: Node arb-004 <-> arb-009",
            "TOKEN_BUCKET: Refill rate adjusted +15%",
            "HEALTH_CHECK: Agent swarm integrity 99.9%",
            "CACHE_HIT: Query hash 0x4f9a found in L2",
            "TLS_ROTATE: Ephemeral keys updated",
            "AUTO_SCALE: Thread pool capacity stable"
        ];
        const randomLog = techLogs[Math.floor(Math.random() * techLogs.length)];
        const timestamp = new Date().toISOString().split('T')[1].replace('Z','');
        setSystemLogs(prev => [...prev.slice(-15), `[${timestamp}] ${randomLog}`]);
      }

    }, 800);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [systemLogs]);

  return (
    <div className="h-full grid grid-cols-12 grid-rows-12 gap-6 p-1">
        
      {/* Top Row: KPI Cards */}
      <div className="col-span-12 row-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard 
            title="NEURAL LOAD" 
            value={`${metrics.neuralLoad.toFixed(1)}%`} 
            data={history.load} 
            color="#D8B4FE"
            icon={Cpu}
          />
          <MetricCard 
            title="TOKEN VELOCITY" 
            value={`${Math.floor(metrics.tokenVelocity)} t/s`} 
            data={history.tokens} 
            color="#34D399"
            icon={Zap}
          />
          <MetricCard 
            title="SYS LATENCY" 
            value={`${Math.floor(metrics.latency)} ms`} 
            data={history.latency} 
            color="#F472B6"
            icon={Activity}
          />
          <MetricCard 
            title="NETWORK UPTIME" 
            value="99.999%" 
            data={history.load.map(v => 100 - (v/20))} // Fake consistent data
            color="#60A5FA"
            icon={Wifi}
          />
      </div>

      {/* Middle Row Left: Live System Terminal */}
      <div className="col-span-12 lg:col-span-8 row-span-5 glass-panel rounded-3xl p-6 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyber-primary to-transparent opacity-50"></div>
          <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-cyber-white flex items-center gap-2 tracking-widest">
                  <Terminal className="w-4 h-4 text-cyber-primary" /> 
                  KERNEL_EVENT_STREAM
              </h3>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 animate-pulse">
                  LIVE CONNECTION
              </span>
          </div>
          <div className="flex-1 bg-black/40 rounded-xl border border-white/5 p-4 font-mono text-xs overflow-hidden relative">
             <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.2)_0,transparent_62%)] opacity-10"></div>
             <div className="h-full overflow-y-auto custom-scrollbar flex flex-col justify-end space-y-1">
                {systemLogs.map((log, i) => (
                    <div key={i} className="text-cyber-primary/70 border-b border-white/5 pb-1 last:border-0 hover:bg-white/5 transition-colors">
                        <span className="text-cyber-muted opacity-50 mr-3">{'>'}</span>
                        {log}
                    </div>
                ))}
                <div ref={logsEndRef} />
             </div>
          </div>
      </div>

      {/* Middle Row Right: Server Status */}
      <div className="col-span-12 lg:col-span-4 row-span-5 glass-panel rounded-3xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-6">
             <Server className="w-4 h-4 text-cyber-primary" />
             <h3 className="text-sm font-bold text-cyber-white tracking-widest">NODE_HEALTH</h3>
          </div>
          
          <div className="flex-1 grid grid-cols-2 gap-3 content-start">
             {[...Array(6)].map((_, i) => (
                 <div key={i} className="bg-white/5 rounded-lg p-3 border border-white/5 flex flex-col gap-2 relative overflow-hidden group hover:border-cyber-primary/30 transition-colors">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] text-cyber-muted font-mono">NODE_0{i+1}</span>
                        <div className={`w-2 h-2 rounded-full ${Math.random() > 0.1 ? 'bg-emerald-400 shadow-[0_0_5px_#34D399]' : 'bg-amber-400 animate-pulse'}`}></div>
                    </div>
                    <div className="h-1 w-full bg-black/50 rounded-full overflow-hidden">
                        <div 
                           className="h-full bg-cyber-primary/50 transition-all duration-1000" 
                           style={{ width: `${40 + Math.random() * 50}%`}}
                        ></div>
                    </div>
                 </div>
             ))}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10">
             <div className="flex items-center justify-between text-xs text-cyber-muted mb-2">
                <span className="flex items-center gap-2"><Database className="w-3 h-3"/> Vector DB Size</span>
                <span className="text-cyber-white font-mono">14.2 GB</span>
             </div>
             <div className="flex items-center justify-between text-xs text-cyber-muted">
                <span className="flex items-center gap-2"><Lock className="w-3 h-3"/> Encryption</span>
                <span className="text-emerald-400 font-mono">AES-256</span>
             </div>
          </div>
      </div>

      {/* Bottom Row: Resource Distribution */}
      <div className="col-span-12 row-span-4 glass-panel rounded-3xl p-6 relative overflow-hidden">
         <h3 className="text-sm font-bold text-cyber-white tracking-widest mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyber-primary" /> 
            AGENT_RESOURCE_ALLOCATION
         </h3>
         <div className="flex items-end justify-between gap-2 h-32 px-2">
            {[...Array(24)].map((_, i) => {
                const height = 20 + Math.random() * 70;
                return (
                    <div key={i} className="flex-1 flex flex-col gap-1 group">
                        <div className="relative w-full bg-white/5 rounded-t-sm overflow-hidden flex flex-col justify-end transition-all duration-500 hover:bg-white/10" style={{ height: '100%' }}>
                            <div 
                                className="w-full bg-gradient-to-t from-cyber-primary/20 to-cyber-vivid/80 transition-all duration-700 group-hover:shadow-[0_0_15px_rgba(192,38,211,0.5)]"
                                style={{ height: `${height}%` }}
                            ></div>
                        </div>
                    </div>
                )
            })}
         </div>
         <div className="flex justify-between mt-2 px-2 text-[10px] text-cyber-muted font-mono opacity-50">
             <span>SHARD_001</span>
             <span>SHARD_012</span>
             <span>SHARD_024</span>
         </div>
      </div>

    </div>
  );
};

// Sub-component for charts
const MetricCard = ({ title, value, data, color, icon: Icon }: any) => {
    return (
        <div className="bg-cyber-base/40 border border-white/5 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon className="w-12 h-12" />
            </div>
            
            <div className="z-10">
                <h4 className="text-[10px] font-bold text-cyber-muted tracking-widest mb-1">{title}</h4>
                <div className="text-2xl font-mono text-cyber-white font-bold tracking-tighter" style={{ textShadow: `0 0 10px ${color}40` }}>
                    {value}
                </div>
            </div>

            <div className="h-12 mt-4 flex items-end gap-1">
                {data.map((d: number, i: number) => {
                   const max = Math.max(...data) * 1.1;
                   const h = (d / max) * 100;
                   return (
                       <div 
                         key={i} 
                         style={{ height: `${h}%`, backgroundColor: color }} 
                         className="flex-1 rounded-t-sm opacity-60"
                       ></div>
                   )
                })}
            </div>
        </div>
    )
}

export default SystemMonitoring;
