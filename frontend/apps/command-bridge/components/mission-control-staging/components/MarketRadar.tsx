import React, { useState, useEffect, useMemo } from 'react';
import { TickerData, RiskMetrics } from '../types';
import { Activity, Radio, Zap, Waves, Droplets, ArrowUp, ArrowDown, Crosshair, Anchor, Wind, Scale, Sword, Shield, DollarSign } from 'lucide-react';

interface MarketRadarProps {
  tickers: TickerData[];
  onSelect: (symbol: string) => void;
  selectedSymbol: string;
  riskMetrics?: RiskMetrics; // Made optional to avoid breaking if not passed immediately, though App.tsx passes it
}

// -----------------------------
// ENGINE LOGIC
// -----------------------------

const calculateOrderbookPressure = (
  bidDepth: number,
  askDepth: number,
  buyVol: number,
  sellVol: number,
  prevBid: number,
  prevAsk: number
) => {
    const totalDepth = Math.max(bidDepth + askDepth, 1);
    const imbalance = (bidDepth - askDepth) / totalDepth;
    const totalVol = buyVol + sellVol + 1e-9;
    const aggression = (buyVol - sellVol) / totalVol;
    const absorb = (bidDepth - prevBid) - (askDepth - prevAsk);
    const pressure = (0.4 * imbalance) + (0.4 * aggression) + (0.2 * Math.tanh(absorb / 5000));
    return { pressure, imbalance, aggression, absorb };
};

const calculateStormIndex = (volRatio: number, correlation: number, liqPressure: number) => {
    const stormRaw = (0.4 * volRatio) + (0.4 * correlation) + (0.2 * liqPressure * 10);
    const stormIndex = Math.min(100, Math.max(0, stormRaw * 25));
    let state = "CALM";
    if (stormIndex > 60) state = "STORM";
    else if (stormIndex > 30) state = "UNSTABLE";
    return { stormIndex, state };
};

