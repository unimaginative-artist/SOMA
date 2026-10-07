import React, { useMemo, useState, useEffect } from 'react';
import { Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Bar, Line, Cell, ReferenceArea } from 'recharts';
import { TrendingUp, BarChart2, Activity, ZoomIn, ZoomOut, Target, Crosshair } from 'lucide-react';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-black/90 border border-soma-accent/30 p-3 rounded-none shadow-[0_0_15px_rgba(0,240,255,0.1)] text-xs font-mono z-50 min-w-[140px]">
        <div className="text-soma-accent mb-2 border-b border-soma-800 pb-1 flex justify-between">
            <span>{label}</span>
            <span className="text-slate-500">T-{data.time}</span>
        </div>
        <div className="space-y-1">
            <div className="flex justify-between gap-4">
                <span className="text-slate-500">PRICE</span>
                <span className="text-white font-bold">{data.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
             <div className="flex justify-between gap-4">
                <span className="text-slate-500">VOL</span>
                <span className="text-soma-warning">{data.volume}</span>
            </div>
             {data.prediction && (
                <div className="flex justify-between gap-4 text-soma-accent">
                    <span>AI TARGET</span>
                    <span>{data.prediction.toFixed(2)}</span>
                </div>
            )}
        </div>
      </div>
    );
  }
  return null;
};

