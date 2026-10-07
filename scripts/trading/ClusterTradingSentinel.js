/**
 * scripts/trading/ClusterTradingSentinel.js
 *
 * Machine B quantitative market sentinel and streamer.
 * Continuously polls public OKX candles, computes zero-lookahead technical indicators
 * and RSI divergences, and streams authenticated signals across the LAN to SOMA Core on Machine A.
 *
 * Architecture:
 * - Decouples continuous ingestion & mathematical compute from core SOMA state.
 * - Targets SOMA Signal Ingress at SOMA_PRIMARY_HOST.
 * - Fallback: Local file logging (data/quant/sentinel_ledger.json) when SOMA Core is offline.
 */

import fs from 'fs';
import path from 'path';
import { calculateRSI, calculateRSISeries, calculateATR, findPivots, detectRSIDivergence } from '../../server/finance/TechnicalIndicators.js';
import { configuredSignalSecret, signSignal, SIGNAL_IDEMPOTENCY_HEADER, SIGNAL_SIGNATURE_HEADER } from '../../server/finance/SignalIngressProtocol.js';

export class ClusterTradingSentinel {
    constructor(options = {}) {
        this.primaryHost = options.primaryHost || process.env.SOMA_PRIMARY_HOST || '127.0.0.1:3001';
        this.localFallbackHost = options.localFallbackHost || '127.0.0.1:3001';
        this.signalEndpoint = options.signalEndpoint || '/api/finance/signal';
        this.pollIntervalMs = options.pollIntervalMs || 60_000;
        this.sourceId = options.sourceId || 'machine_b_sentinel';
        this.signalSecret = options.signalSecret || process.env.SOMA_SIGNAL_INGRESS_SECRET;

        this.symbols = options.symbols || [
            { id: 'ETH-USDT-SWAP', name: 'ETH-USD' },
            { id: 'SOL-USDT-SWAP', name: 'SOL-USD' },
            { id: 'BTC-USDT-SWAP', name: 'BTC-USD' }
        ];

        this.ledgerDir = path.resolve(process.cwd(), 'data', 'quant');
        this.ledgerFile = path.join(this.ledgerDir, 'sentinel_ledger.json');
        this._ensureLedgerDir();

        this.isRunning = false;
        this.timer = null;
        this.lastSignals = new Map();
        this.dispatchedBars = new Set();
    }

    _ensureLedgerDir() {
        try {
            if (!fs.existsSync(this.ledgerDir)) {
                fs.mkdirSync(this.ledgerDir, { recursive: true });
            }
        } catch (_) {}
    }

    _logLocal(record) {
        try {
            let ledger = [];
            if (fs.existsSync(this.ledgerFile)) {
                ledger = JSON.parse(fs.readFileSync(this.ledgerFile, 'utf8'));
            }
            ledger.push(record);
            if (ledger.length > 500) ledger = ledger.slice(-500);
            fs.writeFileSync(this.ledgerFile, JSON.stringify(ledger, null, 2), 'utf8');
        } catch (err) {
            console.warn('[Sentinel] Local ledger write error:', err.message);
        }
    }

