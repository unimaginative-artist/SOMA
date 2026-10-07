import { AssetType } from "./types.js";

// Expanded symbol lists for autocomplete
export const CRYPTO_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'XRP-USD', 'ADA-USD', 'AVAX-USD', 'MATIC-USD', 'DOT-USD', 'LINK-USD', 'UNI-USD', 'ATOM-USD', 'LTC-USD', 'BCH-USD', 'NEAR-USD', 'APT-USD', 'ARB-USD', 'OP-USD', 'INJ-USD', 'SUI-USD'];

export const STOCK_SYMBOLS = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'GME', 'PLTR', 'MSTR', 'AMZN', 'GOOGL', 'GOOG', 'META', 'MSFT', 'NFLX', 'COIN', 'HOOD', 'SOFI', 'RIVN', 'LCID', 'NIO', 'BABA', 'SPY', 'QQQ', 'IWM', 'DIA', 'ARKK', 'SOXL', 'TQQQ', 'SQQQ', 'VIX', 'UVXY', 'JPM', 'BAC', 'GS', 'V', 'MA', 'PYPL', 'SQ', 'INTC', 'MU', 'QCOM', 'AVGO', 'TSM', 'ASML', 'ARM', 'SMCI', 'DELL', 'HPE', 'IBM', 'ORCL', 'CRM', 'NOW', 'SNOW', 'DDOG', 'NET', 'ZS', 'CRWD', 'PANW', 'FTNT', 'DIS', 'CMCSA', 'WMT', 'TGT', 'COST', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'KO', 'PEP', 'JNJ', 'PFE', 'MRNA', 'UNH', 'LLY', 'ABBV', 'CVX', 'XOM', 'COP', 'SLB', 'HAL', 'BA', 'LMT', 'RTX', 'NOC', 'GD', 'CAT', 'DE', 'MMM', 'HON', 'UPS', 'FDX'];

export const FUTURES_SYMBOLS = ['BTC-PERP', 'ETH-PERP', 'ES1!', 'NQ1!', 'CL1!', 'GC1!', 'SI1!', 'NG1!', 'ZB1!', 'ZN1!', 'ZC1!', 'ZS1!', 'ZW1!', 'HG1!', 'PL1!', 'PA1!', '6E1!', '6J1!', '6B1!', 'RTY1!', 'YM1!', 'SOL-PERP', 'DOGE-PERP', 'XRP-PERP', 'AVAX-PERP', 'MATIC-PERP', 'LINK-PERP', 'ARB-PERP', 'OP-PERP'];

export const AVAILABLE_SYMBOLS = [...CRYPTO_SYMBOLS, ...STOCK_SYMBOLS, ...FUTURES_SYMBOLS];

