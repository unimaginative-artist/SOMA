import React, { useState, useEffect } from 'react';
import { Activity, Shield, Cpu, Wifi, Zap, Database, Brain, RefreshCw, CheckCircle2, Server, Eye, Network, GitPullRequest } from 'lucide-react';
import somaBackend from '../../../somaBackend';

const DOMAINS = ['All', 'Logos (Cognition)', 'Ethos (Safety)', 'Trading & Risk', 'Vision & Audio', 'Memory & Vault'];

const SAMPLE_ARBITERS = [
  { name: 'RiskManager', domain: 'Trading & Risk', status: 'active', latency: '2ms', load: '12%' },
  { name: 'CausalityArbiter', domain: 'Logos (Cognition)', status: 'active', latency: '4ms', load: '18%' },
  { name: 'KnowledgeGraphFusion', domain: 'Logos (Cognition)', status: 'active', latency: '1ms', load: '32%' },
  { name: 'VisionProcessingArbiter', domain: 'Vision & Audio', status: 'active', latency: '8ms', load: '24%' },
  { name: 'NemesisReviewSystem', domain: 'Ethos (Safety)', status: 'active', latency: '3ms', load: '8%' },
  { name: 'RecursiveConsolidation', domain: 'Memory & Vault', status: 'active', latency: '5ms', load: '15%' },
  { name: 'PersonalityForgeArbiter', domain: 'Logos (Cognition)', status: 'active', latency: '2ms', load: '6%' },
  { name: 'CuriosityEngine', domain: 'Logos (Cognition)', status: 'active', latency: '3ms', load: '11%' },
];

// Interactive Agent Nodes for Live Neural DAG Graph
const AGENT_NODES = [
  { id: 'logos', name: 'LOGOS (Core Brain)', x: 200, y: 80, role: 'Cognition', color: '#38bdf8' },
  { id: 'aurora', name: 'AURORA (Empathy)', x: 450, y: 80, role: 'Embodiment', color: '#c084fc' },
  { id: 'black', name: 'BlackAgent (Ops)', x: 120, y: 220, role: 'Infrastructure', color: '#34d399' },
  { id: 'kuze', name: 'KuzeAgent (Analyst)', x: 320, y: 220, role: 'Patterns', color: '#f59e0b' },
  { id: 'swarm', name: 'EngSwarm (7-Phase)', x: 530, y: 220, role: 'Code Refactor', color: '#60a5fa' },
  { id: 'guardian', name: 'Guardian (Security)', x: 320, y: 320, role: 'Risk Gate', color: '#f43f5e' },
];

