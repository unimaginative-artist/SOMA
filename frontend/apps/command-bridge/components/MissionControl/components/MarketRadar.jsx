import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Radio, Waves, Droplets, DollarSign, Scale, Sword, Shield, Anchor, Wind } from 'lucide-react';

// -----------------------------
// ENGINE LOGIC JOOK
// -----------------------------

const calculateOrderbookPressure = (bidDepth, askDepth, buyVol, sellVol, prevBid, prevAsk) => {
    const totalDepth = Math.max(bidDepth + askDepth, 1);
    const imbalance = (bidDepth - askDepth) / totalDepth;
    const totalVol = buyVol + sellVol + 1e-9;
    const aggression = (buyVol - sellVol) / totalVol;
    const absorb = (bidDepth - prevBid) - (askDepth - prevAsk);
    const pressure = (0.4 * imbalance) + (0.4 * aggression) + (0.2 * Math.tanh(absorb / 5000));
    return { pressure, imbalance, aggression, absorb };
};

const calculateStormIndex = (volRatio, correlation, liqPressure) => {
    const stormRaw = (0.4 * volRatio) + (0.4 * correlation) + (0.2 * liqPressure * 10);
    const stormIndex = Math.min(100, Math.max(0, stormRaw * 25));
    let state = "CALM";
    if (stormIndex > 60) state = "STORM";
    else if (stormIndex > 30) state = "UNSTABLE";
    return { stormIndex, state };
};

