import React, { useState, useEffect } from 'react';
import { Database, Zap, HardDrive, Archive, Activity, TrendingUp } from 'lucide-react';

const MemoryTierMonitor = ({ isConnected }) => {
  const [memoryStats, setMemoryStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isConnected) return;

    const fetchMemoryStats = async () => {
      try {
        const response = await fetch('/api/memory/status');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setMemoryStats(data);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
      }
    };

    fetchMemoryStats();
    let interval;
    const t = setTimeout(() => { interval = setInterval(fetchMemoryStats, 20000); }, Math.random() * 7000);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [isConnected]);

  if (!isConnected || isLoading) {
    return (
      <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg flex items-center justify-center">
        <Activity className="w-5 h-5 text-zinc-600 animate-pulse" />
      </div>
    );
  }

  const { hot, warm, cold } = memoryStats || {};
  const totalHits = (hot?.hits || 0) + (warm?.hits || 0) + (cold?.hits || 0);
  const totalMisses = (hot?.misses || 0) + (warm?.misses || 0) + (cold?.misses || 0);
  const overallHitRate = totalHits > 0 ? (totalHits / (totalHits + totalMisses) * 100) : 0;

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
          <Database className="w-4 h-4 mr-2 text-blue-400" /> Memory Tiers
        </h3>
        <span className="text-[10px] font-mono text-emerald-400 font-bold">{overallHitRate.toFixed(1)}% HIT RATE</span>
      </div>

      <div className="space-y-3">
        <div className="bg-[#09090b]/40 rounded-lg p-3 border border-white/5 flex items-center justify-between group hover:border-red-500/20 transition-all">
          <div className="flex items-center space-x-3">
            <Zap className="w-4 h-4 text-red-400" />
            <div>
              <div className="text-zinc-200 text-xs font-semibold">Hot (Redis)</div>
              <div className="text-zinc-500 text-[9px]">&lt;1ms Latency</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-zinc-200 text-xs font-mono">{hot?.used || 0} MB</div>
            <div className="text-zinc-600 text-[9px]">{(hot?.hitRate || 0).toFixed(0)}% Eff</div>
          </div>
        </div>

        <div className="bg-[#09090b]/40 rounded-lg p-3 border border-white/5 flex items-center justify-between group hover:border-amber-500/20 transition-all">
          <div className="flex items-center space-x-3">
            <HardDrive className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-zinc-200 text-xs font-semibold">Warm (Vector)</div>
              <div className="text-zinc-500 text-[9px]">~10ms Latency</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-zinc-200 text-xs font-mono">{warm?.used || 0} Vecs</div>
            <div className="text-zinc-600 text-[9px]">{(warm?.hitRate || 0).toFixed(0)}% Eff</div>
          </div>
        </div>

        <div className="bg-[#09090b]/40 rounded-lg p-3 border border-white/5 flex items-center justify-between group hover:border-blue-500/20 transition-all">
          <div className="flex items-center space-x-3">
            <Archive className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-zinc-200 text-xs font-semibold">Cold (SQLite)</div>
              <div className="text-zinc-500 text-[9px]">~50ms Latency</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-zinc-200 text-xs font-mono">{cold?.used || 0} Recs</div>
            <div className="text-zinc-600 text-[9px]">{(cold?.hitRate || 0).toFixed(0)}% Eff</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemoryTierMonitor;
