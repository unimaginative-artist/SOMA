
export enum TradeMode {
  AUTONOMOUS = 'AUTONOMOUS',
  SUPERVISED = 'SUPERVISED',
  MANUAL = 'MANUAL'
}

export enum AssetType {
  CRYPTO = 'CRYPTO',
  STOCKS = 'STOCKS',
  FUTURES = 'FUTURES'
}

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  volatility: number; // 0-100
  momentum: number; // -100 to 100
  sentiment: number; // -1 to 1
  type: AssetType;
}

export interface Trade {
  id: string;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  pnl?: number; // Realized PnL for this trade
  status: 'FILLED' | 'PENDING' | 'REJECTED' | 'CANCELED';
  strategyId: string;
  riskScore: number;
  executionTimeMs: number;
  reason: string; // NEW: The "Why" behind the trade
}

export interface Strategy {
  id: string;
  name: string;
  allocation: number; // 0-100%
  pnl: number;
  winRate: number;
  confidence: number; // 0-100
  active: boolean;
  description: string;
  codeSnippet?: string; // New field for Python logic
}

export interface RiskMetrics {
  walletBalance: number; // NEW: Total funds in user's master wallet
  initialBalance: number; // Funds allocated to the trading session
  equity: number; // Current simulated value of the allocation (Balance + PnL)
  netExposure: number;
  dailyDrawdown: number;
  maxDrawdownLimit: number;
  sharpeRatio: number;
  var95: number; // Value at Risk
  leverage: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  source: string;
}

export interface ChartPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prediction?: number; // AI prediction line
  upperBand?: number; // Bollinger or confidence interval
  lowerBand?: number;
}

export interface StrategyPreset {
  id: string;
  name: string;
  description: string;
  riskProfile: 'LOW' | 'MED' | 'HIGH' | 'EXTREME';
  strategies: Strategy[];
}