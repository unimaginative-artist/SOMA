import React, { useState } from 'react';
import { AssetType, StrategyPreset } from '../types';
import { Search, Monitor, Cpu, TrendingUp, Zap, Shield, AlertTriangle, Brain } from 'lucide-react';
import { CRYPTO_SYMBOLS, STOCK_SYMBOLS, FUTURES_SYMBOLS, STRATEGY_PRESETS } from '../constants';

interface CommandPanelProps {
  currentSymbol: string;
  onSymbolSelect: (symbol: string) => void;
  currentPresetId: string;
  onPresetSelect: (preset: StrategyPreset) => void;
  assetType: AssetType;
  setAssetType: (type: AssetType) => void;
  onAnalyze: () => void;
}

export const CommandPanel: React.FC<CommandPanelProps> = ({
  currentSymbol,
  onSymbolSelect,
  currentPresetId,
  onPresetSelect,
  assetType,
  setAssetType,
  onAnalyze
}) => {
  const [searchInput, setSearchInput] = useState('');
  
  const quickOptions = assetType === AssetType.CRYPTO ? CRYPTO_SYMBOLS : 
                       assetType === AssetType.STOCKS ? STOCK_SYMBOLS : 
                       FUTURES_SYMBOLS;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onSymbolSelect(searchInput.toUpperCase());
      setSearchInput('');
    }
  };

  const getPresetIcon = (id: string) => {
    switch (id) {
        case 'MICRO': return <Zap className="w-3 h-3 text-soma-accent" />;
        case 'MICRO_CHALLENGE': return <TrendingUp className="w-3 h-3 text-emerald-400" />;
        case 'YOLO': return <AlertTriangle className="w-3 h-3 text-soma-danger" />;
        case 'CONSERVATIVE': return <Shield className="w-3 h-3 text-soma-success" />;
        default: return <Monitor className="w-3 h-3 text-slate-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-soma-900 border-r border-soma-800">
        
      {/* Header / Tabs */}
      <div className="flex border-b border-soma-800 shrink-0">
        <button 
            onClick={() => setAssetType(AssetType.STOCKS)}
            className={`flex-1 py-2 text-[10px] font-bold tracking-wider transition-colors ${assetType === AssetType.STOCKS ? 'bg-soma-800 text-white border-b-2 border-soma-accent' : 'text-slate-500 hover:text-slate-300'}`}
        >
            STOCKS
        </button>
        <button 
            onClick={() => setAssetType(AssetType.CRYPTO)}
            className={`flex-1 py-2 text-[10px] font-bold tracking-wider transition-colors ${assetType === AssetType.CRYPTO ? 'bg-soma-800 text-white border-b-2 border-soma-accent' : 'text-slate-500 hover:text-slate-300'}`}
        >
            CRYPTO
        </button>
        <button 
            onClick={() => setAssetType(AssetType.FUTURES)}
            className={`flex-1 py-2 text-[10px] font-bold tracking-wider transition-colors ${assetType === AssetType.FUTURES ? 'bg-soma-800 text-white border-b-2 border-soma-accent' : 'text-slate-500 hover:text-slate-300'}`}
        >
            FUTURES
        </button>
      </div>

      {/* Search & Actions (Fixed) */}
      <div className="p-3 border-b border-soma-800/50 shrink-0">
            <form onSubmit={handleSearchSubmit} className="relative mb-2">
                <input 
                    type="text" 
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={assetType === AssetType.FUTURES ? "Symbol (e.g. ES1!)" : "Enter Ticker"}
                    className="w-full bg-soma-950 border border-soma-700 rounded p-2 pl-8 text-xs text-white font-mono focus:outline-none focus:border-soma-accent transition-colors"
                />
                <Search className="absolute left-2.5 top-2.5 w-3 h-3 text-slate-500" />
            </form>
            
            {/* Quick Chips */}
            <div className="flex flex-wrap gap-1.5 mb-3">
                {quickOptions.slice(0, 5).map(sym => (
                    <button
                        key={sym}
                        onClick={() => onSymbolSelect(sym)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border font-mono transition-all ${
                            currentSymbol === sym 
                            ? 'bg-soma-accent/20 border-soma-accent text-soma-accent' 
                            : 'bg-soma-950 border-soma-800 text-slate-400 hover:border-slate-500'
                        }`}
                    >
                        {sym}
                    </button>
                ))}
            </div>

            {/* AI Analysis Trigger */}
            <button 
                onClick={onAnalyze}
                className="w-full py-1.5 bg-gradient-to-r from-soma-accent/20 to-transparent border border-soma-accent/50 rounded flex items-center justify-center gap-2 text-soma-accent font-bold text-[10px] hover:bg-soma-accent/10 transition-all group"
            >
                <Brain className="w-3 h-3 group-hover:animate-pulse" />
                INITIATE DEEP SCAN
            </button>
      </div>

      {/* Strategy Presets (Scrollable) */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
            <h3 className="text-[9px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-2 sticky top-0 bg-soma-900 z-10 py-1">
                <Cpu className="w-3 h-3" />
                Strategy Profile
            </h3>
            
            <div className="space-y-1.5">
                {STRATEGY_PRESETS.map(preset => (
                    <button
                        key={preset.id}
                        onClick={() => onPresetSelect(preset)}
                        className={`w-full text-left px-2 py-1.5 rounded border transition-all flex items-start gap-2 group relative overflow-hidden ${
                            currentPresetId === preset.id 
                            ? 'bg-soma-950 border-soma-accent shadow-[0_0_10px_rgba(0,240,255,0.1)]' 
                            : 'bg-soma-900 border-soma-800 hover:border-slate-600'
                        }`}
                    >
                        {/* Selected Indicator */}
                        {currentPresetId === preset.id && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-soma-accent"></div>}

                        <div className={`mt-0.5 shrink-0 ${currentPresetId === preset.id ? 'text-soma-accent' : 'text-slate-500 group-hover:text-slate-300'}`}>
                            {getPresetIcon(preset.id)}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                                <span className={`text-[10px] font-bold uppercase tracking-wide truncate ${currentPresetId === preset.id ? 'text-white' : 'text-slate-400'}`}>
                                    {preset.name}
                                </span>
                                {currentPresetId === preset.id && <span className="text-[8px] text-soma-accent animate-pulse shrink-0 ml-1">ACTIVE</span>}
                            </div>
                            
                            <div className="flex justify-between items-start mt-0.5">
                                <p className="text-[9px] text-slate-500 leading-tight line-clamp-1 flex-1 mr-2">
                                    {preset.description}
                                </p>
                                
                                {/* Compact Risk Badge */}
                                <span className={`text-[8px] font-bold px-1 rounded border whitespace-nowrap ${
                                    preset.riskProfile === 'EXTREME' ? 'border-soma-danger text-soma-danger' : 
                                    preset.riskProfile === 'HIGH' ? 'border-soma-warning text-soma-warning' :
                                    preset.riskProfile === 'MED' ? 'border-blue-400 text-blue-400' :
                                    'border-soma-success text-soma-success'
                                }`}>
                                    {preset.riskProfile}
                                </span>
                            </div>
                        </div>
                    </button>
                ))}
            </div>
      </div>
    </div>
  );
};