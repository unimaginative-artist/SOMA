import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart2, RefreshCw } from 'lucide-react';

const ASSETS = [
  { id: 'BTC', label: 'BTC/USD', base: 65000, volatility: 0.018 },
  { id: 'ETH', label: 'ETH/USD', base: 3200, volatility: 0.022 },
  { id: 'SOL', label: 'SOL/USD', base: 145, volatility: 0.028 },
  { id: 'SOMA', label: 'SOMA/USD', base: 42, volatility: 0.035 },
];

const HISTORY_LEN = 80;

function gaussianRandom(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function SparkLine({ data, width = 260, height = 64, up }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fill = `${d} L${width},${height} L0,${height} Z`;
  const color = up ? '#10b981' : '#f43f5e';
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${up}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#grad-${up})`} />
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      {/* Current price dot */}
      <circle cx={pts[pts.length - 1][0].toFixed(1)} cy={pts[pts.length - 1][1].toFixed(1)} r="3" fill={color} />
    </svg>
  );
}

export default function MarketSim({ simId, expanded }) {
  const [assetIdx, setAssetIdx] = useState(0);
  const asset = ASSETS[assetIdx];

  const [prices, setPrices] = useState(() => {
    const arr = [asset.base];
    for (let i = 1; i < HISTORY_LEN; i++) {
      const prev = arr[arr.length - 1];
      arr.push(Math.max(0.01, prev * (1 + gaussianRandom(0, asset.volatility * 0.3))));
    }
    return arr;
  });

  const [cash, setCash] = useState(10000);
  const [holding, setHolding] = useState(0);
  const [trades, setTrades] = useState([]);
  const [running, setRunning] = useState(true);
  const [betSize, setBetSize] = useState(500);
  const intervalRef = useRef(null);
  const pricesRef = useRef(prices);
  pricesRef.current = prices;

  const tick = useCallback(() => {
    setPrices(prev => {
      const last = prev[prev.length - 1];
      const drift = 0.00005;
      const next = Math.max(0.01, last * (1 + gaussianRandom(drift, asset.volatility)));
      const updated = [...prev.slice(-(HISTORY_LEN - 1)), next];
      return updated;
    });
  }, [asset.volatility]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(tick, 600);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, tick]);

  // Reset prices when asset changes
  useEffect(() => {
    const arr = [asset.base];
    for (let i = 1; i < HISTORY_LEN; i++) {
      const prev = arr[arr.length - 1];
      arr.push(Math.max(0.01, prev * (1 + gaussianRandom(0, asset.volatility * 0.3))));
    }
    setPrices(arr);
    setHolding(0);
    setTrades([]);
    setCash(10000);
  }, [assetIdx]);

  const current = prices[prices.length - 1];
  const open = prices[0];
  const change = ((current - open) / open) * 100;
  const up = change >= 0;
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const portfolioValue = cash + holding * current;
  const pnl = portfolioValue - 10000;

  const buy = () => {
    const qty = betSize / current;
    if (cash < betSize) return;
    setCash(c => c - betSize);
    setHolding(h => h + qty);
    setTrades(t => [{ side: 'BUY', qty: qty.toFixed(4), price: current.toFixed(2), ts: Date.now() }, ...t.slice(0, 19)]);
  };

  const sell = () => {
    const sellQty = Math.min(holding, betSize / current);
    if (sellQty <= 0) return;
    setCash(c => c + sellQty * current);
    setHolding(h => h - sellQty);
    setTrades(t => [{ side: 'SELL', qty: sellQty.toFixed(4), price: current.toFixed(2), ts: Date.now() }, ...t.slice(0, 19)]);
  };

  const fmt = (n) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(2)}`;

  return (
    <div className="flex flex-col h-full bg-[#09090b] text-zinc-200 text-xs overflow-hidden">
      {/* Asset selector */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-white/5">
        {ASSETS.map((a, i) => (
          <button
            key={a.id}
            onClick={() => setAssetIdx(i)}
            className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
              i === assetIdx
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-zinc-600 hover:text-zinc-400 border border-transparent'
            }`}
          >{a.id}</button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setRunning(r => !r)}
            className={`p-1 rounded border transition-all ${running ? 'border-emerald-500/20 text-emerald-500' : 'border-zinc-700 text-zinc-500'}`}
            title={running ? 'Pause' : 'Resume'}
          >
            {running
              ? <Activity className="w-3 h-3 animate-pulse" />
              : <RefreshCw className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Price + chart */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-2xl font-mono font-bold text-white">{fmt(current)}</span>
          <span className={`flex items-center gap-0.5 font-mono font-bold text-sm ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
            {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {up ? '+' : ''}{change.toFixed(2)}%
          </span>
        </div>
        <div className="flex gap-4 text-[10px] text-zinc-600 mb-2">
          <span>H: {fmt(high)}</span>
          <span>L: {fmt(low)}</span>
          <span>O: {fmt(open)}</span>
        </div>
        <div className="w-full overflow-hidden">
          <SparkLine data={prices} width={expanded ? 520 : 260} height={expanded ? 96 : 64} up={up} />
        </div>
      </div>

      {/* Portfolio bar */}
      <div className={`grid gap-2 px-3 py-2 border-y border-white/5 ${expanded ? 'grid-cols-4' : 'grid-cols-2'}`}>
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Cash</div>
          <div className="font-mono text-zinc-300">${cash.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{asset.id} Held</div>
          <div className="font-mono text-zinc-300">{holding.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Portfolio</div>
          <div className="font-mono text-zinc-300">${portfolioValue.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider">P&L</div>
          <div className={`font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Trade controls */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5">
        <DollarSign className="w-3 h-3 text-zinc-600" />
        <input
          type="number"
          value={betSize}
          onChange={e => setBetSize(Math.max(1, Number(e.target.value)))}
          className="w-20 bg-zinc-900 border border-zinc-700/50 rounded px-2 py-1 font-mono text-[10px] text-zinc-300 focus:outline-none focus:border-emerald-500/40"
        />
        <button
          onClick={buy}
          disabled={cash < betSize}
          className="px-3 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider text-[10px] transition-all disabled:opacity-30"
        >Buy</button>
        <button
          onClick={sell}
          disabled={holding <= 0}
          className="px-3 py-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 font-bold uppercase tracking-wider text-[10px] transition-all disabled:opacity-30"
        >Sell</button>
        <button
          onClick={() => { setCash(10000); setHolding(0); setTrades([]); }}
          className="ml-auto text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >Reset</button>
      </div>

      {/* Trade log */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
        {trades.length === 0
          ? <div className="text-center text-zinc-700 text-[10px] pt-4">No trades yet. Buy or sell to begin.</div>
          : trades.map((t, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 border-b border-white/5 last:border-0">
              <span className={`text-[9px] font-bold w-8 ${t.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.side}</span>
              <span className="font-mono text-zinc-400 text-[10px]">{t.qty} {asset.id}</span>
              <span className="font-mono text-zinc-600 text-[10px] ml-auto">@ ${t.price}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}
