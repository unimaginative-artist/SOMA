import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

const originalCwd = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axis-device-auth-'));
fs.mkdirSync(path.join(root, 'SOMA'), { recursive: true });
process.chdir(root);
process.env.STUDIO_STRICT_AUTH = '1';
process.env.STUDIO_DISABLE_AGENTS = '1';

const stamp = Date.now();
const { default: createStudioRoutes } = await import(`../server/routes/studioRoutes.js?axis-auth=${stamp}`);
const { default: createAxisRoutes } = await import(`../server/routes/axisRoutes.js?axis-auth=${stamp}`);
const app = express();
app.use(express.json());
app.use('/api/studio', createStudioRoutes({}));
app.use('/api/axis', createAxisRoutes({}));
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const { default: eventBus } = await import('../server/studio/StudioAxisEventBus.js');
    eventBus.close();
    const { default: mediaPipeline } = await import('../server/studio/StudioMediaPipeline.js');
    mediaPipeline.close();
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
});

test('Axis rejects spoofed headers and requires the token-bound device', async () => {
    const anonymous = await fetch(`${base}/api/axis/workspaces`);
    assert.equal(anonymous.status, 401);
    const anonymousStudioCompatibility = await fetch(`${base}/api/studio/axis`);
    assert.equal(anonymousStudioCompatibility.status, 401);

    const spoofed = await fetch(`${base}/api/axis/workspaces`, {
        headers: { 'x-axis-user-id': 'usr-spoofed', 'x-axis-user-name': 'Spoofed' },
    });
    assert.equal(spoofed.status, 401);

    const registered = await fetch(`${base}/api/studio/identity/register`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-studio-device-id': 'axis-device-a',
            'x-studio-device-name': 'Axis contract device',
        },
        body: JSON.stringify({ username: 'axis-owner', displayName: 'Axis Owner', passcode: 'contract-passcode' }),
    });
    const account = await registered.json();
    assert.equal(registered.status, 200);

    const wrongDevice = await fetch(`${base}/api/axis/workspaces`, {
        headers: { authorization: `Bearer ${account.token}`, 'x-studio-device-id': 'axis-device-b' },
    });
    assert.equal(wrongDevice.status, 401);
    const wrongStudioCompatibilityDevice = await fetch(`${base}/api/studio/axis`, {
        headers: { authorization: `Bearer ${account.token}`, 'x-studio-device-id': 'axis-device-b' },
    });
    assert.equal(wrongStudioCompatibilityDevice.status, 401);

    const authorized = await fetch(`${base}/api/axis/workspaces`, {
        headers: { authorization: `Bearer ${account.token}`, 'x-studio-device-id': 'axis-device-a' },
    });
    assert.equal(authorized.status, 200);
    const authorizedStudioCompatibility = await fetch(`${base}/api/studio/axis`, {
        headers: { authorization: `Bearer ${account.token}`, 'x-studio-device-id': 'axis-device-a' },
    });
    assert.equal(authorizedStudioCompatibility.status, 200);
});
