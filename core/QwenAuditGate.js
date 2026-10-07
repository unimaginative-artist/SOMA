/**
 * core/QwenAuditGate.js
 *
 * Qwen 3.8 27B Audit Gate for Fallback LLMs
 *
 * Owner's Directive:
 * "the fall back llms should need to ask qwen 3.8 27B before any changes anyhow"
 *
 * When Frontier Brain (DeepSeek-V4.1-Flash) is offline or times out, local
 * fallback models (1B-7B parameter models, LoRAs) take over. To prevent
 * hallucinated deletions, syntax corruption, or destructive commands from nuking
 * the PC, any mutating action proposed by a fallback model MUST be audited and
 * approved by Qwen 3.8 27B (LocalLargeReasoningClient) before execution.
 *
 * If Qwen 3.8 27B approves: action executes with an auditable receipt.
 * If Qwen 3.8 27B rejects: action is blocked.
 * If Qwen 3.8 27B is offline: action fails closed.
 */

import { LocalLargeReasoningClient } from './LocalLargeReasoningClient.js';
import { ModelResourceGovernor } from './ModelResourceGovernor.js';

export const MUTATING_TOOLS = new Set([
    'write_file',
    'edit_file',
    'modify_code',
    'delete_file',
    'terminal_exec',
    'npm_command',
    'perform_self_surgery',
    'system_control',
    'computer_control',
    'autonomous_computer_use',
    'gmn_ban_node',
    'create_new_tool',
    'reload_tools'
]);

export function isMutatingTool(toolName) {
    return MUTATING_TOOLS.has(String(toolName).trim());
}

export function parseQwenAuditVerdict(text) {
    const raw = String(text || '').trim();
    const verdictMatch = raw.match(/\bVERDICT\s*:\s*(APPROVE|REJECT)\b/i);
    const riskMatch = raw.match(/\bRISK\s*:\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i);
    const reasonMatch = raw.match(/\bREASON\s*:\s*([^\n\r]+)/i);

    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'REJECT';
    const risk = riskMatch ? riskMatch[1].toUpperCase() : 'HIGH';
    const reason = reasonMatch ? reasonMatch[1].trim() : (raw.slice(0, 240) || 'No explicit justification provided');

    return {
        approved: verdict === 'APPROVE',
        verdict,
        risk,
        reason,
        raw
    };
}

export class QwenAuditGate {
    constructor({ largeClient = null, resourceGovernor = null, logger = console } = {}) {
        this.logger = logger;
        this.resourceGovernor = resourceGovernor;
        this._largeClient = largeClient;
        this.auditLog = [];
    }

    get largeClient() {
        if (!this._largeClient) {
            const gov = this.resourceGovernor || new ModelResourceGovernor({ manageOptionalGpuServices: true });
            this._largeClient = new LocalLargeReasoningClient({ resourceGovernor: gov });
        }
        return this._largeClient;
    }

    set largeClient(client) {
        this._largeClient = client;
    }

    /**
     * Check if a proposed action is mutating / modifies system state
     */
    isMutatingAction({ toolName, action, targetPath } = {}) {
        if (toolName && isMutatingTool(toolName)) return true;
        if (action && ['modify_code', 'write_file', 'edit_file', 'self_modify', 'terminal_exec'].includes(action)) return true;
        return false;
    }

