import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

/**
 * MissionControlArbiter
 *
 * Live trading system coordinator that aggregates real-time state from
 * all SOMA trading subsystems (risk, positions, regime, learning).
 */
export class MissionControlArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'MissionControlArbiter',
            role: ArbiterRole.CONDUCTOR,
            capabilities: [
                ArbiterCapability.MEMORY_ACCESS,
                ArbiterCapability.COORDINATE_ASI
            ]
        });

        this._lastRegime = null;
        this._statusCache = null;
        this._statusCacheTime = 0;
    }

    async onInitialize() {
        this.log('Mission Control Systems Online — live state aggregation active');
    }

    /**
     * Get comprehensive mission status by querying all trading subsystems
     */
    async getStatus() {
        // Cache for 2s to avoid hammering subsystems
        if (this._statusCache && Date.now() - this._statusCacheTime < 2000) {
            return this._statusCache;
        }

        const trading = global.SOMA_TRADING || {};
        const status = {
            active: true,
            timestamp: Date.now()
        };

        // ── Risk state ──
        if (trading.riskManager) {
            const riskState = trading.riskManager.riskState || {};
            status.risk = {
                isHalted: riskState.isHalted || false,
                haltReason: riskState.haltReason || null,
                dailyPnL: riskState.dailyPnL || 0,
                openRisk: riskState.openRisk || 0
            };
        }

        // ── Positions from guardian ──
        if (trading.guardian) {
            const positions = trading.guardian.trackedPositions || new Map();
            status.positions = {
                count: positions.size,
                symbols: [...positions.keys()]
            };
        }

        // ── Market regime ──
        if (trading.regimeDetector) {
            status.regime = {
                type: trading.regimeDetector.currentRegime || 'UNKNOWN',
                confidence: trading.regimeDetector.confidence || 0
            };
            this._lastRegime = status.regime;
        } else {
            status.regime = this._lastRegime || { type: 'NOT_LOADED', confidence: 0 };
        }

        // ── Learning state ──
        if (trading.simulationLearningEngine) {
            try {
                const learnState = trading.simulationLearningEngine.getState?.();
                status.learning = {
                    cyclesCompleted: learnState?.cyclesCompleted || 0,
                    lastCycle: learnState?.lastCycleTime || null,
                    totalAdjustments: learnState?.totalAdjustments || 0
                };
            } catch (e) {
                status.learning = { error: e.message };
            }
        }

        // ── Trade stats from logger ──
        if (trading.tradeLogger) {
            try {
                const stats = trading.tradeLogger.getStats?.();
                status.tradeStats = {
                    totalTrades: stats?.totalTrades || 0,
                    winRate: stats?.winRate || 0,
                    totalPnl: stats?.totalPnl || 0
                };
            } catch (e) {
                status.tradeStats = { error: e.message };
            }
        }

        // ── Broker connectivity ──
        if (trading.alpacaService) {
            status.broker = {
                connected: trading.alpacaService.isConnected || false,
                mode: trading.alpacaService.isPaperTrading ? 'paper' : 'live'
            };
        }

        // ── Alert level derived from state ──
        if (status.risk?.isHalted) {
            status.alertLevel = 'RED';
            status.currentMission = `HALTED: ${status.risk.haltReason || 'Risk limit breached'}`;
        } else if ((status.risk?.dailyPnL || 0) < -200) {
            status.alertLevel = 'AMBER';
            status.currentMission = 'Active Trading — Elevated Drawdown';
        } else if (status.positions?.count > 0) {
            status.alertLevel = 'GREEN';
            status.currentMission = `Active Trading — ${status.positions.count} position(s)`;
        } else {
            status.alertLevel = 'GREEN';
            status.currentMission = 'Monitoring — Ready to trade';
        }

        this._statusCache = status;
        this._statusCacheTime = Date.now();
        return status;
    }
}

export default MissionControlArbiter;
