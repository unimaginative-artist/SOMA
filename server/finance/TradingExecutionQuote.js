import { assessDecisionDataFreshness } from './TradingDataFreshness.js';

// A trade print can update a chart; it cannot stand in for a fillable bid/ask.
export function executableStreamQuote(symbol, event = {}, now = Date.now()) {
    const bid = Number(event.bid ?? event.BidPrice ?? event.bp);
    const ask = Number(event.ask ?? event.AskPrice ?? event.ap);
    const source = event.source || (event.exchange === 'alpaca_crypto' ? 'alpaca_crypto_us' : null);
    const timestamp = event.timestamp ?? event.Timestamp ?? event.t;
    const crypto = /[-/]USD$|USDT$/.test(symbol);
    if (!(bid > 0) || !Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid
        || event.isMock || event.executionEligible === false
        || (crypto && source !== 'alpaca_crypto_us')) return null;
    const quote = { symbol, bid, ask, price: (bid + ask) / 2, timestamp, source,
        spreadBps: ((ask - bid) / ((bid + ask) / 2)) * 10000, executionEligible: true };
    return assessDecisionDataFreshness([quote], { now, maxAgeMs: 60000 }).validForEntry ? quote : null;
}
