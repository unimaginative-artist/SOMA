/**
 * Notification Service
 * Sends alerts to external services (Discord)
 */

import fs from 'fs';
import path from 'path';
import messageBroker from '../../core/MessageBroker.js';
import outboundAutonomyGate from '../../core/OutboundAutonomyGate.js';
import { TradingNotificationDigest } from './TradingNotificationDigest.js';
import tradeLogger from '../finance/TradeLogger.js';
import performanceCalculator from '../finance/PerformanceCalculator.js';
import { eligiblePaperTrade, isBeeStrategy } from '../finance/TradeEvidenceScope.js';

const SETTINGS_FILE = path.join(process.cwd(), '.soma', 'notifications.json');

export class NotificationService {
    constructor({ digest = null, broker = messageBroker, gate = outboundAutonomyGate } = {}) {
        this.settings = {
            discordWebhookUrl: null
        };
        this.digest = digest || new TradingNotificationDigest();
        this.broker = broker;
        this.gate = gate;
        this.loadSettings();
    }

    loadSettings() {
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
                this.settings = JSON.parse(data);
            }
        } catch (e) {
            console.error('[Notifications] Failed to load settings:', e.message);
        }
    }

    saveSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        try {
            const dir = path.dirname(SETTINGS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
            return true;
        } catch (e) {
            console.error('[Notifications] Failed to save settings:', e.message);
            return false;
        }
    }

    getSettings() {
        return this.settings;
    }

    /**
     * Generic Discord embed sender — used for engine lifecycle alerts and
     * daily promotion-gate summaries. No-op when no webhook is configured.
     */
    /**
     * Fallback delivery through SOMA's own Discord bot (DiscordArbiter
     * subscribes to soma_proactive and DMs the master). Used whenever no
     * webhook URL is configured.
     */
    async _publishToBot(text, gateReceipt, kind = 'trading_alert') {
        try {
            const payload = { message: text, source: 'trading_notifications', kind, gateReceipt, deliveryAckRequested: true };
            await this.broker.publish('soma_proactive', {
                from: 'NotificationService',
                to: 'broadcast',
                type: 'soma_proactive',
                payload
            });
            return payload.deliveryReceipt?.messageId
                ? { sent: true, path: 'discord_bot', messageId: payload.deliveryReceipt.messageId }
                : { sent: false, reason: 'discord_delivery_unverified' };
        } catch (error) { return { sent: false, reason: error.message }; }
    }

    async sendAlert(title, description, {
        color = 5793266,
        fields = [],
        delivery = 'immediate',
        eventType = 'trading_alert',
        dedupeKey = null,
        dedupeMs = 6 * 60 * 60_000,
        data = null
    } = {}) {
        const event = { title, description, eventType, dedupeKey, data };
        if (delivery === 'digest') {
            const queued = this.digest.queue(event);
            return { sent: false, queued: true, delivery: 'digest', key: queued.key, count: queued.count };
        }
        if (dedupeKey && this.digest.isDuplicate(event, dedupeMs)) {
            return { sent: false, suppressed: true, reason: 'structured_event_duplicate', dedupeKey };
        }
        const fieldText = fields.length ? '\n' + fields.map(f => `${f.name}: ${f.value}`).join(' · ') : '';
        const text = `${title}\n${description || ''}${fieldText}`;
        const kind = eventType === 'trading_daily' || /Daily Promotion Gate|Trading Activity Digest/i.test(title) ? 'trading_daily'
            : /Engine Auto-Resumed/i.test(title) ? 'trading_resume'
            : 'trading_alert';
        const gated = this.gate.evaluate({ message: text, source: 'trading_notifications', kind, verified: true, evidence: { title } });
        if (!gated.allowed) return { sent: false, suppressed: true, reason: gated.receipt.reason };
        if (!this.settings.discordWebhookUrl) {
            const result = await this._publishToBot(gated.text, gated.receipt, kind);
            if (!result.sent) this.gate.revokeUndeliveredReceipt(gated.receipt);
            if (dedupeKey && result.sent) this.digest.markDelivered(event);
            return result;
        }
        try {
            const response = await fetch(this.settings.discordWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    embeds: [{ title, description, color, fields, timestamp: new Date().toISOString() }]
                })
            });
            if (!response.ok) {
                this.gate.revokeUndeliveredReceipt(gated.receipt);
                return { sent: false, reason: `webhook_http_${response.status}` };
            }
            if (dedupeKey) this.digest.markDelivered(event);
            return { sent: true, path: 'webhook', accepted: true };
        } catch (e) {
            this.gate.revokeUndeliveredReceipt(gated.receipt);
            console.error('[Notifications] Discord webhook failed:', e.message);
            return { sent: false, reason: e.message };
        }
    }

    async flushTradingDigest() {
        const events = this.digest.peek();
        if (!events.length) return { sent: false, reason: 'empty_digest' };
        const lines = events.map(event =>
            `• ${event.count > 1 ? `${event.count}× ` : ''}${event.title.replace(/^\p{Extended_Pictographic}+\s*/u, '')}: ${event.description}`
        );
        const firstAt = events[0]?.firstAt || 'unknown';
        const lastAt = events.reduce((latest, event) => event.lastAt > latest ? event.lastAt : latest, firstAt);
        let currentState = 'Current engine state could not be verified at digest time.';
        try {
            const response = await fetch('http://127.0.0.1:3001/api/autonomous/status', { signal: AbortSignal.timeout(2500) });
            if (response.ok) {
                const status = await response.json();
                currentState = `Current state: ${status.execution?.state || 'unknown'}; ${status.runningCount ?? 'unknown'} running engine(s); desired: ${status.intent?.desiredState || 'unknown'}.`;
            }
        } catch { /* The event digest remains useful even if the live status probe fails. */ }
        const result = await this.sendAlert(
            '📬 Daily Trading Activity Digest',
            [`Events queued ${firstAt}–${lastAt} (historical, not proof of current activity).`, ...lines, currentState].join('\n').slice(0, 3800),
            {
                eventType: 'trading_daily',
                dedupeKey: `trading-digest:${new Date().toISOString().slice(0, 10)}`,
                dedupeMs: 20 * 60 * 60_000
            }
        );
        if (result?.sent) this.digest.consume(events.map(event => event.key));
        return { ...result, events: events.length, occurrences: events.reduce((sum, event) => sum + event.count, 0) };
    }

    /** Daily evidence review: use the same eligible paper scope as promotion. */
    async sendDailyGateSummary() {
        try {
            await this.flushTradingDigest();
            if (!tradeLogger.db) tradeLogger.initialize();
            const recorded = tradeLogger.getClosedTrades();
            const verified = recorded.filter(eligiblePaperTrade);
            const rolling = tradeLogger.getClosedTrades(30).filter(eligiblePaperTrade);
            const report = performanceCalculator.calculateReport(rolling, tradeLogger.getEquityCurve(30));
            const bee = verified.filter(isBeeStrategy);
            const pnl = verified.reduce((total, trade) => total + Number(trade.pnl || 0), 0);
            const excludedBee = recorded.filter(trade => isBeeStrategy(trade) && !eligiblePaperTrade(trade)).length;
            let beeLedger = null;
            let cycle = null;
            let mission = null;
            try { beeLedger = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/trading/soma_bee_ledger.json'), 'utf8')); } catch {}
            try { cycle = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server/.soma/asi_cycles.json'), 'utf8')).at(-1); } catch {}
            try { mission = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/trading/mission-autopilot.json'), 'utf8')); } catch {}
            const m = report.metrics || {};
            const gates = [
                ['Closed trades (30d)', `${m.totalTrades ?? 0} / 100`, (m.totalTrades ?? 0) >= 100],
                ['Win rate (30d)', `${(m.winRate ?? 0).toFixed(1)}% / 60%`, (m.winRate ?? 0) >= 60],
                ['Profit factor (30d)', `${(m.profitFactor ?? 0).toFixed(2)} / 1.4`, (m.profitFactor ?? 0) >= 1.4],
                ['Max drawdown (30d)', `${(m.maxDrawdownPct ?? 0).toFixed(1)}% / 12%`, (m.maxDrawdownPct ?? 0) <= 12]
            ];
            const beeCount = beeLedger?.bees ? Object.values(beeLedger.bees).reduce((total, row) => total + Number(row.tradesCount || 0), 0) : null;
            const beeAge = Date.now() - Date.parse(beeLedger?.lastUpdated || '');
            const localBeeLine = beeCount === null ? 'BeeBots local ledger unavailable.'
                : `BeeBots local ledger: ${beeCount} closes as of ${beeLedger.lastUpdated || 'unknown'}${Number.isFinite(beeAge) && beeAge > 30 * 60_000 ? ' (stale)' : ''}.`;
            const rsiLine = cycle ? `RSI latest cycle ${cycle.id}: ${cycle.result || 'unknown'} at ${cycle.startedAt || 'unknown'}; no retained gain is established by this cycle.`
                : 'RSI cycle evidence unavailable.';
            return await this.sendAlert(
                '📊 Daily Trading and RSI Review',
                [
                    `Central verified paper ledger: ${verified.length} lifetime closes, $${pnl.toFixed(2)} realized P&L, ${tradeLogger.getOpenTrades().length} open positions. Gate metrics below use a rolling 30-day window.`,
                    `Verified BeeBots: ${bee.length} central closes; ${excludedBee} legacy Bee rows excluded for missing paper provenance. ${localBeeLine}`,
                    `Paper mission: ${mission?.phase || 'unknown'} — ${mission?.message || 'no verified mission update'}`,
                    rsiLine,
                ].join('\n'),
                {
                    color: gates.every(g => g[2]) ? 3581519 : 15844367,
                    eventType: 'trading_daily',
                    dedupeKey: `daily-review:${new Date().toLocaleDateString('en-CA')}`,
                    dedupeMs: 20 * 60 * 60_000,
                    fields: gates.map(([name, value, pass]) => ({ name: `${pass ? '✅' : '❌'} ${name}`, value, inline: true }))
                }
            );
        } catch (e) {
            console.error('[Notifications] Daily gate summary failed:', e.message);
            return { sent: false, reason: e.message };
        }
    }

    /** Schedule at local 9:00 AM each day, including daylight-saving transitions. */
    startDailySummarySchedule() {
        if (this._dailyTimer) return;
        const scheduleNext = () => {
            const now = new Date();
            const next = new Date(now);
            next.setHours(9, 0, 0, 0);
            if (next <= now) next.setDate(next.getDate() + 1);
            this.nextDailyReviewAt = next.toISOString();
            this._dailyTimer = setTimeout(async () => {
                try { await this.sendDailyGateSummary(); }
                finally { this._dailyTimer = null; scheduleNext(); }
            }, next - now);
            this._dailyTimer.unref?.();
            console.log(`[Notifications] Daily trading and RSI review scheduled for ${next.toLocaleString()}`);
        };
        scheduleNext();
    }

    /**
     * Send a Discord webhook for a closed trade
     * @param {object} trade - The closed trade object
     */
    async sendTradeNotification(trade) {
        const pnl = Number(trade.pnl || 0);
        const pnlPct = Number(trade.pnlPct || 0);
        return this.sendAlert(
            `${pnl >= 0 ? '🟢' : '🔴'} Trade Closed: ${trade.symbol}`,
            `${String(trade.side || '').toUpperCase()} ${trade.qty} · ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%) · ${trade.reason || 'closed'}`,
            {
                color: pnl >= 0 ? 3581519 : 13632027,
                eventType: pnl < 0 ? 'trade_loss' : 'trade_closed',
                dedupeKey: `trade_closed:${trade.orderId || trade.tradeId || `${trade.symbol}:${trade.exitTime || trade.timestamp || ''}:${pnl}`}`,
                dedupeMs: 7 * 24 * 60 * 60_000,
                fields: [
                    { name: 'Entry', value: `$${Number(trade.entryPrice || 0).toFixed(2)}`, inline: true },
                    { name: 'Exit', value: `$${Number(trade.exitPrice || 0).toFixed(2)}`, inline: true }
                ]
            }
        );
    }
}

const notificationService = new NotificationService();
notificationService.startDailySummarySchedule();
export default notificationService;
