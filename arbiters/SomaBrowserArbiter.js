/**
 * SomaBrowserArbiter.js
 * 
 * The 'Nerve' for the OCULUS Browser Limb.
 * 
 * Logic:
 * 1. Discards simple search snippets in favor of deep-page interaction.
 * 2. Manages the Python Playwright bridge.
 * 3. Enforces RAM discipline (Auto-kill on idle).
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { assertPublicMediaMetadata, assertPublicPost } from '../server/social/SocialContentSafety.js';

export class SomaBrowserArbiter extends EventEmitter {
    constructor(system) {
        super();
        this.system = system;
        this.name = 'OculusBrowser';
        this.rootPath = path.join(process.cwd(), 'appendages', 'provenance', 'browser');
        this.pythonPath = process.env.PROVENANCE_PYTHON_PATH || 'python';
        this.isBusy = false;
    }

    async navigate(url) {
        return await this._dispatchTask('navigate', { url });
    }

    async extract(url) {
        return await this._dispatchTask('extract', { url });
    }

    // Legacy alias
    async extractSource(url) {
        return await this._dispatchTask('extract', { url });
    }

    async search(query, engine = 'duckduckgo') {
        return await this._dispatchTask('search', { query, engine });
    }

    async click(selector) {
        return await this._dispatchTask('click', { selector });
    }

    async fill(selector, value) {
        return await this._dispatchTask('fill', { selector, value });
    }

    async screenshot(url = null, fullPage = false) {
        const filename = `snap-${Date.now()}.png`;
        const savePath = path.join(this.rootPath, 'snapshots', filename);
        const result = await this._dispatchTask('screenshot', { url, full_page: fullPage, path: savePath });
        if (result.success) {
            this.lastScreenshot = `/api/soma/oculus/snapshot/${filename}`;
            this.lastTitle = result.title || this.lastTitle;
            this.lastUrl = url || this.lastUrl;
        }
        return result;
    }

    getStatus() {
        return {
            name: this.name,
            busy: this.isBusy,
            lastScreenshot: this.lastScreenshot || null,
            lastTitle: this.lastTitle || 'Idle',
            lastUrl: this.lastUrl || 'about:blank'
        };
    }

    async evaluate(script) {
        return await this._dispatchTask('evaluate', { script });
    }

    async postToX(text, options = {}) {
        assertPublicPost(text, { platform: 'x', type: 'post' });
        assertPublicMediaMetadata(options.images || (options.imagePath ? [{ path: options.imagePath, alt: options.imageAlt }] : []));
        return await this._dispatchTask('post_x', {
            text,
            images: options.images,
            image_path: options.imagePath || options.image_path,
            image_alt: options.imageAlt || options.image_alt,
        });
    }

    async postToLinkedIn(text) {
        assertPublicPost(text, { platform: 'linkedin', type: 'post' });
        return await this._dispatchTask('post_linkedin', { text });
    }

    async setupXLogin() {
        return await this._dispatchTask('setup_x_login', {});
    }

    async setupLinkedInLogin() {
        return await this._dispatchTask('setup_linkedin_login', {});
    }

    /** Scrape recent @mentions from X notifications page. Returns { mentions: [...] } */
    async getMentionsX() {
        return await this._dispatchTask('get_mentions_x', {});
    }

    /** Reply to a specific tweet. tweetUrl = full x.com/status/... URL. */
    async replyToTweetX(tweetUrl, text) {
        assertPublicPost(text, { platform: 'x', type: 'reply' });
        return await this._dispatchTask('reply_to_tweet_x', { tweet_url: tweetUrl, text });
    }

    /** Generic task dispatch for routes that need to call arbitrary tasks. */
    async run(task, payload = {}) {
        if (task === 'post_x' || task === 'post_linkedin' || task === 'reply_to_tweet_x') {
            assertPublicPost(payload.text, { platform: task.includes('linkedin') ? 'linkedin' : 'x', type: task });
            assertPublicMediaMetadata(payload.images || (payload.image_path ? [{ path: payload.image_path, alt: payload.image_alt }] : []));
        }
        return await this._dispatchTask(task, payload);
    }

    /**
     * Extract all HTML tables from a URL as a structured JSON array.
     */
    async extractTables(url) {
        return await this._dispatchTask('extract_tables', { url });
    }

    /**
     * Dispatcher: Spawns the physical appendage.
     */
    async _dispatchTask(task, payload) {
        if (this.isBusy) throw new Error('Oculus Browser is already active.');
        
        // 🛡️ RAM Safety Check — headless Chromium needs ~300-400MB; allow down to 0.4GB free
        const freeMem = os.freemem() / 1024 / 1024 / 1024;
        if (freeMem < 0.4) throw new Error(`RAM CRITICAL (${freeMem.toFixed(2)}GB). Browser boot rejected.`);

        this.isBusy = true;
        console.log(`🌐 [OCULUS] Dispatching: ${task}`);

        return new Promise((resolve, reject) => {
            const bridgeScript = path.join(this.rootPath, 'browser_engine.py');
            const py = spawn(this.pythonPath, [bridgeScript]);

            let output = '';
            let error = '';

            py.stdout.on('data', (d) => output += d.toString());
            py.stderr.on('data', (d) => error += d.toString());

            py.on('error', (err) => {
                this.isBusy = false;
                reject(new Error(`[OCULUS] Failed to spawn browser engine: ${err.message} — is playwright installed?`));
            });

            py.on('close', (code) => {
                this.isBusy = false;
                if (code !== 0) return reject(new Error(`Browser crashed (exit ${code}): ${error}`));
                try {
                    resolve(JSON.parse(output));
                } catch (e) {
                    reject(new Error(`Malformed browser response: ${output.slice(0, 200)}`));
                }
            });

            // Handshake: Write task to STDIN
            try {
                py.stdin.write(JSON.stringify({ task, payload }));
                py.stdin.end();
            } catch (e) {
                this.isBusy = false;
                reject(new Error(`[OCULUS] Failed to write to stdin: ${e.message}`));
            }
        });
    }
}

export default SomaBrowserArbiter;
