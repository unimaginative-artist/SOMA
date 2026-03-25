import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.cjs';
import { SwarmEngine, SwarmTask } from './EngineeringSwarmRuntime.js';
import { CommandPolicyEngine } from '../core/CommandPolicyEngine.js';
import { SwarmPatchTransaction } from '../core/SwarmPatchTransaction.js';
import { validateSchema } from '../core/SchemaValidator.js';
import blackboard from '../core/Blackboard.js';
import maintenanceBridge from '../core/MaintenanceBridge.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

export const DebateSchema = {
    type: "object",
    properties: {
        architect: { type: "string" },
        maintainer: { type: "string" },
        security: { type: "string" },
        consensus: { type: "string" }
    },
    required: ["architect", "maintainer", "security", "consensus"]
};

export const PatchSchema = {
    type: "object",
    properties: {
        patch: {
            type: "object",
            properties: {
                files: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            content: { type: "string" }
                        },
                        required: ["path", "content"]
                    }
                }
            },
            required: ["files"]
        }
    },
    required: ["patch"]
};

/**
 * EngineeringSwarmArbiter (Upgrade Pack Edition)
 * 
 * Replaces simple self-modification with a robust, autonomous engineering swarm.
 * Features:
 * - Security: CommandPolicyEngine blocks dangerous shell commands.
 * - Atomicity: SwarmPatchTransaction ensures multi-file edits are transactional with rollback.
 * - Reliability: Schema validation ensures machine-readable reasoning and code patches.
 * - Verification: Execution pipeline runs real-world tests to verify changes.
 * - Cybernetics: PlanMonitor logic with automatic pivot/retry on test failure.
 * - Intent: Permanent 'North Star' preservation across the reasoning chain.
 */
