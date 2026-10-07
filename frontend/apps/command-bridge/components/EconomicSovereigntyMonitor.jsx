import React, { useEffect, useState } from 'react';
import { DollarSign, Activity, Shield, TrendingUp, BriefcaseBusiness, Zap, Cpu } from 'lucide-react';

const money = (value) => {
  const number = Number(value || 0);
  return `${number < 0 ? '-' : ''}$${Math.abs(number).toFixed(2)}`;
};

const EconomicSovereigntyMonitor = ({ isConnected }) => {
  const [viewTab, setViewTab] = useState('beebots'); // 'beebots' | 'mission'
  const [performance, setPerformance] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [beeStatus, setBeeStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConnected) return;
    let active = true;
    const fetchStats = async () => {
      try {
        const [summaryRes, runtimeRes, beeRes] = await Promise.allSettled([
          fetch('/api/trading/summary').then(res => res.ok ? res.json() : Promise.reject(new Error(`Trading HTTP ${res.status}`))),
          fetch('/api/mission-control/runtime').then(res => res.ok ? res.json() : Promise.reject(new Error(`Runtime HTTP ${res.status}`))),
          fetch('/api/soma/trading/beebots/status').then(res => res.ok ? res.json() : Promise.reject(new Error(`BeeBots HTTP ${res.status}`)))
        ]);
        if (!active) return;
        if (summaryRes.status === 'fulfilled') setPerformance(summaryRes.value.summary || null);
        if (runtimeRes.status === 'fulfilled') setRuntime(runtimeRes.value.runtime || null);
        if (beeRes.status === 'fulfilled') setBeeStatus(beeRes.value || null);
        if (summaryRes.status === 'rejected' && runtimeRes.status === 'rejected') {
          setError('Mission Control data unavailable');
        } else {
          setError(null);
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isConnected]);

  const pnl = Number(performance?.total_pnl || 0);
  const tier = runtime?.activeTier || runtime?.mode || 'paper';
  const strategy = runtime?.activeStrategy?.strategyName || 'No promoted strategy';
  const trades = performance?.total_trades || 0;

  const beePortfolio = beeStatus?.portfolio;
  const beeEquity = beePortfolio?.totalEquity || 1000;
  const beeRealized = beePortfolio?.totalRealizedPnl || 0;
  const beeWinRate = Number(beePortfolio?.totalWinRate || 0).toFixed(1);
  const beeTrades = beePortfolio?.totalTrades || 0;
  const beeOpen = beePortfolio?.openPositions || 0;
  const isCuda = beeStatus?.laya?.online && beeStatus?.laya?.device?.toLowerCase().includes('cuda');

  return (
    <div className="p-4 border border-amber-500/20 rounded-xl bg-[#151518]/70 backdrop-blur-md shadow-lg h-[210px] flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {viewTab === 'beebots' ? (
            <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400 flex items-center">
              <Zap className="w-3.5 h-3.5 mr-1 text-amber-400" /> BeeBots Swarm
            </h3>
          ) : (
            <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400 flex items-center">
              <DollarSign className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Mission Capital
            </h3>
          )}
        </div>

        {/* View Switcher Pills */}
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5 text-[9px] font-bold">
          <button
            onClick={() => setViewTab('beebots')}
            className={`px-2 py-0.5 rounded transition-all ${viewTab === 'beebots' ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Swarm
          </button>
          <button
            onClick={() => setViewTab('mission')}
            className={`px-2 py-0.5 rounded transition-all ${viewTab === 'mission' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Mission
          </button>
        </div>
      </div>

      {!isConnected && <div className="text-xs text-zinc-600 py-5 text-center">Offline</div>}
      {isConnected && !performance && !runtime && !beeStatus && !error && (
        <div className="text-xs text-zinc-600 py-5 text-center animate-pulse">Loading trading telemetry...</div>
      )}
      {error && !performance && !runtime && !beeStatus && <div className="text-xs text-red-400 py-5 text-center">{error}</div>}

      {/* BEEBOTS SWARM VIEW */}
      {viewTab === 'beebots' && (beeStatus || !error) && (
        <>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-[10px] text-zinc-400 uppercase font-bold">Total Equity ($1K Pool)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-mono font-bold text-white">
                {money(beeEquity)}
              </span>
              <span className={`text-xs font-mono font-bold ${beeRealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {beeRealized >= 0 ? '+' : ''}{money(beeRealized)}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-black/30 p-1.5 rounded border border-white/5">
              <div className="text-[8px] text-zinc-500 uppercase flex items-center"><Activity className="w-2.5 h-2.5 mr-1" /> Trades</div>
              <div className="text-xs font-mono text-zinc-100">{beeTrades}</div>
            </div>
            <div className="bg-black/30 p-1.5 rounded border border-white/5">
              <div className="text-[8px] text-zinc-500 uppercase flex items-center"><TrendingUp className="w-2.5 h-2.5 mr-1" /> Win Rate</div>
              <div className="text-xs font-mono text-zinc-100">{beeWinRate}%</div>
            </div>
            <div className="bg-black/30 p-1.5 rounded border border-white/5">
              <div className="text-[8px] text-zinc-500 uppercase flex items-center"><Shield className="w-2.5 h-2.5 mr-1" /> Open Pos</div>
              <div className="text-xs font-mono text-amber-300">{beeOpen}</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 pt-1 border-t border-white/5">
            <span className="flex items-center gap-1">⚡ BTC · 🍸 ETH · 🍃 SOL</span>
            <span className={isCuda ? 'text-emerald-400' : 'text-amber-400'}>
              {isCuda ? 'CUDA RTX 5070' : 'Rule Fallback'}
            </span>
          </div>
        </>
      )}

      {/* MISSION CAPITAL VIEW */}
      {viewTab === 'mission' && (performance || runtime) && (
        <>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-[10px] text-zinc-500 uppercase font-bold">Paper P&amp;L</span>
            <span className={`text-xl font-mono font-bold ${pnl < 0 ? 'text-red-400' : pnl > 0 ? 'text-emerald-400' : 'text-zinc-300'}`}>
              {money(pnl)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-black/20 p-1.5 rounded border border-white/5">
              <div className="text-[9px] text-zinc-500 uppercase flex items-center"><Activity className="w-2.5 h-2.5 mr-1" /> Trades</div>
              <div className="text-xs font-mono text-zinc-100">{trades}</div>
            </div>
            <div className="bg-black/20 p-1.5 rounded border border-white/5">
              <div className="text-[9px] text-zinc-500 uppercase flex items-center"><TrendingUp className="w-2.5 h-2.5 mr-1" /> Win Rate</div>
              <div className="text-xs font-mono text-zinc-100">{Number(performance?.win_rate || 0).toFixed(1)}%</div>
            </div>
            <div className="bg-black/20 p-1.5 rounded border border-white/5">
              <div className="text-[9px] text-zinc-500 uppercase flex items-center"><Shield className="w-2.5 h-2.5 mr-1" /> Open</div>
              <div className="text-xs font-mono text-zinc-100">{performance?.open_trades || 0}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-[10px] text-zinc-500 pt-1 border-t border-white/5">
            <BriefcaseBusiness className="w-3 h-3 shrink-0" />
            <span className="truncate">{strategy}</span>
          </div>
        </>
      )}
    </div>
  );
};

export default EconomicSovereigntyMonitor;