export const useMarketEngine = (riskMetrics, isDemoMode, tickers, selectedSymbol) => {
    const [engineData, setEngineData] = useState({
        flowZ: 0.5,
        leverage: 0.02,
        volRatio: 1.2,
        correlation: 0.6,
        liqPressure: 0.05,
        bidDepth: 2500000,
        askDepth: 2400000,
        buyVolume: 1500,
        sellVolume: 1200,
        prevBidDepth: 2500000,
        prevAskDepth: 2400000,
        fundingRate: 0.01
    });

    // Real P&L from backend
    const [realPnL, setRealPnL] = useState({ totalPnL: 0, winRate: 0 });

    // Real telemetry from scalping engine
    const [telemetry, setTelemetry] = useState({ latency: 0, tradesPerSecond: 0, avgFill: 0 });

    // Top-5 bid/ask levels from the live orderbook (used for depth bar rendering)
    const [obLevels, setObLevels] = useState({ bids: [], asks: [] });

    // Single consolidated poll — all three fetches run sequentially in one loop.
    // An in-flight ref prevents overlapping polls if the backend is slow.
    // Consecutive failures back off exponentially (5s → 10s → 20s → max 30s).
    useEffect(() => {
        let cancelled = false;
        let isPolling = false;
        let consecutiveFails = 0;
        const BASE_INTERVAL = 5000;
        const MAX_INTERVAL = 30000;

        const poll = async () => {
            if (isPolling || cancelled) return;
            isPolling = true;
            let anyFailed = false;

            // 1. Telemetry
            try {
                const res = await fetch('/api/scalping/stats', { signal: AbortSignal.timeout(4000) });
                if (!cancelled && res.ok) {
                    const data = await res.json();
                    if (data.success && data.stats) {
                        setTelemetry({
                            latency: data.stats.avg_latency_ms || 0,
                            tradesPerSecond: data.stats.trades_per_second || 0,
                            avgFill: data.stats.avg_fill_time_ms || 0
                        });
                    }
                }
            } catch { anyFailed = true; }

            if (cancelled) { isPolling = false; return; }

            // 2. P&L
            try {
                const res = await fetch(`/api/performance/summary?is_demo=${isDemoMode}`, { signal: AbortSignal.timeout(4000) });
                if (!cancelled && res.ok) {
                    const data = await res.json();
                    if (data.success && data.summary) {
                        setRealPnL({
                            totalPnL: data.summary.total_pnl || 0,
                            winRate: data.summary.win_rate || 0
                        });
                    }
                }
            } catch { anyFailed = true; }

            if (cancelled) { isPolling = false; return; }

            // 3. Orderbook / market data
            try {
                const symbol = selectedSymbol || 'BTCUSDT';
                const res = await fetch(`/api/binance/orderbook/${symbol}?limit=20`, { signal: AbortSignal.timeout(4000) });
                if (!cancelled && res.ok) {
                    const data = await res.json();
                    if (data.success && data.data) {
                        const { bids, asks, metrics } = data.data;
                        const bidDepth = bids?.reduce((sum, b) => sum + (b.qty * b.price), 0) || 0;
                        const askDepth = asks?.reduce((sum, a) => sum + (a.qty * a.price), 0) || 0;
                        const buyVol = bids?.slice(0, 5).reduce((sum, b) => sum + b.qty, 0) || 0;
                        const sellVol = asks?.slice(0, 5).reduce((sum, a) => sum + a.qty, 0) || 0;
                        // Store top-5 levels for depth bar rendering (no more Math.random)
                        if (bids?.length && asks?.length) {
                            setObLevels({ bids: bids.slice(0, 5), asks: asks.slice(0, 5) });
                        }
                        setEngineData(prev => ({
                            ...prev,
                            bidDepth: bidDepth || prev.bidDepth,
                            askDepth: askDepth || prev.askDepth,
                            buyVolume: buyVol * 1000 || prev.buyVolume,
                            sellVolume: sellVol * 1000 || prev.sellVolume,
                            prevBidDepth: prev.bidDepth,
                            prevAskDepth: prev.askDepth,
                            flowZ: metrics?.imbalance ? metrics.imbalance * 5 : prev.flowZ,
                            liqPressure: Math.abs(metrics?.imbalance || 0) > 0.3 ? 0.5 : prev.liqPressure * 0.9
                        }));
                    }
                }
            } catch {
                anyFailed = true;
                // Simulation fallback when backend is unreachable
                if (!cancelled) {
                    setEngineData(prev => ({
                        ...prev,
                        flowZ: Math.max(-5, Math.min(5, prev.flowZ + (Math.random() - 0.5) * 0.3)),
                        leverage: Math.max(-0.5, Math.min(0.5, prev.leverage + (Math.random() - 0.5) * 0.03)),
                        volRatio: Math.max(0.5, Math.min(3.0, prev.volRatio + (Math.random() - 0.5) * 0.08)),
                        correlation: Math.max(0, Math.min(1, prev.correlation + (Math.random() - 0.5) * 0.03)),
                        liqPressure: prev.liqPressure * 0.95 + (Math.random() > 0.97 ? Math.random() * 0.3 : 0),
                        bidDepth: Math.max(100000, prev.bidDepth + (Math.random() - 0.5) * 300000),
                        askDepth: Math.max(100000, prev.askDepth + (Math.random() - 0.5) * 300000),
                        buyVolume: Math.max(100, prev.buyVolume + (Math.random() - 0.5) * 300),
                        sellVolume: Math.max(100, prev.sellVolume + (Math.random() - 0.5) * 300),
                        prevBidDepth: prev.bidDepth,
                        prevAskDepth: prev.askDepth
                    }));
                }
            }

            // Backoff: double interval on consecutive failures, cap at MAX_INTERVAL
            consecutiveFails = anyFailed ? Math.min(consecutiveFails + 1, 3) : 0;
            isPolling = false;
        };

        // Initial poll, then schedule next one only after the previous completes
        const scheduleNext = () => {
            if (cancelled) return;
            const delay = Math.min(BASE_INTERVAL * Math.pow(2, consecutiveFails), MAX_INTERVAL);
            setTimeout(async () => {
                await poll();
                scheduleNext();
            }, delay);
        };

        poll().then(scheduleNext);

        return () => { cancelled = true; };
    }, [isDemoMode, selectedSymbol]);

    const obMetrics = useMemo(() =>
        calculateOrderbookPressure(engineData.bidDepth, engineData.askDepth, engineData.buyVolume, engineData.sellVolume, engineData.prevBidDepth, engineData.prevAskDepth),
        [engineData]);

    const stormMetrics = useMemo(() => {
        // Calculate real market volatility if tickers are available
        let realVolRatio = engineData.volRatio;
        let realCorrelation = engineData.correlation;
        
        if (tickers && tickers.length > 0) {
            // Calculate average volatility across all tickers
            const avgVolatility = tickers.reduce((sum, t) => sum + (t.volatility || 50), 0) / tickers.length;
            // Normalize to 0.5-3.0 range (vol 0-100 maps to 0.5-3.0)
            realVolRatio = 0.5 + (avgVolatility / 100) * 2.5;
            
            // Calculate correlation based on how many assets move together
            const bullish = tickers.filter(t => (t.change || 0) > 0).length;
            const bearish = tickers.filter(t => (t.change || 0) < 0).length;
            const total = tickers.length;
            // High correlation = most moving in same direction
            realCorrelation = Math.abs(bullish - bearish) / total;
        }
        
        return calculateStormIndex(realVolRatio, realCorrelation, engineData.liqPressure);
    }, [engineData, tickers]);

    // Calculate P&L - use real P&L from backend if available, otherwise use equity calculation
    const pnl = realPnL.totalPnL !== 0 
        ? realPnL.totalPnL 
        : (riskMetrics ? riskMetrics.equity - riskMetrics.initialBalance : 0);
    const pnlPercent = riskMetrics ? (pnl / riskMetrics.initialBalance) * 100 : 0;
    const isProfit = pnl >= 0;

    return { engineData, obMetrics, stormMetrics, pnl, pnlPercent, isProfit, realPnL, telemetry, obLevels };
};


