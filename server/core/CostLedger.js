import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DATA_PATH = path.join(process.cwd(), 'data', 'cost-ledger.json');
const LOCK_PATH = `${DATA_PATH}.lock`;
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function pricingFor(model = 'default') {
    const prices = {
        'deepseek-chat': {
            in: finiteNumber(process.env.DEEPSEEK_CHAT_INPUT_PER_MILLION, 0.14),
            out: finiteNumber(process.env.DEEPSEEK_CHAT_OUTPUT_PER_MILLION, 0.28),
        },
        'deepseek-reasoner': {
            in: finiteNumber(process.env.DEEPSEEK_REASONER_INPUT_PER_MILLION, 0.55),
            out: finiteNumber(process.env.DEEPSEEK_REASONER_OUTPUT_PER_MILLION, 2.19),
        },
        ollama: { in: 0, out: 0 },
        local: { in: 0, out: 0 },
    };
    return prices[model] || prices['deepseek-chat'];
}

function dateKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function monthKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 7);
}

function calculateCost(model, inputTokens = 0, outputTokens = 0) {
    const pricing = pricingFor(model);
    return (Math.max(0, inputTokens) / 1_000_000) * pricing.in
        + (Math.max(0, outputTokens) / 1_000_000) * pricing.out;
}

function emptyLedger() {
    return { version: 2, daily: {}, monthly: {}, entries: [], reservations: [] };
}

class CostLedger {
    constructor() {
        this.data = this._load();
        this.dailyCap = finiteNumber(process.env.SOMA_DAILY_BUDGET_USD, 1.00);
        this.monthlyCap = finiteNumber(process.env.SOMA_MONTHLY_BUDGET_USD, 50.00);
    }

    _load() {
        try {
            if (fs.existsSync(DATA_PATH)) {
                const loaded = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
                return {
                    ...emptyLedger(),
                    ...loaded,
                    entries: Array.isArray(loaded.entries) ? loaded.entries : [],
                    reservations: Array.isArray(loaded.reservations) ? loaded.reservations : [],
                };
            }
        } catch {}
        return emptyLedger();
    }

