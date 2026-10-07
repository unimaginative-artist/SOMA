import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import exchangeCredentials from './ExchangeCredentialsService.js';

const HOUR_MS = 60 * 60 * 1000;
const TIMEFRAMES = Object.freeze({
    '15Min': { exchangeInterval: '15m', intervalMs: 15 * 60 * 1000, defaultLookbackDays: 180 },
    '1H': { exchangeInterval: '1h', intervalMs: HOUR_MS, defaultLookbackDays: 400 },
    '4H': { exchangeInterval: '4h', intervalMs: 4 * HOUR_MS, defaultLookbackDays: 800 },
    '1D': { exchangeInterval: '1d', intervalMs: 24 * HOUR_MS, defaultLookbackDays: 1825 }
});

export const DEFAULT_LIQUID_CRYPTO_MARKETS = Object.freeze([
    { symbol: 'BTC-USD', exchangeSymbol: 'BTCUSD' },
    { symbol: 'ETH-USD', exchangeSymbol: 'ETHUSD' },
    { symbol: 'SOL-USD', exchangeSymbol: 'SOLUSD' },
    { symbol: 'LTC-USD', exchangeSymbol: 'LTCUSD' },
    { symbol: 'LINK-USD', exchangeSymbol: 'LINKUSD' },
    { symbol: 'AVAX-USD', exchangeSymbol: 'AVAXUSD' }
]);

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeKline(row) {
    return {
        timestamp: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
        low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
    };
}

function normalizeAlpacaBar(row) {
    return {
        timestamp: Date.parse(row?.t), open: Number(row?.o), high: Number(row?.h),
        low: Number(row?.l), close: Number(row?.c), volume: Number(row?.v || 0),
        tradeCount: Number(row?.n || 0), vwap: Number(row?.vw || row?.c || 0),
        source: 'alpaca_crypto_us'
    };
}

