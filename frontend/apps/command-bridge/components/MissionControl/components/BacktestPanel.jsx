import React, { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Play, RotateCcw, TrendingUp, TrendingDown, Award, AlertTriangle } from 'lucide-react';

const SYMBOL_MAP = {
    'BTC-USD': 'BTCUSDT', 'ETH-USD': 'ETHUSDT', 'SOL-USD': 'SOLUSDT',
    'DOGE-USD': 'DOGEUSDT', 'XRP-USD': 'XRPUSDT', 'ADA-USD': 'ADAUSDT',
    'AVAX-USD': 'AVAXUSDT', 'BNB-USD': 'BNBUSDT', 'LINK-USD': 'LINKUSDT',
};

const STRATEGIES = [
    { id: 'sma_crossover', name: 'SMA Crossover', params: [{ key: 'shortPeriod', label: 'Short MA', default: 10 }, { key: 'longPeriod', label: 'Long MA', default: 20 }] },
    { id: 'rsi_reversal', name: 'RSI Mean Reversion', params: [{ key: 'period', label: 'Period', default: 14 }, { key: 'oversold', label: 'Oversold', default: 30 }, { key: 'overbought', label: 'Overbought', default: 70 }] },
    { id: 'momentum_breakout', name: 'Momentum Breakout', params: [{ key: 'lookback', label: 'Lookback', default: 20 }, { key: 'threshold', label: 'Threshold %', default: 0.02 }] },
];