    _saveUnlocked() {
        fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
        this.data.version = 2;
        this.data.entries = (this.data.entries || []).slice(-10000);
        this._pruneReservations();
        const temporary = `${DATA_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2));
        fs.renameSync(temporary, DATA_PATH);
    }

    _withLock(callback) {
        fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
        let fd = null;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                fd = fs.openSync(LOCK_PATH, 'wx');
                break;
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
                try {
                    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
                    if (age > 30_000) fs.unlinkSync(LOCK_PATH);
                } catch {}
                Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, 10);
            }
        }
        if (fd === null) throw new Error('Cost ledger lock unavailable');

        try {
            this.data = this._load();
            const result = callback();
            this._saveUnlocked();
            return result;
        } finally {
            try { fs.closeSync(fd); } catch {}
            try { fs.unlinkSync(LOCK_PATH); } catch {}
        }
    }

    _pruneReservations(now = Date.now()) {
        this.data.reservations = (this.data.reservations || []).filter(item => item.expiresAt > now);
    }

    estimateCost({ model = 'deepseek-chat', inputTokens = 0, outputTokens = 0 } = {}) {
        return Number(calculateCost(model, inputTokens, outputTokens).toFixed(6));
    }

    _recordUnlocked({ model = 'deepseek-chat', inputTokens = 0, outputTokens = 0, actor = 'SOMA', action = 'unknown', priority = 'background', status = 'success', metadata = {} } = {}) {
        const timestamp = Date.now();
        const cost = calculateCost(model, inputTokens, outputTokens);
        const day = dateKey(timestamp);
        const month = monthKey(timestamp);
        this.data.daily[day] = (this.data.daily[day] || 0) + cost;
        this.data.monthly[month] = (this.data.monthly[month] || 0) + cost;
        const entry = {
            id: `cost-${randomUUID()}`,
            ts: new Date(timestamp).toISOString(),
            model,
            actor,
            action,
            priority,
            status,
            inputTokens: Math.max(0, Number(inputTokens) || 0),
            outputTokens: Math.max(0, Number(outputTokens) || 0),
            cost: Number(cost.toFixed(6)),
            metadata: metadata && typeof metadata === 'object' ? metadata : {},
        };
        this.data.entries.push(entry);
        return entry;
    }

    record(options = {}) {
        return this._withLock(() => {
            const entry = this._recordUnlocked(options);
            return {
                ...entry,
                dailyTotal: Number((this.data.daily[dateKey()] || 0).toFixed(4)),
                monthlyTotal: Number((this.data.monthly[monthKey()] || 0).toFixed(4)),
                blocked: false,
            };
        });
    }

    reserve({ model = 'deepseek-chat', inputTokens = 0, maxOutputTokens = 0, actor = 'SOMA', action = 'unknown', priority = 'background', dailyCallLimit = null, ttlMs = 120_000 } = {}) {
        return this._withLock(() => {
            this._pruneReservations();
            const day = dateKey();
            const month = monthKey();
            const estimate = calculateCost(model, inputTokens, maxOutputTokens);
            const active = this.data.reservations || [];
            const reservedDaily = active.filter(item => item.day === day).reduce((sum, item) => sum + item.estimatedCost, 0);
            const reservedMonthly = active.filter(item => item.month === month).reduce((sum, item) => sum + item.estimatedCost, 0);
            const callsToday = (this.data.entries || []).filter(entry => entry.ts.startsWith(day) && entry.actor === actor).length
                + active.filter(item => item.day === day && item.actor === actor).length;

            if ((this.data.daily[day] || 0) + reservedDaily + estimate > this.dailyCap) {
                return { ok: false, blocked: true, reason: 'daily_budget_exhausted', estimate: Number(estimate.toFixed(6)) };
            }
            if ((this.data.monthly[month] || 0) + reservedMonthly + estimate > this.monthlyCap) {
                return { ok: false, blocked: true, reason: 'monthly_budget_exhausted', estimate: Number(estimate.toFixed(6)) };
            }
            if (dailyCallLimit !== null && dailyCallLimit !== undefined && Number.isFinite(Number(dailyCallLimit)) && callsToday >= Number(dailyCallLimit)) {
                return { ok: false, blocked: true, reason: 'actor_daily_call_limit', callsToday };
            }

            const reservation = {
                id: `reserve-${randomUUID()}`,
                createdAt: Date.now(),
                expiresAt: Date.now() + Math.max(10_000, Number(ttlMs) || 120_000),
                day,
                month,
                model,
                actor,
                action,
                priority,
                inputTokens,
                maxOutputTokens,
                estimatedCost: Number(estimate.toFixed(6)),
            };
            active.push(reservation);
            return { ok: true, blocked: false, reservation };
        });
    }

    commitReservation(id, { inputTokens = 0, outputTokens = 0, status = 'success', metadata = {} } = {}) {
        return this._withLock(() => {
            const index = (this.data.reservations || []).findIndex(item => item.id === id);
            if (index < 0) throw new Error(`Unknown or expired cost reservation: ${id}`);
            const [reservation] = this.data.reservations.splice(index, 1);
            return this._recordUnlocked({
                model: reservation.model,
                actor: reservation.actor,
                action: reservation.action,
                priority: reservation.priority,
                inputTokens: inputTokens || reservation.inputTokens,
                outputTokens,
                status,
                metadata: { estimatedCost: reservation.estimatedCost, ...metadata },
            });
        });
    }

    releaseReservation(id) {
        if (!id) return false;
        return this._withLock(() => {
            const before = (this.data.reservations || []).length;
            this.data.reservations = (this.data.reservations || []).filter(item => item.id !== id);
            return this.data.reservations.length !== before;
        });
    }

    isBlocked(model = 'deepseek-chat') {
        if (pricingFor(model).in === 0 && pricingFor(model).out === 0) return false;
        this.data = this._load();
        this._pruneReservations();
        const day = dateKey();
        const month = monthKey();
        const reservedDaily = this.data.reservations.filter(item => item.day === day).reduce((sum, item) => sum + item.estimatedCost, 0);
        const reservedMonthly = this.data.reservations.filter(item => item.month === month).reduce((sum, item) => sum + item.estimatedCost, 0);
        return (this.data.daily[day] || 0) + reservedDaily >= this.dailyCap
            || (this.data.monthly[month] || 0) + reservedMonthly >= this.monthlyCap;
    }

    countCalls({ actor = null, action = null, since = null } = {}) {
        this.data = this._load();
        const cutoff = since ? new Date(since).getTime() : 0;
        return (this.data.entries || []).filter(entry =>
            (!actor || entry.actor === actor)
            && (!action || entry.action === action)
            && new Date(entry.ts).getTime() >= cutoff
        ).length;
    }

    getWindowReport(windowMs = 5 * 60_000, offsetMs = 0, priority = null) {
        this.data = this._load();
        const end = Date.now() - offsetMs;
        const start = end - windowMs;
        const entries = (this.data.entries || []).filter(entry => {
            const timestamp = new Date(entry.ts).getTime();
            return timestamp >= start && timestamp < end && (!priority || entry.priority === priority);
        });
        return {
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            calls: entries.length,
            cost: Number(entries.reduce((sum, entry) => sum + (entry.cost || 0), 0).toFixed(6)),
            inputTokens: entries.reduce((sum, entry) => sum + (entry.inputTokens || 0), 0),
            outputTokens: entries.reduce((sum, entry) => sum + (entry.outputTokens || 0), 0),
        };
    }

    getDailyReport(day = dateKey()) {
        this.data = this._load();
        const entries = (this.data.entries || []).filter(entry => entry.ts.startsWith(day));
        const groups = {};
        for (const entry of entries) {
            const key = `${entry.actor}::${entry.action}`;
            const group = groups[key] || { actor: entry.actor, action: entry.action, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
            group.calls++;
            group.inputTokens += entry.inputTokens || 0;
            group.outputTokens += entry.outputTokens || 0;
            group.cost += entry.cost || 0;
            groups[key] = group;
        }
        return {
            day,
            total: Number((this.data.daily[day] || 0).toFixed(6)),
            calls: entries.length,
            groups: Object.values(groups)
                .map(group => ({ ...group, cost: Number(group.cost.toFixed(6)) }))
                .sort((a, b) => b.cost - a.cost || b.calls - a.calls),
        };
    }

    getStatus() {
        this.data = this._load();
        this._pruneReservations();
        const day = dateKey();
        const month = monthKey();
        const dailySpent = Number((this.data.daily[day] || 0).toFixed(4));
        const monthlySpent = Number((this.data.monthly[month] || 0).toFixed(4));
        const reserved = Number(this.data.reservations.reduce((sum, item) => sum + item.estimatedCost, 0).toFixed(6));
        return {
            dailySpent,
            monthlySpent,
            reserved,
            dailyCap: this.dailyCap,
            monthlyCap: this.monthlyCap,
            dailyPct: Math.round((dailySpent / this.dailyCap) * 100),
            monthlyPct: Math.round((monthlySpent / this.monthlyCap) * 100),
            blocked: this.isBlocked('deepseek-chat'),
            pricing: {
                'deepseek-chat': pricingFor('deepseek-chat'),
                'deepseek-reasoner': pricingFor('deepseek-reasoner'),
            },
            recentCalls: (this.data.entries || []).slice(-20).reverse(),
        };
    }

    getByActor(since = null) {
        this.data = this._load();
        const cutoff = since ? new Date(since).getTime() : 0;
        return (this.data.entries || [])
            .filter(entry => new Date(entry.ts).getTime() >= cutoff)
            .reduce((acc, entry) => {
                acc[entry.actor] = (acc[entry.actor] || 0) + entry.cost;
                return acc;
            }, {});
    }
}

export const costLedger = new CostLedger();
export { calculateCost, pricingFor };
export default costLedger;