function validBar(bar) {
    return Number.isFinite(bar?.timestamp) && bar.timestamp > 0
        && ['open', 'high', 'low', 'close', 'volume'].every(key => Number.isFinite(Number(bar[key])))
        && Number(bar.open) > 0 && Number(bar.close) > 0 && Number(bar.high) >= Number(bar.low);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function validateHistoricalBars(bars = [], { intervalMs = HOUR_MS, now = Date.now() } = {}) {
    const issues = [];
    let gaps = 0;
    for (let index = 0; index < bars.length; index++) {
        if (!validBar(bars[index])) issues.push(`invalid_bar:${index}`);
        if (index > 0) {
            const delta = Number(bars[index].timestamp) - Number(bars[index - 1].timestamp);
            if (delta <= 0) issues.push(`unordered_or_duplicate:${index}`);
            else if (delta > intervalMs * 1.5) gaps++;
        }
    }
    const lastTimestamp = Number(bars.at(-1)?.timestamp || 0);
    const ageMs = lastTimestamp ? Math.max(0, now - lastTimestamp) : Infinity;
    return {
        valid: issues.length === 0 && bars.length >= 720 && ageMs <= intervalMs * 3,
        issues: issues.slice(0, 25), gaps, bars: bars.length, lastTimestamp, ageMs
    };
}

export class TradingHistoricalDataPipeline {
    constructor({
        cacheDir = path.join(process.cwd(), 'data', 'trading', 'historical-cache'),
        fetchImpl = globalThis.fetch,
        provider = 'alpaca_crypto_us',
        credentialsProvider = () => exchangeCredentials.loadCredentials('alpaca_paper')
            || exchangeCredentials.loadCredentials('alpaca_live')
            || exchangeCredentials.loadCredentials('alpaca')
    } = {}) {
        this.cacheDir = cacheDir;
        this.fetchImpl = fetchImpl;
        this.provider = provider;
        this.credentialsProvider = credentialsProvider;
    }

    async _fetchPage(exchangeSymbol, startTime, endTime = Date.now(), exchangeInterval = '1h') {
        const query = new URLSearchParams({
            symbol: exchangeSymbol, interval: exchangeInterval, limit: '1000',
            startTime: String(startTime), endTime: String(endTime)
        });
        const response = await this.fetchImpl(`https://api.binance.us/api/v3/klines?${query}`, {
            signal: AbortSignal.timeout(15_000)
        });
        if (!response.ok) throw new Error(`Binance.US HTTP ${response.status} for ${exchangeSymbol}`);
        const payload = await response.json();
        if (!Array.isArray(payload)) throw new Error(`Invalid Binance.US kline response for ${exchangeSymbol}`);
        return payload.map(normalizeKline).filter(validBar);
    }

    async _fetchAlpacaBars(symbol, startTime, endTime, timeframe) {
        const credentials = this.credentialsProvider?.();
        if (!credentials?.apiKey || !credentials?.secretKey) {
            throw new Error('Alpaca credentials are required for venue-aligned historical research');
        }
        const alpacaSymbol = String(symbol).replace('-', '/');
        const bars = [];
        let pageToken = null;
        do {
            const query = new URLSearchParams({
                symbols: alpacaSymbol,
                timeframe,
                start: new Date(startTime).toISOString(),
                end: new Date(endTime).toISOString(),
                limit: '10000',
                sort: 'asc'
            });
            if (pageToken) query.set('page_token', pageToken);
            let response = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                response = await this.fetchImpl(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${query}`, {
                    headers: {
                        'APCA-API-KEY-ID': credentials.apiKey,
                        'APCA-API-SECRET-KEY': credentials.secretKey
                    },
                    signal: AbortSignal.timeout(20_000)
                });
                if (response.ok || (response.status !== 429 && Number(response.status) < 500)) break;
                const retryAfter = Number(response.headers?.get?.('retry-after'));
                const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(30_000, retryAfter * 1000)
                    : Math.min(30_000, 1000 * Math.pow(2, attempt));
                await delay(waitMs);
            }
            if (!response.ok) throw new Error(`Alpaca market data HTTP ${response.status} for ${alpacaSymbol}`);
            const payload = await response.json();
            const rows = Array.isArray(payload?.bars)
                ? payload.bars
                : payload?.bars?.[alpacaSymbol] || payload?.bars?.[symbol] || [];
            bars.push(...rows.map(normalizeAlpacaBar).filter(validBar));
            pageToken = payload?.next_page_token || null;
            if (pageToken) await delay(150);
        } while (pageToken);
        return bars;
    }

    async refreshSymbol({ symbol, exchangeSymbol, timeframe = '1H', lookbackDays = null, now = Date.now() }) {
        const frame = TIMEFRAMES[timeframe];
        if (!frame) throw new Error(`Unsupported historical timeframe: ${timeframe}`);
        const requestedLookbackDays = Math.max(30, Number(lookbackDays ?? frame.defaultLookbackDays) || frame.defaultLookbackDays);
        await fs.mkdir(this.cacheDir, { recursive: true });
        const file = path.join(this.cacheDir, `${symbol}_${timeframe}.json`);
        let existing = [];
        try {
            const provenance = JSON.parse(await fs.readFile(`${file}.provenance.json`, 'utf8'));
            if (provenance?.venue !== this.provider) throw new Error('venue_changed');
            const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
            existing = (Array.isArray(parsed) ? parsed : parsed?.bars || []).filter(validBar);
        } catch {}
        let cursor = existing.length
            ? Number(existing.at(-1).timestamp) + frame.intervalMs
            : now - requestedLookbackDays * 24 * HOUR_MS;
        const additions = [];
        if (this.provider === 'alpaca_crypto_us') {
            additions.push(...await this._fetchAlpacaBars(symbol, cursor, now, timeframe));
        } else {
            while (cursor < now - frame.intervalMs) {
                const page = await this._fetchPage(exchangeSymbol, cursor, now, frame.exchangeInterval);
                if (!page.length) break;
                additions.push(...page);
                const next = Number(page.at(-1).timestamp) + frame.intervalMs;
                if (next <= cursor) throw new Error(`Non-advancing cursor for ${exchangeSymbol}`);
                cursor = next;
                if (page.length < 1000) break;
            }
        }
        const bars = Array.from(new Map([...existing, ...additions].map(bar => [Number(bar.timestamp), bar])).values())
            .sort((left, right) => left.timestamp - right.timestamp)
            .filter(bar => bar.timestamp + frame.intervalMs <= now);
        const validation = validateHistoricalBars(bars, { intervalMs: frame.intervalMs, now });
        if (validation.issues.length) throw new Error(`Historical validation failed for ${symbol}: ${validation.issues.join(', ')}`);
        const serialized = `${JSON.stringify(bars, null, 2)}\n`;
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, serialized, 'utf8');
        await fs.rename(temporary, file);
        const provenance = {
            schemaVersion: 2, symbol, exchangeSymbol, timeframe, venue: this.provider,
            intervalMs: frame.intervalMs,
            source: this.provider === 'alpaca_crypto_us'
                ? 'Alpaca Crypto US /v1beta3/crypto/us/bars'
                : 'Binance.US public REST /api/v3/klines',
            fetchedAt: new Date(now).toISOString(),
            firstTimestamp: bars[0]?.timestamp || null, lastTimestamp: bars.at(-1)?.timestamp || null,
            rows: bars.length, additions: additions.length, sha256: sha256(serialized), validation
        };
        await fs.writeFile(`${file}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
        return provenance;
    }

    async refreshCoreMarkets({ timeframes = ['1H', '4H', '1D'], markets = DEFAULT_LIQUID_CRYPTO_MARKETS, ...options } = {}) {
        const results = [];
        for (const timeframe of timeframes) {
            for (const market of markets) results.push(await this.refreshSymbol({ ...market, timeframe, ...options }));
        }
        return { success: results.every(result => result.validation.valid), results };
    }
}

export default TradingHistoricalDataPipeline;