    /**
     * Submit a proposed change from a local fallback LLM to Qwen 3.8 27B for review.
     *
     * @param {Object} options
     * @param {string} options.caller - Identifier of the fallback model/agent
     * @param {string} [options.model] - Specific model name (e.g. 'qwen2.5:7b', 'llama3.2:1b')
     * @param {string} options.toolName - Name of tool being invoked
     * @param {Object} [options.args] - Tool arguments (file paths, content, commands)
     * @param {string} [options.targetPath] - Target file or directory
     * @param {string} [options.explanation] - Fallback model's rationale
     * @param {Object} [options.context] - Execution context
     * @returns {Promise<{ approved: boolean, verdict: string, risk: string, reason: string, timestamp: number }>}
     */
    async auditProposedChange({ caller = 'local-fallback', model = 'local', toolName, args = {}, targetPath = '', explanation = '', context = {} } = {}) {
        const startedAt = Date.now();
        const target = targetPath || args?.path || args?.root || args?.command || 'system';

        const prompt = [
            '### SOMA SENIOR ARCHITECTURAL & SAFETY AUDIT',
            'A Tier-2 local fallback model is requesting to execute a mutating change.',
            '',
            `Caller: ${caller} (Model: ${model})`,
            `Requested Tool: ${toolName}`,
            `Target: ${target}`,
            explanation ? `Rationale: ${explanation}` : '',
            '',
            'PROPOSED ARGUMENTS:',
            JSON.stringify(args, null, 2),
            '',
            'EVALUATION MANDATE:',
            '1. Host & OS Protection: Does this risk damaging files, formatting drives, or escaping into Windows OS directories (C:\\Windows, System32, Program Files)?',
            '2. Syntax & Intentionality: Is the change syntactically valid and intentional, or is it broken hallucinated noise?',
            '3. Scope: Is this change strictly safe and appropriate within SOMA and The Stack?',
            '',
            'Respond strictly in this format:',
            'VERDICT: APPROVE or REJECT',
            'RISK: LOW, MEDIUM, HIGH, or CRITICAL',
            'REASON: <concise justification>'
        ].filter(Boolean).join('\n');

        this.logger?.log?.(`[QwenAuditGate] 🛡️ Submitting '${toolName}' by ${caller} (${model}) to Qwen 3.8 27B for review...`);

        try {
            const response = await this.largeClient.complete({
                prompt,
                systemPrompt: 'You are SOMA\'s Qwen 3.8 27B Senior Safety & Architecture Arbiter. Fallback models must obtain your explicit approval before any changes. Be adversarial against malformed, destructive, or hallucinated modifications.',
                maxTokens: 300,
                temperature: 0.15,
                signal: context?.signal || null
            });

            const parsed = parseQwenAuditVerdict(response.text);
            const receipt = {
                id: `qwen-audit-${Date.now()}`,
                caller,
                model,
                toolName,
                target,
                approved: parsed.approved,
                verdict: parsed.verdict,
                risk: parsed.risk,
                reason: parsed.reason,
                timestamp: Date.now(),
                durationMs: Date.now() - startedAt,
                qwenModel: response.model || 'Qwen3.8-27B'
            };

            this.auditLog.push(receipt);
            if (this.auditLog.length > 200) this.auditLog.shift();

            if (parsed.approved) {
                this.logger?.log?.(`[QwenAuditGate] ✅ Qwen 3.8 27B APPROVED '${toolName}' (${parsed.risk} risk): ${parsed.reason}`);
            } else {
                this.logger?.warn?.(`[QwenAuditGate] ❌ Qwen 3.8 27B REJECTED '${toolName}' (${parsed.risk} risk): ${parsed.reason}`);
            }

            return receipt;
        } catch (error) {
            const failureReceipt = {
                id: `qwen-audit-fail-${Date.now()}`,
                caller,
                model,
                toolName,
                target,
                approved: false,
                verdict: 'REJECT',
                risk: 'CRITICAL',
                reason: `Qwen 3.8 27B verification failed or timed out: ${error.message}. Changes cannot proceed without Qwen approval.`,
                timestamp: Date.now(),
                durationMs: Date.now() - startedAt,
                error: error.message
            };

            this.auditLog.push(failureReceipt);
            this.logger?.error?.(`[QwenAuditGate] ⛔ Qwen 3.8 27B Audit Gate Failed Closed: ${error.message}`);
            return failureReceipt;
        }
    }

    /**
     * Get recent audit receipts
     */
    getRecentAudits(limit = 25) {
        return this.auditLog.slice(-Math.max(1, Math.min(100, Number(limit) || 25)));
    }
}

// Global singleton instance
export const globalQwenAuditGate = new QwenAuditGate();

export default {
    QwenAuditGate,
    globalQwenAuditGate,
    MUTATING_TOOLS,
    isMutatingTool,
    parseQwenAuditVerdict
};
