import fs from 'node:fs/promises';
import path from 'node:path';
import exchangeCredentials from './ExchangeCredentialsService.js';

const DEFAULT_LEDGER = path.join(process.cwd(), 'data', 'trading', 'microstructure-snapshots.jsonl');

function normalizeSymbol(value = '') {
    return String(value).toUpperCase().replace('-', '/');
}

function timestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function depth(levels = [], count = 5) {
    return levels.slice(0, count).reduce((sum, level) => sum + Number(level?.p || 0) * Number(level?.s || 0), 0);
}

export function summarizeMicrostructure({ symbol, quote, trade, orderbook, sampledAt = Date.now() } = {}) {
    const bid = Number(quote?.bp ?? quote?.bid_price ?? orderbook?.b?.[0]?.p);
    const ask = Number(quote?.ap ?? quote?.ask_price ?? orderbook?.a?.[0]?.p);
    const mid = bid > 0 && ask >= bid ? (bid + ask) / 2 : Number(trade?.p || 0);
    const bidDepth5Usd = depth(orderbook?.b || []);
    const askDepth5Usd = depth(orderbook?.a || []);
    const totalDepth = bidDepth5Usd + askDepth5Usd;
    return {
        schemaVersion: 1,
        symbol: String(symbol).replace('/', '-'),
        sampledAt,
        source: 'alpaca_crypto_us_latest',
        bid: Number.isFinite(bid) ? bid : null,
        ask: Number.isFinite(ask) ? ask : null,
        mid: Number.isFinite(mid) ? mid : null,
        spreadBps: mid > 0 && ask >= bid ? ((ask - bid) / mid) * 10000 : null,
        bidDepth5Usd,
        askDepth5Usd,
        orderBookImbalance: totalDepth > 0 ? (bidDepth5Usd - askDepth5Usd) / totalDepth : 0,
        lastTradePrice: Number(trade?.p || trade?.price || 0) || null,
        lastTradeSize: Number(trade?.s || trade?.size || 0) || null,
        quoteTimestamp: timestamp(quote?.t || quote?.timestamp) || null,
        tradeTimestamp: timestamp(trade?.t || trade?.timestamp) || null,
        orderbookTimestamp: timestamp(orderbook?.t || orderbook?.timestamp) || null
    };
}

export class TradingMicrostructurePipeline {
    constructor({ ledgerPath = DEFAULT_LEDGER, fetchImpl = globalThis.fetch, credentialsProvider = null } = {}) {
        this.ledgerPath = ledgerPath;
        this.fetchImpl = fetchImpl;
        this.credentialsProvider = credentialsProvider || (() => exchangeCredentials.loadCredentials('alpaca_paper')
            || exchangeCredentials.loadCredentials('alpaca_live') || exchangeCredentials.loadCredentials('alpaca'));
    }

    async _get(endpoint, symbols) {
        const credentials = this.credentialsProvider?.();
        if (!credentials?.apiKey || !credentials?.secretKey) throw new Error('Alpaca credentials unavailable');
        const query = new URLSearchParams({ symbols: symbols.map(normalizeSymbol).join(',') });
        const response = await this.fetchImpl(`https://data.alpaca.markets/v1beta3/crypto/us/latest/${endpoint}?${query}`, {
            headers: { 'APCA-API-KEY-ID': credentials.apiKey, 'APCA-API-SECRET-KEY': credentials.secretKey },
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) throw new Error(`Alpaca ${endpoint} HTTP ${response.status}`);
        return response.json();
    }

    async sample(symbols = []) {
        const unique = [...new Set(symbols.map(value => String(value).toUpperCase()))];
        if (!unique.length) return { sampled: 0, rows: [] };
        const [quotes, trades, books] = await Promise.all([
            this._get('quotes', unique), this._get('trades', unique), this._get('orderbooks', unique)
        ]);
        const sampledAt = Date.now();
        const rows = unique.map(symbol => {
            const key = normalizeSymbol(symbol);
            return summarizeMicrostructure({
                symbol,
                quote: quotes?.quotes?.[key],
                trade: trades?.trades?.[key],
                orderbook: books?.orderbooks?.[key],
                sampledAt
            });
        });
        await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
        await fs.appendFile(this.ledgerPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
        return { sampled: rows.length, rows };
    }

    async read({ symbol = null, limit = 20_000 } = {}) {
        try {
            const rows = (await fs.readFile(this.ledgerPath, 'utf8')).split(/\r?\n/).filter(Boolean)
                .slice(-Math.max(1, limit)).map(line => JSON.parse(line));
            return symbol ? rows.filter(row => row.symbol === String(symbol).toUpperCase()) : rows;
        } catch { return []; }
    }

    async enrichBars({ symbol, bars = [], timeframeMs = 3_600_000 } = {}) {
        const snapshots = await this.read({ symbol });
        if (!snapshots.length) return bars;
        let cursor = 0;
        return bars.map(bar => {
            const barTime = timestamp(bar.timestamp ?? bar.time);
            while (cursor + 1 < snapshots.length && snapshots[cursor + 1].sampledAt <= barTime) cursor++;
            const snapshot = snapshots[cursor];
            if (!snapshot || snapshot.sampledAt > barTime || barTime - snapshot.sampledAt > timeframeMs * 2) return bar;
            return {
                ...bar,
                bid: snapshot.bid,
                ask: snapshot.ask,
                spreadBps: snapshot.spreadBps,
                orderBookImbalance: snapshot.orderBookImbalance,
                microstructureSource: snapshot.source
            };
        });
    }
}

export default new TradingMicrostructurePipeline();
