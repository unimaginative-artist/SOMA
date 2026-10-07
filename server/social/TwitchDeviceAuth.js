import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { twitchName } from './TwitchSafety.js';

export const TWITCH_CHAT_SCOPES = ['chat:read', 'chat:edit'];
export const TWITCH_POLL_SCOPES = ['channel:read:polls'];

// Secrets travel over stdin, never command arguments. No shell or visible window.
export async function windowsProtect(value, decrypt = false) {
    if (process.platform !== 'win32') throw new Error('Windows credential protection is required');
    // Direct DPAPI avoids inherited PSModulePath loading PowerShell 7 modules
    // into Windows PowerShell 5.1 (including under Node's test runner).
    const prefix = "$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a'); $v=[Console]::In.ReadToEnd(); ";
    const script = prefix + (decrypt
        ? "$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"
        : "$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($b))");
    return new Promise((resolve, reject) => {
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Windows credential protection timed out')); }, 10000);
        child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 262144) child.kill(); });
        child.stderr.on('data', () => {}); // Never surface provider/crypto payloads.
        child.stdin.on('error', () => {});
        child.on('error', () => { clearTimeout(timer); reject(new Error('Windows credential protection unavailable')); });
        child.on('close', code => { clearTimeout(timer); code === 0 && output ? resolve(output) : reject(new Error('Windows credential protection failed')); });
        child.stdin.end(value);
    });
}

