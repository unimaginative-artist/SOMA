import React, { useState, useRef, useEffect } from 'react';
import { AssetType } from '../types.js';
import { Search, Monitor, Cpu, TrendingUp, Zap, Shield, AlertTriangle, Brain, Check } from 'lucide-react';
import { CRYPTO_SYMBOLS, STOCK_SYMBOLS, FUTURES_SYMBOLS, STRATEGY_PRESETS, AVAILABLE_SYMBOLS, SYMBOL_INFO } from '../constants.js';

export const CommandPanel = ({
    currentSymbol,
    onSymbolSelect,
    currentPresetId,
    onPresetSelect,
    strategySelectionMode = 'auto',
    autoStrategy = null,
    onAutoSelect,
    assetType,
    setAssetType,
    onAnalyze
}) => {
    const [searchInput, setSearchInput] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const suggestionsRef = useRef(null);

    const quickOptions = assetType === AssetType.CRYPTO ? CRYPTO_SYMBOLS :
        assetType === AssetType.STOCKS ? STOCK_SYMBOLS :
            FUTURES_SYMBOLS;

    // Get filtered suggestions based on input and asset type
    const getSuggestions = () => {
        if (!searchInput.trim()) return [];

        const query = searchInput.toUpperCase();
        let symbolsToSearch = quickOptions; // Default to current asset type

        // If searching across all, include everything
        if (query.length >= 2) {
            symbolsToSearch = AVAILABLE_SYMBOLS;
        }

        return symbolsToSearch
            .filter(sym => sym.toUpperCase().includes(query) ||
                (SYMBOL_INFO[sym]?.name?.toUpperCase().includes(query)))
            .slice(0, 8); // Limit to 8 suggestions
    };

    const suggestions = getSuggestions();

    // Filter presets by asset type
    const filteredPresets = STRATEGY_PRESETS.filter(preset =>
        preset.assetTypes && preset.assetTypes.includes(assetType)
    );

    // Handle keyboard navigation
    const handleKeyDown = (e) => {
        if (!showSuggestions || suggestions.length === 0) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (searchInput.trim()) {
                    onSymbolSelect(searchInput.toUpperCase());
                    setSearchInput('');
                    setShowSuggestions(false);
                }
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (suggestions[selectedIndex]) {
                    onSymbolSelect(suggestions[selectedIndex]);
                    setSearchInput('');
                    setShowSuggestions(false);
                }
                break;
            case 'Escape':
                setShowSuggestions(false);
                break;
            case 'Tab':
                if (suggestions[selectedIndex]) {
                    e.preventDefault();
                    onSymbolSelect(suggestions[selectedIndex]);
                    setSearchInput('');
                    setShowSuggestions(false);
                }
                break;
        }
    };

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
                inputRef.current && !inputRef.current.contains(e.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset selected index when suggestions change
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchInput]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (suggestions.length > 0 && showSuggestions) {
            onSymbolSelect(suggestions[selectedIndex]);
        } else if (searchInput.trim()) {
            onSymbolSelect(searchInput.toUpperCase());
        }
        setSearchInput('');
        setShowSuggestions(false);
    };

    const handleInputChange = (e) => {
        setSearchInput(e.target.value);
        setShowSuggestions(e.target.value.length > 0);
    };

    const selectSuggestion = (symbol) => {
        onSymbolSelect(symbol);
        setSearchInput('');
        setShowSuggestions(false);
        inputRef.current?.focus();
    };

    const getPresetIcon = (id) => {
        switch (id) {
            case 'MICRO': return <Zap className="w-3 h-3 text-soma-accent" />;
            case 'MICRO_CHALLENGE': return <TrendingUp className="w-3 h-3 text-emerald-400" />;
            case 'YOLO': return <AlertTriangle className="w-3 h-3 text-soma-danger" />;
            case 'CONSERVATIVE': return <Shield className="w-3 h-3 text-soma-success" />;
            default: return <Monitor className="w-3 h-3 text-slate-400" />;
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#151518]/40 border-r border-white/5">

            {/* Header / Tabs - Cleaner Look */}
            <div className="flex border-b border-white/5 shrink-0 bg-black/20">
                {[AssetType.CRYPTO, AssetType.STOCKS, AssetType.FUTURES].map((type) => (
                    <button
                        key={type}
                        onClick={() => setAssetType(type)}
                        className={`flex-1 py-2 text-[10px] font-bold tracking-wider transition-all relative overflow-hidden group ${
                            assetType === type 
                                ? 'text-white bg-white/5' 
                                : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.02]'
                        }`}
                    >
                        {/* Active Indicator */}
                        {assetType === type && (
                            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-soma-accent to-transparent" />
                        )}
                        {type}
                    </button>
                ))}
            </div>

            <div className="flex flex-1 min-h-0">
                {/* Left Col: Search & Actions */}
                <div className="w-[180px] p-3 border-r border-white/5 flex flex-col gap-3 shrink-0 bg-black/10">
                    {/* Search with Autocomplete */}
                    <form onSubmit={handleSearchSubmit} className="relative group">
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchInput}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            onFocus={() => searchInput.length > 0 && setShowSuggestions(true)}
                            placeholder={assetType === AssetType.FUTURES ? "ES1!" : "Search ticker..."}
                            className="w-full bg-[#18181b] border border-white/10 rounded px-2 pl-7 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500/50 transition-colors placeholder:text-zinc-700"
                            autoComplete="off"
                        />
                        <Search className="absolute left-2 top-2 w-3 h-3 text-zinc-600 group-focus-within:text-cyan-500 transition-colors" />

                        {/* Autocomplete Dropdown */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div
                                ref={suggestionsRef}
                                className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#18181b] border border-white/20 rounded-lg shadow-xl overflow-hidden"
                            >
                                {suggestions.map((symbol, index) => {
                                    const info = SYMBOL_INFO[symbol];
                                    return (
                                        <button
                                            key={symbol}
                                            type="button"
                                            onClick={() => selectSuggestion(symbol)}
                                            className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${
                                                index === selectedIndex
                                                    ? 'bg-cyan-500/20 text-cyan-400'
                                                    : 'text-zinc-300 hover:bg-white/5'
                                            }`}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-xs font-mono font-bold">{symbol}</span>
                                                {info && (
                                                    <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">
                                                        {info.name}
                                                    </span>
                                                )}
                                            </div>
                                            <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase font-bold ${
                                                info?.type === 'crypto' ? 'bg-amber-500/20 text-amber-400' :
                                                info?.type === 'etf' ? 'bg-purple-500/20 text-purple-400' :
                                                info?.type === 'futures' ? 'bg-blue-500/20 text-blue-400' :
                                                'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                                {info?.type || 'stock'}
                                            </span>
                                        </button>
                                    );
                                })}
                                <div className="px-3 py-1.5 bg-black/40 border-t border-white/5">
                                    <span className="text-[9px] text-zinc-600">
                                        ↑↓ navigate • Enter select • Type any symbol
                                    </span>
                                </div>
                            </div>
                        )}
                    </form>

                    {/* Quick Chips - Grid */}
                    <div className="grid grid-cols-2 gap-1.5">
                        {quickOptions.slice(0, 6).map(sym => (
                            <button
                                key={sym}
                                onClick={() => onSymbolSelect(sym)}
                                className={`text-[9px] px-1 py-1 rounded border font-mono transition-all truncate ${currentSymbol === sym
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                                    : 'bg-black/40 border-white/5 text-zinc-500 hover:border-white/20 hover:text-zinc-300'
                                    }`}
                                title={sym}
                            >
                                {sym}
                            </button>
                        ))}
                    </div>

                    {/* AI Analysis Trigger */}
                    <button
                        onClick={onAnalyze}
                        className="mt-auto w-full py-2 bg-gradient-to-r from-soma-accent/10 to-transparent border border-soma-accent/30 rounded flex items-center justify-center gap-2 text-soma-accent font-bold text-[10px] hover:bg-soma-accent/20 transition-all group hover:shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                    >
                        <Brain className="w-3 h-3 group-hover:rotate-12 transition-transform" />
                        DEEP SCAN
                    </button>
                </div>

                {/* Right Col: Strategies Grid - Less Cluttered */}
                <div className="flex-1 p-3 overflow-y-auto custom-scrollbar">
                    <div className="mb-2">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center">
                            Strategy Authority
                        </h3>
                    </div>

                    <button
                        type="button"
                        onClick={onAutoSelect}
                        className={`w-full text-left p-2 rounded border transition-all mb-2 ${
                            strategySelectionMode === 'auto'
                                ? 'bg-emerald-500/10 border-emerald-500/40'
                                : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                        }`}
                    >
                        <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                                <div className={`text-[10px] font-bold uppercase ${strategySelectionMode === 'auto' ? 'text-emerald-300' : 'text-zinc-400'}`}>
                                    Auto: Sim-to-Live Ladder
                                </div>
                                <div className="text-[9px] text-zinc-500 truncate mt-0.5">
                                    {autoStrategy?.strategyId || 'waiting'} / {autoStrategy?.symbol || currentSymbol}
                                    {autoStrategy?.neededTrades ? ` · ${autoStrategy.neededTrades} paper trades needed` : ''}
                                </div>
                            </div>
                            {strategySelectionMode === 'auto' && <Check className="w-3 h-3 text-emerald-300 shrink-0" />}
                        </div>
                    </button>

                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center">
                        Manual Overrides <span className="ml-2 px-1.5 py-0.5 bg-white/5 rounded text-zinc-400">{filteredPresets.length}</span>
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-2">
                        {filteredPresets.map(preset => (
                            <button
                                key={preset.id}
                                onClick={() => onPresetSelect(preset)}
                                className={`text-left p-2 rounded border transition-all flex flex-col gap-1 relative group overflow-hidden ${
                                    strategySelectionMode === 'manual' && currentPresetId === preset.id
                                    ? 'bg-gradient-to-br from-cyan-900/20 to-black border-cyan-500/50'
                                    : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                                }`}
                            >
                                <div className="flex justify-between items-start">
                                    <span className={`text-[10px] font-bold uppercase truncate pr-2 ${strategySelectionMode === 'manual' && currentPresetId === preset.id ? 'text-cyan-400' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                                        {preset.name}
                                    </span>
                                    {strategySelectionMode === 'manual' && currentPresetId === preset.id && <Check className="w-3 h-3 text-cyan-400 shrink-0" />}
                                </div>
                                
                                <p className="text-[9px] text-zinc-600 leading-tight line-clamp-2 h-[2.2em]">
                                    {preset.description}
                                </p>

                                <div className="mt-1 flex items-center gap-2">
                                     <span className={`text-[8px] font-bold px-1 rounded border whitespace-nowrap ${preset.riskProfile === 'EXTREME' ? 'border-rose-500/30 text-rose-400 bg-rose-500/5' :
                                        preset.riskProfile === 'HIGH' ? 'border-amber-500/30 text-amber-400 bg-amber-500/5' :
                                            preset.riskProfile === 'MED' ? 'border-blue-400/30 text-blue-400 bg-blue-500/5' :
                                                'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'
                                        }`}>
                                        {preset.riskProfile}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
