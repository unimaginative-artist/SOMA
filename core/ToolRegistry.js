import crypto from 'node:crypto';
import { executionValueHash, sanitizeExecutionValue } from './ExecutionEventLedger.js';
import { resolveBrainTier, isToolAllowedForTier } from './BrainAuthorityPolicy.js';
import { globalQwenAuditGate, isMutatingTool } from './QwenAuditGate.js';
import { GOVERNED_RSI_REPAIR_INTERNAL } from './SelfModificationProtocol.js';

/**
 * ToolRegistry.js
 * 
 * Central registry for SOMA's tools.
 * Allows Arbiters to discover and execute tools.
 * Features upgraded dependency management and topological sorting.
 */

export class ToolRegistry {
  constructor({ executionLedger = null, profileRegistry = null, qwenAuditGate = null, logger = console } = {}) {
    this.tools = new Map();
    this.dependencies = new Map(); // toolName -> string[]
    this.executionLedger = executionLedger;
    this.profileRegistry = profileRegistry;
    this.qwenAuditGate = qwenAuditGate || globalQwenAuditGate;
    this.logger = logger;
    this.middleware = {
      preExecute: [],
      execute: [],
      postExecute: [],
      result: []
    };
    this.guards = [];
    this.usage = new Map();
  }

  configure({ executionLedger, profileRegistry, qwenAuditGate, logger } = {}) {
    if (executionLedger !== undefined) this.executionLedger = executionLedger;
    if (profileRegistry !== undefined) this.profileRegistry = profileRegistry;
    if (qwenAuditGate !== undefined) this.qwenAuditGate = qwenAuditGate;
    if (logger !== undefined) this.logger = logger;
    return this;
  }

  use(stage, handler) {
    if (!this.middleware[stage]) throw new TypeError(`Unknown tool middleware stage: ${stage}`);
    if (typeof handler !== 'function') throw new TypeError('Tool middleware must be a function');
    this.middleware[stage].push(handler);
    return () => {
      const index = this.middleware[stage].indexOf(handler);
      if (index >= 0) this.middleware[stage].splice(index, 1);
    };
  }

  guard(handler) {
    if (typeof handler !== 'function') throw new TypeError('Tool guard must be a function');
    this.guards.push(handler);
    return () => {
      const index = this.guards.indexOf(handler);
      if (index >= 0) this.guards.splice(index, 1);
    };
  }

  /**
   * Register a new tool
   * @param {Object} tool - Tool definition
   * @param {string} tool.name - Unique name (e.g., 'calculator')
   * @param {string} tool.description - Description for the LLM
   * @param {Object} tool.parameters - JSON Schema for arguments
   * @param {string[]} [tool.dependencies] - Names of tools this tool depends on
   * @param {Function} tool.execute - Async function(args) => result
   */
  registerTool(tool) {
    if (!tool.name || !tool.execute) {
      console.error('[ToolRegistry] Invalid tool definition:', tool);
      return;
    }
    this.tools.set(tool.name, tool);
    this.dependencies.set(tool.name, tool.dependencies || []);
    
    console.log(`[ToolRegistry] Registered tool: ${tool.name}${tool.dependencies ? ` (deps: ${tool.dependencies.join(', ')})` : ''}`);
  }

  /**
   * Validate all tool dependencies for cycles or missing tools.
   */
  validateDependencies() {
    const visited = new Set();
    const stack = new Set();

    const check = (name) => {
      if (stack.has(name)) {
        throw new Error(`[ToolRegistry] Circular dependency detected: ${Array.from(stack).join(' -> ')} -> ${name}`);
      }
      if (visited.has(name)) return;

      visited.add(name);
      stack.add(name);

      const deps = this.dependencies.get(name) || [];
      for (const dep of deps) {
        if (!this.tools.has(dep)) {
          console.warn(`[ToolRegistry] Tool '${name}' depends on missing tool '${dep}'`);
          continue;
        }
        check(dep);
      }

      stack.delete(name);
    };

    for (const toolName of this.tools.keys()) {
      check(toolName);
    }
    
    return true;
  }

