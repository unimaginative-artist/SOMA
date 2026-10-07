import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import puppeteer from 'puppeteer';

const root = path.resolve('frontend/apps/studio/dist');
const legacyWebStudioPresent = fs.existsSync(path.join(root, 'index.html'));

function staticServer() {
    return http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const file = path.resolve(root, relative);
        if (!file.startsWith(root) || !fs.existsSync(file)) {
            res.writeHead(404).end();
            return;
        }
        const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
        res.writeHead(200, { 'content-type': type });
        fs.createReadStream(file).pipe(res);
    });
}

test('Web Studio browser can capture media, create a room, and expose real host controls', {
    skip: legacyWebStudioPresent ? false : 'legacy frontend/apps/studio surface was retired; canonical Stage host/viewer coverage runs below'
}, async () => {
    const server = staticServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = new URL(request.url());
            if (!url.pathname.startsWith('/api/studio/')) return request.continue();
            const room = {
                id: 'live-browser-1', title: 'Browser proof stream', authorId: 'owner',
                authorName: 'Browser Owner', category: 'Just Chatting', status: 'live',
                viewers: 0, chat: [], reactionCount: 0, viewerIsHost: true,
            };
            let payload = { ok: true };
            if (url.pathname.endsWith('/identity/me')) payload = { ok: true, user: { id: 'owner', userId: 'owner', displayName: 'Browser Owner' } };
            else if (url.pathname.endsWith('/identity/devices')) payload = { ok: true, sessions: [] };
            else if (url.pathname.endsWith('/feed')) payload = { ok: true, posts: [] };
            else if (url.pathname.endsWith('/signals')) payload = { ok: true, signals: [] };
            else if (url.pathname.endsWith('/live') && request.method() === 'GET') payload = { ok: true, rooms: [] };
            else if (url.pathname.endsWith('/live') && request.method() === 'POST') payload = { ok: true, room };
            else if (url.pathname.includes('/events/history')) payload = { ok: true, events: [] };
            else if (url.pathname.includes('/notifications/')) payload = { ok: true, notifications: [], unread: 0 };
            else if (url.pathname.includes('/live-browser-1/')) payload = { ok: true, room };
            request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        });

        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === 'Live'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Live').click());
        const input = await page.waitForSelector('input[placeholder="Name your stream"]');
        await input.type('Browser proof stream');
        await page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Go live').click());
        await page.waitForSelector('.live-player video');
        await page.waitForFunction(() => document.querySelector('.live-player')?.textContent.includes('media hosting'));

        const proof = await page.evaluate(() => ({
            hasStream: Boolean(document.querySelector('.live-player video')?.srcObject),
            controls: [...document.querySelectorAll('.live-player button')].map(button => button.textContent.trim()),
        }));
        assert.equal(proof.hasStream, true);
        assert.ok(proof.controls.includes('Camera on'));
        assert.ok(proof.controls.includes('Mic on'));
        assert.ok(proof.controls.includes('Switch camera'));
        assert.ok(proof.controls.includes('Switch mic'));
        assert.ok(proof.controls.includes('Share screen'));
        assert.ok(proof.controls.includes('End stream'));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('Studio Live carries a camera stream from a host browser to a separate viewer browser', async () => {
    const originalCwd = process.cwd();
    const sourceRoot = path.resolve(originalCwd);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-two-browser-'));
    fs.mkdirSync(path.join(tempRoot, 'SOMA'), { recursive: true });
    process.chdir(tempRoot);
    process.env.STUDIO_STRICT_AUTH = '1';
    process.env.STUDIO_DISABLE_AGENTS = '1';
    process.env.STUDIO_LIVE_TRANSPORT = 'p2p';

    const stamp = Date.now();
    const { default: createStudioRoutes } = await import(`../server/routes/studioRoutes.js?two-browser=${stamp}`);
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    app.use('/api/studio', createStudioRoutes({}));
    app.get('/stage/studio-live-rtc.js', (_req, res) => {
        res.type('text/javascript').sendFile(path.join(sourceRoot, 'frontend', 'public', 'stage', 'studio-live-rtc.js'));
    });
    app.get('/harness', (_req, res) => {
        res.type('html').send(`<!doctype html>
<html><body><video id="media" autoplay playsinline muted></video>
<script type="module">
import { StudioLiveRTC } from '/stage/studio-live-rtc.js';
const video = document.querySelector('#media');
let controller = null;
let timer = null;
let seen = new Set();
let lastState = '';

function headers(config) {
  return {
    'content-type': 'application/json',
    authorization: 'Bearer ' + config.token,
    'x-studio-device-id': config.deviceId,
  };
}
async function request(config, url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + response.status));
  return data;
}
function beginPolling(config) {
  const poll = async () => {
    const response = await fetch('/api/studio/events/history?targetId=' + encodeURIComponent(config.roomId) + '&typePrefix=studio.live.webrtc&limit=100', {
      headers: headers(config),
    });
    const data = await response.json();
    for (const event of (data.events || []).slice().reverse()) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      await controller.handle(event.payload || {});
    }
  };
  timer = setInterval(() => poll().catch(error => { window.lastError = error.message; }), 40);
  poll().catch(error => { window.lastError = error.message; });
}
window.liveHarness = {
  async host(config) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    video.srcObject = stream;
    const transportResponse = await fetch('/api/studio/live/' + encodeURIComponent(config.roomId) + '/transport', { headers: headers(config) });
    const transport = (await transportResponse.json()).transport || { provider: 'p2p' };
    controller = new StudioLiveRTC({
      transport,
      rtcConfig: { iceServers: [] },
      request: (url, body) => request(config, url, body),
      onState: value => { lastState = value.state; },
    });
    beginPolling(config);
    await controller.startHost(config.roomId, stream);
    return { tracks: stream.getTracks().map(track => track.kind) };
  },
  async viewer(config) {
    const transportResponse = await fetch('/api/studio/live/' + encodeURIComponent(config.roomId) + '/transport', { headers: headers(config) });
    const transport = (await transportResponse.json()).transport || { provider: 'p2p' };
    controller = new StudioLiveRTC({
      transport,
      rtcConfig: { iceServers: [] },
      request: (url, body) => request(config, url, body),
      onRemoteStream: stream => { video.srcObject = stream; video.muted = true; },
      onState: value => { lastState = value.state; },
    });
    beginPolling(config);
    await controller.joinViewer(config.roomId);
  },
  proof() {
    return {
      state: lastState,
      stream: Boolean(video.srcObject),
      tracks: video.srcObject ? video.srcObject.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState })) : [],
      readyState: video.readyState,
      width: video.videoWidth,
      error: window.lastError || '',
    };
  },
  async close() {
    clearInterval(timer);
    await controller?.close({ stopLocal: true });
  },
};
</script></body></html>`);
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const register = async (username, displayName, deviceId) => {
        const response = await fetch(`${base}/api/studio/identity/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-studio-device-id': deviceId },
            body: JSON.stringify({ username, displayName, passcode: `${username}-contract-passcode` }),
        });
        assert.equal(response.status, 200);
        return response.json();
    };

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
        ],
    });
    try {
        const hostAccount = await register('browser-host', 'Browser Host', 'browser-host-device');
        const viewerAccount = await register('browser-viewer', 'Browser Viewer', 'browser-viewer-device');
        const roomResponse = await fetch(`${base}/api/studio/live`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${hostAccount.token}`,
                'x-studio-device-id': 'browser-host-device',
            },
            body: JSON.stringify({ title: 'Two-browser camera proof', category: 'Testing' }),
        });
        assert.equal(roomResponse.status, 201);
        const { room } = await roomResponse.json();

        const hostPage = await browser.newPage();
        const viewerPage = await browser.newPage();
        await Promise.all([
            hostPage.goto(`${base}/harness`, { waitUntil: 'networkidle0' }),
            viewerPage.goto(`${base}/harness`, { waitUntil: 'networkidle0' }),
        ]);
        await Promise.all([
            hostPage.waitForFunction(() => Boolean(window.liveHarness)),
            viewerPage.waitForFunction(() => Boolean(window.liveHarness)),
        ]);
        const hostConfig = { roomId: room.id, token: hostAccount.token, deviceId: 'browser-host-device' };
        const viewerConfig = { roomId: room.id, token: viewerAccount.token, deviceId: 'browser-viewer-device' };
        const hostTracks = await hostPage.evaluate(config => window.liveHarness.host(config), hostConfig);
        assert.deepEqual(hostTracks.tracks.sort(), ['audio', 'video']);
        await viewerPage.evaluate(config => window.liveHarness.viewer(config), viewerConfig);
        await viewerPage.waitForFunction(() => {
            const proof = window.liveHarness.proof();
            return proof.stream && proof.tracks.some(track => track.kind === 'video' && track.readyState === 'live') && proof.width > 0;
        }, { timeout: 20_000 });

        const viewerProof = await viewerPage.evaluate(() => window.liveHarness.proof());
        assert.equal(viewerProof.error, '');
        assert.equal(viewerProof.stream, true);
        assert.ok(viewerProof.tracks.some(track => track.kind === 'video' && track.readyState === 'live'));
        assert.ok(viewerProof.width > 0, 'viewer decoded a real video frame from the host page');
        await Promise.all([
            hostPage.evaluate(() => window.liveHarness.close()),
            viewerPage.evaluate(() => window.liveHarness.close()),
        ]);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
        const { default: eventBus } = await import('../server/studio/StudioAxisEventBus.js');
        eventBus.close();
        const { default: mediaPipeline } = await import('../server/studio/StudioMediaPipeline.js');
        mediaPipeline.close();
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
