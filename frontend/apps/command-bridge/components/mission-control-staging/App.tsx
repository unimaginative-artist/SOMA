import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GlobalControls } from './components/GlobalControls';
import { MainChart } from './components/MainChart';
import { StrategyBrain } from './components/StrategyBrain';
import { TradeStream } from './components/TradeStream';
import { RiskPanel } from './components/RiskPanel';
import { MarketRadar } from './components/MarketRadar';
import { CommandPanel } from './components/CommandPanel';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { TradeMode, AssetType, TickerData, Trade, Strategy, RiskMetrics, ChartPoint, StrategyPreset } from './types';
import { AVAILABLE_SYMBOLS, INITIAL_TICKERS, STRATEGY_PRESETS, CRYPTO_SYMBOLS, STOCK_SYMBOLS } from './constants';

const REASONS = [
    'MOMENTUM_BREAKOUT', 'VWAP_CROSS', 'MEAN_REVERSION', 'LIQUIDITY_GRAB', 
    'DELTA_HEDGE', 'ORDER_IMBALANCE', 'VOLATILITY_SQUEEZE', 'REGIME_CHANGE',
    'FUNDING_ARB', 'BASIS_TRADE'
];

const generateChartData = (basePrice: number, points: number = 120): ChartPoint[] => {
  let currentPrice = basePrice;
  const data: ChartPoint[] = [];
  const now = Date.now();
  
  for (let i = 0; i < points; i++) {
    const time = new Date(now - (points - i) * 60000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const change = (Math.random() - 0.5) * (basePrice * 0.015);
    const open = currentPrice;
    const close = currentPrice + change;
    const high = Math.max(open, close) + Math.random() * (basePrice * 0.008);
    const low = Math.min(open, close) - Math.random() * (basePrice * 0.008);
    const volume = Math.floor(Math.random() * 10000) + 1000;
    
    data.push({ 
        time, open, high, low, close, volume, 
        upperBand: high * 1.002, 
        lowerBand: low * 0.998, 
        prediction: close * (1 + (Math.random() - 0.5) * 0.01) // Wider prediction range
    });
    currentPrice = close;
  }
  return data;
};

const App: React.FC = () => {
  // --- Global State ---
  const [mode, setMode] = useState<TradeMode>(TradeMode.AUTONOMOUS);
  const [tradingActive, setTradingActive] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(INITIAL_TICKERS[0].symbol);
  const [assetType, setAssetType] = useState<AssetType>(AssetType.CRYPTO);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  
  // --- Data State ---
  const [tickers, setTickers] = useState<TickerData[]>(INITIAL_TICKERS);
  
  // DEFAULT TO INDEX 1 (Bitcoin Native) to show new strategy immediately
  const [currentPreset, setCurrentPreset] = useState<StrategyPreset>(STRATEGY_PRESETS[1]);
  const [strategies, setStrategies] = useState<Strategy[]>(STRATEGY_PRESETS[1].strategies);
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  
  // Risk & Simulation State
  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics>({
    walletBalance: 250000,
    initialBalance: 50000,
    equity: 50000,
    netExposure: 0,
    dailyDrawdown: 0,
    maxDrawdownLimit: 5.0,
    sharpeRatio: 0,
    var95: 0,
    leverage: 1.0
  });

  // --- Initialization ---
  useEffect(() => {
    const ticker = tickers.find(t => t.symbol === selectedSymbol);
    const basePrice = ticker ? ticker.price : 100;
    setChartData(generateChartData(basePrice));
  }, [selectedSymbol]);

  // --- Simulation Loop ---
  useEffect(() => {
    if (!tradingActive) return;
    
    const tickSpeed = mode === TradeMode.AUTONOMOUS ? 800 : mode === TradeMode.SUPERVISED ? 2500 : 1000000; 

    const interval = setInterval(() => {
      // 1. Update Tickers (Market Movement)
      setTickers(prev => prev.map(t => {
        const volatilityFactor = t.volatility / 10000;
        
        // FUTURE SPECIFIC LOGIC: Higher volatility multiplier
        let moveMultiplier = 20;
        if (t.type === AssetType.FUTURES) moveMultiplier = 35; 
        
        const move = (Math.random() - 0.5) * (t.price * volatilityFactor * moveMultiplier);
        const newPrice = t.price + move;
        // Update momentum based on price direction for the scanner
        const newMomentum = Math.max(-100, Math.min(100, t.momentum + (move > 0 ? 5 : -5)));
        
        return {
          ...t,
          price: newPrice,
          change: t.change + move,
          changePercent: ((t.change + move) / (t.price - t.change)) * 100,
          momentum: newMomentum
        };
      }));

      // 2. Update Chart
      setChartData(prev => {
        const last = prev[prev.length - 1];
        const ticker = tickers.find(t => t.symbol === selectedSymbol);
        if (!last) return prev;
        
        const currentPrice = ticker ? ticker.price : last.close;
        const newPoint: ChartPoint = {
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            open: last.close,
            close: currentPrice,
            high: Math.max(last.close, currentPrice) * (1 + Math.random() * 0.002),
            low: Math.min(last.close, currentPrice) * (1 - Math.random() * 0.002),
            volume: Math.floor(Math.random() * 5000) + 500,
            upperBand: currentPrice * 1.002,
            lowerBand: currentPrice * 0.998,
            prediction: currentPrice * (1 + (Math.random() - 0.5) * 0.01)
        };
        return [...prev.slice(1), newPoint];
      });

      // 3. Trade Generation
      if (mode !== TradeMode.MANUAL) {
        let baseChance = 0.5;
        if (currentPreset.riskProfile === 'HIGH') baseChance = 0.8;
        if (currentPreset.riskProfile === 'EXTREME') baseChance = 0.95;
        if (currentPreset.riskProfile === 'LOW') baseChance = 0.3;

        if (Math.random() < baseChance) {
          const activeTicker = tickers.find(t => t.symbol === selectedSymbol) || tickers[0];
          const strategy = strategies[Math.floor(Math.random() * strategies.length)];
          const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
          
          const isWin = Math.random() < strategy.winRate;
          const pnlPercent = isWin ? (Math.random() * 0.04) : -(Math.random() * 0.03); // Slightly higher volatility
          
          const tradeSize = riskMetrics.equity * 0.10; 
          const realizedPnL = tradeSize * pnlPercent;

          const newTrade: Trade = {
              id: Math.random().toString(36).substr(2, 9),
              timestamp: Date.now(),
              symbol: activeTicker.symbol,
              side: side,
              price: activeTicker.price,
              size: tradeSize / activeTicker.price,
              pnl: realizedPnL,
              status: 'FILLED',
              strategyId: strategy.id,
              riskScore: Math.floor(Math.random() * 100),
              executionTimeMs: Math.floor(Math.random() * 150),
              reason: REASONS[Math.floor(Math.random() * REASONS.length)]
          };

          setTrades(prev => [newTrade, ...prev].slice(0, 50));
          
          setRiskMetrics(prev => {
              const newEquity = prev.equity + realizedPnL;
              // Simulate larger drawdown for visual effect if unlucky
              const newDrawdown = newEquity < prev.initialBalance ? ((prev.initialBalance - newEquity) / prev.initialBalance) * 100 : 0;
              
              return {
                ...prev,
                equity: newEquity,
                netExposure: prev.netExposure + (side === 'BUY' ? tradeSize : -tradeSize),
                dailyDrawdown: newDrawdown
              };
          });

          setStrategies(prev => prev.map(s => {
              if (s.id === strategy.id) {
                  return { ...s, pnl: s.pnl + realizedPnL };
              }
              return s;
          }));
        }
      }

    }, tickSpeed);

    return () => clearInterval(interval);
  }, [tradingActive, selectedSymbol, tickers, strategies, mode, riskMetrics.equity, currentPreset]);

  // --- Handlers ---
  const toggleTrading = useCallback(() => setTradingActive(prev => !prev), []);
  
  const killSwitch = useCallback(() => {
    setTradingActive(false);
    setTrades(prev => [{
        id: 'KILL-SWITCH',
        timestamp: Date.now(),
        symbol: 'ALL',
        side: 'SELL',
        price: 0,
        size: 0,
        status: 'CANCELED',
        strategyId: 'SYSTEM',
        riskScore: 100,
        executionTimeMs: 0,
        reason: 'MANUAL_OVERRIDE'
    }, ...prev]);
  }, []);

  const handleSymbolSelect = (sym: string) => {
    const exists = tickers.find(t => t.symbol === sym);
    if (!exists) {
        const mockTicker: TickerData = {
            symbol: sym,
            price: Math.random() * 1000 + 10,
            change: 0,
            changePercent: 0,
            volume: Math.random() * 1000000,
            volatility: 50,
            momentum: 0,
            sentiment: 0.5,
            type: assetType
        };
        setTickers(prev => [...prev, mockTicker]);
    }
    setSelectedSymbol(sym);
  };

  const handlePresetSelect = (preset: StrategyPreset) => {
      setCurrentPreset(preset);
      setStrategies(preset.strategies);
      
      // Feature: Micro Challenge - Reset to $5
      if (preset.id === 'MICRO_CHALLENGE') {
          setRiskMetrics(prev => ({
              ...prev,
              initialBalance: 5,
              equity: 5,
              walletBalance: 5,
              dailyDrawdown: 0
          }));
          setTrades([]); 
      }
  };

  const handleUpdateWallet = (amount: number) => {
    setRiskMetrics(prev => ({
        ...prev,
        walletBalance: amount
    }));
  };

  const handleUpdateAllocation = (amount: number) => {
      setRiskMetrics(prev => ({
          ...prev,
          initialBalance: amount,
          equity: amount, 
          dailyDrawdown: 0
      }));
      setTrades([]); 
      setTradingActive(false);
  };

  const currentTicker = tickers.find(t => t.symbol === selectedSymbol) || tickers[0];
  
  // Calculate Market Sentiment
  const marketSentiment = currentTicker.change >= 0 ? 'BULL' : 'BEAR';

  const symbolPnl = useMemo(() => {
    return trades
        .filter(t => t.symbol === selectedSymbol && t.pnl)
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
  }, [trades, selectedSymbol]);

  return (
    <div className="flex flex-col h-screen bg-soma-950 text-slate-300 overflow-hidden">
      <GlobalControls 
        mode={mode} 
        setMode={setMode} 
        tradingActive={tradingActive}
        toggleTrading={toggleTrading}
        killSwitch={killSwitch}
        marketSentiment={marketSentiment}
      />
      
      {/* Main Grid - Revised for Layout Efficiency */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 lg:grid-rows-[1fr_180px] gap-0 overflow-hidden">
        
        {/* Left Col: Strategy Brain */}
        <div className="hidden lg:block col-span-3 row-span-1 border-r border-soma-800 h-full overflow-hidden">
            <StrategyBrain strategies={strategies} />
        </div>

        {/* Center Col: Chart & Command */}
        <div className="flex-1 lg:col-span-6 row-span-1 border-r border-soma-800 relative flex flex-col min-h-0">
            {/* Chart Area */}
            <div className="h-[45%] min-h-[250px] relative border-b border-soma-800">
                 <MainChart 
                    data={chartData} 
                    symbol={selectedSymbol} 
                    tickerData={currentTicker} 
                    symbolPnl={symbolPnl}
                 />
                 
                 {!tradingActive && (
                    <div className="absolute inset-0 bg-soma-950/60 backdrop-blur-sm flex items-center justify-center z-20 pointer-events-none">
                         <div className="text-center p-3 border border-soma-800 bg-soma-900 rounded-lg shadow-2xl pointer-events-auto">
                            <h2 className="text-xl font-bold text-white mb-1">STANDBY</h2>
                            <button onClick={toggleTrading} className="px-4 py-1 bg-soma-accent text-black font-bold text-sm rounded hover:bg-cyan-300 transition-colors">
                                ENGAGE SYSTEM
                            </button>
                        </div>
                    </div>
                 )}
            </div>

            {/* Command Center - Expanded Height */}
            <div className="flex-1 overflow-hidden">
                <CommandPanel 
                    currentSymbol={selectedSymbol}
                    onSymbolSelect={handleSymbolSelect}
                    currentPresetId={currentPreset.id}
                    onPresetSelect={handlePresetSelect}
                    assetType={assetType}
                    setAssetType={setAssetType}
                    onAnalyze={() => setIsAnalysisModalOpen(true)}
                />
            </div>
        </div>

        {/* Right Col: Trade Stream & Risk */}
        <div className="flex-1 lg:col-span-3 row-span-1 flex flex-col h-full overflow-hidden border-t lg:border-t-0 border-soma-800">
            <div className="h-1/2 border-b border-soma-800 overflow-hidden">
                <TradeStream trades={trades} />
            </div>
            <div className="h-1/2 overflow-hidden">
                <RiskPanel 
                    metrics={riskMetrics} 
                    onUpdateAllocation={handleUpdateAllocation} 
                    onUpdateWallet={handleUpdateWallet}
                />
            </div>
        </div>

        {/* Bottom Row: Market Radar - Fixed 180px height */}
        <div className="h-[180px] lg:col-span-12 row-start-2 border-t border-soma-800 bg-soma-900 overflow-hidden">
            <MarketRadar 
                tickers={tickers.filter(t => t.type === assetType)} 
                onSelect={handleSymbolSelect}
                selectedSymbol={selectedSymbol}
                riskMetrics={riskMetrics} // PASSED RISK METRICS HERE
            />
        </div>

      </div>

      <AIAnalysisModal 
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        symbol={selectedSymbol}
        tickerData={currentTicker}
        chartData={chartData}
        allTickers={tickers}
        riskMetrics={riskMetrics}
        presets={STRATEGY_PRESETS}
      />
    </div>
  );
};

export default App;