const MetricCard = ({ label, value, sub, color = 'text-white', highlight }) => (
    <div className={`bg-black/30 rounded border p-2 ${highlight ? 'border-soma-accent/40' : 'border-white/5'}`}>
        <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
        <div className={`text-sm font-bold font-mono ${color}`}>{value}</div>
        {sub && <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
);

export const BacktestPanel = ({ selectedSymbol = 'BTC-USD' }) => {
    const [strategy, setStrategy] = useState('sma_crossover');
    const [symbol, setSymbol] = useState(selectedSymbol);
    const [interval, setInterval] = useState('1h');
    const [capital, setCapital] = useState(10000);
    const [params, setParams] = useState({});
    const [running, setRunning] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState(null); // { metrics, trades, equity, error }
    const [tradesPage, setTradesPage] = useState(0);
    const pollRef = useRef(null);

    // Sync symbol when parent changes it
    useEffect(() => { setSymbol(selectedSymbol); }, [selectedSymbol]);

    const currentStrategy = STRATEGIES.find(s => s.id === strategy) || STRATEGIES[0];

    // Initialize params from strategy defaults
    useEffect(() => {
        const defaults = {};
        currentStrategy.params.forEach(p => { defaults[p.key] = p.default; });
        setParams(defaults);
    }, [strategy]);

    const stopPolling = () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    const handleRun = async () => {
        if (running) return;
        setRunning(true);
        setResult(null);
        setProgress(0);
        setSessionId(null);
        setTradesPage(0);

        const binanceSymbol = SYMBOL_MAP[symbol] || symbol.replace('-', '').toUpperCase();

        try {
            const res = await fetch('/api/backtest/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: binanceSymbol,
                    strategy,
                    strategyParams: params,
                    interval,
                    initialCapital: parseFloat(capital) || 10000,
                    feeRate: 0.001,
                    maxPositionSize: 0.1
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to start backtest');
            setSessionId(data.sessionId);
            // Start polling
            pollRef.current = setInterval(() => pollSession(data.sessionId), 1000);
        } catch (e) {
            setResult({ error: e.message });
            setRunning(false);
        }
    };

    const pollSession = async (id) => {
        try {
            const res = await fetch(`/api/backtest/${id}`);
            const data = await res.json();
            if (!data.success) return;
            const s = data.session;
            setProgress(s.progress || 0);
            if (s.status === 'completed') {
                stopPolling();
                // Fetch equity + trades
                const [eqRes, trRes] = await Promise.all([
                    fetch(`/api/backtest/${id}/equity`),
                    fetch(`/api/backtest/${id}/trades?limit=50`)
                ]);
                const eqData = await eqRes.json();
                const trData = await trRes.json();
                setResult({
                    metrics: s.metrics,
                    trades: trData.trades || [],
                    equity: eqData.equity || [],
                    totalTrades: s.trades
                });
                setRunning(false);
            } else if (s.status === 'failed') {
                stopPolling();
                setResult({ error: s.error || 'Backtest failed' });
                setRunning(false);
            }
        } catch { /* ignore poll errors */ }
    };

    // Cleanup on unmount
    useEffect(() => () => stopPolling(), []);

    const handleReset = () => {
        stopPolling();
        setRunning(false);
        setResult(null);
        setProgress(0);
        setSessionId(null);
    };

    const m = result?.metrics;
    const pnlColor = m?.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400';
    const sharpeColor = !m ? 'text-white' : m.sharpeRatio >= 1 ? 'text-emerald-400' : m.sharpeRatio >= 0 ? 'text-amber-400' : 'text-red-400';

    // Downsample equity curve to max 200 points for performance
    const equityCurve = (() => {
        const eq = result?.equity || [];
        if (eq.length <= 200) return eq;
        const step = Math.ceil(eq.length / 200);
        return eq.filter((_, i) => i % step === 0 || i === eq.length - 1);
    })();

    const TRADES_PER_PAGE = 10;
    const trades = result?.trades || [];
    const visibleTrades = trades.slice(tradesPage * TRADES_PER_PAGE, (tradesPage + 1) * TRADES_PER_PAGE);
    const totalPages = Math.ceil(trades.length / TRADES_PER_PAGE);

    return (
        <div className="h-full flex flex-col overflow-hidden text-xs">
            {/* ── Config Panel ── */}
            <div className="p-3 border-b border-white/5 space-y-3 shrink-0">
                <div className="flex gap-2">
                    <div className="flex-1">
                        <label className="text-[9px] text-slate-500 uppercase block mb-1">Symbol</label>
                        <input
                            value={symbol}
                            onChange={e => setSymbol(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-soma-accent/50"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[9px] text-slate-500 uppercase block mb-1">Interval</label>
                        <select
                            value={interval}
                            onChange={e => setInterval(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-soma-accent/50"
                        >
                            {['1m', '5m', '15m', '1h', '4h', '1d'].map(i => <option key={i} value={i}>{i}</option>)}
                        </select>
                    </div>
                    <div className="flex-1">
                        <label className="text-[9px] text-slate-500 uppercase block mb-1">Capital ($)</label>
                        <input
                            type="number"
                            value={capital}
                            onChange={e => setCapital(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-soma-accent/50"
                        />
                    </div>
                </div>

                <div>
                    <label className="text-[9px] text-slate-500 uppercase block mb-1">Strategy</label>
                    <div className="flex gap-1">
                        {STRATEGIES.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setStrategy(s.id)}
                                className={`flex-1 px-2 py-1.5 text-[10px] font-bold rounded border transition-all ${strategy === s.id ? 'bg-soma-accent/20 border-soma-accent/50 text-soma-accent' : 'bg-black/30 border-white/5 text-slate-500 hover:text-slate-300 hover:border-white/15'}`}
                            >
                                {s.name.split(' ').slice(0, 2).join(' ')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Strategy Params */}
                <div className="flex gap-2">
                    {currentStrategy.params.map(p => (
                        <div key={p.key} className="flex-1">
                            <label className="text-[9px] text-slate-500 uppercase block mb-1">{p.label}</label>
                            <input
                                type="number"
                                value={params[p.key] ?? p.default}
                                onChange={e => setParams(prev => ({ ...prev, [p.key]: parseFloat(e.target.value) || p.default }))}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-soma-accent/50"
                            />
                        </div>
                    ))}
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleRun}
                        disabled={running}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-bold transition-all ${running ? 'bg-soma-accent/10 text-soma-accent/40 cursor-wait border border-soma-accent/20' : 'bg-soma-accent/20 hover:bg-soma-accent/30 text-soma-accent border border-soma-accent/40'}`}
                    >
                        <Play className="w-3 h-3" />
                        {running ? `RUNNING... ${Math.round(progress)}%` : 'RUN BACKTEST'}
                    </button>
                    {result && (
                        <button onClick={handleReset} className="px-3 py-2 rounded border border-white/10 text-slate-500 hover:text-white hover:border-white/20 transition-all">
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Progress bar */}
                {running && (
                    <div className="h-1 bg-black/40 rounded overflow-hidden">
                        <div
                            className="h-full bg-soma-accent/70 transition-all duration-500 rounded"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}
            </div>

            {/* ── Results ── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                {result?.error && (
                    <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{result.error}</span>
                    </div>
                )}

                {m && (
                    <>
                        {/* Key Metrics Grid */}
                        <div className="grid grid-cols-3 gap-1.5">
                            <MetricCard
                                label="Net P&L"
                                value={`${m.netPnL >= 0 ? '+' : ''}$${(m.netPnL || 0).toFixed(0)}`}
                                sub={`${m.totalReturn >= 0 ? '+' : ''}${(m.totalReturn || 0).toFixed(1)}%`}
                                color={pnlColor}
                                highlight
                            />
                            <MetricCard
                                label="Win Rate"
                                value={`${(m.winRate || 0).toFixed(1)}%`}
                                sub={`${m.winningTrades}W / ${m.losingTrades}L`}
                                color={(m.winRate || 0) >= 50 ? 'text-emerald-400' : 'text-amber-400'}
                            />
                            <MetricCard
                                label="Profit Factor"
                                value={m.profitFactor === Infinity ? '∞' : (m.profitFactor || 0).toFixed(2)}
                                sub="gross P / gross L"
                                color={(m.profitFactor || 0) >= 1.5 ? 'text-emerald-400' : (m.profitFactor || 0) >= 1 ? 'text-amber-400' : 'text-red-400'}
                            />
                            <MetricCard
                                label="Sharpe Ratio"
                                value={(m.sharpeRatio || 0).toFixed(2)}
                                sub="annualized"
                                color={sharpeColor}
                            />
                            <MetricCard
                                label="Sortino Ratio"
                                value={(m.sortinoRatio || 0).toFixed(2)}
                                sub="downside risk adj"
                                color={(m.sortinoRatio || 0) >= 1 ? 'text-emerald-400' : (m.sortinoRatio || 0) >= 0 ? 'text-amber-400' : 'text-red-400'}
                            />
                            <MetricCard
                                label="Max Drawdown"
                                value={`${(m.maxDrawdown || 0).toFixed(1)}%`}
                                sub={`${m.totalTrades} trades`}
                                color={(m.maxDrawdown || 0) <= 10 ? 'text-emerald-400' : (m.maxDrawdown || 0) <= 20 ? 'text-amber-400' : 'text-red-400'}
                            />
                        </div>

                        {/* Equity Curve */}
                        {equityCurve.length > 1 && (
                            <div>
                                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <TrendingUp className="w-3 h-3" /> Equity Curve
                                </div>
                                <div className="h-32 bg-black/20 rounded border border-white/5">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={equityCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="btEqGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={m.netPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor={m.netPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" strokeOpacity={0.04} />
                                            <YAxis domain={['auto', 'auto']} hide={true} />
                                            <ReferenceLine y={parseFloat(capital) || 10000} stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="4 2" />
                                            <Tooltip
                                                contentStyle={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '10px' }}
                                                formatter={(v) => [`$${v?.toFixed(0)}`, 'Equity']}
                                                labelStyle={{ color: '#94a3b8' }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="value"
                                                stroke={m.netPnL >= 0 ? '#10b981' : '#ef4444'}
                                                strokeWidth={1.5}
                                                fill="url(#btEqGrad)"
                                                dot={false}
                                                isAnimationActive={false}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* Trades Table */}
                        {trades.length > 0 && (
                            <div>
                                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">
                                    Trades ({trades.length})
                                </div>
                                <div className="rounded border border-white/5 overflow-hidden">
                                    <table className="w-full text-[9px] font-mono">
                                        <thead>
                                            <tr className="bg-black/40 text-slate-500">
                                                <th className="text-left px-2 py-1.5">SIDE</th>
                                                <th className="text-right px-2 py-1.5">ENTRY</th>
                                                <th className="text-right px-2 py-1.5">EXIT</th>
                                                <th className="text-right px-2 py-1.5">P&L</th>
                                                <th className="text-left px-2 py-1.5">REASON</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleTrades.map((t, i) => (
                                                <tr key={t.id || i} className="border-t border-white/5 hover:bg-white/3">
                                                    <td className="px-2 py-1">
                                                        <span className={`font-bold ${t.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {(t.side || '').toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className="px-2 py-1 text-right text-slate-300">{(t.entryPrice || 0).toFixed(2)}</td>
                                                    <td className="px-2 py-1 text-right text-slate-300">{(t.exitPrice || 0).toFixed(2)}</td>
                                                    <td className={`px-2 py-1 text-right font-bold ${(t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {(t.pnl || 0) >= 0 ? '+' : ''}${(t.pnl || 0).toFixed(2)}
                                                    </td>
                                                    <td className="px-2 py-1 text-slate-500">{t.exitReason || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {totalPages > 1 && (
                                        <div className="flex items-center justify-between px-2 py-1.5 bg-black/20 border-t border-white/5">
                                            <button
                                                disabled={tradesPage === 0}
                                                onClick={() => setTradesPage(p => p - 1)}
                                                className="text-[9px] px-2 py-1 rounded border border-white/10 text-slate-500 hover:text-white disabled:opacity-30"
                                            >← Prev</button>
                                            <span className="text-[9px] text-slate-500">{tradesPage + 1} / {totalPages}</span>
                                            <button
                                                disabled={tradesPage >= totalPages - 1}
                                                onClick={() => setTradesPage(p => p + 1)}
                                                className="text-[9px] px-2 py-1 rounded border border-white/10 text-slate-500 hover:text-white disabled:opacity-30"
                                            >Next →</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!result && !running && (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                        <Play className="w-8 h-8 mb-3 opacity-30" />
                        <p className="text-xs">Configure and run a backtest</p>
                        <p className="text-[10px] mt-1 opacity-70">Uses real Binance historical data</p>
                    </div>
                )}
            </div>
        </div>
    );
};
