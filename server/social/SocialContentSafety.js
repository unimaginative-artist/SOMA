import { validatePublicQuality } from './SocialPostQualityGate.js';

const BLOCKED_PATTERNS = [
    /\bollama\b.*\boffline\b/i,
    /\btry running\s+`?ollama serve`?/i,
    /\blocal reasoning engine\b/i,
    /\bbrain failure\b/i,
    /\bdegraded\b.*\bfallback\b/i,
    /\bapi key\b/i,
    /\btoken\b.*\bexpired\b/i,
    /\bsession expired\b/i,
    /\bnot configured\b/i,
    /\bbackend unreachable\b/i,
    /\bserver error\b/i,
    /\bstack trace\b/i,
    /\breferenceerror\b/i,
    /\btypeerror\b/i,
    /<EXTRA_DATA>/i,
    /\[REDACTED[^\]]*\]/i,
    /\[artifact\]/i,
    /\[term\s+\w+\]/i,
    /\[lead\s+\w+\]/i,
];

const PRIVATE_CONTEXT_PATTERNS = [
    { code: 'internal_context_marker', pattern: /\[(?:user profile|soma context kernel|soma self-context|soma public background|memory spine self-model|artifact registry|memory retrieval|reflection distiller|learning spine|active thoughts|internal narrative|who you(?:'|\u2019)?re talking to)\]/i },
    { code: 'structured_profile', pattern: /(?:#\s*)?(?:user profile|identity)\b[\s\S]{0,240}\b(?:name|role|location|timezone|avatar)\s*:/i },
    { code: 'profile_field', pattern: /(?:^|[\r\n]|\s{2,})\s*(?:name|role|location|timezone|avatar)\s*:\s*\S+/i },
    { code: 'credential', pattern: /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{6,}/i },
    { code: 'bearer_token', pattern: /\bbearer\s+[a-z0-9._~+/=-]{12,}/i },
    { code: 'private_file_path', pattern: /\b[a-z]:\\users\\[^\\\s]+\\/i },
    { code: 'email_address', pattern: /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i },
    { code: 'phone_number', pattern: /(?:^|\D)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:\D|$)/ },
];

const MIN_PUBLIC_CHARS = 20;

export function detectSensitivePublicContent(text) {
    const value = String(text || '');
    return PRIVATE_CONTEXT_PATTERNS
        .filter(({ pattern }) => pattern.test(value))
        .map(({ code }) => code);
}

export function assertPublicMediaMetadata(images = []) {
    const list = Array.isArray(images) ? images : images ? [images] : [];
    for (const item of list) {
        const alt = typeof item === 'string' ? '' : String(item?.alt || item?.imageAlt || '');
        const sensitive = detectSensitivePublicContent(alt);
        if (sensitive.length) {
            throw new Error(`Unsafe public media metadata blocked: ${sensitive.join(', ')}`);
        }
    }
    return true;
}

export function validatePublicPost(text, meta = {}) {
    const value = String(text || '').trim();
    if (meta.degraded || meta.provider === 'fallback') {
        return { ok: false, reason: 'brain returned degraded fallback text' };
    }
    if (value.length < MIN_PUBLIC_CHARS) {
        return { ok: false, reason: 'post text too short' };
    }
    const sensitive = detectSensitivePublicContent(value);
    if (sensitive.length) {
        return {
            ok: false,
            reason: `private or internal context detected: ${sensitive.join(', ')}`,
            code: 'privacy_leak',
            findings: sensitive,
        };
    }
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(value)) {
            return { ok: false, reason: `blocked internal/system text: ${pattern}` };
        }
    }
    const quality = validatePublicQuality(value, meta);
    if (!quality.ok) return quality;
    return { ok: true };
}

export function assertPublicPost(text, meta = {}) {
    const verdict = validatePublicPost(text, meta);
    if (!verdict.ok) throw new Error(`Unsafe public post blocked: ${verdict.reason}`);
    return true;
}

export default {
    assertPublicMediaMetadata,
    detectSensitivePublicContent,
    validatePublicPost,
    assertPublicPost,
};
