import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.cjs';
import { SwarmEngine, SwarmTask } from './EngineeringSwarmRuntime.js';
import { CommandPolicyEngine } from '../core/CommandPolicyEngine.js';
import { SwarmPatchTransaction } from '../core/SwarmPatchTransaction.js';
import { validateSchema } from '../core/SchemaValidator.js';
import blackboard from '../core/Blackboard.js';
import maintenanceBridge from '../core/MaintenanceBridge.js';
import gitArbiter from '../core/GitArbiter.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { parse } from '@babel/parser';
import { resolveWithinRoot } from '../core/PathSafety.js';

import { VirtualShell } from './VirtualShell.js';

// Files the swarm must never autonomously modify — matches SelfModificationPipeline list
const IMMUTABLE_PATHS = [
    'server/routes/somaRoutes.js',
    'launcher_ULTRA.mjs',
    'start_production.bat',
    'clean_restart.bat',
    'core/SomaBootstrapV2.js',
    'core/SelfModificationPipeline.js',
    'server/loaders/',
    'config/',
    'ecosystem.config.cjs',
];

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
                            // full_rewrite mode: provide complete file content
                            content: { type: "string" },
                            // surgical mode: provide targeted old→new replacements (preferred for large files)
                            edits: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        old: { type: "string" },
                                        new: { type: "string" }
                                    },
                                    required: ["old", "new"]
                                }
                            }
                        },
                        required: ["path"]
                        // Note: either 'content' or 'edits' must be present — enforced at runtime by SwarmPatchTransaction
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
    this.tier = 'operational';

    this.quadBrain = opts.quadBrain || null;
    this.mnemonicArbiter = opts.mnemonicArbiter || null;
    this.rootPath = opts.rootPath || process.cwd();
    this.commandPolicy = new CommandPolicyEngine();
    this.optimizer = opts.swarmOptimizer || null;
    this.shell = new VirtualShell(this.rootPath);
    console.log(`[EngSwarm] VirtualShell initialized at: ${this.shell.cwd}`);
    this.runtime = new SwarmEngine({
        workspace: path.join(this.rootPath, '.soma', 'swarm_vault'),
        logger: this.auditLogger
    });

    // Cross-session failure context: filepath → { error, timestamp }
    // Prevents the "Meeseeks Loop" where the swarm repeats the same broken approach
    // across independent modifyCode() calls. Cleared on success, persists on final failure.
    this._persistentFailureLog = new Map();
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

    // Prioritize file path from metadata (Sovereign Assembly protocol)
    let filepath = goal.metadata?.filePath;

    // Fallback: Extract from description if metadata is missing
    if (!filepath) {
        const fileMatch = (goal.description || '').match(/[\w./\\-]+\.(js|cjs|mjs|ts|jsx|tsx|json|py)/i);
        if (fileMatch) filepath = fileMatch[0];
    }

    if (!filepath && this.quadBrain) {
      // Fix 1: Ask brain to infer the most relevant file for this goal
      try {
        const inference = await Promise.race([
          this.quadBrain.reason(
            `Given this engineering goal: "${goal.title}"\nDescription: "${goal.description || ''}"\n\nRespond with ONLY a single relative file path (e.g. arbiters/Foo.js) that is the most appropriate file to modify in order to implement this goal. If no code file is relevant, respond with the single word NONE.`,
            { quickResponse: true, preferredBrain: 'LOGOS' }
          ),
          new Promise(resolve => setTimeout(() => resolve(null), 8_000))
        ]);
        const raw = (inference?.text || '').trim().split('\n')[0].trim();
        if (raw && raw !== 'NONE') {
          const match = raw.match(/[\w./\\-]+\.(js|cjs|mjs|ts|jsx|tsx|json|py)/i);
          if (match) filepath = match[0];
        }
      } catch { /* fall through */ }
    }

    if (!filepath) {
      // Non-code goal — acknowledge but cannot execute via modifyCode
      this.auditLogger.warn(`[EngSwarm] Goal "${goal.title}" has no file target even after brain inference — skipping`);
      messageBroker.sendMessage({
        from: 'EngineeringSwarmArbiter', to: 'GoalPlannerArbiter',
        type: 'update_goal_progress',
        payload: { goalId, progress: 5, metadata: { note: 'No file target; routed to reasoning-only execution' } }
      }).catch(() => {});
      return { success: true, message: 'Goal acknowledged, no file target' };
    }

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
          // Use swarm_goal_failed (not cancel_goal) so GoalPlannerArbiter can
          // apply retry escalation rather than just silently deferring the goal.
          messageBroker.sendMessage({
            from: 'EngineeringSwarmArbiter', to: 'GoalPlannerArbiter',
            type: 'swarm_goal_failed',
            payload: { goalId, reason: result?.error || 'unknown' }
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
   * Get the MAX approval shim, constructing it on demand from the MAX bridge
   * singleton if no loader wired it into system. This makes MAX-as-approver work
   * regardless of bootstrap path or system-object identity.
   */
  async _getMaxApprovalShim() {
    if (this.system?.maxApprovalShim) return this.system.maxApprovalShim;
    if (this._lazyMaxShim) return this._lazyMaxShim;
    try {
      const { default: maxBridge } = await import('../core/MaxAgentBridge.js');
      const { MaxApprovalShim } = await import('./MaxApprovalShim.js');
      const shim = new MaxApprovalShim({ name: 'MaxApprovalShim', logger: this.auditLogger || console });
      shim.system = this.system;
      await shim.initialize({ maxAgentBridge: maxBridge });
      this._lazyMaxShim = shim;
      if (this.system) this.system.maxApprovalShim = shim; // share it forward
      return shim;
    } catch (e) {
      this.auditLogger?.warn?.(`[EngSwarm] Could not construct MaxApprovalShim: ${e.message}`);
      return null;
    }
  }

  /**
   * Main Entry Point for Autonomous Engineering
   * Orchestrates the research, plan, debate, and synthesis cycle.
   */
  async modifyCode(filepath, request, onProgress = null) {
    try {
      filepath = resolveWithinRoot(this.rootPath, filepath, 'Engineering target');
    } catch (error) {
      return { success: false, error: error.message };
    }
    const normPath = (filepath || '').replace(/\\/g, '/');
    const blocked = IMMUTABLE_PATHS.find(p => normPath.includes(p.replace(/\\/g, '/')));
    if (blocked) {
      this.auditLogger.warn(`[EngSwarm] 🚫 BLOCKED modifyCode on "${filepath}" — matches protected path "${blocked}"`);
      return { success: false, error: `Protected path: ${blocked} — only Barry can modify this file` };
    }

    if (!this.quadBrain) {
      this.auditLogger.error('[EngSwarm] Cannot modifyCode — quadBrain is null (QuadBrain not yet ready)');
      return { success: false, error: 'quadBrain not initialized — try again after system is fully booted' };
    }

    // Human-in-the-loop gate: if humanInLoopOverride is enabled in commandBridgeSettings,
    // queue a WebSocket approval request before touching production code.
    const commandBridgeSettings = this.system?.commandBridgeSettings;
    // Code modification is high risk. Missing configuration must not silently
    // disable approval during early boot.
    const humanInLoop = commandBridgeSettings?.authority?.humanInLoopOverride !== false;
    if (humanInLoop) {
      // Prefer MAX as approver. Construct the shim on demand if no loader wired it
      // into this.system — production boots SomaBootstrapV2 and the swarm's system
      // object didn't always carry maxApprovalShim, which stranded every self-mod
      // at "no approval gate available".
      const maxShim = await this._getMaxApprovalShim();
      if (maxShim) {
          this.auditLogger.info(`[EngSwarm] Delegating code modification approval to MAX via MaxApprovalShim.`);
          const approval = await maxShim.requestApproval({ filepath, request });
          if (!approval?.approved) {
              this.auditLogger.warn(`[EngSwarm] 🛑 MAX rejected code modification for "${filepath}"`);
              return { success: false, error: `Modification rejected by MAX: ${approval?.reason || 'denied'}`, humanRejected: true };
          }
      } else {
          const approvalGate = this.system?.ws?.approvalGate || this.system?.approvalGate;
          if (!approvalGate) {
            return { success: false, error: 'Human approval is required but no approval gate is available' };
          }
          try {
              const approval = await approvalGate.request({
                type:    'code_modification',
                action:  `Modify SOMA code: ${path.relative(this.rootPath, filepath)}`,
                file:    filepath,
                details: { file: filepath, request: request.slice(0, 300) },
                request: request.slice(0, 300),
                timeoutMs: 120000,
                riskScore: 0.8,
                trustScore: 0.2,
              });
              if (approval?.approved !== true) {
                this.auditLogger.warn(`[EngSwarm] 🛑 Human rejected code modification for "${filepath}"`);
                return { success: false, error: `Modification rejected by human-in-the-loop gate: ${approval?.reason || 'denied'}`, humanRejected: true };
              }
          } catch (gateErr) {
              return { success: false, error: `Approval gate failed: ${gateErr.message}` };
          }
      }
    }

    const emit = (phase, message) => { if (onProgress) onProgress(phase, message); };

    this.auditLogger.info(`⚡ [EngSwarm] Engineering loop started for ${filepath}`);
    const sessionStartTime = Date.now();
    const sessionId = `swarm_${crypto.randomBytes(4).toString('hex')}`;

    // ─── STATE INITIALIZATION (Intent Preservation) ───
    // Inject cross-session failure context so the swarm never repeats a known-broken approach
    const priorFailure = this._persistentFailureLog.get(normPath);
    const priorIsRecent = priorFailure && (Date.now() - priorFailure.timestamp) < 86400000;
    const priorError = priorIsRecent
        ? `[PRIOR SESSION — ${priorFailure.attempts} attempt(s) — ${new Date(priorFailure.timestamp).toISOString()}]\n${priorFailure.error}`
        : null; // stale after 24h — fresh eyes beat stale context

    const swarmState = {
        sessionId,
        filepath,
        northStar: request, // The persistent goal
        attempts: 0,
        maxAttempts: 2,
        lastError: priorError  // null on first-ever attempt, prior error on retry
    };

    if (priorError) {
        this.auditLogger.warn(`[EngSwarm] ⚠️ Prior failure context injected for ${filepath}: "${priorError.slice(0, 80)}"`);
    }

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
            let benchmarkHelper = null;

            try {
                // Initialize benchmark on the original code
                try {
                    const originalFileFullPath = path.resolve(this.rootPath, filepath);
                    const originalCodeContent = await fs.readFile(originalFileFullPath, 'utf8');
                    benchmarkHelper = await this.runSwarmBenchmark(filepath, originalCodeContent);
                } catch (benchInitErr) {
                    this.auditLogger.warn(`[Swarm] Benchmarking initialization skipped: ${benchInitErr.message}`);
                }

                emit('apply', `Applying patch to ${verdict.patch.files.length} file(s)...`);
                this.auditLogger.info(`[Swarm] Applying patch transaction...`);
                await transaction.applyPatch(verdict.patch);

                // Run experimental benchmark after patch application
                let benchmarkMetrics = null;
                if (benchmarkHelper) {
                    try {
                        benchmarkMetrics = await benchmarkHelper.runExperimental();
                        if (benchmarkMetrics) {
                            this.auditLogger.info(`[Swarm] 📊 Swarm Benchmark comparison:
   - Baseline Latency: ${benchmarkMetrics.baseline.latencyMs.toFixed(3)}ms
   - Experimental Latency: ${benchmarkMetrics.experimental.latencyMs.toFixed(3)}ms (Delta: ${benchmarkMetrics.latencyDeltaPercent.toFixed(1)}%)
   - Memory Delta: ${benchmarkMetrics.memoryDeltaBytes} bytes`);

                            // If latency regression > 30% and it runs for more than 5ms (avoid micro-jitter), reject!
                            if (benchmarkMetrics.latencyDeltaPercent > 30 && benchmarkMetrics.baseline.latencyMs > 5) {
                                throw new Error(`Latency regression of ${benchmarkMetrics.latencyDeltaPercent.toFixed(1)}% exceeds the 30% safety threshold.`);
                            }
                        }
                    } catch (benchRunErr) {
                        this.auditLogger.warn(`[Swarm] Benchmarking execution failed: ${benchRunErr.message}`);
                        if (benchmarkHelper.tempBenchPath) {
                            await fs.rm(benchmarkHelper.tempBenchPath, { force: true }).catch(() => {});
                        }
                        throw benchRunErr; // Reject patch on benchmark check failure
                    }
                }

                // Run formal voting consensus
                const votingResult = await this.runVotingConsensus(swarmState, research, benchmarkMetrics);
                if (!votingResult.passed) {
                    const votesSummary = Object.keys(votingResult.votes).map(k => `${k}: ${votingResult.votes[k].vote}`).join(', ');
                    throw new Error(`Decentralized Swarm Consensus rejected this patch. Vote tally: ${votingResult.approvals}/3 Approvals (${votesSummary})`);
                }
                this.auditLogger.success(`[Swarm] 🗳️ Swarm Vote PASSED with ${votingResult.approvals}/3 Approvals!`);

                // 6. VERIFICATION (Real-world Plan Monitor)
                emit('verify', 'Running verification commands...');
                const requiredPlan = this.buildRequiredVerificationPlan(verdict.patch, plan);
                const verification = await this.verifyPatch(verdict.patch, requiredPlan);

                if (!verification.passed) {
                    throw new Error(`Verification FAILED: ${verification.error}`);
                }

                // Finalize changes
                transaction.commit();
                blackboard.post('insights', { type: 'task_complete', status: 'success' });
                this.auditLogger.success(`[Swarm] ✅ SUCCESS: ${filepath} updated and verified on attempt ${swarmState.attempts}.`);

                const duration = ((Date.now() - sessionStartTime) / 1000).toFixed(1);
                const evidence = {
                    verification,
                    benchmark: benchmarkMetrics,
                    vote: votingResult,
                    attempts: swarmState.attempts,
                    changedFiles: verdict.patch.files.map(file => path.relative(this.rootPath, resolveWithinRoot(this.rootPath, file.path, 'Patch path')).replace(/\\/g, '/')),
                };
                const experienceData = { sessionId, filepath, request, success: true, duration, consensus: debate.consensus, evidence };

                if (this.optimizer) this.optimizer.record(experienceData);
                await this._logToExperienceLedger(experienceData);

                // Self-publish the improvement to GitHub
                gitArbiter.setBroker(messageBroker);
                gitArbiter.publishImprovement(
                    `${request.slice(0, 72)} (${path.basename(filepath)})`,
                    verdict.patch?.files?.map(f => f.path) || [filepath]
                ).catch(e => this.auditLogger.warn(`[Swarm] GitArbiter publish failed: ${e.message}`));

                // Success — wipe failure context so next call starts clean
                this._persistentFailureLog.delete(normPath);

                return { success: true, sessionId, duration, verdict, evidence };

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
            // Publish failure to broker — was previously silent; GoalPlannerArbiter
            // and SwarmOptimizer both subscribe to swarm.experience for feedback loops.
            await this._logToExperienceLedger(errorData);
            blackboard.post('insights', { type: 'task_aborted', error: err.message });
            this.auditLogger.error(`[Swarm] ❌ ENGINEERING ABORTED after ${swarmState.attempts} attempts: ${err.message}`);

            // Persist failure context so the NEXT call to modifyCode() for this file
            // starts with awareness of what already failed (Stateful Failure Recovery).
            // Slice to 500 chars — err.message already contains verification stderr via the chain:
            // verifyPatch returns { error: stderr } → thrown as "Verification FAILED: <stderr>"
            this._persistentFailureLog.set(normPath, {
                error:     err.message.slice(0, 500),
                attempts:  swarmState.attempts,
                timestamp: Date.now()
            });

            return { success: false, error: err.message };
        }
    }
  }

  _parseRobustJSON(text, isArray = false) {
    let cleanText = text.trim();
    // Remove markdown code fences if present
    const fenceMatch = cleanText.match(/```(?:json)?\n([\s\S]*?)```/);
    if (fenceMatch) {
        cleanText = fenceMatch[1].trim();
    }

    let actualIsArray = isArray;
    let startChar = isArray ? '[' : '{';
    let endChar = isArray ? ']' : '}';

    let startIdx = cleanText.indexOf(startChar);
    if (startIdx === -1) {
        // Fallback: if we wanted an array but only found '{', parse as object and wrap
        if (isArray && cleanText.indexOf('{') !== -1) {
            actualIsArray = false;
            startChar = '{';
            endChar = '}';
            startIdx = cleanText.indexOf('{');
        } else if (!isArray && cleanText.indexOf('[') !== -1) {
            // If we wanted an object but found '[', parse as array and take first element
            actualIsArray = true;
            startChar = '[';
            endChar = ']';
            startIdx = cleanText.indexOf('[');
        } else {
            throw new Error(`Could not find starting character '${startChar}' in text: "${text}"`);
        }
    }
    
    let sub = cleanText.substring(startIdx);
    const lastEndIdx = sub.lastIndexOf(endChar);
    if (lastEndIdx !== -1) {
        sub = sub.substring(0, lastEndIdx + 1);
    }

    let parsed;
    // Try parsing
    try {
        parsed = JSON.parse(sub);
    } catch (err) {
        // Self-healing for truncated JSON
        let healed = sub;
        
        // Count quotes to check if we are inside a string
        const quotes = (healed.match(/"/g) || []).length;
        if (quotes % 2 !== 0) {
            healed += '"';
        }

        if (actualIsArray) {
            const openBrackets = (healed.match(/\[/g) || []).length;
            const closeBrackets = (healed.match(/\]/g) || []).length;
            const neededBrackets = openBrackets - closeBrackets;
            if (neededBrackets > 0) healed += ']'.repeat(neededBrackets);
        } else {
            const openBraces = (healed.match(/\{/g) || []).length;
            const closeBraces = (healed.match(/\}/g) || []).length;
            const neededBraces = openBraces - closeBraces;
            if (neededBraces > 0) healed += '}'.repeat(neededBraces);
        }

        try {
            parsed = JSON.parse(healed);
        } catch (err2) {
            throw new Error(`Original parse error: ${err.message}. Healed parse error: ${err2.message}. Raw text: "${text}"`);
        }
    }

    // Adapt shape if it mismatched
    if (isArray && !Array.isArray(parsed)) {
        return [parsed];
    } else if (!isArray && Array.isArray(parsed)) {
        return parsed[0];
    }
    return parsed;
  }

  _extractCommandsFromText(text, filepath) {
    const commands = [];
    
    // Pattern 1: command inside backticks, e.g. `node --check file.js`
    const backtickRegex = /`([^`\n]+)`/g;
    let match;
    while ((match = backtickRegex.exec(text)) !== null) {
        const cmd = match[1].trim();
        if (cmd.includes('node ') || cmd.includes('npm ') || cmd.includes('test')) {
            commands.push({ command: cmd });
        }
    }
    
    // Pattern 2: lines starting with node --check or npm or node
    if (commands.length === 0) {
        const lines = text.split('\n');
        for (let line of lines) {
            line = line.trim().replace(/^-\s+/, '').replace(/^>\s+/, '').trim(); // remove list bullet or blockquote
            if (/^(node|npm|npx|vitest|jest|deno|bun)\s/.test(line)) {
                line = line.replace(/`+$/, '').replace(/^`+/, '');
                commands.push({ command: line });
            }
        }
    }
    
    // Pattern 3: If still nothing, default to the safe syntax check as a fallback
    if (commands.length === 0) {
        commands.push({ command: `node --check ${filepath}` });
    }
    
    return commands;
  }

  async runResearch(filepath, request) {
    this.auditLogger.info(`[Researcher] Analyzing ${filepath}...`);
    const fullPath = path.resolve(this.rootPath, filepath);
    const content = await fs.readFile(fullPath, 'utf8');

    let pastExperience = '';
    const mnemonic = this.mnemonicArbiter || this.quadBrain?.mnemonic;
    if (mnemonic && typeof mnemonic.recall === 'function') {
        try {
            const recalled = await Promise.race([
                mnemonic.recall(`Engineering Swarm ${filepath}`, { topK: 3 }),
                new Promise(r => setTimeout(() => r(null), 2000))
            ]);
            const hits = recalled?.results?.filter(r => r.content?.includes(filepath));
            if (hits?.length) {
                pastExperience = hits.map(r => `- ${r.content}`).join('\n');
                this.auditLogger.info(`[Researcher] Recalled ${hits.length} past experience(s) for ${filepath}`);
            }
        } catch { /* non-fatal */ }
    }

    return {
        timestamp: Date.now(),
        filepath,
        content,
        request,
        pastExperience
    };
  }

  async generatePlan(state, context) {
    const prompt = `[NORTH STAR]: ${state.northStar}
    [PREVIOUS ERROR]: ${state.lastError || "None - Initial Attempt"}
    
    You are the RALPH VERIFIER (Autonomous Stress-Tester).
    Context File: ${context.filepath}
    
    TASK: Generate a robust validation plan to prove the code patch is functionally correct and structurally safe.
    
    SECURITY CONSTRAINTS:
    - SOMA's CommandPolicyEngine strictly blocks the following characters: ';', '&', '|', '>', '<'.
    - Do NOT combine commands using '&&' or ';'.
    - Do NOT write inline Node scripts using '-e' if they contain semicolons or other blocked symbols.
    - You MUST only output a single, simple command that performs a syntax check, such as:
      "node --check ${context.filepath}"
    
    Return ONLY a JSON array containing this single command. E.g.:
    [{ "command": "node --check ${context.filepath}" }]`;

    let lastErrorMsg = '';
    let resultText = '';
    let tasks = [];
    for (let retry = 0; retry < 3; retry++) {
        let finalPrompt = prompt;
        if (retry > 0) {
            finalPrompt += `\n\n⚠️ CRITICAL WARNING (Attempt ${retry + 1}/3): Your previous output failed to parse as a valid JSON array.
Error: ${lastErrorMsg}
Please output ONLY a valid JSON array of objects. Do not write text explanations or chat commentary.`;
        }
        
        try {
            const result = await this.quadBrain.reason(finalPrompt, { brain: 'LOGOS' });
            resultText = result.text;
            tasks = this._parseRobustJSON(result.text, true);
            
            if (!Array.isArray(tasks)) {
                throw new Error("Result is not a JSON array");
            }
            
            const validatedTasks = [];
            for (const t of tasks) {
                let cmd = typeof t === 'string' ? t : (t && t.command);
                if (cmd) {
                    cmd = cmd.trim();
                    this.commandPolicy.validate(cmd);
                    validatedTasks.push({ command: cmd });
                }
            }
            if (validatedTasks.length > 0) {
                return validatedTasks;
            }
            throw new Error("No commands passed security validation");
        } catch (e) {
            lastErrorMsg = e.message;
            this.auditLogger.warn(`[Ralph] Plan generation failed on retry ${retry}: ${e.message}`);
        }
    }

    // Extraction fallback if all retries failed
    this.auditLogger.warn(`[Ralph] All plan retries failed. Attempting text command extraction fallback.`);
    tasks = this._extractCommandsFromText(resultText, context.filepath);
    const validatedTasks = [];
    for (const t of tasks) {
        let cmd = typeof t === 'string' ? t : (t && t.command);
        if (cmd) {
            cmd = cmd.trim();
            try {
                this.commandPolicy.validate(cmd);
                validatedTasks.push({ command: cmd });
            } catch (err) {
                this.auditLogger.warn(`[Swarm] Plan command "${cmd}" failed validation: ${err.message}. Skipping.`);
            }
        }
    }

    if (validatedTasks.length === 0) {
        const defaultCmd = `node --check ${context.filepath}`;
        this.auditLogger.warn(`[Swarm] No valid commands found in plan. Defaulting to: ${defaultCmd}`);
        validatedTasks.push({ command: defaultCmd });
    }

    return validatedTasks;
  }

  _detectSpecialist(code, filepath = '') {
    const keywords = {
      dba: new Set(['sqlite', 'better-sqlite3', 'redis', 'pg', 'mysql', 'database', 'query', 'sql', 'db']),
      dsp: new Set(['transformers', 'tesseract', 'canvas', 'pixel', 'audio', 'video', 'image', 'ffmpeg', 'wave', 'spectrogram']),
      mlops: new Set(['openai', 'generative-ai', 'tensorflow', 'pytorch', 'lora', 'training', 'hyperparameter', 'epoch', 'dataset', 'weights', 'ollama'])
    };

    const detected = {
      dba: false,
      dsp: false,
      mlops: false
    };

    try {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties', 'objectRestSpread', 'dynamicImport']
      });

      const walk = (node) => {
        if (!node) return;
        
        if (node.type === 'ImportDeclaration') {
          const val = (node.source.value || '').toLowerCase();
          for (const type of Object.keys(keywords)) {
            for (const kw of keywords[type]) {
              if (val.includes(kw)) {
                detected[type] = true;
              }
            }
          }
        }
        
        if (node.type === 'Identifier') {
          const name = (node.name || '').toLowerCase();
          for (const type of Object.keys(keywords)) {
            if (keywords[type].has(name)) {
              detected[type] = true;
            }
          }
        } else if (node.type === 'StringLiteral') {
          const val = (node.value || '').toLowerCase();
          for (const type of Object.keys(keywords)) {
            for (const kw of keywords[type]) {
              if (val.includes(kw)) {
                detected[type] = true;
              }
            }
          }
        }

        for (const key in node) {
          if (node[key] && typeof node[key] === 'object') {
            if (Array.isArray(node[key])) {
              for (const child of node[key]) walk(child);
            } else if (node[key].type) {
              walk(node[key]);
            }
          }
        }
      };
      walk(ast);
    } catch {
      const lowerCode = code.toLowerCase();
      for (const type of Object.keys(keywords)) {
        for (const kw of keywords[type]) {
          if (lowerCode.includes(kw)) {
            detected[type] = true;
          }
        }
      }
    }

    const lowerPath = filepath.toLowerCase();
    for (const type of Object.keys(keywords)) {
      for (const kw of keywords[type]) {
        if (lowerPath.includes(kw)) {
          detected[type] = true;
        }
      }
    }

    if (detected.dba) return 'DBA';
    if (detected.mlops) return 'MLOps';
    if (detected.dsp) return 'DSP';
    return null;
  }

  async runDebate(state, context) {
    this.auditLogger.info(`[Swarm] Running Multi-Agent Adversarial Debate (Kuze & Batou)...`);
    const pastBlock = context.pastExperience
        ? `[PAST EXPERIENCE WITH THIS FILE]:\n${context.pastExperience}\n`
        : '';

    // Turn 1: Kuze (LOGOS Lobe) - Performance & Clean Patterns
    this.auditLogger.debug(`[Swarm] [Debate Turn 1] Invoking Kuze (LOGOS)...`);
    const kuzePrompt = `You are KUZE, SOMA's Philosophical Analyst and Deep Pattern recognition specialist (LOGOS lobe).
[NORTH STAR (REQUEST)]: ${state.northStar}
[PREVIOUS ERROR]: ${state.lastError || "None"}
[FILE TO MODIFY]: ${context.filepath}
[ORIGINAL CODE]:
\`\`\`javascript
${context.content}
\`\`\`
${pastBlock}

TASK: Propose the technical architecture and code patterns for implementing the request in the file.
Focus on:
- High performance and algorithmic efficiency.
- Clean design patterns (Ghost in the Shell inspired: analytical, philosophical, precise).
- Identifying structural redundancies or potential bottlenecks.

Respond with your analysis and specific code structure recommendations. Keep it concise but technically detailed.`;

    const kuzeResult = await this.quadBrain.reason(kuzePrompt, { brain: 'LOGOS' });
    const kuzeComment = kuzeResult?.text || kuzeResult;

    // Turn 1.5: Dynamic Specialist Lobe Injection based on code imports/keywords
    const specialistType = this._detectSpecialist(context.content, context.filepath);
    let specialistComment = '';
    let specialistName = '';

    if (specialistType) {
        let specialistPrompt = '';
        if (specialistType === 'DBA') {
            specialistName = 'Tachikoma-DB (Database DBA)';
            specialistPrompt = `You are TACHIKOMA-DB, SOMA's Database Administrator and Storage specialist.
[NORTH STAR (REQUEST)]: ${state.northStar}
[FILE TO MODIFY]: ${context.filepath}
[KUZE ARCHITECT PROPOSAL]:
${kuzeComment}

TASK: Review Kuze's architectural proposal specifically from a database, query efficiency, and storage perspective.
Focus on:
- Index utilization and query plan efficiency.
- Connection pooling, locks, and transaction boundaries.
- Storage overhead, query caching, and database schemas.

Respond with your DBA assessment, recommendations, and queries/indices optimization.`;
        } else if (specialistType === 'DSP') {
            specialistName = 'Ishikawa (DSP and Media Specialist)';
            specialistPrompt = `You are ISHIKAWA, SOMA's Digital Signal Processing, Media, and I/O pipeline specialist.
[NORTH STAR (REQUEST)]: ${state.northStar}
[FILE TO MODIFY]: ${context.filepath}
[KUZE ARCHITECT PROPOSAL]:
${kuzeComment}

TASK: Review Kuze's architectural proposal specifically from a media processing and DSP perspective.
Focus on:
- Buffer allocations, byte arrays, and stream pipeline bottlenecks.
- Asynchronous file/network I/O latency.
- Image/audio processing efficiency and tensor shape/dimension safety.

Respond with your DSP and media pipeline assessment and optimize recommendations.`;
        } else if (specialistType === 'MLOps') {
            specialistName = 'Boma (MLOps and Training Specialist)';
            specialistPrompt = `You are BOMA, SOMA's MLOps, training, and neural weight orchestration specialist.
[NORTH STAR (REQUEST)]: ${state.northStar}
[FILE TO MODIFY]: ${context.filepath}
[KUZE ARCHITECT PROPOSAL]:
${kuzeComment}

TASK: Review Kuze's architectural proposal specifically from an ML training, Ollama, and LoRA weight tuning perspective.
Focus on:
- GPU memory/VRAM management, out-of-memory prevention, and batch sizes.
- Hyperparameter settings, learning rates, and dataset balance.
- Model hot-swapping, model loading, and weights version control safety.

Respond with your MLOps assessment and training loop safety recommendations.`;
        }

        this.auditLogger.debug(`[Swarm] [Debate Turn 1.5] Invoking Specialist: ${specialistName}...`);
        const specialistResult = await this.quadBrain.reason(specialistPrompt, { brain: 'LOGOS' });
        specialistComment = specialistResult?.text || specialistResult;
    }

    // Turn 2: Batou (THALAMUS Lobe) - Security & Risk Mitigation
    this.auditLogger.debug(`[Swarm] [Debate Turn 2] Invoking Batou (THALAMUS)...`);
    const batouPrompt = `You are BATOU, SOMA's Tactical Security Specialist (THALAMUS lobe).
[NORTH STAR (REQUEST)]: ${state.northStar}
[FILE TO MODIFY]: ${context.filepath}
[ORIGINAL CODE]:
\`\`\`javascript
${context.content}
\`\`\`
[KUZE PROPOSAL]:
${kuzeComment}
${specialistComment ? `\n[SPECIALIST ASSESSMENT (${specialistName})]:\n${specialistComment}\n` : ''}

TASK: Review Kuze's proposed change, any specialist recommendations, and the original file from a security, safety, and risk perspective.
Focus on:
- Tactical security flaws (e.g. command injection, path traversal, validation flaws).
- Robust error handling and boundary conditions.
- System stability (Ghost in the Shell inspired: blunt, protective, ex-military pragmatist).

Respond with your security assessment and any warnings or requirements that must be addressed.`;

    const batouResult = await this.quadBrain.reason(batouPrompt, { brain: 'THALAMUS' });
    const batouComment = batouResult?.text || batouResult;

    // Turn 3: Consensus (PROMETHEUS Lobe) - Synthesis & Roadmapping
    this.auditLogger.debug(`[Swarm] [Debate Turn 3] Building Consensus (PROMETHEUS)...`);
    const consensusPrompt = `[NORTH STAR (REQUEST)]: ${state.northStar}
[FILE TO MODIFY]: ${context.filepath}
[KUZE PERFORMANCE PROPOSAL]:
${kuzeComment}

${specialistComment ? `[${specialistName.toUpperCase()} ASSESSMENT]:\n${specialistComment}\n` : ''}
[BATOU SECURITY ASSESSMENT]:
${batouComment}

TASK: Build a consensus resolution between Kuze's performance proposal, the specialist's findings, and Batou's security warnings.
Formulate the final consensus strategy on how the codebase should be modified.

You MUST respond with a valid JSON object matching this schema:
{
  "architect": "Architect's perspective (summarizing the performance/architectural approach)",
  "maintainer": "Maintainer's perspective (addressing code quality and longevity)",
  "security": "Security perspective (addressing Batou's security requirements)",
  "consensus": "Consensus description (the final, step-by-step roadmap to be synthesized into the code patch)"
}

Even if no changes are needed, the code is already correct, or you are recovering from an error, you MUST still return a valid JSON object matching the schema. Do NOT output any conversational text or markdown explanation. Return ONLY the JSON object.`;

    let lastErrorMsg = '';
    let lastText = '';
    for (let retry = 0; retry < 3; retry++) {
        let finalPrompt = consensusPrompt;
        if (retry > 0) {
            finalPrompt += `\n\n⚠️ CRITICAL WARNING (Attempt ${retry + 1}/3): Your previous output failed to parse as valid JSON.
Error: ${lastErrorMsg}
Please output ONLY a valid JSON object matching the schema. No markdown code blocks, no explanations.`;
        }
        
        try {
            const consensusResult = await this.quadBrain.reason(finalPrompt, { brain: 'PROMETHEUS' });
            lastText = consensusResult.text;
            const parsed = this._parseRobustJSON(consensusResult.text, false);
            return validateSchema(DebateSchema, parsed);
        } catch (e) {
            lastErrorMsg = e.message;
            this.auditLogger.warn(`[Swarm] Debate consensus generation failed on retry ${retry}: ${e.message}`);
        }
    }

    // Text fallback if all retries failed
    this.auditLogger.warn(`[Swarm] All debate consensus retries failed. Using text fallback.`);
    const text = lastText;
    const architectMatch = text.match(/(?:architect|Kuze's proposal|Kuze|Performance)[\s\S]*?(?=(?:maintainer|Steve's proposal|Steve|Maintainer|security|Consensus|$))/i);
    const maintainerMatch = text.match(/(?:maintainer|Steve's proposal|Steve|Maintainer)[\s\S]*?(?=(?:security|Consensus|$))/i);
    const securityMatch = text.match(/(?:security|Batou's proposal|Batou|Security)[\s\S]*?(?=(?:consensus|Consensus|$))/i);
    const consensusMatch = text.match(/(?:consensus|Consensus)[\s\S]*$/i);

    return {
        architect: architectMatch ? architectMatch[0].trim() : "Failed to parse architect perspective",
        maintainer: maintainerMatch ? maintainerMatch[0].trim() : "Failed to parse maintainer perspective",
        security: securityMatch ? securityMatch[0].trim() : "Failed to parse security perspective",
        consensus: consensusMatch ? consensusMatch[0].trim() : text.trim()
    };
  }

  async runSynthesis(state, context, debate) {
    this.auditLogger.info(`[LeadDev] Synthesizing final patch...`);
    const prompt = `[NORTH STAR]: ${state.northStar}
    [CONSENSUS]: ${debate.consensus}
    [PREVIOUS ERROR]: ${state.lastError || "None"}

    Produce final code patch for ORIGINAL FILE: ${context.filepath}

    PATCH FORMAT RULES (AEGIS Protocol — read carefully):
    - If the file is large (>100 lines) or already exists: use SURGICAL edits.
      Surgical format: { "patch": { "files": [{ "path": "...", "edits": [{ "old": "exact string", "new": "replacement" }] }] } }
      Each "old" must be an EXACT verbatim substring of the current file. Copy it character-for-character.
      Make the "old" string unique enough (include 1-2 surrounding lines of context) to avoid ambiguity.
    - If the file is new or small (<100 lines): full rewrite is acceptable.
      Full rewrite format: { "patch": { "files": [{ "path": "...", "content": "entire file content" }] } }
    - NEVER use full_rewrite on large existing files. The AEGIS guard will block it if you delete routes or functions.
    - You may mix modes: different files in the same patch can use different formats.
    - Even if you believe the code is already correct, no changes are needed, or you are recovering from a non-code error, you MUST still return a valid JSON object. If no changes are needed, return an empty files array: { "patch": { "files": [] } }
    - Do NOT output any plain text explanation or commentary under any circumstances.

    Return ONLY JSON:
    { "patch": { "files": [{ "path": "...", "edits": [{ "old": "...", "new": "..." }] }] } }`;

    let lastErrorMsg = '';
    for (let retry = 0; retry < 3; retry++) {
        let finalPrompt = prompt;
        if (retry > 0) {
            finalPrompt += `\n\n⚠️ CRITICAL WARNING (Attempt ${retry + 1}/3): Your previous output failed to parse as valid JSON.
Error: ${lastErrorMsg}
Please do not include any conversational explanation, markdown descriptions, or preambles.
You MUST output ONLY a valid JSON object matching the requested schema. Ensure all keys and strings are properly escaped.`;
        }
        
        try {
            const result = await this.quadBrain.reason(finalPrompt, { brain: 'LOGOS' });
            const parsed = this._parseRobustJSON(result.text, false);
            return validateSchema(PatchSchema, parsed);
        } catch (e) {
            lastErrorMsg = e.message;
            this.auditLogger.warn(`[LeadDev] Patch synthesis JSON parse failed on retry ${retry}: ${e.message}`);
        }
    }
    throw new Error(`Failed to parse patch JSON after retries: ${lastErrorMsg}`);
  }

  async verifyPatch(patch, tasks) {
    this.auditLogger.info(`[Ralph] 🛡️ Running autonomous verification loop via VirtualShell...`);
    const results = [];

    for (const task of tasks) {
        try {
            this.commandPolicy.validate(task.command);
            
            // Execute via stateful VirtualShell
            const result = await this.shell.execute(task.command, task.timeout || 30000);
            
            this.auditLogger.debug(`[Ralph] Command: ${task.command} | Exit: ${result.exitCode}`);
            results.push({
                command: task.command,
                exitCode: result.exitCode,
                duration: result.duration || null,
                stdout: String(result.stdout || '').slice(-2000),
                stderr: String(result.stderr || '').slice(-2000),
            });

            if (result.exitCode !== 0) {
                this.auditLogger.error(`[Ralph] Verification failed on command: ${task.command}`);
                return {
                    passed: false, 
                    error: result.stderr || result.stdout || `Command failed with exit code ${result.exitCode}`,
                    results,
                };
            }
        } catch (e) {
            return { passed: false, error: `Policy/Execution Error: ${e.message}`, results };
        }
    }

    return { passed: true, results };
  }

  buildRequiredVerificationPlan(patch, proposedTasks = []) {
    const tasks = [];
    const seen = new Set();
    const add = (command, timeout = 30000, source = 'required') => {
      const normalized = String(command || '').trim();
      if (!normalized || seen.has(normalized)) return;
      this.commandPolicy.validate(normalized);
      seen.add(normalized);
      tasks.push({ command: normalized, timeout, source });
    };

    for (const file of patch?.files || []) {
      const fullPath = resolveWithinRoot(this.rootPath, file.path, 'Patch path');
      if (/\.(js|cjs|mjs)$/i.test(fullPath)) {
        const relative = path.relative(this.rootPath, fullPath).replace(/\\/g, '/');
        add(`node --check "${relative}"`, 30000, 'syntax');
      }
    }

    // The repository smoke suite is mandatory. A model-generated syntax check
    // alone is not sufficient evidence that a SOMA change works.
    add('npm run soma:test', 120000, 'project_smoke');

    for (const task of proposedTasks || []) {
      try {
        add(task.command, task.timeout || 30000, 'proposed');
      } catch (error) {
        this.auditLogger.warn(`[Ralph] Ignoring unsafe proposed verification command: ${error.message}`);
      }
    }

    return tasks;
  }

  async runSwarmBenchmark(filepath, originalCode) {
    if (!this.quadBrain) return null;

    this.auditLogger.info(`[Swarm] 📊 Generating empirical benchmark script for: ${filepath}`);
    // The temp benchmark file is written to this.rootPath, so the import specifier
    // must be RELATIVE to rootPath. filepath arrives absolute — using it directly
    // produced a doubled path (rootPath + absolutePath) and ERR_MODULE_NOT_FOUND,
    // which failed the benchmark step for every self-mod. Compute the relative form.
    const absTarget = path.isAbsolute(filepath) ? filepath : path.join(this.rootPath, filepath);
    const importSpecifier = './' + path.relative(this.rootPath, absTarget).replace(/\\/g, '/');
    const prompt = `You are SOMA's empirical benchmarking generator.
Given this file: ${filepath}
And this original code:
\`\`\`javascript
${originalCode}
\`\`\`

Write a self-contained Node.js benchmark script that imports the functions in this file and runs them with representative inputs in a loop (e.g., 1000 iterations) to measure execution time.
The script must print a single JSON line containing:
{"latencyMs": [number], "memoryBytes": [number]}

Rules:
1. Respond with ONLY the javascript code inside a javascript code block.
2. The script will be saved as an ES module (.mjs) at the project root. You MUST use ES module import syntax. Do NOT use require().
   Since the target file may be a CommonJS module (using module.exports) or an ES module (using export), the safest way to import is using a default import or a wildcard import. Use EXACTLY this import path:
   import pkg from '${importSpecifier}';
   const { ... } = pkg;
   // Or:
   import * as pkg from '${importSpecifier}';
3. Ensure the script runs quickly (max 1 second). Do not print any other text.`;

    try {
      const result = await this.quadBrain.reason(prompt, { brain: 'LOGOS', temperature: 0.1 });
      const text = result.text || result.response || '';
      const match = text.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
      const benchmarkCode = match ? match[1].trim() : text.trim();

      const tempBenchPath = path.join(this.rootPath, `temp-bench-${Date.now()}.mjs`);
      await fs.writeFile(tempBenchPath, benchmarkCode, 'utf8');

      // 1. Run baseline on original code
      const baselineResult = await this.shell.execute(`node "${tempBenchPath}"`).catch(() => null);

      return {
        tempBenchPath,
        baselineResult,
        runExperimental: async () => {
          const experimentalResult = await this.shell.execute(`node "${tempBenchPath}"`).catch(() => null);
          
          // Cleanup
          await fs.rm(tempBenchPath, { force: true }).catch(() => {});

          let baselineData = null;
          let experimentalData = null;

          if (baselineResult) {
            const baseMatch = baselineResult.stdout.match(/\{.*\}/);
            if (baseMatch) baselineData = JSON.parse(baseMatch[0]);
          }

          if (experimentalResult) {
            const expMatch = experimentalResult.stdout.match(/\{.*\}/);
            if (expMatch) experimentalData = JSON.parse(expMatch[0]);
          }

          if (!baselineData || !experimentalData) {
            throw new Error(`Benchmark parsing failed. Baseline stdout: "${baselineResult?.stdout || ''}", stderr: "${baselineResult?.stderr || ''}". Experimental stdout: "${experimentalResult?.stdout || ''}", stderr: "${experimentalResult?.stderr || ''}"`);
          }

          const latencyDeltaPercent = ((experimentalData.latencyMs - baselineData.latencyMs) / baselineData.latencyMs) * 100;
          const memoryDeltaBytes = experimentalData.memoryBytes - baselineData.memoryBytes;

          return {
            baseline: baselineData,
            experimental: experimentalData,
            latencyDeltaPercent,
            memoryDeltaBytes
          };
        }
      };

    } catch (err) {
      this.auditLogger.warn(`[Swarm] ⚠️ Failed to initialize empirical benchmark: ${err.message}`);
      return null;
    }
  }

  async runVotingConsensus(state, context, metrics) {
    if (!this.quadBrain) return { passed: true, votes: {} };

    this.auditLogger.info(`[Swarm] 🗳️ Initiating Swarm Decentralized Voting Matrix...`);

    const metricsSummary = metrics ? `
[BENCHMARK METRICS]:
- Latency Delta: ${metrics.latencyDeltaPercent.toFixed(1)}% (Baseline: ${metrics.baseline.latencyMs.toFixed(3)}ms, Experimental: ${metrics.experimental.latencyMs.toFixed(3)}ms)
- Memory Delta: ${metrics.memoryDeltaBytes} bytes
` : 'No benchmark metrics available.';

    const voteSchema = {
      type: "object",
      properties: {
        vote: { type: "string", enum: ["Approve", "Reject", "Request Changes"] },
        reason: { type: "string" }
      },
      required: ["vote", "reason"]
    };

    const castVote = async (name, role, brainType, specificPrompt) => {
        const prompt = `You are ${name}, ${role}.
[NORTH STAR (REQUEST)]: ${state.northStar}
[FILE]: ${context.filepath}
${metricsSummary}

${specificPrompt}

You MUST cast your vote and respond with ONLY a valid JSON object matching this schema:
{
  "vote": "Approve|Reject|Request Changes",
  "reason": "Detailed rationale for your vote"
}

Do not include any preambles, explanations, or code blocks. Return raw JSON only.`;

        const extractVoteFromText = (text) => {
            const clean = text.trim();
            let vote = 'Request Changes';
            if (/\bapprove\b/i.test(clean)) {
                vote = 'Approve';
            } else if (/\breject\b/i.test(clean)) {
                vote = 'Reject';
            }
            return {
                vote,
                reason: clean.slice(0, 300)
            };
        };

        try {
            const res = await this.quadBrain.reason(prompt, { brain: brainType, temperature: 0.1 });
            try {
                const parsed = this._parseRobustJSON(res.text, false);
                return validateSchema(voteSchema, parsed);
            } catch (jsonErr) {
                this.auditLogger.warn(`[Swarm] JSON parse failed for ${name} vote, trying text extraction.`);
                return extractVoteFromText(res.text);
            }
        } catch (err) {
            this.auditLogger.warn(`[Swarm] ⚠️ Vote failed for ${name}: ${err.message}. Defaulting to Request Changes.`);
            return { vote: 'Request Changes', reason: `Voting failed: ${err.message}` };
        }
    };

    const kuzeTask = castVote(
        'KUZE (LOGOS)',
        'SOMA\'s Architectural Analyst (LOGOS)',
        'LOGOS',
        `Focus on performance delta. If there is a latency regression > 10%, you should vote "Reject" or "Request Changes" unless the request explicitly accepts it for security or logic reasons. If performance is optimized or steady, vote "Approve".`
    );

    const batouTask = castVote(
        'BATOU (THALAMUS)',
        'SOMA\'s Security Auditor (THALAMUS)',
        'THALAMUS',
        `Focus on the code's safety, exception handling, and input validation. Review if the changes could introduce vulnerabilities or crashes. Vote "Approve" if safe, "Reject" if a severe vulnerability is present, or "Request Changes" for missing validations.`
    );

    const steveTask = castVote(
        'STEVE (PROMETHEUS)',
        'SOMA\'s Lead Software Maintainer (PROMETHEUS)',
        'PROMETHEUS',
        `Focus on code readability, complexity, duplication, and overall maintainability. Ensure the patch conforms to clean code guidelines. Vote "Approve" if acceptable, "Reject" if overly complex/unclean, or "Request Changes" if minor refactoring is needed.`
    );

    const [kuzeVote, batouVote, steveVote] = await Promise.all([kuzeTask, batouTask, steveTask]);

    const votes = {
        Kuze: kuzeVote,
        Batou: batouVote,
        Steve: steveVote
    };

    this.auditLogger.info(`[Swarm] 🗳️ Voting Results:
   - Kuze (Performance): ${kuzeVote.vote} ("${kuzeVote.reason}")
   - Batou (Security): ${batouVote.vote} ("${batouVote.reason}")
   - Steve (Maintainer): ${steveVote.vote} ("${steveVote.reason}")`);

    const approvals = Object.values(votes).filter(v => v.vote === 'Approve').length;
    const passed = approvals >= 2;

    return {
        passed,
        approvals,
        votes
    };
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

    // 🍭 PHYSICAL NUTRIENT GENERATION: Philosophy of the Fix
    if (data.success) {
        try {
            const nutrientId = `fix_${crypto.randomBytes(4).toString('hex')}`;
            const prompt = `
You are SOMA's Lead Architect. You just completed a successful engineering swarm modification.
TARGET FILE: ${data.filepath}
REQUEST: ${data.request}
CONSENSUS RATIONALE: ${data.consensus || "N/A"}

TASK: Synthesize a high-level "YumYum" nutrient (3-4 paragraphs) explaining the PHILOSOPHY behind this fix.
Do not just list code changes. Explain the architectural principle we reinforced, the technical debt we cleared, or the system resilience we improved.

Write this for the LOGOS library. Be precise, technical, and declarative.
`.trim();

            const result = await this.quadBrain.reason(prompt, { brain: 'LOGOS', temperature: 0.7 });
            const philosophy = result?.text || result;

            if (philosophy) {
                const filename = `philosophy_of_fix_${nutrientId}.md`;
                const header = [
                    '---',
                    'lobe: logos',
                    'type: philosophy_of_fix',
                    `target: ${data.filepath}`,
                    `timestamp: ${new Date().toISOString()}`,
                    '---',
                    '',
                    `# Philosophy of Fix: ${path.basename(data.filepath)}`,
                    ''
                ].join('\n');

                const yumyumPath = path.join(process.cwd(), 'knowledge', 'logos', 'yumyums', filename);
                await fs.writeFile(yumyumPath, header + philosophy + '\n');
                this.auditLogger.info(`[Swarm] 🍭 Nutrient generated: ${filename}`);
            }
        } catch (e) {
            this.auditLogger.warn(`[Swarm] ⚠️ Failed to generate nutrient: ${e.message}`);
        }
    }
  }
}

export default EngineeringSwarmArbiter;
