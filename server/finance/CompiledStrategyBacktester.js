import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import paperExecutionSimulator from './PaperExecutionSimulator.js';
import { evaluateScalpingSignal } from './ScalpingSignal.js';
import { barTimestampMs } from './TradingDataFreshness.js';
import { regimeAllowed, TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'data', 'trading', 'historical-cache');
const REPORT_PATH = path.join(ROOT, 'data', 'trading', 'compiled-backtest-report.json');

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(value = '') {
    return String(value || '').trim().toUpperCase();
}

function timeframeToMs(value = '1H') {
    const normalized = String(value || '1H').trim().toUpperCase();
    const match = normalized.match(/^(\d+)(MIN|H|D)$/);
    if (!match) return 60 * 60 * 1000;
    const amount = Math.max(1, Number(match[1]));
    const unit = match[2] === 'MIN' ? 60 * 1000 : match[2] === 'D' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    return amount * unit;
}

function historicalName(symbol, timeframe) {
    return `${normalizeSymbol(symbol).replace(/\//g, '-')}_${timeframe}.json`;
}

function symbolAliases(symbol) {
    const normalized = normalizeSymbol(symbol);
    const aliases = new Set([normalized]);
    if (['BTC', 'ETH', 'SOL', 'LTC', 'LINK', 'AVAX'].includes(normalized)) aliases.add(`${normalized}-USD`);
    if (normalized.endsWith('-USD')) aliases.add(normalized.replace(/-USD$/i, ''));
    return Array.from(aliases);
}

function sma(values, end, window) {
    if (end < window) return null;
    let sum = 0;
    for (let i = end - window; i < end; i++) sum += finite(values[i]?.close, NaN);
    return Number.isFinite(sum) ? sum / window : null;
}

function standardDeviation(values, end, window, mean) {
    if (end < window || !Number.isFinite(mean)) return null;
    let sum = 0;
    for (let i = end - window; i < end; i++) {
        const close = finite(values[i]?.close, NaN);
        if (!Number.isFinite(close)) return null;
        sum += Math.pow(close - mean, 2);
    }
    return Math.sqrt(sum / window);
}

function rsi(values, end, window) {
    if (end < window) return null;
    let gains = 0;
    let losses = 0;
    for (let i = end - window + 1; i <= end; i++) {
        const change = finite(values[i]?.close, NaN) - finite(values[i - 1]?.close, NaN);
        if (!Number.isFinite(change)) return null;
        if (change > 0) gains += change;
        else losses -= change;
    }
    if (losses === 0) return gains > 0 ? 100 : 50;
    const relativeStrength = gains / losses;
    return 100 - (100 / (1 + relativeStrength));
}

function channelAndVolume(values, end, window) {
    if (end < window) return null;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let i = end - window; i < end; i++) {
        high = Math.max(high, finite(values[i]?.high, NaN));
        low = Math.min(low, finite(values[i]?.low, NaN));
        volume += Math.max(0, finite(values[i]?.volume, 0));
    }
    return Number.isFinite(high) && Number.isFinite(low)
        ? { high, low, averageVolume: volume / window }
        : null;
}

function averageRangePct(bars, end, window) {
    if (end < window) return 0;
    let sum = 0;
    let count = 0;
    for (let i = end - window; i < end; i++) {
        const close = finite(bars[i]?.close, 0);
        if (close <= 0) continue;
        sum += (finite(bars[i]?.high, close) - finite(bars[i]?.low, close)) / close;
        count++;
    }
    return count ? sum / count : 0;
}

function classifyBacktestRegime(momentum, rangePct) {
    if (rangePct >= 0.025) return 'VOLATILE';
    if (Math.abs(momentum) < 0.003) return 'RANGING';
    return momentum > 0 ? 'TRENDING_BULL' : 'TRENDING_BEAR';
}

