import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, TrendingUp, Zap, Brain, Minus, Move } from 'lucide-react';

/**
 * Demo Training Control Panel
 * Draggable, Minimizable, Floating Widget
 */
export const DemoTrainingPanel = ({ isDemoMode, isTraining: parentIsTraining, stats: parentStats, loading: parentLoading, onStart, onStop, onMinimize }) => {
    // Use parent-controlled state when available, fallback to local for standalone use
    const [localIsTraining, setLocalIsTraining] = useState(false);
    const [localStats, setLocalStats] = useState(null);
    const [localLoading, setLocalLoading] = useState(false);

    const isTraining = parentIsTraining !== undefined ? parentIsTraining : localIsTraining;
    const stats = parentStats !== undefined ? parentStats : localStats;
    const loading = parentLoading !== undefined ? parentLoading : localLoading;

    // UI State
    const [isMinimized, setIsMinimized] = useState(false);
    // Start centered-ish over the chart (where the Standby button is)
    const [position, setPosition] = useState({ x: window.innerWidth / 2 - 160, y: window.innerHeight / 3 });
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    // --- DRAG LOGIC ---
    const handleMouseDown = (e) => {
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isDragging) {
                setPosition({
                    x: e.clientX - dragOffset.current.x,
                    y: e.clientY - dragOffset.current.y
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    // --- TRAINING LOGIC ---
    // Only poll stats locally if parent doesn't provide them
    useEffect(() => {
        if (parentStats !== undefined) return; // Parent manages stats
        if (isTraining) {
            const interval = setInterval(fetchStats, 5000);
            fetchStats();
            return () => clearInterval(interval);
        }
    }, [isTraining, parentStats]);

    const fetchStats = async () => {
        try {
            const response = await fetch('/api/scalping/stats');
            const data = await response.json();
            if (data.success) setLocalStats(data.stats);
        } catch (error) { console.error(error); }
    };

    const handleStartTraining = async () => {
        // If parent provides onStart, delegate to it
        if (onStart) { onStart(); return; }

        setLocalLoading(true);
        try {
            const statusRes = await fetch('/api/alpaca/status');
            const statusData = await statusRes.json();

            if (!statusData.success || !statusData.status?.connected) {
                alert('⚠️ Alpaca API keys not configured!\n\n' +
                      'To use paper trading, you need to:\n' +
                      '1. Click the Settings icon (⚙️) in Mission Control\n' +
                      '2. Get FREE Alpaca Paper Trading keys from:\n' +
                      '   https://alpaca.markets/\n' +
                      '3. Add your API Key and Secret Key\n' +
                      '4. Make sure "Paper Trading" is selected\n' +
                      '5. Save credentials\n\n' +
                      'Paper trading is 100% free with virtual money!');
                setLocalLoading(false);
                return;
            }

            const llRes = await fetch('/api/lowlatency/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'] })
            });

            const llData = await llRes.json();
            if (!llData.success) {
                throw new Error(llData.error || 'Failed to start low-latency engine');
            }

            const scalpRes = await fetch('/api/scalping/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols: ['BTC-USD'] })
            });

            const scalpData = await scalpRes.json();
            if (!scalpData.success) {
                throw new Error(scalpData.error || 'Failed to start scalping engine');
            }

            setLocalIsTraining(true);
            console.log('✅ Paper trading started successfully!');
        } catch (error) {
            console.error('Training start error:', error);
            alert(`❌ Failed to start training:\n\n${error.message}\n\nCheck console for details.`);
        } finally {
            setLocalLoading(false);
        }
    };

    const handleStopTraining = async () => {
        // If parent provides onStop, delegate to it
        if (onStop) { onStop(); return; }

        setLocalLoading(true);
        try {
            await fetch('/api/scalping/stop', { method: 'POST' });
            await fetch('/api/lowlatency/stop', { method: 'POST' });
            setLocalIsTraining(false);
        } catch (error) { console.error(error); } finally { setLocalLoading(false); }
    };

    const handleReset = async () => {
        if (!confirm('Reset demo trading stats?')) return;
        try {
            await fetch('/api/learning/reset', { method: 'POST' });
            setStats(null);
            alert('✅ Demo stats reset!');
        } catch (error) { console.error(error); }
    };

    if (!isDemoMode) return null;

    // --- RENDER: MINIMIZED BRAIN ---
    if (isMinimized) {
        return (
            <div 
                style={{ left: position.x, top: position.y, position: 'absolute', zIndex: 50 }}
                onMouseDown={handleMouseDown}
                className="cursor-move group"
            >
                <div className="relative">
                    <button
                        onClick={(e) => {
                            if (!isDragging) setIsMinimized(false);
                        }}
                        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all transform hover:scale-110 active:scale-95 border-2 border-white/20 ${
                            isTraining 
                            ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 animate-pulse' 
                            : 'bg-zinc-800 border-zinc-600'
                        }`}
                        title="Expand SOMA Training"
                    >
                        <Brain className={`w-7 h-7 ${isTraining ? 'text-white' : 'text-zinc-400'}`} />
                    </button>
                    {/* Status Dot */}
                    <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-[#151518] ${isTraining ? 'bg-emerald-400' : 'bg-zinc-500'}`}></div>
                </div>
            </div>
        );
    }

    // --- RENDER: FULL PANEL ---
    return (
        <div 
            style={{ left: position.x, top: position.y, position: 'absolute', zIndex: 50 }}
            className="w-80 bg-gradient-to-br from-purple-900/95 via-pink-900/95 to-blue-900/95 border-2 border-pink-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
            {/* Drag Handle / Header */}
            <div 
                onMouseDown={handleMouseDown}
                className="flex items-center justify-between p-3 bg-white/5 cursor-move border-b border-white/10 select-none"
            >
                <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-pink-400" />
                    <h3 className="text-sm font-bold text-white">SOMA Training</h3>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isTraining 
                            ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' 
                            : 'bg-zinc-700 text-zinc-400'
                    }`}>
                        {isTraining ? 'ACTIVE' : 'IDLE'}
                    </div>
                    <button 
                        onClick={() => { if (onMinimize) onMinimize(); else setIsMinimized(true); }}
                        className="p-1 hover:bg-white/10 rounded text-white/50 hover:text-white transition-colors"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="p-4">
                <p className="text-xs text-purple-300 mb-4">
                    SOMA will paper trade using <strong>real Alpaca data</strong> with virtual $100k balance.
                </p>

                {/* Stats Display */}
                {stats && (
                    <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-black/30 rounded p-2 border border-pink-500/20">
                            <p className="text-[9px] text-purple-300 uppercase">Trades</p>
                            <p className="text-base font-bold text-white">{stats.totalTrades || 0}</p>
                        </div>
                        <div className="bg-black/30 rounded p-2 border border-pink-500/20">
                            <p className="text-[9px] text-purple-300 uppercase">Win Rate</p>
                            <p className="text-base font-bold text-emerald-400">{stats.winRate || 0}%</p>
                        </div>
                        <div className="bg-black/30 rounded p-2 border border-pink-500/20">
                            <p className="text-[9px] text-purple-300 uppercase">Net P&L</p>
                            <p className={`text-base font-bold ${
                                (stats.netProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                                ${(stats.netProfit || 0).toFixed(0)}
                            </p>
                        </div>
                    </div>
                )}

                {/* Controls */}
                <div className="space-y-2">
                    {!isTraining ? (
                        <button
                            onClick={handleStartTraining}
                            disabled={loading}
                            className="w-full px-4 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                        >
                            <Play className="w-4 h-4" />
                            {loading ? 'Starting...' : 'Start Paper Trading'}
                        </button>
                    ) : (
                        <button
                            onClick={handleStopTraining}
                            disabled={loading}
                            className="w-full px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            <Pause className="w-4 h-4" />
                            {loading ? 'Stopping...' : 'Stop Training'}
                        </button>
                    )}

                    {stats && (
                        <button
                            onClick={handleReset}
                            className="w-full px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded transition-all flex items-center justify-center gap-2"
                        >
                            <RotateCcw className="w-3 h-3" />
                            Reset Stats
                        </button>
                    )}
                </div>

                {/* Live Feed */}
                {isTraining && stats && (
                    <div className="mt-4 pt-4 border-t border-pink-500/20">
                        <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-3 h-3 text-yellow-400 animate-pulse" />
                            <p className="text-xs font-bold text-white">Live Activity</p>
                        </div>
                        <div className="text-xs text-purple-300 space-y-1">
                            <p>• Analyzing {stats.activePositions || 0} positions</p>
                            <p>• Scanning for entry signals...</p>
                            <p>• Learning from market patterns</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