// Symbol metadata for autocomplete display
export const SYMBOL_INFO = {
    // Crypto
    'BTC-USD': { name: 'Bitcoin', type: 'crypto' },
    'ETH-USD': { name: 'Ethereum', type: 'crypto' },
    'SOL-USD': { name: 'Solana', type: 'crypto' },
    'DOGE-USD': { name: 'Dogecoin', type: 'crypto' },
    'XRP-USD': { name: 'Ripple', type: 'crypto' },
    'ADA-USD': { name: 'Cardano', type: 'crypto' },
    'AVAX-USD': { name: 'Avalanche', type: 'crypto' },
    'MATIC-USD': { name: 'Polygon', type: 'crypto' },
    'DOT-USD': { name: 'Polkadot', type: 'crypto' },
    'LINK-USD': { name: 'Chainlink', type: 'crypto' },
    // Stocks - Tech
    'NVDA': { name: 'NVIDIA Corporation', type: 'stock' },
    'TSLA': { name: 'Tesla Inc', type: 'stock' },
    'AAPL': { name: 'Apple Inc', type: 'stock' },
    'AMD': { name: 'Advanced Micro Devices', type: 'stock' },
    'AMZN': { name: 'Amazon.com Inc', type: 'stock' },
    'GOOGL': { name: 'Alphabet Inc', type: 'stock' },
    'META': { name: 'Meta Platforms', type: 'stock' },
    'MSFT': { name: 'Microsoft Corporation', type: 'stock' },
    'NFLX': { name: 'Netflix Inc', type: 'stock' },
    // Stocks - Meme/Retail
    'GME': { name: 'GameStop Corp', type: 'stock' },
    'PLTR': { name: 'Palantir Technologies', type: 'stock' },
    'MSTR': { name: 'MicroStrategy', type: 'stock' },
    'COIN': { name: 'Coinbase Global', type: 'stock' },
    'HOOD': { name: 'Robinhood Markets', type: 'stock' },
    // ETFs
    'SPY': { name: 'S&P 500 ETF', type: 'etf' },
    'QQQ': { name: 'Nasdaq 100 ETF', type: 'etf' },
    'IWM': { name: 'Russell 2000 ETF', type: 'etf' },
    'ARKK': { name: 'ARK Innovation ETF', type: 'etf' },
    'SOXL': { name: 'Semiconductors 3x Bull', type: 'etf' },
    'TQQQ': { name: 'Nasdaq 3x Bull', type: 'etf' },
    // Futures
    'ES1!': { name: 'E-mini S&P 500', type: 'futures' },
    'NQ1!': { name: 'E-mini Nasdaq 100', type: 'futures' },
    'CL1!': { name: 'Crude Oil', type: 'futures' },
    'GC1!': { name: 'Gold', type: 'futures' },
    'BTC-PERP': { name: 'Bitcoin Perpetual', type: 'futures' },
    'ETH-PERP': { name: 'Ethereum Perpetual', type: 'futures' },
};

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

/**
 * PRESET_CONFIGS — mirrors PRESET_CONFIGS in server/finance/autonomousTrader.js exactly.
 * These are the REAL trading parameters the engine uses. Keep in sync.
 */
export const PRESET_CONFIGS = {
    BALANCED:            { minConfidence: 0.60, maxPositionPct: 0.10, takeProfitPct: 0.06, stopLossPct: 0.02, cooldownSec: 120 },
    BTC_NATIVE:          { minConfidence: 0.60, maxPositionPct: 0.15, takeProfitPct: 0.08, stopLossPct: 0.03, cooldownSec: 180 },
    MICRO_CHALLENGE:     { minConfidence: 0.55, maxPositionPct: 0.05, takeProfitPct: 0.02, stopLossPct: 0.01, cooldownSec: 30 },
    MICRO:               { minConfidence: 0.55, maxPositionPct: 0.05, takeProfitPct: 0.02, stopLossPct: 0.01, cooldownSec: 30 },
    YOLO:                { minConfidence: 0.45, maxPositionPct: 0.30, takeProfitPct: 0.15, stopLossPct: 0.05, cooldownSec: 60 },
    CONSERVATIVE:        { minConfidence: 0.80, maxPositionPct: 0.05, takeProfitPct: 0.04, stopLossPct: 0.01, cooldownSec: 300 },
    HIGH_PROBABILITY:    { minConfidence: 0.85, maxPositionPct: 0.05, takeProfitPct: 0.05, stopLossPct: 0.01, cooldownSec: 300 },
    STOCKS_EARNINGS:     { minConfidence: 0.70, maxPositionPct: 0.08, takeProfitPct: 0.10, stopLossPct: 0.03, cooldownSec: 240 },
    STOCKS_SWING:        { minConfidence: 0.65, maxPositionPct: 0.10, takeProfitPct: 0.08, stopLossPct: 0.02, cooldownSec: 300 },
    STOCKS_MEME:         { minConfidence: 0.50, maxPositionPct: 0.05, takeProfitPct: 0.20, stopLossPct: 0.05, cooldownSec: 60 },
    FUTURES_GRID:        { minConfidence: 0.55, maxPositionPct: 0.10, takeProfitPct: 0.03, stopLossPct: 0.01, cooldownSec: 30 },
    FUTURES_PERP:        { minConfidence: 0.60, maxPositionPct: 0.12, takeProfitPct: 0.05, stopLossPct: 0.02, cooldownSec: 90 },
    FUTURES_ES:          { minConfidence: 0.65, maxPositionPct: 0.08, takeProfitPct: 0.04, stopLossPct: 0.01, cooldownSec: 60 },
    FUTURES_COMMODITIES: { minConfidence: 0.65, maxPositionPct: 0.08, takeProfitPct: 0.05, stopLossPct: 0.02, cooldownSec: 180 },
};

