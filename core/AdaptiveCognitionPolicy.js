const HIGH_RISK = /\b(live trad|real money|transfer|withdraw|credential|password|token|delete|remove|deploy|production|publish|post|message|physical|motor|actuator|medical diagnosis|legal advice)\b/i;
const COMPLEX = /\b(architect|debug|diagnos|research|compare|prove|security|refactor|design|investigate|why|root cause|tradeoff|self[- ]?modify)\b/i;
const NOVEL = /\b(new|unknown|never|first time|unfamiliar|invent|novel)\b/i;

/** Routes cognitive effort from measured uncertainty and consequence, not simulated mood alone. */
export class AdaptiveCognitionPolicy {
    constructor({ system = null } = {}) { this.system = system; }
    initialize(system = this.system) { this.system = system || this.system; return this; }

    assess(input = {}, state = {}) {
        const message = String(input.message || input.prompt || '');
        const domain = input.domain || 'general';
        const capability = this.system?.beingKernel?.state?.capabilityState?.[domain] || {};
        const attempts = Number(capability.attempts || 0);
        const verifiedRate = attempts ? Number(capability.verified || 0) / attempts : 0.5;
        const prior = this.system?.proceduralMemory?.retrieve?.({ task: message, domain, limit: 1 })?.[0] || null;
        const novelty = prior ? 1 - Math.min(1, prior.score) : 1;
        const risk = HIGH_RISK.test(message) ? 1 : input.trustedActionAuthority ? 0.45 : 0.2;
        const complexity = Math.min(1,
            (COMPLEX.test(message) ? 0.45 : 0.1) +
            (message.length > 500 ? 0.25 : message.length > 180 ? 0.12 : 0) +
            (NOVEL.test(message) ? 0.15 : 0)
        );
        const uncertainty = Math.min(1, (1 - verifiedRate) * 0.45 + novelty * 0.35 + complexity * 0.2);
        const effort = Math.max(risk, uncertainty, complexity);
        const mode = effort >= 0.75 ? 'adversarial' : effort >= 0.45 ? 'deliberate' : 'fast';
        return {
            mode, risk, uncertainty, complexity, novelty, verifiedRate,
            deepThinking: mode !== 'fast',
            forceMultiLobe: mode === 'adversarial',
            temperature: risk >= 0.75 ? 0.25 : mode === 'fast' ? 0.55 : mode === 'deliberate' ? 0.45 : 0.35,
            requireAdditionalObservation: uncertainty >= 0.7,
            evidenceStrictness: risk >= 0.75 ? 'maximum' : mode === 'fast' ? 'normal' : 'high',
            priorProcedure: prior
        };
    }

    getStatus() {
        return { modes: ['fast', 'deliberate', 'adversarial'], policy: 'measured_uncertainty_complexity_and_consequence' };
    }
}

export default AdaptiveCognitionPolicy;