function summarizeTrades(trades, initialCapital) {
    const wins = trades.filter(trade => trade.pnl > 0);
    const losses = trades.filter(trade => trade.pnl <= 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
    const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
    let equity = initialCapital;
    let peak = initialCapital;
    let maxDrawdown = 0;
    for (const trade of trades) {
        equity += trade.pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    }
    const segments = {};
    for (const trade of trades) {
        const key = `${trade.symbol || 'UNKNOWN'}:${trade.side}:${trade.timeframe || 'UNKNOWN'}:${trade.entryRegime || 'UNKNOWN'}`;
        const segment = segments[key] || { key, symbol: trade.symbol || null, side: trade.side, timeframe: trade.timeframe || null, regime: trade.entryRegime || null, trades: 0, wins: 0, totalPnl: 0, grossProfit: 0, grossLoss: 0 };
        segment.trades++;
        segment.totalPnl += trade.pnl;
        if (trade.pnl > 0) { segment.wins++; segment.grossProfit += trade.pnl; }
        else segment.grossLoss += Math.abs(trade.pnl);
        segments[key] = segment;
    }
    const segmentRows = Object.values(segments).map(segment => ({
        ...segment,
        totalPnl: Number(segment.totalPnl.toFixed(4)),
        winRate: segment.trades ? Number((100 * segment.wins / segment.trades).toFixed(2)) : 0,
        profitFactor: segment.grossLoss > 0 ? Number((segment.grossProfit / segment.grossLoss).toFixed(3)) : (segment.grossProfit > 0 ? Infinity : 0)
    }));
    return {
        trades: trades.length,
        wins: wins.length,
        losses: losses.length,
        totalPnl: Number(totalPnl.toFixed(2)),
        pnlPct: Number(((totalPnl / Math.max(1, initialCapital)) * 100).toFixed(3)),
        winRate: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
        profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : (grossProfit > 0 ? Infinity : 0),
        avgPnl: trades.length ? Number((totalPnl / trades.length).toFixed(4)) : 0,
        maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
        tradeReturns: trades.map(trade => Number(trade.netReturn ?? 0)),
        segments: segmentRows
    };
}

export function evaluateCompiledStrategyDecision({ bars = [], candidate, position = null } = {}) {
    const dsl = candidate?.compiledStrategy?.dsl || {};
    const entry = dsl.entry || {};
    const exit = dsl.exit || {};
    if (entry.mode === 'scalping_confluence') {
        const signal = evaluateScalpingSignal(bars.slice(0, -1), { entry, position });
        return { ...signal, source: 'compiled_strategy', metadata: { ...signal.metadata,
            mode: entry.mode, signalBar: bars.at(-2)?.timestamp, executionBar: bars.at(-1)?.timestamp } };
    }
    const strategyId = String(candidate?.strategyId || candidate?.compiledStrategy?.strategyId || '');
    const mode = entry.mode || (/full_aggression|vortex/.test(strategyId)
        ? 'breakout'
        : /boring_algo|daviddtech_keltner/.test(strategyId)
            ? 'rsi_reversion'
            : /micro_scalper|micro_compounder|yield_harvester/.test(strategyId)
                ? 'mean_reversion'
                : 'trend');
    const fastWindow = Math.max(3, Math.round(finite(entry.fastWindow, 12)));
    const slowWindow = Math.max(fastWindow + 4, Math.round(finite(entry.slowWindow, 34)));
    const breakoutWindow = Math.max(6, Math.round(finite(entry.breakoutWindow, 24)));
    const rsiPeriod = Math.max(4, Math.round(finite(entry.rsiPeriod, 14)));
    const warmup = Math.max(slowWindow, breakoutWindow, rsiPeriod + 1);
    if (!candidate || bars.length < warmup + 2) {
        return { action: 'HOLD', confidence: 0, reason: 'Compiled strategy needs more completed bars', source: 'compiled_strategy' };
    }

    const executionIndex = bars.length - 1;
    const signalIndex = executionIndex - 1;
    const signalPrice = finite(bars[signalIndex]?.close, 0);
    const fast = sma(bars, signalIndex, fastWindow);
    const slow = sma(bars, signalIndex, slowWindow);
    if (!(signalPrice > 0) || !(fast > 0) || !(slow > 0)) {
        return { action: 'HOLD', confidence: 0, reason: 'Compiled indicators unavailable', source: 'compiled_strategy' };
    }
    const momentum = (fast - slow) / slow;
    const deviation = standardDeviation(bars, signalIndex, slowWindow, slow);
    const zScore = deviation > 0 ? (signalPrice - slow) / deviation : 0;
    const rsiValue = rsi(bars, signalIndex, rsiPeriod);
    const channel = channelAndVolume(bars, signalIndex, breakoutWindow);
    const volumeRatio = channel?.averageVolume > 0
        ? finite(bars[signalIndex]?.volume, 0) / channel.averageVolume
        : 0;
    const rangePct = averageRangePct(bars, signalIndex, 12);
    const context = bars[signalIndex]?.context || {};
    const relativeMomentum = finite(context.relativeMomentum, 0);
    const marketMomentum = finite(context.marketMomentum, 0);
    const marketBreadth = finite(context.marketBreadth, 0.5);
    const fundingRate = finite(context.fundingRate, 0);
    const hasFunding = Boolean(context.fundingSource);
    const orderBookImbalance = finite(context.orderBookImbalance ?? bars[signalIndex]?.orderBookImbalance, 0);
    const observedSpreadBps = finite(context.spreadBps ?? bars[signalIndex]?.spreadBps, Infinity);
    const metadata = {
        mode, signalBar: bars[signalIndex]?.timestamp ?? bars[signalIndex]?.time ?? null,
        executionBar: bars[executionIndex]?.timestamp ?? bars[executionIndex]?.time ?? null,
        signalPrice, fast, slow, momentum, zScore, rsi: rsiValue, volumeRatio,
        channelHigh: channel?.high ?? null, channelLow: channel?.low ?? null, rangePct,
        relativeMomentum, marketMomentum, marketBreadth, fundingRate, hasFunding,
        orderBookImbalance, observedSpreadBps
    };

    if (position) {
        const side = position.side === 'short' ? -1 : 1;
        const exitMomentum = finite(exit.exitMomentum, -0.0005);
        const exitZ = finite(exit.exitZ, 0);
        const shouldExit = ['mean_reversion', 'range_reversion'].includes(mode)
            ? (side === 1 ? zScore >= exitZ : zScore <= -exitZ)
            : mode === 'rsi_reversion'
                ? (side === 1 ? rsiValue >= 50 : rsiValue <= 50)
                : mode === 'breakout'
                    ? (side === 1 ? signalPrice < slow : signalPrice > slow)
                    : (side === 1 ? momentum < exitMomentum : momentum > -exitMomentum);
        return shouldExit
            ? {
                action: side === 1 ? 'SELL' : 'BUY', confidence: 0.95, closeOnly: true,
                reason: `Compiled ${mode} exit on completed bar`, source: 'compiled_strategy', metadata
            }
            : { action: 'HOLD', confidence: 0.95, reason: `Compiled ${mode} position remains valid`, source: 'compiled_strategy', metadata };
    }

    const direction = ['long_only', 'short_only', 'long_or_short'].includes(entry.direction)
        ? entry.direction
        : 'long_only';
    const minMomentum = Math.max(0, finite(entry.minMomentum, 0.0025));
    const entryZ = Math.max(0.25, finite(entry.entryZ, 1.5));
    const buffer = Math.max(0, finite(entry.breakoutBufferPct, 0.001));
    const minVolumeRatio = Math.max(0, finite(entry.minVolumeRatio, 1));
    const oversold = Math.max(5, Math.min(48, finite(entry.rsiOversold, 30)));
    const overbought = Math.min(95, Math.max(52, finite(entry.rsiOverbought, 70)));
    const minVolatilityPct = Math.max(0, finite(entry.minVolatilityPct, 0.008));
    const confirmationCount = Math.max(2, Math.min(4, Math.round(finite(entry.confirmationCount, 2))));
    const breadthThreshold = finite(entry.breadthThreshold, 0.65);
    const maxFundingRate = finite(entry.maxFundingRate, 0.0003);
    const minOrderBookImbalance = finite(entry.minOrderBookImbalance, 0.15);
    const maxSpreadBps = finite(entry.maxSpreadBps, 30);
    const breakoutLong = channel && signalPrice > channel.high * (1 + buffer) && volumeRatio >= minVolumeRatio;
    const breakoutShort = channel && signalPrice < channel.low * (1 - buffer) && volumeRatio >= minVolumeRatio;
    const longVotes = [momentum > minMomentum, breakoutLong, volumeRatio >= minVolumeRatio && momentum > 0, rsiValue < 45];
    const shortVotes = [momentum < -minMomentum, breakoutShort, volumeRatio >= minVolumeRatio && momentum < 0, rsiValue > 55];
    const longSignal = direction !== 'short_only' && (mode === 'mean_reversion'
        ? zScore <= -entryZ
        : mode === 'range_reversion'
            ? zScore <= -entryZ && rsiValue <= oversold
        : mode === 'rsi_reversion'
            ? rsiValue <= oversold
        : mode === 'breakout'
                ? breakoutLong
        : mode === 'volume_momentum'
            ? momentum > minMomentum && volumeRatio >= minVolumeRatio
        : mode === 'volatility_breakout'
            ? breakoutLong && rangePct >= minVolatilityPct
        : mode === 'trend_pullback'
            ? momentum > minMomentum && zScore < 0 && zScore >= -entryZ
        : mode === 'ensemble'
            ? longVotes.filter(Boolean).length >= confirmationCount
        : mode === 'cross_asset_momentum'
            ? relativeMomentum > minMomentum && momentum > 0
        : mode === 'market_breadth'
            ? marketBreadth >= breadthThreshold && marketMomentum > 0 && momentum > 0
        : mode === 'carry_trend'
            ? hasFunding && fundingRate <= maxFundingRate && momentum > minMomentum
        : mode === 'microstructure_momentum'
            ? orderBookImbalance >= minOrderBookImbalance && observedSpreadBps <= maxSpreadBps && momentum > 0
        : mode === 'slow_trend'
            ? momentum > minMomentum && marketMomentum > 0 && rangePct < minVolatilityPct * 2
                : momentum > minMomentum);
    const shortSignal = direction !== 'long_only' && (mode === 'mean_reversion'
        ? zScore >= entryZ
        : mode === 'range_reversion'
            ? zScore >= entryZ && rsiValue >= overbought
        : mode === 'rsi_reversion'
            ? rsiValue >= overbought
        : mode === 'breakout'
                ? breakoutShort
        : mode === 'volume_momentum'
            ? momentum < -minMomentum && volumeRatio >= minVolumeRatio
        : mode === 'volatility_breakout'
            ? breakoutShort && rangePct >= minVolatilityPct
        : mode === 'trend_pullback'
            ? momentum < -minMomentum && zScore > 0 && zScore <= entryZ
        : mode === 'ensemble'
            ? shortVotes.filter(Boolean).length >= confirmationCount
        : ['cross_asset_momentum', 'market_breadth', 'carry_trend', 'microstructure_momentum', 'slow_trend'].includes(mode)
            ? false
                : momentum < -minMomentum);
    const action = longSignal ? 'BUY' : shortSignal ? 'SELL' : 'HOLD';
    return {
        action,
        confidence: action === 'HOLD' ? 0.95 : 0.95,
        reason: action === 'HOLD' ? `No compiled ${mode} entry` : `Compiled ${mode} ${action.toLowerCase()} entry on completed bar`,
        recommendation: action,
        source: 'compiled_strategy',
        metadata
    };
}

export function backtestBars({ bars, candidate, initialCapital = 10000, tradeStartIndex = 0, includeTrades = false }) {
    const dsl = candidate.compiledStrategy?.dsl || {};
    const entry = dsl.entry || {};
    const exit = dsl.exit || {};
    const sizing = dsl.sizing || {};
    const execution = dsl.execution || {};
    const stopLossPct = finite(exit.stopLossPct, 0.018);
    const takeProfitPct = finite(exit.takeProfitPct, 0.045);
    const trailingStopPct = finite(exit.trailingStopPct, 0.014);
    const maxPositionAgeMs = Math.max(0, finite(exit.maxPositionAgeMs, 24 * 60 * 60 * 1000));
    const timeframeMs = timeframeToMs(dsl.execution?.timeframe || '1H');
    const maxHoldBars = Math.max(1, Math.round(maxPositionAgeMs / timeframeMs));
    const maxPositionPct = finite(sizing.maxPositionPct, 0.03);
    const maxTradeValue = finite(sizing.maxPaperTradeValue, 1000);
    const executionStyle = execution.style === 'maker_limit' ? 'maker_limit' : 'taker_market';
    const timeframe = execution.timeframe || '1H';
    const allowedRegimes = Array.isArray(entry.allowedRegimes) ? entry.allowedRegimes : ['ALL'];
    const makerOffsetBps = Math.max(1, finite(execution.makerOffsetBps, 3));
    const aggressive = String(candidate.strategyId || '').includes('aggression');
    const fastWindow = Math.max(3, Math.round(finite(entry.fastWindow, aggressive ? 8 : 12)));
    const slowWindow = Math.max(fastWindow + 4, Math.round(finite(entry.slowWindow, aggressive ? 24 : 34)));
    const minMomentum = Math.max(0, finite(entry.minMomentum, aggressive ? 0.0015 : 0.0025));
    const exitMomentum = finite(exit.exitMomentum, -0.0005);
    const strategyId = String(candidate.strategyId || '');
    const inferredMode = /full_aggression|vortex/.test(strategyId)
        ? 'breakout'
        : /boring_algo|daviddtech_keltner/.test(strategyId)
            ? 'rsi_reversion'
            : /micro_scalper|micro_compounder|yield_harvester/.test(strategyId)
                ? 'mean_reversion'
                : 'trend';
    const signalMode = entry.mode || inferredMode;
    const entryZ = Math.max(0.25, finite(entry.entryZ, 1.5));
    const exitZ = finite(exit.exitZ, 0);
    const breakoutWindow = Math.max(6, Math.round(finite(entry.breakoutWindow, 24)));
    const breakoutBufferPct = Math.max(0, finite(entry.breakoutBufferPct, 0.001));
    const minVolumeRatio = Math.max(0, finite(entry.minVolumeRatio, 1));
    const rsiPeriod = Math.max(4, Math.round(finite(entry.rsiPeriod, 14)));
    const rsiOversold = Math.max(5, Math.min(48, finite(entry.rsiOversold, 30)));
    const rsiOverbought = Math.min(95, Math.max(52, finite(entry.rsiOverbought, 70)));
    const minVolatilityPct = Math.max(0, finite(entry.minVolatilityPct, 0.008));
    const confirmationCount = Math.max(2, Math.min(4, Math.round(finite(entry.confirmationCount, 2))));
    const direction = ['long_only', 'short_only', 'long_or_short'].includes(entry.direction)
        ? entry.direction
        : 'long_only';
    const longEnabled = direction !== 'short_only';
    const shortEnabled = direction !== 'long_only';
    const indicatorWarmup = Math.max(slowWindow, breakoutWindow, rsiPeriod + 1);
    const firstTradeIndex = Math.max(indicatorWarmup, Math.round(finite(tradeStartIndex, 0)));

    let cash = initialCapital;
    let position = null;
    const trades = [];
    let missedLimitFills = 0;

    // Signals are formed only from a completed bar and executed at the next
    // bar's open. Filling at the signal bar's close would grant the backtest a
    // price that is not actionable until after that candle has finished.
    for (let i = indicatorWarmup + 1; i < bars.length; i++) {
        const signalIndex = i - 1;
        const signalPrice = finite(bars[signalIndex]?.close, 0);
        const price = finite(bars[i]?.open, finite(bars[i]?.close, 0));
        if (price <= 0 || signalPrice <= 0) continue;
        const fast = sma(bars, signalIndex, fastWindow);
        const slow = sma(bars, signalIndex, slowWindow);
        if (!fast || !slow || slow <= 0) continue;
        const momentum = (fast - slow) / slow;
        const deviation = standardDeviation(bars, signalIndex, slowWindow, slow);
        const zScore = deviation > 0 ? (signalPrice - slow) / deviation : 0;
        const rsiValue = rsi(bars, signalIndex, rsiPeriod);
        const channel = channelAndVolume(bars, signalIndex, breakoutWindow);
        const volumeRatio = channel?.averageVolume > 0
            ? finite(bars[signalIndex]?.volume, 0) / channel.averageVolume
            : 0;
        const rangePct = averageRangePct(bars, signalIndex, 12);
        const context = bars[signalIndex]?.context || {};
        const relativeMomentum = finite(context.relativeMomentum, 0);
        const marketMomentum = finite(context.marketMomentum, 0);
        const marketBreadth = finite(context.marketBreadth, 0.5);
        const fundingRate = finite(context.fundingRate, 0);
        const hasFunding = Boolean(context.fundingSource);
        const orderBookImbalance = finite(context.orderBookImbalance ?? bars[signalIndex]?.orderBookImbalance, 0);
        const observedSpreadBps = finite(context.spreadBps ?? bars[signalIndex]?.spreadBps, Infinity);
        const entryRegime = classifyBacktestRegime(momentum, rangePct);

        if (position) {
            const side = position.side === 'short' ? -1 : 1;
            position.favorableExtreme = side === 1
                ? Math.max(position.favorableExtreme, price)
                : Math.min(position.favorableExtreme, price);
            const pnlPct = side * (price - position.entryPrice) / position.entryPrice;
            const trailPct = side === 1
                ? (price - position.favorableExtreme) / position.favorableExtreme
                : (position.favorableExtreme - price) / position.favorableExtreme;
            const signalExit = signalMode === 'scalping_confluence'
                ? evaluateScalpingSignal(bars.slice(0, i), { entry, position }).action === 'SELL'
                : ['mean_reversion', 'range_reversion'].includes(signalMode)
                ? (side === 1 ? zScore >= exitZ : zScore <= -exitZ)
                : signalMode === 'rsi_reversion'
                    ? (side === 1 ? rsiValue >= 50 : rsiValue <= 50)
                    : signalMode === 'breakout'
                        ? (side === 1 ? signalPrice < slow : signalPrice > slow)
                        : (side === 1 ? momentum < exitMomentum : momentum > -exitMomentum);
            const exitReason =
                pnlPct >= takeProfitPct ? 'take_profit' :
                pnlPct <= -stopLossPct ? 'stop_loss' :
                trailPct <= -trailingStopPct ? 'trailing_stop' :
                (candidate.ecosystemLane && barTimestampMs(bars[i]) > 0 && barTimestampMs({ timestamp: position.entryTime }) > 0
                    ? barTimestampMs(bars[i]) - barTimestampMs({ timestamp: position.entryTime }) >= maxPositionAgeMs
                    : i - position.entryIndex >= maxHoldBars) ? 'time_exit' :
                signalExit ? 'signal_exit' :
                null;

            if (exitReason) {
                // Exit pays the same per-side friction the paper engine charges
                const exitCost = paperExecutionSimulator.estimateCostPct({
                    referencePrice: price, qty: position.qty, bars: bars.slice(Math.max(0, i - 30), i)
                });
                const exitFee = position.qty * price * exitCost.perSidePct;
                const pnl = side === 1
                    ? (position.qty * price - exitFee) - position.cost
                    : position.qty * (position.entryPrice - price) - position.entryFee - exitFee;
                cash += side === 1 ? position.cost + pnl : position.collateral + pnl;
                trades.push({
                    side: position.side,
                    qty: position.qty,
                    entryNotional: position.collateral,
                    entryTime: position.entryTime,
                    exitTime: bars[i].timestamp || null,
                    entryPrice: position.entryPrice,
                    exitPrice: price,
                    pnl: Number(pnl.toFixed(4)),
                    pnlPct: Number(((pnl / Math.max(1e-9, position.collateral)) * 100).toFixed(3)),
                    netReturn: pnl / Math.max(1e-9, position.collateral),
                    symbol: candidate.symbol,
                    timeframe,
                    entryRegime: position.entryRegime,
                    executionStyle: position.executionStyle,
                    entryFee: position.entryFee,
                    exitFee,
                    exitReason
                });
                position = null;
            }
            continue;
        }

        const volatilityOk = !dsl.signalSet?.includes('volatility_guard') || rangePct < 0.035;
        const breakoutLong = channel && signalPrice > channel.high * (1 + breakoutBufferPct) && volumeRatio >= minVolumeRatio;
        const breakoutShort = channel && signalPrice < channel.low * (1 - breakoutBufferPct) && volumeRatio >= minVolumeRatio;
        const longVotes = [momentum > minMomentum, breakoutLong, volumeRatio >= minVolumeRatio && momentum > 0, rsiValue < 45];
        const shortVotes = [momentum < -minMomentum, breakoutShort, volumeRatio >= minVolumeRatio && momentum < 0, rsiValue > 55];
        const breadthThreshold = finite(entry.breadthThreshold, 0.65);
        const maxFundingRate = finite(entry.maxFundingRate, 0.0003);
        const minOrderBookImbalance = finite(entry.minOrderBookImbalance, 0.15);
        const maxSpreadBps = finite(entry.maxSpreadBps, 30);
        const longSignal = longEnabled && (signalMode === 'scalping_confluence'
            ? evaluateScalpingSignal(bars.slice(0, i), { entry }).action === 'BUY'
            : signalMode === 'mean_reversion'
            ? zScore <= -entryZ
            : signalMode === 'range_reversion'
                ? zScore <= -entryZ && rsiValue <= rsiOversold
            : signalMode === 'rsi_reversion'
                ? rsiValue <= rsiOversold
            : signalMode === 'breakout'
                ? breakoutLong
            : signalMode === 'volume_momentum'
                ? momentum > minMomentum && volumeRatio >= minVolumeRatio
            : signalMode === 'volatility_breakout'
                ? breakoutLong && rangePct >= minVolatilityPct
            : signalMode === 'trend_pullback'
                ? momentum > minMomentum && zScore < 0 && zScore >= -entryZ
            : signalMode === 'ensemble'
                ? longVotes.filter(Boolean).length >= confirmationCount
            : signalMode === 'cross_asset_momentum'
                ? relativeMomentum > minMomentum && momentum > 0
            : signalMode === 'market_breadth'
                ? marketBreadth >= breadthThreshold && marketMomentum > 0 && momentum > 0
            : signalMode === 'carry_trend'
                ? hasFunding && fundingRate <= maxFundingRate && momentum > minMomentum
            : signalMode === 'microstructure_momentum'
                ? orderBookImbalance >= minOrderBookImbalance && observedSpreadBps <= maxSpreadBps && momentum > 0
            : signalMode === 'slow_trend'
                ? momentum > minMomentum && marketMomentum > 0 && rangePct < minVolatilityPct * 2
                : momentum > minMomentum);
        const shortSignal = shortEnabled && (signalMode === 'mean_reversion'
            ? zScore >= entryZ
            : signalMode === 'range_reversion'
                ? zScore >= entryZ && rsiValue >= rsiOverbought
            : signalMode === 'rsi_reversion'
                ? rsiValue >= rsiOverbought
            : signalMode === 'breakout'
                ? breakoutShort
            : signalMode === 'volume_momentum'
                ? momentum < -minMomentum && volumeRatio >= minVolumeRatio
            : signalMode === 'volatility_breakout'
                ? breakoutShort && rangePct >= minVolatilityPct
            : signalMode === 'trend_pullback'
                ? momentum < -minMomentum && zScore > 0 && zScore <= entryZ
            : signalMode === 'ensemble'
                ? shortVotes.filter(Boolean).length >= confirmationCount
            : ['cross_asset_momentum', 'market_breadth', 'carry_trend', 'microstructure_momentum', 'slow_trend'].includes(signalMode)
                ? false
                : momentum < -minMomentum);
        const side = longSignal ? 'long' : (shortSignal ? 'short' : null);
        if (i >= firstTradeIndex && side && volatilityOk && regimeAllowed(entryRegime, allowedRegimes) && cash > 10) {
            const spend = Math.min(cash * maxPositionPct, maxTradeValue, cash);
            const recentBars = bars.slice(Math.max(0, i - 30), i);
            let entryPrice = price;
            let entryCost;
            if (executionStyle === 'maker_limit') {
                const limitPrice = side === 'long'
                    ? signalPrice * (1 - makerOffsetBps / 10000)
                    : signalPrice * (1 + makerOffsetBps / 10000);
                const fill = paperExecutionSimulator.simulateFill({
                    symbol: candidate.symbol,
                    side: side === 'long' ? 'buy' : 'sell',
                    qty: spend / Math.max(1e-9, limitPrice),
                    referencePrice: price,
                    bars: recentBars,
                    orderType: 'limit',
                    limitPrice,
                    bar: bars[i],
                    allowPartialFill: false
                });
                if (!fill.accepted) { missedLimitFills++; continue; }
                entryPrice = fill.filledPrice;
                entryCost = paperExecutionSimulator.estimateCostPct({ referencePrice: entryPrice, qty: spend / entryPrice, bars: recentBars, liquidity: 'maker' });
            } else {
                entryCost = paperExecutionSimulator.estimateCostPct({ referencePrice: price, qty: spend / price, bars: recentBars, liquidity: 'taker' });
            }
            const qty = spend / (entryPrice * (1 + entryCost.perSidePct));
            const entryNotional = qty * entryPrice;
            const entryFee = entryNotional * entryCost.perSidePct;
            cash -= spend;
            position = {
                side,
                qty,
                cost: spend,
                collateral: spend,
                entryFee,
                entryPrice,
                favorableExtreme: entryPrice,
                entryTime: bars[i].timestamp || null,
                entryIndex: i,
                entryRegime,
                executionStyle
            };
        }
    }

    if (position) {
        const price = finite(bars[bars.length - 1]?.close, position.entryPrice);
        const exitCost = paperExecutionSimulator.estimateCostPct({
            referencePrice: price, qty: position.qty, bars: bars.slice(-30)
        });
        const side = position.side === 'short' ? -1 : 1;
        const exitFee = position.qty * price * exitCost.perSidePct;
        const pnl = side === 1
            ? (position.qty * price - exitFee) - position.cost
            : position.qty * (position.entryPrice - price) - position.entryFee - exitFee;
        cash += side === 1 ? position.cost + pnl : position.collateral + pnl;
        trades.push({
            side: position.side,
            qty: position.qty,
            entryNotional: position.collateral,
            entryTime: position.entryTime,
            exitTime: bars[bars.length - 1]?.timestamp || null,
            entryPrice: position.entryPrice,
            exitPrice: price,
            pnl: Number(pnl.toFixed(4)),
            pnlPct: Number(((pnl / Math.max(1e-9, position.collateral)) * 100).toFixed(3)),
            netReturn: pnl / Math.max(1e-9, position.collateral),
            symbol: candidate.symbol,
            timeframe,
            entryRegime: position.entryRegime,
            executionStyle: position.executionStyle,
            entryFee: position.entryFee,
            exitFee,
            exitReason: 'end_of_data'
        });
    }

    // Friction check: the profit target must clear the round-trip cost with room
    // to spare, or the strategy's "edge" is just noise inside the cost band.
    const typicalPrice = finite(bars[Math.floor(bars.length / 2)]?.close, finite(bars[0]?.close, 1));
    const typicalSpend = Math.min(initialCapital * maxPositionPct, maxTradeValue);
    const entryFriction = paperExecutionSimulator.estimateCostPct({
        referencePrice: typicalPrice,
        qty: typicalPrice > 0 ? typicalSpend / typicalPrice : 0,
        bars: bars.slice(-60),
        liquidity: executionStyle === 'maker_limit' ? 'maker' : 'taker'
    });
    const exitFriction = paperExecutionSimulator.estimateCostPct({
        referencePrice: typicalPrice,
        qty: typicalPrice > 0 ? typicalSpend / typicalPrice : 0,
        bars: bars.slice(-60),
        liquidity: 'taker'
    });
    const roundTripCostPct = entryFriction.perSidePct + exitFriction.perSidePct;
    const frictionCheck = {
        economicsVersion: TRADING_ECONOMICS_VERSION,
        executionStyle,
        takeProfitPct: Number(takeProfitPct.toFixed(5)),
        roundTripCostPct: Number(roundTripCostPct.toFixed(5)),
        requiredTakeProfitPct: Number((roundTripCostPct * 3).toFixed(5)),
        passed: takeProfitPct >= roundTripCostPct * 3
    };

    return {
        initialCapital,
        finalCapital: Number(cash.toFixed(2)),
        ...summarizeTrades(trades, initialCapital),
        frictionCheck,
        noTradeBaselinePnl: 0,
        excessPnlVsNoTrade: Number((trades.reduce((sum, trade) => sum + trade.pnl, 0)).toFixed(2)),
        missedLimitFills,
        sampleTrades: trades.slice(-5),
        ...(includeTrades ? { tradeLedger: trades } : {})
    };
}

export class CompiledStrategyBacktester {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || CACHE_DIR;
        this.reportPath = options.reportPath || REPORT_PATH;
        this.initialCapital = finite(options.initialCapital, 10000);
        this.requireProvenance = options.requireProvenance === true;
    }

    async loadBars(symbol, timeframe = '5Min') {
        const candidates = symbolAliases(symbol).map(alias => path.join(this.cacheDir, historicalName(alias, timeframe)));
        for (const file of candidates) {
            try {
                const raw = await fs.readFile(file, 'utf8');
                const parsed = JSON.parse(raw);
                const bars = Array.isArray(parsed) ? parsed : parsed?.bars;
                if (Array.isArray(bars) && bars.length) {
                    let provenance = null;
                    try {
                        provenance = JSON.parse(await fs.readFile(`${file}.provenance.json`, 'utf8'));
                        const digest = crypto.createHash('sha256').update(raw).digest('hex');
                        if (provenance.sha256 !== digest) continue;
                    } catch {
                        if (this.requireProvenance) continue;
                    }
                    return {
                        file,
                        bars,
                        symbol: parsed?.symbol || symbol,
                        timeframe: parsed?.timeframe || timeframe,
                        provenance,
                        provenanceVerified: Boolean(provenance)
                    };
                }
            } catch {}
        }
        return null;
    }

    async runCandidates(candidates = [], { limit = 10, timeframe = '5Min' } = {}) {
        const results = [];
        const timeframes = Array.isArray(timeframe)
            ? timeframe
            : Array.from(new Set([timeframe, '1D'].filter(Boolean)));
        for (const candidate of candidates.slice(0, Math.max(1, Number(limit) || 10))) {
            let loaded = null;
            for (const frame of timeframes) {
                loaded = await this.loadBars(candidate.symbol, frame);
                if (loaded?.bars?.length >= 60) break;
            }
            if (!loaded || loaded.bars.length < 60) {
                results.push({
                    key: candidate.key,
                    strategyId: candidate.strategyId,
                    symbol: candidate.symbol,
                    status: 'no_historical_data',
                    timeframe: timeframes.join(',')
                });
                continue;
            }
            // 70/30 walk-forward split: verdict requires the strategy to also make
            // money on data it never saw. Holdout keeps 40 warmup bars for the SMA
            // windows; trades landing in the overlap are a small, acceptable bleed.
            const split = Math.floor(loaded.bars.length * 0.7);
            const backtest = backtestBars({ bars: loaded.bars.slice(0, split), candidate, initialCapital: this.initialCapital });
            const holdout = backtestBars({ bars: loaded.bars.slice(Math.max(0, split - 40)), candidate, initialCapital: this.initialCapital });
            const frictionPassed = backtest.frictionCheck?.passed !== false;
            const inSampleSupported = backtest.trades >= 5
                && backtest.totalPnl > 0
                && backtest.winRate >= 50
                && backtest.profitFactor >= 1.4;
            const holdoutSupported = holdout.trades >= 3 && holdout.totalPnl > 0;
            results.push({
                key: candidate.key,
                strategyId: candidate.strategyId,
                symbol: candidate.symbol,
                status: 'backtested',
                timeframe: loaded.timeframe,
                bars: loaded.bars.length,
                historicalFile: path.relative(ROOT, loaded.file).replace(/\\/g, '/'),
                simulation: candidate.simulation,
                backtest,
                holdout: {
                    trades: holdout.trades,
                    totalPnl: holdout.totalPnl,
                    winRate: holdout.winRate,
                    profitFactor: holdout.profitFactor,
                    maxDrawdownPct: holdout.maxDrawdownPct,
                    supported: holdoutSupported
                },
                verdict: !frictionPassed
                    ? 'target_inside_friction'
                    : (inSampleSupported && holdoutSupported ? 'backtest_supported' : 'backtest_weak_or_failed')
            });
        }
        return results;
    }

    async runFromSimToLiveReport(reportPath = path.join(ROOT, 'data', 'trading', 'sim-to-live-report.json'), options = {}) {
        const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        const results = await this.runCandidates(report.paperQueue || [], options);
        const output = {
            success: true,
            generatedAt: new Date().toISOString(),
            sourceReportPath: path.relative(ROOT, reportPath).replace(/\\/g, '/'),
            summary: {
                candidates: results.length,
                backtested: results.filter(row => row.status === 'backtested').length,
                supported: results.filter(row => row.verdict === 'backtest_supported').length,
                weakOrFailed: results.filter(row => row.verdict === 'backtest_weak_or_failed').length,
                missingData: results.filter(row => row.status === 'no_historical_data').length
            },
            results
        };
        await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
        await fs.writeFile(this.reportPath, JSON.stringify(output, null, 2), 'utf8');
        return output;
    }
}

export default new CompiledStrategyBacktester();

if (process.argv[1] && process.argv[1].endsWith('CompiledStrategyBacktester.js')) {
    const limit = Number(process.argv[2] || 10);
    new CompiledStrategyBacktester()
        .runFromSimToLiveReport(undefined, { limit })
        .then(report => console.log(JSON.stringify(report.summary, null, 2)))
        .catch(error => {
            console.error(error);
            process.exitCode = 1;
        });
}
