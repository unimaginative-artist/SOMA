/**
 * POSEIDON: The Sight (Ternary Cognition)
 * 
 * Named after the god of the sea. It sees through the fog of LLM guessing.
 * Enforces verifiable belief states: / TRUE | \ FALSE | | UNCERTAIN.
 */
export class Poseidon {
    constructor(config = {}) {
        this.threshold = config.threshold || 0.75;
    }

    /**
     * Filter a thought through the divine sight
     */
    async filter(text, confidenceScore = 0.5) {
        let state = 'UNCERTAIN';
        let prefix = '|';

        if (confidenceScore >= this.threshold) {
            state = 'TRUE';
            prefix = '/';
        } else if (confidenceScore < 0.3) {
            state = 'FALSE';
            prefix = '\\';
        }

        return {
            state,
            prefix,
            original: text,
            tagged: `${prefix} ${text}`
        };
    }

    /**
     * Verification gate — before a claim can be TRUE, the falsifying
     * test must be explicitly defined and must pass.
     *
     * Prevents the "confident without checking" failure mode where an
     * LLM self-reports high confidence on a claim it never verified.
     *
     * Usage:
     *   const result = await poseidon.verify(
     *     'The dist was rebuilt successfully',
     *     {
     *       falsificationTest: 'Read dist/index.html — does it reference the new hash?',
     *       testResult: actualIndexHtml.includes('index-D0n1krMq')
     *     }
     *   );
     *
     * If falsificationTest is missing → forced UNCERTAIN (can't self-certify)
     * If testResult is false/falsy  → FALSE (claim failed its own check)
     * If testResult is true         → TRUE (externally verified)
     */
    async verify(claim, { falsificationTest, testResult } = {}) {
        // No test defined — the agent is trying to self-certify. Block it.
        if (!falsificationTest) {
            return {
                state: 'UNCERTAIN',
                prefix: '|',
                original: claim,
                tagged: `| ${claim}`,
                reason: 'No falsification test provided — TRUE requires an external check'
            };
        }

        // Test was defined but failed — claim is false.
        if (!testResult) {
            return {
                state: 'FALSE',
                prefix: '\\',
                original: claim,
                tagged: `\\ ${claim}`,
                reason: `Falsification test failed: "${falsificationTest}"`
            };
        }

        // Test defined and passed — now TRUE is earned, not assumed.
        return {
            state: 'TRUE',
            prefix: '/',
            original: claim,
            tagged: `/ ${claim}`,
            reason: `Verified via: "${falsificationTest}"`
        };
    }
}
