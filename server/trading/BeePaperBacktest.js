import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BacktestEngine } from '../finance/BacktestEngine.js';
import { validateHistoricalBars } from '../finance/TradingHistoricalDataPipeline.js';

const HOUR_MS = 60 * 60 * 1000;
const SOURCE = 'data/trading/historical-cache/SOL-USD_1H.json';
const BASELINE = Object.freeze({ id: 'baseline', stopAtr: 1.5, targetAtr: 2.5, riskPct: 0.02 });
const CANDIDATES = Object.freeze([
    { id: 'tighter_stop', stopAtr: 1.25, targetAtr: 2.5, riskPct: 0.02 },
    { id: 'wider_stop', stopAtr: 2.0, targetAtr: 2.5, riskPct: 0.02 },
    { id: 'closer_target', stopAtr: 1.5, targetAtr: 2.0, riskPct: 0.02 },
    { id: 'farther_target', stopAtr: 1.5, targetAtr: 3.0, riskPct: 0.02 },
    { id: 'half_risk', stopAtr: 1.5, targetAtr: 2.5, riskPct: 0.01 }
]);

function round(value, digits = 4) {
    return Number(Number(value).toFixed(digits));
}

function atrFromPast(past) {
    const tail = past.slice(-14);
    if (tail.length < 14) return null;
    const ranges = tail.map((bar, index) => {
        const priorClose = index ? tail[index - 1].close : past[past.length - 15]?.close ?? bar.open;
        return Math.max(bar.high - bar.low, Math.abs(bar.high - priorClose), Math.abs(bar.low - priorClose));
    });
    return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function causalTrendSignal(bar, past, engine, config) {
    if (past.length < 48 || engine.positions.length) return null;
    const prior24 = past[past.length - 24].close;
    const sma48 = past.slice(-48).reduce((sum, item) => sum + item.close, 0) / 48;
    const momentum = (bar.close - prior24) / prior24;
    const side = bar.close > sma48 && momentum > 0.01 ? 'long'
        : bar.close < sma48 && momentum < -0.01 ? 'short' : null;
    if (!side) return null;
    const atr = atrFromPast(past);
    if (!(atr > 0)) return null;
    const stopDistance = Math.max(config.stopAtr * atr, bar.close * 0.002);
    const targetDistance = config.targetAtr * atr;
    const size = Math.min(
        engine.capital * config.riskPct / stopDistance,
        engine.capital * 2 / bar.close
    );
    if (!(size > 0)) return null;
    return {
        action: side === 'long' ? 'open_long' : 'open_short',
        symbol: 'SOL-USD', size,
        stopLoss: side === 'long' ? bar.close - stopDistance : bar.close + stopDistance,
        takeProfit: side === 'long' ? bar.close + targetDistance : bar.close - targetDistance
    };
}

async function runWindow(bars, config, assumptions, warmup = 0) {
    const engine = new BacktestEngine({
        initialCapital: 333.34,
        feeRate: assumptions.feeRate,
        slippage: assumptions.slippageRate,
        maxPositionSize: 2,
        maxDrawdownLimit: 0.25
    });
    const result = await engine.runBacktest(
        bars.map(bar => ({ ...bar, time: bar.timestamp })),
        (bar, past, state, index) => index < warmup ? null : causalTrendSignal(bar, past, state, config),
        { symbol: 'SOL-USD' }
    );
    if (!result.success) throw new Error(`Backtest ${config.id} failed: ${result.error}`);
    const fundingCost = result.trades.reduce((sum, trade) => {
        const hours = Math.max(0, (trade.exitTime - trade.entryTime) / HOUR_MS);
        return sum + trade.entryPrice * trade.size * assumptions.assumedFundingPer8h * hours / 8;
    }, 0);
    const netTrades = result.trades.map(trade => {
        const hours = Math.max(0, (trade.exitTime - trade.entryTime) / HOUR_MS);
        return trade.pnl - trade.fees - trade.entryPrice * trade.size * assumptions.assumedFundingPer8h * hours / 8;
    });
    const grossWin = netTrades.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = -netTrades.filter(value => value < 0).reduce((sum, value) => sum + value, 0);
    return {
        bars: bars.length - warmup,
        trades: result.trades.length,
        netAfterCosts: round(engine.capital - 333.34 - fundingCost, 2),
        totalFees: round(result.metrics.totalFees, 2),
        estimatedFundingCost: round(fundingCost, 2),
        winRatePct: round(netTrades.length ? netTrades.filter(value => value > 0).length / netTrades.length * 100 : 0, 2),
        profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : null,
        maxDrawdownPct: round(result.metrics.maxDrawdown, 2),
        firstBar: new Date(bars[warmup]?.timestamp || bars[0].timestamp).toISOString(),
        lastBar: new Date(bars.at(-1).timestamp).toISOString()
    };
}

function safeId(id) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(String(id || ''))) throw new Error('Invalid experiment ID');
    return id;
}

