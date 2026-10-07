import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopbackRequest } from '../loaders/localOnlyGuard.js';
import { requireSelfModificationOperatorAuth } from '../loaders/authMiddleware.js';
import { publicTwitchText, twitchName } from './TwitchSafety.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'twitch-overlay');

// Same-machine cockpit is supported without putting an operator secret in the
// page. LAN access requires the existing operator credential. Reject browser
// cross-origin control calls (including localhost CSRF / DNS-rebinding Hosts).
export function requireTwitchOperator(req, res, next) {
    if (isLoopbackRequest(req)) {
        const host = String(req.headers.host || '');
        if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) {
            return res.status(403).json({ ok: false, error: 'Twitch controls require a trusted local host or operator token' });
        }
        const origin = req.headers.origin;
        const trustedDevOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1):5173$/.test(origin || '');
        if (req.headers['sec-fetch-site'] === 'cross-site'
            || (origin && origin !== `http://${host}` && origin !== `https://${host}` && !trustedDevOrigin)) {
            return res.status(403).json({ ok: false, error: 'Cross-origin Twitch control request rejected' });
        }
        return next();
    }
    return requireSelfModificationOperatorAuth(req, res, next);
}

export function mountTwitchOverlay(router, system) {
    const secure = (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'no-store');
        res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'");
    };
    router.get('/twitch/overlay', (_req, res) => {
        secure(res);
        res.sendFile(path.join(publicDir, 'index.html'));
    });
    router.get('/twitch/overlay.js', (_req, res) => {
        secure(res);
        res.sendFile(path.join(publicDir, 'overlay.js'));
    });
    let clients = 0;
    router.get('/twitch/overlay/events', requireTwitchOperator, (req, res) => {
        const arbiter = system.twitchArbiter;
        if (!arbiter) return res.status(503).json({ ok: false, error: 'Twitch co-host not loaded' });
        if (clients >= 10) return res.status(429).json({ ok: false, error: 'Overlay connection limit reached' });
        clients++;
        secure(res);
        res.set('Content-Type', 'text/event-stream');
        res.set('Connection', 'keep-alive');
        res.set('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const send = (event, data) => {
            // Never buffer unbounded data for a disconnected/slow OBS client.
            if (res.destroyed || res.writableLength > 16384) { res.end(); return; }
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const state = () => send('state', { connected: Boolean(arbiter.connected), state: arbiter.state || 'unknown', asOf: Date.now() });
        const reply = (item) => {
            const text = publicTwitchText(item.reply);
            if (!text) return;
            // Allowlisted projection: no prompts, credentials, owner memories,
            // general websocket events or raw runtime telemetry.
            send('reply', { channel: twitchName(item.channel), text, timestamp: item.timestamp });
        };
        state();
        arbiter.on('public_reply', reply);
        const heartbeat = setInterval(state, 10000);
        heartbeat.unref?.();
        const lifetime = setTimeout(() => res.end(), 30 * 60 * 1000);
        lifetime.unref?.();
        let closed = false;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            clearTimeout(lifetime);
            arbiter.off('public_reply', reply);
            clients--;
        };
        res.on('close', cleanup);
    });
}
