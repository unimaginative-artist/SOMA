/**
 * server/loaders/authMiddleware.js
 *
 * SOMA Enterprise API Security Layer (Zero Trust Architecture)
 * Validates API keys or JWTs for sensitive endpoints.
 */

import crypto from 'crypto';
import { ensureOperatorCredential } from './operatorCredential.js';
import { isLoopbackRequest } from './localOnlyGuard.js';

function timingSafeMatch(provided, expected) {
    if (!provided || !expected) return false;
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Enterprise Authentication Middleware
 *
 * Accepts: requests from this machine, SOMA_API_KEY (only if actually configured),
 * or the operator credential. There is deliberately no built-in fallback key — the
 * old hardcoded development key was public in source and unlocked trading halt/resume,
 * stored credentials, Kevin SMS config and brain config for anyone on the network.
 * The key is read per request because ESM imports are evaluated before dotenv runs.
 */
export function requireEnterpriseAuth(req, res, next) {
    if (isLoopbackRequest(req)) {
        req.somaAuth = { tier: 'local', authenticatedAt: Date.now() };
        return next();
    }

    const apiKey = req.header('X-API-Key') || req.header('x-api-key');
    const authHeader = req.header('Authorization');
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const providedToken = apiKey || bearerToken || req.header('X-Operator-Token');

    if (!providedToken) {
        console.warn(`[SecurityGate] 🛡️ Unauthorized access attempt to ${req.path}`);
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: API key or operator token required (or call from this machine)',
            code: 'AUTH_MISSING'
        });
    }

    const configuredKey = process.env.SOMA_API_KEY?.trim();
    if (timingSafeMatch(providedToken, configuredKey) || timingSafeMatch(providedToken, ensureOperatorCredential())) {
        req.somaAuth = { tier: 'enterprise', authenticatedAt: Date.now() };
        return next();
    }

    console.warn(`[SecurityGate] 🛡️ Invalid token used for ${req.path}`);
    return res.status(403).json({
        success: false,
        error: 'Forbidden: Invalid API Key',
        code: 'AUTH_INVALID'
    });
}

/**
 * Strong authentication for irreversible governance actions. Unlike the
 * compatibility enterprise middleware, this never accepts the historical
 * built-in development key. A dedicated credential is loaded from the
 * environment or provisioned in ignored local runtime state.
 */
export function requireSelfModificationOperatorAuth(req, res, next) {
    const expected = ensureOperatorCredential();
    if (!expected) {
        return res.status(503).json({
            success: false,
            error: 'Operator controls are unavailable because a credential could not be loaded or provisioned',
            code: 'OPERATOR_AUTH_NOT_CONFIGURED'
        });
    }
    const header = req.header('Authorization');
    const provided = req.header('X-Operator-Token')
        || (header?.startsWith('Bearer ') ? header.slice(7) : null);
    if (!provided) {
        return res.status(401).json({ success: false, error: 'Operator token required', code: 'OPERATOR_AUTH_MISSING' });
    }
    try {
        const actual = Buffer.from(provided);
        const wanted = Buffer.from(expected);
        if (actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted)) {
            req.somaOperatorAuth = { authenticatedAt: Date.now(), scope: 'operator_governance' };
            return next();
        }
    } catch { /* handled below */ }
    return res.status(403).json({ success: false, error: 'Invalid operator token', code: 'OPERATOR_AUTH_INVALID' });
}