export const MainChart = ({ data, symbol, tickerData, symbolPnl }) => {
    const [chartType, setChartType] = useState('AREA');
    const [visibleCount, setVisibleCount] = useState(60);
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
        return () => clearInterval(timer);
    }, []);

    const handleZoomIn = () => setVisibleCount(prev => Math.max(10, prev - 10));
    const handleZoomOut = () => setVisibleCount(prev => Math.min(data.length, prev + 10));

    const visibleData = useMemo(() => {
        const start = Math.max(0, data.length - visibleCount);
        return data.slice(start);
    }, [data, visibleCount]);

    const processedData = useMemo(() => {
        return visibleData.map(d => ({
            ...d,
            body: [Math.min(d.open, d.close), Math.max(d.open, d.close)],
            wick: [d.low, d.high],
            color: d.close >= d.open ? '#00ff9d' : '#ff2a2a'
        }));
    }, [visibleData]);

    const minPrice = useMemo(() => Math.min(...visibleData.map(d => d.low)) * 0.999, [visibleData]);
    const maxPrice = useMemo(() => Math.max(...visibleData.map(d => d.high)) * 1.001, [visibleData]);
    
    // Battlefield Zones Calculation
    const currentPrice = visibleData[visibleData.length - 1]?.close || 0;
    const profitZoneStart = currentPrice * 1.005;
    const lossZoneStart = currentPrice * 0.995;

    return (
        <div className="flex flex-row h-full bg-soma-950 relative group select-none">
            
            {/* Confidence Spine */}
            <div className="w-1.5 h-full flex flex-col gap-0.5 py-1 bg-black border-r border-soma-800">
                {[...Array(20)].map((_, i) => (
                    <div 
                        key={i} 
                        className={`flex-1 w-full transition-all duration-500 ${
                            i < 12 ? 'bg-soma-success/50' : 
                            i < 16 ? 'bg-soma-warning/50' : 
                            'bg-soma-danger/50'
                        } ${Math.random() > 0.5 ? 'opacity-100' : 'opacity-30'}`}
                    ></div>
                ))}
            </div>

            <div className="flex-1 relative flex flex-col h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-soma-900 to-soma-950">
                
                {/* HUD Overlay - Top Left */}
                <div className="absolute top-4 left-4 z-10 pointer-events-none">
                    <div className="flex items-center gap-2 mb-1">
                        <Crosshair className="w-4 h-4 text-soma-accent animate-[spin_4s_linear_infinite]" />
                        <h2 className="text-2xl font-bold text-white tracking-tighter">{symbol}</h2>
                    </div>
                    <div className="flex items-baseline gap-2 font-mono">
                        <span className={`text-xl font-bold ${tickerData.change >= 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                            {tickerData.price.toFixed(2)}
                        </span>
                        <span className="text-xs text-slate-400">
                             {tickerData.change > 0 ? '+' : ''}{tickerData.change.toFixed(2)}
                        </span>
                    </div>
                </div>

                {/* HUD Overlay - Bottom Left Stats */}
                <div className="absolute bottom-4 left-4 z-10 pointer-events-none space-y-1">
                     <div className="flex items-center gap-2 text-[10px] text-soma-accent font-mono bg-soma-950/80 px-2 py-1 border border-soma-accent/30 rounded">
                        <Activity className="w-3 h-3" />
                        <span>AI INTENT: ACCUMULATE</span>
                     </div>
                     <div className="flex items-center gap-2 text-[10px] text-soma-warning font-mono bg-soma-950/80 px-2 py-1 border border-soma-warning/30 rounded">
                        <Target className="w-3 h-3" />
                        <span>TARGET: {(currentPrice * 1.012).toFixed(2)}</span>
                     </div>
                </div>

                {/* Chart Type - Top Right */}
                <div className="absolute top-4 right-4 z-20 flex gap-2">
                     <div className="bg-soma-950 border border-soma-800 rounded flex p-1 shadow-lg">
                        <button onClick={() => setChartType('AREA')} className={`p-1.5 ${chartType === 'AREA' ? 'text-soma-accent' : 'text-slate-500'}`}><Activity className="w-4 h-4" /></button>
                        <button onClick={() => setChartType('CANDLES')} className={`p-1.5 ${chartType === 'CANDLES' ? 'text-soma-accent' : 'text-slate-500'}`}><BarChart2 className="w-4 h-4" /></button>
                     </div>
                </div>

                {/* Zoom Controls - Bottom Right */}
                <div className="absolute bottom-4 right-4 z-20 flex gap-2">
                     <div className="bg-soma-950 border border-soma-800 rounded flex p-1 shadow-lg">
                        <button onClick={handleZoomIn} className="p-1.5 text-slate-500 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
                        <button onClick={handleZoomOut} className="p-1.5 text-slate-500 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
                     </div>
                </div>

                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={processedData} margin={{ top: 20, right: 50, left: 10, bottom: 20 }}>
                        <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#00f0ff" stopOpacity={0}/>
                            </linearGradient>
                            <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a1a1a" strokeWidth="1"/>
                            </pattern>
                        </defs>
                        
                        {/* Custom Grid */}
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                        
                        {/* Battlefield Zones */}
                        <ReferenceArea y1={profitZoneStart} y2={maxPrice} fill="#00ff9d" fillOpacity={0.05} />
                        <ReferenceArea y1={minPrice} y2={lossZoneStart} fill="#ff2a2a" fillOpacity={0.05} />
                        <ReferenceLine y={currentPrice} stroke="#666" strokeDasharray="3 3" />
                        <ReferenceLine y={currentPrice * 1.012} stroke="#00f0ff" strokeDasharray="10 5" label={{ position: 'right', value: 'AI TARGET', fill: '#00f0ff', fontSize: 10 }} />

                        <XAxis dataKey="time" hide />
                        <YAxis 
                            domain={[minPrice, maxPrice]} 
                            orientation="right" 
                            stroke="#444" 
                            tick={{ fill: '#666', fontSize: 10, fontFamily: 'monospace' }} 
                            tickFormatter={(val) => val.toFixed(1)}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#00f0ff', strokeWidth: 1 }} />
                        
                        {chartType === 'AREA' ? (
                            <>
                                <Area type="monotone" dataKey="close" stroke="#00f0ff" strokeWidth={2} fill="url(#colorPrice)" isAnimationActive={false} />
                                {/* AI Prediction Path (Ghost Line) */}
                                <Line type="monotone" dataKey="prediction" stroke="#00f0ff" strokeDasharray="3 3" strokeWidth={1} dot={false} isAnimationActive={false} opacity={0.5} />
                            </>
                        ) : (
                            <>
                                <Bar dataKey="wick" barSize={1} isAnimationActive={false}>
                                    {processedData.map((entry, index) => <Cell key={`wick-${index}`} fill={entry.color} />)}
                                </Bar>
                                <Bar dataKey="body" barSize={visibleCount > 60 ? 4 : 8} isAnimationActive={false}>
                                    {processedData.map((entry, index) => <Cell key={`body-${index}`} fill={entry.color} />)}
                                </Bar>
                            </>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};