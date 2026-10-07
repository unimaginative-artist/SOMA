/**
 * StrategyCortexArbiter.js
 * 
 * THE PLANNING LOBE (Governed by PROMETHEUS)
 * 
 * Unifies simulation and strategic planning:
 * - GoalPlannerArbiter (High-level directive management)
 * - FinanceAgentArbiter (Economic/Market strategy)
 * - ForecasterArbiter (Predictive modeling)
 * - CausalityArbiter (Causal graph reasoning)
 * - SimulationArbiter (Embodied physics)
 * - QuantumSimulationArbiter (Complex circuit logic)
 * 
 * PURPOSE: 
 * Manages SOMA's future-state modeling.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class StrategyCortexArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'StrategyCortex',
            role: ArbiterRole.STRATEGY_CORTEX,
            capabilities: [
                ArbiterCapability.HIGH_LEVEL_PLANNING, 
                ArbiterCapability.MARKET_ANALYSIS, 
                ArbiterCapability.CAUSAL_REASONING, 
                ArbiterCapability.SIMULATIONS
            ],
            ...config
        });

        // 1. Strategic Organs (The "Forebrain")
        this.planner = config.planner || null;
        this.finance = config.finance || null;
        this.forecaster = config.forecaster || null;
        this.causality = config.causality || null;
        this.sim = config.sim || null;
        this.quantum = config.quantum || null;
    }

    async onInitialize() {
        this.log('info', '🔭  Initializing Strategy Cortex (Planning Lobe)...');
        
        // Ensure Causality graph is loaded
        if (this.causality && !this.causality.initialized) await this.causality.initialize();
        
        this.log('info', '✅ Planning and Simulation unified under PROMETHEUS governance');
    }

    /**
     * Synthesize Future State
     * Runs simulations across physical, economic, and causal domains.
     */
    async simulateFuture(action) {
        const scenario = {
            causalImpact: this.causality ? await this.causality.predict(action) : null,
            financialImpact: this.finance ? await this.finance.analyzeRisk(action) : null,
            physicsImpact: this.sim ? await this.sim.predictOutcome(action) : null
        };
        
        return scenario;
    }

    /**
     * Get Current Master Directive
     */
    async getCurrentGoal() {
        return this.planner?.getActiveGoal() || "Evolution";
    }

    getStatus() {
        return {
            activeSimulations: this.sim?.isRunning() ? 1 : 0,
            financeStatus: this.finance?.getStatus() || 'idle',
            causalityNodes: this.causality?.getNodeCount() || 0
        };
    }
}
