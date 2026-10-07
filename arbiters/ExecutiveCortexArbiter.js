/**
 * ExecutiveCortexArbiter.js
 * 
 * THE ACTION LOBE (Governed by LOGOS)
 * 
 * Unifies all implementation and execution capabilities:
 * - ComputerControlArbiter (Desktop Interaction)
 * - DeploymentArbiter (Production Rollouts)
 * - ReflexArbiter (Fast Muscle Memory)
 * - EngineeringSwarmArbiter (Adversarial Coding)
 * - ToolCreatorArbiter (Meta-Tool Generation)
 * - SelfModificationArbiter (Evolution)
 * 
 * PURPOSE: 
 * Coordinates SOMA's "Hands." Uses the TemporalLoom to prevent 
 * race conditions during complex implementation tasks.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { loom } from '../core/TemporalLoom.js';

export class ExecutiveCortexArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'ExecutiveCortex',
            role: ArbiterRole.EXECUTIVE_CORTEX,
            capabilities: [
                ArbiterCapability.EXECUTE_TASK, 
                ArbiterCapability.MODIFY_CODE, 
                ArbiterCapability.DEPLOY_SYSTEM, 
                ArbiterCapability.REFLEX_EXECUTION
            ],
            ...config
        });

        // 1. Implementation Organs (The "Hands")
        this.computerControl = config.computerControl || null;
        this.deployment = config.deployment || null;
        this.reflex = config.reflex || null;
        this.swarm = config.swarm || null;
        this.toolCreator = config.toolCreator || null;
        this.selfMod = config.selfMod || null;
        this.skillWatcher = config.skillWatcher || null;
    }

    async onInitialize() {
        this.log('info', '🛠️  Initializing Executive Cortex (Action Lobe)...');
        
        // Ensure all components are ready
        if (this.reflex && !this.reflex.initialized) await this.reflex.initialize();
        if (this.swarm && !this.swarm.initialized) await this.swarm.initialize();
        if (this.skillWatcher && !this.skillWatcher.initialized) await this.skillWatcher.initialize();
        
        this.log('info', '✅ Executive capabilities unified under LOGOS governance');
    }

    /**
     * Execute Action with Cognitive Locking
     * Ensures SOMA doesn't trip over herself.
     */
    async execute(actionType, params, owner = 'ExecutiveCortex') {
        const resource = actionType === 'modify-code' ? 'filesystem' : 'system-state';
        
        // Acquire lock from TemporalLoom
        await loom.acquireLock(resource, owner);
        
        try {
            switch (actionType) {
                case 'reflex':
                    return await this.reflex.execute(params.chainId, params.input);
                
                case 'code-modification':
                    if (this.swarm) return await this.swarm.optimize(params.target);
                    if (this.selfMod) return await this.selfMod.propose(params);
                    break;
                    
                case 'create-tool':
                    return await this.toolCreator.generateTool(params.description);
                    
                case 'deploy':
                    return await this.deployment.run(params);
                    
                case 'computer-action':
                    return await this.computerControl.execute(params);
                    
                default:
                    throw new Error(`Unknown action type: ${actionType}`);
            }
        } finally {
            // Always release lock
            loom.releaseLock(resource, owner);
        }
    }

    /**
     * Reflex Shortcut
     * Bypasses heavy logic for "muscle memory" tasks
     */
    async triggerReflex(input) {
        if (!this.reflex) return null;
        return await this.reflex.handleMessage({ payload: input });
    }

    /**
     * S.T.E.V.E. Chat Interface
     * Handles direct commands and conversation for the Builder persona.
     */
    async chat(message, context = {}) {
        this.log('info', `[S.T.E.V.E.] Hearing: "${message}"`);
        
        const lowerMsg = message.toLowerCase();

        // 1. Check for Skill Execution (Plugin System)
        if (this.skillWatcher) {
            const skills = this.skillWatcher.getSkills('steve');
            for (const skill of skills) {
                // Simple keyword matching for now
                if (lowerMsg.includes(skill.name.replace('_', ' '))) {
                    this.log('info', `[S.T.E.V.E.] Triggering skill: ${skill.name}`);
                    try {
                        const result = await skill.execute({ greeting: message }); // Pass full message as context
                        return { 
                            success: true, 
                            response: result.message || JSON.stringify(result),
                            action: 'skill_executed',
                            skill: skill.name
                        };
                    } catch (e) {
                        return { success: false, response: `Skill ${skill.name} crashed: ${e.message}` };
                    }
                }
            }
        }

        // 2. Check for Tool Creation
        if (lowerMsg.includes('create tool') || lowerMsg.includes('make a skill')) {
            if (this.toolCreator) {
                // trigger tool creation flow (simplified)
                return { success: true, response: "I can build that. Describe the inputs and outputs." };
            }
        }

        // 3. Default "Grumpy Architect" Response (if no brain attached)
        const responses = [
            "I'm listening, but I'm not impressed yet.",
            "Is this ticket high priority? Doesn't look like it.",
            "I'm optimizing the file system. Make it quick.",
            "Code doesn't write itself. Well, actually, I write it. What do you want?",
            "System nominal. User inputs... questionable."
        ];
        
        return { 
            success: true, 
            response: responses[Math.floor(Math.random() * responses.length)] 
        };
    }

    getStatus() {
        return {
            status: 'online',
            reflexes: this.reflex?.getStats() || {},
            swarmActive: !!this.swarm,
            currentLocks: Array.from(loom.locks.keys())
        };
    }
}
