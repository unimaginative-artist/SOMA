import { validatePilotDecision } from '../../../../../../shared/AperturePilotPolicy.js';

export const ACTION_REQUEST = 'aperture:pilot-request';
export const ACTION_RESULT = 'aperture:pilot-result';
export const newId = () => globalThis.crypto.randomUUID();
const handlers = new Map();
const claims = new Map();
export const hasPilotHandler = (windowId, action) => handlers.has(`${windowId}:${action}`);

// Semantic app operations are addressed to one window, acknowledged after completion.
export function registerPilotHandler(target, { windowId, action, execute }) {
    if (!windowId) return () => {};
    const key = `${windowId}:${action}`;
    const listener = async event => {
        const request = event.detail;
        if (!request?.id || request.windowId !== windowId || request.action !== action || request.signal?.aborted) return;
        const claim = `${key}:${request.id}`;
        if (claims.has(claim)) return; // Survives React re-registration, including in-flight writes.
        claims.set(claim, 'running');
        let result;
        try { result = await execute(request.params || {}, request.signal); }
        catch (error) { result = { status: 'failed', verified: false, error: error.message }; }
        claims.set(claim, 'settled');
        if (claims.size > 1000) {
            const old = [...claims].find(([, status]) => status === 'settled')?.[0];
            if (old) claims.delete(old);
        }
        target.dispatchEvent(new CustomEvent(ACTION_RESULT, { detail: { ...result, id: request.id, windowId, action } }));
    };
    target.addEventListener(ACTION_REQUEST, listener);
    handlers.set(key, listener);
    return () => {
        if (handlers.get(key) === listener) handlers.delete(key);
        target.removeEventListener(ACTION_REQUEST, listener);
    };
}

export function requestPilotAction(target, request, { signal, timeoutMs = 15000 } = {}) {
    return new Promise(resolve => {
        let timer;
        const finish = result => {
            clearTimeout(timer);
            target.removeEventListener(ACTION_RESULT, listener);
            signal?.removeEventListener('abort', abort);
            resolve(result);
        };
        const abort = () => finish({ status: 'cancelled', verified: false, error: 'Operator stopped the action. An already submitted operation may still finish.' });
        const listener = event => {
            const result = event.detail;
            if (result?.id === request.id && result.windowId === request.windowId && result.action === request.action) finish(result);
        };
        if (signal?.aborted) return abort();
        target.addEventListener(ACTION_RESULT, listener);
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish({ status: 'unverified', verified: false, error: 'No completion receipt; do not automatically retry a possible write.' }), timeoutMs);
        target.dispatchEvent(new CustomEvent(ACTION_REQUEST, { detail: { ...request, signal } }));
    });
}

export class PilotRuntime {
    constructor({ observe, settings, perform, onReceipt = () => {} }) {
        Object.assign(this, { observe, settings, perform, onReceipt });
        this.running = null;
        this.seen = new Set();
        this.epoch = 0;
    }
    stop() { this.epoch++; this.running?.abort(); }
    async execute(proposal, { userDirective = '', observation = this.observe() } = {}) {
        if (this.running) return { status: 'busy', verified: false };
        const id = proposal?.id || newId();
        if (this.seen.has(id)) return { id, status: 'duplicate', verified: false };
        const checked = validatePilotDecision(proposal, { observation, settings: this.settings(), userDirective });
        if (!checked.valid) return { id, status: 'blocked', verified: false, error: checked.error };
        if (checked.decision.action === 'idle') return { id, status: 'idle', verified: false, summary: checked.decision.intent };
        this.seen.add(id);
        if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value);
        const abort = new AbortController();
        this.running = abort;
        const startedAt = Date.now();
        let result;
        try {
            // Reject a plan if windows changed while inference was running.
            const current = this.observe();
            if (current.signature !== observation.signature) throw new Error('Workspace changed during planning; observe and replan');
            result = await this.perform(checked.decision, { id, signal: abort.signal });
            if (abort.signal.aborted) result = { status: 'cancelled', verified: false, error: 'Operator stopped this run; an already submitted action may still finish.' };
        } catch (error) { result = { status: 'failed', verified: false, error: error.message }; }
        finally { this.running = null; }
        const verified = result?.verified === true && result?.status === 'completed' && Boolean(result?.evidence);
        const receipt = { ...result, id, action: checked.decision.action, observationId: observation.id, startedAt, finishedAt: Date.now(), verified,
            status: result?.status === 'completed' && !verified ? 'unverified' : result?.status || 'unverified' };
        this.onReceipt(receipt);
        return receipt;
    }
}
