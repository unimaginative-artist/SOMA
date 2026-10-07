import { Strategy, TickerData, AssetType, StrategyPreset } from "./types";

export const CRYPTO_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'XRP-USD'];
export const STOCK_SYMBOLS = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'GME', 'PLTR', 'MSTR'];
export const FUTURES_SYMBOLS = ['BTC-PERP', 'ETH-PERP', 'ES1!', 'NQ1!', 'CL1!', 'GC1!'];

export const AVAILABLE_SYMBOLS = [...CRYPTO_SYMBOLS, ...STOCK_SYMBOLS, ...FUTURES_SYMBOLS];

const REGIME_ADAPTIVE_CODE = `def detect_regime(row):
    if row["adx"] > 25 and row["atr"] > row["atr"].rolling(10).mean():
        return "TREND"
    elif row["adx"] < 20 and row["atr"] < row["atr"].rolling(10).mean():
        return "RANGE"
    else:
        return "NO_TRADE"

def generate_signal(row):
    if row["regime"] == "TREND":
        if row["close"] > row["vwap"] and row["ema20"] > row["ema50"] and row["rsi"] > 55:
            return "LONG"
        if row["close"] < row["vwap"] and row["ema20"] < row["ema50"] and row["rsi"] < 45:
            return "SHORT"

    if row["regime"] == "RANGE":
        if row["close"] < row["vwap"] - 1.5 * row["atr"] and row["rsi"] < 30:
            return "LONG"
        if row["close"] > row["vwap"] + 1.5 * row["atr"] and row["rsi"] > 70:
            return "SHORT"

    return "FLAT"`;

// Preset Configurations
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'BALANCED',
    name: 'Standard Portfolio',
    description: 'Balanced mix of mean reversion and trend following.',
    riskProfile: 'MED',
    strategies: [
        { id: 'S1', name: 'Alpha-MeanRevert', allocation: 40, pnl: 0, winRate: 0.65, confidence: 80, active: true, description: 'Standard mean reversion.' },
        { id: 'S2', name: 'Trend-Flow', allocation: 40, pnl: 0, winRate: 0.55, confidence: 75, active: true, description: 'Multi-timeframe trend following.' },
        { id: 'S3', name: 'Hedge-Guard', allocation: 20, pnl: 0, winRate: 0.90, confidence: 95, active: true, description: 'Risk mitigation hedging.' }
    ]
  },
  {
    id: 'BTC_NATIVE',
    name: 'Bitcoin Native',
    description: 'On-chain and mempool analysis specifically for BTC.',
    riskProfile: 'HIGH',
    strategies: [
        { 
            id: 'S13', 
            name: 'Regime-Adaptive', 
            allocation: 30, 
            pnl: 0, 
            winRate: 0.82, 
            confidence: 89, 
            active: true, 
            description: 'ADX/ATR regime detection. Switches between VWAP Trend & Mean-Rev.',
            codeSnippet: REGIME_ADAPTIVE_CODE
        },
        { id: 'S9', name: 'Mempool-Sniper', allocation: 25, pnl: 0, winRate: 0.78, confidence: 91, active: true, description: 'Front-running based on unconfirmed TXs in mempool.' },
        { id: 'S10', name: 'Whale-Watch', allocation: 20, pnl: 0, winRate: 0.62, confidence: 84, active: true, description: 'Tracking wallet movements > 100 BTC.' },
        { id: 'S11', name: 'Hash-Ribbon', allocation: 15, pnl: 0, winRate: 0.88, confidence: 70, active: true, description: 'Miner capitulation recovery trend following.' },
        { id: 'S12', name: 'Funding-Arb', allocation: 10, pnl: 0, winRate: 0.94, confidence: 99, active: true, description: 'Perpetual swap funding rate arbitrage.' }
    ]
  },
  {
    id: 'MICRO_CHALLENGE',
    name: 'Micro Compounder ($5)',
    description: 'Starts with $5. Aggressive compounding of small accounts.',
    riskProfile: 'EXTREME',
    strategies: [
        { id: 'MC1', name: 'Snowball-Auto', allocation: 70, pnl: 0, winRate: 0.55, confidence: 60, active: true, description: 'Reinvests 100% of PnL. No withdrawals.' },
        { id: 'MC2', name: 'Dust-Sweeper', allocation: 30, pnl: 0, winRate: 0.65, confidence: 72, active: true, description: 'Collects micro-inefficiencies in low liquidity coins.' }
    ]
  },
  {
    id: 'MICRO',
    name: 'Micro Scalper',
    description: 'High-frequency trading targeting small spread inefficiencies.',
    riskProfile: 'HIGH',
    strategies: [
        { id: 'S4', name: 'HFT-Sniper', allocation: 80, pnl: 0, winRate: 0.72, confidence: 88, active: true, description: 'Micro-structure scalp on order flow.' },
        { id: 'S5', name: 'Spread-Capture', allocation: 20, pnl: 0, winRate: 0.85, confidence: 92, active: true, description: 'Bid-ask spread harvesting.' }
    ]
  },
  {
    id: 'YOLO',
    name: 'Full Aggression',
    description: 'Concentrated bets on momentum breakouts. High risk.',
    riskProfile: 'EXTREME',
    strategies: [
        { id: 'S6', name: 'YOLO-Breakout', allocation: 100, pnl: 0, winRate: 0.40, confidence: 60, active: true, description: 'All-in momentum breakout chaser.' }
    ]
  },
  {
    id: 'CONSERVATIVE',
    name: 'Yield Harvester',
    description: 'Low-volatility delta-neutral strategies.',
    riskProfile: 'LOW',
    strategies: [
        { id: 'S7', name: 'Delta-Neutral', allocation: 60, pnl: 0, winRate: 0.95, confidence: 98, active: true, description: 'Funding rate arbitrage.' },
        { id: 'S8', name: 'Market-Maker', allocation: 40, pnl: 0, winRate: 0.80, confidence: 85, active: true, description: 'Passive liquidity provision.' }
    ]
  }
];

// Initial Data
export const INITIAL_TICKERS: TickerData[] = [
  { symbol: 'BTC-USD', price: 64230.50, change: 1200.50, changePercent: 1.8, volume: 45000000, volatility: 65, momentum: 80, sentiment: 0.7, type: AssetType.CRYPTO },
  { symbol: 'ETH-USD', price: 3450.20, change: -45.20, changePercent: -1.2, volume: 22000000, volatility: 55, momentum: -20, sentiment: 0.1, type: AssetType.CRYPTO },
  { symbol: 'NVDA', price: 124.50, change: 3.20, changePercent: 2.6, volume: 89000000, volatility: 45, momentum: 95, sentiment: 0.9, type: AssetType.STOCKS },
  { symbol: 'TSLA', price: 175.80, change: -8.50, changePercent: -4.6, volume: 55000000, volatility: 88, momentum: -75, sentiment: -0.6, type: AssetType.STOCKS },
  { symbol: 'BTC-PERP', price: 64255.00, change: 1225.00, changePercent: 1.9, volume: 95000000, volatility: 75, momentum: 85, sentiment: 0.75, type: AssetType.FUTURES },
  { symbol: 'ES1!', price: 5450.25, change: 12.50, changePercent: 0.23, volume: 1500000, volatility: 35, momentum: 40, sentiment: 0.6, type: AssetType.FUTURES },
];