    /**
     * Fetch latest public 1H candles from OKX (no API keys required)
     */
    async fetchCandles(instId, limit = 100) {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1H&limit=${limit}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
            const data = await res.json();
            if (data.code !== '0' || !Array.isArray(data.data)) {
                throw new Error(`OKX error: ${data.msg || 'invalid payload'}`);
            }

            // OKX returns newest-first: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
            // We sort oldest-first for indicator calculations
            const bars = data.data.map(row => ({
                ts: Number(row[0]),
                open: Number(row[1]),
                high: Number(row[2]),
                low: Number(row[3]),
                close: Number(row[4]),
                volume: Number(row[5]),
                confirmed: row[8] === '1'
            })).reverse();

            return bars;
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    /**
     * Analyze candles for zero-lookahead RSI divergence and momentum
     */
    analyzeAsset(instId, bars) {
        if (!bars || bars.length < 30) return null;

        const closes = bars.map(b => b.close);
        const highs = bars.map(b => b.high);
        const lows = bars.map(b => b.low);
        const currentPrice = closes[closes.length - 1];

        const rsiSeries = calculateRSISeries(closes, 14);
        const currentRsi = rsiSeries[rsiSeries.length - 1];
        const atr = calculateATR(highs, lows, closes, 14);

        const divergence = detectRSIDivergence(closes, rsiSeries, {
            leftBars: 3,
            rightBars: 1,
            maxLookbackBars: 48,
            minBarsBetweenPivots: 3,
            oversoldThreshold: 35,
            overboughtThreshold: 65
        });

        let signal = 'HOLD';
        let confidence = 0.5;
        let stopLoss = null;
        let takeProfit = null;

        // Fresh regular bullish divergence
        if (divergence.hasBullishDivergence && divergence.bullish?.isFresh) {
            signal = 'BUY';
            confidence = 0.85;
            const stopDist = Math.max(atr.atr * 1.5, currentPrice * 0.005);
            stopLoss = Number((currentPrice - stopDist).toFixed(2));
            takeProfit = Number((currentPrice + stopDist * 2.5).toFixed(2));
        } else if (divergence.hasBearishDivergence && divergence.bearish?.isFresh) {
            signal = 'SELL';
            confidence = 0.85;
            const stopDist = Math.max(atr.atr * 1.5, currentPrice * 0.005);
            stopLoss = Number((currentPrice + stopDist).toFixed(2));
            takeProfit = Number((currentPrice - stopDist * 2.5).toFixed(2));
        }

        return {
            symbol: instId,
            barTimestamp: bars[bars.length - 1].ts,
            currentPrice,
            rsi: Number(currentRsi.toFixed(2)),
            atr: Number(atr.atr.toFixed(2)),
            divergence: divergence.hasBullishDivergence ? 'BULLISH' : divergence.hasBearishDivergence ? 'BEARISH' : 'NONE',
            signal,
            confidence,
            suggestedRisk: (stopLoss && takeProfit) ? { stopLoss, takeProfit } : null
        };
    }

    /**
     * Dispatch signal to Machine A with local fallback
     */
    async dispatchSignal(analysis) {
        const secret = configuredSignalSecret(this.signalSecret);
        if (!secret) {
            this._logLocal({ source: this.sourceId, symbol: analysis.symbol, status: 'AUTH_NOT_CONFIGURED' });
            return { success: false, queuedLocally: false, error: 'SOMA_SIGNAL_INGRESS_SECRET must contain at least 32 bytes' };
        }
        const barTime = Number.isSafeInteger(analysis.barTimestamp) ? analysis.barTimestamp
            : Math.floor(Date.now() / 3_600_000) * 3_600_000;
        const barKey = new Date(barTime).toISOString().replace('.000Z', 'Z');
        const idempotencyKey = `${this.sourceId}:${analysis.symbol}:1h:${barKey}`;
        const payload = {
            source: this.sourceId,
            symbol: analysis.symbol,
            timeframe: '1h',
            timestamp: Date.now(),
            signal: analysis.signal,
            confidence: analysis.confidence,
            metrics: {
                price: analysis.currentPrice,
                rsi: analysis.rsi,
                atr: analysis.atr,
                divergence: analysis.divergence
            },
            suggestedRisk: analysis.suggestedRisk
        };

        const targets = [
            `http://${this.primaryHost}${this.signalEndpoint}`,
            `http://${this.localFallbackHost}${this.signalEndpoint}`
        ];

        let dispatched = false;
        let lastError = null;

        for (const targetUrl of targets) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4000);

                const headers = { 'Content-Type': 'application/json',
                    [SIGNAL_IDEMPOTENCY_HEADER]: idempotencyKey,
                    [SIGNAL_SIGNATURE_HEADER]: signSignal(secret, idempotencyKey, payload) };

                const res = await fetch(targetUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
                clearTimeout(timeout);

                if (res.ok) {
                    const receipt = await res.json();
                    dispatched = true;
                    this._logLocal({ ...payload, targetUrl, status: 'DISPATCHED', receipt });
                    console.log(`[Sentinel] 📡 Dispatched ${payload.symbol} ${payload.signal} to ${targetUrl} -> Decision: ${receipt.decision} (${receipt.signalId})`);
                    return { success: true, targetUrl, receipt };
                } else {
                    const errText = await res.text().catch(() => '');
                    lastError = `HTTP ${res.status}: ${errText}`;
                    console.warn(`[Sentinel] ⚠️ Dispatch failed to ${targetUrl} [HTTP ${res.status}]: ${errText}`);
                    if ([400, 401, 403, 409, 422].includes(res.status)) {
                        this._logLocal({ ...payload, targetUrl, status: 'REJECTED_REMOTE', error: lastError });
                        return { success: false, queuedLocally: false, rejected: true,
                            statusCode: res.status, error: lastError };
                    }
                }
            } catch (err) {
                lastError = err.message;
            }
        }

        // Both network targets unreachable: save to local offline ledger
        this._logLocal({ ...payload, status: 'OFFLINE_QUEUED', error: lastError });
        return { success: false, queuedLocally: true, error: lastError };
    }

    /**
     * Single polling tick across all monitored assets
     */
    async tick() {
        const results = [];
        for (const asset of this.symbols) {
            try {
                const bars = await this.fetchCandles(asset.id, 80);
                const analysis = this.analyzeAsset(asset.id, bars.filter(bar => bar.confirmed === true));
                if (!analysis) continue;

                results.push(analysis);

                // Only dispatch if signal changed or is actionable (BUY/SELL)
                const lastSig = this.lastSignals.get(asset.id);
                if (analysis.signal !== 'HOLD' || lastSig !== 'HOLD') {
                    this.lastSignals.set(asset.id, analysis.signal);
                    const barKey = `${asset.id}:${analysis.barTimestamp}`;
                    if (!this.dispatchedBars.has(barKey)) {
                        const dispatch = await this.dispatchSignal(analysis);
                        if (dispatch.success || dispatch.statusCode === 409) {
                            this.dispatchedBars.add(barKey);
                            if (this.dispatchedBars.size > 1000) this.dispatchedBars.clear();
                        }
                    }
                }
            } catch (err) {
                console.warn(`[Sentinel] Error analyzing ${asset.id}:`, err.message);
            }
        }
        return results;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[Sentinel] Started 24/7 OKX market surveillance (dispatching to ${this.primaryHost})...`);
        this.tick().catch(() => {});
        this.timer = setInterval(() => {
            this.tick().catch(err => console.error('[Sentinel] Tick failure:', err.message));
        }, this.pollIntervalMs);
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log('[Sentinel] Surveillance stopped.');
    }
}
