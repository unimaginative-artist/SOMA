import { ECOSYSTEM_LANES, ECOSYSTEM_SYMBOLS, ecosystemCandidate } from './TradingEcosystemCatalog.js';
import { missionCandidate } from './TradingMissionPolicy.js';
import { selectExecutablePaperCandidate, selectQualifiedOfflinePaperCandidate } from './PaperCandidateSelector.js';
import { completedDecisionBars, assessDecisionDataFreshness, maxDecisionAgeForTimeframe } from './TradingDataFreshness.js';
import { executableStreamQuote } from './TradingExecutionQuote.js';
import { backtestBars } from './CompiledStrategyBacktester.js';
import { ALPACA_CRYPTO_FEES } from './TradingResearchPolicy.js';

export function createMissionEvidence({ data, quotes, ledger, reports, now = Date.now }) {
    const cache = new Map();
    function forward(candidate) {
        if (!ledger.db) throw new Error('Authoritative trade ledger is not ready');
        const rows = ledger.db.prepare("SELECT pnl,entry_price,qty,entry_fee,exit_fee,slippage_pct FROM trades WHERE status='closed' AND symbol=? AND strategy_version=? ORDER BY exit_time,id")
            .all(candidate.symbol, candidate.id);
        if (rows.some(row => !Number.isFinite(row.pnl) || !(row.entry_price > 0) || !(row.qty > 0))) throw new Error('Current-version ledger evidence is malformed');
        const returns = rows.map(row => row.pnl / (row.entry_price * row.qty));
        const gains = rows.reduce((sum, row) => sum + Math.max(0, row.pnl), 0);
        const losses = rows.reduce((sum, row) => sum + Math.max(0, -row.pnl), 0);
        const notional = rows.reduce((sum, row) => sum + row.entry_price * row.qty, 0);
        const fees = rows.reduce((sum, row) => sum + Math.max(0, Number(row.entry_fee) || 0) + Math.max(0, Number(row.exit_fee) || 0), 0);
        const feeBps = notional > 0 ? fees / notional * 10_000 : null;
        const slippages = rows.filter(row => row.slippage_pct != null)
            .map(row => Number(row.slippage_pct)).filter(Number.isFinite);
        const modeledRoundTripFeeBps = 2 * ALPACA_CRYPTO_FEES.takerBps;
        return { trades: rows.length, netPnl: gains - losses, profitFactor: losses ? gains / losses : gains ? 999 : 0,
            meanNetReturn: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0,
            costReconciliation: { observedRoundTripFeeBps: feeBps, modeledRoundTripFeeBps,
                averageAbsoluteEntrySlippageBps: slippages.length
                    ? slippages.reduce((sum, value) => sum + Math.abs(value), 0) / slippages.length * 100 : null,
                warning: rows.length && (feeBps === null || feeBps < modeledRoundTripFeeBps * 0.5)
                    ? 'paper_fee_evidence_below_model' : null } };
    }
    async function market(candidate, refresh = false) {
        const timeframe = candidate.compiledStrategy.dsl.execution.timeframe;
        const key = `${candidate.symbol}|${timeframe}`;
        let snapshot = cache.get(key);
        if (refresh || !snapshot || now() - snapshot.at > 60_000) {
            const [raw, quote] = await Promise.all([
                data.getAlpacaCryptoBars(candidate.symbol, timeframe, 1000), quotes.getCryptoQuote(candidate.symbol)
            ]);
            const bars = completedDecisionBars(raw, { timeframe, now: now() });
            const native = bars.length >= 200 && bars.every(bar => !bar.isMock && bar.source === 'alpaca_crypto_us');
            const fresh = assessDecisionDataFreshness(bars, { now: now(), maxAgeMs: maxDecisionAgeForTimeframe(timeframe) });
            const executable = executableStreamQuote(candidate.symbol, quote, now());
            snapshot = { at: now(), bars, data: { native, ready: native && fresh.validForEntry && Boolean(executable),
                reason: !native ? 'Need 200 real completed native-venue candles' : !fresh.validForEntry ? 'Native candles are stale'
                    : !executable ? 'No fresh executable native bid/ask' : null,
                source: 'alpaca_crypto_us', timeframe, barCount: bars.length, latestBar: bars.at(-1)?.timestamp,
                quoteTimestamp: quote.timestamp, spreadBps: executable?.spreadBps ?? null } };
            cache.set(key, snapshot);
        }
        return snapshot;
    }
    return {
        forward,
        proposals() {
            const candidates = [], excluded = [{ source: 'grid', reason: 'Grid remains research-only: idealized fills are not execution evidence.' }];
            const add = (input, source) => {
                if (!input) return;
                try {
                    const candidate = { ...missionCandidate(input), proposalSource: source };
                    if (!candidates.some(row => row.key === candidate.key)) candidates.push(candidate);
                } catch (error) { excluded.push({ source, symbol: input.symbol, strategyId: input.strategyId, reason: error.message }); }
            };
            const external = reports();
            add(selectExecutablePaperCandidate(external.simToLive || {}), 'sim_to_paper_queue');
            add(selectQualifiedOfflinePaperCandidate(external.offline || {}), 'qualified_offline_research');
            for (const lane of ECOSYSTEM_LANES.filter(lane => !lane.researchOnly)) {
                for (const symbol of ECOSYSTEM_SYMBOLS) add(ecosystemCandidate(lane.id, symbol), 'ecosystem_catalog');
            }
            return { candidates, excluded };
        },
        async readiness(candidate) { return (await market(candidate, true)).data; },
        async inspect(candidate) {
            // Fail closed if ledger is unavailable; missing outcomes are not a
            // zero-trade experiment that may spend another loss budget.
            const paper = forward(candidate);
            const { bars, data } = await market(candidate);
            if (!data.native) return { data, forward: paper, historical: null };
            const split = Math.floor(bars.length * 0.7);
            const result = backtestBars({ bars, candidate, tradeStartIndex: split, includeTrades: true });
            const trades = result.tradeLedger || [];
            const historical = { kind: 'historical_70_30_split_not_prospective', source: 'alpaca_crypto_us',
                firstBar: bars[0].timestamp, splitBar: bars[split].timestamp, lastBar: bars.at(-1).timestamp,
                netPnl: result.excessPnlVsNoTrade, observedCloses: trades.filter(trade => trade.exitReason !== 'end_of_data').length,
                boundaryLiquidations: trades.filter(trade => trade.exitReason === 'end_of_data').length,
                meanNetReturn: trades.length ? trades.reduce((sum, trade) => sum + trade.netReturn, 0) / trades.length : 0,
                frictionPassed: result.frictionCheck?.passed === true, friction: result.frictionCheck };
            return { data, forward: paper, historical };
        }
    };
}