  /**
   * Get tools in an order that satisfies dependencies (topological sort)
   */
  getExecutionOrder(targetTools = []) {
    const list = targetTools.length > 0 ? targetTools : Array.from(this.tools.keys());
    const sorted = [];
    const visited = new Set();
    const stack = new Set();

    const visit = (name) => {
      if (stack.has(name)) throw new Error(`Circular dependency involving ${name}`);
      if (visited.has(name)) return;

      stack.add(name);
      const deps = this.dependencies.get(name) || [];
      for (const dep of deps) {
        if (this.tools.has(dep)) visit(dep);
      }
      stack.delete(name);
      visited.add(name);
      sorted.push(name);
    };

    for (const name of list) {
      visit(name);
    }

    return sorted;
  }

  /**
   * Get all tools formatted for LLM system prompt
   */
  getToolsManifest() {
    return Array.from(this.tools.values()).map(t => {
      const usage = this.getUsageStats(t.name);
      return {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        dependencies: t.dependencies || [],
        category: t.category || 'custom',
        createdBy: t.createdBy || 'system',
        usageCount: usage.calls,
        usage
      };
    });
  }

  getTool(name) {
    return this.tools.get(name);
  }

  async execute(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return this.executeDefinition(name, tool, args, context);
  }

  async executeDefinition(name, tool, args = {}, context = {}) {
    if (!tool || typeof tool.execute !== 'function') throw new TypeError(`Tool ${name} has no executable definition`);
    const startedAt = Date.now();
    const callId = String(context.callId || crypto.randomUUID());
    const ownsSession = !context.sessionId;
    const sessionId = String(context.sessionId || `tool-${callId}`);
    const profileId = String(context.profileId || 'default');
    const execution = {
      callId,
      sessionId,
      name,
      arguments: args,
      argumentHash: executionValueHash(args),
      actor: context.actor || 'soma',
      profileId,
      parentCallId: context.parentCallId || null,
      signal: context.signal || null,
      metadata: context.metadata || null
    };

    const ledger = context.record === false ? null : (context.executionLedger || this.executionLedger);
    if (ledger) {
      await ledger.startSession(sessionId, {
        kind: ownsSession ? 'standalone-tool' : (context.sessionKind || 'agent-execution'),
        actor: execution.actor,
        profileId,
        modelProvider: context.modelProvider || null,
        localModel: context.localModel === true,
        goalId: context.goalId || null,
        personas: context.personas || [],
        plugins: context.plugins || []
      });
      await ledger.append(sessionId, 'tool/call', {
        callId,
        name,
        arguments: args,
        argumentHash: execution.argumentHash,
        actor: execution.actor,
        profileId,
        parentCallId: execution.parentCallId,
        replaySafe: tool.replaySafe === true
      });
    }

    let outcome;
    try {
      if (this.profileRegistry) {
        const decision = this.profileRegistry.allowsTool(profileId, name);
        if (!decision.allowed) {
          const error = new Error(decision.reason);
          error.code = 'TOOL_PROFILE_DENIED';
          throw error;
        }
      }

      // 1. Brain-Tiered Authority Gate
      const authorityTier = resolveBrainTier(context);
      let qwenReceipt = null;
      const governedRepair = name === 'modify_code' && context.source === 'SomaAgenticExecutor'
        && context.rsiRepairToken === GOVERNED_RSI_REPAIR_INTERNAL;

      // Owner's Directive: Fallback LLMs (Tier-2 Local) must ask Qwen 3.8 27B before any mutating changes
      // A hash-pinned RSI repair is not a unilateral fallback-model mutation:
      // it still requires the separate MAX -> container -> NEMESIS -> governance
      // pipeline. Other local mutation calls retain the Qwen audit.
      if (authorityTier === 'local' && isMutatingTool(name) && !governedRepair) {
        this.logger?.log?.(`[ToolRegistry] 🛡️ Fallback LLM requesting mutating tool '${name}'. Submitting to Qwen 3.8 27B for review...`);
        const auditGate = context.qwenAuditGate || this.qwenAuditGate || globalQwenAuditGate;
        const audit = await auditGate.auditProposedChange({
          caller: context.actor || 'local-fallback',
          model: context.model || 'local',
          toolName: name,
          args,
          context
        });

        qwenReceipt = audit;
        if (!audit.approved) {
          const error = new Error(`[Qwen 3.8 27B Audit Rejected] Action '${name}' blocked: ${audit.reason}`);
          error.code = 'TOOL_QWEN_AUDIT_REJECTED';
          error.auditReceipt = audit;
          throw error;
        }
      }

      const authorityCheck = governedRepair ? { allowed: true, approvedBy: 'governed_rsi_repair_plan' }
        : isToolAllowedForTier(name, authorityTier, { qwenApproved: Boolean(qwenReceipt?.approved) });
      if (!authorityCheck.allowed) {
        const error = new Error(authorityCheck.reason);
        error.code = 'TOOL_AUTHORITY_DENIED';
        throw error;
      }
      for (const middleware of this.middleware.preExecute) {
        const decision = await middleware(execution);
        if (decision?.kind === 'deny' || decision?.allowed === false) {
          const error = new Error(decision.reason || `Tool ${name} denied by pre-execution policy`);
          error.code = 'TOOL_POLICY_DENIED';
          throw error;
        }
      }
      for (const guard of this.guards) {
        const reason = await guard(execution);
        if (reason) {
          const error = new Error(String(reason));
          error.code = 'TOOL_GUARD_DENIED';
          throw error;
        }
      }

      this.logger?.log?.(`[ToolRegistry] Executing ${name} with args:`, sanitizeExecutionValue(args));
      const dispatch = async () => {
        const timeoutMs = Number(context.timeoutMs || tool.timeoutMs || 0);
        if (!(timeoutMs > 0)) return tool.execute(args, { ...context, ...execution, authorityTier, qwenAudit: qwenReceipt });
        const controller = new AbortController();
        const callerAbort = () => controller.abort(context.signal?.reason);
        context.signal?.addEventListener?.('abort', callerAbort, { once: true });
        let timer;
        try {
          return await Promise.race([
            tool.execute(args, { ...context, ...execution, authorityTier, qwenAudit: qwenReceipt, signal: controller.signal }),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                controller.abort(new Error(`Tool ${name} timed out`));
                const error = new Error(`Tool ${name} timed out after ${timeoutMs}ms`);
                error.code = 'TOOL_TIMEOUT';
                reject(error);
              }, timeoutMs);
              timer.unref?.();
            })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          context.signal?.removeEventListener?.('abort', callerAbort);
        }
      };

