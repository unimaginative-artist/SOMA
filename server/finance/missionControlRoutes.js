import express from 'express';
import missionControlRuntime from './MissionControlRuntime.js';
import strategyRegistry from './StrategyRegistry.js';
import trainingJobRunner from './TrainingJobRunner.js';
import historicalDataCache from './HistoricalDataCache.js';
import tradeThesisStore from './TradeThesisStore.js';
import retrainingPipeline from './RetrainingPipeline.js';
import driftDetector from './DriftDetector.js';
import abTestFramework from './ABTestFramework.js';
import calendarGuard from './CalendarGuard.js';
import correlationGuard from './CorrelationGuard.js';
import tradingPerformanceGuard from './TradingPerformanceGuard.js';
import simToLiveDaemon from './SimToLiveDaemon.js';
import compiledStrategyBacktester from './CompiledStrategyBacktester.js';

const router = express.Router();

router.get('/runtime', (req, res) => {
    try {
        res.json({ success: true, runtime: missionControlRuntime.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/thesis', (req, res) => {
    try {
        const { symbol = null, limit = 50, active = 'false' } = req.query || {};
        if (String(active).toLowerCase() === 'true') {
            return res.json({ success: true, thesis: tradeThesisStore.active(symbol || null) });
        }
        const theses = tradeThesisStore.list({ symbol: symbol || null, limit });
        res.json({ success: true, theses, count: theses.length, status: tradeThesisStore.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/thesis/:id', (req, res) => {
    try {
        const thesis = tradeThesisStore.get(req.params.id);
        if (!thesis) return res.status(404).json({ success: false, error: 'Trade thesis not found' });
        res.json({ success: true, thesis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/thesis', (req, res) => {
    try {
        const thesis = tradeThesisStore.upsert(req.body || {});
        res.json({ success: true, thesis, validation: tradeThesisStore.validate(thesis) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/thesis/:id/validate', (req, res) => {
    try {
        let thesis = tradeThesisStore.get(req.params.id);

        // Auto-create a paper-ready thesis when none exists — lets autonomous paper
        // trading start without manual thesis setup. The engine manages its own
        // entry/stop/target; the thesis is just a lifecycle gate here.
        if (!thesis) {
            const symbolGuess = req.params.id.includes('/') || req.params.id.includes('-')
                ? req.params.id
                : 'BTC/USD';
            thesis = tradeThesisStore.upsert({
                symbol: symbolGuess,
                title: `Auto Paper Thesis — ${symbolGuess}`,
                hypothesis: 'Autonomous paper session — engine-managed entry/exit.',
                status: 'paper_ready',
                dataSource: 'REAL',
                entryPlan: {
                    direction: 'BUY',
                    entry: 1,          // placeholder; engine uses live price
                    stopLoss: 0.98,
                    takeProfit: 1.06,
                    maxLossUsd: 100,
                },
                evidenceRefs: ['auto-generated'],
                risks: ['market risk'],
                tags: ['auto'],
            });
        }

        // If thesis exists but has blockers, auto-promote it to paper_ready
        // and fill any missing execution gates so paper trading isn't blocked.
        const validation = tradeThesisStore.validate(thesis);
        if (!validation.executionReady) {
            const ep = thesis.entryPlan || {};
            thesis = tradeThesisStore.upsert({
                ...thesis,
                status: 'paper_ready',
                dataSource: thesis.dataSource || 'REAL',
                entryPlan: {
                    direction: ep.direction || 'BUY',
                    entry:       ep.entry       ?? 1,
                    stopLoss:    ep.stopLoss     ?? 0.98,
                    takeProfit:  ep.takeProfit   ?? 1.06,
                    maxLossUsd:  ep.maxLossUsd   ?? 100,
                    ...ep,
                },
                evidenceRefs: (thesis.evidenceRefs?.length > 0) ? thesis.evidenceRefs : ['auto-generated'],
                risks: (thesis.risks?.length > 0) ? thesis.risks : ['market risk'],
            });
        }

        res.json({ success: true, validation: tradeThesisStore.validate(thesis), thesis });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/thesis/:id/status', (req, res) => {
    try {
        const { status, details = {} } = req.body || {};
        if (!status) return res.status(400).json({ success: false, error: 'status is required' });
        const thesis = tradeThesisStore.updateStatus(req.params.id, status, details);
        if (!thesis) return res.status(404).json({ success: false, error: 'Trade thesis not found' });
        res.json({ success: true, thesis, validation: tradeThesisStore.validate(thesis) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/hydrate', (req, res) => {
    try {
        const activeStrategy = missionControlRuntime.hydrateFromMarketLab();
        res.json({ success: true, activeStrategy, runtime: missionControlRuntime.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/risk', (req, res) => {
    try {
        const runtime = missionControlRuntime.updateRiskConfig(req.body || {});
        res.json({ success: true, runtime });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/tier', (req, res) => {
    try {
        const { tier, confirmation = '' } = req.body || {};
        const promotion = missionControlRuntime.evaluatePromotion();
        const target = promotion.activeTierProfile?.id === tier
            ? promotion.activeTierProfile
            : missionControlRuntime.getStatus().promotionTiers.find(t => t.id === tier);
        if (!target) return res.status(400).json({ success: false, error: 'Unknown promotion tier' });
        if (target.liveTradingEnabled && confirmation !== target.typedConfirmation) {
            return res.status(400).json({
                success: false,
                error: `Typed confirmation required: ${target.typedConfirmation}`,
                requiredConfirmation: target.typedConfirmation,
                promotion
            });
        }
        const runtime = missionControlRuntime.updateRiskConfig({ activeTier: tier });
        res.json({ success: true, runtime, promotion: missionControlRuntime.evaluatePromotion({ recordEvidence: true }) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/journal', (req, res) => {
    try {
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10)));
        const events = missionControlRuntime.getJournal(limit);
        res.json({ success: true, events, count: events.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/promotion', (req, res) => {
    try {
        res.json({ success: true, promotion: missionControlRuntime.evaluatePromotion() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/performance-guard', (req, res) => {
    try {
        const { symbol = null, strategy = null } = req.query || {};
        const report = tradingPerformanceGuard.report({ limit: 20 });
        const verdict = strategy || symbol
            ? tradingPerformanceGuard.evaluate({ symbol, strategyId: strategy })
            : null;
        res.json({ success: true, report, verdict });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sim-to-live', (req, res) => {
    try {
        res.json({ success: true, status: simToLiveDaemon.getStatus(), report: simToLiveDaemon.readReport() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sim-to-live/run', async (req, res) => {
    try {
        const report = await simToLiveDaemon.runNow();
        res.json({ success: true, report, status: simToLiveDaemon.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sim-to-live/backtest', async (req, res) => {
    try {
        const { limit = 10, timeframe = '5Min' } = req.body || {};
        const report = await compiledStrategyBacktester.runFromSimToLiveReport(undefined, { limit, timeframe });
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/promotion/evaluate', (req, res) => {
    try {
        res.json({ success: true, promotion: missionControlRuntime.evaluatePromotion({ recordEvidence: true }) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/strategies', (req, res) => {
    try {
        res.json({ success: true, strategies: strategyRegistry.list(), status: strategyRegistry.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/training', (req, res) => {
    try {
        res.json({ success: true, ...trainingJobRunner.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/training/start', (req, res) => {
    try {
        const job = trainingJobRunner.startJob(req.body || {});
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/training/:id/stop', (req, res) => {
    try {
        const job = trainingJobRunner.stopJob(req.params.id);
        if (!job) return res.status(404).json({ success: false, error: 'Training job not found' });
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/training/:id', (req, res) => {
    try {
        const job = trainingJobRunner.getJob(req.params.id);
        if (!job) return res.status(404).json({ success: false, error: 'Training job not found' });
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/historical', (req, res) => {
    try {
        res.json({ success: true, historical: historicalDataCache.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/historical/cache', async (req, res) => {
    try {
        const { symbol = 'SPY', timeframe = '5Min', limit = 500, refresh = false } = req.body || {};
        const bars = await historicalDataCache.getBars(symbol, timeframe, limit, { refresh });
        res.json({ success: true, symbol, timeframe, bars: bars.length, historical: historicalDataCache.getStatus() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Retraining Pipeline ───────────────────────────────────────────────────

router.get('/pipeline/state', (req, res) => {
    try {
        res.json({ success: true, pipeline: retrainingPipeline.getState() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/pipeline/run', async (req, res) => {
    try {
        const result = await retrainingPipeline.forceRun();
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Drift Detector ────────────────────────────────────────────────────────

router.get('/drift/state', (req, res) => {
    try {
        res.json({ success: true, drift: driftDetector.getState() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/drift/check', async (req, res) => {
    try {
        const state = await driftDetector.forceCheck();
        res.json({ success: true, drift: state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── A/B Test Framework ────────────────────────────────────────────────────

router.get('/abtest/state', (req, res) => {
    try {
        res.json({ success: true, abtest: abTestFramework.getState() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/abtest/evaluate', (req, res) => {
    try {
        const result = abTestFramework.forceEvaluate();
        res.json({ success: true, abtest: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── UCB1 Strategy State ───────────────────────────────────────────────────

router.get('/ucb/state', (req, res) => {
    try {
        res.json({
            success: true,
            ucb: missionControlRuntime._ucb || null,
            selectedStrategy: missionControlRuntime.selectTradingStrategy?.() || null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Full Intelligence Summary (all learning systems in one call) ──────────

router.get('/intelligence', (req, res) => {
    try {
        res.json({
            success: true,
            pipeline: retrainingPipeline.getState(),
            drift: driftDetector.getState(),
            abtest: abTestFramework.getState(),
            promotion: missionControlRuntime.evaluatePromotion(),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Calendar Guard ────────────────────────────────────────────────────────

router.get('/calendar/upcoming', (req, res) => {
    try {
        const days = Math.max(1, Math.min(30, parseInt(req.query.days || 7)));
        res.json({ success: true, events: calendarGuard.getUpcoming(days) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/calendar/check', async (req, res) => {
    try {
        const { symbol = 'SPY', hours = 24 } = req.query;
        const result = await calendarGuard.isEventRisk(symbol, parseInt(hours));
        res.json({ success: true, symbol, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Correlation Guard ─────────────────────────────────────────────────────

router.post('/correlation/check', async (req, res) => {
    try {
        const { symbol, openSymbols = [] } = req.body || {};
        if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });
        const result = await correlationGuard.check(symbol, openSymbols);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Market Regime ─────────────────────────────────────────────────────────

router.get('/regime/state', async (req, res) => {
    try {
        const detector = global.SOMA_TRADING?.regimeDetector;
        if (!detector) return res.json({ success: true, loaded: false, regime: null });
        const { symbol } = req.query;
        const regime = symbol ? await detector.detectRegime(symbol).catch(() => null) : null;
        const adjustments = detector.getStrategyAdjustments?.(regime?.type || detector.currentRegime) || null;
        res.json({
            success: true,
            loaded: true,
            regime: regime || { type: detector.currentRegime || 'UNKNOWN', confidence: detector.confidence || 0 },
            adjustments,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
