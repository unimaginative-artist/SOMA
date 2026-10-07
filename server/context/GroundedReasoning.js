import { buildSomaContext } from './SomaContextKernel.js';
import { guardPublicText, verifyClaims } from './ClaimVerifier.js';
import { buildOperationalTruthBlock } from './operationalTruth.js';

function extractText(result) {
    return String(result?.text || result?.response || result?.output || result?.message || (typeof result === 'string' ? result : '')).trim();
}

export async function buildGroundedPrompt(query = '', {
    system = null,
    prefix = '',
    suffix = '',
    force = false,
    includeUser = true,
    timeoutMs = 2200
} = {}) {
    let context = '';
    try {
        context = await Promise.race([
            buildSomaContext(query, {
                force,
                mnemonic: system?.mnemonicArbiter || system?.mnemonic,
                includeUser
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
    } catch {}

    // Real measured trading + goal truth, so every grounded voice quotes facts
    // instead of a strategy's sim record or an invented completion percentage.
    let truthBlock = '';
    try { truthBlock = buildOperationalTruthBlock(system); } catch { /* non-fatal */ }

    return [
        prefix,
        truthBlock,
        context ? `\n${context}\n` : '',
        suffix,
        query
    ].filter(Boolean).join('\n');
}

export async function reasonGrounded(brain, query = '', {
    system = null,
    context = {},
    prefix = '',
    suffix = '',
    forceContext = false,
    guard = true,
    guardQuery = null,
    includeUser = true
} = {}) {
    if (!brain?.reason) throw new Error('Grounded reasoning requires a brain.reason function');
    const prompt = await buildGroundedPrompt(query, { system, prefix, suffix, force: forceContext, includeUser });
    const result = await brain.reason(prompt, context);
    let text = extractText(result);
    let claimVerdict = null;
    if (guard && text) {
        claimVerdict = await guardPublicText(text, { query: guardQuery || query });
        text = claimVerdict.text || text;
    }
    return {
        ...((result && typeof result === 'object') ? result : {}),
        text,
        response: text,
        output: text,
        raw: result,
        prompt,
        claimVerdict
    };
}

export async function guardSomaText(text = '', query = '') {
    return guardPublicText(text, { query });
}

export async function verifySomaText(text = '', query = '') {
    return verifyClaims(text, { query });
}

export default {
    buildGroundedPrompt,
    reasonGrounded,
    guardSomaText,
    verifySomaText
};
