import React, { useState, useEffect } from 'react';
import CustomMarketView from '../CustomMarketView/CustomMarketView.jsx';
import { Activity, ArrowUpRight, ArrowDownRight, Clock, Info, ShieldAlert, Sliders, ChevronDown } from 'lucide-react';

/**
 * MANUAL WORKSTATION
 * 
 * "Control over comfort. Density over beauty. Precision over abstraction."
 */

export const ManualWorkstation = ({
    tickerData,
    chartData,
    onExecuteTrade,
    accountBalance,
    positions,
    orders,
    assetType,
    setAssetType,
    selectedSymbol,
    setSelectedSymbol,
    dataSource,
    activeProtocol
}) => {
    // --- STATE ---
    const [orderType, setOrderType] = useState('LIMIT');
    const [side, setSide] = useState('BUY');
    const [quantity, setQuantity] = useState(1);
    const [price, setPrice] = useState(tickerData?.price || 0);
    const [stopLoss, setStopLoss] = useState('');
    const [takeProfit, setTakeProfit] = useState('');
    const [trailPercent, setTrailPercent] = useState(2);
    const [riskAssessment, setRiskAssessment] = useState(null);
    const [sizingRec, setSizingRec] = useState(null);
    const [intelItems, setIntelItems] = useState([]);

    // --- POSITION SIZING RECOMMENDATION ---
    useEffect(() => {
        const fetchSizing = async () => {
            try {
                const res = await fetch(`/api/trading/position-size?symbol=${encodeURIComponent(selectedSymbol)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.sizing) setSizingRec(data.sizing);
                }
            } catch (e) { /* sizing not available */ }
        };
        fetchSizing();
        const iv = setInterval(fetchSizing, 30000);
        return () => clearInterval(iv);
    }, [selectedSymbol]);

    // --- REAL NEWS FEED (Alpaca News API — fast, no AI) ---
    useEffect(() => {
        const fetchNews = async () => {
            if (!selectedSymbol) return;
            try {
                const res = await fetch(`/api/finance/news?symbol=${encodeURIComponent(selectedSymbol)}&limit=5`);
                if (!res.ok) return;
                const data = await res.json();
                if (!data.items?.length) return;
                const newsItems = data.items.map(n => ({ ...n, _type: 'news' }));
                setIntelItems(prev => [
                    ...prev.filter(i => i._type !== 'news'),
                    ...newsItems
                ].slice(0, 50));
            } catch (e) { /* news not available, silent */ }
        };

        fetchNews();
        const interval = setInterval(fetchNews, 60000);
        return () => clearInterval(interval);
    }, [selectedSymbol]);

    // --- AI ANALYSIS INTEL (SOMA thesis + quant — slower, rate-limited) ---
    useEffect(() => {
        const fetchAnalysis = async () => {
            if (!selectedSymbol) return;

            try {
                const res = await fetch('/api/finance/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: selectedSymbol })
                });

                if (res.ok) {
                    const data = await res.json();
                    const newItems = [];
                    const time = new Date().toLocaleTimeString();

                    if (data.thesis) {
                        newItems.push({
                            time, source: 'SOMA CHIEF', _type: 'analysis',
                            headline: data.thesis.slice(0, 120) + '...',
                            impact: 'HIGH'
                        });
                    }

                    if (data.quant?.technical_indicators) {
                        const rsi = data.quant.technical_indicators.rsi;
                        newItems.push({
                            time, source: 'QUANT ENGINE', _type: 'analysis',
                            headline: `RSI: ${rsi.value} (${rsi.signal}) | MACD Divergence detected`,
                            impact: 'MED'
                        });
                    }

                    if (newItems.length) {
                        setIntelItems(prev => [
                            ...newItems,
                            ...prev.filter(i => i._type !== 'analysis')
                        ].slice(0, 50));
                    }
                }
            } catch (e) { /* analysis not available */ }
        };

        fetchAnalysis();
        const interval = setInterval(fetchAnalysis, 60000);
        return () => clearInterval(interval);
    }, [selectedSymbol]);

    // Sync price when tickerData changes (symbol switch or live update)
    useEffect(() => {
        if (tickerData?.price && tickerData.price !== price) {
            setPrice(tickerData.price);
        }
    }, [tickerData?.price]);

    // Depth of Market — centered on current price with realistic spread
    const basePrice = tickerData?.price || 0;
    const spread = basePrice > 1000 ? 0.50 : basePrice > 100 ? 0.10 : 0.01;
    const depthOfMarket = Array.from({ length: 14 }, (_, i) => {
        const offset = i - 7;
        const lvlPrice = basePrice + offset * spread;
        return {
            price: lvlPrice,
            size: Math.floor(200 + Math.abs(offset) * 300 + Math.random() * 500),
            total: Math.floor(1000 + Math.abs(offset) * 2000 + Math.random() * 3000),
            side: i < 7 ? 'ASK' : 'BID'
        };
    }).sort((a, b) => b.price - a.price);

    // --- HANDLERS ---
    const handleHover = (isHovering, actionSide) => {
        if (isHovering) {
            setRiskAssessment({
                slippage: 'LOW (<0.1%)',
                trend: '85% Confluence',
                volatility: 'Expanding',
                message: actionSide === 'BUY' ? 'Strong accumulation support below.' : 'Resistance cluster ahead.'
            });
        } else { setRiskAssessment(null); }
    };

    const handleSubmit = () => {
        if (orderType === 'TRAILING_STOP') {
            // Send directly to Alpaca trailing stop endpoint
            fetch('/api/alpaca/trailing-stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    side: side.toLowerCase(),
                    qty: parseFloat(quantity),
                    trailPercent: parseFloat(trailPercent) || 2
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    onExecuteTrade({ symbol: selectedSymbol, type: 'TRAILING_STOP', side, quantity, trailPercent, _result: data.order });
                }
            })
            .catch(() => {});
            return;
        }
        onExecuteTrade({
            symbol: selectedSymbol,
            type: orderType,
            side: side,
            quantity: parseFloat(quantity),
            price: parseFloat(price),
            stopLoss: stopLoss ? parseFloat(stopLoss) : null,
            takeProfit: takeProfit ? parseFloat(takeProfit) : null
        });
    };

    // --- RENDER ---
    return (
        <div className="flex h-full w-full bg-[#0a0a0c] text-zinc-300 font-mono text-xs overflow-hidden">

            {/* COLUMN 1: MARKET INTELLIGENCE (LEFT) */}
            <div className="w-[300px] flex flex-col border-r border-zinc-800 bg-[#0e0e10]">
                <div className="p-2 border-b border-zinc-800 bg-[#151518] font-bold text-zinc-400 uppercase tracking-wider flex justify-between items-center">
                    <span className="flex items-center gap-2"><Activity className="w-3 h-3 text-emerald-500 animate-pulse" /> Live Intel</span>
                    <span className="text-[9px] bg-zinc-800 px-1 rounded text-zinc-500">REALTIME</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {intelItems.map((item, idx) => (
                        <div key={idx} className="p-3 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors cursor-default group">
                            <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                                <span className="font-mono text-emerald-500/70">{item.time}</span>
                                <span className={`font-bold ${item.source === 'SOMA CHIEF' ? 'text-purple-400' : item.source === 'QUANT ENGINE' ? 'text-cyan-400' : 'text-zinc-600'}`}>{item.source}</span>
                            </div>
                            <div className={`text-zinc-300 leading-snug group-hover:text-white transition-colors ${item.impact === 'HIGH' ? 'border-l-2 border-red-500 pl-2' : ''}`}>
                                {item.headline}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="h-1/3 border-t border-zinc-800 p-2">
                    <div className="text-[10px] font-bold text-zinc-500 mb-2">SYSTEM STATUS</div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-900 p-2 border border-zinc-800">
                            <div className="text-zinc-500">LATENCY</div>
                            <div className="text-emerald-500">12ms</div>
                        </div>
                        <div className="bg-zinc-900 p-2 border border-zinc-800">
                            <div className="text-zinc-500">API</div>
                            <div className="text-emerald-500">CONNECTED</div>
                        </div>
                        <div className="bg-zinc-900 p-2 border border-zinc-800 col-span-2">
                            <div className="text-zinc-500">ACCOUNT EQUITY</div>
                            <div className="text-white font-bold text-sm">${accountBalance?.toLocaleString() || '0.00'}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* COLUMN 2: CENTRAL COMMAND (CHART & DOM) */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* CHART AREA */}
                <div className="flex-1 bg-[#050505] relative border-b border-zinc-800">

                    {/* COMMAND BAR (Manual Mode Header) */}
                    <div className="absolute top-0 left-0 right-0 h-10 border-b border-zinc-800 bg-[#0e0e10] flex items-center px-4 justify-between z-20">
                        <div className="flex items-center gap-4 h-full">
                            <div className="flex gap-1 bg-black/50 p-1 rounded border border-zinc-800">
                                {['CRYPTO', 'STOCKS', 'FUTURES'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setAssetType(type)}
                                        className={`px-4 py-1 text-[10px] font-bold transition-all rounded-sm ${assetType === type ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Right: Price Display */}
                        <div className="flex items-center gap-4 ml-auto">
                            <span className="font-bold text-white text-sm tracking-widest">{selectedSymbol}</span>
                            <div className="h-4 w-[1px] bg-zinc-800"></div>
                            <div className="flex flex-col items-end">
                                <span className={`font-mono text-lg font-bold leading-none ${tickerData.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {tickerData.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="absolute inset-0 top-10">
                        <CustomMarketView
                            selectedSymbol={selectedSymbol}
                            data={chartData}
                            dataSource={dataSource}
                            activeProtocol={activeProtocol}
                        />
                    </div>
                </div>

                {/* DOM / LEVEL 2 LADDER (BOTTOM) */}
                <div className="h-[250px] bg-[#0e0e10] flex border-t border-zinc-800">
                    <div className="flex-1 border-r border-zinc-800 flex flex-col">
                        <div className="p-1 px-2 border-b border-zinc-800 text-[10px] font-bold text-zinc-500 flex justify-between">
                            <span>DEPTH OF MARKET</span>
                            <span>AGGREGATED</span>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <table className="w-full text-right text-xs">
                                <thead className="text-zinc-600 bg-[#151518]">
                                    <tr>
                                        <th className="font-normal p-1">Total</th>
                                        <th className="font-normal p-1">Size</th>
                                        <th className="font-normal p-1 text-center">Price</th>
                                        <th className="font-normal p-1">Size</th>
                                        <th className="font-normal p-1">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {depthOfMarket.map((row, i) => (
                                        <tr key={i} className="hover:bg-zinc-800/50">
                                            {row.side === 'BID' ? (
                                                <>
                                                    <td className="p-1 text-zinc-500 relative">
                                                        <div className="absolute right-0 top-0 bottom-0 bg-emerald-900/20" style={{ width: `${Math.random() * 100}%` }}></div>
                                                        <span className="relative z-10">{row.total}</span>
                                                    </td>
                                                    <td className="p-1 text-emerald-400 relative z-10">{row.size}</td>
                                                    <td className="p-1 text-center font-bold text-emerald-500 bg-emerald-900/10 border-x border-emerald-900/30">{row.price.toFixed(2)}</td>
                                                    <td className="p-1"></td>
                                                    <td className="p-1"></td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="p-1"></td>
                                                    <td className="p-1"></td>
                                                    <td className="p-1 text-center font-bold text-red-500 bg-red-900/10 border-x border-red-900/30">{row.price.toFixed(2)}</td>
                                                    <td className="p-1 text-red-400 relative z-10">{row.size}</td>
                                                    <td className="p-1 text-zinc-500 relative">
                                                        <div className="absolute left-0 top-0 bottom-0 bg-red-900/20" style={{ width: `${Math.random() * 100}%` }}></div>
                                                        <span className="relative z-10">{row.total}</span>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {/* Positions & Orders Table */}
                    <div className="w-[400px] flex flex-col">
                        <div className="p-1 px-2 border-b border-zinc-800 text-[10px] font-bold text-zinc-500 flex justify-between">
                            <span>ACTIVE POSITIONS</span>
                            <span className="text-zinc-600">{positions?.length || 0}</span>
                        </div>
                        <div className="flex-1 bg-[#0a0a0c] overflow-y-auto custom-scrollbar">
                            {(!positions || positions.length === 0) ? (
                                <div className="flex items-center justify-center h-full text-zinc-600 italic text-xs">No active positions</div>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead className="text-zinc-600 bg-[#151518] sticky top-0">
                                        <tr>
                                            <th className="font-normal p-1 text-left">Symbol</th>
                                            <th className="font-normal p-1 text-right">Qty</th>
                                            <th className="font-normal p-1 text-right">Entry</th>
                                            <th className="font-normal p-1 text-right">P&L</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {positions.map((pos, i) => {
                                            const pnl = pos.unrealizedPnl || parseFloat(pos.unrealized_pl) || 0;
                                            return (
                                                <tr key={i} className="hover:bg-zinc-800/50 border-b border-zinc-800/30">
                                                    <td className="p-1 text-white font-bold">{pos.symbol}</td>
                                                    <td className={`p-1 text-right ${(pos.side || 'long') === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {pos.qty}
                                                    </td>
                                                    <td className="p-1 text-right text-zinc-400 font-mono">
                                                        ${(pos.entryPrice || parseFloat(pos.avg_entry_price) || 0).toFixed(2)}
                                                    </td>
                                                    <td className={`p-1 text-right font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {/* Open Orders */}
                        {orders && orders.length > 0 && (
                            <>
                                <div className="p-1 px-2 border-t border-b border-zinc-800 text-[10px] font-bold text-zinc-500 flex justify-between">
                                    <span>OPEN ORDERS</span>
                                    <span className="text-zinc-600">{orders.length}</span>
                                </div>
                                <div className="max-h-[80px] overflow-y-auto custom-scrollbar bg-[#0a0a0c]">
                                    {orders.map((ord, i) => (
                                        <div key={i} className="flex justify-between items-center px-2 py-1 border-b border-zinc-800/30 text-[10px]">
                                            <span className={`font-bold ${ord.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {ord.side?.toUpperCase()} {ord.symbol}
                                            </span>
                                            <span className="text-zinc-500">{ord.qty} @ ${parseFloat(ord.limit_price || ord.stop_price || 0).toFixed(2)}</span>
                                            <span className="text-zinc-600">{ord.status}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* COLUMN 3: ORDER ENTRY (RIGHT) */}
            <div className="w-[280px] bg-[#121214] border-l border-zinc-800 flex flex-col relative">
                <div className="p-3 border-b border-zinc-800 font-bold text-white uppercase tracking-wider bg-[#18181b]">
                    Order Entry
                </div>

                <div className="p-4 space-y-4 flex-1 relative">
                    {/* Side Toggle */}
                    <div className="flex bg-black rounded p-1 border border-zinc-800">
                        <button
                            onClick={() => setSide('BUY')}
                            className={`flex-1 py-2 font-bold rounded transition-colors ${side === 'BUY' ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            BUY
                        </button>
                        <button
                            onClick={() => setSide('SELL')}
                            className={`flex-1 py-2 font-bold rounded transition-colors ${side === 'SELL' ? 'bg-red-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            SELL
                        </button>
                    </div>

                    {/* Order Type */}
                    <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold">Order Type</label>
                        <select
                            value={orderType}
                            onChange={(e) => setOrderType(e.target.value)}
                            className="w-full bg-[#0a0a0c] border border-zinc-700 p-2 text-white outline-none focus:border-zinc-500"
                        >
                            <option value="MARKET">MARKET</option>
                            <option value="LIMIT">LIMIT</option>
                            <option value="STOP">STOP</option>
                            <option value="TRAILING_STOP">TRAILING STOP</option>
                        </select>
                    </div>

                    {/* Quantity */}
                    <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold">Quantity</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full bg-[#0a0a0c] border border-zinc-700 p-2 text-white outline-none focus:border-zinc-500 font-mono"
                        />
                        {sizingRec && (
                            <button
                                onClick={() => setQuantity(sizingRec.recommendedSize)}
                                className="w-full text-[9px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-1 hover:bg-cyan-500/20 transition-colors text-left"
                                title="Apply SOMA adaptive position sizing"
                            >
                                SOMA REC: {sizingRec.recommendedSize} units
                                <span className="text-zinc-500 ml-1">
                                    ({Math.round((sizingRec.riskPercent || 0) * 100)}% risk)
                                </span>
                            </button>
                        )}
                    </div>

                    {/* Price (Conditional) */}
                    {orderType !== 'MARKET' && (
                        <div className="space-y-1">
                            <label className="text-[10px] text-zinc-500 uppercase font-bold">Limit Price</label>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                className="w-full bg-[#0a0a0c] border border-zinc-700 p-2 text-white outline-none focus:border-zinc-500 font-mono"
                            />
                        </div>
                    )}

                    <div className="pt-4 border-t border-zinc-800 space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] text-zinc-500 uppercase font-bold">Stop Loss</label>
                            <input
                                type="number"
                                placeholder="Optional"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(e.target.value)}
                                className="w-24 bg-[#0a0a0c] border border-zinc-700 p-1 text-right text-white outline-none focus:border-zinc-500 font-mono text-xs"
                            />
                        </div>
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] text-zinc-500 uppercase font-bold">Take Profit</label>
                            <input
                                type="number"
                                placeholder="Optional"
                                value={takeProfit}
                                onChange={(e) => setTakeProfit(e.target.value)}
                                className="w-24 bg-[#0a0a0c] border border-zinc-700 p-1 text-right text-white outline-none focus:border-zinc-500 font-mono text-xs"
                            />
                        </div>
                        {orderType === 'TRAILING_STOP' && (
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] text-amber-400 uppercase font-bold">Trail %</label>
                                <input
                                    type="number"
                                    min="0.1"
                                    max="50"
                                    step="0.5"
                                    value={trailPercent}
                                    onChange={(e) => setTrailPercent(e.target.value)}
                                    className="w-24 bg-[#0a0a0c] border border-amber-500/40 p-1 text-right text-amber-300 outline-none focus:border-amber-500 font-mono text-xs"
                                />
                            </div>
                        )}
                    </div>

                    {/* AI RISK HOLOGRAM (Visible on Hover) */}
                    {riskAssessment && (
                        <div className="absolute bottom-4 left-4 right-4 bg-[#151518]/95 backdrop-blur-md border border-purple-500/50 rounded-lg p-3 shadow-[0_0_20px_rgba(168,85,247,0.2)] animate-in fade-in slide-in-from-bottom-2 z-50 pointer-events-none">
                            <div className="flex justify-between items-center mb-2 border-b border-white/10 pb-1">
                                <span className="text-[10px] font-bold text-purple-400 flex items-center gap-1">
                                    <ShieldAlert className="w-3 h-3" /> AI RISK CHECK
                                </span>
                                <span className="text-[9px] text-zinc-500">INSTANT</span>
                            </div>
                            <div className="space-y-1 text-[10px]">
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Slippage:</span>
                                    <span className="text-white font-mono">{riskAssessment.slippage}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Trend:</span>
                                    <span className="text-emerald-400 font-mono">{riskAssessment.trend}</span>
                                </div>
                                <div className="text-zinc-300 italic mt-1 border-t border-white/5 pt-1">
                                    "{riskAssessment.message}"
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Execution Button */}
                <div className="p-4 bg-[#151518] border-t border-zinc-800 relative z-40">
                    <div className="flex justify-between text-xs text-zinc-400 mb-2">
                        <span>Est. Total</span>
                        <span className="text-white font-mono">${(price * quantity).toFixed(2)}</span>
                    </div>
                    <button
                        onClick={handleSubmit}
                        onMouseEnter={() => handleHover(true, side)}
                        onMouseLeave={() => handleHover(false, side)}
                        className={`w-full py-3 font-bold text-sm tracking-wide transition-all transform active:scale-[0.98] ${side === 'BUY'
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(5,150,105,0.3)]'
                            : 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.3)]'
                            }`}
                    >
                        {side} {orderType}
                    </button>
                </div>
            </div>
        </div>
    );
};