export const MarketRadar: React.FC<MarketRadarProps> = ({ tickers, onSelect, selectedSymbol, riskMetrics }) => {
  const [radarAngle, setRadarAngle] = useState(0);
  const [engineData, setEngineData] = useState({
      flowZ: 0.5,
      leverage: 0.02,
      volRatio: 1.2,
      correlation: 0.6,
      liqPressure: 0.05,
      bidDepth: 2500000,
      askDepth: 2400000,
      buyVolume: 1500,
      sellVolume: 1200,
      prevBidDepth: 2500000,
      prevAskDepth: 2400000,
      fundingRate: 0.01
  });

  // Calculate P&L
  const pnl = riskMetrics ? riskMetrics.equity - riskMetrics.initialBalance : 0;
  const pnlPercent = riskMetrics ? (pnl / riskMetrics.initialBalance) * 100 : 0;
  const isProfit = pnl >= 0;

  useEffect(() => {
      const interval = setInterval(() => {
          setEngineData(prev => {
               // Simulation logic (abbreviated for brevity, same as before)
              return {
                  ...prev,
                  flowZ: Math.max(-5, Math.min(5, prev.flowZ + (Math.random() - 0.5) * 0.5)),
                  leverage: Math.max(-0.5, Math.min(0.5, prev.leverage + (Math.random() - 0.5) * 0.05)),
                  volRatio: Math.max(0.5, Math.min(3.0, prev.volRatio + (Math.random() - 0.5) * 0.1)),
                  correlation: Math.max(0, Math.min(1, prev.correlation + (Math.random() - 0.5) * 0.05)),
                  liqPressure: prev.liqPressure * 0.9 + (Math.random() > 0.95 ? Math.random() * 0.5 : 0),
                  bidDepth: Math.max(100000, prev.bidDepth + (Math.random() - 0.5) * 500000),
                  askDepth: Math.max(100000, prev.askDepth + (Math.random() - 0.5) * 500000),
                  buyVolume: Math.max(100, prev.buyVolume + (Math.random() - 0.5) * 500),
                  sellVolume: Math.max(100, prev.sellVolume + (Math.random() - 0.5) * 500),
                  prevBidDepth: prev.bidDepth,
                  prevAskDepth: prev.askDepth
              };
          });
      }, 800);
      return () => clearInterval(interval);
  }, []);

  const obMetrics = useMemo(() => 
      calculateOrderbookPressure(engineData.bidDepth, engineData.askDepth, engineData.buyVolume, engineData.sellVolume, engineData.prevBidDepth, engineData.prevAskDepth), 
  [engineData]);

  const stormMetrics = useMemo(() => 
      calculateStormIndex(engineData.volRatio, engineData.correlation, engineData.liqPressure), 
  [engineData]);

  useEffect(() => {
    const rot = setInterval(() => setRadarAngle(prev => (prev + 2) % 360), 20);
    return () => clearInterval(rot);
  }, []);


  const stormColor = stormMetrics.state === 'STORM' ? 'text-soma-danger' : stormMetrics.state === 'UNSTABLE' ? 'text-soma-warning' : 'text-soma-success';
  const stormBg = stormMetrics.state === 'STORM' ? 'bg-soma-danger' : stormMetrics.state === 'UNSTABLE' ? 'bg-soma-warning' : 'bg-soma-success';

  // --- SCANNER LOGIC: Map Tickers to Polar Coordinates ---
  
  const getTickerCoordinates = (ticker: TickerData) => {
    const maxRadius = 45; // %
    const radius = Math.min(maxRadius, (ticker.volatility / 100) * maxRadius); // More vol = further out
    
    // Angle: Momentum 100 -> -90 deg (Top), Momentum -100 -> 90 deg (Bottom)
    const angleDeg = (ticker.momentum / 100) * -90; 
    
    const angleRad = (angleDeg * Math.PI) / 180;
    
    const x = 50 + radius * Math.cos(angleRad);
    const y = 50 + radius * Math.sin(angleRad);
    
    return { x, y };
  };

  return (
    <div className="h-full bg-soma-950 flex flex-col lg:flex-row overflow-hidden relative border-t border-soma-800">
       
       {/* PANEL 1: P&L + STORM INDEX */}
       <div className="lg:w-1/4 border-r border-soma-800 flex flex-col relative overflow-hidden group">
            
            {/* Stylized P&L Display */}
            <div className="p-3 bg-soma-900/50 border-b border-soma-800 relative overflow-hidden shrink-0">
                <div className={`absolute right-0 top-0 w-16 h-16 blur-2xl opacity-20 ${isProfit ? 'bg-soma-success' : 'bg-soma-danger'}`}></div>
                <div className="relative z-10 flex justify-between items-end">
                    <div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">
                            <DollarSign className="w-3 h-3" /> Session P&L
                        </div>
                        <div className={`text-2xl font-black font-mono tracking-tighter ${isProfit ? 'text-soma-success drop-shadow-[0_0_5px_rgba(0,255,157,0.3)]' : 'text-soma-danger drop-shadow-[0_0_5px_rgba(255,42,42,0.3)]'}`}>
                            {isProfit ? '+' : ''}{pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    </div>
                    <div className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded border ${isProfit ? 'border-soma-success/30 bg-soma-success/10 text-soma-success' : 'border-soma-danger/30 bg-soma-danger/10 text-soma-danger'}`}>
                        {pnlPercent.toFixed(2)}%
                    </div>
                </div>
            </div>

            {/* Storm Index Breakdown */}
            <div className="flex-1 p-3 flex flex-col justify-center min-h-0">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Waves className={`w-3 h-3 ${stormColor}`} />
                        <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Storm Index</h3>
                    </div>
                    <span className={`text-[9px] uppercase font-bold border px-1.5 rounded ${stormMetrics.state === 'STORM' ? 'border-soma-danger text-soma-danger animate-pulse' : 'border-slate-800 text-slate-500'}`}>
                        {stormMetrics.state}
                    </span>
                </div>
                
                {/* Main Storm Bar */}
                <div className="w-full h-1.5 bg-soma-950 rounded-full overflow-hidden border border-soma-800 mb-3 relative">
                    <div className={`h-full ${stormBg} transition-all duration-500`} style={{width: `${stormMetrics.stormIndex}%`}}></div>
                </div>

                {/* Detail Metrics */}
                <div className="grid grid-cols-3 gap-2">
                    {/* Volatility Ratio */}
                    <div className="flex flex-col">
                        <span className="text-[7px] text-slate-500 font-bold mb-0.5">VOL RATIO</span>
                        <div className="flex items-end gap-1">
                            <span className={`text-[10px] font-mono leading-none ${engineData.volRatio > 1.5 ? 'text-soma-warning' : 'text-slate-300'}`}>
                                {engineData.volRatio.toFixed(1)}σ
                            </span>
                            <div className="w-full h-1 bg-soma-950 rounded-sm mb-0.5 border border-soma-800/50">
                                <div className={`h-full ${engineData.volRatio > 1.5 ? 'bg-soma-warning' : 'bg-slate-500'}`} style={{width: `${Math.min(engineData.volRatio/3 * 100, 100)}%`}}></div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Correlation Stress */}
                    <div className="flex flex-col">
                         <span className="text-[7px] text-slate-500 font-bold mb-0.5">CORR STRESS</span>
                         <div className="flex items-end gap-1">
                            <span className={`text-[10px] font-mono leading-none ${engineData.correlation > 0.8 ? 'text-soma-danger' : 'text-slate-300'}`}>
                                {engineData.correlation.toFixed(2)}
                            </span>
                             <div className="w-full h-1 bg-soma-950 rounded-sm mb-0.5 border border-soma-800/50">
                                <div className={`h-full ${engineData.correlation > 0.8 ? 'bg-soma-danger' : 'bg-slate-500'}`} style={{width: `${engineData.correlation * 100}%`}}></div>
                            </div>
                        </div>
                    </div>

                    {/* Liquidation Pressure */}
                     <div className="flex flex-col">
                         <span className="text-[7px] text-slate-500 font-bold mb-0.5">LIQ PRESS</span>
                          <div className="flex items-end gap-1">
                            <span className={`text-[10px] font-mono leading-none ${engineData.liqPressure > 0.5 ? 'text-soma-danger' : 'text-slate-300'}`}>
                                {(engineData.liqPressure * 10).toFixed(1)}
                            </span>
                             <div className="w-full h-1 bg-soma-950 rounded-sm mb-0.5 border border-soma-800/50">
                                <div className={`h-full ${engineData.liqPressure > 0.5 ? 'bg-soma-danger' : 'bg-slate-500'}`} style={{width: `${Math.min(engineData.liqPressure * 100, 100)}%`}}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
       </div>

       {/* PANEL 2: ORDERBOOK PRESSURE */}
       <div className="lg:w-1/4 border-r border-soma-800 p-2 lg:p-3 flex flex-col relative">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <Droplets className="w-3 h-3 text-blue-400" />
                    <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Liquidity</h3>
                </div>
                <span className={`text-[8px] font-mono font-bold ${obMetrics.pressure > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                    {obMetrics.pressure > 0 ? 'BUY' : 'SELL'} PRES: {Math.abs(obMetrics.pressure).toFixed(2)}
                </span>
            </div>

            <div className="grid grid-cols-3 gap-1 mb-1">
                 <div className="bg-black/40 p-1 rounded border border-soma-800 flex flex-col items-center">
                    <Scale className="w-2.5 h-2.5 text-slate-500 mb-0.5" />
                    <span className="text-[7px] text-slate-500">IMBALANCE</span>
                    <span className={`text-[8px] font-mono ${obMetrics.imbalance > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                        {obMetrics.imbalance.toFixed(2)}
                    </span>
                 </div>
                 <div className="bg-black/40 p-1 rounded border border-soma-800 flex flex-col items-center">
                    <Sword className="w-2.5 h-2.5 text-slate-500 mb-0.5" />
                    <span className="text-[7px] text-slate-500">AGGRESS</span>
                    <span className={`text-[8px] font-mono ${obMetrics.aggression > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                        {obMetrics.aggression.toFixed(2)}
                    </span>
                 </div>
                 <div className="bg-black/40 p-1 rounded border border-soma-800 flex flex-col items-center">
                    <Shield className="w-2.5 h-2.5 text-slate-500 mb-0.5" />
                    <span className="text-[7px] text-slate-500">ABSORB</span>
                    <span className={`text-[8px] font-mono ${obMetrics.absorb > 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                        {(obMetrics.absorb / 1000).toFixed(0)}k
                    </span>
                 </div>
            </div>

            {/* Depth Chart Visual */}
            <div className="flex-1 flex items-end justify-center gap-0.5 relative opacity-80 min-h-[30px] border-t border-soma-800 pt-1 mt-1">
                 {/* Bid Side */}
                 <div className="flex-1 h-full flex items-end justify-end px-1 gap-0.5">
                     {[...Array(5)].map((_, i) => (
                         <div key={i} className="w-1.5 bg-soma-success/60 hover:bg-soma-success transition-all rounded-t-sm" style={{height: `${40 + Math.random() * 40}%`}}></div>
                     ))}
                 </div>
                 {/* Mid */}
                 <div className="w-[1px] h-full bg-slate-700"></div>
                 {/* Ask Side */}
                 <div className="flex-1 h-full flex items-end justify-start px-1 gap-0.5">
                    {[...Array(5)].map((_, i) => (
                         <div key={i} className="w-1.5 bg-soma-danger/60 hover:bg-soma-danger transition-all rounded-t-sm" style={{height: `${40 + Math.random() * 40}%`}}></div>
                     ))}
                 </div>
            </div>
       </div>

       {/* PANEL 3: MARKET DEPTH RADAR (Replacing Scanner) */}
       <div className="lg:w-1/4 border-r border-soma-800 p-2 flex flex-col items-center justify-center relative overflow-hidden bg-black group">
            <div className="absolute top-2 left-2 flex flex-col z-10 pointer-events-none">
                <div className="flex items-center gap-2">
                    <Radio className="w-3 h-3 text-soma-accent" />
                    <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Market Map</h3>
                </div>
            </div>
            
            <div className="relative w-28 h-28 flex items-center justify-center">
                {/* Radar Grid */}
                <div className="absolute inset-0 border border-soma-800 rounded-full opacity-30"></div>
                <div className="absolute w-20 h-20 border border-soma-800 rounded-full opacity-30"></div>
                <div className="absolute w-10 h-10 border border-soma-800 rounded-full opacity-30"></div>
                <div className="absolute w-full h-[1px] bg-soma-800 top-1/2 -translate-y-1/2"></div>
                <div className="absolute h-full w-[1px] bg-soma-800 left-1/2 -translate-x-1/2"></div>
                
                {/* Labels */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 text-[7px] font-bold text-soma-success">BULL</div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 text-[7px] font-bold text-soma-danger">BEAR</div>
                <div className="absolute right-0 top-1/2 translate-x-1 -translate-y-1/2 text-[7px] text-slate-600">NEUTRAL</div>

                {/* Radar Sweep */}
                <div 
                    className="absolute w-1/2 h-1/2 bg-gradient-to-t from-transparent to-soma-accent/20 top-0 left-0 origin-bottom-right rounded-tl-full pointer-events-none"
                    style={{ transform: `rotate(${radarAngle}deg)` }}
                ></div>

                {/* Live Ticker Blips */}
                {tickers.map(ticker => {
                    const coords = getTickerCoordinates(ticker);
                    const isSelected = selectedSymbol === ticker.symbol;
                    return (
                        <div 
                            key={ticker.symbol}
                            onClick={() => onSelect(ticker.symbol)}
                            className={`absolute w-2 h-2 rounded-full cursor-pointer transition-all duration-500 hover:scale-150 z-20 ${
                                ticker.momentum > 0 
                                ? 'bg-soma-success shadow-[0_0_5px_#00ff9d]' 
                                : 'bg-soma-danger shadow-[0_0_5px_#ff2a2a]'
                            } ${isSelected ? 'ring-2 ring-white scale-125' : ''}`}
                            style={{ 
                                left: `${coords.x}%`, 
                                top: `${coords.y}%`, 
                                transform: 'translate(-50%, -50%)' 
                            }}
                            title={`${ticker.symbol}: Mom ${ticker.momentum.toFixed(0)}`}
                        ></div>
                    );
                })}
            </div>

            <div className="absolute bottom-1 right-2 text-right pointer-events-none">
                <span className="text-[7px] text-slate-500 block">AXIS: MOMENTUM (Y) / VOL (R)</span>
            </div>
       </div>

       {/* PANEL 4: TELEMETRY */}
       <div className="lg:w-1/4 p-2 lg:p-3 flex flex-col relative pb-8 lg:pb-8">
           <div className="flex items-center gap-2 mb-2">
                <Anchor className="w-3 h-3 text-indigo-400" />
                <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Telemetry</h3>
           </div>
           
           <div className="space-y-1 font-mono text-[9px]">
                <div className="flex justify-between items-center border-b border-soma-800 pb-0.5">
                    <span className="text-slate-500">FLOW Z</span>
                    <span className={engineData.flowZ > 0 ? 'text-soma-success' : 'text-soma-danger'}>
                        {engineData.flowZ.toFixed(2)}
                    </span>
                </div>
                <div className="flex justify-between items-center border-b border-soma-800 pb-0.5">
                    <span className="text-slate-500">LEV DELTA</span>
                    <span className={engineData.leverage > 0.05 ? 'text-soma-warning' : 'text-slate-300'}>
                        {(engineData.leverage * 100).toFixed(2)}%
                    </span>
                </div>
                 <div className="flex justify-between items-center border-b border-soma-800 pb-0.5">
                    <span className="text-slate-500">FUNDING</span>
                    <span className={engineData.fundingRate > 0 ? 'text-soma-success' : 'text-soma-danger'}>
                        {engineData.fundingRate.toFixed(4)}%
                    </span>
                </div>
           </div>

           <div className="mt-auto">
                <div className="flex items-center gap-1 text-[8px] text-slate-500 justify-end">
                    <Wind className="w-2.5 h-2.5 animate-pulse" />
                    LATENCY: 12ms
                </div>
           </div>
       </div>

       {/* FLOATING TICKER SELECTOR (Absolute Bottom) */}
       <div className="absolute bottom-0 left-0 w-full h-8 bg-soma-950/90 backdrop-blur border-t border-soma-800 flex items-center overflow-x-auto no-scrollbar z-20">
            {tickers.map(ticker => (
                <button 
                    key={ticker.symbol}
                    onClick={() => onSelect(ticker.symbol)}
                    className={`px-3 h-full flex items-center gap-2 text-[10px] font-mono whitespace-nowrap border-r border-soma-800 hover:bg-soma-800 transition-colors ${selectedSymbol === ticker.symbol ? 'bg-soma-800 text-white' : 'text-slate-500'}`}
                >
                    <span className="font-bold">{ticker.symbol}</span>
                    <span className={ticker.change >= 0 ? 'text-soma-success' : 'text-soma-danger'}>
                        {ticker.price.toFixed(2)}
                    </span>
                </button>
            ))}
       </div>

    </div>
  );
};