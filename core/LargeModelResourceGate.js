import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export const LARGE_MODEL_LEASE_PATH = path.resolve(process.env.SOMA_LARGE_MODEL_LEASE_PATH || 'data/large-model-lease.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const leaseContext = new AsyncLocalStorage();

export function withLargeModelLeaseAccess(lease, operation) {
    if (!lease?.token) throw new TypeError('A valid resource lease is required');
    return leaseContext.run({ token: lease.token }, operation);
}

async function processAlive(pid) {
    if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
    try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

export async function readLargeModelLease() {
    try { return JSON.parse(await fs.readFile(LARGE_MODEL_LEASE_PATH, 'utf8')); } catch { return null; }
}

// Read-only availability for interactive callers that cannot wait minutes.
// Never expose the owner, PID or authorization token to a public conversation.
export async function standardModelResourceAvailability() {
    const lease = await readLargeModelLease();
    const held = lease && !(lease.expiresAt < Date.now()) && await processAlive(lease.pid)
        && leaseContext.getStore()?.token !== lease.token;
    return { available: !held, reason: held ? 'large_model_resource_busy' : null };
}

export async function acquireLargeModelLease({ owner = 'soma', ttlMs = 10 * 60_000 } = {}) {
    await fs.mkdir(path.dirname(LARGE_MODEL_LEASE_PATH), { recursive: true });
    const lease = { owner, pid: process.pid, token: crypto.randomUUID(), acquiredAt: Date.now(), expiresAt: Date.now() + ttlMs };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await fs.writeFile(LARGE_MODEL_LEASE_PATH, JSON.stringify(lease, null, 2), { flag: 'wx' });
            return lease;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const existing = await readLargeModelLease();
            const stale = !existing || existing.expiresAt < Date.now() || !(await processAlive(existing.pid));
            if (!stale) throw new Error(`Large-model resources are leased by ${existing.owner || existing.pid}`);
            await fs.unlink(LARGE_MODEL_LEASE_PATH).catch(() => {});
        }
    }
    throw new Error('Could not acquire large-model resource lease');
}

export async function releaseLargeModelLease(lease) {
    const existing = await readLargeModelLease();
    if (existing?.token !== lease?.token || Number(existing?.pid) !== process.pid) return false;
    await fs.unlink(LARGE_MODEL_LEASE_PATH).catch(() => {});
    return true;
}

export async function waitForStandardModelResources({ timeoutMs = 5 * 60_000, signal = null } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason || new Error('Model-resource wait aborted');
        const lease = await readLargeModelLease();
        if (!lease || lease.expiresAt < Date.now() || !(await processAlive(lease.pid))) return;
        if (leaseContext.getStore()?.token === lease.token) return;
        await delay(500);
    }
    throw new Error('Timed out waiting for the large-model resource lease');
}
