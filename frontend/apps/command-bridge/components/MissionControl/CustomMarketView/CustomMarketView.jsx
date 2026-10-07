import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MarketStream, getHistoricalData } from './services/marketData';
import { analyzeMarketAtmosphere } from './services/geminiService';
import TerrainView from './components/TerrainView';
import CandleView from './components/CandleView';
import { Activity, Wifi, WifiOff, Cpu, BarChart2, Maximize2, Globe } from 'lucide-react';

const MAX_HISTORY = 2000;

// --- FALLBACK ANALYSIS ENGINE ---
const generateFallbackAnalysis = (data) => {
    const recent = data.slice(-30);
    if (recent.length < 2) return { atmosphere: "INITIALIZING", poeticState: "System warming up.", predictions: [] };

    const start = recent[0].close;
    const lastPoint = recent[recent.length - 1];
    const currentClose = lastPoint.close;

    // Calculate relative changes (percentages) to be asset-agnostic
    const changeAbs = currentClose - start;
    const changePct = (changeAbs / start) * 100; // Percentage change

    const volatilitySum = recent.reduce((acc, p) => acc + (p.high - p.low), 0);
    const avgVolatility = volatilitySum / recent.length;
    const volatilityPct = (avgVolatility / currentClose) * 100;

    // Momentum extraction
    const currentMomentum = lastPoint.momentum !== undefined
        ? lastPoint.momentum
        : (currentClose - recent[recent.length - 2].close);

    const momentumPct = (currentMomentum / currentClose) * 1000; // Normalized momentum scale

    // Generator Helper with Organic Inertia
    const generateScenario = (volMod, momMult, driftBiasPct) => {
        const path = [];
        let simPrice = currentClose;
        let m = currentMomentum;

        // Base volatility derived from recent history
        const localVol = avgVolatility * volMod;

        for (let i = 0; i < 20; i++) {
            const noise = (Math.random() - 0.5) * localVol;
            const drift = currentClose * (driftBiasPct / 100);
            const targetM = (currentMomentum * momMult) + drift;
            m = (m * 0.85) + (targetM * 0.15) + (noise * 0.1);
            simPrice += m + noise;
            path.push(simPrice);
        }
        return path;
    };

    const predictions = [
        { type: 'SAFE', data: generateScenario(0.5, 0.2, 0) },
        { type: 'BREAKOUT', data: generateScenario(2.5, 1.5, Math.abs(momentumPct) * 0.2 + 0.1) },
        { type: 'DROP', data: generateScenario(3.0, 1.5, -Math.abs(momentumPct) * 0.2 - 0.1) },
        { type: 'AVERAGE', data: generateScenario(1.0, 1.0, 0) }
    ];

    // Asset-Agnostic Cyberpunk Heuristics
    if (changePct > 0.3) return { atmosphere: "SURGE", poeticState: "Vertical acceleration detected; gravity is forgotten.", predictions };
    if (changePct < -0.3) return { atmosphere: "CASCADE", poeticState: "Structure failing; the floor dissolves into the void.", predictions };
    if (volatilityPct > 0.05) return { atmosphere: "TURBULENCE", poeticState: "Static noise overwhelms the signal clarity.", predictions };
    if (Math.abs(changePct) < 0.02) return { atmosphere: "STASIS", poeticState: "The horizon is flat and waiting for a pulse.", predictions };

    return { atmosphere: "DRIFT", poeticState: "Winds shifting slowly across the digital plains.", predictions };
};

