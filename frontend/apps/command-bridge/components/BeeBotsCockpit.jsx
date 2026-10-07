import React, { useState, useEffect } from 'react';
import { 
  Zap, Play, Square, RefreshCw, Shield, TrendingUp, TrendingDown, 
  Activity, DollarSign, Cpu, CheckCircle2, AlertCircle, Clock, ChevronRight,
  Award, Sparkles, Layers, Target, Check
} from 'lucide-react';

const formatMoney = (val) => {
  const n = Number(val || 0);
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
};

/**
 * Compact BeeBots Card Body for the Simulation Suite grid
 */
export function BeeBotsCardBody() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/soma/trading/beebots/status');
        if (res.ok && active) {
          setData(await res.json());
        }
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const p = data?.portfolio;
  const bees = p?.bees || {};
  const isRunning = data?.isRunning;
  const laya = data?.laya;
  const isCuda = laya?.online && laya?.device?.toLowerCase().includes('cuda');

  return (
    <div className="flex flex-col h-full p-3 justify-between">
      {/* Top Status Badges */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-amber-400 animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-[9px] font-mono uppercase font-bold text-zinc-400">
            {isRunning ? 'AUTONOMOUS' : 'STANDBY'}
          </span>
        </div>
        <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-bold uppercase ${isCuda ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}`}>
          {isCuda ? 'CUDA LAYA' : 'RULE FALLBACK'}
        </span>
      </div>

      {/* Equity & PnL */}
      <div className="my-1">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Total Equity</div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-mono font-bold text-white">
            {formatMoney(p?.totalEquity || 1000)}
          </span>
          <span className={`text-xs font-mono font-bold ${(p?.totalRealizedPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {(p?.totalRealizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(p?.totalRealizedPnl || 0)}
          </span>
        </div>
      </div>

      {/* 3 Bees Micro Badges */}
      <div className="grid grid-cols-3 gap-1 pt-1 border-t border-white/5">
        {[
          { key: 'bizzy', emoji: '⚡', name: 'Bizzy', pair: 'BTC' },
          { key: 'boozy', emoji: '🍸', name: 'Boozy', pair: 'ETH' },
          { key: 'breezy', emoji: '🍃', name: 'Breezy', pair: 'SOL' }
        ].map(b => {
          const bee = bees[b.key];
          const hasPos = !!bee?.position;
          return (
            <div key={b.key} className="bg-black/30 rounded p-1 text-center border border-white/5">
              <div className="text-[9px] flex items-center justify-center gap-0.5 font-bold text-zinc-300">
                <span>{b.emoji}</span>
                <span>{b.name}</span>
              </div>
              <div className={`text-[8px] font-mono mt-0.5 font-bold ${hasPos ? (bee.position.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-500'}`}>
                {hasPos ? bee.position.side : 'FLAT'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Full Expanded SOMA BeeBots Swarm Cockpit
 */
export function BeeBotsView() {
  const [data, setData] = useState(null);
  const [promotionData, setPromotionData] = useState(null);
  const [tickBusy, setTickBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState('');
  const [lastTickReport, setLastTickReport] = useState(null);
  const [cockpitTab, setCockpitTab] = useState('promotion'); // 'promotion' | 'ledger'

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/soma/trading/beebots/status');
      if (res.ok) {
        setData(await res.json());
      }
    } catch {}
  };

  const fetchPromotion = async () => {
    try {
      const res = await fetch('/api/soma/trading/beebots/promotion');
      if (res.ok) {
        const json = await res.json();
        setPromotionData(json.promotion);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    fetchPromotion();
    const interval = setInterval(() => {
      fetchStatus();
      fetchPromotion();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleReconcile = async () => {
    if (reconcileBusy) return;
    setReconcileBusy(true);
    setReconcileError('');
    try {
      const res = await fetch('/api/soma/trading/beebots/reconcile', { method: 'POST' });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Reconciliation failed');
      await Promise.all([fetchStatus(), fetchPromotion()]);
    } catch (err) {
      console.error('Reconciliation error:', err);
      setReconcileError(err.message || 'Reconciliation failed');
    } finally {
      setReconcileBusy(false);
    }
  };

  const handleManualTick = async () => {
    if (tickBusy) return;
    setTickBusy(true);
    try {
      const res = await fetch('/api/soma/trading/beebots/tick', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setLastTickReport(json.report);
        await fetchStatus();
      }
    } catch (err) {
      console.error('Tick error:', err);
    } finally {
      setTickBusy(false);
    }
  };

  const handleToggleRunning = async () => {
    if (toggleBusy || !data) return;
    setToggleBusy(true);
    const endpoint = data.isRunning ? '/api/soma/trading/beebots/stop' : '/api/soma/trading/beebots/start';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error('Toggle error:', err);
    } finally {
      setToggleBusy(false);
    }
  };

  const p = data?.portfolio;
  const bees = p?.bees || {};
  const laya = data?.laya;
  const isCuda = laya?.online && laya?.device?.toLowerCase().includes('cuda');

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-6 bg-black/40 text-zinc-100 font-sans">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 shadow-inner">
            <Zap className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight uppercase">SOMA BeeBots Swarm Cockpit</h2>
              <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase ${data?.isRunning ? 'bg-amber-400/10 text-amber-300 border border-amber-400/20' : 'bg-zinc-800 text-zinc-500'}`}>
                {data?.isRunning ? 'Autonomous Active (60s loop)' : 'Manual Mode'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">
              1R Fixed Risk · ModernBERT Laya Substrate · Multi-Strategy Swarm
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleManualTick}
            disabled={tickBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${tickBusy ? 'animate-spin' : ''}`} />
            {tickBusy ? 'Ticking Market...' : 'Tick Swarm Now'}
          </button>

          <button
            onClick={handleToggleRunning}
            disabled={toggleBusy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 ${
              data?.isRunning 
                ? 'border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300' 
                : 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {data?.isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {data?.isRunning ? 'Stop Loop' : 'Start Autonomous Loop'}
          </button>
        </div>
      </div>

      {/* Swarm Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 my-4 shrink-0">
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Total Equity</div>
          <div className="text-lg font-mono font-bold text-white mt-1">
            {formatMoney(p?.totalEquity || 1000)}
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">Pool: $1,000.00</div>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Realized P&amp;L</div>
          <div className={`text-lg font-mono font-bold mt-1 ${(p?.totalRealizedPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {(p?.totalRealizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(p?.totalRealizedPnl || 0)}
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">{p?.totalTrades || 0} closed trades</div>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Swarm Win Rate</div>
          <div className="text-lg font-mono font-bold text-cyan-400 mt-1">
            {Number(p?.totalWinRate || 0).toFixed(1)}%
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">Across 3 micro-strategies</div>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Market Regime</div>
          <div className="text-sm font-mono font-bold text-amber-300 mt-1">
            {data?.regime || 'RANGING'}
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">CNS Macro Adapter Synced</div>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Laya Decision Substrate</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${isCuda ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-sm font-mono font-bold text-white">
              {isCuda ? 'CUDA RTX 5070' : 'Algorithmic Fallback'}
            </span>
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">
            {isCuda ? `${laya.latencyMs}ms · ModernBERT 421M` : '100% Zero Downtime Edge'}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">Risk Model</div>
          <div className="text-sm font-mono font-bold text-zinc-200 mt-1">
            1R ATR Risk
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5">2% equity/trade · Trailing stops</div>
        </div>
      </div>

      {/* 3 Bees Interactive Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 shrink-0">
        {/* Bizzy Bee */}
        <BeeCard
          beeKey="bizzy"
          emoji="⚡"
          name="Bizzy Bee"
          pair="BTC-USDT-SWAP"
          strategy="Larry Williams Dual Thrust Breakout"
          desc="Enters when price crosses dynamic range thresholds; cuts fast on mean reversion."
          beeData={bees.bizzy}
          lastReport={lastTickReport?.bees?.bizzy}
        />

        {/* Boozy Bee */}
        <BeeCard
          beeKey="boozy"
          emoji="🍸"
          name="Boozy Bee"
          pair="ETH-USDT-SWAP"
          strategy="Statistical Mean-Reversion & Band Fade"
          desc="Fades Bollinger %B & RSI extremes; captures snap-back to VWAP fair value."
          beeData={bees.boozy}
          lastReport={lastTickReport?.bees?.boozy}
        />

        {/* Breezy Bee */}
        <BeeCard
          beeKey="breezy"
          emoji="🍃"
          name="Breezy Bee"
          pair="SOL-USDT-SWAP"
          strategy="Multi-Factor Trend & Funding Carry"
          desc="Surfs 24h momentum with favorable perpetual funding carry edge."
          beeData={bees.breezy}
          lastReport={lastTickReport?.bees?.breezy}
        />
      </div>

      {/* Lower Section: Tabs for Promotion Ladder & Closed Trades Ledger */}
      <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-white/5 bg-zinc-900/30 p-4">
        {/* Tab Controls */}
        <div className="flex items-center justify-between mb-3 shrink-0 border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCockpitTab('promotion')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                cockpitTab === 'promotion'
                  ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                  : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Award className="w-3.5 h-3.5 text-amber-400" />
              Strategy Promotion Ladder &amp; Lab Sharing
            </button>

            <button
              onClick={() => setCockpitTab('ledger')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                cockpitTab === 'ledger'
                  ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                  : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              Closed Paper Trades ({p?.recentClosedTrades?.length || 0})
            </button>
          </div>

          {cockpitTab === 'promotion' && (
            <button
              onClick={handleReconcile}
              disabled={reconcileBusy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 hover:bg-cyan-400/20 text-cyan-300 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${reconcileBusy ? 'animate-spin' : ''}`} />
              {reconcileBusy ? 'Reconciling Evidence...' : 'Reconcile Paper Evidence'}
            </button>
          )}
        </div>

        {/* Tab Content */}
        {cockpitTab === 'promotion' ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3">
            {reconcileError && <div role="alert" className="text-xs text-rose-300">{reconcileError}</div>}
            {/* Policy Criteria Banner */}
            <div className="p-3 rounded-lg border border-white/5 bg-black/30 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-zinc-300 font-bold uppercase tracking-wide">Sim-To-Live Promotion Gates:</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-zinc-400">
                <span>&ge; 100 Paper Trades</span>
                <span>&bull;</span>
                <span>&ge; 60% Win Rate</span>
                <span>&bull;</span>
                <span>&ge; 1.4 Profit Factor</span>
                <span>&bull;</span>
                <span>&le; 12% Max Drawdown</span>
              </div>
            </div>

            {/* 3 Strategy Promotion Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { key: 'bizzy', emoji: '⚡', name: 'Bizzy Dual Thrust', symbol: 'BTC-USD' },
                { key: 'boozy', emoji: '🍸', name: 'Boozy Mean Rev', symbol: 'ETH-USD' },
                { key: 'breezy', emoji: '🍃', name: 'Breezy Trend Carry', symbol: 'SOL-USD' }
              ].map(item => {
                const info = promotionData?.bees?.[item.key];
                const stats = info?.paperStats || {};
                const gates = info?.gates || {};
                const progressPct = gates.tradesProgressPct || 0;
                const isGraduated = info?.liveEligible;

                return (
                  <div key={item.key} className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                    isGraduated 
                      ? 'border-emerald-500/40 bg-emerald-950/10 shadow-lg shadow-emerald-950/20' 
                      : 'border-white/5 bg-black/20'
                  }`}>
                    <div>
                      {/* Top Strategy Header */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{item.emoji}</span>
                          <span className="font-bold text-xs text-white uppercase">{item.name}</span>
                        </div>
                        <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                          isGraduated 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : stats.trades > 0 
                              ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                              : 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                        }`}>
                          {info?.tierLabel || 'Research validation pending'}
                        </span>
                      </div>

                      <div className="text-[10px] text-zinc-500 font-mono mb-2 flex items-center justify-between">
                        <span>Symbol: {item.symbol}</span>
                        <span className="text-amber-400/80">
                          {item.key === 'bizzy'
                            ? `Dual Thrust ${promotionData?.sharedTuning?.bizzy?.k1 ?? 0.5}/${promotionData?.sharedTuning?.bizzy?.k2 ?? 0.5}`
                            : item.key === 'boozy'
                              ? `RSI ${promotionData?.sharedTuning?.boozy?.rsiOversold ?? 30}/${promotionData?.sharedTuning?.boozy?.rsiOverbought ?? 70}`
                              : 'Trend & Carry'}
                        </span>
                      </div>

                      {/* Trade Volume Progress Bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-zinc-400">Paper Trades Progress</span>
                          <span className="text-white font-bold">{stats.trades || 0} / 100</span>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${isGraduated ? 'bg-emerald-400' : 'bg-amber-400'}`}
                            style={{ width: `${Math.min(100, progressPct)}%` }}
                          />
                        </div>
                      </div>

                      {/* Gates Checklist */}
                      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono mb-3">
                        <div className="p-1.5 rounded bg-white/5 border border-white/5">
                          <div className="text-zinc-500 text-[8px] uppercase">Win Rate (&ge;60%)</div>
                          <div className={`font-bold mt-0.5 ${gates.winRatePassed ? 'text-emerald-400' : 'text-zinc-300'}`}>
                            {Number(stats.winRate || 0).toFixed(1)}% {gates.winRatePassed ? '✓' : ''}
                          </div>
                        </div>

                        <div className="p-1.5 rounded bg-white/5 border border-white/5">
                          <div className="text-zinc-500 text-[8px] uppercase">Profit Factor (&ge;1.4)</div>
                          <div className={`font-bold mt-0.5 ${gates.profitFactorPassed ? 'text-emerald-400' : 'text-zinc-300'}`}>
                            {stats.profitFactor != null ? Number(stats.profitFactor).toFixed(2) : 'n/a'} {gates.profitFactorPassed ? '✓' : ''}
                          </div>
                        </div>

                        <div className="p-1.5 rounded bg-white/5 border border-white/5">
                          <div className="text-zinc-500 text-[8px] uppercase">Drawdown (&le;12%)</div>
                          <div className={`font-bold mt-0.5 ${gates.drawdownPassed ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {Number(stats.maxDrawdownPct || 0).toFixed(1)}% {gates.drawdownPassed ? '✓' : ''}
                          </div>
                        </div>

                        <div className="p-1.5 rounded bg-white/5 border border-white/5">
                          <div className="text-zinc-500 text-[8px] uppercase">Net Paper PnL</div>
                          <div className={`font-bold mt-0.5 ${(stats.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {(stats.totalPnl || 0) >= 0 ? '+' : ''}{formatMoney(stats.totalPnl || 0)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer Status */}
                    <div className="pt-2 border-t border-white/5 text-[9px] font-mono text-zinc-500">
                      {isGraduated ? (
                        <div className="flex items-center gap-1 text-emerald-400 font-bold">
                          <Sparkles className="w-3 h-3" />
                          Eligible for human live review
                        </div>
                      ) : (
                        <div>
                          {info?.tierLabel || 'Research validation pending'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
            {(!p?.recentClosedTrades || p.recentClosedTrades.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 italic text-xs py-8">
                <span>No closed BeeBot paper trades recorded.</span>
              </div>
            ) : (
              p.recentClosedTrades.map((t, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg border border-white/5 bg-black/20 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-400">{t.beeName || t.bee}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${t.side === 'LONG' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {t.side}
                    </span>
                    <span className="font-mono text-zinc-300">{t.symbol}</span>
                    <span className="text-[10px] text-zinc-500">Exit: {t.exitReason}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className={`font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}{formatMoney(t.pnl)}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${t.rMultiple >= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                      {t.rMultiple >= 0 ? '+' : ''}{t.rMultiple}R
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BeeCard({ beeKey, emoji, name, pair, strategy, desc, beeData, lastReport }) {
  const pos = beeData?.position;
  const isFlat = !pos;
  const cash = beeData?.cash || 333.33;
  const equity = beeData?.equity || 333.33;
  const realizedPnl = beeData?.realizedPnl || 0;
  const winRate = beeData?.winRatePct || 0;
  const tradesCount = beeData?.tradesCount || 0;

  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 p-4 flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{emoji}</span>
            <div>
              <div className="text-xs font-bold text-white uppercase">{name}</div>
              <div className="text-[9px] font-mono text-zinc-500">{pair}</div>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${isFlat ? 'bg-zinc-800 text-zinc-500' : (pos.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30')}`}>
            {isFlat ? 'FLAT' : `${pos.side} @ ${pos.entryPrice}`}
          </span>
        </div>

        {/* Strategy description */}
        <div className="text-[10px] text-zinc-400 mb-3 line-clamp-2">
          {strategy} · <span className="text-zinc-500">{desc}</span>
        </div>

        {/* Live position or Last Signal */}
        {pos ? (
          <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 mb-3 font-mono text-[10px] space-y-1">
            <div className="flex justify-between text-zinc-400">
              <span>Position Size</span>
              <span className="text-white">{pos.size} contracts</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Stop Loss</span>
              <span className="text-rose-400">${pos.stopLoss}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Take Profit</span>
              <span className="text-emerald-400">${pos.takeProfit}</span>
            </div>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-black/20 border border-white/5 mb-3 font-mono text-[10px] flex items-center justify-between text-zinc-500">
            <span>Stance: Flat / Searching</span>
            <span>Conviction: {lastReport?.decision?.conviction ?? 0}/3</span>
          </div>
        )}
      </div>

      {/* Accounting footer */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-center font-mono">
        <div>
          <div className="text-[8px] uppercase tracking-wider text-zinc-500">Equity</div>
          <div className="text-xs font-bold text-white mt-0.5">{formatMoney(equity)}</div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wider text-zinc-500">Realized</div>
          <div className={`text-xs font-bold mt-0.5 ${realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {realizedPnl >= 0 ? '+' : ''}{formatMoney(realizedPnl)}
          </div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wider text-zinc-500">Win Rate</div>
          <div className="text-xs font-bold text-cyan-400 mt-0.5">{winRate}% ({tradesCount})</div>
        </div>
      </div>
    </div>
  );
}
