import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, Activity, Code, Power, Terminal, Hammer,
  Cpu, Zap, Eye, Database, Network, Server, Unlock, Plus, Blocks, Key, X,
  CheckCircle, ChevronRight, Settings, Radio, RefreshCw, Filter, Globe, Map, Target, Send,
  MessageSquare, Layout, Workflow
} from 'lucide-react';
import { toast } from 'react-toastify';
import { SteveContextManager } from '../lib/SteveContextManager';

const SteveInterface = ({ onClose }) => {
  // State
  const [isOnline, setIsOnline] = useState(true);
  const [steveMood, setSteveMood] = useState('idle'); // idle, architecting, brainstorming
  const [quote, setQuote] = useState("System online. I assume you've broken something already?");

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [isSteveThinking, setIsSteveThinking] = useState(false);

  // Data
  const [stats, setStats] = useState({
    agentsBuilt: 12,
    activeWorkflows: 4,
    optimizations: 156,
    uptime: '48h 12m',
    swarmSync: { active: true, nodes: 32, latency: '12ms' }
  });

  const [activeProjects, setAccounts] = useState([
    { id: 1, name: 'Core Cortex Refinement', status: 'stable', lastUpdate: 'Just now' },
    { id: 2, name: 'Visual Workflow Engine', status: 'active', lastUpdate: '12m ago' }
  ]);

  const [devLog, setScanLog] = useState([
    { id: 1, time: '14:20:01', status: 'success', origin: 'LOCAL', action: 'NODE_GEN', subject: 'Workflow Step: Data Fetcher' },
    { id: 2, time: '14:22:45', status: 'pending', origin: 'SWARM', action: 'OPT_SYNC', subject: 'Memory Tier Warm-tier access' }
  ]);

  // Handle Steve Chat
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !isOnline || isSteveThinking) return;

    const message = chatInput.trim();
    setChatInput('');
    setIsSteveThinking(true);
    setSteveMood('architecting');
    setQuote(`Architecting response for: "${message.substring(0, 20)}..."`);

    try {
      const res = await fetch('/api/steve/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (data.success) {
        setQuote(data.response);
        setSteveMood('idle');
      }
    } catch (e) {
      toast.error("Architectural link to STEVE interrupted.");
    } finally {
      setIsSteveThinking(false);
    }
  };

  const togglePower = () => {
    const next = !isOnline;
    setIsOnline(next);
    if (next) {
      setQuote("Architectural core engaged. Let's build something efficient.");
      toast.success('STEVE Core Activated');
    } else {
      setQuote("Suspending developmental cycles... 💤");
      toast.info('STEVE Core Dormant');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'success': return <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-bold border border-emerald-500/20">SUCCESS</span>;
      case 'pending': return <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded-full text-[10px] font-bold border border-amber-500/20 animate-pulse">PENDING</span>;
      case 'stable': return <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-bold border border-emerald-500/20">STABLE</span>;
      default: return <span className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded-full text-[10px] font-bold border border-white/5">{status.toUpperCase()}</span>;
    }
  };

  const [imgError, setImgError] = useState(false);

  return (
    <div className="h-full flex flex-col bg-[#09090b] text-zinc-200 font-sans p-6 rounded-xl border border-white/5 relative overflow-hidden">
      <style>{`
        @keyframes subtlePulse {
          0%, 100% { opacity: 0.8; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
        }
        .steve-pulse {
          animation: subtlePulse 4s ease-in-out infinite;
        }
      `}</style>

      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded-full transition-all z-50"
        title="Close STEVE"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Header Area */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <div className={`w-16 h-16 rounded-full bg-zinc-800 border-2 overflow-hidden flex items-center justify-center transition-all duration-500 ${isOnline ? 'border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-zinc-700 opacity-50 grayscale'}`}>
              {/* Profile Pic - Animated GIF with fallback */}
              <div className="w-full h-full bg-zinc-900 flex items-center justify-center overflow-hidden">
                {!imgError ? (
                  <img
                    src="/steve_profile.gif"
                    alt="Steve"
                    className={`w-full h-full object-cover object-top scale-125 translate-y-1 ${isOnline ? '' : 'grayscale'}`}
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <Brain className={`w-8 h-8 ${isOnline ? 'text-emerald-500 steve-pulse' : 'text-zinc-600'}`} />
                )}
              </div>
            </div>
            {isOnline && <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-[#09090b] ${steveMood === 'architecting' ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-500'}`} />}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">S.T.E.V.E.</h2>
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                {isOnline ? "Supervised Terminal Execution & Validation Engine" : 'SYSTEM DORMANT'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={togglePower}
            className={`flex items-center space-x-3 px-6 py-3 rounded-xl font-bold transition-all border ${isOnline
                ? 'bg-zinc-800/50 text-zinc-400 border-white/5 hover:bg-zinc-800'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
              }`}
          >
            <Power className="w-5 h-5" />
            <span className="text-xs uppercase tracking-widest">{isOnline ? 'Sleep' : 'Initialize'}</span>
          </button>
        </div>
      </div>

      {/* Message Center (Interactive Console) */}
      <div className="mb-6 relative group">
        <div className="bg-[#0c0c0e] border border-white/10 rounded-xl flex flex-col shadow-inner relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_4px] pointer-events-none opacity-20" />
          <div className="p-4 flex items-center border-b border-white/5">
            <div className="mr-4 p-2 bg-zinc-900 rounded-lg border border-white/5">
              <Terminal className={`w-5 h-5 ${isOnline ? 'text-emerald-400' : 'text-zinc-600'}`} />
            </div>
            <div className="flex-1 font-mono text-sm">
              <span className="text-zinc-600 mr-2">$</span>
              <span className={`${isSteveThinking ? 'animate-pulse' : ''} ${isOnline ? 'text-emerald-400' : 'text-zinc-500'} transition-colors`}>
                {isOnline ? quote : "Architectural core offline. Awaiting dev-trigger..."}
              </span>
              <span className="animate-pulse ml-1 inline-block w-2 h-4 bg-emerald-500/50 align-middle" />
            </div>
          </div>
          {isOnline && (
            <form onSubmit={handleChatSubmit} className="flex p-2 bg-black/40">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type architectural directive to Steve..."
                className="flex-1 bg-transparent border-0 text-xs font-mono text-emerald-500 placeholder-zinc-700 focus:ring-0 outline-none px-2"
              />
              <button type="submit" disabled={isSteveThinking} className="p-1 text-zinc-600 hover:text-emerald-400 transition-colors"><Send className="w-4 h-4" /></button>
            </form>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className={`grid grid-cols-12 gap-6 flex-1 min-h-0 transition-opacity duration-500 ${isOnline ? 'opacity-100' : 'opacity-25 pointer-events-none'}`}>
        <div className="col-span-4 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#151518]/60 p-4 rounded-xl border border-white/5">
              <div className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mb-1">Agents Built</div>
              <div className="text-2xl font-mono text-white">{(Number(stats.agentsBuilt) || 0).toLocaleString()}</div>
            </div>
            <div className="bg-[#151518]/60 p-4 rounded-xl border border-white/5">
              <div className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mb-1">Optimized</div>
              <div className="text-2xl font-mono text-emerald-400">{Number(stats.optimizations) || 0}</div>
            </div>
          </div>
          <div className="bg-[#151518]/60 p-4 rounded-xl border border-white/5 relative overflow-hidden group">
            <div className="absolute inset-0 bg-blue-500/5 group-hover:bg-blue-500/10 transition-colors" />
            <div className="flex justify-between items-start mb-2 relative z-10"><div className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest">Swarm Sync</div><Network className={`w-4 h-4 ${stats.swarmSync?.active ? 'text-emerald-400 animate-pulse' : 'text-zinc-600'}`} /></div>
            <div className="relative z-10"><div className="text-3xl font-mono text-emerald-400 mb-1">{(stats.swarmSync?.nodes || 0)}</div><div className="text-[10px] text-zinc-500 flex items-center space-x-2"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /><span>Active Synaptic Bridges</span></div></div>
          </div>
          <div className="flex-1 bg-[#151518]/60 rounded-xl border border-white/5 p-5 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-4"><h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Development Queue</h3><span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase border border-emerald-500/20 tracking-tighter">BUILDING</span></div>
            <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1 pr-1">{activeProjects.map(acc => (<div key={acc.id} className="p-2.5 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between group hover:border-white/10 transition-colors"><div className="flex items-center space-x-3"><Hammer className="w-3.5 h-3.5 text-zinc-600" /><div><div className="text-xs text-zinc-300 font-medium">{acc.name}</div><div className="text-[9px] text-zinc-600 font-bold uppercase tracking-tighter">Last Update: {acc.lastUpdate}</div></div></div><CheckCircle className="w-3.5 h-3.5 text-emerald-500 opacity-30 group-hover:opacity-100" /></div>))}</div>
          </div>
        </div>
        <div className="col-span-8 bg-[#151518]/60 rounded-xl border border-white/5 p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6"><h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center"><Activity className="w-4 h-4 mr-2 text-blue-400" /> Neural Development Stream</h3><div className="flex space-x-4"><div className="flex items-center space-x-2 text-[10px] text-zinc-500 font-mono"><span className="w-2 h-2 bg-emerald-500/20 rounded-full border border-emerald-500/50" /><span>SUCCESS</span><span className="w-2 h-2 bg-amber-500/20 rounded-full border border-amber-500/50 ml-2" /><span>PENDING</span></div><div className="flex space-x-2"><button className="p-1.5 hover:bg-white/5 rounded text-zinc-500 transition-colors"><Filter className="w-4 h-4" /></button><button className="p-1.5 hover:bg-white/5 rounded text-zinc-500 transition-colors"><RefreshCw className="w-4 h-4" /></button></div></div></div>
          <div className="flex-1 overflow-y-auto custom-scrollbar"><table className="w-full text-left border-separate border-spacing-y-1"><thead className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest sticky top-0 bg-[#151518] z-10"><tr><th className="pb-3 pl-2">Timestamp</th><th className="pb-3">Verdict</th><th className="pb-3">Origin</th><th className="pb-3">Directive</th><th className="pb-3">Module</th></tr></thead><tbody className="text-xs">{devLog.map((log) => (<tr key={log.id} className="hover:bg-white/5 transition-colors group cursor-default"><td className="py-2.5 pl-2 text-zinc-600 font-mono text-[10px] w-24 border-y border-white/5 border-l rounded-l-lg">{log.time}</td><td className="py-2.5 w-24 border-y border-white/5">{getStatusBadge(log.status)}</td><td className="py-2.5 w-16 border-y border-white/5">{log.origin ? (<span className="text-[10px] font-mono bg-white/5 px-1.5 py-0.5 rounded text-zinc-400">{log.origin}</span>) : <span className="text-zinc-700">-</span>}</td><td className="py-2.5 border-y border-white/5 max-w-[150px] truncate"><span className={`text-[10px] ${log.status === 'pending' ? 'text-amber-400' : 'text-zinc-500'}`}>{log.action || 'Routine Gen'}</span></td><td className="py-2.5 text-zinc-300 font-medium border-y border-white/5 border-r rounded-r-lg max-w-[200px] truncate">{log.subject}</td></tr>))}{devLog.length === 0 && (<tr><td colSpan={5} className="py-12 text-center text-zinc-700 italic">No developmental telemetry detected.</td></tr>)}</tbody></table></div>
        </div>
      </div>
    </div>
  );
};

export default SteveInterface;
