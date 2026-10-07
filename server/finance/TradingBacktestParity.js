import crypto from 'node:crypto';
import { backtestBars } from './CompiledStrategyBacktester.js';

function digest(result = {}) {
    return crypto.createHash('sha256').update(JSON.stringify({
        trades: result.trades, totalPnl: result.totalPnl, winRate: result.winRate,
        profitFactor: result.profitFactor, maxDrawdownPct: result.maxDrawdownPct,
        sampleTrades: result.sampleTrades
    })).digest('hex');
}

export function verifySomaReplayParity({ bars = [], candidate, initialCapital = 10000 } = {}) {
    const first = backtestBars({ bars, candidate, initialCapital });
    const second = backtestBars({ bars: structuredClone(bars), candidate: structuredClone(candidate), initialCapital });
    const firstDigest = digest(first);
    const secondDigest = digest(second);
    return {
        passed: firstDigest === secondDigest,
        engine: 'soma_compiled_backtester', firstDigest, secondDigest,
        economics: first.frictionCheck, metrics: {
            trades: first.trades, totalPnl: first.totalPnl, profitFactor: first.profitFactor
        }
    };
}

export function compareExternalBacktest(soma = {}, external = {}, tolerances = {}) {
    const limits = { pnlPct: 0.25, tradeCountPct: 0.1, ...tolerances };
    const somaTrades = Number(soma.trades || 0);
    const externalTrades = Number(external.trades || external.total_trades || 0);
    const somaPnl = Number(soma.totalPnl || 0);
    const externalPnl = Number(external.totalPnl || external.profit_total_abs || 0);
    const tradeCountPct = Math.abs(somaTrades - externalTrades) / Math.max(1, somaTrades);
    const pnlPct = Math.abs(somaPnl - externalPnl) / Math.max(1, Math.abs(somaPnl));
    return {
        passed: tradeCountPct <= limits.tradeCountPct && pnlPct <= limits.pnlPct,
        deltas: { tradeCountPct, pnlPct }, tolerances: limits
    };
}

export default verifySomaReplayParity;
