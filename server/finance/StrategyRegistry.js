import fs from 'fs';
import path from 'path';
import marketEvidenceStore from './MarketEvidenceStore.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'trading');
const REGISTRY_PATH = path.join(DATA_DIR, 'strategy-registry.json');

const DEFAULT_STRATEGIES = [
    {
        id: 'standard_portfolio',
        name: 'Standard Portfolio',
        assetClasses: ['equity', 'etf', 'future', 'crypto'],
        riskProfile: 'balanced',
        parameters: { momentumWindow: 20, meanReversionWindow: 50, riskBudget: 0.08, timeframe: '1H' },
        mutationRules: { momentumWindow: [10, 40], meanReversionWindow: [30, 120], riskBudget: [0.03, 0.12] }
    },
    {
        id: 'swarm_architecture',
        name: 'Swarm Architecture',
        assetClasses: ['equity', 'future', 'crypto'],
        riskProfile: 'adaptive',
        parameters: { agentConsensus: 0.58, regimeBoost: 0.12, riskBudget: 0.1 },
        mutationRules: { agentConsensus: [0.5, 0.75], regimeBoost: [0.04, 0.22], riskBudget: [0.04, 0.14] }
    },
    {
        id: 'micro_compounder',
        name: 'Micro Compounder',
        assetClasses: ['equity', 'crypto'],
        riskProfile: 'small_gain',
        parameters: { takeProfitPct: 0.018, stopLossPct: 0.009, riskBudget: 0.04 },
        mutationRules: { takeProfitPct: [0.008, 0.035], stopLossPct: [0.004, 0.018], riskBudget: [0.01, 0.06] }
    },
    {
        id: 'micro_scalper',
        name: 'Micro Scalper',
        assetClasses: ['crypto', 'future'],
        riskProfile: 'high_frequency_paper',
        parameters: { takeProfitPct: 0.012, stopLossPct: 0.006, riskBudget: 0.03 },
        mutationRules: { takeProfitPct: [0.004, 0.025], stopLossPct: [0.002, 0.012], riskBudget: [0.01, 0.05] }
    },
    {
        id: 'full_aggression',
        name: 'Full Aggression',
        assetClasses: ['crypto', 'future'],
        riskProfile: 'aggressive',
        parameters: { breakoutThreshold: 1.5, stopLossGap: 0.05, riskBudget: 0.2, timeframe: '1H' },
        mutationRules: { breakoutThreshold: [1.2, 2.0], stopLossGap: [0.03, 0.08], riskBudget: [0.1, 0.3] }
    },
    {
        id: 'vortex',
        name: 'VORTEX',
        assetClasses: ['crypto', 'equity'],
        riskProfile: 'adaptive',
        parameters: { momentumExhaustionScore: -0.8, volatilityContractionThreshold: 0.4, riskBudget: 0.1 },
        mutationRules: { momentumExhaustionScore: [-0.95, -0.6], volatilityContractionThreshold: [0.2, 0.6], riskBudget: [0.05, 0.15] }
    },
    {
        id: 'boring_algo',
        name: 'Boring Algo',
        assetClasses: ['equity', 'future', 'crypto'],
        riskProfile: 'balanced',
        parameters: { rsiOversold: 30, rsiOverbought: 70, riskBudget: 0.08 },
        mutationRules: { rsiOversold: [20, 40], rsiOverbought: [60, 80], riskBudget: [0.04, 0.12] }
    },
    {
        id: 'yield_harvester',
        name: 'Yield Harvester',
        assetClasses: ['equity', 'etf', 'hedge'],
        riskProfile: 'income_bias',
        parameters: { carryWeight: 0.45, drawdownLimit: 0.08, riskBudget: 0.06 },
        mutationRules: { carryWeight: [0.25, 0.7], drawdownLimit: [0.04, 0.14], riskBudget: [0.02, 0.09] }
    },
    {
        id: 'daviddtech_keltner',
        name: 'DavidTech High-Conviction Keltner',
        assetClasses: ['crypto', 'equity'],
        riskProfile: 'high_conviction_mean_reversion',
        parameters: { atrMultiplier: 2.2, rsiOversold: 32, rsiOverbought: 68, takeProfitPct: 0.025, stopLossPct: 0.012, leverage: 2.5 },
        mutationRules: { atrMultiplier: [1.8, 2.6], rsiOversold: [25, 35], rsiOverbought: [65, 75] }
    }
];

