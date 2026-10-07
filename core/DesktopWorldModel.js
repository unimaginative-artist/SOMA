import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporary, filePath);
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

// Observation IDs, collection time and host uptime are not desktop changes.
function screenContent(screen = {}) {
    if (!screen.available) return { available: false, reason: screen.reason };
    const value = screen.value || {};
    return { available: true, surface: value.surface, contentDigest: value.contentDigest,
        windows: value.windows, url: value.url, title: value.title, dimensions: value.dimensions };
}

/** A bounded, structured view of the PC state Soma is actually allowed to observe. */
export class DesktopWorldModel {
    constructor({ system = null, workspaceService = null, statePath = 'data/reality-loop/desktop-world.json', now = () => Date.now() } = {}) {
        this.system = system;
        this.workspaceService = workspaceService;
        this.statePath = path.resolve(statePath);
        this.now = now;
        this.state = { schemaVersion: 1, current: null, observations: [], consequences: [], updatedAt: null };
    }

    async initialize(system = this.system) {
        this.system = system || this.system;
        this.workspaceService = this.workspaceService || this.system?.computerWorkspace || null;
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = parsed;
        } catch { /* first boot */ }
        await this.observe({ reason: 'boot' }).catch(() => {});
        return this;
    }

    async observe({ reason = 'manual' } = {}) {
        const [roots, history, screen] = await Promise.all([
            this.workspaceService?.listRoots?.().catch(() => ({ roots: [] })) || { roots: [] },
            this.workspaceService?.history?.({ limit: 20 }).catch(() => ({ transactions: [], count: 0 })) || { transactions: [], count: 0 },
            this._screenState()
        ]);
        const goals = [...(this.system?.goalPlanner?.goals?.values?.() || [])];
        const snapshot = {
            at: this.now(),
            reason,
            host: { platform: process.platform, hostname: os.hostname(), processId: process.pid, uptimeSeconds: Math.round(process.uptime()) },
            workspace: {
                roots: (roots?.roots || []).map(item => ({ id: item.id, path: item.path })),
                transactionCount: Number(history?.count || 0),
                recentTransactions: (history?.transactions || []).slice(0, 10)
            },
            applications: screen,
            goals: {
                active: goals.filter(goal => ['proposed', 'pending', 'active', 'delegated'].includes(String(goal.status))).slice(0, 10).map(goal => ({ id: goal.id, title: goal.title, status: goal.status })),
                totalKnown: goals.length
            }
        };
        snapshot.digest = digest({ workspace: snapshot.workspace, goals: snapshot.goals, applications: screenContent(screen) });
        snapshot.change = this._diff(this.state.current, snapshot);
        this.state.current = snapshot;
        this.state.observations = [...(this.state.observations || []), snapshot].slice(-100);
        this.state.updatedAt = snapshot.at;
        await atomicJson(this.statePath, this.state);
        await this.system?.stateGateway?.publish?.('world', 'desktop_state', snapshot, {
            owner: 'DesktopWorldModel', source: reason, status: 'observed', confidence: 1
        }).catch?.(() => {});
        return snapshot;
    }

    async recordConsequence({ transactionId = null, action = 'unknown', before = null, after = null, verified = false } = {}) {
        const prior = before || this.state.current;
        const next = after || await this.observe({ reason: `after:${action}` });
        const record = {
            id: crypto.randomUUID(), transactionId, action, at: this.now(), verified,
            beforeDigest: prior?.digest || null, afterDigest: next?.digest || null,
            changed: Boolean(prior?.digest && next?.digest && prior.digest !== next.digest),
            change: this._diff(prior, next)
        };
        this.state.consequences = [...(this.state.consequences || []), record].slice(-200);
        await atomicJson(this.statePath, this.state);
        return record;
    }

    getStatus() {
        return {
            ready: Boolean(this.state.current),
            current: this.state.current,
            observations: this.state.observations?.length || 0,
            consequences: this.state.consequences?.length || 0,
            updatedAt: this.state.updatedAt
        };
    }

    async _screenState() {
        const adapter = this.system?.desktopControl || this.system?.computerControl || this.system?.browserAgent;
        if (!adapter) return { available: false, reason: 'no_structured_screen_adapter' };
        const observe = adapter.observe;
        if (typeof observe !== 'function') return { available: false, reason: 'adapter_has_no_observer' };
        try {
            const value = await observe.call(adapter);
            if (!value || value.success === false || value.available === false || !value.surface || !Number.isFinite(value.observedAt)) {
                return { available: false, reason: value?.error || 'adapter_returned_no_observation' };
            }
            if (this.now() - value.observedAt > 30000 || value.observedAt > this.now() + 1000) {
                return { available: false, reason: 'stale_screen_observation' };
            }
            return { available: true, value };
        } catch (error) {
            return { available: false, reason: error.message };
        }
    }

    _diff(before, after) {
        if (!before) return { initial: true };
        const priorTransactions = new Set(before.workspace?.recentTransactions?.map(item => item.transactionId) || []);
        const newTransactions = (after.workspace?.recentTransactions || []).filter(item => !priorTransactions.has(item.transactionId));
        const priorGoals = new Map((before.goals?.active || []).map(item => [item.id, item.status]));
        const goalChanges = (after.goals?.active || []).filter(item => priorGoals.get(item.id) !== item.status);
        return {
            workspaceTransactionsAdded: newTransactions,
            activeGoalChanges: goalChanges,
            screenChanged: digest(screenContent(before.applications)) !== digest(screenContent(after.applications))
        };
    }
}

export default DesktopWorldModel;
