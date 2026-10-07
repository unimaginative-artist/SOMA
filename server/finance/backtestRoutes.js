/**
 * Backtesting API Routes
 * Run and manage strategy backtests
 */

import express from 'express';
import { BacktestEngine, SMAStrategy, RSIStrategy, MomentumStrategy } from './BacktestEngine.js';
import marketDataService from './marketDataService.js';

function normalizeTimeframe(t) {
    const s = String(t || '1h').toLowerCase();
    if (s === '1m' || s === '1min') return '1Min';
    if (s === '5m' || s === '5min') return '5Min';
    if (s === '15m' || s === '15min') return '15Min';
    if (s === '1h' || s === '1hour') return '1H';
    if (s === '1d' || s === '1day') return '1D';
    return '1H'; // Default to 1H
}

const router = express.Router();

// Active backtest sessions
const backtestSessions = new Map();

// Built-in strategies registry
const STRATEGIES = {
    sma_crossover: {
        name: 'SMA Crossover',
        description: 'Simple Moving Average crossover strategy',
        params: ['shortPeriod', 'longPeriod'],
        defaults: { shortPeriod: 10, longPeriod: 20 },
        factory: (params) => SMAStrategy(params.shortPeriod, params.longPeriod)
    },
    rsi_reversal: {
        name: 'RSI Mean Reversion',
        description: 'Buy oversold, sell overbought based on RSI',
        params: ['period', 'oversold', 'overbought'],
        defaults: { period: 14, oversold: 30, overbought: 70 },
        factory: (params) => RSIStrategy(params.period, params.oversold, params.overbought)
    },
    momentum_breakout: {
        name: 'Momentum Breakout',
        description: 'Trade breakouts of recent highs/lows',
        params: ['lookback', 'threshold'],
        defaults: { lookback: 20, threshold: 0.02 },
        factory: (params) => MomentumStrategy(params.lookback, params.threshold)
    }
};

/**
 * GET /api/backtest/strategies
 * List available built-in strategies
 */
router.get('/strategies', (req, res) => {
    res.json({
        success: true,
        strategies: Object.entries(STRATEGIES).map(([id, s]) => ({
            id,
            name: s.name,
            description: s.description,
            params: s.params,
            defaults: s.defaults
        }))
    });
});

/**
 * POST /api/backtest/run
 * Run a backtest with specified parameters
 */
