/**
 * BeeDiscordReporter.js
 *
 * Dedicated Discord reporting gateway for SOMA BeeBots.
 * Streams real-time trade execution cards, risk notifications, and hourly performance digests
 * into #soma-chat via Soma#3807.
 */

import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

export const DEFAULT_CHANNEL_ID = null; // Set SOMA_TRADING_DISCORD_CHANNEL at runtime

export class BeeDiscordReporter {
    constructor(options = {}) {
        this.channelId = options.channelId || process.env.SOMA_TRADING_DISCORD_CHANNEL || DEFAULT_CHANNEL_ID;
        this.token = options.token || process.env.DISCORD_BOT_TOKEN;
        this.client = null;
        this.connected = false;
        this.connecting = false;
        this.queue = [];
        this.rateLimitDelay = 1000;
    }

    /**
     * Connect to Discord Gateway
     */
    async connect() {
        if (this.connected && this.client) return this.client;
        if (this.connecting) return;
        if (!this.token) {
            console.warn('[BeeDiscordReporter] No DISCORD_BOT_TOKEN found in environment. Discord notifications disabled.');
            return null;
        }

        this.connecting = true;
        try {
            this.client = new Client({
                intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
            });

            await new Promise((resolve, reject) => {
                this.client.once('ready', () => {
                    this.connected = true;
                    this.connecting = false;
                    console.log(`[BeeDiscordReporter] Connected to Discord as ${this.client.user.tag}`);
                    resolve(this.client);
                });
                this.client.once('error', (err) => {
                    this.connecting = false;
                    reject(err);
                });
                this.client.login(this.token).catch(reject);
            });

            return this.client;
        } catch (err) {
            this.connecting = false;
            console.error('[BeeDiscordReporter] Connection failed:', err.message);
            return null;
        }
    }

    /**
     * Send raw text or message options to the trading Discord channel
     */
    async send(payload) {
        try {
            if (!this.connected) {
                await this.connect();
            }
            if (!this.client || !this.connected) {
                console.warn('[BeeDiscordReporter] Discord offline, skipped message:', typeof payload === 'string' ? payload.slice(0, 80) : 'embed');
                return null;
            }

            const channel = await this.client.channels.fetch(this.channelId);
            if (!channel) {
                console.error(`[BeeDiscordReporter] Channel ${this.channelId} not found`);
                return null;
            }

            return await channel.send(payload);
        } catch (err) {
            console.error('[BeeDiscordReporter] Failed to send message:', err.message);
            return null;
        }
    }

    /**
     * Post a trade entry card
     */
    async postTradeOpen(data) {
        const { bee, beeName, position } = data;
        const emoji = bee === 'bizzy' ? '⚡' : bee === 'boozy' ? '🍸' : '🍃';
        const sideColor = position.side === 'LONG' ? 0x00FF88 : 0xFF3366; // Green / Red

        const convictionText = ['None (0/3)', 'Weak (1/3)', 'Moderate (2/3)', 'Strong (3/3)'][position.conviction] || `${position.conviction}/3`;

        const msg = [
            `${emoji} **${beeName}** [OPENED ${position.side} ${position.symbol}]`,
            `> • **Entry Price**: \`$${position.entryPrice.toLocaleString()}\``,
            `> • **Hard Stop Loss**: \`$${position.stopLoss.toLocaleString()}\``,
            `> • **Take Profit Target**: \`$${position.takeProfit.toLocaleString()}\` (Adaptive ATR)`,
            `> • **Position Size**: \`${position.size}\` (1R Risk Budget)`,
            `> • **Regime**: \`${position.regime || 'RANGING'}\` | **Swarm Bias**: \`${position.macroBias || 'NEUTRAL'}\``,
            `> • **Conviction**: \`${convictionText}\` | Model: \`Laya System 1 (ModernBERT RTX 5070)\``,
            `> • **Enterprise Risk**: \`Approved (Delta Guard Active)\``
        ].join('\n');

        return await this.send(msg);
    }

    /**
     * Post a trade exit card with realized PnL and R-multiple
     */
    async postTradeClose(trade) {
        const emoji = trade.bee === 'bizzy' ? '⚡' : trade.bee === 'boozy' ? '🍸' : '🍃';
        const isProfit = trade.pnl >= 0;
        const sign = isProfit ? '+' : '';
        const pnlEmoji = isProfit ? '🟢' : '🔴';

        const msg = [
            `${pnlEmoji} ${emoji} **${trade.beeName}** [CLOSED ${trade.side} ${trade.symbol}]`,
            `> • **Exit Price**: \`$${trade.exitPrice.toLocaleString()}\` (Reason: \`${trade.exitReason}\`)`,
            `> • **Realized PnL**: \`${sign}$${trade.pnl.toFixed(2)}\` (\`${sign}${trade.rMultiple}R\`)`,
            `> • **Entry Price**: \`$${trade.entryPrice.toLocaleString()}\``,
            `> • **Notional Value**: \`$${trade.notional.toLocaleString()}\``,
            `> • **Timestamp**: <t:${Math.floor(Date.now() / 1000)}:R>`
        ].join('\n');

        return await this.send(msg);
    }

    /**
     * Post hourly / periodic portfolio performance digest
     */
    async postDigest(summary) {
        const sign = summary.totalReturnPct >= 0 ? '+' : '';
        const statusEmoji = summary.totalReturnPct >= 0 ? '📈' : '📉';

        const lines = [
            `🐝 **SOMA BeeBots Portfolio Digest** ${statusEmoji}`,
            `*System 1 Substrate Laya (ModernBERT-large) • Port 5055 • RTX 5070*`,
            `*Source: ${summary.sourceSystem || 'SOMA BeeBots'} / ${summary.account || 'beebots_paper'} • As of ${summary.asOf || 'unknown'} UTC • Scope: ${(summary.symbolScope || []).join(', ') || 'configured Bee swaps'}*`,
            `*Window: ${summary.timeWindow?.start || 'ledger inception'} to ${summary.timeWindow?.end || 'current'}; promotion gate: ${summary.promotionGateWindow || 'separate 30-day window'}*`,
            ``,
            `**Portfolio Overview**:`,
            `• **Total Equity**: \`$${summary.totalEquity.toFixed(2)}\` (\`${sign}${summary.totalReturnPct}%\`)`,
            `• **Starting Pool**: \`$${summary.totalInitialCapital.toFixed(2)}\` | **Available Cash**: \`$${summary.totalCash.toFixed(2)}\``,
            `• **Total Realized PnL**: \`$${summary.totalRealizedPnl.toFixed(2)}\``,
            `• **Unrealized PnL**: \`$${Number(summary.totalUnrealizedPnl || 0).toFixed(2)}\` | **Open Positions**: \`${summary.openPositions ?? 0}\``,
            `• **Win Rate**: \`${summary.totalWinRate}%\` (${summary.totalTrades} completed trades)`,
            ``,
            `**The 3 Bees**:`,
        ];

        for (const [key, bee] of Object.entries(summary.bees)) {
            const pos = bee.position ? `**${bee.position.side}** @ $${bee.position.entryPrice}` : 'Flat (Searching)';
            lines.push(`${bee.emoji} **${bee.name}** (\`${bee.pair}\`): Equity: \`$${bee.equity.toFixed(2)}\` | State: ${pos} | WinRate: \`${bee.winRatePct}%\``);
        }

        return await this.send(lines.join('\n'));
    }

    /**
     * Close Discord client connection
     */
    async destroy() {
        if (this.client) {
            await this.client.destroy();
            this.connected = false;
            this.client = null;
        }
    }
}
