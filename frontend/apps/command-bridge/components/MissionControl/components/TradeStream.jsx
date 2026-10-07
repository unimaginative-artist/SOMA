import React from 'react';
import { Scroll, ArrowUpRight, ArrowDownRight, XCircle, Activity, Zap, Shield, Target } from 'lucide-react';

const getReasonIcon = (reason) => {
    if (reason.includes('BREAKOUT')) return <Zap className="w-3 h-3 text-soma-accent" />;
    if (reason.includes('HEDGE')) return <Shield className="w-3 h-3 text-soma-warning" />;
    if (reason.includes('REVERSION')) return <Activity className="w-3 h-3 text-blue-400" />;
    return <Target className="w-3 h-3 text-slate-400" />;
}

export const TradeStream = ({ trades }) => {
    return (
        <div className="h-full flex flex-col bg-[#151518]/40 border-l border-white/5">
            <div className="p-3 bg-transparent border-b border-white/5 flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Scroll className="w-4 h-4 text-soma-accent" />
                    Decision Stream
                </h3>
                <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-soma-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-soma-success"></span>
                </span>
            </div>

            <div className="flex-1 overflow-y-auto font-mono text-xs custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-[#18181b]/80 backdrop-blur text-zinc-500 sticky top-0 z-10 border-b border-white/5">
                        <tr>
                            <th className="p-2 font-normal">TIME</th>
                            <th className="p-2 font-normal">INTENT</th>
                            <th className="p-2 font-normal text-right">PRICE</th>
                            <th className="p-2 font-normal text-right">CONF</th>
                        </tr>
                    </thead>
                    <tbody>
                        {trades.map((trade) => (
                            <tr key={trade.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                <td className="p-2 text-slate-600 whitespace-nowrap">
                                    {new Date(trade.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </td>
                                <td className="p-2">
                                    <div className="flex flex-col">
                                        <span className={`flex items-center gap-1 font-bold ${trade.side === 'BUY' ? 'text-soma-success' : 'text-soma-danger'}`}>
                                            {trade.side === 'BUY' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                            {trade.side}
                                        </span>
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                                            {getReasonIcon(trade.reason)}
                                            {trade.reason}
                                        </span>
                                    </div>
                                </td>
                                <td className="p-2 text-right text-slate-300">
                                    {trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="p-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <span className={`text-[10px] ${trade.riskScore > 80 ? 'text-soma-danger' : 'text-soma-accent'}`}>{trade.riskScore}%</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