router.post('/run', async (req, res) => {
    try {
        const {
            symbol,
            strategy,
            strategyParams = {},
            interval = '1h',
            startTime,
            endTime,
            initialCapital = 10000,
            feeRate = 0.001,
            maxPositionSize = 0.1
        } = req.body;

        if (!symbol) {
            return res.status(400).json({ success: false, error: 'Symbol required' });
        }

        if (!strategy || !STRATEGIES[strategy]) {
            return res.status(400).json({
                success: false,
                error: `Invalid strategy. Available: ${Object.keys(STRATEGIES).join(', ')}`
            });
        }

        // Create session
        const sessionId = `bt_${Date.now()}`;

        // Fetch historical data using SOMA MarketDataService (handles routing and fallbacks)
        console.log(`[Backtest] Fetching data for ${symbol} (${interval})...`);

        let candles;
        try {
            const rawBars = await marketDataService.getBars(symbol.toUpperCase(), normalizeTimeframe(interval), 1000);
            if (!rawBars || rawBars.length === 0) {
                throw new Error('No candle data returned from MarketDataService');
            }
            // Add openTime alias for backtesting filter checks
            candles = rawBars.map(bar => ({
                ...bar,
                openTime: bar.timestamp
            }));
        } catch (e) {
            console.error(`[Backtest] Data fetch failed for ${symbol}:`, e.message);
            throw new Error(`Backtest Failed: Could not retrieve real historical data for ${symbol}. Reason: ${e.message}`);
        }

        // Filter by time range if specified
        if (startTime) {
            candles = candles.filter(c => c.openTime >= startTime);
        }
        if (endTime) {
            candles = candles.filter(c => c.openTime <= endTime);
        }

        // Create engine
        const engine = new BacktestEngine({
            initialCapital,
            feeRate,
            maxPositionSize
        });

        // Build strategy with merged params
        const finalParams = { ...STRATEGIES[strategy].defaults, ...strategyParams };
        const strategyFn = STRATEGIES[strategy].factory(finalParams);

        // Store session
        backtestSessions.set(sessionId, {
            id: sessionId,
            symbol,
            strategy,
            strategyParams: finalParams,
            status: 'running',
            engine,
            startedAt: new Date(),
            progress: 0
        });

        // Run backtest asynchronously
        engine.on('progress', (data) => {
            const session = backtestSessions.get(sessionId);
            if (session) {
                session.progress = data.percent;
            }
        });

        runBacktestAsync(sessionId, engine, candles, strategyFn, symbol);

        res.json({
            success: true,
            sessionId,
            message: 'Backtest started',
            totalCandles: candles.length
        });

    } catch (error) {
        console.error('[Backtest] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Run backtest in background
 */
async function runBacktestAsync(sessionId, engine, candles, strategy, symbol) {
    try {
        const result = await engine.runBacktest(candles, strategy, { symbol });

        const session = backtestSessions.get(sessionId);
        if (session) {
            session.status = result.success ? 'completed' : 'failed';
            session.result = result;
            session.completedAt = new Date();
        }
    } catch (error) {
        const session = backtestSessions.get(sessionId);
        if (session) {
            session.status = 'failed';
            session.error = error.message;
        }
    }
}

/**
 * GET /api/backtest/:sessionId
 * Get backtest session status and results
 */
router.get('/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = backtestSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    res.json({
        success: true,
        session: {
            id: session.id,
            symbol: session.symbol,
            strategy: session.strategy,
            strategyParams: session.strategyParams,
            status: session.status,
            progress: session.progress,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            metrics: session.result?.metrics || null,
            trades: session.result?.trades?.length || 0,
            error: session.error || null
        }
    });
});

/**
 * GET /api/backtest/:sessionId/trades
 * Get trade list from backtest
 */
router.get('/:sessionId/trades', (req, res) => {
    const { sessionId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const session = backtestSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (!session.result?.trades) {
        return res.json({ success: true, trades: [], total: 0 });
    }

    const trades = session.result.trades
        .slice(parseInt(offset), parseInt(offset) + parseInt(limit))
        .map(t => ({
            id: t.id,
            side: t.side,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            size: t.size,
            pnl: t.pnl,
            fees: t.fees,
            exitReason: t.exitReason
        }));

    res.json({
        success: true,
        trades,
        total: session.result.trades.length
    });
});

/**
 * GET /api/backtest/:sessionId/equity
 * Get equity curve data
 */
router.get('/:sessionId/equity', (req, res) => {
    const { sessionId } = req.params;
    const { downsample = 100 } = req.query;

    const session = backtestSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (!session.result?.equity) {
        return res.json({ success: true, equity: [] });
    }

    // Downsample for large datasets
    let equity = session.result.equity;
    const step = Math.max(1, Math.floor(equity.length / parseInt(downsample)));
    equity = equity.filter((_, i) => i % step === 0);

    res.json({
        success: true,
        equity
    });
});

/**
 * POST /api/backtest/:sessionId/stop
 * Stop a running backtest
 */
router.post('/:sessionId/stop', (req, res) => {
    const { sessionId } = req.params;
    const session = backtestSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (session.engine) {
        session.engine.stop();
    }
    session.status = 'stopped';

    res.json({ success: true, message: 'Backtest stopped' });
});

/**
 * GET /api/backtest/sessions
 * List all backtest sessions
 */
router.get('/', (req, res) => {
    const sessions = Array.from(backtestSessions.values()).map(s => ({
        id: s.id,
        symbol: s.symbol,
        strategy: s.strategy,
        status: s.status,
        progress: s.progress,
        startedAt: s.startedAt,
        completedAt: s.completedAt
    }));

    res.json({ success: true, sessions });
});

/**
 * DELETE /api/backtest/:sessionId
 * Delete a backtest session
 */
router.delete('/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    if (backtestSessions.has(sessionId)) {
        backtestSessions.delete(sessionId);
        res.json({ success: true, message: 'Session deleted' });
    } else {
        res.status(404).json({ success: false, error: 'Session not found' });
    }
});

export default router;