// -----------------------------
// UI COMPONENTS
// -----------------------------

// LEFT SIDEBAR COMPONENT: P&L + Storm Index
export const MarketMonitor = ({ engine }) => {
    const { engineData, stormMetrics, pnl, pnlPercent, isProfit } = engine;

    const stormColor = stormMetrics.state === 'STORM' ? 'text-soma-danger' : stormMetrics.state === 'UNSTABLE' ? 'text-soma-warning' : 'text-soma-success';
    const stormBg = stormMetrics.state === 'STORM' ? 'bg-soma-danger' : stormMetrics.state === 'UNSTABLE' ? 'bg-soma-warning' : 'bg-soma-success';

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Stylized P&L Display */}
            <div className="p-3 bg-black/20 border-b border-white/5 relative overflow-hidden shrink-0">
                <div className={`absolute right-0 top-0 w-16 h-16 blur-2xl opacity-20 ${isProfit ? 'bg-soma-success' : 'bg-soma-danger'}`}></div>
                <div className="relative z-10 flex justify-between items-end">
                    <div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">
                            <DollarSign className="w-3 h-3" /> Session P&L
                        </div>
                        <div className={`text-2xl font-black font-mono tracking-tighter ${isProfit ? 'text-soma-success drop-shadow-[0_0_5px_rgba(0,255,157,0.3)]' : 'text-soma-danger drop-shadow-[0_0_5px_rgba(255,42,42,0.3)]'}`}>
                            {isProfit ? '+' : ''}{pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    </div>
                    <div className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded border ${isProfit ? 'border-soma-success/30 bg-soma-success/10 text-soma-success' : 'border-soma-danger/30 bg-soma-danger/10 text-soma-danger'}`}>
                        {pnlPercent.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* Storm Index Breakdown */}
            <div className="flex-1 p-3 flex flex-col justify-center min-h-0 bg-soma-900/50">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Waves className={`w-3 h-3 ${stormColor}`} />
                        <h3 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Storm Index</h3>
                    </div>
                    <span className={`text-[9px] uppercase font-bold border px-1.5 rounded ${stormMetrics.state === 'STORM' ? 'border-soma-danger text-soma-danger animate-pulse' : 'border-white/10 text-zinc-500'}`}>
                        {stormMetrics.state}
                    </span>
                </div>

                <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden border border-white/5 mb-3 relative">
                    <div className={`h-full ${stormBg} transition-all duration-500`} style={{ width: `${stormMetrics.stormIndex}%` }}></div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                    {/* Compact Metrics for Sidebar */}
                    <div className="flex justify-between items-center">
                        <span className="text-[7px] text-slate-500 font-bold">VOL RATIO</span>
                        <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-mono ${engineData.volRatio > 1.5 ? 'text-soma-warning' : 'text-slate-300'}`}>{engineData.volRatio.toFixed(1)}σ</span>
                            <div className="w-8 h-1 bg-soma-950 rounded-sm border border-soma-800/50"><div className={`h-full ${engineData.volRatio > 1.5 ? 'bg-soma-warning' : 'bg-slate-500'}`} style={{ width: `${Math.min(engineData.volRatio / 3 * 100, 100)}%` }}></div></div>
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[7px] text-slate-500 font-bold">CORR</span>
                        <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-mono ${engineData.correlation > 0.8 ? 'text-soma-danger' : 'text-slate-300'}`}>{engineData.correlation.toFixed(2)}</span>
                            <div className="w-8 h-1 bg-soma-950 rounded-sm border border-soma-800/50"><div className={`h-full ${engineData.correlation > 0.8 ? 'bg-soma-danger' : 'bg-slate-500'}`} style={{ width: `${engineData.correlation * 100}%` }}></div></div>
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[7px] text-slate-500 font-bold">LIQ</span>
                        <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-mono ${engineData.liqPressure > 0.5 ? 'text-soma-danger' : 'text-slate-300'}`}>{engineData.liqPressure.toFixed(2)}</span>
                            <div className="w-8 h-1 bg-soma-950 rounded-sm border border-soma-800/50"><div className={`h-full ${engineData.liqPressure > 0.5 ? 'bg-soma-danger' : 'bg-slate-500'}`} style={{ width: `${Math.min(engineData.liqPressure * 100, 100)}%` }}></div></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// RIGHT BOTTOM COMPONENT: Liquidity + Map + Telemetry (Mascots moved to header)
