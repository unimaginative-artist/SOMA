import { CAPABILITY_TRIALS } from '../CapabilityTrialRegistry.js';

// Compatibility adapter for callers of the experimental RSI module. The
// CapabilityTrialRegistry is the only benchmark authority; arbitrary JS
// functions supplied as "candidateHarness" must never score an incumbent.
export const RSI_CAPABILITY_PROBES = Object.freeze(Object.keys(CAPABILITY_TRIALS));

export class RsiBenchmarkHarness {
    constructor({ registry } = {}) {
        this.registry = registry || null;
    }

    getBaseline() {
        return this.registry?.getStatus?.() || null;
    }

    setBaseline() {
        throw new Error('RSI baseline cannot be set directly; use governed candidate promotion');
    }

    async runSuite({ domains } = {}) {
        if (!this.registry?.runSuite) throw new Error('Registered capability trials are unavailable');
        if (domains !== undefined && (!Array.isArray(domains) || domains.some(domain => !CAPABILITY_TRIALS[domain]))) {
            throw new Error('Unknown capability trial domain');
        }
        return this.registry.runSuite({ reason: 'rsi_registered_suite', domains });
    }

    async evaluateCandidate() {
        throw new Error('A candidate must be evaluated from an isolated, hash-pinned worktree through SelfRepairCandidate and SelfEvolutionDirector');
    }
}
