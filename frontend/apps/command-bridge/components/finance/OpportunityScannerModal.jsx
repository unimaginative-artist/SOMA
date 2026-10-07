import React, { useState, useEffect } from 'react';
import { X, Zap, Target, TrendingUp, RefreshCw, AlertTriangle } from 'lucide-react';

const OpportunityScannerModal = ({ isOpen, onClose, assetType, onSelect }) => {
    const [opportunities, setOpportunities] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchOpportunities = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/scanner/opportunities?assetType=${assetType}`);
            const data = await res.json();
            if (data.success) {
                setOpportunities(data.opportunities);
            } else {
                throw new Error(data.error || 'Failed to fetch opportunities');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchOpportunities();
        }
    }, [isOpen, assetType]);

    if (!isOpen) return null;

    const getStrategyIcon = (strategy) => {
        if (strategy === 'SCALPING_FAST') return <Zap className="w-3 h-3 text-soma-accent" />;
        if (strategy === 'MEAN_REVERSION') return <Target className="w-3 h-3 text-soma-warning" />;
        return <TrendingUp className="w-3 h-3 text-soma-success" />;
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center">
            <div className="bg-soma-900 border border-soma-800 rounded-lg shadow-2xl w-[400px] flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-center p-3 border-b border-soma-800">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Opportunity Scanner</h2>
                    <div className="flex gap-2">
                        <button onClick={fetchOpportunities} disabled={isLoading} className="p-1.5 text-slate-500 hover:text-white disabled:opacity-50">
                            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white">
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="p-3 overflow-y-auto h-[300px] custom-scrollbar">
                    {isLoading && <div className="flex justify-center items-center h-full text-slate-400">Loading...</div>}
                    {error && <div className="text-soma-danger text-center">{error}</div>}
                    {!isLoading && !error && opportunities.length === 0 && <div className="text-center text-slate-500">No compelling opportunities found.</div>}

                    <div className="space-y-2">
                        {opportunities.map(opp => (
                            <div key={opp.symbol} 
                                 onClick={() => onSelect(opp)}
                                 className="bg-soma-950 p-2.5 rounded border border-soma-800 hover:border-soma-accent cursor-pointer transition-all"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <span className="text-base font-bold font-mono text-white">{opp.symbol}</span>
                                        <div className="flex items-center gap-1.5 text-[10px] bg-soma-800 px-2 py-0.5 rounded">
                                            {getStrategyIcon(opp.strategy)}
                                            <span className="text-slate-400">{opp.strategy.replace('_', ' ')}</span>
                                        </div>
                                    </div>
                                    <div className={`text-xl font-bold ${opp.score > 75 ? 'text-soma-success' : opp.score > 50 ? 'text-soma-accent' : 'text-soma-warning'}`}>
                                        {opp.score}
                                    </div>
                                </div>
                                <div className="flex justify-between text-xs mt-2 text-slate-400">
                                    <span>${opp.price.toFixed(2)}</span>
                                    <span className={opp.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                        {opp.change24h >= 0 ? '+' : ''}{opp.change24h.toFixed(2)}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OpportunityScannerModal;
