/**
 * SomaBeeService.js
 *
 * Autonomous background service orchestrating SOMA BeeBots:
 *  - Ticks market data every 60s
 *  - Evaluates Laya System 1 decision substrate on RTX 5070
 *  - Enforces 1R risk and paper ledger accounting
 *  - Broadcasts live trade alerts and hourly digests to Discord #soma-chat
 */

import { BeeMarketFeed } from './BeeMarketFeed.js';
import { SomaBeeTradingEngine } from './SomaBeeTradingEngine.js';
import { BeeDiscordReporter } from './BeeDiscordReporter.js';
import fs from 'fs';
import path from 'path';
import { allowsAutonomousEntries, normalizeTradingIntent } from '../finance/TradingIntentPolicy.js';

export class SomaBeeService {
    constructor(options = {}) {
        this.tickIntervalMs = options.tickIntervalMs || 60000; // 60s default
        this.digestIntervalMs = options.digestIntervalMs || 3600000; // 1 hour default
        this.feed = options.feed || new BeeMarketFeed();
        this.engine = options.engine || new SomaBeeTradingEngine({ feed: this.feed, ...options });
        this.reporter = options.reporter || new BeeDiscordReporter();
        this.intentPath = options.intentPath || path.join(process.cwd(), 'data', 'trading', 'trading-intent.json');
        
        this.isRunning = false;
        this.tickTimer = null;
        this.digestTimer = null;
        this.lastTickTime = null;
        this.lastSharedTuningVersion = null;

        this._setupEventHooks();
    }

    _setupEventHooks() {
        this.engine.on('onTradeOpen', async (data) => {
            console.log(`[SomaBeeService] 🚀 Trade Opened: ${data.beeName} ${data.position.side} ${data.position.symbol} @ ${data.position.entryPrice}`);
            await this.reporter.postTradeOpen(data);
        });

        this.engine.on('onTradeClose', async (trade) => {
            console.log(`[SomaBeeService] 🏁 Trade Closed: ${trade.beeName} ${trade.side} ${trade.symbol} PnL: $${trade.pnl} (${trade.rMultiple}R)`);
            await this.reporter.postTradeClose(trade);
        });

        this.engine.on('onError', (err) => {
            console.error('[SomaBeeService] Engine error:', err);
        });
    }

    /**
     * Start the autonomous trading loop
     */
    async start() {
        if (this.isRunning) return;
        if (!this._entriesAllowed()) throw new Error('Trading intent is stopped; BeeBots cannot start');
        this.isRunning = true;

        console.log('[SomaBeeService] 🐝 Starting SOMA BeeBots Autonomous Trading Service...');

        // Connect Discord reporter in background
        await this.reporter.connect();

        // Run immediate initial tick
        await this.tick();

        // Schedule recurring ticks
        this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);

        // Schedule hourly digest
        this.digestTimer = setInterval(() => this.sendDigest(), this.digestIntervalMs);

        const regime = this.engine.regimeAdapter?.getCurrentRegime() || 'RANGING';
        console.log(`[SomaBeeService] 🐝 Neocortex Swarm active. CNS Broker: Connected | Regime: ${regime} | RiskGate: Active`);
        console.log(`[SomaBeeService] ✅ BeeBots active. Tick rate: ${this.tickIntervalMs / 1000}s, Digest rate: ${this.digestIntervalMs / 60000}m`);
    }

    /**
     * Run a single tick
     */
    async tick() {
        try {
            this.lastTickTime = new Date().toISOString();
            const allowEntries = this._entriesAllowed();
            if (!allowEntries && !Object.values(this.engine.state.bees || {}).some(bee => bee.position)) {
                return { skipped: true, reason: 'trading_intent_stopped' };
            }
            this._refreshSharedTuning();
            const report = await this.engine.tick({ allowEntries });
            return report;
        } catch (err) {
            console.error('[SomaBeeService] Tick execution failed:', err.message);
            return null;
        }
    }

    _refreshSharedTuning() {
        const bridge = this.engine.prometheusBridge;
        if (!bridge?.loadSharedParameters || !bridge?.applyParametersToSwarm) return;
        try {
            const shared = bridge.loadSharedParameters();
            const version = shared?.source === 'prometheus_market_lab_default'
                ? 'default' : `${shared?.source || ''}:${shared?.updatedAt || ''}`;
            if (version === this.lastSharedTuningVersion) return;
            if (bridge.applyParametersToSwarm(this.engine)) this.lastSharedTuningVersion = version;
        } catch (error) {
            console.warn('[SomaBeeService] Shared tuning refresh failed:', error.message);
        }
    }

    _entriesAllowed() {
        try {
            const intent = JSON.parse(fs.readFileSync(this.intentPath, 'utf8'));
            return allowsAutonomousEntries(normalizeTradingIntent(intent));
        } catch {
            return false;
        }
    }

    /**
     * Send portfolio digest to Discord
     */
    async sendDigest() {
        try {
            const summary = this.engine.getPortfolioSummary();
            await this.reporter.postDigest(summary);
            console.log('[SomaBeeService] 📊 Posted hourly portfolio digest to Discord.');
        } catch (err) {
            console.error('[SomaBeeService] Failed to post digest:', err.message);
        }
    }

    /**
     * Stop the service
     */
    async stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.tickTimer) clearInterval(this.tickTimer);
        if (this.digestTimer) clearInterval(this.digestTimer);
        if (this.engine?.swarmBroker) this.engine.swarmBroker.destroy();
        await this.reporter.destroy();
        console.log('[SomaBeeService] 🛑 SOMA BeeBots Service stopped.');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            lastTickTime: this.lastTickTime,
            tickIntervalMs: this.tickIntervalMs,
            regime: this.engine.regimeAdapter?.getCurrentRegime() || 'RANGING',
            riskSummary: this.engine.riskGate?.getRiskSummary(),
            portfolio: this.engine.getPortfolioSummary()
        };
    }
}

// Support running directly via `node server/trading/SomaBeeService.js`
if (process.argv[1] && process.argv[1].endsWith('SomaBeeService.js')) {
    const service = new SomaBeeService();
    service.start().catch(err => {
        console.error('Fatal in SomaBeeService:', err);
        process.exit(1);
    });

    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT. Shutting down gracefully...');
        await service.stop();
        process.exit(0);
    });
}
