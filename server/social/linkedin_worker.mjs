#!/usr/bin/env node
/**
 * linkedin_worker.mjs
 * Standalone child process for LinkedIn Voyager API calls.
 * Reads a JSON task from stdin, writes a JSON result to stdout.
 *
 * Task types: post, getMe, getNotifications, replyToPost
 */

import https from 'https';

function voyager(method, endpoint, body, liAt, jsessionid) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const csrf = jsessionid.replace(/^"|"$/g, '');

        const headers = {
            'accept':             'application/vnd.linkedin.normalized+json+2.1',
            'accept-language':    'en-US,en;q=0.9',
            'content-type':       'application/json',
            'csrf-token':         csrf,
            'origin':             'https://www.linkedin.com',
            'referer':            'https://www.linkedin.com/feed/',
            'x-li-lang':          'en_US',
            'x-li-page-instance': 'urn:li:page:d_flagship3_feed;FEED',
            'x-li-pem-metadata':  'Voyager - Feed=true',
            'x-li-track':         JSON.stringify({ clientVersion: '1.13.16900', mpVersion: '1.13.16900', osName: 'web', timezoneOffset: -4, timezone: 'America/New_York', deviceFormFactor: 'DESKTOP', mpName: 'voyager-web' }),
            'x-requested-with':   'XMLHttpRequest',
            'user-agent':         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'cookie':             `li_at=${liAt}; JSESSIONID="${csrf}"`,
        };
        if (data) headers['content-length'] = Buffer.byteLength(data);

        const options = {
            hostname: 'www.linkedin.com',
            port:     443,
            path:     `/voyager/api/${endpoint}`,
            method,
            headers,
            timeout:  20000,
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', d => raw += d);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || parsed.code || JSON.stringify(parsed).slice(0, 200)}`));
                    } else {
                        resolve(parsed);
                    }
                } catch {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
                    } else {
                        resolve({ raw });
                    }
                }
            });
        });

        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        if (data) req.write(data);
        req.end();
    });
}

/**
 * Validate li_at and fetch a fresh JSESSIONID from LinkedIn's feed page.
 * Throws if the session is expired (LinkedIn sends "li_at=delete me").
 */
function refreshSession(liAt) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'www.linkedin.com',
            port:     443,
            path:     '/feed/',
            method:   'GET',
            headers:  {
                'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'cookie':          `li_at=${liAt}`,
            },
            timeout: 15000,
        };
        const req = https.request(options, (res) => {
            res.resume();
            res.on('end', () => {
                const setCookies = [].concat(res.headers['set-cookie'] || []);

                if (setCookies.some(c => c.includes('li_at=delete me') || c.includes('li_at=delete%20me'))) {
                    reject(new Error('LinkedIn session expired — re-run scripts/extract_x_session.py while logged into LinkedIn in Edge'));
                    return;
                }

                for (const c of setCookies) {
                    const m = c.match(/JSESSIONID="?([^";]+)"?/);
                    if (m) { resolve(m[1]); return; }
                }

                resolve(null);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('LinkedIn session refresh timed out')); });
        req.end();
    });
}

/**
 * Extract numeric member ID from a LinkedIn fs_miniProfile entityUrn.
 * The base64 payload encodes the ID at bytes 2-5 (big-endian uint32).
 * Falls back to fs_miniProfile→member URN substitution if decoding is uncertain.
 */
function entityUrnToMemberUrn(entityUrn) {
    const b64 = entityUrn.split(':').pop();
    try {
        const bytes = Buffer.from(b64, 'base64');
        // Member ID at bytes 2-5 (big-endian uint32) — standard LinkedIn encoding
        if (bytes.length >= 6) {
            const id = bytes.readUInt32BE(2);
            if (id > 10000) return `urn:li:member:${id}`;
        }
    } catch {}
    // Fallback: swap URN type
    return entityUrn.replace('urn:li:fs_miniProfile:', 'urn:li:member:');
}

