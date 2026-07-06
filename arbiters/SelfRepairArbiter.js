import BaseArbiterV4 from "./BaseArbiter.js";

export class SelfRepairArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super(config);
        this.name = "SelfRepairArbiter";
    }

    async initialize(deps = {}) {
        await super.initialize(deps);
        this.messageBroker = deps.messageBroker || this.system?.messageBroker;
        this.toolRegistry = deps.toolRegistry || this.system?.toolRegistry;

        if (this.messageBroker) {
            this.messageBroker.subscribeByLobe("PROMETHEUS", "soma.goal.completed", async (envelope) => {
                const goal = envelope.payload?.goal || {};
                
                const isSelfRepair = goal.metadata?.self_repair === true || goal.category === "engineering";
                
                if (isSelfRepair) {
                    this.logger?.info(`[${this.name}] Detected completed self-repair/engineering goal: ${goal.title}`);
                    await this._triggerMarionetteRestart(goal);
                }
            });
        }
    }

    async _triggerMarionetteRestart(goal) {
        if (!this.toolRegistry) return;
        
        try {
            this.logger?.info(`[${this.name}] Requesting safe Marionette restart to load new codebase changes...`);
            const restartTool = this.toolRegistry.getTool("request_self_restart");
            
            if (restartTool) {
                const result = await restartTool.execute({ 
                    reason: `Completed self-repair goal: ${goal.title}`,
                    rollback: true 
                });
                this.logger?.info(`[${this.name}] Restart tool response: ${result}`);
            } else {
                this.logger?.warn(`[${this.name}] Cannot request restart: request_self_restart tool not found in registry.`);
            }
        } catch (e) {
            this.logger?.error(`[${this.name}] Failed to trigger Marionette restart: ${e.message}`);
        }
    }
}
