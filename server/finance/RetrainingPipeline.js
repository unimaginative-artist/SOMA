/**
 * RetrainingPipeline — The Self-Improvement Capstone
 *
 * Watches for closed trade milestones and triggers the full learning stack:
 *
 *   Every 100 closed trades:
 *     1. Force a SimLearningEngine cycle (scalping params + signal weight bulk update)
 *     2. Run MissionControlRuntime.evaluatePromotion() — checks all gates
 *     3. If gates pass → auto-promotion fires (handled inside MCR)
 *     4. Log everything to TradeLogger learning_events for dashboard visibility
 *
 * Additionally, every 5 minutes it runs a lighter heartbeat:
 *     - Checks if we've crossed a 100-trade checkpoint since last heartbeat
 *     - If so, triggers the full pipeline
 *
 * This is the "SOMA decides when she's ready for real money" system.
 */

import tradeLogger from './TradeLogger.js';
import simulationLearningEngine from './SimulationLearningEngine.js';
import missionControlRuntime from './MissionControlRuntime.js';
import fs from 'fs';
import path from 'path';

const STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'retraining-state.json');
const CHECKPOINT_INTERVAL = 100;  // Trigger full pipeline every N closed trades
const HEARTBEAT_MS = 5 * 60 * 1000; // Check every 5 minutes

class RetrainingPipeline {
    constructor() {
        this._intervalId = null;
        this.state = {
            lastCheckpointTradeCount: 0,
            totalPipelineRuns: 0,
            lastRunAt: null,
            lastPromotionResult: null,
            checkpoints: []
        };
        this._loadState();
    }

    start() {
        if (this._intervalId) return;
        console.log('[RetrainingPipeline] Started — watching for trade milestones');
        this._intervalId = setInterval(() => {
            this._heartbeat().catch(err => {
                console.warn('[RetrainingPipeline] Heartbeat error:', err.message);
            });
        }, HEARTBEAT_MS);

        // Run initial check after 60s to let the system stabilize
        setTimeout(() => this._heartbeat().catch(() => {}), 60_000);
    }

    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    async _heartbeat() {
        const stats = tradeLogger.getStats(90);
        const currentTotal = stats.totalTrades || 0;
        const lastCheckpoint = this.state.lastCheckpointTradeCount;

        // Have we crossed a 100-trade boundary since the last run?
        const lastBoundary = Math.floor(lastCheckpoint / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;
        const currentBoundary = Math.floor(currentTotal / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;

        if (currentBoundary > lastBoundary && currentTotal >= CHECKPOINT_INTERVAL) {
            console.log(`[RetrainingPipeline] Checkpoint hit: ${currentTotal} trades (last was ${lastCheckpoint})`);
            await this._runPipeline(currentTotal, stats);
        }
    }

    async _runPipeline(tradeCount, stats) {
        const runId = `pipeline_${Date.now()}`;
        console.log(`[RetrainingPipeline] Running full pipeline (${tradeCount} trades, run #${this.state.totalPipelineRuns + 1})`);

        // Step 1: Force learning cycle — adjusts scalping params + bulk-updates signal weights
        let cycleResult = null;
        try {
            cycleResult = await simulationLearningEngine.forceCycle();
            console.log(`[RetrainingPipeline] Learning cycle: ${cycleResult.adjustments?.length || 0} adjustments, signal weights updated`);
        } catch (err) {
            console.warn('[RetrainingPipeline] Learning cycle failed:', err.message);
        }

        // Step 2: Evaluate promotion — all gates checked, auto-promote fires if ready
        let promotionResult = null;
        try {
            promotionResult = missionControlRuntime.evaluatePromotion({ recordEvidence: true });
            console.log(`[RetrainingPipeline] Promotion eval: ${promotionResult.approved ? 'APPROVED' : 'NOT YET'} (tier: ${promotionResult.activeTier})`);
            if (promotionResult.approved) {
                console.log('[RetrainingPipeline] *** ALL PROMOTION GATES PASSED — auto-promotion firing ***');
            } else {
                const failed = Object.entries(promotionResult.checks || {})
                    .filter(([, v]) => !v).map(([k]) => k);
                console.log(`[RetrainingPipeline] Gates still needed: ${failed.join(', ')}`);
            }
        } catch (err) {
            console.warn('[RetrainingPipeline] Promotion evaluation failed:', err.message);
        }

        // Step 3: Log checkpoint to learning_events for dashboard visibility
        try {
            tradeLogger.logLearningEvent({
                eventType: 'RETRAINING_CHECKPOINT',
                description: `Pipeline run #${this.state.totalPipelineRuns + 1}: ${tradeCount} trades, tier=${promotionResult?.activeTier || '?'}, approved=${promotionResult?.approved || false}`,
                strategy: promotionResult?.activeStrategy?.strategyId || 'unknown',
                metricName: 'closedTrades',
                oldValue: this.state.lastCheckpointTradeCount,
                newValue: tradeCount,
                triggerReason: runId
            });
        } catch { /* non-fatal */ }

        // Update state
        this.state.totalPipelineRuns++;
        this.state.lastCheckpointTradeCount = tradeCount;
        this.state.lastRunAt = new Date().toISOString();
        this.state.lastPromotionResult = promotionResult ? {
            approved: promotionResult.approved,
            activeTier: promotionResult.activeTier,
            checks: promotionResult.checks,
            evaluatedAt: promotionResult.evaluatedAt
        } : null;
        this.state.checkpoints.push({
            runId,
            tradeCount,
            adjustments: cycleResult?.adjustments?.length || 0,
            promoted: promotionResult?.approved || false,
            tier: promotionResult?.activeTier || null,
            runAt: this.state.lastRunAt
        });
        if (this.state.checkpoints.length > 100) {
            this.state.checkpoints = this.state.checkpoints.slice(-100);
        }
        this._saveState();

        return { runId, tradeCount, cycleResult, promotionResult };
    }

    /**
     * Force a pipeline run immediately (for API/testing)
     */
    async forceRun() {
        const stats = tradeLogger.getStats(90);
        return this._runPipeline(stats.totalTrades || 0, stats);
    }

    getState() {
        return {
            isRunning: !!this._intervalId,
            checkpointInterval: CHECKPOINT_INTERVAL,
            heartbeatMs: HEARTBEAT_MS,
            ...this.state
        };
    }

    _loadState() {
        try {
            if (fs.existsSync(STATE_PATH)) {
                const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
                this.state = { ...this.state, ...saved };
            }
        } catch { /* fresh start */ }
    }

    _saveState() {
        try {
            const dir = path.dirname(STATE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.warn('[RetrainingPipeline] State save failed:', err.message);
        }
    }
}

const retrainingPipeline = new RetrainingPipeline();
export default retrainingPipeline;