async function getMemberUrn(liAt, jsessionid) {
    const me = await voyager('GET', 'me', null, liAt, jsessionid);

    // Normalized JSON: { data: { miniProfile: "urn:li:fs_miniProfile:..." }, included: [...] }
    // Direct object:   { entityUrn: "urn:li:fs_miniProfile:...", miniProfile: {...} }
    const miniProfile = me?.miniProfile || me?.data?.miniProfile;
    const fromIncluded = (me?.included || []).find(i =>
        i?.entityUrn?.includes('fs_miniProfile') || i?.$type?.includes('MiniProfile')
    );

    let entityUrn = '';
    if (typeof miniProfile === 'string' && miniProfile.includes('fs_miniProfile')) {
        entityUrn = miniProfile;
    } else if (miniProfile?.entityUrn) {
        entityUrn = miniProfile.entityUrn;
    } else if (fromIncluded?.entityUrn) {
        entityUrn = fromIncluded.entityUrn;
    } else {
        entityUrn = me?.entityUrn || '';
    }

    if (entityUrn) return entityUrnToMemberUrn(entityUrn);

    // Last resort: identity/profiles/me
    const profile = await voyager('GET', 'identity/profiles/me', null, liAt, jsessionid);
    const pubId   = profile?.publicIdentifier || profile?.id;
    if (!pubId) {
        process.stderr.write(`[linkedin_worker] /me response keys: ${Object.keys(me || {}).join(', ')}\n`);
        throw new Error('Could not determine LinkedIn member URN');
    }
    return `urn:li:person:${pubId}`;
}

/** Normalize a raw Voyager notifications response to a clean array. */
function normalizeNotifications(data) {
    const elements = data?.elements
        || data?.paging && data?.elements
        || (Array.isArray(data?.included) ? data.included : []);

    return elements
        .filter(n => n?.entityUrn || n?.notificationType || n?.headline)
        .map(n => {
            const activityUrns = (n.entityUrns || []).filter(u => String(u).includes(':activity:'));
            return {
                id:          n.entityUrn || n.urn || '',
                type:        n.notificationType || n.type || '',
                headline:    n.headline?.text || n.headlineText || n.headline || '',
                subText:     n.subText?.text || n.subText || '',
                activityUrn: activityUrns[0] || n.entityUrn || '',
                publishedAt: n.publishedAt || n.createdAt || 0,
                seen:        n.read === true || n.seen === true,
            };
        })
        .filter(n => n.id);
}

async function run() {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const task = JSON.parse(raw);

    const { liAt } = task;
    if (!liAt) throw new Error('liAt is required');

    // Validate li_at and refresh JSESSIONID — stored JSESSIONID may be stale
    const freshJsessionid = await refreshSession(liAt);
    const jsessionid = freshJsessionid || task.jsessionid || '';

    let result;

    switch (task.type) {
        case 'getMe': {
            result = await voyager('GET', 'me', null, liAt, jsessionid);
            break;
        }

        case 'post': {
            const authorUrn = await getMemberUrn(liAt, jsessionid);

            result = await voyager('POST', 'ugcPosts', {
                author:          authorUrn,
                lifecycleState:  'PUBLISHED',
                specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                        shareCommentary:    { text: task.text },
                        shareMediaCategory: 'NONE',
                    },
                },
                visibility: {
                    'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
                },
            }, liAt, jsessionid);
            break;
        }

        case 'getNotifications': {
            // Try the current dashboard notifications endpoint, fall back to legacy
            let data;
            try {
                data = await voyager('GET', 'notifications/dashNotifications?q=dashNotifications&start=0&count=20', null, liAt, jsessionid);
            } catch {
                data = await voyager('GET', 'voyagerNotifications?q=recentNotifications&start=0&count=20', null, liAt, jsessionid);
            }
            result = normalizeNotifications(data);
            break;
        }

        case 'replyToPost': {
            const { activityUrn, text: replyText } = task;
            if (!activityUrn || !replyText) throw new Error('activityUrn and text are required');

            const authorUrn    = await getMemberUrn(liAt, jsessionid);
            const encodedUrn   = encodeURIComponent(activityUrn);

            result = await voyager('POST', `socialActions/${encodedUrn}/comments`, {
                actor:   authorUrn,
                message: { text: replyText },
            }, liAt, jsessionid);
            break;
        }

        default:
            throw new Error(`Unknown task type: ${task.type}`);
    }

    process.stdout.write(JSON.stringify({ ok: true, data: result }));
}

run().catch(e => {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
});
