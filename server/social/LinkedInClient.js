/**
 * LinkedInClient.js
 * Posts to LinkedIn via Voyager API using li_at session cookie.
 * Runs API calls in an isolated child process (same Windows Defender workaround as BlueskeyClient).
 * Session cookies read from SOMA/.linkedin-api-session.json
 */

import fs   from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { assertPublicPost } from './SocialContentSafety.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const WORKER       = path.join(__dirname, 'linkedin_worker.mjs');
const SESSION_FILE = path.join(process.cwd(), 'SOMA', '.linkedin-api-session.json');

function loadSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch {}
    return null;
}

function runWorker(task) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [WORKER], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env:   { ...process.env },
        });

        let out = '';
        let err = '';
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => err += d);

        let timeout;
        child.on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            try {
                const parsed = JSON.parse(out);
                if (!parsed.ok) reject(new Error(parsed.error || 'Worker error'));
                else resolve(parsed.data);
            } catch {
                reject(new Error(`Worker bad output (exit ${code}): ${err || out}`));
            }
        });

        child.stdin.write(JSON.stringify(task));
        child.stdin.end();

        timeout = setTimeout(() => {
            child.kill();
            reject(new Error('LinkedIn worker timed out after 45s'));
        }, 45_000);
    });
}

export class LinkedInClient {
    constructor() {
        this.session = loadSession();
    }

    get configured() {
        return !!(this.session?.liAt);
    }

    /** Reload session from disk (call after re-extraction). */
    reloadSession() {
        this.session = loadSession();
    }

    /** Post a text update. Returns the created post data on success. */
    async post(text) {
        assertPublicPost(text, { platform: 'linkedin', type: 'post' });
        if (!this.session?.liAt) throw new Error('LinkedIn not configured — run extract_x_session.py while logged into LinkedIn in Edge');
        return await runWorker({
            type:       'post',
            text:       text.slice(0, 3000),
            liAt:       this.session.liAt,
            jsessionid: this.session.jsessionid,
        });
    }

    /**
     * Fetch recent notifications (comments, mentions, reactions).
     * Returns a normalized array of { id, type, headline, subText, activityUrn, publishedAt, seen }.
     */
    async getNotifications() {
        if (!this.session?.liAt) throw new Error('LinkedIn not configured');
        return await runWorker({
            type:       'getNotifications',
            liAt:       this.session.liAt,
            jsessionid: this.session.jsessionid,
        });
    }

    /**
     * Post a comment reply on a post.
     * activityUrn: "urn:li:activity:<id>"
     * text: reply text (max 1250 chars)
     */
    async replyToPost(activityUrn, text) {
        assertPublicPost(text, { platform: 'linkedin', type: 'reply' });
        if (!this.session?.liAt) throw new Error('LinkedIn not configured');
        return await runWorker({
            type:       'replyToPost',
            activityUrn,
            text:       text.slice(0, 1250),
            liAt:       this.session.liAt,
            jsessionid: this.session.jsessionid,
        });
    }
}

export default new LinkedInClient();
