/**
 * Local-only guard for SOMA's dangerous endpoints.
 *
 * SOMA listens on 0.0.0.0 so the Studio phone app and the cluster can reach it
 * over the LAN. Before this guard, anyone on the network could also run shell
 * commands, write/patch files, drive the computer, or read raw source (including
 * .env with API keys) through a dozen unauthenticated endpoints.
 *
 * Rule: requests from this machine pass. Requests from any other device must
 * present the operator credential (X-Operator-Token or Authorization: Bearer),
 * the same one used for self-modification governance (.soma/operator-token).
 * Studio/social/chat routes are untouched — only the paths below are gated.
 */
import crypto from 'crypto';
import { ensureOperatorCredential } from './operatorCredential.js';

const GUARDED = [
    // Shell / command execution
    /^\/api\/tools\/(shell|execute)(\/|$)/,
    /^\/api\/command$/,
    /^\/api\/pulse\/(shell|term)(\/|$)/,
    // Language servers read the whole workspace and run tooling processes
    /^\/api\/pulse\/lsp\//,
    /^\/api\/soma\/shell\//,
    /^\/api\/soma\/execute-tool$/,
    /^\/api\/pulse\/steve\/(execute-tool|create-tool)$/,
    /^\/api\/pulse\/workflow\/execute$/,
    /^\/api\/arbiterium\/execute-step$/,
    // File writes, patches, self-modification
    /^\/api\/tools\/file\//,
    /^\/api\/fs\/(operate|browse|read)$/,
    /^\/api\/pulse\/fs\//,
    /^\/api\/soma\/fs\//,
    /^\/api\/pulse\/arbiter\/modify-code$/,
    /^\/api\/soma\/engineering\/modify$/,
    /^\/api\/soma\/swarm\/code-experiments\/[^/]+\/(run|propose-patch)$/,
    /^\/api\/maintenance\/(patch|restart)$/,
    // Rewrites .env (API keys, passwords) and live process.env
    /^\/api\/setup\/env$/,
    // Raw workspace/disk reads (source code, .env, arbitrary drives)
    /^\/api\/files\//,
    /^\/api\/storage\/file-(read|preview)$/,
    /^\/api\/conceive\/fs\//,
    // Computer control
    /^\/api\/perception\/vision\/execute-action$/,
    // AI coding endpoints (spend DeepSeek budget, read source)
    /^\/api\/pulse\/ai\//,
    // SOMA's private curiosity state (Owner's recent messages) and forced ticks (model spend)
    /^\/api\/curiosity\/mind(\/|$)/,
];

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isGuardedPath(pathname = '') {
    return GUARDED.some((re) => re.test(pathname));
}

export function isLoopbackRequest(req) {
    if (!LOOPBACK.has(req.socket?.remoteAddress || '')) return false;
    // A local reverse proxy must not launder LAN traffic into "local"
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return forwarded.every((ip) => LOOPBACK.has(ip));
}

function hasOperatorToken(req) {
    const expected = ensureOperatorCredential();
    if (!expected) return false;
    const header = req.headers.authorization || '';
    const provided = req.headers['x-operator-token'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!provided) return false;
    const a = Buffer.from(String(provided));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function localOnlyGuard(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    const pathname = (req.originalUrl || req.url || '').split('?')[0];
    if (!isGuardedPath(pathname)) return next();
    if (isLoopbackRequest(req) || hasOperatorToken(req)) return next();
    console.warn(`[LocalOnlyGuard] Blocked ${req.method} ${pathname} from ${req.socket?.remoteAddress}`);
    return res.status(403).json({
        success: false,
        ok: false,
        code: 'LOCAL_ONLY',
        error: 'This endpoint can run commands or touch files, so it only accepts requests from this computer (or with the operator token).',
    });
}

export default localOnlyGuard;
