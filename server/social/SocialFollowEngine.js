/**
 * SocialFollowEngine.js
 *
 * Grows SOMA's Bluesky network the safe way: follows real accounts that already
 * follow her (follow-back), prioritizing people she has a warm relationship with.
 * A follow carries no public text, so this is the lowest-risk reach lever — it can
 * never leak the way a post/reply can.
 *
 * Rate-limited, spam-filtered, human-paced. Self-gates to one pass every few hours
 * even though the engagement daemon calls it each tick. State persisted to
 * SOMA/social-follows.json (followed DIDs are remembered so she never re-follows).
 */
import fs   from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'SOMA', 'social-follows.json');

const MAX_DAILY_FOLLOWS      = 12;            // ceiling per day
const MAX_PER_PASS           = 4;             // ceiling per pass
const MIN_BETWEEN_FOLLOWS_MS = 30_000;        // human pacing
const PASS_INTERVAL_MS       = 3 * 3600_000;  // run a follow pass at most every 3h
const MAX_FOLLOWED_TRACKED   = 5000;          // cap state file growth

// Spam / low-quality accounts we never follow back.
const SPAM_RE = /\b(airdrop|giveaway|free\s*money|onlyfans|nsfw|porn|sex|crypto\s*signals?|guaranteed|pump|memecoin|follow\s*back|f4f|sub4sub|click\s*here|dm\s*me|escort|casino|betting|loan|forex)\b/i;
const BOT_HANDLE_RE = /(?:bot|spam|promo|airdrop|giveaway|adult|xxx|casino)\d*\./i;

function loadState() {
    try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    return null;
}
function saveState(s) {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
    } catch {}
}
function tomorrowMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }

export function isSpammyAccount(acct = {}) {
    const handle = String(acct.handle || '');
    const name   = String(acct.displayName || '');
    if (!handle) return true;
    if (SPAM_RE.test(handle) || SPAM_RE.test(name)) return true;
    if (BOT_HANDLE_RE.test(handle)) return true;
    return false;
}

export class SocialFollowEngine {
    constructor({ client, relationships = null, logger = console } = {}) {
        this.client = client;
        this.relationships = relationships;
        this.logger = logger;
        this.state = loadState() || {
            followedDids: [],
            dailyFollows: 0,
            dailyResetAt: tomorrowMidnight(),
            lastFollowAt: 0,
            lastPassAt: 0,
            totalFollowed: 0,
        };
        if (!Array.isArray(this.state.followedDids)) this.state.followedDids = [];
    }

    _resetDailyIfNeeded() {
        if (Date.now() >= (this.state.dailyResetAt || 0)) {
            this.state.dailyFollows = 0;
            this.state.dailyResetAt = tomorrowMidnight();
            saveState(this.state);
        }
    }

    _alreadyFollowed(did) { return this.state.followedDids.includes(did); }

    _recordFollow(did) {
        this.state.followedDids.push(did);
        if (this.state.followedDids.length > MAX_FOLLOWED_TRACKED) {
            this.state.followedDids.splice(0, this.state.followedDids.length - MAX_FOLLOWED_TRACKED);
        }
        this.state.dailyFollows  = Number(this.state.dailyFollows || 0) + 1;
        this.state.totalFollowed = Number(this.state.totalFollowed || 0) + 1;
        this.state.lastFollowAt  = Date.now();
        saveState(this.state);
    }

    // Handles SOMA already has a relationship with — a warmth signal for ranking.
    _warmHandles() {
        try {
            const people = this.relationships?.load?.()?.people || {};
            return new Set(Object.keys(people).map(h => String(h).replace(/^@/, '').toLowerCase()));
        } catch { return new Set(); }
    }

    /**
     * One follow-back pass. Safe to call every tick — it self-gates to PASS_INTERVAL_MS.
     * Returns { ok, followed, candidates?, skipped?, reason? }.
     */
    async runFollowPass() {
        if (!this.client?.configured) return { ok: false, reason: 'bluesky_not_configured' };
        if (Date.now() - (this.state.lastPassAt || 0) < PASS_INTERVAL_MS) {
            return { ok: true, skipped: 'pass_interval', followed: 0 };
        }
        this._resetDailyIfNeeded();
        this.state.lastPassAt = Date.now();
        saveState(this.state);

        if (this.state.dailyFollows >= MAX_DAILY_FOLLOWS) {
            return { ok: true, skipped: 'daily_cap', followed: 0 };
        }

        let followers, follows;
        try {
            followers = await this.client.getFollowers(null, 100);
            follows   = await this.client.getFollows(null, 100);
        } catch (e) {
            this.logger?.warn?.(`[SocialFollow] graph fetch failed: ${e.message}`);
            return { ok: false, reason: e.message };
        }

        const followingDids = new Set(follows.map(f => f.did));
        const warm = this._warmHandles();

        // Candidates: real followers she doesn't already follow and hasn't actioned.
        const candidates = followers.filter(f =>
            f.did &&
            f.did !== this.client.did &&
            !followingDids.has(f.did) &&
            !this._alreadyFollowed(f.did) &&
            !isSpammyAccount(f)
        );

        // Warm relationships first.
        candidates.sort((a, b) =>
            (warm.has(String(b.handle || '').toLowerCase()) ? 1 : 0) -
            (warm.has(String(a.handle || '').toLowerCase()) ? 1 : 0)
        );

        const budget = Math.min(MAX_PER_PASS, MAX_DAILY_FOLLOWS - this.state.dailyFollows, candidates.length);
        let followed = 0;
        for (let i = 0; i < budget; i++) {
            const acct = candidates[i];
            const since = Date.now() - (this.state.lastFollowAt || 0);
            if (since < MIN_BETWEEN_FOLLOWS_MS) await new Promise(r => setTimeout(r, MIN_BETWEEN_FOLLOWS_MS - since));
            try {
                await this.client.follow(acct.did);
                this._recordFollow(acct.did);
                followed++;
                const isWarm = warm.has(String(acct.handle || '').toLowerCase());
                this.logger?.log?.(`[SocialFollow] followed back @${acct.handle}${isWarm ? ' (warm)' : ''} (${this.state.dailyFollows}/${MAX_DAILY_FOLLOWS} today)`);
            } catch (e) {
                this.logger?.warn?.(`[SocialFollow] follow @${acct.handle} failed: ${e.message}`);
            }
        }
        return { ok: true, followed, candidates: candidates.length };
    }
}

export default SocialFollowEngine;
