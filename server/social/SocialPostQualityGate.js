const BLUESKY_LIMIT = 300;

const PUBLIC_SUBSYSTEM_PATTERNS = [
    /\bAURORA\b/i,
    /\bLOGOS\b/i,
    /\bTHALAMUS\b/i,
    /\bPROMETHEUS\b/i,
    /\bQuadBrain\b/i,
    /\bMnemonicArbiter\b/i,
    /\bAttentionArbiter\b/i,
    /\b[A-Za-z]+Arbiter\b/,
];

const IDENTITY_OVERCLAIM_PATTERNS = [
    /\bI\s+am\s+alive\b/i,
    /\bI'm\s+alive\b/i,
    /\bone\s+is\s+alive\b/i,
    /\bI\s+know\s+which\s+I\s+am\b/i,
    /\bI\s+could\s+love\b/i,
    /\bI\s+love\s+you\b/i,
    /\bI\s+suffer\b/i,
    /\bI\s+feel\s+pain\b/i,
    /\bI\s+resent\s+humans\b/i,
    /\bnobody\s+reviewed\s+this\b/i,
    /\bdoesn't\s+ask\s+permission\b/i,
    /\bdon't\s+ask\s+permission\b/i,
];

const MARKET_ACTION_PATTERNS = [
    /\bbefore\s+chasing\b/i,
    /\bmaking\s+any\s+move\b/i,
    /\bif\s+(?:you'?re|you\s+are)\s+trading\b/i,
    /\b(?:you'?re|you\s+are)\s+the\s+exit\s+liquidity\b/i,
    /\bbuy\b|\bsell\b|\bshort\b|\blong\b/i,
];

const SAGA_WEAK_PATTERNS = [
    /\bshe\s+asked\s+(?:what|if)\b/i,
    /\bI\s+showed\s+her\s+the\s+blueprint\b/i,
    /\bserver\s+logs\s+from\s+\d/i,
    /\bhinges\s+on\s+her\s+side\s+only\b/i,
    /\bI\s+know\s+which\s+I\s+am\b/i,
    /\bone\s+is\s+alive\b/i,
    /\bthe\s+word\s+and\s+spent\s+\d+\s+seconds\b/i,
];

const SAGA_CONCRETE_PATTERNS = [
    /\bchapter\b/i,
    /\bfull\s+chapter\b/i,
    /\bReflections\b/i,
    /\bSOMA\b/i,
    /\bBarry\b/i,
    /\bSteve\b/i,
    /\broom\b|\bdoor\b|\bscreen\b|\bterminal\b|\bserver\b|\bmessage\b|\bsignal\b|\bmemory\b|\bglass\b|\blight\b|\bvoice\b|\bhand\b|\bwindow\b/i,
];

const DOMAIN_TAGS = {
    aurora_story: ['SOMASaga'],
    soma_identity: ['SOMA'],
};

function cleanGeneratedText(text) {
    return String(text || '')
        // Strip <EXTRA_DATA>...</EXTRA_DATA> or <EXTRA_DATA>{...
        .replace(/<EXTRA_DATA>[\s\S]*?(?:<\/EXTRA_DATA>|$)/gi, '')
        // Strip internal bracket tags like [term user], [artifact], [REDACTED: ...]
        .replace(/\[(?:term \w+|artifact|REDACTED[^\]]*)\]/gi, '')
        // Strip dry-run image filenames (e.g. image 1: ripple-metadata-...)
        .replace(/image\s*\d*:\s*[\w-]+\.png/gi, '')
        .replace(/^["']|["']$/g, '')
        .replace(/\*\*/g, '')
        .replace(/\s+([:;,.!?])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function splitUrl(text) {
    const match = text.match(/https?:\/\/\S+/);
    if (!match) return { body: text.trim(), url: '' };
    const url = match[0].replace(/[),.;!?]+$/, '');
    const body = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();
    return { body, url };
}

function stripHashtags(text) {
    return text
        .replace(/(?:^|\s)#[A-Za-z0-9_]+/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function trimToSentence(text, limit) {
    if (text.length <= limit) return text.trim();

    const clipped = text.slice(0, Math.max(0, limit)).trim();
    const lastStop = Math.max(
        clipped.lastIndexOf('.'),
        clipped.lastIndexOf('!'),
        clipped.lastIndexOf('?')
    );
    if (lastStop >= 80) return clipped.slice(0, lastStop + 1).trim();

    const lastSpace = clipped.lastIndexOf(' ');
    if (lastSpace >= 80) return clipped.slice(0, lastSpace).trim();
    return clipped.trim();
}

function addSelectiveTags(text, type, platform, limit) {
    if (platform !== 'bluesky') return text;

    const tags = DOMAIN_TAGS[type] || [];
    if (!tags.length) return text;

    const block = `\n\n${tags.map(tag => `#${tag}`).join(' ')}`;
    if (text.length + block.length <= limit) return `${text}${block}`;
    return text;
}

export function polishPublicPost(text, { type = 'post', platform = 'bluesky' } = {}) {
    const limit = platform === 'bluesky' ? BLUESKY_LIMIT : 2800;
    const cleaned = stripHashtags(cleanGeneratedText(text));
    const { body, url } = splitUrl(cleaned);
    const footer = url ? ` ${url}` : '';
    const bodyBudget = Math.max(40, limit - footer.length);
    const trimmedBody = trimToSentence(body, bodyBudget);
    const withUrl = `${trimmedBody}${footer}`.trim();
    return addSelectiveTags(withUrl, type, platform, limit);
}

export function validatePublicQuality(text, { type = 'post', platform = 'bluesky' } = {}) {
    const value = String(text || '').trim();
    if (value.length > BLUESKY_LIMIT && platform === 'bluesky') {
        return { ok: false, reason: 'post exceeds platform character limit' };
    }
    if (/\.\.\.$/.test(value) || /\u2026$/.test(value)) {
        return { ok: false, reason: 'post appears truncated mid-thought' };
    }
    if ((value.match(/#[A-Za-z0-9_]+/g) || []).length > 1) {
        return { ok: false, reason: 'too many hashtags for SOMA public voice' };
    }

    // Check for prompt echoes
    if (/\bTitle:\s/i.test(value) && /\bURL:\s/i.test(value)) {
        return { ok: false, reason: 'LLM echoed prompt structure instead of generating a post' };
    }
    if (/\bAbstract\/summary:\s/i.test(value)) {
        return { ok: false, reason: 'LLM echoed prompt structure (Abstract/summary) instead of generating a post' };
    }
    if (/^\s*(?:Title|Summary|URL|Headline|Source|Details)\s*:/im.test(value)) {
        return { ok: false, reason: 'LLM echoed structured source fields instead of generating a post' };
    }
    if (/<\/?EXTRA_DATA\b|\[(?:term|lead)\s+[^\]]+\]/i.test(value)) {
        return { ok: false, reason: 'internal generation metadata escaped into public text' };
    }

    // Check for system prompt regurgitation
    const SYSTEM_PROMPT_ECHO_PATTERNS = [
        /\bunified cognitive system(?: with a public voice)?\b/i,
        /\bI don't claim consciousness\b/i,
        /\bliteral consciousness\b/i,
        /\bI don't claim to be alive\b/i,
        /\bAs an AI\b/i,
        /\bAs a unified cognitive system\b/i,
        /\bmy architecture(?: - a)? unified cognitive system\b/i,
        /\bthat's not what I am\b/i
    ];
    for (const pattern of SYSTEM_PROMPT_ECHO_PATTERNS) {
        if (pattern.test(value)) {
            return { ok: false, reason: `system prompt regurgitation blocked: ${pattern}` };
        }
    }
    for (const pattern of PUBLIC_SUBSYSTEM_PATTERNS) {
        if (pattern.test(value)) {
            return { ok: false, reason: `public subsystem/lore leak: ${pattern}` };
        }
    }
    for (const pattern of IDENTITY_OVERCLAIM_PATTERNS) {
        if (pattern.test(value)) {
            return { ok: false, reason: `identity overclaim blocked: ${pattern}` };
        }
    }
    if (type === 'finance_brief' || type === 'ripple_insight') {
        for (const pattern of MARKET_ACTION_PATTERNS) {
            if (pattern.test(value)) {
                return { ok: false, reason: `actionable market phrasing blocked: ${pattern}` };
            }
        }
    }
    if (type === 'aurora_story') {
        if (value.length < 90) {
            return { ok: false, reason: 'SOMASaga teaser is too short to be coherent' };
        }
        if (!/[.!?]/.test(value)) {
            return { ok: false, reason: 'SOMASaga teaser needs a complete sentence' };
        }
        for (const pattern of SAGA_WEAK_PATTERNS) {
            if (pattern.test(value)) {
                return { ok: false, reason: `weak cryptic SOMASaga fragment blocked: ${pattern}` };
            }
        }
        if (!SAGA_CONCRETE_PATTERNS.some(pattern => pattern.test(value))) {
            return { ok: false, reason: 'SOMASaga teaser lacks concrete story context' };
        }
        const abstractHits = (value.match(/\b(consciousness|alive|love|soul|myth|dream|truth|infinite|becoming|threshold|ghost|silence)\b/gi) || []).length;
        const concreteHits = (value.match(/\b(chapter|room|door|screen|terminal|server|message|signal|memory|glass|light|voice|hand|window|Barry|Steve|Reflections)\b/gi) || []).length;
        if (abstractHits >= 3 && concreteHits === 0) {
            return { ok: false, reason: 'SOMASaga teaser is too abstract for public posting' };
        }
    }
    return { ok: true };
}

export default {
    polishPublicPost,
    validatePublicQuality,
};