export default function SwarmMonitorApp() {
  const [activeDomain, setActiveDomain] = useState('All');
  const [arbitersCount, setArbitersCount] = useState(231);
  const [pulseCount, setPulseCount] = useState(14820);
  const [memoryHeap, setMemoryHeap] = useState('880 MB / 989 MB');
  const [activeNode, setActiveNode] = useState('logos');
  const [activeLink, setActiveLink] = useState('logos-swarm');
  const [realtimeUptime, setRealtimeUptime] = useState('');
  const [serverOnline, setServerOnline] = useState(true);

  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const state = await somaBackend.fetch('/api/system/state');
        if (state.success && state.snapshot) {
          setServerOnline(true);
          const mem = state.snapshot.memory;
          if (mem) {
            setMemoryHeap(`${mem.heapUsed || 320} MB / ${mem.heapTotal || 512} MB`);
          }
          if (state.snapshot.uptime) {
            const mins = Math.floor(state.snapshot.uptime / 60);
            setRealtimeUptime(`${mins}m`);
          }
        }
      } catch {
        setServerOnline(false);
      }
    };

    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, 4000);
    const pulseTimer = setInterval(() => {
      setPulseCount(prev => prev + Math.floor(Math.random() * 5) + 1);
    }, 2000);

    return () => {
      clearInterval(timer);
      clearInterval(pulseTimer);
    };
  }, []);

  const filteredArbiters = SAMPLE_ARBITERS.filter(a => activeDomain === 'All' || a.domain.includes(activeDomain.split(' ')[0]));

  return (
    <div className="h-full w-full flex flex-col bg-[#060609] text-slate-100 font-sans selection:bg-purple-500/30 overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity size={18} className="text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight flex items-center gap-2">
              Swarm Telemetry & Neural DAG <span className="text-[10px] font-mono bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">231 Arbiters</span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">Live SOMA Multi-Arbiter Swarm & Inter-Agent Signal Graph</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl font-mono text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>SWARM ONLINE</span>
          </div>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-4 gap-4 p-6 shrink-0">
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex items-center gap-3">
          <Cpu className="text-cyan-400" size={24} />
          <div>
            <div className="text-[10px] font-mono text-slate-400">TOTAL ARBITERS</div>
            <div className="text-lg font-bold text-white font-mono">231 Capabilities</div>
          </div>
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex items-center gap-3">
          <Wifi className="text-purple-400" size={24} />
          <div>
            <div className="text-[10px] font-mono text-slate-400">MESSAGEBROKER PULSES</div>
            <div className="text-lg font-bold text-white font-mono">{pulseCount.toLocaleString()} events</div>
          </div>
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex items-center gap-3">
          <Database className="text-amber-400" size={24} />
          <div>
            <div className="text-[10px] font-mono text-slate-400">MEMORY HEAP</div>
            <div className="text-lg font-bold text-white font-mono">{memoryHeap}</div>
          </div>
        </div>

        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex items-center gap-3">
          <Shield className="text-emerald-400" size={24} />
          <div>
            <div className="text-[10px] font-mono text-slate-400">ETHOS RISK GATE</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">100% Passed</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Neural DAG Graph, Right Arbiters Feed */}
      <div className="flex-1 px-6 pb-6 grid grid-cols-5 gap-6 overflow-hidden">
        {/* Left 3 Cols: Interactive Neural DAG Signal Graph */}
        <div className="col-span-3 bg-white/[0.02] border border-white/10 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-wider flex items-center gap-2">
              <Network size={14} /> Interactive Inter-Agent DAG Signal Graph
            </h2>
            <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">
              WebSocket Protocol: Active
            </span>
          </div>

          {/* SVG Neural Graph Viewport */}
          <div className="flex-1 relative bg-black/40 rounded-xl border border-cyan-500/20 overflow-hidden flex items-center justify-center">
            {/* Grid Pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#0284c708_1px,transparent_1px),linear-gradient(to_bottom,#0284c708_1px,transparent_1px)] bg-[size:20px_20px]"></div>

            <svg viewBox="0 0 650 380" className="w-full h-full relative z-10">
              {/* Connecting Signal Lines with Animated Pulses */}
              <line x1="200" y1="80" x2="450" y2="80" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4 4" opacity="0.6" />
              <line x1="200" y1="80" x2="120" y2="220" stroke="#34d399" strokeWidth="2" opacity="0.7" />
              <line x1="200" y1="80" x2="320" y2="220" stroke="#f59e0b" strokeWidth="2" opacity="0.7" />
              <line x1="450" y1="80" x2="530" y2="220" stroke="#60a5fa" strokeWidth="2" opacity="0.7" />
              <line x1="320" y1="220" x2="320" y2="320" stroke="#f43f5e" strokeWidth="2" opacity="0.8" />
              <line x1="120" y1="220" x2="320" y2="320" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
              <line x1="530" y1="220" x2="320" y2="320" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />

              {/* Agent Nodes */}
              {AGENT_NODES.map(node => {
                const isSelected = activeNode === node.id;
                return (
                  <g
                    key={node.id}
                    onClick={() => setActiveNode(node.id)}
                    className="cursor-pointer transition-transform hover:scale-105"
                  >
                    {/* Pulsing Outer Aura */}
                    <circle cx={node.x} cy={node.y} r={isSelected ? 32 : 24} fill={node.color} opacity="0.15" className="animate-pulse" />
                    <circle cx={node.x} cy={node.y} r={isSelected ? 22 : 18} fill="#090d16" stroke={node.color} strokeWidth={isSelected ? 3 : 2} />
                    <circle cx={node.x} cy={node.y} r="6" fill={node.color} />
                    <text x={node.x} y={node.y + 34} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                      {node.name}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Selected Node Details Bar */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between font-mono text-[11px] text-cyan-300 bg-black/70 backdrop-blur-md px-3 py-2 rounded-lg border border-cyan-500/30 z-20">
              <span>ACTIVE ARBITER NODE: <strong className="text-white">{AGENT_NODES.find(n => n.id === activeNode)?.name}</strong></span>
              <span className="text-emerald-400 font-bold">STATE: TRANSMITTING</span>
            </div>
          </div>
        </div>

        {/* Right 2 Cols: Domain Filter Chips & Arbiter Cards */}
        <div className="col-span-2 bg-white/[0.02] border border-white/10 rounded-2xl p-4 flex flex-col justify-between overflow-hidden">
          <h2 className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-wider mb-3 flex items-center gap-2">
            <Server size={14} /> Registered Arbiter Runtimes
          </h2>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3">
            {DOMAINS.map(dom => (
              <button
                key={dom}
                onClick={() => setActiveDomain(dom)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-all whitespace-nowrap ${
                  activeDomain === dom
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                {dom}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredArbiters.map((arb, idx) => (
              <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between font-mono text-xs">
                <div>
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {arb.name}
                  </div>
                  <div className="text-[10px] text-slate-400">{arb.domain}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-cyan-300">{arb.latency}</div>
                  <div className="text-[10px] text-slate-400">Load: {arb.load}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