export class EngineeringSwarmArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'EngineeringSwarmArbiter',
      role: ArbiterRole.ARCHITECT,
      capabilities: [
        ArbiterCapability.READ_FILES,
        ArbiterCapability.WRITE_FILES,
        ArbiterCapability.EXECUTE_CODE,
        ArbiterCapability.MODIFY_CODE,
        ArbiterCapability.SELF_HEALING,
        ArbiterCapability.SECURITY_AUDIT
      ]
    });

    this.quadBrain = opts.quadBrain || null;
    this.mnemonicArbiter = opts.mnemonicArbiter || null;
    this.rootPath = opts.rootPath || process.cwd();
    this.commandPolicy = new CommandPolicyEngine();
    this.optimizer = opts.swarmOptimizer || null;
    this.runtime = new SwarmEngine({ 
        workspace: path.join(this.rootPath, '.soma', 'swarm_vault'),
        logger: this.auditLogger 
    });
  }

  setOptimizer(optimizer) {
    this.optimizer = optimizer;
  }

  async onInitialize() {
    await this.runtime.initialize();

    // Register with MessageBroker so goal assignments via sendMessage({to:'EngineeringSwarmArbiter'}) work
    try {
      messageBroker.registerArbiter('EngineeringSwarmArbiter', {
        instance: this,
        type: 'engineering',
        role: 'architect',
        capabilities: ['modify_code', 'self_healing', 'engineering']
      });
    } catch (e) {
      // Already registered or broker unavailable — non-fatal
    }

    this.auditLogger.info('🚀 Engineering Swarm (UPGRADED) Online', {
      mode: 'Verified Transactional Execution'
    });
  }

  /**
   * Handle direct messages from MessageBroker (sendMessage({to:'EngineeringSwarmArbiter'})).
   * Primary use: goal_assigned from GoalPlannerArbiter.
   */
  async handleMessage(envelope = {}) {
    const { type, payload } = envelope;

    if (type !== 'goal_assigned') {
      return { success: true, message: 'acknowledged' };
    }

    const { goalId, goal } = payload || {};
    if (!goalId || !goal) return { success: false, error: 'Invalid goal_assigned payload' };

    this.auditLogger.info(`[EngSwarm] ⚡ Goal assigned: "${goal.title}" (${goalId.slice(0, 8)})`);

    // Extract the first recognisable file path from the description
    const fileMatch = (goal.description || '').match(/[\w./\\-]+\.(js|cjs|mjs|ts|jsx|tsx|json|py)/i);
    if (!fileMatch) {
      // Non-code goal — update progress to show it was acknowledged
      this.auditLogger.warn(`[EngSwarm] Goal "${goal.title}" has no file target — cannot execute via modifyCode`);
      messageBroker.sendMessage({
        from: 'EngineeringSwarmArbiter', to: 'GoalPlannerArbiter',
        type: 'update_goal_progress',
        payload: { goalId, progress: 5, metadata: { note: 'Accepted by swarm but no file target' } }
      }).catch(() => {});
      return { success: true, message: 'Goal acknowledged, no file target' };
    }

    const filepath = fileMatch[0];

    // Run modifyCode in the background — do NOT block handleMessage
    (async () => {
      try {
        const result = await this.modifyCode(filepath, `${goal.title}: ${goal.description}`);
        if (result?.success) {
          messageBroker.sendMessage({
            from: 'EngineeringSwarmArbiter', to: 'GoalPlannerArbiter',
            type: 'update_goal_progress',
            payload: { goalId, progress: 100, metadata: { sessionId: result.sessionId, duration: result.duration } }
          }).catch(() => {});
          this.auditLogger.info(`[EngSwarm] ✅ Goal "${goal.title}" completed (${result.duration}s)`);
        } else {
          messageBroker.sendMessage({
            from: 'EngineeringSwarmArbiter', to: 'GoalPlannerArbiter',
            type: 'cancel_goal',
            payload: { goalId, reason: `EngineeringSwarm failed: ${result?.error || 'unknown'}` }
          }).catch(() => {});
          this.auditLogger.warn(`[EngSwarm] ❌ Goal "${goal.title}" failed: ${result?.error}`);
        }
      } catch (err) {
        this.auditLogger.error(`[EngSwarm] Goal execution exception: ${err.message}`);
      }
    })();

    return { success: true, message: 'goal execution started', filepath };
  }

  /**
   * Main Entry Point for Autonomous Engineering
   * Orchestrates the research, plan, debate, and synthesis cycle.
   */
  async modifyCode(filepath, request, onProgress = null) {
    const emit = (phase, message) => { if (onProgress) onProgress(phase, message); };

    this.auditLogger.info(`⚡ [EngSwarm] Engineering loop started for ${filepath}`);
    const sessionStartTime = Date.now();
    const sessionId = `swarm_${crypto.randomBytes(4).toString('hex')}`;

    // ─── STATE INITIALIZATION (Intent Preservation) ───
    const swarmState = {
        sessionId,
        filepath,
        northStar: request, // The persistent goal
        attempts: 0,
        maxAttempts: 2,
        lastError: null
    };

    // Initialize Blackboard for this session
    blackboard.reset(sessionId);
    blackboard.post('insights', { type: 'initial_request', content: request });

    while (swarmState.attempts < swarmState.maxAttempts) {
        swarmState.attempts++;
        this.auditLogger.info(`[Swarm] Phase Loop: Attempt ${swarmState.attempts}/${swarmState.maxAttempts}`);
        emit('attempt', `Attempt ${swarmState.attempts}/${swarmState.maxAttempts}`);

        try {
            // 1. RESEARCH - Understand the context
            emit('research', `Reading ${filepath} and understanding context...`);
            const research = await this.runResearch(filepath, swarmState.northStar);
            blackboard.post('insights', { type: 'research_complete', filepath, size: research.content.length });

            // 2. PLAN - Generate verification commands (With Cybernetic context)
            emit('plan', 'Generating verification plan...');
            const plan = await this.generatePlan(swarmState, research);
            blackboard.post('codeTargets', { type: 'verification_plan', commands: plan.map(p => p.command) });

            // 3. DEBATE - Technical adversarial reasoning (With North Star)
            emit('debate', 'Running adversarial technical debate...');
            const debate = await this.runDebate(swarmState, research);
            blackboard.post('insights', { type: 'debate_consensus', content: debate.consensus });

            // 4. SYNTHESIS - Drafting the final code patch
            emit('synthesis', 'Synthesizing final patch...');
            const verdict = await this.runSynthesis(swarmState, research, debate);
            blackboard.post('codeTargets', { type: 'final_patch', files: verdict.patch.files.map(f => f.path) });

            // 5. TRANSACTION - Multi-file safety layer
            const transaction = new SwarmPatchTransaction(this.rootPath);

            try {
                emit('apply', `Applying patch to ${verdict.patch.files.length} file(s)...`);
                this.auditLogger.info(`[Swarm] Applying patch transaction...`);
                await transaction.applyPatch(verdict.patch);

                // 6. VERIFICATION (Real-world Plan Monitor)
                emit('verify', 'Running verification commands...');
                const verification = await this.verifyPatch(verdict.patch, plan);

                if (!verification.passed) {
                    throw new Error(`Verification FAILED: ${verification.error}`);
                }

                // Finalize changes
                transaction.commit();
                blackboard.post('insights', { type: 'task_complete', status: 'success' });
                this.auditLogger.success(`[Swarm] ✅ SUCCESS: ${filepath} updated and verified on attempt ${swarmState.attempts}.`);

                const duration = ((Date.now() - sessionStartTime) / 1000).toFixed(1);
                const experienceData = { sessionId, filepath, request, success: true, duration, consensus: debate.consensus };

                if (this.optimizer) this.optimizer.record(experienceData);
                await this._logToExperienceLedger(experienceData);

                return { success: true, sessionId, duration, verdict };

            } catch (transErr) {
                this.auditLogger.warn(`[Swarm] 🔄 CYBERNETIC PIVOT: Verification failed on attempt ${swarmState.attempts}. Rolling back and retrying with error context.`);
                emit('pivot', `Attempt ${swarmState.attempts} failed — rolling back and retrying: ${transErr.message}`);
                await transaction.rollback();
                swarmState.lastError = transErr.message;
                blackboard.post('risks', { type: 'attempt_failed', attempt: swarmState.attempts, error: transErr.message });

                if (swarmState.attempts >= swarmState.maxAttempts) {
                    throw transErr; // Out of attempts
                }
                // Loop continues for the retry pivot
            }

        } catch (err) {
            const duration = ((Date.now() - sessionStartTime) / 1000).toFixed(1);
            const errorData = { sessionId, filepath, request, success: false, error: err.message, duration };

            if (this.optimizer) this.optimizer.record(errorData);
            blackboard.post('insights', { type: 'task_aborted', error: err.message });
            this.auditLogger.error(`[Swarm] ❌ ENGINEERING ABORTED after ${swarmState.attempts} attempts: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
  }

  async runResearch(filepath, request) {
    this.auditLogger.info(`[Researcher] Analyzing ${filepath}...`);
    const fullPath = path.resolve(this.rootPath, filepath);
    const content = await fs.readFile(fullPath, 'utf8');
    
    return {
        timestamp: Date.now(),
        filepath,
        content,
        request
    };
  }

  async generatePlan(state, context) {
    const prompt = `[NORTH STAR]: ${state.northStar}
    [PREVIOUS ERROR]: ${state.lastError || "None - Initial Attempt"}
    
    You are the SWARM PLANNER. Generate verification commands to prove the goal is met.
    Context File: ${context.filepath}
    
    Return ONLY a JSON array of commands:
    [{ "command": "node --check somefile.js" }]`;

    const result = await this.quadBrain.reason(prompt, { brain: 'LOGOS' });
    const jsonMatch = result.text.match(/\[[\s\S]*\]/s);
    if (!jsonMatch) throw new Error(`Planner produced unparseable plan: ${result.text}`);
    
    try {
        const tasks = JSON.parse(jsonMatch[0]);
        tasks.forEach(t => {
            if (t.command) this.commandPolicy.validate(t.command);
        });
        return tasks;
    } catch (e) {
        throw new Error(`Failed to parse plan JSON: ${e.message}`);
    }
  }

  async runDebate(state, context) {
    this.auditLogger.info(`[Swarm] Running Structured Debate...`);
    const prompt = `[NORTH STAR]: ${state.northStar}
    [PREVIOUS ERROR]: ${state.lastError || "None"}
    
    Debate this engineering change for FILE: ${context.filepath}
    
    Return ONLY JSON matching this schema:
    { "architect": "...", "maintainer": "...", "security": "...", "consensus": "..." }`;

    const result = await this.quadBrain.reason(prompt, { brain: 'AURORA' });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/s);
    if (!jsonMatch) throw new Error(`Swarm produced unparseable debate: ${result.text}`);
    
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateSchema(DebateSchema, parsed);
    } catch (e) {
        throw new Error(`Failed to parse debate JSON: ${e.message}`);
    }
  }

  async runSynthesis(state, context, debate) {
    this.auditLogger.info(`[LeadDev] Synthesizing final patch...`);
    const prompt = `[NORTH STAR]: ${state.northStar}
    [CONSENSUS]: ${debate.consensus}
    [PREVIOUS ERROR]: ${state.lastError || "None"}
    
    Produce final code patch for ORIGINAL FILE: ${context.filepath}
    
    Return ONLY JSON matching this schema:
    { "patch": { "files": [{ "path": "...", "content": "..." }] } }`;

    const result = await this.quadBrain.reason(prompt, { brain: 'LOGOS' });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/s);
    if (!jsonMatch) throw new Error(`Lead Dev produced unparseable patch: ${result.text}`);
    
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateSchema(PatchSchema, parsed);
    } catch (e) {
        throw new Error(`Failed to parse patch JSON: ${e.message}`);
    }
  }

  async verifyPatch(patch, tasks) {
    this.auditLogger.info(`[Tester] 🛡️ Verifying execution...`);
    
    for (const task of tasks) {
        this.commandPolicy.validate(task.command);
        const execResult = await this.runtime.runTasks([new SwarmTask({
            description: 'Verification Task',
            command: task.command,
            cwd: this.rootPath
        })]);
        
        if (execResult[0].error) {
            return { passed: false, error: execResult[0].error };
        }
    }

    return { passed: true };
  }

  /**
   * Out-of-Body Self-Surgery
   * Steps outside the current process to modify core files via external MAX.
   */
  async performSelfSurgery(filepath, request) {
    this.auditLogger.info(`🩹 [Swarm] Initiating Out-of-Body Self-Surgery for ${filepath}`);
    
    try {
        // 1. Delegate to the bridge
        const delegation = await maintenanceBridge.delegateToExternalMax(filepath, request);
        
        if (delegation.success) {
            this.auditLogger.success(`🚀 [Swarm] Task handed off to external maintenance runner (PID: ${delegation.pid})`);
            return {
                success: true,
                message: "Self-surgery initiated. The system will be updated and potentially restarted by the external runner.",
                pid: delegation.pid
            };
        } else {
            throw new Error("Delegation to external runner failed.");
        }
    } catch (err) {
        this.auditLogger.error(`❌ [Swarm] Self-surgery failed: ${err.message}`);
        return { success: false, error: err.message };
    }
  }

  async _logToExperienceLedger(data) {
    if (messageBroker && typeof messageBroker.publish === 'function') {
        await messageBroker.publish('swarm.experience', data);
    }
    const mnemonic = this.mnemonicArbiter || this.quadBrain?.mnemonic;
    if (mnemonic && typeof mnemonic.remember === 'function') {
        await mnemonic.remember(
            `Engineering Swarm: ${data.request} on ${data.filepath}. Result: ${data.success ? 'success' : 'failure'}`,
            { type: 'swarm_experience', ...data }
        );
    }
  }
}

export default EngineeringSwarmArbiter;
