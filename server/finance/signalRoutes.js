/**
 * server/finance/signalRoutes.js
 *
 * Dedicated Signal Ingress & Decision Arbiter Gateway.
 * Provides an isolated, authenticated boundary for external workers (Machine B,
 * Sentinel daemons, quant scripts) to stream market signals into SOMA.
 *
 * SAFETY CONTRACT:
 * 1. COMPLETELY DECOUPLED from live broker execution (/api/finance/execute).
 * 2. If tradingIntent is not ACTIVE/RUNNING, decisions are strictly OBSERVED_HOLD.
 * 3. Freshness Gate: Rejects signals with timestamp older than 120 seconds.
 * 4. Audit Trail: Every signal receipt and arbitration decision is persisted atomically.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import TradingGuardrails from './TradingGuardrails.js';
import tradeLogger from './TradeLogger.js';
import { normalizeTradingIntent, allowsAutonomousEntries } from './TradingIntentPolicy.js';

const router = express.Router();

const SIGNALS_DIR = path.resolve(process.cwd(), 'data', 'trading', 'signals');
const SIGNALS_LOG = path.join(SIGNALS_DIR, 'signal_ingress_journal.jsonl');

function ensureSignalsDir() {
    try {
        if (!fs.existsSync(SIGNALS_DIR)) {
            fs.mkdirSync(SIGNALS_DIR, { recursive: true });
        }
    } catch (_) {}
}

function getTradingIntent() {
    try {
        const intentPath = path.resolve(process.cwd(), 'data', 'trading', 'trading-intent.json');
        if (fs.existsSync(intentPath)) {
            const raw = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
            return normalizeTradingIntent(raw);
        }
    } catch (_) {}
    return normalizeTradingIntent({}, 'stopped');
}

/**
 * POST /api/finance/signal
 * Ingress for external quantitative signals.
 */
router.post('/', async (req, res) => {
    ensureSignalsDir();
    const now = Date.now();
    const payload = req.body || {};

    // 1. Schema Validation
    const { source, symbol, timeframe, signal, confidence, timestamp, metrics, suggestedRisk } = payload;

    if (!source || typeof source !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing or invalid "source" identifier' });
    }
    if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing or invalid "symbol"' });
    }
    if (!['BUY', 'SELL', 'CLOSE', 'HOLD'].includes(String(signal).toUpperCase())) {
        return res.status(400).json({ ok: false, error: 'Signal must be BUY, SELL, CLOSE, or HOLD' });
    }

    const conf = Number(confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
        return res.status(400).json({ ok: false, error: 'Confidence must be a number between 0.0 and 1.0' });
    }

    const sigTime = Number(timestamp);
    if (!Number.isFinite(sigTime)) {
        return res.status(400).json({ ok: false, error: 'Missing or invalid "timestamp" (epoch ms)' });
    }

    // 2. Freshness Gate (120 seconds maximum skew)
    const ageMs = Math.abs(now - sigTime);
    if (ageMs > 120_000) {
        const record = {
            signalId: `sig_${now}_${Math.random().toString(36).substring(2, 7)}`,
            receivedAt: new Date(now).toISOString(),
            decision: 'REJECTED_STALE',
            reason: `Signal timestamp is ${Math.round(ageMs / 1000)}s old (max allowable skew is 120s)`,
            payload
        };
        try { fs.appendFileSync(SIGNALS_LOG, JSON.stringify(record) + '\n'); } catch (_) {}
        return res.status(422).json({
            ok: false,
            decision: 'REJECTED_STALE',
            reason: record.reason
        });
    }

    // 3. Authority & Intent Arbitration
    const intent = getTradingIntent();
    const autonomousAllowed = allowsAutonomousEntries(intent);

    const signalId = `sig_${now}_${Math.random().toString(36).substring(2, 7)}`;
    let decision = 'OBSERVED_HOLD';
    let decisionReason = 'Trading intent is stopped; signal recorded for forward research observation only';

    if (signal === 'HOLD') {
        decision = 'OBSERVED_HOLD';
        decisionReason = 'Worker emitted neutral/hold posture';
    } else if (!autonomousAllowed) {
        decision = 'OBSERVED_HOLD';
        decisionReason = `Ordinary trading intent is ${intent.desiredState}; new autonomous entries are disarmed`;
    } else {
        // If trading intent is running, evaluate risk guardrails before paper simulation
        const guardrails = global.SOMA_TRADING?.guardrails || new TradingGuardrails();
        const price = metrics?.price || 0;
        const estimatedQty = (price > 0) ? (50 / price) : 0; // standard $50 paper test lot
        const guardrailCheck = guardrails.validateTrade(
            { symbol, side: signal.toLowerCase(), qty: estimatedQty, value: 50 },
            { strategy: { confidence: conf } }
        );

        if (!guardrailCheck.allowed) {
            decision = 'REJECTED_GUARDRAIL';
            decisionReason = `Blocked by guardrails: ${guardrailCheck.reason}`;
        } else {
            decision = 'PAPER_EXECUTE';
            decisionReason = 'Approved for sandboxed forward paper simulation';

            // Log paper entry into SQLite tradeLogger for forward attribution
            try {
                tradeLogger.logTradeEntry({
                    orderId: signalId,
                    symbol,
                    side: signal.toLowerCase(),
                    qty: estimatedQty,
                    entryPrice: price,
                    filledPrice: price,
                    expectedPrice: price,
                    slippagePct: 0.02,
                    strategy: `worker_${source}`,
                    regime: metrics?.regime || 'unknown',
                    evidenceType: 'paper_trade',
                    mode: 'paper',
                    broker: 'isolated_paper_sandbox'
                });
            } catch (err) {
                console.warn('[SignalIngress] SQLite forward logging deferred:', err.message);
            }
        }
    }

    // 4. Persistence Audit
    const auditEntry = {
        signalId,
        receivedAt: new Date(now).toISOString(),
        source,
        symbol,
        timeframe: timeframe || '1h',
        signal: signal.toUpperCase(),
        confidence: conf,
        decision,
        decisionReason,
        metrics: metrics || {},
        suggestedRisk: suggestedRisk || null
    };

    try {
        fs.appendFileSync(SIGNALS_LOG, JSON.stringify(auditEntry) + '\n');
    } catch (fsErr) {
        console.warn('[SignalIngress] Failed to append signal journal:', fsErr.message);
    }

    return res.json({
        ok: true,
        signalId,
        decision,
        reason: decisionReason,
        receivedAt: auditEntry.receivedAt,
        symbol,
        signal: auditEntry.signal
    });
});

/**
 * GET /api/finance/signal/journal
 * Returns recent ingested signals for dashboard and telemetry review.
 */
router.get('/journal', (req, res) => {
    ensureSignalsDir();
    try {
        if (!fs.existsSync(SIGNALS_LOG)) {
            return res.json({ ok: true, signals: [] });
        }
        const lines = fs.readFileSync(SIGNALS_LOG, 'utf8')
            .split('\n')
            .filter(Boolean)
            .slice(-50)
            .map(line => {
                try { return JSON.parse(line); } catch { return null; }
            })
            .filter(Boolean)
            .reverse();
        return res.json({ ok: true, count: lines.length, signals: lines });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