export class TwitchProtectedStore {
    constructor(directory = path.join(process.cwd(), '.soma'), codec = windowsProtect) { this.directory = directory; this.codec = codec; }
    filename(key) {
        if (!['device-session', 'auth'].includes(key) && !/^polls-(?:device-session|auth)-[a-z0-9_]{1,25}$/.test(key)) throw new Error('Unknown Twitch credential slot');
        return path.join(this.directory, `twitch-${key}.enc`);
    }
    async read(key) {
        let encrypted;
        try { encrypted = await fs.readFile(this.filename(key), 'utf8'); }
        catch (err) { if (err.code === 'ENOENT') return null; throw new Error('Twitch credential storage unavailable'); }
        try { return JSON.parse(await this.codec(encrypted, true)); }
        catch { throw new Error('Twitch credential storage could not be decrypted'); }
    }
    async write(key, value) {
        const encrypted = await this.codec(JSON.stringify(value));
        await fs.mkdir(this.directory, { recursive: true });
        const filename = this.filename(key);
        const temporary = `${filename}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, filename); }
        finally { await fs.rm(temporary, { force: true }); }
    }
    async clear(key) { await fs.rm(this.filename(key), { force: true }); }
}

export class TwitchDeviceAuth {
    constructor({ store = new TwitchProtectedStore(), fetchImpl = fetch, now = Date.now, purpose = 'chat', username = null } = {}) {
        if (!['chat', 'polls'].includes(purpose)) throw new Error('Unknown Twitch authorization purpose');
        this.purpose = purpose;
        this.username = purpose === 'polls' ? twitchName(username) : null;
        this.requiredScopes = purpose === 'polls' ? TWITCH_POLL_SCOPES : TWITCH_CHAT_SCOPES;
        this.store = store; this.fetchImpl = fetchImpl; this.now = now;
    }
    slot(key) { return this.purpose === 'polls' ? `polls-${key}-${this.username}` : key; }
    async request(endpoint, fields) {
        try {
            const response = await this.fetchImpl(`https://id.twitch.tv/oauth2/${endpoint}`, {
                method: 'POST', body: new URLSearchParams(fields), signal: AbortSignal.timeout(10000), redirect: 'error'
            });
            return { ok: response.ok, status: response.status, data: await response.json() };
        } catch { throw new Error('Twitch authorization request unavailable; no connection was started'); }
    }
    async start(clientId, username) {
        if (!/^[a-zA-Z0-9]{10,100}$/.test(clientId || '')) throw new Error('Invalid Twitch Client ID');
        username = twitchName(username);
        if (this.purpose === 'polls' && username !== this.username) throw new Error('Approve the intended broadcaster account');
        const existing = await this.store.read(this.slot('device-session'));
        if (existing?.expiresAt > this.now()) throw new Error('An authorization is already pending; finish it or cancel first');
        const reply = await this.request('device', { client_id: clientId, scopes: this.requiredScopes.join(' ') });
        if (!reply.ok) throw new Error(`Twitch device authorization failed (HTTP ${reply.status})`);
        const d = reply.data;
        let url;
        try { url = new URL(d.verification_uri); } catch { throw new Error('Twitch returned invalid device authorization data'); }
        if (url.origin !== 'https://www.twitch.tv' || url.pathname !== '/activate'
            || !/^[A-Z0-9-]{4,32}$/i.test(d.user_code || '') || typeof d.device_code !== 'string'
            || !d.device_code || !Number.isFinite(d.expires_in) || d.expires_in <= 0 || d.expires_in > 3600) {
            throw new Error('Twitch returned invalid device authorization data');
        }
        const interval = Math.max(5, Math.min(60, Number(d.interval) || 5));
        const session = { clientId, username, deviceCode: d.device_code, userCode: d.user_code,
            verificationUri: url.href, expiresAt: this.now() + d.expires_in * 1000, interval, nextPollAt: this.now() + interval * 1000 };
        await this.store.write(this.slot('device-session'), session);
        return { state: 'awaiting_approval', username, verificationUri: session.verificationUri, userCode: session.userCode,
            expiresAt: session.expiresAt, scopes: this.requiredScopes, purpose: this.purpose, connected: false };
    }
    async finish() {
        const session = await this.store.read(this.slot('device-session'));
        if (!session) throw new Error('No pending Twitch authorization');
        if (session.expiresAt <= this.now()) { await this.store.clear(this.slot('device-session')); throw new Error('Twitch authorization expired; start again'); }
        if (this.now() < session.nextPollAt) return { state: 'awaiting_approval', retryAfterMs: session.nextPollAt - this.now(), connected: false };
        session.nextPollAt = this.now() + session.interval * 1000;
        await this.store.write(this.slot('device-session'), session);
        const reply = await this.request('token', { client_id: session.clientId, device_code: session.deviceCode,
            scopes: this.requiredScopes.join(' '), grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (!reply.ok) {
            const reason = reply.data.message || reply.data.error;
            if (['authorization_pending', 'slow_down'].includes(reason)) {
                if (reason === 'slow_down') { session.interval += 5; session.nextPollAt = this.now() + session.interval * 1000; await this.store.write(this.slot('device-session'), session); }
                return { state: 'awaiting_approval', retryAfterMs: session.interval * 1000, connected: false };
            }
            await this.store.clear(this.slot('device-session'));
            throw new Error(`Twitch authorization did not complete (HTTP ${reply.status}); start again`);
        }
        // Device codes are single-use. Never accept an unverified account/token.
        const d = reply.data;
        if (!/^[a-zA-Z0-9]{10,200}$/.test(d.access_token || '') || !/^[a-zA-Z0-9]{10,200}$/.test(d.refresh_token || '')) {
            await this.store.clear(this.slot('device-session')); throw new Error('Twitch returned invalid credentials; start again');
        }
        try {
            const response = await this.fetchImpl('https://id.twitch.tv/oauth2/validate', {
                headers: { Authorization: `OAuth ${d.access_token}` }, signal: AbortSignal.timeout(10000)
            });
            const v = await response.json();
            if (!response.ok || v.client_id !== session.clientId || v.login !== session.username || !v.user_id
                || !(v.expires_in > 0) || !this.requiredScopes.every(scope => v.scopes?.includes(scope))) {
                throw new Error('unverified');
            }
            await this.store.write(this.slot('auth'), { clientId: session.clientId, username: session.username, userId: v.user_id,
                accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: this.now() + v.expires_in * 1000, scopes: this.requiredScopes });
        } catch {
            await this.store.clear(this.slot('device-session'));
            throw new Error('Twitch authorization could not be verified or saved; approve the correct bot account and start again');
        }
        await this.store.clear(this.slot('device-session'));
        return { state: 'authorized', username: session.username, scopes: this.requiredScopes, purpose: this.purpose, credentialPersistence: 'Windows DPAPI', connected: false };
    }

    // Internal runtime API only: callers must never serialize this result.
    async getCredential(username) {
        username = twitchName(username);
        if (this.purpose === 'polls' && username !== this.username) throw new Error('Saved Twitch authorization belongs to a different broadcaster');
        if (this.refreshing) {
            const credential = await this.refreshing;
            if (credential.username !== username) throw new Error('Saved Twitch authorization belongs to a different bot');
            return credential;
        }
        const credential = await this.store.read(this.slot('auth'));
        if (!credential) return null;
        if (credential.username !== username) throw new Error('Saved Twitch authorization belongs to a different bot');
        if (!/^[a-zA-Z0-9]{10,200}$/.test(credential.accessToken || '') || !Number.isFinite(credential.expiresAt)) {
            throw new Error('Saved Twitch authorization is invalid; authorize again');
        }
        if (credential.expiresAt > this.now() + 300000) return credential;
        if (!this.refreshing) this.refreshing = this.refreshCredential(credential);
        const work = this.refreshing;
        try { return await work; } finally { if (this.refreshing === work) this.refreshing = null; }
    }

    async refreshCredential(credential) {
        // Public device-code clients do not require a client secret. URLSearchParams
        // encodes the rotating refresh token; it never appears in logs/arguments.
        const reply = await this.request('token', { client_id: credential.clientId, grant_type: 'refresh_token', refresh_token: credential.refreshToken });
        if (!reply.ok) throw new Error(`Twitch token renewal failed (HTTP ${reply.status}); authorize again`);
        const d = reply.data;
        if (!/^[a-zA-Z0-9]{10,200}$/.test(d.access_token || '') || typeof d.refresh_token !== 'string' || !d.refresh_token) {
            throw new Error('Twitch token renewal returned invalid credentials; authorize again');
        }
        let v;
        try {
            const response = await this.fetchImpl('https://id.twitch.tv/oauth2/validate', {
                headers: { Authorization: `OAuth ${d.access_token}` }, signal: AbortSignal.timeout(10000), redirect: 'error'
            });
            v = await response.json();
            if (!response.ok || v.client_id !== credential.clientId || v.login !== credential.username
                || v.user_id !== credential.userId || !(v.expires_in > 0)
                || !this.requiredScopes.every(scope => v.scopes?.includes(scope))) throw new Error('unverified');
        } catch { throw new Error('Renewed Twitch authorization could not be verified; connection blocked'); }
        const updated = { ...credential, accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: this.now() + v.expires_in * 1000 };
        await this.store.write(this.slot('auth'), updated);
        return updated;
    }
}