class StrategyRegistry {
    constructor() {
        this.strategies = new Map();
        this.initialized = false;
    }

    initialize() {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const persisted = this._read();
        const merged = new Map(DEFAULT_STRATEGIES.map(strategy => [strategy.id, {
            ...strategy,
            version: 1,
            status: 'paper',
            promotionHistory: [],
            champion: null,
            updatedAt: new Date().toISOString()
        }]));

        for (const strategy of persisted) {
            if (!strategy?.id) continue;
            const def = merged.get(strategy.id);
            merged.set(strategy.id, {
                ...def,
                ...strategy,
                parameters: { ...(def?.parameters || {}), ...(strategy.parameters || {}) }
            });
        }

        this.strategies = merged;
        this.initialized = true;
        this._save();
        return this.getStatus();
    }

    _read() {
        try {
            if (!fs.existsSync(REGISTRY_PATH)) return [];
            const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
            return Array.isArray(data?.strategies) ? data.strategies : [];
        } catch {
            return [];
        }
    }

    _save() {
        try {
            fs.writeFileSync(REGISTRY_PATH, JSON.stringify({
                updatedAt: new Date().toISOString(),
                strategies: this.list()
            }, null, 2));
        } catch (error) {
            console.warn('[StrategyRegistry] Save failed:', error.message);
        }
    }

    list() {
        return Array.from(this.strategies.values());
    }

    get(id) {
        return this.strategies.get(id) || null;
    }

    mutate(id, seed = Date.now()) {
        const base = this.get(id);
        if (!base) return null;
        const nextParams = { ...(base.parameters || {}) };
        const rules = base.mutationRules || {};
        let n = Number(seed) || Date.now();
        const rand = () => {
            n = (n * 1664525 + 1013904223) % 4294967296;
            return n / 4294967296;
        };

        for (const [key, range] of Object.entries(rules)) {
            if (!Array.isArray(range) || range.length !== 2) continue;
            const [min, max] = range.map(Number);
            nextParams[key] = Number((min + (max - min) * rand()).toFixed(6));
        }

        return {
            ...base,
            id,
            parentId: id,
            parameters: nextParams,
            mutationSeed: seed,
            mutatedAt: new Date().toISOString()
        };
    }

    recordChampion(id, result = {}) {
        const strategy = this.get(id);
        if (!strategy) return null;
        const champion = {
            jobId: result.jobId || null,
            symbol: result.symbol || null,
            score: Number(result.score || 0),
            pnl: Number(result.pnl || 0),
            pnlPct: Number(result.pnlPct || 0),
            winRate: Number(result.winRate || 0),
            maxDrawdownPct: Number(result.maxDrawdownPct || 0),
            parameters: result.parameters || strategy.parameters,
            recordedAt: new Date().toISOString()
        };
        const next = {
            ...strategy,
            champion,
            promotionHistory: [...(strategy.promotionHistory || []), champion].slice(-50),
            updatedAt: new Date().toISOString()
        };
        this.strategies.set(id, next);
        this._save();
        try {
            marketEvidenceStore.append('strategy_registry', {
                action: 'record_champion',
                strategyId: id,
                champion
            }, { source: 'StrategyRegistry', symbol: champion.symbol, strategyId: id });
        } catch {
            // Registry save is authoritative; evidence mirror is non-blocking.
        }
        return next;
    }

    getStatus() {
        const strategies = this.list();
        return {
            initialized: this.initialized,
            count: strategies.length,
            champions: strategies.filter(strategy => strategy.champion).length,
            registryPath: REGISTRY_PATH
        };
    }
}

const strategyRegistry = new StrategyRegistry();
export { DEFAULT_STRATEGIES };
export default strategyRegistry;
