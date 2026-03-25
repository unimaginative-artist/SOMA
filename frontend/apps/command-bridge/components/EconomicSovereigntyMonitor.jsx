import React, { useState, useEffect } from 'react';
import { DollarSign, Activity, Zap, Shield, Users } from 'lucide-react';
import { motion } from 'framer-motion';

const EconomicSovereigntyMonitor = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('http://localhost:3100/api/status');
        const data = await response.json();
        setStats(data);
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch MAX stats:', err);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !stats) {
    return (
      <div className="p-4 border border-white/5 rounded-xl bg-black/20 animate-pulse">
        <div className="h-4 w-24 bg-white/10 rounded mb-2"></div>
        <div className="h-8 w-full bg-white/5 rounded"></div>
      </div>
    );
  }

  const { economics, agents, agentLoop } = stats;
  const netProfit = economics?.netProfit || '$0.00';
  const isDebt = netProfit.startsWith('$-');

  return (
    <div className="p-5 border border-amber-500/20 rounded-xl bg-[#151518]/60 backdrop-blur-md hover:border-amber-500/40 transition-all shadow-lg">
      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400 flex items-center">
          <DollarSign className="w-3 h-3 mr-1" /> Economic Sovereignty
        </h3>
        <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold">Net Profit</span>
            <span className={`text-xl font-mono font-bold ${isDebt ? 'text-red-400' : 'text-emerald-400'}`}>
              {netProfit}
            </span>
          </div>
          <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (parseFloat(netProfit.replace('$','')) / 1) * 100)}%` }}
              className={`h-full ${isDebt ? 'bg-red-500' : 'bg-emerald-500'}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-black/20 p-2 rounded border border-white/5">
            <div className="text-[9px] text-zinc-500 uppercase mb-1 flex items-center">
              <Users className="w-2 h-2 mr-1" /> Active Swarm
            </div>
            <div className="text-sm font-mono text-white">
              {agents?.activeCount || 0} Agents
            </div>
          </div>
          <div className="bg-black/20 p-2 rounded border border-white/5">
            <div className="text-[9px] text-zinc-500 uppercase mb-1 flex items-center">
              <Shield className="w-2 h-2 mr-1" /> Tool Healing
            </div>
            <div className="text-sm font-mono text-white">
              {agentLoop?.busy ? 'Lazarus Active' : 'Stable'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-500">SYSTEM TIER</span>
          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded font-bold">
            LEVEL 4 ALPHA
          </span>
        </div>
      </div>
    </div>
  );
};

export default EconomicSovereigntyMonitor;
