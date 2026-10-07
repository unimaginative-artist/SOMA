import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import TradingGuardrails from './TradingGuardrails.js';
import tradeLogger from './TradeLogger.js';
import { normalizeTradingIntent, allowsAutonomousEntries } from './TradingIntentPolicy.js';
import {
    SIGNAL_IDEMPOTENCY_HEADER, SIGNAL_SIGNATURE_HEADER, JOURNAL_TIMESTAMP_HEADER,
    JOURNAL_SIGNATURE_HEADER, configuredSignalSecret, signalDigest,
    verifyJournalRead, verifySignalSignature
} from './SignalIngressProtocol.js';

const DEFAULT_JOURNAL = path.resolve(process.cwd(), 'data/trading/signals/signal_ingress_journal.jsonl');
const DEFAULT_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'];
const TIMEFRAMES = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const SIGNALS = new Set(['BUY', 'SELL', 'CLOSE', 'HOLD']);
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/;

function persistedIntent() {
    try {
        const file = path.resolve(process.cwd(), 'data/trading/trading-intent.json');
        return normalizeTradingIntent(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
        return normalizeTradingIntent({}, 'stopped');
    }
}

function finishReceipt(file, value) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx' });
        fs.renameSync(temp, file);
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

export function createSignalRouter(options = {}) {
    const router = express.Router();
    const journalPath = options.journalPath || DEFAULT_JOURNAL;
    const receiptsDir = path.join(path.dirname(journalPath), 'idempotency');
    const allowedSymbols = new Set(options.allowedSymbols ||
        (process.env.SOMA_SIGNAL_ALLOWED_SYMBOLS?.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) || DEFAULT_SYMBOLS));

    function requireSecret(req, res, next) {
        const secret = configuredSignalSecret(options.secret);
        if (!secret) return res.status(503).json({ ok: false, error: 'Signal signing is not configured' });
        req.signalSecret = secret;
        next();
    }

    router.post('/', requireSecret, (req, res) => {
        const body = req.body;
        const key = req.get(SIGNAL_IDEMPOTENCY_HEADER);
        if (!body || Array.isArray(body) || typeof body !== 'object' ||
            typeof key !== 'string' || !KEY_PATTERN.test(key)) {
            return res.status(400).json({ ok: false, error: 'JSON object and idempotency key required' });
        }
        if (!verifySignalSignature(req.signalSecret, key, body, req.get(SIGNAL_SIGNATURE_HEADER))) {
            return res.status(401).json({ ok: false, error: 'Invalid signal signature' });
        }
        const { source, symbol, timeframe, signal, confidence, timestamp, metrics, suggestedRisk } = body;
        const normalizedSymbol = typeof symbol === 'string' ? symbol.toUpperCase() : '';
        const normalizedTimeframe = typeof timeframe === 'string' ? timeframe.toLowerCase() : '';
        const normalizedSignal = typeof signal === 'string' ? signal.toUpperCase() : '';
        if (typeof source !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(source) ||
            !allowedSymbols.has(normalizedSymbol) || !TIMEFRAMES.has(normalizedTimeframe) ||
            !SIGNALS.has(normalizedSignal) || typeof confidence !== 'number' ||
            !Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
            !Number.isSafeInteger(timestamp) ||
            (metrics != null && (typeof metrics !== 'object' || Array.isArray(metrics)))) {
            return res.status(400).json({ ok: false, error: 'Invalid signal fields' });
        }
        const price = metrics?.price;
        if (['BUY', 'SELL'].includes(normalizedSignal) &&
            (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)) {
            return res.status(400).json({ ok: false, error: 'Positive finite price required for paper entry' });
        }
        const now = Date.now();
        if (timestamp > now) return res.status(422).json({ ok: false, decision: 'REJECTED_FUTURE' });
        if (now - timestamp > 120_000) return res.status(422).json({ ok: false, decision: 'REJECTED_STALE' });

        const digest = signalDigest(key, body);
        const receiptFile = path.join(receiptsDir,
            `${createHash('sha256').update(`${source}\n${key}`).digest('hex')}.json`);
        const signalId = `sig_${randomUUID()}`;
        try {
            fs.mkdirSync(receiptsDir, { recursive: true });
            const fd = fs.openSync(receiptFile, 'wx');
            try {
                fs.writeFileSync(fd, JSON.stringify({ digest, state: 'reserved', key }));
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
        } catch (error) {
            if (error.code !== 'EEXIST') {
                return res.status(503).json({ ok: false, error: 'Signal receipt storage unavailable' });
            }
            try {
                const old = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
                if (old.digest !== digest) return res.status(409).json({ ok: false, error: 'Idempotency key conflict' });
                if (old.state !== 'complete') return res.status(409).json({ ok: false, error: 'Prior outcome indeterminate' });
                return res.status(old.status).json({ ...old.response, duplicate: true });
            } catch {
                return res.status(409).json({ ok: false, error: 'Prior receipt unreadable' });
            }
        }
        try {
            fs.appendFileSync(journalPath, `${JSON.stringify({ state: 'reserved', signalId,
                idempotencyKey: key, source, receivedAt: new Date(now).toISOString() })}\n`);
        } catch {
            return res.status(503).json({ ok: false, error: 'Signal journal unavailable', signalId });
        }

        const intent = (options.getTradingIntent || persistedIntent)();
        let decision = 'OBSERVED_HOLD';
        let reason = normalizedSignal === 'HOLD' ? 'Worker emitted hold posture'
            : normalizedSignal === 'CLOSE' ? 'Close recorded for observation only'
            : `Trading intent is ${intent.desiredState}; entries are disarmed`;
        let status = 200;
        if (['BUY', 'SELL'].includes(normalizedSignal) && allowsAutonomousEntries(intent)) {
            const guardrails = options.guardrails || global.SOMA_TRADING?.guardrails || new TradingGuardrails();
            const check = guardrails.validateTrade(
                { symbol: normalizedSymbol, side: normalizedSignal.toLowerCase(), qty: 50 / price, value: 50 },
                { strategy: { confidence } }
            );
            if (!check.allowed) {
                decision = 'REJECTED_GUARDRAIL';
                reason = `Blocked by guardrails: ${check.reason}`;
            } else {
                try {
                    (options.tradeLogger || tradeLogger).logTradeEntry({
                        orderId: signalId, symbol: normalizedSymbol, side: normalizedSignal.toLowerCase(),
                        qty: 50 / price, entryPrice: price, filledPrice: price, expectedPrice: price,
                        slippagePct: 0.02, strategy: `worker_${source}`, regime: metrics?.regime || 'unknown',
                        evidenceType: 'paper_trade', mode: 'paper', broker: 'isolated_paper_sandbox'
                    });
                    decision = 'PAPER_EXECUTE';
                    reason = 'Recorded a forward paper entry';
                } catch {
                    decision = 'PAPER_LOG_FAILED';
                    reason = 'Paper entry could not be persisted';
                    status = 503;
                }
            }
        }
        const receivedAt = new Date(now).toISOString();
        const response = { ok: status === 200, signalId, decision, reason, receivedAt,
            symbol: normalizedSymbol, signal: normalizedSignal };
        const audit = { ...response, state: 'complete', idempotencyKey: key, source,
            timeframe: normalizedTimeframe, confidence, metrics: metrics || {},
            suggestedRisk: suggestedRisk || null, mode: 'paper' };
        try {
            finishReceipt(receiptFile, { digest, state: 'complete', status, response });
            fs.appendFileSync(journalPath, `${JSON.stringify(audit)}\n`);
        } catch {
            return res.status(503).json({ ok: false, error: 'Signal audit storage unavailable', signalId });
        }
        return res.status(status).json(response);
    });

    router.get('/journal', requireSecret, (req, res) => {
        const timestamp = Number(req.get(JOURNAL_TIMESTAMP_HEADER));
        if (!Number.isSafeInteger(timestamp) || timestamp > Date.now() || Date.now() - timestamp > 120_000 ||
            !verifyJournalRead(req.signalSecret, timestamp, req.get(JOURNAL_SIGNATURE_HEADER))) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        try {
            if (!fs.existsSync(journalPath)) return res.json({ ok: true, count: 0, signals: [] });
            const signals = fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)
                .map(line => { try { return JSON.parse(line); } catch { return null; } })
                .filter(row => row && row.state !== 'reserved').slice(-50).reverse();
            return res.json({ ok: true, count: signals.length, signals });
        } catch {
            return res.status(503).json({ ok: false, error: 'Signal journal unavailable' });
        }
    });
    return router;
}

export default createSignalRouter();