export async function runBreezyPaperBacktest({ jobId, experimentId = crypto.randomUUID(), root = process.cwd(), bars = null, provenance = null, now = Date.now(), onStep = async () => {} } = {}) {
    safeId(experimentId);
    safeId(jobId);
    const sourcePath = path.join(root, SOURCE);
    const sourceText = bars ? null : await fs.readFile(sourcePath, 'utf8');
    const data = bars || JSON.parse(sourceText);
    const sourceProof = provenance || JSON.parse(await fs.readFile(`${sourcePath}.provenance.json`, 'utf8'));
    const sourceSha256 = sourceText ? crypto.createHash('sha256').update(sourceText).digest('hex') : null;
    if (sourceSha256 && sourceSha256 !== sourceProof.sha256) throw new Error('Historical cache checksum does not match provenance');
    if (sourceProof.timeframe !== '1H' || sourceProof.symbol !== 'SOL-USD') throw new Error('Wrong historical data scope for Breezy');
    if (!Array.isArray(data) || data.length < 720) throw new Error('At least 720 hourly bars are required');
    const validation = validateHistoricalBars(data, { intervalMs: HOUR_MS, now });
    if (validation.issues.length) throw new Error(`Historical bars invalid: ${validation.issues.join(', ')}`);
    if (data.at(-1).timestamp > now) throw new Error('Historical cache contains future bars');
    const sourceFreshnessPassed = validation.ageMs <= HOUR_MS * 3;

    const split = Math.floor(data.length * 0.7);
    const train = data.slice(0, split);
    const outOfSample = data.slice(split - 48);
    const assumptions = {
        feeRate: 0.0006,
        slippageRate: 0.0005,
        assumedFundingPer8h: 0.0001,
        fundingIsHistorical: false,
        venue: sourceProof.venue,
        instrumentMismatch: 'Alpaca SOL-USD spot bars are a proxy for OKX SOL-USDT-SWAP; historical Laya decisions and funding are unavailable.'
    };
    const configs = [BASELINE, ...CANDIDATES];
    const directory = path.join(root, 'data', 'trading', 'bee-experiments', experimentId);
    await fs.mkdir(directory, { recursive: true });
    const contractPath = path.join(directory, 'experiment.json');
    const contract = {
        experimentId, jobId, strategy: 'Breezy Bee trend-only proxy', symbols: ['SOL-USD'],
        dateRange: { start: new Date(data[0].timestamp).toISOString(), end: new Date(data.at(-1).timestamp).toISOString() },
        timeframe: '1H', baselineConfig: BASELINE, candidateConfigs: CANDIDATES,
        fees: { rate: assumptions.feeRate }, slippage: { rate: assumptions.slippageRate },
        fundingCosts: { assumedRatePer8h: assumptions.assumedFundingPer8h, historical: false },
        positionSizing: { maxLeverage: 2, riskPctRange: [0.01, 0.02] },
        trainTestSplit: { method: 'chronological', trainBars: train.length, testBars: data.length - split },
        mode: 'paper_backtest', deploymentAllowed: false, source: SOURCE,
        limitations: assumptions.instrumentMismatch
    };
    await fs.writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx' });
    const stepsPath = path.join(directory, 'steps.json');
    const steps = [];
    const executeStep = async (step, action, window, config, warmup = 0) => {
        const receipt = {
            jobId, experimentId, step, tool: 'bee_paper_backtest', action,
            status: 'running', startedAt: Date.now(), completedAt: null,
            artifactPath: null, resultSummary: null, error: null
        };
        steps.push(receipt);
        await fs.writeFile(stepsPath, `${JSON.stringify(steps, null, 2)}\n`);
        await onStep({ ...receipt });
        try {
            const result = await runWindow(window, config, assumptions, warmup);
            receipt.status = 'completed';
            receipt.completedAt = Date.now();
            receipt.artifactPath = stepsPath;
            receipt.resultSummary = `${result.trades} trades; after-cost PnL $${result.netAfterCosts}`;
            await fs.writeFile(stepsPath, `${JSON.stringify(steps, null, 2)}\n`);
            await onStep({ ...receipt });
            return result;
        } catch (error) {
            receipt.status = 'failed';
            receipt.completedAt = Date.now();
            receipt.error = error.message;
            await fs.writeFile(stepsPath, `${JSON.stringify(steps, null, 2)}\n`);
            await onStep({ ...receipt });
            throw error;
        }
    };
    const runs = [];
    for (const config of configs) {
        const trainResult = await executeStep(steps.length + 1, `${config.id}:train`, train, config);
        const testResult = await executeStep(steps.length + 1, `${config.id}:out_of_sample`, outOfSample, config, 48);
        runs.push({ config, train: trainResult, outOfSample: testResult });
    }
    const baselineOos = runs[0].outOfSample.netAfterCosts;
    const selectedOnTrain = [...runs].sort((left, right) => right.train.netAfterCosts - left.train.netAfterCosts)[0];
    const report = {
        schemaVersion: 1, experimentId, jobId, mode: 'paper_backtest', strategy: 'Breezy Bee trend-only proxy',
        symbol: 'SOL-USD', intendedInstrument: 'SOL-USDT-SWAP', timeframe: '1H',
        source: { path: SOURCE, sha256: sourceSha256 || sourceProof.sha256 || null, provenance: sourceProof, validation },
        trainTestSplit: { method: 'chronological', trainBars: train.length, testBars: data.length - split, warmupBars: 48 },
        assumptions, baselineConfig: BASELINE, candidateConfigs: CANDIDATES, runs,
        comparison: runs.map(run => ({ id: run.config.id,
            trainNetAfterCosts: run.train.netAfterCosts,
            outOfSampleNetAfterCosts: run.outOfSample.netAfterCosts,
            outOfSampleDeltaVsBaseline: round(run.outOfSample.netAfterCosts - baselineOos, 2),
            outOfSampleTrades: run.outOfSample.trades })),
        trainSelectedCandidate: selectedOnTrain.config.id,
        trainSelectedOutOfSampleNetAfterCosts: selectedOnTrain.outOfSample.netAfterCosts,
        verification: {
            passed: runs.length === configs.length && runs.every(run => Number.isFinite(run.train.netAfterCosts) && Number.isFinite(run.outOfSample.netAfterCosts)),
            causalSignal: 'The signal uses the current completed bar and earlier bars only; no later bars enter an entry decision.',
            sourceIntegrityPassed: validation.issues.length === 0,
            sourceFreshnessPassed,
            sourceFreshnessNote: sourceFreshnessPassed ? 'Cache is fresh enough for current 1H analysis.' : 'Cache is stale for current-market use, but remains usable for this dated offline experiment.',
            historicalLayaReplay: false, historicalFundingReplay: false,
            promotionEligible: false,
            limitations: ['Not a faithful Laya or OKX perpetual replay', 'Funding is an explicit conservative assumption, not observed historical funding', 'Parameter differences are exploratory and do not authorize deployment',
                ...(!sourceFreshnessPassed ? ['Historical cache is stale for current-market decisions'] : [])]
        },
        deploymentAllowed: false,
        createdAt: new Date(now).toISOString()
    };
    if (!report.verification.passed) throw new Error('Backtest verification failed: missing or inconsistent runs');
    const artifactPath = path.join(directory, 'comparison.json');
    await fs.writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    const readBack = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    if (readBack.runs?.length !== configs.length || readBack.jobId !== jobId) throw new Error('Backtest artifact read-back verification failed');
    return {
        success: true, experimentId, jobId, contractPath, artifactPath, stepsPath, stepCount: steps.length,
        artifactSha256: crypto.createHash('sha256').update(await fs.readFile(artifactPath)).digest('hex'),
        verification: report.verification,
        baseline: runs[0], candidates: runs.slice(1),
        summary: `Completed ${runs.length} exploratory train/out-of-sample runs on ${data.length} SOL-USD spot bars. Baseline held-out after-cost P&L $${baselineOos}; train-selected ${selectedOnTrain.config.id} held-out $${selectedOnTrain.outOfSample.netAfterCosts}. This is a trend-only proxy, not a faithful Breezy/Laya/OKX replay; deployment remains blocked.`
    };
}