/**
 * Agent role definitions — each agent maps to a real data source in the live engine.
 * `dataSource` tells StrategyBrain where to pull the live score for that agent.
 *
 * All agents are powered by the same 9-signal SignalLibrary ensemble. The engine
 * doesn't run separate processes — instead, each agent "role" reads a specific
 * slice of the ensemble output so the card shows real numbers, not stubs.
 */
const AGENTS = {
    // Core roles present in every preset
    SIGNAL_ENSEMBLE: {
        id: 'ensemble', name: 'Signal Ensemble',
        dataSource: 'agents.strategy',
        description: 'Composite score from all 9 active signals (RSI, SMA, MACD, Bollinger, Momentum, Breakout, VPT, Microstructure, VolSurge). Score drives BUY/SELL/HOLD.',
    },
    RISK_GUARDIAN: {
        id: 'risk', name: 'Risk Guardian',
        dataSource: 'agents.risk',
        description: 'Live RSI-based overbought/oversold gate + guardrail checks (max drawdown, position count, cooldown). Blocks trades that violate risk config.',
    },
    SENTIMENT: {
        id: 'sentiment', name: 'Market Sentiment',
        dataSource: 'agents.sentiment',
        description: 'Alt-data feed (news, social, options flow) blended with Options IV signal. Shifts ensemble weight up to ±20% when external sentiment is strong.',
    },
    EXECUTION: {
        id: 'strategist', name: 'Execution Engine',
        dataSource: 'stats.execution',
        description: 'Tracks live session outcomes: win rate, session P&L, gross wins/losses. Score = rolling win rate from last 20 closed trades.',
    },
    // Signal-group sub-roles
    MEAN_REVERSION: {
        id: 'mean_rev', name: 'Mean Reversion',
        dataSource: 'signals.rsi+bollinger',
        description: 'RSI oversold/overbought + Bollinger Band deviation. Scores highest when price is stretched and likely to snap back.',
    },
    TREND_FOLLOW: {
        id: 'trend', name: 'Trend Follow',
        dataSource: 'signals.sma+momentum+macd',
        description: 'SMA crossover + momentum + MACD histogram. Scores highest during directional moves with SMA stack aligned.',
    },
    VOLUME_MICRO: {
        id: 'volume', name: 'Volume + Microstructure',
        dataSource: 'signals.volumeSurge+microstructure+vpt',
        description: 'Volume surge vs 20-bar avg, VPT trend, bid/ask microstructure. Confirms breakouts are backed by real participation.',
    },
    BREAKOUT: {
        id: 'breakout', name: 'Breakout Scanner',
        dataSource: 'signals.breakout',
        description: 'Price vs highest-high / lowest-low over lookback window. Fires when price breaks above recent resistance or below support.',
    },
    REGIME: {
        id: 'regime', name: 'Regime Filter',
        dataSource: 'regime',
        description: 'Classifies market as TRENDING / RANGING / VOLATILE. Adjusts directional threshold (±0.06 in RANGING, ±0.10 in trending) and bypasses MTF filter when ranging.',
    },
};