export const MarketDeepScan = ({ engine, tickers, onSelect, selectedSymbol, marketSentiment }) => {
    const { engineData, obMetrics, obLevels } = engine;

    // Derive stable depth bar heights from real bid/ask levels.
    // If live orderbook data is available, normalise to the top bid's notional value.
    // Otherwise fall back to imbalance-derived heights (still deterministic — no Math.random).
    const bidBarHeights = useMemo(() => {
        if (obLevels?.bids?.length >= 5) {
            const maxNotional = obLevels.bids[0].qty * obLevels.bids[0].price || 1;
            return obLevels.bids.slice(0, 5).map(b =>
                Math.max(12, Math.min(80, (b.qty * b.price / maxNotional) * 75))
            );
        }
        // Stable fallback derived from imbalance (no Math.random)
        const base = 40 + Math.min(35, obMetrics.imbalance * 35);
        return [base, base * 0.82, base * 0.65, base * 0.50, base * 0.38];
    }, [obLevels?.bids, obMetrics.imbalance]);

    const askBarHeights = useMemo(() => {
        if (obLevels?.asks?.length >= 5) {
            const maxNotional = obLevels.asks[0].qty * obLevels.asks[0].price || 1;
            return obLevels.asks.slice(0, 5).map(a =>
                Math.max(12, Math.min(80, (a.qty * a.price / maxNotional) * 75))
            );
        }
        const base = 40 - Math.min(35, obMetrics.imbalance * 35);
        return [base, base * 0.82, base * 0.65, base * 0.50, base * 0.38];
    }, [obLevels?.asks, obMetrics.imbalance]);
    const [radarAngle, setRadarAngle] = useState(0);

    useEffect(() => {
        const rot = setInterval(() => setRadarAngle(prev => (prev + 2) % 360), 20);
        return () => clearInterval(rot);
    }, []);

    const getTickerCoordinates = (ticker) => {
        const maxRadius = 45;
        const radius = Math.min(maxRadius, (ticker.volatility / 100) * maxRadius);
        const angleDeg = (ticker.momentum / 100) * -90;
        const angleRad = (angleDeg * Math.PI) / 180;
        const x = 50 + radius * Math.cos(angleRad);
        const y = 50 + radius * Math.sin(angleRad);
        return { x, y };
    };

    return (
        <div className="flex h-full w-full">
            {/* PANEL 2: ORDERBOOK PRESSURE */}
            <div className="w-1/3 border-r border-white/5 p-2 lg:p-3 flex flex-col relative">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <Droplets className="w-3 h-3 text-blue-400" />
                        <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Liquidity</h3>
                    </div>
                    <span className={`text-[8px] font-mono font-bold ${obMetrics.pressure > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                        {obMetrics.pressure > 0 ? 'BUY' : 'SELL'} PRES: {Math.abs(obMetrics.pressure).toFixed(2)}
                    </span>
                </div>

                <div className="grid grid-cols-3 gap-1 mb-1">
                    <div className="bg-black/40 p-1 rounded border border-white/5 flex flex-col items-center">
                        <Scale className="w-2.5 h-2.5 text-slate-500 mb-0.5" />
                        <span className="text-[7px] text-slate-500">IMBALANCE</span>
                        <span className={`text-[8px] font-mono ${obMetrics.imbalance > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                            {obMetrics.imbalance.toFixed(2)}
                        </span>
                    </div>
                    <div className="bg-black/40 p-1 rounded border border-white/5 flex flex-col items-center">
                        <Sword className="w-2.5 h-2.5 text-slate-500 mb-0.5" />
                        <span className="text-[7px] text-slate-500">AGGRESS</span>
                        <span className={`text-[8px] font-mono ${obMetrics.aggression > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                            {obMetrics.aggression.toFixed(2)}
                        </span>
                    </div>
                    <div className="bg-black/40 p-1 rounded border border-white/5 flex flex-col items-center">
                        <Shield className="w-2.5 h-2.5 text-slate-500 mb-0.5" />
                        <span className="text-[7px] text-slate-500">ABSORB</span>
                        <span className={`text-[8px] font-mono ${obMetrics.absorb > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                            {(obMetrics.absorb / 1000).toFixed(0)}k
                        </span>
                    </div>
                </div>

                <div className="flex-1 flex items-end justify-center gap-0.5 relative opacity-80 min-h-[30px] border-t border-white/5 pt-1 mt-1">
                    <div className="flex-1 h-full flex items-end justify-end px-1 gap-0.5">
                        {bidBarHeights.map((h, i) => (
                            <div key={i} className="w-1.5 bg-soma-success/60 hover:bg-soma-success transition-all duration-500 rounded-t-sm" style={{ height: `${h}%` }}></div>
                        ))}
                    </div>
                    <div className="w-[1px] h-full bg-slate-700"></div>
                    <div className="flex-1 h-full flex items-end justify-start px-1 gap-0.5">
                        {askBarHeights.map((h, i) => (
                            <div key={i} className="w-1.5 bg-soma-danger/60 hover:bg-soma-danger transition-all duration-500 rounded-t-sm" style={{ height: `${h}%` }}></div>
                        ))}
                    </div>
                </div>
            </div>

            {/* PANEL 3: MARKET DEPTH RADAR */}
            <div className="w-1/3 border-r border-white/5 p-2 flex flex-col items-center justify-center relative overflow-hidden bg-black group">
                <div className="absolute top-2 left-2 flex flex-col z-10 pointer-events-none">
                    <div className="flex items-center gap-2">
                        <Radio className="w-3 h-3 text-soma-accent" />
                        <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Market Map</h3>
                    </div>
                </div>
                <div className="relative w-28 h-28 flex items-center justify-center">
                    <div className="absolute inset-0 border border-soma-800 rounded-full opacity-30"></div>
                    <div className="absolute w-20 h-20 border border-soma-800 rounded-full opacity-30"></div>
                    <div className="absolute w-10 h-10 border border-soma-800 rounded-full opacity-30"></div>
                    <div className="absolute w-full h-[1px] bg-soma-800 top-1/2 -translate-y-1/2"></div>
                    <div className="absolute h-full w-[1px] bg-soma-800 left-1/2 -translate-x-1/2"></div>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 text-[7px] font-bold text-soma-success">BULL</div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 text-[7px] font-bold text-soma-danger">BEAR</div>
                    <div
                        className="absolute w-1/2 h-1/2 bg-gradient-to-t from-transparent to-soma-accent/20 top-0 left-0 origin-bottom-right rounded-tl-full pointer-events-none"
                        style={{ transform: `rotate(${radarAngle}deg)` }}
                    ></div>
                    {tickers.map(ticker => {
                        const coords = getTickerCoordinates(ticker);
                        const isSelected = selectedSymbol === ticker.symbol;
                        return (
                            <div
                                key={ticker.symbol}
                                onClick={() => onSelect(ticker.symbol)}
                                className={`absolute w-2 h-2 rounded-full cursor-pointer transition-all duration-500 hover:scale-150 z-20 ${ticker.momentum > 0 ? 'bg-soma-success shadow-[0_0_5px_#00ff9d]' : 'bg-soma-danger shadow-[0_0_5px_#ff2a2a]'} ${isSelected ? 'ring-2 ring-white scale-125' : ''}`}
                                style={{ left: `${coords.x}%`, top: `${coords.y}%`, transform: 'translate(-50%, -50%)' }}
                                title={`${ticker.symbol}: Mom ${(ticker.momentum || 0).toFixed(0)}`}
                            ></div>
                        );
                    })}
                </div>
            </div>

            {/* PANEL 4: TELEMETRY */}
            <div className="w-1/3 p-2 lg:p-3 flex flex-col relative pb-8 lg:pb-8">
                <div className="flex items-center gap-2 mb-2">
                    <Anchor className="w-3 h-3 text-indigo-400" />
                    <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Telemetry</h3>
                </div>
                <div className="space-y-1 font-mono text-[9px]">
                    <div className="flex justify-between items-center border-b border-white/5 pb-0.5">
                        <span className="text-slate-500">FLOW Z</span>
                        <span className={engineData.flowZ > 0 ? 'text-soma-success' : 'text-soma-danger'}>{engineData.flowZ.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-white/5 pb-0.5">
                        <span className="text-slate-500">LEV DELTA</span>
                        <span className={engineData.leverage > 0.05 ? 'text-soma-warning' : 'text-slate-300'}>{(engineData.leverage * 100).toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-white/5 pb-0.5">
                        <span className="text-slate-500">FUNDING</span>
                        <span className={engineData.fundingRate > 0 ? 'text-soma-success' : 'text-soma-danger'}>{engineData.fundingRate.toFixed(4)}%</span>
                    </div>
                </div>
                <div className="mt-auto">
                    <div className="flex items-center gap-1 text-[8px] text-slate-500 justify-end">
                        <Wind className="w-2.5 h-2.5 animate-pulse" />
                        LATENCY: {engine.telemetry.latency > 0 ? `${engine.telemetry.latency.toFixed(1)}ms` : '12ms'}
                    </div>
                </div>
            </div>
        </div>
    );
};