// --- PARTICLE SYSTEM ---
const ParticleSystem = ({ width, height }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId;
        let particles = [];

        const init = () => {
            canvas.width = width || window.innerWidth;
            canvas.height = height || window.innerHeight;
            const count = Math.floor((canvas.width * canvas.height) / 15000);
            particles = [];
            for (let i = 0; i < count; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    size: Math.random() * 1.5 + 0.5,
                    speedY: Math.random() * 0.2 + 0.05,
                    speedX: (Math.random() - 0.5) * 0.1,
                    opacity: Math.random() * 0.5 + 0.1,
                    pulseSpeed: Math.random() * 0.02 + 0.005,
                    pulseOffset: Math.random() * Math.PI * 2,
                    colorType: Math.random() > 0.6 ? 'magenta' : 'mint'
                });
            }
        };

        const animate = () => {
            if (!ctx || !canvas) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const time = Date.now() / 1000;

            particles.forEach(p => {
                p.y -= p.speedY;
                p.x += p.speedX;
                if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width; }
                if (p.x > canvas.width + 5) p.x = -5;
                if (p.x < -5) p.x = canvas.width + 5;
                const currentOpacity = p.opacity + Math.sin(time * p.pulseSpeed + p.pulseOffset) * 0.1;
                const color = p.colorType === 'magenta'
                    ? `rgba(217, 70, 239, ${Math.max(0, currentOpacity)})`
                    : `rgba(0, 255, 157, ${Math.max(0, currentOpacity)})`;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                if (p.size > 1.2) {
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = color;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
            });
            animationFrameId = requestAnimationFrame(animate);
        };

        // window.addEventListener('resize', init);
        // Removed window resize listener because we rely on prop updates
        init();
        animate();
        return () => {
            // window.removeEventListener('resize', init);
            cancelAnimationFrame(animationFrameId);
        };
    }, [width, height]);

    return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
};

