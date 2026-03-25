import React, { useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Zap, AlertTriangle, RefreshCw, Activity } from 'lucide-react';

const NeuralDissonanceMonitor = ({ isConnected }) => {
  const [stats, setStats] = useState({ dissonanceDetected: 0, decisionsRefined: 0 });
  const [history, setHistory] = useState([]);
  const [recentConflicts, setRecentConflicts] = useState([]);

  useEffect(() => {
    if (!isConnected) return;

    const fetchDissonanceData = async () => {
      try {
        // We pull stats from Crona and the system status
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          const cronaStats = data.dissonance || data.arbiters?.find(a => a.name === 'CronaArbiter')?.stats;
          
          if (cronaStats) {
            setStats({
                dissonanceDetected: cronaStats.dissonanceDetected || 0,
                decisionsRefined: cronaStats.decisionsRefined || 0
            });
            
            // Add to the 'stress' history chart
            setHistory(prev => [...prev, { 
                time: Date.now(), 
                stress: cronaStats.dissonanceDetected > 0 ? (cronaStats.dissonanceDetected % 10) + 1 : 0.5 
            }].slice(-30));
          } else {
              // Fallback/Mock for UI demo if server is initializing
              setHistory(prev => [...prev, { time: Date.now(), stress: 0.5 + Math.random() * 0.2 }].slice(-30));
          }
        }
      } catch (e) {}
    };

    fetchDissonanceData();
    let interval;
    const t = setTimeout(() => { interval = setInterval(fetchDissonanceData, 20000); }, Math.random() * 7000);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [isConnected]);

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-amber-500/10 rounded-xl p-5 shadow-lg flex flex-col justify-between h-[200px] relative overflow-hidden group hover:border-amber-500/30 transition-all duration-500">
      
      {/* Background Warning Glow */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-amber-500/5 rounded-full blur-3xl group-hover:bg-amber-500/10 transition-colors"></div>

      <div className="flex justify-between items-start relative z-10">
        <div className="flex-1">
          <h3 className="text-amber-400 font-bold text-xs flex items-center uppercase tracking-[0.2em]">
            <AlertTriangle className="w-3 h-3 mr-2 animate-pulse" /> Neural Dissonance
          </h3>
          <div className="flex items-baseline mt-2 space-x-2">
            <span className="text-3xl font-bold text-white font-mono">{stats.dissonanceDetected}</span>
            <span className="text-[10px] text-zinc-500 uppercase font-bold">Conflicts Found</span>
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center">
            <RefreshCw className="w-2.5 h-2.5 mr-1 text-emerald-500" /> 
            Self-Corrections: <span className="text-white ml-1 font-mono">{stats.decisionsRefined}</span>
          </div>
        </div>
        <div className={`p-2 rounded-lg ${stats.dissonanceDetected > 0 ? 'bg-amber-500/20' : 'bg-zinc-800/50'}`}>
          <Zap className={`w-5 h-5 ${stats.dissonanceDetected > 0 ? 'text-amber-400 animate-pulse' : 'text-zinc-600'}`} />
        </div>
      </div>

      {/* Stress Level Chart */}
      <div className="h-16 w-full mt-4 opacity-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history}>
            <defs>
              <linearGradient id="colorStress" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Area 
                type="stepAfter" 
                dataKey="stress" 
                stroke="#f59e0b" 
                strokeWidth={1.5} 
                fill="url(#colorStress)" 
                isAnimationActive={false} 
                strokeDasharray={stats.dissonanceDetected > 0 ? "0" : "3 3"}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Status Bar */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex space-x-1">
            {[...Array(5)].map((_, i) => (
                <div key={i} className={`h-1 w-4 rounded-full ${i < (stats.dissonanceDetected % 6) ? 'bg-amber-500 shadow-[0_0_5px_#f59e0b]' : 'bg-zinc-800'}`}></div>
            ))}
        </div>
        <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Temporal Stability: 98.4%</span>
      </div>
    </div>
  );
};

export default NeuralDissonanceMonitor;
