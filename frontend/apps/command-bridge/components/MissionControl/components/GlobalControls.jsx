import React, { useState, useEffect } from 'react';
import { Play, Pause, AlertOctagon, Cpu, Lock, Zap, TrendingUp, TrendingDown, Settings, AlertTriangle, Search } from 'lucide-react';
import { TradeMode } from '../types.js';
import { SomaBrainLogo } from './SomaBrainLogo';

export const GlobalControls = ({
    mode,
    setMode,
    tradingActive,
    toggleTrading,
    killSwitch,
    marketSentiment,
    isDemoMode,
    onModeToggle,
    onOpenSettings,
    trainingButton, // New Prop for the minimized brain
    marketRegime,   // MarketRegimeDetector state
    // New Props for Global Navigation
    assetType,
    setAssetType,
    currentSymbol,
    onSymbolChange
}) => {
    const [time, setTime] = useState(new Date());
    const [localSymbol, setLocalSymbol] = useState(currentSymbol || '');
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Sync local input with global symbol
    useEffect(() => {
        setLocalSymbol(currentSymbol || '');
    }, [currentSymbol]);

    // Autocomplete Search
    useEffect(() => {
        const fetchSuggestions = async () => {
            if (localSymbol.length < 1) { // Suggest on first character
                setSuggestions([]);
                setShowSuggestions(false);
                return;
            }

            try {
                console.log(`[Autocomplete] Fetching for: "${localSymbol}" (${assetType})`);
                // Special handling for FUTURES (Synthesized locally as DB is missing them)
                if (assetType === 'FUTURES') {
                    const futuresRoots = [
                        { symbol: 'ES=F', name: 'E-Mini S&P 500' },
                        { symbol: 'NQ=F', name: 'E-Mini NASDAQ 100' },
                        { symbol: 'YM=F', name: 'E-Mini Dow' },
                        { symbol: 'CL=F', name: 'Crude Oil' },
                        { symbol: 'GC=F', name: 'Gold' },
                        { symbol: 'SI=F', name: 'Silver' },
                        { symbol: 'BTC=F', name: 'Bitcoin Futures' },
                        { symbol: 'ETH=F', name: 'Ether Futures' }
                    ];
                    const matches = futuresRoots.filter(f => f.symbol.includes(localSymbol) || f.name.toLowerCase().includes(localSymbol.toLowerCase()));
                    console.log(`[Autocomplete] Futures matches:`, matches.length);
                    setSuggestions(matches);
                    setShowSuggestions(matches.length > 0);
                    return;
                }

                const res = await fetch(`/api/finance/search?q=${localSymbol}`);
                if (res.ok) {
                    const data = await res.json();
                    console.log(`[Autocomplete] Raw results:`, data.results?.length);
                    if (data.success && data.results) {
                        // Strict Filter by Asset Type
                        const filtered = data.results.filter(item => {
                            if (assetType === 'CRYPTO') return item.type === 'Crypto';
                            if (assetType === 'STOCKS') return item.type === 'Equity' || item.type === 'ETF';
                            return false; // Hide unmatched types
                        }).slice(0, 8); // Limit to 8

                        console.log(`[Autocomplete] Filtered (${assetType}):`, filtered.map(f => f.symbol));
                        setSuggestions(filtered);
                        setShowSuggestions(filtered.length > 0);
                    }
                }
            } catch (e) {
                console.error("Autocomplete failed", e);
            }
        };

        const timeoutId = setTimeout(fetchSuggestions, 100); // Snappier debounce (100ms)
        return () => clearTimeout(timeoutId);
    }, [localSymbol, assetType]);

    const handleSymbolSubmit = (e) => {
        e.preventDefault();
        setShowSuggestions(false);
        if (localSymbol.trim() && onSymbolChange) {
            onSymbolChange(localSymbol.toUpperCase().trim());
        }
    };

    const handleSuggestionClick = (symbol) => {
        setLocalSymbol(symbol);
        setShowSuggestions(false);
        if (onSymbolChange) onSymbolChange(symbol);
    };

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Dynamic Orb Colors based on Market Sentiment
    const getOrbStyle = () => {
        if (marketSentiment === 'BULL') {
            return {
                '--orb-primary': 'rgb(0, 240, 255)',   // Cyan
                '--orb-secondary': 'rgb(16, 185, 129)', // Emerald
                '--orb-glow': 'rgba(0, 240, 255, 0.8)'
            };
        } else if (marketSentiment === 'BEAR') {
            return {
                '--orb-primary': 'rgb(255, 0, 60)',     // Neon Red
                '--orb-secondary': 'rgb(236, 72, 153)', // Pink
                '--orb-glow': 'rgba(255, 0, 60, 0.8)'
            };
        } else {
            return {
                '--orb-primary': 'rgb(99, 102, 241)',   // Indigo
                '--orb-secondary': 'rgb(168, 85, 247)', // Purple
                '--orb-glow': 'rgba(99, 102, 241, 0.8)'
            };
        }
    };

    return (
        <header className="h-16 bg-transparent flex items-center justify-between px-4 select-none shrink-0 z-50 relative overflow-visible">
            {/* Mascot Orb - CSS Powered with Particles */}
            <div className="absolute left-6 top-3 z-[60]">
                <SomaBrainLogo isActive={tradingActive} />
            </div>
            {/* Left: Brand & Status - Add padding-left to make room for piggy */}
            <div className="flex items-center space-x-6 z-10 bg-[#151518]/90 pr-4 backdrop-blur-md rounded-lg border border-white/5 p-2 pl-20">
                <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${tradingActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></div>
                </div>

                <div className="h-8 w-[1px] bg-white/10 mx-2"></div>

                <label className="soma-toggle-switch manual-auto-toggle">
                    <input
                        type="checkbox"
                        checked={mode === TradeMode.AUTONOMOUS}
                        onChange={() => {
                            console.log("[GlobalControls] Toggle Clicked. Current:", mode);
                            setMode(mode === TradeMode.AUTONOMOUS ? TradeMode.MANUAL : TradeMode.AUTONOMOUS);
                        }}
                        style={{ zIndex: 10 }}
                    />
                    <span>MANUAL</span>
                    <span>AUTO</span>
                </label>

                {/* MANUAL MODE CONTROLS (Moved to Header) */}
                {mode !== TradeMode.AUTONOMOUS && (
                    <>
                        <div className="h-8 w-[1px] bg-white/10 mx-2"></div>

                        {/* Ticker Search (Custom Glow Style) */}
                        <form onSubmit={handleSymbolSubmit} className="relative">
                            <label className="manual-ticker-search">
                                <input
                                    type="text"
                                    value={localSymbol}
                                    onChange={(e) => setLocalSymbol(e.target.value.toUpperCase())}
                                    placeholder="search ticker..."
                                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} // Delay to allow click
                                    onFocus={() => {
                                        setLocalSymbol(''); // Clear text on focus
                                        setShowSuggestions(false);
                                    }}
                                />
                                <button type="submit" className="shortcut" title="Search">
                                    <Search className="w-3 h-3" />
                                </button>
                            </label>

                            {/* Autocomplete Dropdown */}
                            {showSuggestions && suggestions.length > 0 && (
                                <ul className="absolute top-full left-0 right-0 mt-2 bg-[#0a0a0c] border border-zinc-700 rounded-md shadow-2xl z-[100] max-h-60 overflow-y-auto custom-scrollbar">
                                    {suggestions.map((s, idx) => (
                                        <li
                                            key={idx}
                                            onClick={() => handleSuggestionClick(s.symbol)}
                                            className="px-3 py-2 hover:bg-zinc-800 cursor-pointer flex flex-col border-b border-zinc-800/50 last:border-0"
                                        >
                                            <span className="font-bold text-white text-xs">{s.symbol}</span>
                                            <span className="text-[10px] text-zinc-500 truncate">{s.name}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </form>

                        {/* Asset Type Selector */}
                        <div className="flex gap-1 bg-black/30 p-0.5 rounded border border-white/5 ml-2">
                            {['CRYPTO', 'STOCKS', 'FUTURES'].map(type => (
                                <button
                                    key={type}
                                    onClick={() => setAssetType && setAssetType(type)}
                                    className={`px-3 py-1 text-[9px] font-bold transition-all rounded-sm ${assetType === type ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Right: Critical Controls */}
            <div className="flex items-center space-x-4 z-10 bg-[#151518]/90 pl-4 backdrop-blur-md rounded-lg border border-white/5 p-2">

                {/* Minimized Training Button Injection */}
                {trainingButton && (
                    <div className="mr-4 border-r border-white/10 pr-4">
                        {trainingButton}
                    </div>
                )}

                {/* Market Regime Badge */}
                {marketRegime?.loaded && marketRegime.regime && (
                    <div className="text-center border-r border-white/10 pr-4 hidden md:block">
                        <div className="text-[9px] text-zinc-500 uppercase">REGIME</div>
                        <div className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                            marketRegime.regime.type === 'RANGING' ? 'bg-emerald-500/20 text-emerald-400' :
                            marketRegime.regime.type === 'TRENDING_BULL' ? 'bg-green-500/20 text-green-400' :
                            marketRegime.regime.type === 'TRENDING_BEAR' ? 'bg-red-500/20 text-red-400' :
                            marketRegime.regime.type === 'VOLATILE' ? 'bg-amber-500/20 text-amber-400' :
                            marketRegime.regime.type === 'CALM' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-zinc-700/50 text-zinc-400'
                        }`}>
                            {(marketRegime.regime.type || 'UNKNOWN').replace('_', ' ')}
                            {marketRegime.regime.confidence > 0 && (
                                <span className="ml-1 text-[9px] opacity-70">
                                    {Math.round((typeof marketRegime.regime.confidence === 'string'
                                        ? parseFloat(marketRegime.regime.confidence)
                                        : marketRegime.regime.confidence) * 100)}%
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* System Time */}
                <div className="text-right hidden md:block border-r border-white/10 pr-4">
                    <div className="text-xs text-zinc-500">SYSTEM TIME (UTC)</div>
                    <div className="text-sm font-mono text-cyan-400">
                        {time.toISOString().split('T')[1].split('.')[0]}
                    </div>
                </div>

                {/* Action Buttons - Only visible in Autonomous Mode */}
                {mode !== TradeMode.MANUAL && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleTrading}
                            className={`mc-action-btn ${tradingActive ? 'mc-action-btn--pause' : 'mc-action-btn--engage'}`}
                        >
                            <span>{tradingActive ? 'PAUSE' : 'ENGAGE'}</span>
                            <svg viewBox="0 0 13 12" xmlns="http://www.w3.org/2000/svg">
                                <polygon points="0,0 5,6 0,12" />
                                <polygon points="4,0 9,6 4,12" />
                                <polygon points="8,0 13,6 8,12" />
                            </svg>
                        </button>

                        <button
                            onClick={killSwitch}
                            className="mc-action-btn mc-action-btn--kill"
                        >
                            <span>KILL SWITCH</span>
                            <svg viewBox="0 0 13 12" xmlns="http://www.w3.org/2000/svg">
                                <polygon points="0,0 5,6 0,12" />
                                <polygon points="4,0 9,6 4,12" />
                                <polygon points="8,0 13,6 8,12" />
                            </svg>
                        </button>
                    </div>
                )}

                <div className="ml-2 pl-2 border-l border-white/10 flex gap-4 items-center">
                    {/* Demo/Live Toggle - Styled to match Manual/Auto switch */}
                    <label className="soma-toggle-switch demo-live-toggle" title={isDemoMode ? "Safe Mode (Demo)" : "Live Trading Active"}>
                        <input
                            type="checkbox"
                            checked={!isDemoMode} // Note: checked = LIVE
                            onChange={onModeToggle}
                        />
                        <span>DEMO</span>
                        <span>LIVE</span>
                    </label>

                    {/* Settings Button */}
                    <button
                        onClick={onOpenSettings}
                        title="Exchange Settings"
                        className="p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded transition-all"
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </header>
    );
};