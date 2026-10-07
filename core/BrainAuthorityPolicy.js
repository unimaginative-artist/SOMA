/**
 * core/BrainAuthorityPolicy.js
 * 
 * Brain-Tiered Tool Authority & Host Scope Policy
 * 
 * Protects the host computer by separating authority between:
 * 1. TIER_FRONTIER (DeepSeek-V4.1-Flash, etc.): Full access across "The Stack" + diagnostic shell commands.
 * 2. TIER_LOCAL (Small local/fallback models: Qwen, Llama, LoRAs): Strictly sandboxed to SOMA root,
 *    shell disabled, read-only/data-only writes.
 * 
 * HARD BOUNDARY: Windows system files, personal directories, and root drives outside "The Stack"
 * are unconditionally blocked for all models.
 */

import path from 'path';

export const BRAIN_TIER = {
    FRONTIER: 'frontier',
    LOCAL: 'local'
};

// Recognized frontier model providers & identifiers
const FRONTIER_MODELS = new Set([
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-chat',
    'deepseek-reasoner',
    'claude-3-7-sonnet',
    'claude-3-5-sonnet',
    'gpt-4o',
    'gpt-4'
]);

// Tools restricted to Frontier Brain only
const RESTRICTED_TOOLS = new Set([
    'terminal_exec',
    'modify_code',
    'edit_file',
    'npm_command',
    'delete_file',
    'system_control',
    'computer_control',
    'perform_self_surgery',
    'autonomous_computer_use',
    'gmn_ban_node'
]);

// SOMA repository root and The Stack parent root
const SOMA_ROOT = path.resolve(process.cwd());
const STACK_ROOT = path.resolve(SOMA_ROOT, '..');

/**
 * Determine the authority tier of a model / caller.
 * @param {Object} options
 * @param {string} [options.authorityTier] - Explicitly asserted tier
 * @param {string} [options.modelProvider] - 'deepseek' | 'ollama' | 'local'
 * @param {string} [options.model] - Model name string
 * @param {boolean} [options.localModel] - Whether caller is flagged as local
 * @returns {'frontier' | 'local'}
 */
export function resolveBrainTier({ authorityTier, modelProvider, model, localModel } = {}) {
    if (authorityTier === BRAIN_TIER.FRONTIER || authorityTier === BRAIN_TIER.LOCAL) {
        return authorityTier;
    }

    if (localModel === true || modelProvider === 'ollama' || modelProvider === 'local') {
        return BRAIN_TIER.LOCAL;
    }

    if (modelProvider === 'deepseek' || (model && FRONTIER_MODELS.has(String(model).toLowerCase()))) {
        return BRAIN_TIER.FRONTIER;
    }

    // Default to safest tier
    return BRAIN_TIER.LOCAL;
}

/**
 * Get the allowed filesystem root for a given authority tier.
 * @param {'frontier' | 'local'} tier
 * @returns {string} Allowed root path
 */
export function getAllowedRootForTier(tier) {
    if (tier === BRAIN_TIER.FRONTIER) {
        return STACK_ROOT; // "The Stack" (SOMA, MAX, finetune, Studio-Profile, etc.)
    }
    return SOMA_ROOT; // Local fallback locked to SOMA repository only
}

/**
 * Check if a tool can be executed by the given authority tier.
 * @param {string} toolName
 * @param {'frontier' | 'local'} tier
 * @param {Object} [options]
 * @param {boolean} [options.qwenApproved=false] - Whether Qwen 3.8 27B explicitly approved this action
 * @returns {{ allowed: boolean, reason?: string, requiresQwenAudit?: boolean }}
 */
export function isToolAllowedForTier(toolName, tier, { qwenApproved = false } = {}) {
    if (tier === BRAIN_TIER.FRONTIER) {
        return { allowed: true };
    }

    // If Qwen 3.8 27B audited and approved the change, permit execution
    if (qwenApproved === true) {
        return { allowed: true, approvedBy: 'Qwen 3.8 27B' };
    }

    // Tier 2 (Local Fallback): Check if tool is high-risk
    if (RESTRICTED_TOOLS.has(toolName)) {
        return {
            allowed: false,
            requiresQwenAudit: true,
            reason: `Access Denied: Tool '${toolName}' requires Tier-1 Frontier Brain authority or explicit approval from Qwen 3.8 27B. Local fallback models cannot make unilateral changes.`
        };
    }

    return { allowed: true };
}

export default {
    BRAIN_TIER,
    resolveBrainTier,
    getAllowedRootForTier,
    isToolAllowedForTier,
    RESTRICTED_TOOLS,
    SOMA_ROOT,
    STACK_ROOT
};
