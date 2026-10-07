import React, { useMemo, useState, useEffect } from 'react';
import { Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Bar, Line, Cell, ReferenceArea } from 'recharts';
import { TrendingUp, BarChart2, Activity, ZoomIn, ZoomOut, Clock, Target, Crosshair, Timer } from 'lucide-react';

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-gradient-to-br from-purple-900/95 via-pink-900/95 to-blue-900/95 border-2 border-pink-500/50 p-3 rounded-lg shadow-2xl text-xs font-mono z-50 min-w-[160px] backdrop-blur-sm">
                <div className="text-pink-400 mb-2 border-b border-pink-500/30 pb-1 flex justify-between font-bold">
                    <span className="text-pink-300">{label}</span>
                    <span className="text-purple-400">●</span>
                </div>
                <div className="space-y-1.5">
                    <div className="flex justify-between gap-4">
                        <span className="text-purple-300">PRICE</span>
                        <span className="text-white font-bold">${(data.close || data.bull || data.bear || data.neutral || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {data.vwap != null && (
                        <div className="flex justify-between gap-4">
                            <span className="text-amber-400">VWAP</span>
                            <span className="text-amber-300 font-bold">${data.vwap.toFixed(2)}</span>
                        </div>
                    )}
                    {data.rsi != null && (
                        <div className="flex justify-between gap-4">
                            <span className="text-purple-300">RSI</span>
                            <span className={`font-bold ${data.rsi > 70 ? 'text-red-400' : data.rsi < 30 ? 'text-green-400' : 'text-purple-300'}`}>{data.rsi.toFixed(1)}</span>
                        </div>
                    )}
                    {data.volume && (
                        <div className="flex justify-between gap-4">
                            <span className="text-purple-300">VOL</span>
                            <span className="text-cyan-400 font-bold">{data.volume?.toLocaleString() || 0}</span>
                        </div>
                    )}
                    {data.isGhost && (
                        <div className="flex justify-between gap-4 border-t border-purple-500/30 pt-1.5 mt-1.5">
                            <span className="text-pink-300">PROBABILITY</span>
                            <span className="text-pink-400 font-bold">PROJECTED</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    return null;
};

// Custom Pro Candle Component (Wick + Body in one)
const CustomCandle = (props) => {
    const { x, y, width, height, payload } = props;
    if (payload.isGhost) return null; // Don't render candles for ghost data

    // Determine color based on open/close
    const isUp = payload.close >= payload.open;
    const color = isUp ? '#00f0ff' : '#ff003c'; // Original Neon Colors

    return (
        <g>
            {/* Body - Crisp, sharp edges */}
            <rect
                x={x}
                y={y}
                width={width}
                height={Math.max(1, height)}
                fill={color}
                stroke={color}
                strokeWidth={1}
                shapeRendering="crispEdges"
            />
        </g>
    );
};

// Custom Wick Component
const CustomWick = (props) => {
    const { x, y, width, height, payload } = props;
    if (payload.isGhost) return null; // Don't render wicks for ghost data

    const isUp = payload.close >= payload.open;
    const color = isUp ? '#00f0ff' : '#ff003c';

    return (
        <line
            x1={x + width / 2}
            y1={y}
            x2={x + width / 2}
            y2={y + height}
            stroke={color}
            strokeWidth={1.5}
            shapeRendering="geometricPrecision"
            opacity={0.8}
        />
    );
};

export const MainChart = ({ data, symbol, tickerData, symbolPnl, onTimeframeChange }) => {
    const [chartType, setChartType] = useState('AREA');
    const [timeframe, setTimeframe] = useState('1Min');
    const [visibleCount, setVisibleCount] = useState(60);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
    const [indicators, setIndicators] = useState({ vwap: true, rsi: false });

    const handleTimeframeChange = (tf) => { setTimeframe(tf); if (onTimeframeChange) onTimeframeChange(tf); };
    useEffect(() => { const t = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000); return () => clearInterval(t); }, []);
    const handleZoomIn = () => setVisibleCount(prev => Math.max(10, prev - 10));
    const handleZoomOut = () => setVisibleCount(prev => Math.min(data.length, prev + 10));

    const visibleData = useMemo(() => {
        const start = Math.max(0, data.length - visibleCount);
        return data.slice(start);
    }, [data, visibleCount]);

    const processedData = useMemo(() => {
        const period = 14;
        let cumTPV = 0, cumVol = 0;
        return visibleData.map((d, i) => {
            // VWAP: cumulative typical price × volume / cumulative volume
            const typical = ((d.high || d.close) + (d.low || d.close) + d.close) / 3;
            const vol = d.volume || 0;
            cumTPV += typical * vol;
            cumVol += vol;
            const vwap = cumVol > 0 ? parseFloat((cumTPV / cumVol).toFixed(4)) : null;

            // RSI: 14-period
            let rsi = i < period ? null : (() => {
                let gains = 0, losses = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    const diff = visibleData[j].close - visibleData[j - 1].close;
                    if (diff > 0) gains += diff; else losses -= diff;
                }
                const avgGain = gains / period;
                const avgLoss = losses / period;
                return avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
            })();

            return {
                ...d,
                body: [Math.min(d.open, d.close), Math.max(d.open, d.close)],
                wick: [d.low, d.high],
                color: d.close >= d.open ? '#00f0ff' : '#ff003c',
                vwap,
                rsi
            };
        });
    }, [visibleData]);

    // Dynamic Domain Calculation based on RANGE not PRICE
    const domain = useMemo(() => {
        if (visibleData.length === 0) return [0, 100];

        const min = Math.min(...visibleData.map(d => d.low));
        const max = Math.max(...visibleData.map(d => d.high));

        // Calculate the spread
        const range = max - min;

        // Add 5% padding to top and bottom based on the SPREAD
        const padding = range === 0 ? 1 : range * 0.05;

        return [min - padding, max + padding];
    }, [visibleData]);

    // Generate Ghost Paths (Probabilistic Time-Cones)
    const combinedData = useMemo(() => {
        if (processedData.length === 0) return [];

        const last = processedData[processedData.length - 1];
        const lastPrice = last.close;

        // Use domain from previous memo for volatility scaling
        const [minDomain, maxDomain] = domain;
        const volatility = (maxDomain - minDomain) * 0.05;

        // Map real data to include ghost keys (null for now)
        const realWithGhosts = processedData.map(d => ({
            ...d,
            bull: null,
            bear: null,
            neutral: null,
            isGhost: false
        }));

        // Create the "Bridge" point (last real data point starts the ghosts)
        const lastIndex = realWithGhosts.length - 1;
        realWithGhosts[lastIndex].bull = lastPrice;
        realWithGhosts[lastIndex].bear = lastPrice;
        realWithGhosts[lastIndex].neutral = lastPrice;

        // Generate Ghost Points
        const ghostPoints = Array.from({ length: 15 }, (_, i) => {
            const timeOffset = i + 1;
            const bullTarget = lastPrice + (volatility * timeOffset * 0.5);
            const bearTarget = lastPrice - (volatility * timeOffset * 0.5);
            const neutralTarget = lastPrice + (Math.sin(i) * volatility * 0.2);

            return {
                time: `Future +${timeOffset}`,
                close: null, volume: null, high: null, low: null, open: null, body: null, wick: null,
                bull: bullTarget,
                bear: bearTarget,
                neutral: neutralTarget,
                vwap: null,
                rsi: null,
                isGhost: true
            };
        });

        return [...realWithGhosts, ...ghostPoints];
    }, [processedData, domain]);

    const currentPrice = visibleData.length > 0 ? visibleData[visibleData.length - 1].close : 0;

    if (!data || data.length === 0) {
         return <div className="flex items-center justify-center h-full text-slate-500">INITIALIZING...</div>;
    }

    return (
        <div className="w-full h-full bg-transparent group select-none flex flex-col overflow-hidden">
            {/* ── Main Chart Area ── */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
                {/* HUD: Symbol + Price (top-left) */}
                <div className="absolute top-4 left-4 z-10 pointer-events-none mix-blend-screen">
                    <div className="flex items-center gap-2 mb-1">
                        <Crosshair className="w-4 h-4 text-soma-accent animate-[spin_4s_linear_infinite]" />
                        <h2 className="text-4xl font-black text-white/90 tracking-tighter">{symbol}</h2>
                    </div>
                    <div className="flex items-baseline gap-3 font-mono">
                        <span className={`text-2xl font-bold ${(tickerData?.change || 0) >= 0 ? 'text-soma-success' : 'text-soma-danger'} drop-shadow-md`}>
                            {(tickerData?.price || 0).toFixed(2)}
                        </span>
                        <span className={`text-sm font-bold px-1.5 py-0.5 rounded ${(tickerData?.change || 0) > 0 ? 'bg-soma-success/20 text-soma-success' : 'bg-soma-danger/20 text-soma-danger'}`}>
                            {(tickerData?.change || 0) > 0 ? '+' : ''}{(tickerData?.changePercent || 0).toFixed(2)}%
                        </span>
                    </div>
                </div>

                {/* HUD: AI Intent + Target (bottom-left) */}
                <div className="absolute bottom-4 left-4 z-10 pointer-events-none space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-soma-accent font-mono bg-soma-950/80 px-2 py-1 border border-soma-accent/30 rounded shadow-lg backdrop-blur-md">
                        <Activity className="w-3 h-3" />
                        <span>AI INTENT: ACCUMULATE</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-soma-warning font-mono bg-soma-950/80 px-2 py-1 border border-soma-warning/30 rounded shadow-lg backdrop-blur-md">
                        <Target className="w-3 h-3" />
                        <span>TARGET: {(currentPrice * 1.012).toFixed(2)}</span>
                    </div>
                </div>

                {/* HUD: Chart controls (top-right) */}
                <div className="absolute top-4 right-4 z-20 flex gap-2">
                    <div className="bg-black/60 backdrop-blur border border-white/10 rounded flex p-1 shadow-xl">
                        <button onClick={() => setChartType('AREA')} className={`p-1.5 rounded transition-all ${chartType === 'AREA' ? 'bg-white/10 text-soma-accent' : 'text-slate-500 hover:text-white'}`} title="Area Chart"><Activity className="w-4 h-4" /></button>
                        <button onClick={() => setChartType('CANDLES')} className={`p-1.5 rounded transition-all ${chartType === 'CANDLES' ? 'bg-white/10 text-soma-accent' : 'text-slate-500 hover:text-white'}`} title="Candlesticks"><BarChart2 className="w-4 h-4" /></button>
                    </div>
                    <div className="bg-black/60 backdrop-blur border border-white/10 rounded flex p-1 shadow-xl">
                        {['1Min', '5Min', '15Min', '1H', '1D'].map(tf => (
                            <button key={tf} onClick={() => handleTimeframeChange(tf)} className={`px-2 py-1.5 text-[10px] font-bold rounded transition-all ${timeframe === tf ? 'text-soma-accent bg-soma-accent/10 shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-slate-500 hover:text-slate-300'}`}>{tf}</button>
                        ))}
                    </div>
                    {/* Indicator toggles */}
                    <div className="bg-black/60 backdrop-blur border border-white/10 rounded flex p-1 shadow-xl">
                        <button
                            onClick={() => setIndicators(prev => ({ ...prev, vwap: !prev.vwap }))}
                            className={`px-2 py-1.5 text-[10px] font-bold rounded transition-all ${indicators.vwap ? 'text-amber-400 bg-amber-400/10' : 'text-slate-500 hover:text-slate-300'}`}
                            title="Toggle VWAP"
                        >VWAP</button>
                        <button
                            onClick={() => setIndicators(prev => ({ ...prev, rsi: !prev.rsi }))}
                            className={`px-2 py-1.5 text-[10px] font-bold rounded transition-all ${indicators.rsi ? 'text-purple-400 bg-purple-400/10' : 'text-slate-500 hover:text-slate-300'}`}
                            title="Toggle RSI"
                        >RSI</button>
                    </div>
                </div>

                {/* HUD: Zoom (bottom-right) */}
                <div className="absolute bottom-4 right-4 z-20 flex gap-2">
                    <div className="bg-black/60 backdrop-blur border border-white/10 rounded flex p-1 shadow-xl">
                        <button onClick={handleZoomIn} className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded"><ZoomIn className="w-4 h-4" /></button>
                        <button onClick={handleZoomOut} className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded"><ZoomOut className="w-4 h-4" /></button>
                    </div>
                </div>

                {/* Background */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-900/5 to-soma-900/20" />
                </div>

                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={combinedData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ec4899" stopOpacity={0.8} />
                                <stop offset="40%" stopColor="#a855f7" stopOpacity={0.2} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                                <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                            <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="gradBull" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradBear" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" strokeOpacity={0.05} vertical={true} horizontal={true} />

                        <YAxis
                            domain={domain}
                            orientation="right"
                            hide={true}
                        />

                        <ReferenceLine y={currentPrice} stroke="#ec4899" strokeWidth={1} strokeOpacity={0.8} strokeDasharray="4 2" />

                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ec4899', strokeWidth: 1, strokeDasharray: '5 5' }} />

                        {/* GHOST TIME CONES */}
                        <Area type="monotone" dataKey="bull" stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.5} fill="url(#gradBull)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="bear" stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} fill="url(#gradBear)" isAnimationActive={false} />
                        <Line type="monotone" dataKey="neutral" stroke="#94a3b8" strokeDasharray="5 5" strokeOpacity={0.3} dot={false} isAnimationActive={false} />

                        {/* VWAP overlay */}
                        {indicators.vwap && (
                            <Line
                                type="monotone"
                                dataKey="vwap"
                                stroke="#f59e0b"
                                strokeWidth={1.5}
                                dot={false}
                                isAnimationActive={false}
                                strokeDasharray="6 3"
                                connectNulls={false}
                            />
                        )}

                        {chartType === 'AREA' ? (
                            <>
                                <Area type="linear" dataKey="close" stroke="#ec4899" strokeWidth={3} fill="url(#colorPrice)" filter="url(#glow)" isAnimationActive={true} animationDuration={400} />
                                <Bar dataKey="volume" fill="url(#volumeGradient)" opacity={1} barSize={4} isAnimationActive={true} />
                            </>
                        ) : (
                            <>
                                <Bar dataKey="wick" shape={<CustomWick />} barSize={2} isAnimationActive={false} />
                                <Bar dataKey="body" shape={<CustomCandle />} barSize={visibleCount > 60 ? 8 : 14} isAnimationActive={false} />
                            </>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* ── RSI Sub-chart ── */}
            {indicators.rsi && (
                <div className="h-24 shrink-0 border-t border-white/10 relative bg-black/20">
                    {/* Labels */}
                    <div className="absolute top-1 left-2 text-[9px] font-mono text-purple-400/80 z-10 pointer-events-none">RSI(14)</div>
                    <div className="absolute top-1 right-8 flex gap-3 text-[9px] font-mono z-10 pointer-events-none">
                        <span className="text-red-400/70">OB:70</span>
                        <span className="text-green-400/70">OS:30</span>
                    </div>
                    {/* Current RSI value */}
                    {(() => {
                        const lastRsi = processedData.length > 0 ? processedData[processedData.length - 1].rsi : null;
                        return lastRsi != null ? (
                            <div className={`absolute bottom-1 left-2 text-[9px] font-mono z-10 pointer-events-none font-bold ${lastRsi > 70 ? 'text-red-400' : lastRsi < 30 ? 'text-green-400' : 'text-purple-300'}`}>
                                {lastRsi.toFixed(1)}
                            </div>
                        ) : null;
                    })()}
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={combinedData} margin={{ top: 6, right: 0, left: 0, bottom: 2 }}>
                            <CartesianGrid strokeDasharray="1 6" stroke="#ffffff" strokeOpacity={0.03} />
                            <YAxis domain={[0, 100]} orientation="right" hide={true} />
                            <ReferenceLine y={70} stroke="#ef4444" strokeOpacity={0.5} strokeDasharray="3 3" />
                            <ReferenceLine y={50} stroke="#94a3b8" strokeOpacity={0.15} />
                            <ReferenceLine y={30} stroke="#10b981" strokeOpacity={0.5} strokeDasharray="3 3" />
                            <Line
                                type="monotone"
                                dataKey="rsi"
                                stroke="#a855f7"
                                strokeWidth={1.5}
                                dot={false}
                                isAnimationActive={false}
                                connectNulls={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};
