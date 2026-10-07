import fs from 'node:fs/promises';
import path from 'node:path';
import { CompiledStrategyBacktester } from './CompiledStrategyBacktester.js';
import { FreqtradeResearchSidecar, VectorbtResearchSidecar, assessNautilusReadiness } from './TradingEngineSidecars.js';
import { verifySomaReplayParity } from './TradingBacktestParity.js';
import { validateResearchCandidate } from './TradingResearchValidator.js';
import shadowPortfolioLab, { ShadowPortfolioLab } from './ShadowPortfolioLab.js';
import { buildShadowPortfolioPlan } from './ShadowPortfolioAllocator.js';
import { COMPOSITIONAL_ALPHA_MODES } from './OfflineStrategyEvolutionLab.js';
import { enrichBarsWithCrossAssetContext } from './TradingContextFeatures.js';
import microstructurePipeline from './TradingMicrostructurePipeline.js';
import carryPipeline from './TradingCarryPipeline.js';
import { TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

function timeframeMs(value = '1H') {
    const match = String(value || '1H').toUpperCase().match(/^(\d+)(MIN|H|D)$/);
    if (!match) return 3_600_000;
    return Number(match[1]) * (match[2] === 'MIN' ? 60_000 : match[2] === 'D' ? 86_400_000 : 3_600_000);
}

export function rankResearchPrescreen(rows = []) {
    const tier = row => {
        const trades = Number(row.result?.trades || 0);
        const pnl = Number(row.result?.totalPnl || 0);
        const profitFactor = Number(row.result?.profitFactor || 0);
        return trades >= 10 && pnl > 0 && profitFactor >= 1.1 ? 2 : trades >= 10 ? 1 : 0;
    };
    return [...rows].sort((left, right) => tier(right) - tier(left)
        || Number(right.result?.totalPnl || 0) - Number(left.result?.totalPnl || 0)
        || Number(right.result?.trades || 0) - Number(left.result?.trades || 0));
}

function selectDiverseAudits(ranked = [], limit = 20) {
    const selected = [];
    const ids = new Set();
    const add = row => {
        const id = row?.candidate?.id || row?.candidate?.key;
        if (!row || ids.has(id) || selected.length >= limit) return false;
        ids.add(id); selected.push(row); return true;
    };
    for (const timeframe of ['1H', '4H', '1D']) {
        let count = 0;
        for (const row of ranked) {
            if (row.candidate.compiledStrategy?.dsl?.execution?.timeframe === timeframe && add(row)) count++;
            if (count >= 4) break;
        }
    }
    for (const mode of COMPOSITIONAL_ALPHA_MODES) {
        for (const row of ranked) {
            if (row.candidate.compiledStrategy?.dsl?.entry?.mode === mode && add(row)) break;
        }
    }
    for (const row of ranked) add(row);
    return selected;
}

export class TradingResearchDirector {
    constructor(options = {}) {
        this.backtester = options.backtester || new CompiledStrategyBacktester({ ...options, requireProvenance: true });
        this.vectorbt = options.vectorbt || new VectorbtResearchSidecar();
        this.freqtrade = options.freqtrade || new FreqtradeResearchSidecar(options);
        this.shadow = options.shadow || shadowPortfolioLab;
        this.reportPath = options.reportPath || path.join(process.cwd(), 'data', 'trading', 'research-director-latest.json');
        // Separate ledger: diagnostic observations can never enter promotion's
        // qualified shadow allocator or paper candidate selector.
        this.diagnosticShadow = options.diagnosticShadow || new ShadowPortfolioLab({
            statePath: path.join(path.dirname(this.reportPath), 'diagnostic-shadow-portfolios.json')
        });
    }

    async run({ candidates = [], limit = 64 } = {}) {
        const available = [];
        for (const candidate of candidates.slice(0, Math.max(1, limit))) {
            const timeframe = candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            const loaded = await this.backtester.loadBars(candidate.symbol, timeframe);
            if (loaded?.bars?.length >= 300) available.push({ candidate, loaded });
        }
        const diagnosticErrors = [];
        let frozenDiagnostics = [];
        try { frozenDiagnostics = this.diagnosticShadow.frozenCandidates().slice(0, 3); }
        catch (error) { diagnosticErrors.push(`load: ${error.message}`); }
        const diagnosticRows = [];
        for (const candidate of frozenDiagnostics) {
            const timeframe = candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            try {
                const loaded = await this.backtester.loadBars(candidate.symbol, timeframe);
                if (loaded?.bars?.length >= 300) diagnosticRows.push({ candidate, loaded });
            } catch (error) { diagnosticErrors.push(`${candidate.id}: ${error.message}`); }
        }
        const rawSegments = new Map();
        for (const row of [...available, ...diagnosticRows]) {
            const timeframe = row.candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            rawSegments.set(`${String(row.candidate.symbol).toUpperCase()}:${timeframe}`, row.loaded.bars);
        }
        const enrichedSegments = new Map();
        for (const [key, bars] of rawSegments.entries()) {
            const separator = key.lastIndexOf(':');
            const symbol = key.slice(0, separator);
            const timeframe = key.slice(separator + 1);
            const contextSeries = {};
            for (const [otherKey, otherBars] of rawSegments.entries()) {
                const otherSeparator = otherKey.lastIndexOf(':');
                if (otherKey.slice(otherSeparator + 1) === timeframe) contextSeries[otherKey.slice(0, otherSeparator)] = otherBars;
            }
            const withMicrostructure = await microstructurePipeline.enrichBars({ symbol, bars, timeframeMs: timeframeMs(timeframe) });
            const fundingSeries = await carryPipeline.load(symbol);
            enrichedSegments.set(key, enrichBarsWithCrossAssetContext({
                bars: withMicrostructure, targetSymbol: symbol, contextSeries, fundingSeries
            }));
        }
        for (const row of available) {
            const timeframe = row.candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            const key = `${String(row.candidate.symbol).toUpperCase()}:${timeframe}`;
            row.loaded = { ...row.loaded, bars: enrichedSegments.get(key) || row.loaded.bars };
        }
        const ranked = [];
        const groups = new Map();
        for (const row of available) {
            const timeframe = row.candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            const key = `${String(row.candidate.symbol).toUpperCase()}:${timeframe}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }
        for (const group of groups.values()) {
            // Shortlisting must not inspect the newest 20% that the fixed
            // validator uses as its held-out comparison.
            const developmentEnd = Math.floor(group[0].loaded.bars.length * 0.8);
            ranked.push(...this.vectorbt.search({ bars: group[0].loaded.bars.slice(0, developmentEnd), candidates: group.map(row => row.candidate) })
                .map(row => ({ ...row, loaded: group[0].loaded })));
        }
        const prescreened = rankResearchPrescreen(ranked);
        const audits = [];
        for (const row of selectDiverseAudits(prescreened, 20)) {
            const validation = validateResearchCandidate({
                bars: row.loaded.bars, candidate: row.candidate, trials: Math.max(1, ranked.length)
            });
            const parity = verifySomaReplayParity({ bars: row.loaded.bars, candidate: row.candidate });
            let sidecarValidation;
            if (validation.passed && parity.passed && typeof this.freqtrade.validateCandidate === 'function') {
                sidecarValidation = await this.freqtrade.validateCandidate(row.candidate, { bars: row.loaded.bars });
            } else {
                const artifact = await this.freqtrade.exportCandidate(row.candidate);
                sidecarValidation = {
                    artifact,
                    passed: false,
                    status: validation.passed && parity.passed
                        ? 'validator_not_implemented'
                        : 'not_run_internal_gates_failed',
                    prerequisites: { researchPassed: validation.passed, parityPassed: parity.passed },
                    paperOnly: true,
                    liveExecutionAllowed: false
                };
            }
            // Failed historical/parity/sidecar candidates are not enrolled as
            // prospective paper experiments. Enrollment freezes the recipe.
            const researchQualified = validation.passed && parity.passed && sidecarValidation.passed;
            let shadow = null;
            if (researchQualified) {
                this.shadow.register(row.candidate, {
                    initialBarTimestamp: row.loaded.bars.at(-1)?.timestamp || null,
                    historyStartTimestamp: row.loaded.bars[0]?.timestamp || null
                });
                shadow = this.shadow.replayCandidate(row.candidate, row.loaded.bars);
            }
            const evidence = { ...validation, parity, shadow };
            const nautilus = assessNautilusReadiness(evidence);
            audits.push({
                candidate: row.candidate, searchMetrics: row.result, validation,
                parity, sidecarArtifact: sidecarValidation.artifact || sidecarValidation,
                sidecarValidation, shadow, nautilus,
                paperPromotionEligible: researchQualified && shadow?.replayBlockedReason == null
                    && shadow?.prospectiveClosedTrades >= 100 && shadow?.netPnl > 0
                    && shadow?.profitFactor >= 1.2 && shadow?.returnInterval?.lower95 > 0,
                livePromotionEligible: false
            });
        }
        for (const row of diagnosticRows) {
            const timeframe = row.candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            const bars = enrichedSegments.get(`${String(row.candidate.symbol).toUpperCase()}:${timeframe}`) || row.loaded.bars;
            try { this.diagnosticShadow.replayCandidate(row.candidate, bars); }
            catch (error) { diagnosticErrors.push(`${row.candidate.id}: ${error.message}`); }
        }
        const observedFamilies = new Set(frozenDiagnostics.map(candidate =>
            `${candidate.symbol}:${candidate.compiledStrategy?.dsl?.execution?.timeframe}:${candidate.compiledStrategy?.dsl?.entry?.mode}`));
        let diagnosticSlots = Math.max(0, 3 - frozenDiagnostics.length);
        for (const row of prescreened) {
            if (!diagnosticSlots) break;
            const candidate = row.candidate;
            const family = `${candidate.symbol}:${candidate.compiledStrategy?.dsl?.execution?.timeframe}:${candidate.compiledStrategy?.dsl?.entry?.mode}`;
            if (observedFamilies.has(family) || Number(row.result?.trades || 0) < 5
                || candidate.economicsVersion !== TRADING_ECONOMICS_VERSION
                || candidate.compiledStrategy?.economicsVersion !== TRADING_ECONOMICS_VERSION
                || candidate.compiledStrategy?.paperOnly === false
                || row.result?.frictionCheck?.passed === false) continue;
            const bars = row.loaded.bars;
            try {
                this.diagnosticShadow.register(candidate, {
                    initialBarTimestamp: bars.at(-1)?.timestamp || null,
                    historyStartTimestamp: bars[0]?.timestamp || null
                });
                observedFamilies.add(family);
                diagnosticSlots--;
            } catch (error) { diagnosticErrors.push(`${candidate.id}: ${error.message}`); }
        }
        let diagnosticStatuses = [];
        try { diagnosticStatuses = this.diagnosticShadow.listStatuses().slice(0, 3); }
        catch (error) { diagnosticErrors.push(`status: ${error.message}`); }
        const probes = {
            freqtrade: await this.freqtrade.probe(),
            vectorbt: await this.vectorbt.probe()
        };
        const report = {
            schemaVersion: 1, generatedAt: new Date().toISOString(), mode: 'paper_only_research',
            policy: { liveExecutionAllowed: false, externalEnginesAdvisoryOnly: true },
            summary: {
                candidatesRequested: candidates.length, candidatesWithData: available.length,
                audited: audits.length, researchPassed: audits.filter(row => row.validation.passed).length,
                externalEngineValidated: audits.filter(row => row.sidecarValidation?.passed).length,
                prospectiveEnrolled: audits.filter(row => row.shadow != null).length,
                diagnosticShadowObserved: diagnosticStatuses.length,
                paperPromotionEligible: audits.filter(row => row.paperPromotionEligible).length
            },
            probes, audits,
            diagnosticShadow: { diagnosticOnly: true, paperOrdersAllowed: false, promotionAllowed: false,
                candidates: diagnosticStatuses, errors: diagnosticErrors },
            shadowPortfolio: buildShadowPortfolioPlan([
                ...audits,
                ...this.shadow.listStatuses().map(shadow => ({
                    candidate: { id: shadow.id, strategyId: shadow.strategyId, symbol: shadow.symbol },
                    shadow
                }))
            ])
        };
        await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
        await fs.writeFile(this.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        return report;
    }
}

export default TradingResearchDirector;
