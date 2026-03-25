import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Brain, Award, Target, Activity, Zap, Radio } from 'lucide-react';
import { AreaChart, Area, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';

/**
 * Learning Dashboard - Shows SOMA's learning progress and agent performance
 * Displays win rates, profit/loss, agent rankings, open positions, and learning events
 */
export const LearningDashboard = ({ isDemo }) => {
    const [performance, setPerformance] = useState(null);
    const [learningEvents, setLearningEvents] = useState([]);
    const [equityCurve, setEquityCurve] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPerformanceData();
        const interval = setInterval(fetchPerformanceData, 10000);
        return () => clearInterval(interval);
    }, [isDemo]);

    const fetchPerformanceData = async () => {
        try {
            const [perfRes, eventsRes, eqRes] = await Promise.all([
                fetch('/api/performance/summary'),
                fetch('/api/learning/events?limit=5'),
                fetch('/api/performance/equity-curve?days=30')
            ]);

            const perfData = await perfRes.json();
            const eventsData = await eventsRes.json();
            const eqData = await eqRes.json().catch(() => ({}));

            setPerformance(perfData.summary || perfData);
            setLearningEvents(eventsData.events || []);
            if (eqData.curve?.length >= 2) setEquityCurve(eqData.curve);
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch performance data:', error);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (!performance) {
        return (
            <div className="text-center p-8 text-zinc-500">
                <Brain className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No performance data yet</p>
                <p className="text-xs mt-1">Start trading to see SOMA learn!</p>
            </div>
        );
    }

    const agents = performance.agent_leaderboard || [];
    const totalPnL = performance.total_pnl || 0;
    const winRate = performance.win_rate || 0;
    const totalTrades = performance.total_trades || 0;
    const openTrades = performance.open_trades || 0;
    const openPositions = performance.open_positions || [];
    const hasLiveActivity = openTrades > 0;
    const hasClosed = totalTrades > 0;

    return (
        <div className="space-y-4">
            {/* Live Activity Banner — shows when positions are open */}
            {hasLiveActivity && !hasClosed && (
                <div className="bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border border-cyan-500/30 rounded-lg p-2 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <div>
                        <p className="text-xs font-bold text-cyan-300">LIVE TRADING ACTIVE</p>
                        <p className="text-[10px] text-zinc-400">{openTrades} open position{openTrades !== 1 ? 's' : ''} — P&L tracking starts after first close</p>
                    </div>
                </div>
            )}

            {/* Overall Performance */}
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-lg p-2">
                    <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider mb-1">
                        {hasClosed ? 'Total P&L' : 'Realized'}
                    </p>
                    <p className={`text-base font-bold truncate ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                        title={`${totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`}>
                        {totalPnL >= 0 ? '+' : ''}
                        {Math.abs(totalPnL) >= 1000
                            ? `$${(totalPnL / 1000).toFixed(1)}k`
                            : totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
                        }
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-0.5">
                        {totalTrades} closed{hasLiveActivity ? ` · ${openTrades} open` : ''}
                    </p>
                </div>

                <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/30 rounded-lg p-2">
                    <p className="text-[9px] text-blue-400 font-bold uppercase tracking-wider mb-1">
                        {hasClosed ? 'Win Rate' : 'Open Pos'}
                    </p>
                    {hasClosed ? (
                        <>
                            <p className="text-base font-bold text-blue-400">{Math.min(winRate, 100).toFixed(1)}%</p>
                            <div className="w-full bg-black/40 rounded-full h-1.5 mt-1.5">
                                <div
                                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(winRate, 100)}%` }}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-base font-bold text-blue-400">{openTrades}</p>
                            <p className="text-[9px] text-zinc-500 mt-0.5">
                                {[...new Set(openPositions.map(p => p.symbol))].join(', ') || 'none'}
                            </p>
                        </>
                    )}
                </div>

                <div className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/30 rounded-lg p-2">
                    <p className="text-[9px] text-purple-400 font-bold uppercase tracking-wider mb-1">
                        {hasClosed ? 'Avg P&L' : 'Strategies'}
                    </p>
                    {hasClosed ? (
                        <>
                            <p className="text-base font-bold text-purple-400 truncate"
                                title={totalTrades > 0 ? (totalPnL / totalTrades).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '$0.00'}>
                                {totalTrades > 0 ? (
                                    Math.abs(totalPnL / totalTrades) >= 1000
                                        ? `$${(totalPnL / totalTrades / 1000).toFixed(1)}k`
                                        : (totalPnL / totalTrades).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
                                ) : '$0'}
                            </p>
                            <p className="text-[9px] text-zinc-500 mt-0.5">per trade</p>
                        </>
                    ) : (
                        <>
                            <p className="text-base font-bold text-purple-400">{agents.length}</p>
                            <p className="text-[9px] text-zinc-500 mt-0.5">active</p>
                        </>
                    )}
                </div>
            </div>

            {/* Equity Curve */}
            {equityCurve.length >= 2 && (() => {
                const first = equityCurve[0]?.equity || 0;
                const last = equityCurve[equityCurve.length - 1]?.equity || 0;
                const isUp = last >= first;
                return (
                    <div className="bg-black/40 border border-white/10 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <TrendingUp className="w-3 h-3" /> 30-Day Equity
                            </p>
                            <span className={`text-[10px] font-mono font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isUp ? '+' : ''}${(last - first).toFixed(0)}
                            </span>
                        </div>
                        <div className="h-16">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={equityCurve} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <YAxis domain={['auto', 'auto']} hide={true} />
                                    <ReferenceLine y={first} stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="3 3" />
                                    <Tooltip
                                        contentStyle={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '9px', padding: '4px 8px' }}
                                        formatter={(v) => [`$${(v || 0).toFixed(0)}`, 'Equity']}
                                        labelStyle={{ color: '#71717a' }}
                                    />
                                    <Area type="monotone" dataKey="equity" stroke={isUp ? '#10b981' : '#ef4444'} strokeWidth={1.5} fill="url(#eqGrad)" dot={false} isAnimationActive={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                );
            })()}

            {/* Open Positions — only show when no closed trades yet */}
            {hasLiveActivity && !hasClosed && openPositions.length > 0 && (
                <div className="bg-black/40 border border-cyan-500/20 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-bold text-white flex items-center">
                            <Radio className="w-4 h-4 mr-2 text-cyan-400" />
                            Open Positions
                        </h4>
                        <span className="text-xs text-zinc-500">{openPositions.length} active</span>
                    </div>
                    <div className="space-y-2">
                        {openPositions.slice(0, 5).map((pos, idx) => (
                            <div
                                key={idx}
                                className="flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent border border-white/5 rounded-lg p-2"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                        pos.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                                    }`}>
                                        {pos.side === 'buy' ? 'B' : 'S'}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">{pos.symbol}</p>
                                        <p className="text-[10px] text-zinc-500">{pos.strategy || 'manual'}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-zinc-300">{pos.qty} shares</p>
                                    <p className="text-[10px] text-zinc-500">@ ${pos.entry_price?.toFixed(2)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Agent Leaderboard */}
            <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-white flex items-center">
                        <Award className="w-4 h-4 mr-2 text-amber-400" />
                        Agent Performance
                    </h4>
                    <span className="text-xs text-zinc-500">{hasClosed ? 'Win Rate / P&L' : 'Positions'}</span>
                </div>

                {agents.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-3">No agents active yet</p>
                ) : (
                    <div className="space-y-2">
                        {agents.slice(0, 5).map((agent, idx) => {
                            const agentWinRate = agent.wins > 0 ? (agent.wins / agent.total_trades * 100) : 0;
                            const isProfit = agent.total_pnl >= 0;
                            const hasOpenOnly = agent.total_trades === 0 && agent.open_positions > 0;

                            return (
                                <div
                                    key={agent.agent_name}
                                    className="flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent border border-white/5 rounded-lg p-2 hover:border-white/10 transition-all"
                                >
                                    <div className="flex items-center space-x-3">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-amber-500 text-black' :
                                            idx === 1 ? 'bg-zinc-400 text-black' :
                                                idx === 2 ? 'bg-orange-600 text-white' :
                                                    'bg-zinc-700 text-zinc-400'
                                            }`}>
                                            {idx + 1}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-white">{agent.agent_name}</p>
                                            <p className="text-xs text-zinc-500">
                                                {hasOpenOnly
                                                    ? `${agent.open_positions} open`
                                                    : `${agent.total_trades} trades`
                                                }
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right min-w-0">
                                        {hasOpenOnly ? (
                                            <>
                                                <p className="text-xs font-bold text-cyan-400">ACTIVE</p>
                                                <p className="text-[10px] text-zinc-500">{(agent.symbols || []).join(', ')}</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className={`text-xs font-bold truncate ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}
                                                    title={`${isProfit ? '+' : ''}${agent.total_pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`}>
                                                    {isProfit ? '+' : ''}
                                                    {Math.abs(agent.total_pnl) >= 1000
                                                        ? `$${(agent.total_pnl / 1000).toFixed(1)}k`
                                                        : agent.total_pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
                                                    }
                                                </p>
                                                <p className="text-[10px] text-zinc-500">{Math.min(agentWinRate, 100).toFixed(0)}% win</p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Learning Events Feed */}
            <div className="bg-black/40 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-white flex items-center">
                        <Brain className="w-4 h-4 mr-2 text-indigo-400" />
                        Recent Learning Events
                    </h4>
                    <Zap className="w-4 h-4 text-yellow-400 animate-pulse" />
                </div>

                <div className="space-y-2">
                    {learningEvents.length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-4">No learning events yet</p>
                    ) : (
                        learningEvents.map((event, idx) => {
                            const borderColor = event.event_type === 'ACTIVE_TRADING' ? 'border-cyan-500'
                                : event.event_type === 'STRATEGY_DEPLOYED' ? 'border-emerald-500'
                                : event.event_type === 'DATA_COLLECTION' ? 'border-amber-500'
                                : 'border-indigo-500';
                            const bgColor = event.event_type === 'ACTIVE_TRADING' ? 'from-cyan-500/10'
                                : event.event_type === 'STRATEGY_DEPLOYED' ? 'from-emerald-500/10'
                                : event.event_type === 'DATA_COLLECTION' ? 'from-amber-500/10'
                                : 'from-indigo-500/10';
                            const textColor = event.event_type === 'ACTIVE_TRADING' ? 'text-cyan-300'
                                : event.event_type === 'STRATEGY_DEPLOYED' ? 'text-emerald-300'
                                : event.event_type === 'DATA_COLLECTION' ? 'text-amber-300'
                                : 'text-indigo-300';

                            return (
                                <div
                                    key={idx}
                                    className={`bg-gradient-to-r ${bgColor} to-transparent border-l-2 ${borderColor} p-2 text-xs`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <p className={`${textColor} font-medium`}>{event.event_type}</p>
                                            <p className="text-zinc-400 mt-0.5">{event.description}</p>
                                        </div>
                                        <span className="text-zinc-600 text-[10px] ml-2 whitespace-nowrap">
                                            {new Date(event.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-black/20 border border-white/5 rounded-lg p-2">
                    <div className="flex items-center space-x-2">
                        <Target className="w-3 h-3 text-emerald-400" />
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                            {hasClosed ? 'Wins' : 'Open'}
                        </p>
                    </div>
                    <p className="text-lg font-bold text-emerald-400 mt-1">
                        {hasClosed ? (performance.total_wins || 0) : openTrades}
                    </p>
                </div>

                <div className="bg-black/20 border border-white/5 rounded-lg p-2">
                    <div className="flex items-center space-x-2">
                        <Activity className="w-3 h-3 text-rose-400" />
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                            {hasClosed ? 'Losses' : 'Agents'}
                        </p>
                    </div>
                    <p className={`text-lg font-bold ${hasClosed ? 'text-rose-400' : 'text-purple-400'} mt-1`}>
                        {hasClosed ? (performance.total_losses || 0) : agents.length}
                    </p>
                </div>
            </div>
        </div>
    );
};
