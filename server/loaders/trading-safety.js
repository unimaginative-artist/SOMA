/**
 * Trading Safety Loader
 *
 * Bootstrap Phase 4.5: Creates and wires together the trading safety stack:
 * - RiskManager: Position sizing, stop/TP tracking, portfolio risk limits
 * - TradingGuardrails: Per-trade validation (size, daily loss, cooldown, etc.)
 * - PositionGuardian: Background loop that enforces stops server-side
 *
 * Called between Plugins (Phase 4) and WebSocket (Phase 5) in SomaBootstrapV2.
 */

import { RiskManager } from '../../arbiters/RiskManager.js';
import TradingGuardrails from '../../server/finance/TradingGuardrails.js';
import PositionGuardian from '../../server/finance/PositionGuardian.js';
import alpacaService from '../../server/finance/AlpacaService.js';
import tradeLogger from '../../server/finance/TradeLogger.js';
import simulationLearningEngine from '../../server/finance/SimulationLearningEngine.js';
import missionControlRuntime from '../../server/finance/MissionControlRuntime.js';
import retrainingPipeline from '../../server/finance/RetrainingPipeline.js';
import driftDetector from '../../server/finance/DriftDetector.js';
import abTestFramework from '../../server/finance/ABTestFramework.js';
import marketRegimeDetector from '../../server/finance/MarketRegimeDetector.js';
import simToLiveDaemon from '../../server/finance/SimToLiveDaemon.js';

export async function loadTradingSafety(system) {
    console.log('\n[Loader] Trading Safety Systems...');

    try {
        // 1. Risk Manager (Kelly Criterion, drawdown, stop/TP tracking)
        const riskManager = new RiskManager({
            rootPath: process.cwd(),
            portfolioOptimizer: system.portfolioOptimizer || null,
            correlationDetector: system.correlationDetector || null
        });
        await riskManager.initialize();

        // 2. Trading Guardrails (per-trade safety checks)
        // Use percentage-based limits so they scale with any account size ($100 → $100K)
        const guardrails = new TradingGuardrails({
            maxTradeValue: Infinity,    // Disabled — use maxPositionSize % instead
            maxDailyLoss: Infinity,     // Disabled — use maxDailyLossPct instead
            maxDailyLossPct: 0.05,      // Stop after 5% daily loss
            maxDailyTrades: 50,
            minConfidence: 0.5,
            cooldownMs: 5000,
            maxPositionSize: 0.15,      // Max 15% of portfolio per trade
            requireMarketHours: false   // Allow crypto 24/7
        });

        // 3. Trade Logger (SQLite persistence for every trade)
        tradeLogger.initialize();

        // 3b. Mission Control Runtime (learned strategy spine + audit journal)
        missionControlRuntime.initialize({
            tradeLogger,
            riskManager,
            guardrails,
            simulationLearningEngine
        });

        // 4. Position Guardian (background enforcement)
        const guardian = new PositionGuardian({
            alpacaService,
            riskManager,
            guardrails,
            tradeLogger,
            dashboardClients: null  // Will be wired after WebSocket phase
        });

        // Auto-reconcile if broker is already connected (from auto-connect)
        if (alpacaService.isConnected) {
            const reconcileResult = await guardian.reconcile();
            console.log(`[TradingSafety] Reconciled: ${reconcileResult.brokerPositions || 0} positions, ${reconcileResult.orphanedPositions || 0} orphaned`);
        }

        // Start the guardian loop
        guardian.start();

        // Listen for RiskManager events
        riskManager.on('risk:trading_halted', (data) => {
            console.error(`[TradingSafety] TRADING HALTED: ${data.reason}`);
        });

        riskManager.on('risk:stop_loss_triggered', (data) => {
            console.log(`[TradingSafety] Stop loss triggered: ${data.symbol} @ $${data.currentPrice}`);
        });

        riskManager.on('risk:take_profit_triggered', (data) => {
            console.log(`[TradingSafety] Take profit triggered: ${data.symbol} @ $${data.currentPrice}`);
        });

        // Start the simulation learning engine (learns from paper trades)
        simulationLearningEngine.start();

        // Start the retraining pipeline (triggers full learning stack every 100 closed trades)
        retrainingPipeline.start();

        // Start the drift detector (15min Sharpe watchdog — cuts positions if strategy degrades)
        driftDetector.start();

        // Start the market regime detector (tracks 5 regimes per symbol for regime-conditioned UCB1)
        // Dash format matches what AutonomousTrader passes to getRegime(symbol);
        // slash-format keys silently fell back to the SPY anchor regime.
        const REGIME_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'BTC-USD', 'ETH-USD', 'SOL-USD'];
        marketRegimeDetector.start(REGIME_WATCHLIST);

        // Start sim-to-live reconciliation: sim nominates, paper validates, live stays human-gated.
        simToLiveDaemon.start({ intervalMs: 5 * 60 * 1000, initialDelayMs: 45000 });

        // A/B framework initializes on import (no separate start needed)

        // Expose on global for financeRoutes to use the shared instances
        global.SOMA_TRADING = {
            riskManager,
            guardrails,
            guardian,
            tradeLogger,
            alpacaService,
            simulationLearningEngine,
            missionControlRuntime,
            retrainingPipeline,
            driftDetector,
            abTestFramework,
            regimeDetector: marketRegimeDetector,
            simToLiveDaemon,
        };

        console.log('      Risk Manager initialized (Kelly Criterion, 8 risk checks)');
        console.log('      Trading Guardrails active (size, loss, cooldown, position limits)');
        console.log('      Trade Logger active (SQLite at data/trading/trades.db)');
        console.log('      Mission Control Runtime active (market lab learning, paper/live gates, audit journal)');
        console.log('      Position Guardian running (5s polling, stop/TP enforcement)');
        console.log('      Simulation Learning Engine active (5min cycle, adaptive parameters)');
        console.log('      Retraining Pipeline active (every 100 trades: learn → evaluate promotion)');
        console.log('      Drift Detector active (15min Sharpe watchdog, defensive mode on 20% drop)');
        console.log('      A/B Test Framework active (parallel parameter testing, z-test promotion)');
        console.log('      Market Regime Detector active (TRENDING/RANGING/VOLATILE/CRASH — 5 regimes per symbol)');
        console.log('      Sim-to-Live Daemon active (sim nominees → paper evidence → human-gated live candidates)');

        return {
            riskManager,
            guardrails,
            guardian,
            tradeLogger,
            simulationLearningEngine,
            missionControlRuntime
        };
    } catch (error) {
        console.error('[TradingSafety] Failed to initialize (trading will work without safety):', error.message);
        return {
            riskManager: null,
            guardrails: null,
            guardian: null
        };
    }
}
