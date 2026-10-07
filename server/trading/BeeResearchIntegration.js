import fs from 'node:fs/promises';
import { runResearch } from '../../scripts/beebots-okx-research.mjs';
import beePrometheusBridge from './BeePrometheusBridge.js';

const BEE_KEYS = ['bizzy', 'boozy', 'breezy'];

export function summarizeBeeProxyResearch(summary, artifactPath) {
    if (summary?.paperOnly !== true || summary?.promotionAuthorized !== false) {
        throw new Error('Bee proxy research must explicitly deny promotion');
    }
    const bees = {};
    for (const key of BEE_KEYS) {
        const row = summary.bees?.[key];
        if (!row?.holdout?.metrics || !row?.trainingCandidates?.[0]?.metrics) {
            throw new Error(`Bee proxy research is missing ${key} comparison evidence`);
        }
        bees[key] = {
            instrument: row.instrument,
            completedBars: row.completedBars,
            lastBarTimestamp: row.lastTs,
            development: row.trainingCandidates[0].metrics,
            holdout: row.holdout.metrics
        };
    }
    return {
        status: 'diagnostic_complete',
        source: 'okx_swap_candle_proxy',
        createdAt: summary.createdAt,
        artifactPath,
        paperOrdersAllowed: false,
        promotionAllowed: false,
        limitation: 'Candle proxy omits Laya decisions, historical bid/ask fills and funding settlement.',
        bees
    };
}

export async function runBeeResearchIntegration({
    bridge = beePrometheusBridge,
    research = runResearch,
    readSummary = file => fs.readFile(file, 'utf8')
} = {}) {
    let registration;
    try { registration = bridge.ensurePrometheusResearchEntries(); }
    catch (error) { registration = { success: false, error: error.message }; }

    let parameterSync;
    try { parameterSync = bridge.syncValidatedResearchParameters(); }
    catch (error) { parameterSync = { updated: false, error: error.message }; }

    try {
        const artifactPath = await research();
        const summary = JSON.parse(await readSummary(artifactPath));
        return { ...summarizeBeeProxyResearch(summary, artifactPath), registration, parameterSync };
    } catch (error) {
        return {
            status: 'diagnostic_unavailable', source: 'okx_swap_candle_proxy',
            paperOrdersAllowed: false, promotionAllowed: false,
            error: error.message, registration, parameterSync
        };
    }
}
