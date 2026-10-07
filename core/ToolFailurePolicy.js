import path from 'node:path';

export const ToolFailureCategory = Object.freeze({
    INVALID_INPUT: 'invalid_input',
    NOT_FOUND: 'not_found',
    PERMISSION: 'permission_denied',
    RATE_LIMIT: 'rate_limited',
    TIMEOUT: 'timeout',
    NETWORK: 'network',
    SERVICE: 'service_unavailable',
    TOOL_MISSING: 'tool_missing',
    EXECUTION: 'execution_error'
});

const RETRYABLE = new Set([
    ToolFailureCategory.RATE_LIMIT,
    ToolFailureCategory.TIMEOUT,
    ToolFailureCategory.NETWORK,
    ToolFailureCategory.SERVICE
]);

export function classifyToolFailure({ tool, error = null, result = null } = {}) {
    const message = String(error?.message || result?.error || error || 'Unknown tool failure');
    const code = String(error?.code || result?.code || '').toUpperCase();
    const status = Number(result?.status || error?.status || 0) || null;
    let category = ToolFailureCategory.EXECUTION;

    if (/tool .+ not found|unknown tool|not registered/i.test(message)) category = ToolFailureCategory.TOOL_MISSING;
    else if (status === 429 || /rate.?limit|too many requests/i.test(message)) category = ToolFailureCategory.RATE_LIMIT;
    else if (status >= 500 || /service unavailable|bad gateway|gateway timeout/i.test(message)) category = ToolFailureCategory.SERVICE;
    else if (code === 'ENOENT' || status === 404 || /not found|no such file/i.test(message)) category = ToolFailureCategory.NOT_FOUND;
    else if (code === 'EACCES' || code === 'EPERM' || status === 401 || status === 403 || /permission|access denied|outside allowed root|unauthori[sz]ed|forbidden/i.test(message)) category = ToolFailureCategory.PERMISSION;
    else if (code === 'ETIMEDOUT' || code === 'ABORT_ERR' || /timed?\s*out|aborted/i.test(message)) category = ToolFailureCategory.TIMEOUT;
    else if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket/i.test(`${code} ${message}`)) category = ToolFailureCategory.NETWORK;
    else if (status >= 400 && status < 500 || /invalid|required|must (?:start|be|provide)|malformed/i.test(message)) category = ToolFailureCategory.INVALID_INPUT;

    const suggestedTool = tool === 'read_file' && category === ToolFailureCategory.NOT_FOUND ? 'list_files'
        : tool === 'read_file' && category === ToolFailureCategory.PERMISSION ? 'computer_read'
        : tool === 'web_fetch' && category === ToolFailureCategory.INVALID_INPUT ? 'web_fetch'
        : null;

    return {
        ok: false,
        category,
        retryable: RETRYABLE.has(category),
        message,
        code: code || null,
        status,
        suggestedTool,
        observedAt: Date.now()
    };
}

export function successfulToolOutcome(result = null) {
    return {
        ok: true,
        category: 'success',
        retryable: false,
        status: Number(result?.status || 0) || null,
        observedAt: Date.now()
    };
}

export function normalizeReadPath(candidate, rootPath) {
    if (typeof candidate !== 'string') return '';
    let value = String(candidate || '').trim().replace(/^['"`]+|['"`]+$/g, '').replace(/^file:\/\//i, '');
    if (!value) return value;
    const rootName = path.basename(path.resolve(rootPath));
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    const prefix = `${rootName.toLowerCase()}/`;
    if (!path.isAbsolute(value) && normalized.toLowerCase().startsWith(prefix)) {
        value = normalized.slice(prefix.length);
    }
    return value;
}

export function normalizeWebUrl(candidate) {
    const value = String(candidate || '').trim().replace(/^['"`]+|['"`]+$/g, '');
    if (!value || /^https?:\/\//i.test(value)) return value;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(value)) return `https://${value}`;
    return value;
}

export function retryDelayMs(attempt) {
    return Math.min(1000, 200 * (2 ** Math.max(0, Number(attempt || 1) - 1)));
}
