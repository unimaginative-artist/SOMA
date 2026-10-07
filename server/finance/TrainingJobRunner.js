import fs from 'fs';
import path from 'path';
import strategyRegistry from './StrategyRegistry.js';
import historicalDataCache from './HistoricalDataCache.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'trading');
const JOBS_PATH = path.join(DATA_DIR, 'training-jobs.json');

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

class TrainingJobRunner {
    constructor() {
        this.jobs = new Map();
        this.runningTimers = new Map();
        this.initialized = false;
    }

    initialize() {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        try {
            const parsed = fs.existsSync(JOBS_PATH) ? JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8')) : { jobs: [] };
            for (const job of parsed.jobs || []) this.jobs.set(job.id, job.status === 'running' ? { ...job, status: 'paused' } : job);
        } catch {
            this.jobs = new Map();
        }
        this.initialized = true;
        this._save();
        return this.getStatus();
    }

    _save() {
        try {
            fs.writeFileSync(JOBS_PATH, JSON.stringify({
                updatedAt: new Date().toISOString(),
                jobs: Array.from(this.jobs.values())
            }, null, 2));
        } catch (error) {
            console.warn('[TrainingJobRunner] Save failed:', error.message);
        }
    }

    startJob(options = {}) {
        if (!this.initialized) this.initialize();
        const job = {
            id: `train_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            status: 'running',
            objective: options.objective || 'five_to_five_hundred',
            symbols: Array.isArray(options.symbols) && options.symbols.length ? options.symbols.slice(0, 12) : ['BTC-USD', 'ETH-USD', 'SPY', 'QQQ', 'TLT'],
            strategyIds: Array.isArray(options.strategyIds) && options.strategyIds.length ? options.strategyIds : strategyRegistry.list().map(s => s.id),
            iterationsTarget: Math.min(1_000_000, Math.max(1, parseInt(options.iterations || options.iterationsTarget || 1000, 10))),
            iterationsDone: 0,
            initialCapital: clamp(options.initialCapital ?? 5, 1, 100000),
            targetCapital: clamp(options.targetCapital ?? 500, 2, 10000000),
            timeframe: options.timeframe || '5Min',
            bars: Math.min(2000, Math.max(100, parseInt(options.bars || 500, 10))),
            best: null,
            recent: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.jobs.set(job.id, job);
        this._save();
        this._run(job.id);
        return job;
    }

    stopJob(id) {
        const job = this.jobs.get(id);
        if (!job) return null;
        const timer = this.runningTimers.get(id);
        if (timer) clearTimeout(timer);
        this.runningTimers.delete(id);
        job.status = 'stopped';
        job.updatedAt = new Date().toISOString();
        this.jobs.set(id, job);
        this._save();
        return job;
    }

    getJob(id) {
        return this.jobs.get(id) || null;
    }

    getStatus() {
        const jobs = Array.from(this.jobs.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return {
            initialized: this.initialized,
            active: jobs.filter(job => job.status === 'running').length,
            total: jobs.length,
            jobs: jobs.slice(0, 20)
        };
    }

    _schedule(id) {
        if (this.runningTimers.has(id)) return;
        const timer = setTimeout(() => {
            this.runningTimers.delete(id);
            this._run(id);
        }, 25);
        this.runningTimers.set(id, timer);
    }

    async _run(id) {
        const job = this.jobs.get(id);
        if (!job || job.status !== 'running') return;
        const batch = Math.min(50, job.iterationsTarget - job.iterationsDone);
        if (batch <= 0) {
            job.status = 'completed';
            job.completedAt = new Date().toISOString();
            job.updatedAt = job.completedAt;
            this.jobs.set(id, job);
            this._save();
            return;
        }

        try {
            for (let i = 0; i < batch; i++) {
                const result = await this._runTrial(job);
                job.iterationsDone++;
                job.recent.unshift(result);
                job.recent = job.recent.slice(0, 10);
                if (!job.best || result.score > job.best.score) {
                    job.best = result;
                    strategyRegistry.recordChampion(result.strategyId, { ...result, jobId: job.id });
                }
            }
            job.updatedAt = new Date().toISOString();
            this.jobs.set(id, job);
            this._save();
        } catch (error) {
            job.status = 'error';
            job.error = error.message;
            job.updatedAt = new Date().toISOString();
            this.jobs.set(id, job);
            this._save();
            return;
        }

        if (job.iterationsDone >= job.iterationsTarget) {
            job.status = 'completed';
            job.completedAt = new Date().toISOString();
            this.jobs.set(id, job);
            this._save();
            return;
        }
        this._schedule(id);
    }

    async _runTrial(job) {
        const index = job.iterationsDone;
        const symbol = job.symbols[index % job.symbols.length];
        const strategyId = job.strategyIds[Math.floor(index / job.symbols.length) % job.strategyIds.length];
        const strategy = strategyRegistry.mutate(strategyId, Date.now() + index) || strategyRegistry.get(strategyId);
        const bars = await historicalDataCache.getBars(symbol, job.timeframe, job.bars).catch(() => []);
        const series = Array.isArray(bars) && bars.length >= 30 ? bars : this._syntheticBars(symbol, job.bars, index);
        return this._simulate(job, symbol, strategy, series);
    }

    _simulate(job, symbol, strategy, bars) {
        let cash = job.initialCapital;
        let qty = 0;
        let entry = 0;
        let peak = cash;
        let maxDrawdown = 0;
        let wins = 0;
        let losses = 0;
        const params = strategy.parameters || {};
        const fastWindow = Math.max(3, Math.round(params.momentumWindow || 12));
        const slowWindow = Math.max(fastWindow + 2, Math.round(params.meanReversionWindow || 34));
        const riskBudget = clamp(params.riskBudget || 0.05, 0.005, 0.2);
        const takeProfit = clamp(params.takeProfitPct || 0.035, 0.004, 0.25);
        const stopLoss = clamp(params.stopLossPct || 0.018, 0.002, 0.15);

        for (let i = slowWindow; i < bars.length; i++) {
            const price = Number(bars[i].close);
            if (!Number.isFinite(price) || price <= 0) continue;
            const fast = bars.slice(i - fastWindow, i).reduce((sum, bar) => sum + Number(bar.close || 0), 0) / fastWindow;
            const slow = bars.slice(i - slowWindow, i).reduce((sum, bar) => sum + Number(bar.close || 0), 0) / slowWindow;
            const equity = cash + qty * price;
            peak = Math.max(peak, equity);
            maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);

            if (qty > 0) {
                const pnlPct = (price - entry) / entry;
                if (pnlPct >= takeProfit || pnlPct <= -stopLoss || fast < slow) {
                    cash += qty * price * 0.9995;
                    if (pnlPct > 0) wins++; else losses++;
                    qty = 0;
                    entry = 0;
                }
                continue;
            }

            const momentum = (fast - slow) / slow;
            const aggressiveBoost = strategy.id === 'full_aggression' ? 0.006 : 0;
            if (momentum > 0.002 - aggressiveBoost && cash > 0.5) {
                const spend = Math.min(cash * riskBudget, cash);
                qty = (spend * 0.9995) / price;
                cash -= spend;
                entry = price;
            }
        }

        const last = Number(bars[bars.length - 1]?.close || entry || 0);
        const finalCapital = cash + qty * last * 0.9995;
        const pnl = finalCapital - job.initialCapital;
        const pnlPct = job.initialCapital > 0 ? pnl / job.initialCapital : 0;
        const trades = wins + losses;
        const winRate = trades ? wins / trades : 0;
        const targetProgress = (finalCapital - job.initialCapital) / Math.max(1, job.targetCapital - job.initialCapital);
        const score = clamp(targetProgress * 0.55 + winRate * 0.25 + Math.max(0, 1 - maxDrawdown) * 0.2, 0, 2);

        return {
            id: `trial_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            symbol,
            strategyId: strategy.id,
            strategyName: strategy.name,
            parameters: strategy.parameters,
            initialCapital: job.initialCapital,
            finalCapital: Number(finalCapital.toFixed(4)),
            targetCapital: job.targetCapital,
            pnl: Number(pnl.toFixed(4)),
            pnlPct: Number(pnlPct.toFixed(6)),
            winRate: Number(winRate.toFixed(4)),
            trades,
            maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
            score: Number(score.toFixed(6)),
            completedAt: new Date().toISOString()
        };
    }

    _syntheticBars(symbol, count, seed) {
        let n = (symbol.length * 997 + seed * 37) >>> 0;
        const rand = () => {
            n = (n * 1664525 + 1013904223) % 4294967296;
            return n / 4294967296;
        };
        let price = symbol.includes('BTC') ? 65000 : symbol.includes('ETH') ? 3200 : 100;
        const bars = [];
        for (let i = 0; i < count; i++) {
            const drift = (rand() - 0.48) * 0.018;
            price = Math.max(0.01, price * (1 + drift));
            bars.push({ time: Date.now() - (count - i) * 300000, open: price * 0.998, high: price * 1.006, low: price * 0.994, close: price, volume: 1000 + rand() * 10000 });
        }
        return bars;
    }
}

const trainingJobRunner = new TrainingJobRunner();
export default trainingJobRunner;
