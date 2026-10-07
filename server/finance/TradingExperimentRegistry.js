import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'trading', 'experiment-registry.json');

function hash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class TradingExperimentRegistry {
    constructor({ statePath = DEFAULT_PATH } = {}) {
        this.statePath = statePath;
    }

    async read() {
        try { return JSON.parse(await fs.readFile(this.statePath, 'utf8')); }
        catch { return { schemaVersion: 2, cumulativeTrials: 0, effectiveIndependentTrials: 0, protocol: null, experiments: [] }; }
    }

    async write(state) {
        await fs.mkdir(path.dirname(this.statePath), { recursive: true });
        const temporary = `${this.statePath}.${process.pid}.tmp`;
        await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await fs.rename(temporary, this.statePath);
    }

    async ensureProtocol({ datasets = [], holdoutRatio = 0.2 } = {}) {
        const state = await this.read();
        const usable = datasets.filter(row => Number(row?.firstTimestamp) > 0 && Number(row?.lastTimestamp) > Number(row?.firstTimestamp));
        if (!usable.length) throw new Error('Cannot seal trading protocol without dataset provenance');
        const datasetKeys = usable.map(row => `${row.symbol}:${row.timeframe}:${row.venue || row.source}`).sort();
        if (state.protocol?.sealedHoldoutStartTimestamp
            && JSON.stringify(state.protocol.datasetKeys || []) === JSON.stringify(datasetKeys)) return state.protocol;
        const cutoffs = usable.map(row => Math.floor(
            Number(row.firstTimestamp) + (Number(row.lastTimestamp) - Number(row.firstTimestamp)) * (1 - holdoutRatio)
        ));
        const superseded = state.protocol || null;
        // If the universe changes after experiments already ran, every existing
        // bar has potentially influenced selection. Start a genuinely unseen
        // forward holdout at the newest observed timestamp instead of relabeling
        // old data as "unseen".
        const prospectiveReset = Boolean(superseded?.id);
        const protocol = {
            id: `sealed-${crypto.randomBytes(6).toString('hex')}`,
            createdAt: new Date().toISOString(),
            sealedHoldoutStartTimestamp: prospectiveReset
                ? Math.max(...usable.map(row => Number(row.lastTimestamp))) + 1
                : Math.max(...cutoffs),
            holdoutRatio,
            holdoutMode: prospectiveReset ? 'prospective_after_universe_change' : 'sealed_historical',
            supersedesProtocolId: superseded?.id || null,
            datasetKeys,
            datasetVenues: [...new Set(usable.map(row => row.venue || row.source))],
            datasetFingerprint: hash(usable.map(row => ({
                symbol: row.symbol, timeframe: row.timeframe, venue: row.venue,
                firstTimestamp: row.firstTimestamp, lastTimestamp: row.lastTimestamp, sha256: row.sha256
            })))
        };
        state.protocolHistory = [...(state.protocolHistory || []), ...(superseded ? [superseded] : [])].slice(-20);
        state.protocol = protocol;
        await this.write(state);
        return protocol;
    }

    async begin({ seed, plannedTrials, families = [], protocol, metadata = {} } = {}) {
        const state = await this.read();
        if (!protocol?.sealedHoldoutStartTimestamp || state.protocol?.id !== protocol.id) {
            throw new Error('Experiment must use the registered sealed protocol');
        }
        const normalizedFamilies = [...new Set(families)].sort();
        const hypothesisFingerprint = hash({ families: normalizedFamilies, metadata });
        const priorHypothesisRuns = state.experiments.filter(row => row.hypothesisFingerprint === hypothesisFingerprint).length;
        const effectiveTrials = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, Number(plannedTrials) || 1))));
        // Migrate old ledgers without erasing their multiple-testing burden. Raw
        // mutations are correlated, so each historical run contributes sqrt(N)
        // effective independent trials instead of either zero or all N trials.
        const priorEffectiveTrials = Number.isFinite(Number(state.effectiveIndependentTrials))
            ? Number(state.effectiveIndependentTrials)
            : (state.experiments || []).reduce((sum, row) => (
                sum + Math.max(1, Math.ceil(Math.sqrt(Math.max(1, Number(row.plannedTrials) || 1))))
            ), 0);
        const experiment = {
            id: `registered-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            registeredAt: new Date().toISOString(), seed,
            plannedTrials: Math.max(1, Math.round(Number(plannedTrials) || 1)),
            families: normalizedFamilies, protocolId: protocol.id,
            hypothesisFingerprint, hypothesisRun: priorHypothesisRuns + 1,
            effectiveIndependentTrials: effectiveTrials,
            metadata, status: 'registered'
        };
        state.cumulativeTrials = Number(state.cumulativeTrials || 0) + experiment.plannedTrials;
        state.effectiveIndependentTrials = priorEffectiveTrials + effectiveTrials;
        state.schemaVersion = 2;
        state.experiments = [...(state.experiments || []), experiment].slice(-500);
        await this.write(state);
        return {
            ...experiment,
            cumulativeTrials: state.cumulativeTrials,
            cumulativeEffectiveIndependentTrials: state.effectiveIndependentTrials
        };
    }

    async complete(id, outcome = {}) {
        const state = await this.read();
        const row = state.experiments.find(item => item.id === id);
        if (!row) throw new Error(`Unknown registered experiment: ${id}`);
        row.status = outcome.error ? 'failed' : 'completed';
        row.completedAt = new Date().toISOString();
        row.outcome = outcome;
        await this.write(state);
        return row;
    }
}

export default new TradingExperimentRegistry();