export default function CustomMarketView({ selectedSymbol, data: externalData, dataSource = 'REAL', activeProtocol = 'UNKNOWN' }) {
    // Map selectedSymbol (internal SOMA prop) to activeAsset in this component
    const activeAsset = selectedSymbol || 'btcusdt';

    const [internalData, setInternalData] = useState([]);
    const [viewMode, setViewMode] = useState('TERRAIN');
    const [analysis, setAnalysis] = useState(null);
    const [isThinking, setIsThinking] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    const containerRef = useRef(null);
    const [dims, setDims] = useState({ width: 0, height: 0 });

    // Use external data if provided, otherwise internal
    const data = (externalData && externalData.length > 0) ? externalData : internalData;

    // --- DATA STREAM HANDLING (Only if no external data) ---
    useEffect(() => {
        if (externalData && externalData.length > 0) {
            setIsConnected(true); // Assume external source is connected
            return;
        }

        setInternalData([]); // Clear data on switch
        setAnalysis(null);
        setIsConnected(false);

        let stream = null;
        let isMounted = true;

        const initData = async () => {
            // 1. Fetch History (Mocked Service)
            try {
                const history = await getHistoricalData(activeAsset);
                if (isMounted && history.length > 0) {
                    setInternalData(history);
                }
            } catch (e) {
                console.warn("History fetch failed:", e);
            }

            // 2. Connect Stream (Mocked Service)
            stream = new MarketStream(activeAsset, (point) => {
                if (!isMounted) return;
                setIsConnected(true);
                setInternalData(prev => {
                    const lastClose = prev.length > 0 ? prev[prev.length - 1].close : point.open;
                    point.momentum = point.close - lastClose;

                    const newHistory = [...prev, point];
                    if (newHistory.length > MAX_HISTORY) newHistory.shift();
                    return newHistory;
                });
            });
        };

        initData();

        return () => {
            isMounted = false;
            if (stream) stream.close();
        };
    }, [activeAsset, externalData]);

    // Dimension handling
    useEffect(() => {
        const updateDims = () => {
            if (containerRef.current) {
                setDims({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };
        window.addEventListener('resize', updateDims);

        // ResizeObserver is better for component-level resize
        const resizeObserver = new ResizeObserver(() => {
            updateDims();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        updateDims();
        // setTimeout(updateDims, 100);

        return () => {
            window.removeEventListener('resize', updateDims);
            resizeObserver.disconnect();
        };
    }, []);

    // Analysis Handler
    const handleAnalyze = async () => {
        if (isThinking) return;
        setIsThinking(true);
        setAnalysis(null); // Clear previous analysis

        try {
            // Pass activeProtocol context for adaptive analysis
            const result = await analyzeMarketAtmosphere(data, activeProtocol);
            if (result) {
                setAnalysis(result);
            } else {
                // Fallback if analyzeMarketAtmosphere returns null/undefined
                const fallbackResult = generateFallbackAnalysis(data);
                setAnalysis(fallbackResult);
            }
        } catch (e) {
            console.error("Analysis failed:", e);
            // On error, also use fallback analysis
            const fallbackResult = generateFallbackAnalysis(data);
            setAnalysis(fallbackResult);
        }
        setIsThinking(false);
    };

    // Helper values
    const current = data[data.length - 1];
    const prevData = data[data.length - 2];
    const isUp = current && prevData ? current.close > prevData.close : true;
    const isSimulated = dataSource === 'SIMULATION';

    // ALIGNMENT: Snap AI predictions to current price to prevent visual "drop off"
    const alignedAnalysis = useMemo(() => {
        if (!analysis || !analysis.predictions || !current) return analysis;

        return {
            ...analysis,
            predictions: analysis.predictions.map(p => {
                // If we have data, calculate offset to align first point
                if (p.data && p.data.length > 0) {
                    const offset = current.close - p.data[0];
                    return {
                        ...p,
                        data: p.data.map(d => d + offset)
                    };
                }
                return p;
            })
        };
    }, [analysis, current]);

    const renderView = () => {
        if (dims.width === 0) return null;
        switch (viewMode) {
            case 'TERRAIN': return <TerrainView data={data} width={dims.width} height={dims.height} predictions={alignedAnalysis?.predictions} />;
            case 'CANDLE': return <CandleView data={data} width={dims.width} height={dims.height} predictions={alignedAnalysis?.predictions} />;
            default: return <TerrainView data={data} width={dims.width} height={dims.height} predictions={alignedAnalysis?.predictions} />;
        }
    };

    return (
        // Changed: Removed h-screen/w-screen. Adjusted padding.
        <div className="flex flex-col w-full h-full bg-[#0f0720] text-slate-300 font-sans selection:bg-fuchsia-500 selection:text-white relative overflow-hidden">
            {/* BACKGROUND LAYERS */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-[#1e1b4b] via-[#0f0720] to-[#020617]" />
                <div className="absolute inset-0 opacity-[0.05]"
                    style={{ backgroundImage: 'linear-gradient(#ff00ff 1px, transparent 1px), linear-gradient(90deg, #ff00ff 1px, transparent 1px)', backgroundSize: '30px 30px' }}
                />
                {/* Particle System adjusted to use container dims */}
                <div className="absolute inset-0 opacity-60"><ParticleSystem width={dims.width} height={dims.height} /></div>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#020617_100%)] opacity-80" />
            </div>

            {/* HEADER / HUD - Compact for panel usage */}
            <header className="flex-none p-3 flex justify-between items-center z-10 bg-gradient-to-b from-[#0f0720] via-[#0f0720]/80 to-transparent backdrop-blur-[2px]">
                <div className="flex items-center gap-4">
                    <div className={`p-1.5 rounded-full border border-slate-800/50 ${isUp ? 'bg-fuchsia-500/10 shadow-[0_0_15px_rgba(255,0,255,0.3)]' : 'bg-cyan-400/10 shadow-[0_0_15px_rgba(99,102,241,0.3)]'}`}>
                        <Activity className={`w-4 h-4 ${isUp ? 'text-fuchsia-500' : 'text-cyan-400'} transition-colors duration-500`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <h1 className="text-[9px] font-bold tracking-[0.3em] uppercase text-slate-500">{activeAsset} // System</h1>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className={`text-xl font-mono ${isUp ? 'text-fuchsia-500 neon-glow-text' : 'text-cyan-400 neon-glow-text'} transition-colors duration-300`}>
                                {current?.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '---'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* GEMINI TRIGGER */}
                <div className="flex items-center gap-3">
                    {analysis && (
                        <div className="hidden md:block text-right animate-in fade-in slide-in-from-top-2 duration-700">
                            <div className="text-[9px] font-bold text-fuchsia-500 tracking-[0.2em] uppercase mb-0.5 drop-shadow-[0_0_5px_rgba(255,0,255,0.5)]">
                                {analysis.atmosphere}
                            </div>
                            <div className="text-[9px] text-slate-400 italic max-w-xs leading-none opacity-80 border-r-2 border-slate-800 pr-2">
                                "{analysis.poeticState}"
                            </div>
                            {analysis.protocolAdaptation && (
                                <div className="mt-1.5 text-[8px] font-bold text-cyan-300 tracking-[0.1em] border-t border-slate-800/50 pt-1 pr-2 uppercase">
                                    &gt;&gt; PROTOCOL: {analysis.protocolAdaptation}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        onClick={handleAnalyze}
                        disabled={isThinking || data.length < 10}
                        className="group flex items-center gap-2 px-3 py-1.5 bg-slate-900/40 border border-slate-800/60 rounded-sm hover:border-fuchsia-500/50 transition-all backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Cpu className={`w-3.5 h-3.5 ${isThinking ? 'animate-pulse text-fuchsia-500' : 'text-slate-500 group-hover:text-fuchsia-500'}`} />
                        <span className="text-[9px] tracking-wider font-mono uppercase text-slate-500 group-hover:text-white transition-colors">
                            {isThinking ? '...' : 'Interpret'}
                        </span>
                    </button>
                </div>
            </header>

            {/* VISUALIZATION */}
            <main className="flex-grow relative overflow-hidden z-10" ref={containerRef}>
                <div className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 ${isUp ? 'opacity-20' : 'opacity-10'}`}>
                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[120px] mix-blend-screen ${isUp ? 'bg-fuchsia-500/10' : 'bg-cyan-400/10'}`} />
                </div>

                {dims.width > 0 && data.length > 0 && (
                    <div className="absolute inset-0 transition-opacity duration-500">
                        {renderView()}
                    </div>
                )}

                {data.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-50">
                        <div className="flex flex-col items-center gap-4 text-slate-600 animate-in fade-in zoom-in duration-500">
                            <Globe className="w-10 h-10 text-indigo-500 animate-pulse" />
                            <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-mono tracking-widest text-indigo-300">ESTABLISHING UPLINK...</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* CONNECTION STATUS - MOVED TO BOTTOM LEFT */}
                <div className="absolute bottom-4 left-4 z-50">
                    <div className={`flex items-center gap-2 px-2 py-1 bg-[#0f0720]/90 backdrop-blur rounded border ${isSimulated ? 'border-amber-500/50' : 'border-slate-800'}`}>
                        {isConnected ? <Wifi className={`w-3 h-3 ${isSimulated ? 'text-amber-500' : 'text-green-500'}`} /> : <WifiOff className="w-3 h-3 text-red-500" />}
                        <div className="flex flex-col">
                            <span className={`text-[9px] font-bold leading-none ${isConnected ? (isSimulated ? 'text-amber-500' : 'text-green-500') : 'text-red-500'}`}>
                                {isConnected ? (isSimulated ? 'SYNTHETIC MODEL' : 'LIVE FEED') : 'OFFLINE'}
                            </span>
                            <span className="text-[7px] text-slate-500 font-mono leading-none mt-0.5">
                                {isConnected ? 'UPLINK ESTABLISHED' : 'NO SIGNAL'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* MODULAR LENS DECK - Adjusted for smaller container */}
                <div className="absolute top-2 right-4 flex gap-1 z-50">

                    <button
                        onClick={() => setViewMode('TERRAIN')}
                        className={`p-1.5 rounded bg-[#0f0720]/80 backdrop-blur border border-slate-800 shadow transition-all ${viewMode === 'TERRAIN' ? 'text-white border-indigo-500/50' : 'text-slate-500 hover:text-slate-300'}`}
                        title="Terrain View"
                    >
                        <Maximize2 className="w-3 h-3" />
                    </button>
                    <button
                        onClick={() => setViewMode('CANDLE')}
                        className={`p-1.5 rounded bg-[#0f0720]/80 backdrop-blur border border-slate-800 shadow transition-all ${viewMode === 'CANDLE' ? 'text-white border-indigo-500/50' : 'text-slate-500 hover:text-slate-300'}`}
                        title="Candle View"
                    >
                        <BarChart2 className="w-3 h-3" />
                    </button>
                </div>
            </main>

        </div>
    );
}