// Preset Configurations
export const STRATEGY_PRESETS = [
    {
        id: 'BALANCED',
        name: 'Standard Portfolio',
        description: 'Runs all 9 signals equally weighted. Fires trades when 60%+ confidence with RSI + Bollinger mean-reversion or SMA trend alignment.',
        riskProfile: 'MED',
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO],
        config: PRESET_CONFIGS.BALANCED,
        strategies: [AGENTS.MEAN_REVERSION, AGENTS.TREND_FOLLOW, AGENTS.RISK_GUARDIAN],
    },
    {
        id: 'BTC_NATIVE',
        name: 'Swarm Architecture',
        description: 'Full 5-role swarm. All 9 signals active. ATR-based dynamic stops. MTF bypass in RANGING. Best for BTC/ETH where the engine was calibrated.',
        riskProfile: 'ADAPTIVE',
        assetTypes: [AssetType.CRYPTO],
        config: PRESET_CONFIGS.BTC_NATIVE,
        strategies: [AGENTS.SIGNAL_ENSEMBLE, AGENTS.TREND_FOLLOW, AGENTS.RISK_GUARDIAN, AGENTS.SENTIMENT, AGENTS.EXECUTION],
    },
    {
        id: 'MICRO_CHALLENGE',
        name: 'Micro Compounder',
        description: 'Lowest threshold (55% confidence) to maximise trade frequency on small capital. Tight 2%/1% TP/SL to compound quickly and limit blowout.',
        riskProfile: 'EXTREME',
        assetTypes: [AssetType.CRYPTO],
        config: PRESET_CONFIGS.MICRO_CHALLENGE,
        strategies: [AGENTS.BREAKOUT, AGENTS.VOLUME_MICRO, AGENTS.EXECUTION],
    },
    {
        id: 'MICRO',
        name: 'Micro Scalper',
        description: 'Same thresholds as Micro Compounder but 30s analysis interval for faster cycle time. Targets quick 2% flips on momentum.',
        riskProfile: 'HIGH',
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO],
        config: PRESET_CONFIGS.MICRO,
        strategies: [AGENTS.BREAKOUT, AGENTS.VOLUME_MICRO, AGENTS.RISK_GUARDIAN],
    },
    {
        id: 'YOLO',
        name: 'Full Aggression',
        description: 'Fires at just 45% confidence. 30% max position. Chases breakouts and momentum — high blowout risk, high upside. Know what you\'re doing.',
        riskProfile: 'EXTREME',
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO],
        config: PRESET_CONFIGS.YOLO,
        strategies: [AGENTS.BREAKOUT, AGENTS.MEAN_REVERSION, AGENTS.EXECUTION],
    },
    {
        id: 'CONSERVATIVE',
        name: 'High Conviction Only',
        description: 'Requires 80% confidence before touching a trade. Very few signals qualify. 5-minute cooldown. Lowest drawdown profile.',
        riskProfile: 'LOW',
        assetTypes: [AssetType.CRYPTO],
        config: PRESET_CONFIGS.CONSERVATIVE,
        strategies: [AGENTS.SIGNAL_ENSEMBLE, AGENTS.RISK_GUARDIAN, AGENTS.REGIME],
    },
    {
        id: 'HIGH_PROBABILITY',
        name: 'High Swarm Consensus',
        description: 'Strictest gate: 85% confidence required. All 9 signals must broadly agree before a trade fires. Very low trade frequency, highest expected precision.',
        riskProfile: 'LOW',
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO, AssetType.FUTURES],
        config: PRESET_CONFIGS.HIGH_PROBABILITY,
        strategies: [AGENTS.SIGNAL_ENSEMBLE, AGENTS.REGIME, AGENTS.RISK_GUARDIAN],
    },
    {
        id: 'STOCKS_EARNINGS',
        name: 'Earnings Momentum',
        description: 'Tuned for pre/post-earnings vol. 70% confidence. Wide 10%/3% TP/SL to capture the full earnings move. Use on single names, not ETFs.',
        riskProfile: 'HIGH',
        assetTypes: [AssetType.STOCKS],
        config: PRESET_CONFIGS.STOCKS_EARNINGS,
        strategies: [AGENTS.VOLUME_MICRO, AGENTS.SENTIMENT, AGENTS.RISK_GUARDIAN],
    },
    {
        id: 'STOCKS_SWING',
        name: 'Tech Swing Trader',
        description: 'Long 5-minute analysis cycle (300s) for multi-day swing setups. Relies on SMA + momentum stack alignment before entering.',
        riskProfile: 'MED',
        assetTypes: [AssetType.STOCKS],
        config: PRESET_CONFIGS.STOCKS_SWING,
        strategies: [AGENTS.TREND_FOLLOW, AGENTS.MEAN_REVERSION, AGENTS.EXECUTION],
    },
    {
        id: 'STOCKS_MEME',
        name: 'Meme / Retail Momentum',
        description: 'Lowest stock confidence gate (50%). Wide 20%/5% TP/SL for high-volatility names. Volume surge and breakout signals weighted heaviest.',
        riskProfile: 'EXTREME',
        assetTypes: [AssetType.STOCKS],
        config: PRESET_CONFIGS.STOCKS_MEME,
        strategies: [AGENTS.VOLUME_MICRO, AGENTS.BREAKOUT, AGENTS.EXECUTION],
    },
    {
        id: 'FUTURES_GRID',
        name: 'Futures Grid',
        description: 'Fast 30s cycles. Tight 3%/1% TP/SL for scalping futures ranges. Bollinger band edges are entry signals.',
        riskProfile: 'MED',
        assetTypes: [AssetType.FUTURES],
        config: PRESET_CONFIGS.FUTURES_GRID,
        strategies: [AGENTS.MEAN_REVERSION, AGENTS.VOLUME_MICRO, AGENTS.RISK_GUARDIAN],
    },
    {
        id: 'FUTURES_PERP',
        name: 'Perpetual Momentum',
        description: '90s cooldown. Breakout + momentum signals drive entries on BTC/ETH perps. 5%/2% TP/SL for decent R:R.',
        riskProfile: 'HIGH',
        assetTypes: [AssetType.FUTURES],
        config: PRESET_CONFIGS.FUTURES_PERP,
        strategies: [AGENTS.BREAKOUT, AGENTS.TREND_FOLLOW, AGENTS.EXECUTION],
    },
    {
        id: 'FUTURES_ES',
        name: 'Index Futures (ES/NQ)',
        description: 'Moderate 65% confidence gate. 1-minute analysis for ES/NQ intraday. SMA trend + RSI reversion entries.',
        riskProfile: 'MED',
        assetTypes: [AssetType.FUTURES],
        config: PRESET_CONFIGS.FUTURES_ES,
        strategies: [AGENTS.TREND_FOLLOW, AGENTS.MEAN_REVERSION, AGENTS.RISK_GUARDIAN],
    },
    {
        id: 'FUTURES_COMMODITIES',
        name: 'Commodity Futures',
        description: '3-minute cooldown. Macro trend following on CL/GC. Momentum + SMA primary. Requires 65% confidence.',
        riskProfile: 'MED',
        assetTypes: [AssetType.FUTURES],
        config: PRESET_CONFIGS.FUTURES_COMMODITIES,
        strategies: [AGENTS.TREND_FOLLOW, AGENTS.SENTIMENT, AGENTS.REGIME],
    },
];

// Initial Data
// Pre-populate with core symbols to prevent crashes and provide immediate UI state
export const INITIAL_TICKERS = AVAILABLE_SYMBOLS.map(symbol => ({
    symbol,
    name: SYMBOL_INFO[symbol]?.name || symbol,
    type: SYMBOL_INFO[symbol]?.type || (symbol.includes('-') ? (symbol.includes('PERP') ? 'futures' : 'crypto') : 'stock'),
    price: symbol.includes('BTC') ? 64000 : 
           symbol.includes('ETH') ? 3400 : 
           symbol.includes('SOL') ? 145 : 
           symbol.includes('NVDA') ? 820 : 
           symbol.includes('TSLA') ? 175 : 100,
    change: 0,
    changePercent: 0,
    sentiment: Math.random() > 0.5 ? 0.2 : -0.1,
    volatility: 40 + Math.random() * 20,
    momentum: (Math.random() - 0.5) * 100
}));
