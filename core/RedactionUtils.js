const REDACTED = '***REDACTED***';

const SECRET_VALUE_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    /\bsk_[A-Za-z0-9_-]{12,}\b/g,
    /\bhf_[A-Za-z0-9_-]{12,}\b/g,
    /\bBSAS[A-Za-z0-9_-]{12,}\b/g,
    /\bghp_[A-Za-z0-9_-]{12,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_-]{12,}\b/g,
    /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g,
    /\b(Bearer\s+)[A-Za-z0-9._-]{12,}\b/gi,
    /\b(api[_-]?key|token|secret|password|credential|authorization)\s*[:=]\s*['"]?[^'"\s,}]+/gi
];

const SECRET_KEY_PATTERN = /(^|[_-])(api[_-]?key|token|secret|password|credential|authorization|cookie|session[_-]?id)($|[_-])/i;

export function redactText(value = '') {
    let output = String(value);
    for (const pattern of SECRET_VALUE_PATTERNS) {
        output = output.replace(pattern, (match, prefix = '') => prefix && /bearer/i.test(prefix) ? `${prefix}${REDACTED}` : REDACTED);
    }
    return output;
}

export function redactObject(value, depth = 0) {
    if (depth > 12 || value == null) return value;
    if (typeof value === 'string') return redactText(value);
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => redactObject(item, depth + 1));

    const safe = {};
    for (const [key, item] of Object.entries(value)) {
        safe[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactObject(item, depth + 1);
    }
    return safe;
}

export default { redactText, redactObject };
