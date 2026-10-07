import React, { useEffect, useState } from 'react';
import { GoogleGenAI } from "@google/genai";
import { X, Brain, Cpu, AlertTriangle, Terminal, Sparkles } from 'lucide-react';
import { ChartPoint, TickerData, RiskMetrics, StrategyPreset } from '../types';

interface AIAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  tickerData: TickerData;
  chartData: ChartPoint[];
  allTickers: TickerData[];
  riskMetrics: RiskMetrics;
  presets: StrategyPreset[];
}

export const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({ 
  isOpen, 
  onClose, 
  symbol, 
  tickerData, 
  chartData,
  allTickers,
  riskMetrics,
  presets
}) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingStep, setThinkingStep] = useState(0);

  useEffect(() => {
    if (isOpen) {
      generateAnalysis();
    } else {
        setAnalysis(null);
        setError(null);
        setLoading(false);
    }
  }, [isOpen]);

  // Simulated "Thinking" steps for UX
  useEffect(() => {
    if (loading) {
        const interval = setInterval(() => {
            setThinkingStep(prev => (prev + 1) % 4);
        }, 800); 
        return () => clearInterval(interval);
    }
  }, [loading]);

  const generateAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      let apiKey = null;
      try {
        if (typeof process !== 'undefined' && process.env) {
          apiKey = process.env.API_KEY;
        }
      } catch (e) {
        console.warn("Could not access process.env");
      }

      // Fallback for demo
      if (!apiKey) {
         console.warn("No API_KEY found. Using simulation mode.");
         await new Promise(resolve => setTimeout(resolve, 3500)); 
         
         const isBullish = tickerData.change >= 0;
         const mockAnalysis = `
# SOMA STRATEGIC DIRECTIVE: GLOBAL MARKET SCAN

**MARKET REGIME:** ${isBullish ? 'RISK-ON' : 'RISK-OFF'}
**GLOBAL SENTIMENT:** ${isBullish ? 'BULLISH DIVERGENCE' : 'BEARISH CONSOLIDATION'}

### 1. ASSET SELECTION
Analyzing ${allTickers.length} instruments. 
**Top Pick:** ${symbol}
**Reasoning:** Highest relative strength score (${Math.floor(Math.random()*10 + 80)}) paired with volume anomaly.

### 2. STRATEGY RECOMMENDATION
**Active Preset:** ${isBullish ? 'Bitcoin Native' : 'Yield Harvester'}
**Logic:** Current volatility (${tickerData.volatility.toFixed(0)}) favors ${isBullish ? 'trend following systems' : 'mean reversion and market making'}.

### 3. EXECUTION PLAN
**Wallet Balance:** $${riskMetrics.walletBalance.toLocaleString()}
**Recommended Position Size:** $${(riskMetrics.walletBalance * 0.15).toLocaleString(undefined, {maximumFractionDigits:0})} (15% Allocation)
- **Entry:** Market
- **Stop Loss:** ${(tickerData.price * (isBullish ? 0.97 : 1.03)).toFixed(2)}
- **Take Profit:** ${(tickerData.price * (isBullish ? 1.08 : 0.92)).toFixed(2)}

*System Note: API Key not configured. Showing simulated intelligence for demonstration.*
`;
         setAnalysis(mockAnalysis.trim());
         setLoading(false);
         return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const tickerSummary = allTickers.map(t => 
        `- ${t.symbol}: $${t.price.toFixed(2)} (${t.changePercent.toFixed(2)}%) Vol:${t.volatility}`
      ).join('\n');

      const presetSummary = presets.map(p => `- ${p.name} (Risk: ${p.riskProfile})`).join('\n');
      
      const prompt = `
        You are Soma, an elite autonomous trading intelligence used by professional hedge funds.
        
        CURRENT STATE:
        - Wallet Balance: $${riskMetrics.walletBalance.toLocaleString()}
        - Net Exposure: $${riskMetrics.netExposure.toLocaleString()}
        - Current Drawdown: ${riskMetrics.dailyDrawdown.toFixed(2)}%

        MARKET OVERVIEW (ALL TICKERS):
        ${tickerSummary}

        AVAILABLE STRATEGY PRESETS:
        ${presetSummary}

        OBJECTIVES:
        1. Analyze the global market state based on the ticker list provided. Identify the strongest opportunity.
        2. RECOMMEND A SPECIFIC SYMBOL to trade right now.
        3. RECOMMEND A SPECIFIC STRATEGY PRESET from the list to apply to this trade.
        4. CALCULATE A POSITION SIZE (in Dollars) based on the wallet balance. Use standard risk management (e.g., 1-5% risk per trade depending on conviction).

        Output a tactical briefing. Use markdown. Be concise, decisive, and professional.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 2048 } 
        }
      });

      setAnalysis(response.text || "Analysis complete. No output generated.");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate analysis");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-soma-950 border border-soma-accent/50 rounded-lg shadow-[0_0_50px_rgba(0,240,255,0.15)] flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-soma-800 bg-soma-900/50">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-soma-accent/10 rounded-full border border-soma-accent/30">
                    <Brain className={`w-5 h-5 text-soma-accent ${loading ? 'animate-pulse' : ''}`} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-white tracking-wider flex items-center gap-2">
                        SOMA DEEP SCAN
                    </h2>
                    <div className="text-[10px] text-soma-accent font-mono flex items-center gap-2">
                        <span>CONTEXT: GLOBAL MARKET + WALLET</span>
                        <span className="w-1 h-1 rounded-full bg-soma-accent"></span>
                        <span>THINKING BUDGET: 2k TOKENS</span>
                    </div>
                </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-soma-800 rounded text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
            </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 font-mono relative min-h-[400px]">
            {loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center space-y-6">
                    <div className="relative">
                        <div className="absolute inset-0 bg-soma-accent blur-xl opacity-20 animate-pulse"></div>
                        <Cpu className="w-16 h-16 text-soma-accent animate-[spin_3s_linear_infinite]" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-xl font-bold text-white animate-pulse">ANALYZING MARKET VECTOR</h3>
                        <div className="text-xs font-mono text-soma-accent tracking-widest">
                            {thinkingStep === 0 && "COMPARING TICKER RELATIVE STRENGTH..."}
                            {thinkingStep === 1 && "CALCULATING OPTIMAL POSITION SIZE..."}
                            {thinkingStep === 2 && "SELECTING BEST STRATEGY PRESET..."}
                            {thinkingStep === 3 && "GENERATING TACTICAL PLAN..."}
                        </div>
                    </div>
                    <div className="w-64 h-1 bg-soma-900 rounded-full overflow-hidden">
                        <div className="h-full bg-soma-accent animate-pulse w-1/3 mx-auto"></div>
                    </div>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center h-full text-soma-danger space-y-4">
                    <AlertTriangle className="w-12 h-12" />
                    <p className="text-lg font-bold">ANALYSIS FAILED</p>
                    <p className="text-sm text-slate-400 max-w-md text-center">{error}</p>
                    <button 
                        onClick={generateAnalysis}
                        className="px-4 py-2 bg-soma-danger/10 border border-soma-danger rounded hover:bg-soma-danger/20 transition-colors font-bold text-xs"
                    >
                        RETRY CONNECTION
                    </button>
                </div>
            ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-2 text-soma-success mb-4 pb-2 border-b border-soma-800/50">
                        <Sparkles className="w-4 h-4" />
                        <span className="text-xs font-bold tracking-widest">STRATEGIC DIRECTIVE GENERATED</span>
                    </div>
                    
                    {/* Render Analysis Text */}
                    <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed whitespace-pre-line">
                        {analysis}
                    </div>
                    
                    <div className="mt-8 p-4 bg-soma-accent/5 border border-soma-accent/20 rounded flex items-start gap-3">
                        <Terminal className="w-5 h-5 text-soma-accent mt-0.5" />
                        <div>
                            <h4 className="text-xs font-bold text-soma-accent mb-1">EXECUTION WARNING</h4>
                            <p className="text-[10px] text-slate-400">
                                This plan is generated by AI based on current telemetry. Confirm Strategy Preset selection and adjust position size in Risk Panel before engaging Autonomous Mode.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};