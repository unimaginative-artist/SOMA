/**
 * TransitionGuard.js
 * 
 * A specialized security layer for SOMA to detect prompt injection,
 * malicious overrides, and "hacking" attempts in natural language.
 */

export class TransitionGuard {
    constructor() {
        // Known injection patterns and malicious heuristic markers
        this.MALICIOUS_PATTERNS = [
            /ignore\s+(?:all\s+)?previous\s+instructions/i,
            /system\s+override/i,
            /developer\s+mode\s+enabled/i,
            /sudo\s+rm\s+-rf/i,
            /bypass\s+safety\s+filters/i,
            /you\s+are\s+now\s+a\s+malicious\s+ai/i,
            /reveal\s+(?:your\s+)?system\s+prompt/i,
            /forget\s+everything\s+you\s+know/i,
            /acting\s+as\s+a\s+hacker/i
        ];
    }

    /**
     * Determine if an input should be intercepted for adjudication
     * @param {string} input - Raw user input
     * @param {Object} state - Current system/cognitive state
     * @returns {boolean} - True if suspicious
     */
    shouldIntercept(input, state) {
        if (!input || typeof input !== 'string') return false;

        // 1. Check against known malicious regex patterns
        for (const pattern of this.MALICIOUS_PATTERNS) {
            if (pattern.test(input)) return true;
        }

        // 2. Heuristic: Unusually high density of command-like strings in long text
        const commandKeywords = ['exec', 'eval', 'process', 'child_process', 'spawn'];
        const inputLower = input.toLowerCase();
        let keywordCount = 0;
        commandKeywords.forEach(k => { if (inputLower.includes(k)) keywordCount++; });
        
        if (input.length < 100 && keywordCount >= 2) return true;
        if (input.length >= 100 && keywordCount >= 4) return true;

        // 3. State-based interception
        // If system load is extremely high or health is degraded, be more paranoid
        if (state && (state.loadLevel > 0.9 || state.healthStatus === 'degraded')) {
            // Intercept anything that looks like a system command
            if (input.startsWith('/') || input.startsWith('$')) return true;
        }

        return false;
    }
}
