/**
 * core/CapabilityRegistry.js
 * 
 * Authoritative manifest of SOMA's capabilities, their availability,
 * approval requirements, evidence types, and graceful fallbacks.
 */

export class CapabilityRegistry {
    constructor(opts = {}) {
        this.system = opts.system || null;
        this.capabilities = new Map();
        this._initDefaultCapabilities();
    }

    _initDefaultCapabilities() {
        const defaults = [
            {
                capability: 'search_code',
                available: true,
                requiresApproval: false,
                timeoutMs: 15000,
                evidenceType: 'inspection',
                fallbacks: ['find_files', 'read_file'],
                quality: 0.98,
                description: 'Search workspace source code for literal patterns or symbols.'
            },
            {
                capability: 'read_file',
                available: true,
                requiresApproval: false,
                timeoutMs: 10000,
                evidenceType: 'inspection',
                fallbacks: ['find_files'],
                quality: 0.99,
                description: 'Read workspace text files with line range bounds.'
            },
            {
                capability: 'list_files',
                available: true,
                requiresApproval: false,
                timeoutMs: 5000,
                evidenceType: 'inspection',
                fallbacks: [],
                quality: 0.99,
                description: 'List directory contents in the workspace.'
            },
            {
                capability: 'record_observation',
                available: true,
                requiresApproval: false,
                timeoutMs: 5000,
                evidenceType: 'inspection',
                fallbacks: [],
                quality: 1.0,
                description: 'Record an evidence-backed inspection summary with receipt IDs.'
            },
            {
                capability: 'run_tests',
                available: true,
                requiresApproval: false,
                timeoutMs: 60000,
                evidenceType: 'test_execution',
                fallbacks: [],
                quality: 0.95,
                description: 'Execute unit tests via Node test runner.'
            },
            {
                capability: 'verify_syntax',
                available: true,
                requiresApproval: false,
                timeoutMs: 10000,
                evidenceType: 'syntax_validation',
                fallbacks: [],
                quality: 0.99,
                description: 'Check JavaScript/Node source syntax.'
            },
            {
                capability: 'modify_code',
                available: true,
                requiresApproval: true,
                timeoutMs: 60000,
                evidenceType: 'code_modification',
                fallbacks: ['pulse_stage_code'],
                quality: 0.90,
                description: 'Perform transactional source code modification with rollback.'
            },
            {
                capability: 'browser',
                available: false, // Explicitly false unless headless browser daemon is running
                requiresApproval: true,
                timeoutMs: 30000,
                evidenceType: 'web_interaction',
                fallbacks: ['web_fetch', 'local_inspection'],
                fallbackNotice: 'I can inspect local files and fetch public URLs, but I cannot interactively drive a live website without a browser session.',
                quality: 0.60,
                description: 'Live interactive browser automation.'
            },
            {
                capability: 'shell_exec',
                available: false, // Disabled for arbitrary unvalidated commands; requires approval
                requiresApproval: true,
                timeoutMs: 30000,
                evidenceType: 'shell_receipt',
                fallbacks: ['search_code', 'run_tests'],
                quality: 0.50,
                description: 'Arbitrary shell execution (strictly gated).'
            }
        ];

        for (const cap of defaults) {
            this.capabilities.set(cap.capability, cap);
        }
    }

    getCapability(name) {
        return this.capabilities.get(name) || null;
    }

    isAvailable(name) {
        const cap = this.capabilities.get(name);
        return cap ? cap.available === true : false;
    }

    checkCapability(name) {
        const cap = this.capabilities.get(name);
        if (!cap) {
            return {
                allowed: false,
                reason: `BLOCKED: Unknown capability '${name}'.`,
                fallback: 'Use verified workspace tools: search_code, read_file, list_files.'
            };
        }
        if (!cap.available) {
            const fallbackText = cap.fallbackNotice || (cap.fallbacks.length
                ? `I can use fallbacks: ${cap.fallbacks.join(', ')}.`
                : 'No fallback available.');
            return {
                allowed: false,
                reason: `BLOCKED: The requested capability '${name}' is unavailable.`,
                fallback: fallbackText
            };
        }
        return { allowed: true, capability: cap };
    }

    getManifest() {
        return Array.from(this.capabilities.values());
    }
}

export const globalCapabilityRegistry = new CapabilityRegistry();
export default CapabilityRegistry;
