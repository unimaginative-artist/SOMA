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

// Preset Configurations
export const STRATEGY_PRESETS = [
    {
        id: 'BALANCED',
        name: 'Standard Portfolio',
        description: 'Balanced mix of mean reversion and trend following.',
        riskProfile: 'MED',
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO], // Universal strategies
        strategies: [
            { id: 'S1', name: 'Alpha-MeanRevert', allocation: 40, pnl: 0, winRate: 0.65, confidence: 80, active: true, description: 'Standard mean reversion.' },
            { id: 'S2', name: 'Trend-Flow', allocation: 40, pnl: 0, winRate: 0.55, confidence: 75, active: true, description: 'Multi-timeframe trend following.' },
            { id: 'S3', name: 'Hedge-Guard', allocation: 20, pnl: 0, winRate: 0.90, confidence: 95, active: true, description: 'Risk mitigation hedging.' }
        ]
    },
    { // Added missing opening brace for BTC_NATIVE preset
        id: 'BTC_NATIVE',
        name: 'Swarm Architecture',
        description: 'Autonomous multi-agent swarm (Director, Quant, Risk, Sentiment).',
        riskProfile: 'ADAPTIVE',
        assetTypes: [AssetType.CRYPTO], // Crypto-specific
        strategies: [
            { id: 'director', name: 'Director (Thesis)', allocation: 20, pnl: 0, winRate: 0.0, confidence: 0, active: true, description: 'Orchestrates the trading thesis and strategy.' },
            { id: 'tech', name: 'Tech (Technical)', allocation: 25, pnl: 0, winRate: 0.0, confidence: 0, active: true, description: 'Analyzes price action, pivots, and indicators.' },
            { id: 'risk', name: 'Risk Guardian', allocation: 20, pnl: 0, winRate: 0.0, confidence: 0, active: true, description: 'Evaluates exposure and drawdown limits.' },
            { id: 'sentiment', name: 'Sentiment (ToM)', allocation: 15, pnl: 0, winRate: 0.0, confidence: 0, active: true, description: 'Theory of Mind market psychology profiling.' },
            { id: 'strategist', name: 'Strategist (Exec)', allocation: 20, pnl: 0, winRate: 0.0, confidence: 0, active: true, description: 'Final trade execution and routing.' }
        ]
    },
    {
        id: 'MICRO_CHALLENGE',
        name: 'Micro Compounder ($5)',
        description: 'Starts with $5. Aggressive compounding of small accounts.',
        riskProfile: 'EXTREME',
        assetTypes: [AssetType.CRYPTO], // Crypto micro-cap focus
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
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO], // Universal HFT
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
        assetTypes: [AssetType.STOCKS, AssetType.CRYPTO], // Universal YOLO
        strategies: [
            { id: 'S6', name: 'YOLO-Breakout', allocation: 100, pnl: 0, winRate: 0.40, confidence: 60, active: true, description: 'All-in momentum breakout chaser.' }
        ]
    },
    {
        id: 'CONSERVATIVE',
        name: 'Yield Harvester',
        description: 'Low-volatility delta-neutral strategies.',
        riskProfile: 'LOW',
        assetTypes: [AssetType.CRYPTO], // Crypto yield farming
        strategies: [
            { id: 'S7', name: 'Delta-Neutral', allocation: 60, pnl: 0, winRate: 0.95, confidence: 98, active: true, description: 'Funding rate arbitrage.' },
            { id: 'S8', name: 'Market-Maker', allocation: 40, pnl: 0, winRate: 0.80, confidence: 85, active: true, description: 'Passive liquidity provision.' }
        ]
    },
    {
        id: 'STOCKS_EARNINGS',
        name: 'Earnings Momentum',
        description: 'Pre/post-earnings volatility plays on high-volume stocks.',
        riskProfile: 'HIGH',
        assetTypes: [AssetType.STOCKS],
        strategies: [
            { id: 'SE1', name: 'Earnings-Run', allocation: 50, pnl: 0, winRate: 0.62, confidence: 75, active: true, description: 'Momentum into earnings announcements.' },
            { id: 'SE2', name: 'Post-ER-Snap', allocation: 30, pnl: 0, winRate: 0.70, confidence: 80, active: true, description: 'Captures post-earnings snap moves.' },
            { id: 'SE3', name: 'IV-Crush', allocation: 20, pnl: 0, winRate: 0.85, confidence: 90, active: true, description: 'Profits from implied volatility collapse.' }
        ]
    },
    {
        id: 'STOCKS_SWING',
        name: 'Tech Swing Trader',
        description: 'Multi-day swing trades on FAANG and semiconductor stocks.',
        riskProfile: 'MED',
        assetTypes: [AssetType.STOCKS],
        strategies: [
            { id: 'SS1', name: 'FAANG-Momentum', allocation: 45, pnl: 0, winRate: 0.68, confidence: 78, active: true, description: 'Rides big tech momentum.' },
            { id: 'SS2', name: 'Chip-Sector', allocation: 35, pnl: 0, winRate: 0.65, confidence: 75, active: true, description: 'NVDA/AMD/TSM sector rotation.' },
            { id: 'SS3', name: 'Mean-Revert', allocation: 20, pnl: 0, winRate: 0.78, confidence: 85, active: true, description: 'Overbought/oversold reversals.' }
        ]
    },
    {
        id: 'STOCKS_MEME',
        name: 'Meme Stock Hunter',
        description: 'Rides retail-driven momentum on high-volatility names (GME, AMC, BBBY).',
        riskProfile: 'EXTREME',
        assetTypes: [AssetType.STOCKS],
        strategies: [
            { id: 'SM1', name: 'Gamma-Squeeze', allocation: 60, pnl: 0, winRate: 0.45, confidence: 60, active: true, description: 'Options gamma squeeze detection.' },
            { id: 'SM2', name: 'WSB-Sentiment', allocation: 40, pnl: 0, winRate: 0.55, confidence: 65, active: true, description: 'Reddit sentiment analysis.' }
        ]
    },
    {
        id: 'FUTURES_GRID',
        name: 'Futures Grid Master',
        description: 'Multi-layer grid trading for perpetual futures with dynamic TP/SL.',
        riskProfile: 'MED',
        assetTypes: [AssetType.FUTURES], // Futures only
        strategies: [
            { id: 'FG1', name: 'BB-Grid Long', allocation: 40, pnl: 0, winRate: 0.72, confidence: 82, active: true, description: 'Long grid entries at Bollinger lower band.' },
            { id: 'FG2', name: 'BB-Grid Short', allocation: 40, pnl: 0, winRate: 0.68, confidence: 78, active: true, description: 'Short grid entries at Bollinger upper band.' },
            { id: 'FG3', name: 'Funding Hedge', allocation: 20, pnl: 0, winRate: 0.88, confidence: 92, active: true, description: 'Captures funding rate arbitrage.' }
        ]
    },
    {
        id: 'FUTURES_PERP',
        name: 'Perpetual Momentum',
        description: 'High-leverage momentum trading on BTC/ETH perpetuals.',
        riskProfile: 'HIGH',
        assetTypes: [AssetType.FUTURES], // Crypto futures
        strategies: [
            { id: 'FP1', name: 'Perp-Breakout', allocation: 50, pnl: 0, winRate: 0.58, confidence: 70, active: true, description: 'Catches strong directional moves with 5-10x leverage.' },
            { id: 'FP2', name: 'Liquidation-Hunter', allocation: 30, pnl: 0, winRate: 0.75, confidence: 85, active: true, description: 'Front-runs liquidation cascades.' },
            { id: 'FP3', name: 'Funding-Sniper', allocation: 20, pnl: 0, winRate: 0.82, confidence: 88, active: true, description: 'Enters positions before funding rate resets.' }
        ]
    },
    {
        id: 'FUTURES_ES',
        name: 'Index Futures (ES/NQ)',
        description: 'Traditional futures on S&P 500 and Nasdaq indices.',
        riskProfile: 'MED',
        assetTypes: [AssetType.FUTURES], // Index futures
        strategies: [
            { id: 'FE1', name: 'ES-DayTrader', allocation: 45, pnl: 0, winRate: 0.65, confidence: 75, active: true, description: 'Intraday mean reversion on ES futures.' },
            { id: 'FE2', name: 'NQ-Breakout', allocation: 35, pnl: 0, winRate: 0.60, confidence: 72, active: true, description: 'Tech momentum on Nasdaq futures.' },
            { id: 'FE3', name: 'Spread-Arb', allocation: 20, pnl: 0, winRate: 0.85, confidence: 90, active: true, description: 'ES/NQ spread arbitrage.' }
        ]
    },
    {
        id: 'FUTURES_COMMODITIES',
        name: 'Commodity Futures',
        description: 'Energy and metal futures (CL, GC) with macro trend following.',
        riskProfile: 'MED',
        assetTypes: [AssetType.FUTURES], // Commodity futures
        strategies: [
            { id: 'FC1', name: 'Oil-Trend', allocation: 40, pnl: 0, winRate: 0.70, confidence: 80, active: true, description: 'Crude oil (CL) trend following.' },
            { id: 'FC2', name: 'Gold-Safe', allocation: 35, pnl: 0, winRate: 0.68, confidence: 78, active: true, description: 'Gold (GC) safe haven momentum.' },
            { id: 'FC3', name: 'Macro-Hedge', allocation: 25, pnl: 0, winRate: 0.80, confidence: 85, active: true, description: 'Multi-commodity basket hedging.' }
        ]
    }
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