      const around = this.middleware.execute.reduceRight(
        (next, middleware) => () => middleware(execution, next),
        dispatch
      );
      let result = await around();
      for (const middleware of this.middleware.postExecute) {
        const replacement = await middleware(execution, result);
        if (replacement !== undefined) result = replacement;
      }
      outcome = { ok: true, value: result };
      return result;
    } catch (error) {
      outcome = {
        ok: false,
        error: { name: error.name || 'Error', message: error.message, code: error.code || null }
      };
      this.logger?.error?.(`[ToolRegistry] Execution failed for ${name}:`, error);
      throw error;
    } finally {
      const durationMs = Date.now() - startedAt;
      const prior = this.usage.get(name) || { calls: 0, successes: 0, failures: 0, totalDurationMs: 0, lastUsedAt: null };
      const stats = {
        calls: prior.calls + 1,
        successes: prior.successes + (outcome?.ok ? 1 : 0),
        failures: prior.failures + (outcome?.ok ? 0 : 1),
        totalDurationMs: prior.totalDurationMs + durationMs,
        lastUsedAt: new Date().toISOString()
      };
      this.usage.set(name, stats);
      const receipt = {
        callId,
        name,
        ok: outcome?.ok === true,
        value: outcome?.ok ? outcome.value : undefined,
        valueHash: outcome?.ok ? executionValueHash(outcome.value) : null,
        error: outcome?.ok ? null : outcome?.error,
        durationMs,
        profileId
      };
      if (ledger) {
        await ledger.append(sessionId, 'tool/result', receipt).catch(error => {
          this.logger?.warn?.(`[ToolRegistry] Could not persist result for ${name}: ${error.message}`);
        });
        if (ownsSession) await ledger.endSession(sessionId, { ok: receipt.ok, durationMs }).catch(() => {});
      }
      for (const middleware of this.middleware.result) {
        try { await middleware(execution, receipt); }
        catch (error) { this.logger?.warn?.(`[ToolRegistry] Result observer failed for ${name}: ${error.message}`); }
      }
    }
  }

  getUsageStats(name = null) {
    if (name) return this.usage.get(name) || { calls: 0, successes: 0, failures: 0, totalDurationMs: 0, lastUsedAt: null };
    return Object.fromEntries(this.usage.entries());
  }
}

export default new ToolRegistry();
