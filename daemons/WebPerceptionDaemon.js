/**
 * daemons/WebPerceptionDaemon.js
 *
 * Persistent web watchdog — treats a set of URLs as "sense organs" rather than
 * one-shot scrape targets. Every tick it snapshots each watched URL, hashes the
 * cleaned HTML (or a specific CSS selector's content), and emits a
 * web.perception.delta signal when something changes.
 *
 * Design choices:
 *  - Hash-based (not event-based): DOM event listeners break on long sessions
 *  - Noise reduction: nonces, Angular/React attrs, and relative timestamps
 *    stripped before hashing to prevent false-positive deltas
 *  - Selector extraction: lightweight regex for #id, .class, and tag selectors
 *    — no DOM parser dependency needed for common cases
 *  - Watch list persists to .soma/web-watchlist.json across restarts
 *
 * Signals emitted:
 *   web.perception.delta   — content changed at a watched URL (high priority)
 *   web.perception.error   — fetch failed for a watched URL (normal priority)
 *
 * Usage:
 *   system.webPerceptionDaemon.addWatch('https://example.com/agenda', {
 *       label: 'City Council Agenda',
 *       selector: '#main-content'
 *   });
 */

import BaseDaemon from './BaseDaemon.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class WebPerceptionDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'WebPerceptionDaemon',
            interval: opts.intervalMs || 30000, // 30s default
            ...opts
        });

        // url → { hash, label, selector, lastCheck, changeCount, lastError }
        this._watchList = new Map();

        this._fetchTimeout    = opts.fetchTimeoutMs || 8000;
        this._persistencePath = path.join(
            opts.rootPath || process.cwd(), '.soma', 'web-watchlist.json'
        );
        this._userAgent = opts.userAgent ||
            'Mozilla/5.0 (compatible; SOMA-WebPerception/1.0; +https://soma.local)';

        // Load persisted watch list on construction (sync is fine — happens once at boot)
        this._loadWatchList();
    }

    // ─── Watch List Management ──────────────────────────────────────────────────

    /**
     * Add a URL to the watch list.
     * @param {string} url
     * @param {{ label?: string, selector?: string }} opts
     */
    addWatch(url, opts = {}) {
        if (this._watchList.has(url)) {
            console.log(`[WebPerception] Already watching: ${url}`);
            return;
        }
        this._watchList.set(url, {
            hash:        null, // null = baseline not yet captured
            label:       opts.label    || url,
            selector:    opts.selector || null,
            lastCheck:   null,
            changeCount: 0,
            lastError:   null
        });
        this._saveWatchList();
        console.log(`[WebPerception] 👁️  Now watching: ${opts.label || url}`);
    }

    /**
     * Remove a URL from the watch list.
     */
    removeWatch(url) {
        this._watchList.delete(url);
        this._saveWatchList();
        console.log(`[WebPerception] Removed watch: ${url}`);
    }

    /**
     * Get current watch list (for API / dashboard)
     */
    getWatchList() {
        const out = {};
        for (const [url, state] of this._watchList.entries()) {
            out[url] = {
                label:       state.label,
                selector:    state.selector,
                lastCheck:   state.lastCheck,
                changeCount: state.changeCount,
                lastError:   state.lastError,
                hasBaseline: state.hash !== null
            };
        }
        return out;
    }

    // ─── Persistence ────────────────────────────────────────────────────────────

    _loadWatchList() {
        try {
            const raw = fs.readFileSync(this._persistencePath, 'utf8');
            const entries = JSON.parse(raw);
            for (const { url, label, selector } of entries) {
                if (!this._watchList.has(url)) {
                    this._watchList.set(url, {
                        hash: null, label: label || url, selector: selector || null,
                        lastCheck: null, changeCount: 0, lastError: null
                    });
                }
            }
            if (this._watchList.size > 0) {
                console.log(`[WebPerception] Loaded ${this._watchList.size} watched URL(s) from disk`);
            }
        } catch (e) {
            // No file yet — OK
        }
    }

    _saveWatchList() {
        try {
            fs.mkdirSync(path.dirname(this._persistencePath), { recursive: true });
            const entries = Array.from(this._watchList.entries()).map(([url, s]) => ({
                url, label: s.label, selector: s.selector
            }));
            fs.writeFileSync(this._persistencePath, JSON.stringify(entries, null, 2));
        } catch (e) {
            console.warn(`[WebPerception] Failed to persist watch list: ${e.message}`);
        }
    }

    // ─── Main Loop ──────────────────────────────────────────────────────────────

    async tick() {
        if (!this._watchList.size) return;

        await Promise.allSettled(
            Array.from(this._watchList.entries()).map(([url, state]) =>
                this._checkUrl(url, state)
            )
        );
    }

    async _checkUrl(url, state) {
        try {
            const html = await this._fetch(url);
            const content = state.selector
                ? this._extractSelector(html, state.selector)
                : html;
            const hash = this._hashContent(content);

            state.lastCheck = Date.now();
            state.lastError = null;

            if (state.hash === null) {
                // First time — capture baseline silently
                state.hash = hash;
                console.log(`[WebPerception] 📸 Baseline: ${state.label}${state.selector ? ' (' + state.selector + ')' : ''}`);
                return;
            }

            if (hash !== state.hash) {
                state.changeCount++;
                const oldHash = state.hash;
                state.hash = hash;

                this.emitSignal('web.perception.delta', {
                    url,
                    label:       state.label,
                    selector:    state.selector,
                    oldHash,
                    newHash:     hash,
                    changeCount: state.changeCount,
                    timestamp:   Date.now()
                }, 'high');

                console.log(`[WebPerception] 🔔 Change #${state.changeCount}: ${state.label}`);
            }

        } catch (err) {
            state.lastError = err.message;
            this.emitSignal('web.perception.error', {
                url, label: state.label,
                error: err.message?.slice(0, 100),
                timestamp: Date.now()
            }, 'normal');
        }
    }

    // ─── Fetch ──────────────────────────────────────────────────────────────────

    async _fetch(url) {
        const res = await fetch(url, {
            headers: { 'User-Agent': this._userAgent },
            signal: AbortSignal.timeout(this._fetchTimeout)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    }

    // ─── Selector Extraction ────────────────────────────────────────────────────

    /**
     * Extract the inner content of a CSS selector match from raw HTML.
     * Supports #id, .class, and bare tag selectors (e.g. main, article).
     * Falls back to full HTML if no match found.
     * Intentionally regex-based — avoids htmlparser2/jsdom dependency.
     */
    _extractSelector(html, selector) {
        if (!selector) return html;

        try {
            if (selector.startsWith('#')) {
                // ID selector: #main-content
                const id  = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re  = new RegExp(`<[^>]+\\sid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
                const m   = html.match(re);
                if (m) return m[1];
            } else if (selector.startsWith('.')) {
                // Class selector: .article-body
                const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re  = new RegExp(`<[^>]+\\sclass=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
                const m   = html.match(re);
                if (m) return m[1];
            } else {
                // Tag selector: main, article, section
                const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re  = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'i');
                const m   = html.match(re);
                if (m) return m[0];
            }
        } catch (e) {
            // Regex error on malformed selector — fall back to full page
        }

        return html; // fallback: hash full page
    }

    // ─── Hashing ────────────────────────────────────────────────────────────────

    /**
     * Clean HTML and return a SHA-256 hash.
     * Strips: script/style blocks, nonces, Angular/React attrs,
     * inline handlers, relative timestamps, and HTML comments.
     */
    _hashContent(html) {
        const cleaned = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            // Nonce and framework-generated attrs
            .replace(/\s+(nonce|_ng\w+|data-react\w+|data-v-\w+)=["'][^"']*["']/g, '')
            .replace(/\s+on\w+=["'][^"']*["']/g, '')
            // Relative timestamps ("5 minutes ago", "just now", etc.)
            .replace(/\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago/gi, 'TIME_AGO')
            .replace(/\b(just now|moments ago|recently)\b/gi, 'TIME_AGO')
            // HTML comments
            .replace(/<!--[\s\S]*?-->/g, '')
            // Collapse whitespace
            .replace(/\s+/g, ' ')
            .trim();

        return crypto.createHash('sha256').update(cleaned).digest('hex');
    }
}

export default WebPerceptionDaemon;
