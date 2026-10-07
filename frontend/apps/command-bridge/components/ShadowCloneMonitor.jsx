import React, { useState, useEffect } from 'react';
import { Users, Zap, CheckCircle2, Clock } from 'lucide-react';

const ShadowCloneMonitor = ({ isConnected }) => {
  const [stats, setStats] = useState({
    activeClones: 0,
    totalSyntheses: 0,
    recentSyntheses: [],
    currentClones: []
  });

  useEffect(() => {
    if (!isConnected) return;

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/balancer/stats');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.stats) {
            setStats(data.stats);
          }
        }
      } catch (error) {
        console.warn('Failed to fetch balancer stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const formatRuntime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div data-component="ShadowCloneMonitor" className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg h-[300px] flex flex-col transition-all duration-300">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
          <Users className="w-4 h-4 mr-2 text-purple-400" /> Shadow Clone Network
        </h3>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${
          stats.activeClones > 0
            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20 animate-pulse'
            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
        }`}>
          {stats.activeClones > 0 ? `${stats.activeClones} Active` : 'Dormant'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
        {/* Active Clones */}
        {stats.currentClones.length > 0 && (
          <>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Active Clones</div>
            {stats.currentClones.map(clone => (
              <div key={clone.id} className="bg-purple-500/10 border border-purple-500/20 p-2 rounded text-xs">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex-1">
                    <div className="font-bold text-purple-300 flex items-center">
                      <Zap className="w-3 h-3 mr-1" /> {clone.task}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      Parent: {clone.parent} • ID: {clone.id.split('_')[1]}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-purple-400 font-mono text-[10px]">
                      {formatRuntime(clone.runtime)}
                    </div>
                  </div>
                </div>
                <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                  <span className="flex items-center">
                    <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500" />
                    {clone.tasksCompleted} tasks
                  </span>
                  <span>{clone.learnings} learnings</span>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Recent Syntheses */}
        {stats.recentSyntheses.length > 0 && (
          <>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 mt-3">
              Recent Syntheses
            </div>
            {stats.recentSyntheses.slice(0, 3).map((synthesis, idx) => (
              <div key={idx} className="bg-[#09090b]/40 border border-white/5 p-2 rounded text-xs text-zinc-400">
                <div className="flex justify-between">
                  <span className="text-emerald-400 font-medium">{synthesis.task}</span>
                  <span className="text-[10px] text-zinc-600">
                    {formatRuntime(synthesis.runtime)}
                  </span>
                </div>
                <div className="text-[10px] text-zinc-600 mt-1">
                  {synthesis.tasksCompleted} tasks • {synthesis.learningsCount} learnings integrated
                </div>
              </div>
            ))}
          </>
        )}

        {/* Empty State */}
        {stats.currentClones.length === 0 && stats.recentSyntheses.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-zinc-600 text-xs italic">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No shadow clones active.</p>
              <p className="text-[10px] mt-1 text-zinc-700">
                Clones spawn during high cognitive load.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="mt-3 pt-2 border-t border-white/5 flex justify-between text-[10px] text-zinc-500">
        <span>Total Syntheses: <span className="text-zinc-400 font-mono">{stats.totalSyntheses}</span></span>
        <span>Active: <span className="text-purple-400 font-mono">{stats.activeClones}</span></span>
      </div>
    </div>
  );
};

export default ShadowCloneMonitor;
