import React, { useRef, useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Zap, AlertTriangle, RefreshCw } from 'lucide-react';

const NeuralDissonanceMonitor = ({ isConnected }) => {
  const [stats, setStats] = useState({ dissonanceDetected: 0, decisionsRefined: 0 });
  const [history, setHistory] = useState([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState(null);
  const priorCount = useRef(null);

  useEffect(() => {
    if (!isConnected) return;
    const fetchDissonanceData = async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const cronaStats = data.dissonance || null;
        if (!cronaStats) {
          setAvailable(false);
          setError(null);
          return;
        }
        const count = Number(cronaStats.dissonanceDetected || 0);
        const prior = priorCount.current;
        const delta = prior === null ? 0 : Math.max(0, count - prior);
        priorCount.current = count;
        setAvailable(true);
        setError(null);
        setStats({
          dissonanceDetected: count,
          decisionsRefined: Number(cronaStats.decisionsRefined || 0)
        });
        setHistory(prev => [...prev, { time: Date.now(), conflicts: delta }].slice(-30));
      } catch (e) {
        setError(e.message);
      }
    };

    fetchDissonanceData();
    const interval = setInterval(fetchDissonanceData, 20000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const recentConflicts = history.slice(-5).reduce((sum, point) => sum + point.conflicts, 0);

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-amber-500/10 rounded-xl p-5 shadow-lg flex flex-col justify-between h-[200px] relative overflow-hidden hover:border-amber-500/30 transition-all duration-500">
      <div className="flex justify-between items-start relative z-10">
        <div className="flex-1">
          <h3 className="text-amber-400 font-bold text-xs flex items-center uppercase tracking-[0.2em]">
            <AlertTriangle className="w-3 h-3 mr-2" /> Neural Dissonance
          </h3>
          {error ? (
            <div className="text-[11px] text-red-400 mt-4">Status unavailable</div>
          ) : !available ? (
            <div className="text-[11px] text-zinc-500 mt-4">Crona not active</div>
          ) : (
            <>
              <div className="flex items-baseline mt-2 space-x-2">
                <span className="text-3xl font-bold text-white font-mono">{stats.dissonanceDetected}</span>
                <span className="text-[10px] text-zinc-500 uppercase font-bold">Total Conflicts</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-1 flex items-center">
                <RefreshCw className="w-2.5 h-2.5 mr-1 text-emerald-500" />
                Decisions Refined: <span className="text-white ml-1 font-mono">{stats.decisionsRefined}</span>
              </div>
            </>
          )}
        </div>
        <div className={`p-2 rounded-lg ${recentConflicts > 0 ? 'bg-amber-500/20' : 'bg-zinc-800/50'}`}>
          <Zap className={`w-5 h-5 ${recentConflicts > 0 ? 'text-amber-400' : 'text-zinc-600'}`} />
        </div>
      </div>

      <div className="h-16 w-full mt-4 opacity-70">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history}>
            <defs>
              <linearGradient id="colorDissonance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="stepAfter" dataKey="conflicts" stroke="#f59e0b" strokeWidth={1.5} fill="url(#colorDissonance)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] text-zinc-600 uppercase tracking-widest">New conflicts, last five polls</span>
        <span className={`text-[10px] font-mono font-bold ${recentConflicts ? 'text-amber-400' : 'text-emerald-400'}`}>{recentConflicts}</span>
      </div>
    </div>
  );
};

export default NeuralDissonanceMonitor;
