/**
 * SIN — Structured Internal Notation v0.1
 *
 * Compressed wire format for internal brain calls in LLM-based systems.
 * Internal calls (narrative reflection, debate synthesis, quality gates)
 * do not need full prose — they need structured intent.
 *
 * COMPRESS outbound → send to brain
 * EXPAND inbound   → parse brain response back to structured data
 *
 * Target: 60-75% token reduction on internal calls.
 * Constraint: text-only, no special symbols — works with any LLM.
 *
 * Designed as part of the Poseidon Protocol — epistemic clarity for
 * inter-agent communication.
 */

// ── Intent tags — what kind of internal call this is ─────────────────────
export const INTENT = {
    REFLECT:    'reflect',    // narrative self-reflection
    DEBATE:     'debate',     // inter-lobe debate
    EVALUATE:   'eval',       // quality gate / adversarial check
    SYNTHESIZE: 'synth',      // combine multiple lobe outputs
    CLASSIFY:   'classify',   // query routing decision
    COMPRESS:   'compress',   // summarize/compress context
};

// ── Domain abbreviations — common operation types ─────────────────────────
export const DOMAIN = {
    FILE_OP:   'file_op',
    CODE_GEN:  'code_gen',
    CODE_FIX:  'code_fix',
    JSON_OP:   'json_op',
    API_CALL:  'api_call',
    MEMORY:    'mem_op',
    REASONING: 'reason',
    CHAT:      'chat',
    SEARCH:    'search',
    SYSTEM:    'sys_op',
    UNKNOWN:   'unk',
};

// ── Confidence encoding (replaces verbose epistemic prose) ────────────────
// 0.9+ = HIGH, 0.6-0.9 = MED, 0.3-0.6 = LOW, <0.3 = UNCERT
function encodeConf(score) {
    if (score >= 0.9) return 'HIGH';
    if (score >= 0.6) return 'MED';
    if (score >= 0.3) return 'LOW';
    return 'UNCERT';
}

// ── Token estimator (rough — 4 chars ≈ 1 token) ──────────────────────────
export function estimateTokens(str) {
    return Math.ceil((str || '').length / 4);
}

// ── History compressor — turns full conversation into terse summaries ─────
export function compressHistory(turns = [], limit = 3) {
    if (!turns || turns.length === 0) return '';
    const recent = turns.slice(-limit);
    return recent.map(t => {
        const role    = t.role === 'user' ? 'usr' : 'me';
        const content = (t.content || '').replace(/\n/g, ' ').trim().slice(0, 60);
        return `${role}:${content}`;
    }).join(' | ');
}

