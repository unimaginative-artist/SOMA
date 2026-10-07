import fs from 'node:fs/promises';
import path from 'node:path';
import { TradingHistoricalDataPipeline } from '../server/finance/TradingHistoricalDataPipeline.js';
import evolutionLab, { evaluateWalkForward } from '../server/finance/OfflineStrategyEvolutionLab.js';
import { TradingResearchDirector } from '../server/finance/TradingResearchDirector.js';
import { COMPOSITIONAL_ALPHA_MODES } from '../server/finance/OfflineStrategyEvolutionLab.js';
import experimentRegistry from '../server/finance/TradingExperimentRegistry.js';
import microstructurePipeline from '../server/finance/TradingMicrostructurePipeline.js';
import { DEFAULT_LIQUID_CRYPTO_MARKETS } from '../server/finance/TradingHistoricalDataPipeline.js';
import carryPipeline from '../server/finance/TradingCarryPipeline.js';
import { fingerprintResearchEvaluator, TradingResearchClusterCoordinator } from '../server/finance/TradingResearchCluster.js';
import { diagnoseResearchStagnation } from '../server/finance/TradingResearchStagnationPolicy.js';
import { runBeeResearchIntegration } from '../server/trading/BeeResearchIntegration.js';

const root = process.cwd();
const progressPath = path.join(root, 'data', 'trading', 'research-progress.json');

async function readJson(file, fallback = null) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

const previous = await readJson(progressPath, {
    schemaVersion: 1, experimentIndex: 0, consecutiveNoQualified: 0, history: []
});
const experimentIndex = Number(previous.experimentIndex || 0) + 1;
const stagnation = Number(previous.consecutiveNoQualified || 0);
const stagnationPlan = diagnoseResearchStagnation({
    consecutiveNoQualified: stagnation,
    rejectionReasons: previous.lastCycle?.rejectionReasons || {}
});
const populationSize = stagnationPlan.populationSize;
const generations = stagnationPlan.generations;
const seed = `active-edge-${experimentIndex}-${Date.now()}`;
const startedAt = new Date().toISOString();
const researchTimeframes = ['1H', '4H', '1D'];
let microstructure = null;
try {
    microstructure = await microstructurePipeline.sample(DEFAULT_LIQUID_CRYPTO_MARKETS.map(row => row.symbol));
} catch (error) {
    microstructure = { sampled: 0, error: error.message };
}
const carry = await carryPipeline.refresh(DEFAULT_LIQUID_CRYPTO_MARKETS.map(row => row.symbol));

let dataRefresh = null;
try {
    dataRefresh = await new TradingHistoricalDataPipeline().refreshCoreMarkets({
        timeframes: researchTimeframes
    });
} catch (error) {
    // Verified existing caches remain usable when a provider is temporarily
    // unavailable; provenance checks in the director still fail closed.
    dataRefresh = { success: false, error: error.message };
}

if (!dataRefresh?.success) {
    throw new Error(`Venue-aligned Alpaca data refresh failed: ${dataRefresh?.error || 'unknown error'}`);
}
const protocol = await experimentRegistry.ensureProtocol({ datasets: dataRefresh.results });
const registration = await experimentRegistry.begin({
    seed,
    plannedTrials: populationSize * generations,
    families: COMPOSITIONAL_ALPHA_MODES,
    protocol,
    metadata: { timeframes: researchTimeframes, venue: 'alpaca_crypto_us' }
});

let evolution;
const researchCluster = new TradingResearchClusterCoordinator({
    engineFingerprint: fingerprintResearchEvaluator(evaluateWalkForward)
});
const clusterProbe = await researchCluster.probe();
try {
    evolution = await evolutionLab.runFromExistingReports({
        populationSize, generations, folds: 4, seed,
        finalHoldoutStartTimestamp: protocol.sealedHoldoutStartTimestamp,
        trialCountOffset: registration.cumulativeEffectiveIndependentTrials - registration.effectiveIndependentTrials,
        experimentRegistration: registration,
        evaluationDispatcher: researchCluster
    });
} catch (error) {
    await experimentRegistry.complete(registration.id, { error: error.message });
    throw error;
}
const candidates = [
    ...(evolution.qualifiedCandidates || []).map(row => row.candidate),
    ...(evolution.topCandidates || []).map(row => row.candidate)
].filter(Boolean);
const unique = Array.from(new Map(candidates.map(candidate => [
    candidate.id || candidate.key || `${candidate.strategyId}:${candidate.symbol}`,
    candidate
])).values());
const research = await new TradingResearchDirector().run({ candidates: unique, limit: 64 });
// Share validated Market Lab tuning and collect separate OKX Bee diagnostics.
// This proxy has no authority over the Alpaca paper executor or promotion.
const beeResearch = await runBeeResearchIntegration();

const rejectionReasons = {};
for (const audit of research.audits || []) {
    for (const reason of audit.validation?.reasons || []) {
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    }
}
const qualified = Number(research.summary?.paperPromotionEligible || 0);
const researchPassed = Number(research.summary?.researchPassed || 0);
const meaningfulOutcome = qualified > 0
    ? `${qualified} candidate(s) earned paper-canary eligibility`
    : researchPassed > 0
        ? `${researchPassed} candidate(s) passed research and entered prospective shadow observation`
        : `No candidate passed after ${stagnation + 1} stagnant run(s); ${stagnationPlan.recommendation}`;
const cycle = {
    experimentIndex, startedAt, completedAt: new Date().toISOString(), seed,
    populationSize, generations, timeframes: researchTimeframes,
    dataRefresh, microstructure, carry, beeResearch,
    cluster: { probe: clusterProbe, execution: researchCluster.status() },
    stagnation: stagnationPlan,
    evolution: evolution.summary,
    research: research.summary,
    rejectionReasons,
    meaningfulOutcome
};
const progress = {
    schemaVersion: 1,
    experimentIndex,
    consecutiveNoQualified: qualified > 0 ? 0 : stagnation + 1,
    lastMeaningfulOutcome: meaningfulOutcome,
    stagnation: stagnationPlan,
    lastCycle: cycle,
    history: [...(previous.history || []), cycle].slice(-40)
};
await experimentRegistry.complete(registration.id, {
    qualified, researchPassed, evolution: evolution.summary, research: research.summary,
    cluster: researchCluster.status()
});
await fs.mkdir(path.dirname(progressPath), { recursive: true });
const temporary = `${progressPath}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
await fs.rename(temporary, progressPath);
console.log(JSON.stringify({ meaningfulOutcome, evolution: evolution.summary, research: research.summary }, null, 2));