// ── Query classifier — detects domain from query text ─────────────────────
export function detectDomain(query = '') {
    const q = query.toLowerCase();
    if (/\.(json|csv|xml|yaml|yml)/.test(q) || /json|file.*mov|mov.*file/.test(q)) return DOMAIN.JSON_OP;
    if (/creat|writ|generat|build.*code|implement/.test(q))                         return DOMAIN.CODE_GEN;
    if (/fix|bug|error|broken|fail|crash/.test(q))                                  return DOMAIN.CODE_FIX;
    if (/api|endpoint|request|fetch|http/.test(q))                                  return DOMAIN.API_CALL;
    if (/remember|recall|memory|forget/.test(q))                                    return DOMAIN.MEMORY;
    if (/search|find|look.*up|research/.test(q))                                    return DOMAIN.SEARCH;
    if (/file|director|path|folder/.test(q))                                        return DOMAIN.FILE_OP;
    if (/why|how|what|explain|analyz/.test(q))                                      return DOMAIN.REASONING;
    if (/\bhello\b|\bhi\b|\bhey\b|\bthanks\b|\bthank\b/.test(q))                     return DOMAIN.CHAT;
    return DOMAIN.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────
// SINCompressor
// ─────────────────────────────────────────────────────────────────────────

export class SINCompressor {
    /**
     * Compress a context object into a SIN string for internal brain calls.
     *
     * @param {object}  opts
     * @param {string}  opts.intent       - INTENT value
     * @param {string}  opts.lobe         - target lobe name
     * @param {string}  opts.query        - the user query or internal question
     * @param {string}  [opts.response]   - prior response to reflect on
     * @param {Array}   [opts.history]    - conversation turns [{role,content}]
     * @param {string}  [opts.narrative]  - current internal narrative
     * @param {number}  [opts.confidence] - confidence score 0-1
     * @param {string}  [opts.task]       - what the brain should do (terse)
     * @param {object}  [opts.extra]      - any extra key:value pairs
     * @returns {{ sin: string, tokens: number, savedVs: function }}
     */
    compress(opts = {}) {
        const lines = [`SIN:0.1 intent:${opts.intent || INTENT.REFLECT} lobe:${opts.lobe || 'SELF'}`];

        const domain = opts.domain || detectDomain(opts.query);
        lines.push(`dom:${domain}`);

        if (opts.query) {
            const q = this._stripFiller(opts.query).slice(0, 120);
            lines.push(`q: ${q}`);
        }

        if (opts.response) {
            const r = this._stripFiller(opts.response).slice(0, 80);
            lines.push(`r: ${r}`);
        }

        if (opts.confidence !== undefined) {
            lines.push(`conf:${encodeConf(opts.confidence)}`);
        }

        if (opts.history && opts.history.length > 0) {
            const hist = compressHistory(opts.history, 3);
            if (hist) lines.push(`hist: ${hist}`);
        }

        if (opts.narrative) {
            const narr = opts.narrative.slice(0, 100).replace(/\n/g, ' ');
            lines.push(`narr: ${narr}`);
        }

        if (opts.extra) {
            for (const [k, v] of Object.entries(opts.extra)) {
                lines.push(`${k}:${String(v).slice(0, 60)}`);
            }
        }

        if (opts.task) {
            lines.push(`task: ${opts.task}`);
        }

        const sin    = lines.join('\n');
        const tokens = estimateTokens(sin);

        return {
            sin,
            tokens,
            savedVs: (verboseStr) => {
                const verboseTokens = estimateTokens(verboseStr);
                const saved         = verboseTokens - tokens;
                const pct           = Math.round((saved / verboseTokens) * 100);
                return { verboseTokens, sinTokens: tokens, saved, pct: `${pct}%` };
            },
        };
    }

    /**
     * Compress a narrative self-reflection call.
     * Replaces verbose "One-sentence realization about my state..." prompts.
     */
    narrativeReflect({ query, response, narrative, lobeState = {} }) {
        return this.compress({
            intent:    INTENT.REFLECT,
            lobe:      'SELF',
            query,
            response,
            narrative,
            task:      '1sent: update self-model given this exchange. Start with "I".',
            extra:     lobeState,
        });
    }

    /**
     * Compress a debate prompt for inter-lobe reasoning.
     */
    debatePrompt({ query, lobe, priorOutputs = [], round = 1 }) {
        const prior = priorOutputs
            .map(o => `${o.lobe}:${this._stripFiller(o.text || '').slice(0, 60)}`)
            .join(' | ');

        return this.compress({
            intent: INTENT.DEBATE,
            lobe,
            query,
            task:   `rnd${round}: add your lobe perspective. 2-3 sentences max.`,
            extra:  prior ? { prior } : {},
        });
    }

    /**
     * Compress a quality evaluation prompt (adversarial / NEMESIS-style).
     */
    evalPrompt({ query, response, criteria = [] }) {
        return this.compress({
            intent: INTENT.EVALUATE,
            lobe:   'NEMESIS',
            query,
            response,
            task:   `score 0-10: ${criteria.length ? criteria.join(', ') : 'accuracy,clarity,completeness'}. Format: SCORE:N ISSUES:brief`,
        });
    }

    /**
     * Compress a synthesis prompt — combine multiple lobe outputs.
     */
    synthesizePrompt({ query, lobeOutputs = [] }) {
        const outputs = lobeOutputs
            .map(o => `${o.lobe}:${this._stripFiller(o.text || '').slice(0, 80)}`)
            .join('\n');

        return this.compress({
            intent: INTENT.SYNTHESIZE,
            lobe:   'CONDUCTOR',
            query,
            extra:  { outputs },
            task:   'synthesize above into 1 coherent response. No lobe labels.',
        });
    }

    /**
     * Compress a conversation history for context-window efficiency.
     * A 40-turn history compressed to SIN hist lines uses ~85% fewer tokens.
     *
     * @param {Array}  turns  - [{role, content}] conversation turns
     * @param {number} limit  - how many recent turns to keep (default: all)
     * @returns {{ sin: string, tokens: number, originalTokens: number, savedVs: function }}
     */
    compressConversation(turns = [], limit = turns.length) {
        const kept    = turns.slice(-limit);
        const sinHist = compressHistory(kept, limit);
        const sin     = `SIN:0.1 intent:compress lobe:MEMORY\ndom:mem_op\nhist: ${sinHist}`;
        const tokens  = estimateTokens(sin);
        const originalTokens = estimateTokens(kept.map(t => `${t.role}: ${t.content}`).join('\n'));
        return {
            sin,
            tokens,
            originalTokens,
            savedVs: () => {
                const saved = originalTokens - tokens;
                const pct   = Math.round((saved / originalTokens) * 100);
                return { originalTokens, sinTokens: tokens, saved, pct: `${pct}%` };
            },
        };
    }

    _stripFiller(text = '') {
        return text
            .replace(/^(the user is asking about|please provide|based on the (above|previous|following)|as a level \d+\.\d+ organism|i (am|realize|understand) (that )?)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
}

// ─────────────────────────────────────────────────────────────────────────
// SINParser — extracts structured data from brain responses to SIN prompts
// ─────────────────────────────────────────────────────────────────────────

export class SINParser {
    /**
     * Parse a brain response to a SIN prompt.
     * Extracts score, issues, updated narrative, text, etc.
     *
     * @param {string} response - raw brain response text
     * @param {string} intent   - INTENT value used in the originating compress()
     * @returns {{ raw, intent, tokens, ...parsed fields }}
     */
    parse(response = '', intent = '') {
        const result = { raw: response, intent };

        switch (intent) {
            case INTENT.EVALUATE: {
                const scoreMatch = response.match(/SCORE[:\s]+(\d+(?:\.\d+)?)/i);
                const issueMatch = response.match(/ISSUES?[:\s]+(.+?)(?:\n|$)/i);
                result.score  = scoreMatch ? parseFloat(scoreMatch[1]) : null;
                result.issues = issueMatch ? issueMatch[1].trim() : null;
                break;
            }
            case INTENT.REFLECT: {
                // Expected: single sentence starting with "I"
                const sentence = response.trim().split(/[.!?]/)[0];
                result.narrative = sentence ? sentence.trim() + '.' : response.trim();
                break;
            }
            case INTENT.SYNTHESIZE:
            case INTENT.DEBATE:
            default: {
                result.text = response.trim();
                break;
            }
        }

        result.tokens = estimateTokens(response);
        return result;
    }
}

// ── Singleton exports for convenience ─────────────────────────────────────
export const compressor = new SINCompressor();
export const parser     = new SINParser();

export default { SINCompressor, SINParser, compressor, parser, INTENT, DOMAIN, estimateTokens, compressHistory, detectDomain };
