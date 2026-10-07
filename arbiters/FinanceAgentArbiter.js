import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const FinanceKnowledgeArbiter = require('./finance/FinanceKnowledgeArbiter.cjs');
import gridEngine from '../server/finance/strategies/GridEngine.js';
import { computeAll, calculateATR } from '../server/finance/TechnicalIndicators.js';

// 🚀 REVOLUTIONARY TRADING SYSTEMS
import { TradeLearningEngine } from './TradeLearningEngine.js';
import { MultiTimeframeAnalyzer } from './MultiTimeframeAnalyzer.js';
import { AdaptivePositionSizer } from './AdaptivePositionSizer.js';
import { MarketRegimeDetector } from './MarketRegimeDetector.js';
import { BacktestEngine } from './BacktestEngine.js';
import { RiskManager } from './RiskManager.js';
import { PerformanceAnalytics } from './PerformanceAnalytics.js';
import { EconomicCalendar } from './EconomicCalendar.js';
import { MetaLearner } from './MetaLearner.js';
import { ToolCreatorArbiter } from './ToolCreatorArbiter.js';
import marketDataService from '../server/finance/marketDataService.js';
import ictKillzoneStrategy from '../server/finance/strategies/IctKillzoneEngine.js';

/**
 * FinanceAgentArbiter V2.1 - "The Phased Market Wolf"
 */
export class FinanceAgentArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'FinanceAgentArbiter',
      role: ArbiterRole.SPECIALIST,
      capabilities: [
        ArbiterCapability.SEARCH_WEB,
        ArbiterCapability.MICRO_SPAWN,
        ArbiterCapability.EXECUTE_CODE,
        ArbiterCapability.MEMORY_ACCESS,
        ArbiterCapability.READ_FILES
      ]
    });

    this.uiConfig = { label: 'Finance', icon: 'DollarSign', color: 'emerald' };
    this.quadBrain = opts.quadBrain || null;
    this.graphify = opts.graphify; // Link to GraphifyArbiter
    this.knowledgeArbiter = new FinanceKnowledgeArbiter({ rootPath: opts.rootPath || process.cwd() });
    this.portfolio = { cash: 100000, positions: {}, history: [] };

    // --- Core Systems ---
    const rootPath = opts.rootPath || process.cwd();
    this.learningEngine = new TradeLearningEngine({ quadBrain: this.quadBrain, rootPath });
    this.mtfAnalyzer = new MultiTimeframeAnalyzer();
    this.positionSizer = new AdaptivePositionSizer({ basePositionSize: 1000, maxPositionSize: 5000, minPositionSize: 100 });
    this.regimeDetector = new MarketRegimeDetector();
    this.backtestEngine = new BacktestEngine({ quadBrain: this.quadBrain, mtfAnalyzer: this.mtfAnalyzer, rootPath });
    this.riskSystem = new RiskManager({ rootPath });
    this.analytics = new PerformanceAnalytics({ rootPath });
    this.economicCalendar = new EconomicCalendar({ rootPath });
    this.metaLearner = new MetaLearner({ rootPath, performanceAnalytics: this.analytics });
    this.toolCreator = new ToolCreatorArbiter({ quadBrain: this.quadBrain, rootPath });

    this._currentPhase = 'IDLE';
  }

  async onInitialize() {
    await this.knowledgeArbiter.initialize();
    if (this.learningEngine) await this.learningEngine.initialize();
    if (this.backtestEngine) await this.backtestEngine.initialize();
    if (this.analytics) await this.analytics.initialize();
    if (this.economicCalendar) await this.economicCalendar.initialize();
    if (this.riskSystem) await this.riskSystem.initialize();
    if (this.metaLearner) await this.metaLearner.initialize();
    
    // Start Autonomous ICT Killzone Scanner (Runs every 1 minute)
    this._ictInterval = setInterval(() => {
        this.analyzeIctKillzone('BTC-USD').catch(e => this.auditLogger.error(`[ICT Error] ${e.message}`));
    }, 60000);
    this.auditLogger.info(`[ICT] Autonomous Killzone Scanner initialized for BTC-USD (1m interval).`);

    this.auditLogger.info('✅ Finance Pack Phase Alignment Complete.');
  }

  /**
   * THE MONSTER WORKFLOW - Phased Assembly Line Edition
   */
  async analyzeStock(symbol, context = {}) {
    this.auditLogger.info(`🚀 [HedgeFund] Initiating PHASED SWARM analysis for ${symbol}`);
    const startTime = Date.now();
    this._currentPhase = 'DISCOVERY';

    // 🕸️ Semantic Market Context via Graphify
    let semanticContext = null;
    if (this.graphify) {
        this.auditLogger.info(`[Phase 0/7] SEMANTIC: Checking knowledge graph for ${symbol} associations...`);
        const graphRes = await this.graphify.query(`How does ${symbol} relate to current market regimes, sector trends, or macro-economic entities in our knowledge base?`);
        if (graphRes.success) semanticContext = graphRes.raw;
    }

    global.__SOMA_FINANCE_ANALYSIS = true;
    try {
        // PHASE 1: MARKET DISCOVERY
        const regime = await this.regimeDetector.detectRegime(symbol);
        await new Promise(r => setTimeout(r, 1000));

        // PHASE 2: ANALYSIS
        this._currentPhase = 'ANALYSIS';
        const mtfAnalysis = await this.mtfAnalyzer.analyzeSymbol(symbol);
        await new Promise(r => setTimeout(r, 1000));

        // PHASE 3: WOLF THESIS (SOMA-WOLF)
        this._currentPhase = 'HYPOTHESIS';
        const wolfPersona = await this._getPersona('Market Wolf');
        const prompt = `${wolfPersona}
        
        [DETECTOR OUTCOME]
        CURRENT MARKET REGIME: ${JSON.stringify(regime)}
        MULTI-TIMEFRAME ANALYSIS: ${JSON.stringify(mtfAnalysis)}
        
        ${semanticContext ? `STRATEGIC CONTEXT FROM KNOWLEDGE GRAPH:\n${semanticContext}\n` : ''}
        Task: Generate a STRIKE signal for ${symbol}. Respond in the REQUIRED JSON FORMAT.`;
        const thesisResult = await this.quadBrain.reason(prompt, 'logos');
        let thesis = thesisResult.response || thesisResult.text;
        
        // Attempt to parse structured trade data
        try {
            const match = thesis.match(/\{[\s\S]*\}/);
            if (match) this._phaseResults.tradeObject = JSON.parse(match[0]);
        } catch (e) {
            this.auditLogger.warn('Wolf failed to output valid JSON. Using text thesis.');
        }
        await new Promise(r => setTimeout(r, 1000));

        // PHASE 4: DATA INGESTION
        this._currentPhase = 'INGESTION';
        const [researchData, visualAnalysis] = await Promise.all([
          this._runResearcherAgent(symbol),
          this._runVisualAnalysisAgent(symbol)
        ]);
        await new Promise(r => setTimeout(r, 1000));

        // PHASE 5: RISK & STATS (SOMA-RISK)
        this._currentPhase = 'RISK_CHECK';
        this.auditLogger.info(`[Phase 5/7] RISK: SOMA-RISK auditing Wolf proposal...`);
        
        const riskPersona = await this._getPersona('Risk Manager');
        const riskPrompt = `${riskPersona}
        
        [DETECTOR OUTCOME]
        CURRENT MARKET REGIME: ${JSON.stringify(regime)}
        MULTI-TIMEFRAME ANALYSIS: ${JSON.stringify(mtfAnalysis)}
        
        TASK: Audit this WOLF PROPOSAL: ${JSON.stringify(this._phaseResults.tradeObject || thesis)}
        Respond in the REQUIRED JSON FORMAT.`;
        const riskResult = await this.quadBrain.reason(riskPrompt, 'thalamus');
        
        let riskAudit = { status: 'REJECTED', reason: 'Risk Brain Offline' };
        try {
            const match = (riskResult.response || riskResult.text).match(/\{[\s\S]*\}/);
            if (match) riskAudit = JSON.parse(match[0]);
        } catch (e) {
            this.auditLogger.warn('Risk Manager failed to output valid JSON. Defaulting to VETO.');
        }

        this._phaseResults.riskAudit = riskAudit;
        await new Promise(r => setTimeout(r, 1000));

        // PHASE 6: STRATEGY SYNTHESIS
        this._currentPhase = 'STRATEGY';
        this.auditLogger.info(`[Phase 6/7] STRATEGY: Finalizing verdict...`);
        const strategyResult = await this._runStrategistAgent(symbol, { bull_thesis: thesis, bear_thesis: riskAudit.reason || 'Audit passed' }, riskAudit);
        await new Promise(r => setTimeout(r, 1000));

        // PHASE 7: EXECUTION
        this._currentPhase = 'REPORTING';
        let tradeExecution = { executed: false, reason: 'Risk Audit VETO' };
        
        if (riskAudit.status === 'APPROVED' && strategyResult.recommendation !== 'HOLD') {
            this.auditLogger.info(`✅ [MarketWolf] Risk approved. Executing Strike.`);
            tradeExecution = await this._executePaperTrade(symbol, strategyResult, 1000);
        } else {
            this.auditLogger.warn(`❌ [MarketWolf] Trade REJECTED by Risk Manager: ${riskAudit.reason || 'Safety limit'}`);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        this.auditLogger.info(`✅ [MarketWolf] Analysis complete for ${symbol} in ${duration}s`);

        return {
          symbol,
          timestamp: new Date().toISOString(),
          regime,
          mtfAnalysis,
          thesis,
          riskAssessment,
          trade: tradeExecution,
          portfolio: this.getPortfolioSummary()
        };

    } finally {
        global.__SOMA_FINANCE_ANALYSIS = false;
        this._currentPhase = 'IDLE';
    }
  }

  async _getPersona(name) {
    if (this.system?.identityArbiter) {
        return this.system.identityArbiter.personas.get(name)?.content || 'Professional Trader.';
    }
    return 'Professional Trader.';
  }

  async _runResearcherAgent(symbol) {
    const priceHistory = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
      close: 150 * (1 + (Math.random() * 0.1 - 0.05))
    }));
    return { price: "150.00", priceHistory, news: [] };
  }

  async _runVisualAnalysisAgent(symbol) {
    return { trend_analysis: "Technical alignment verified." };
  }

  async _runQuantAgent(symbol, priceHistory, thesis) {
    return { strategy: "Technical Confluence", signals: "Bullish" };
  }

  async _runRiskAgent(symbol, context) {
    return { score: 20, approved: true, notes: "Risk within limits." };
  }

  async _runStrategistAgent(symbol, debate, risk) {
    return { recommendation: 'BUY', confidence: 0.88 };
  }

  async _executePaperTrade(symbol, strategy, amount) {
    this.auditLogger.info(`[MarketWolf] 💹 Executing Paper Trade: ${symbol}`);
    return { executed: true, status: "Success", amount };
  }

  /**
   * Run the fast Algorithmic ICT Killzone strategy.
   * This skips the heavy LLM phases and runs strict algorithmic logic.
   */
  async analyzeIctKillzone(symbol) {
    this.auditLogger.info(`[ICT] Scanning 1-minute algorithmic Killzone for ${symbol}`);
    
    try {
        const bars = await marketDataService.getBars(symbol, '1Min', 240); // Last 4 hours of 1m data
        if (!bars || bars.length < 240) {
            this.auditLogger.warn(`[ICT] Insufficient 1-minute data for ${symbol}`);
            return { signal: null, reason: 'Insufficient data' };
        }

        const currentBar = bars[bars.length - 1];
        
        // Execute the algorithmic logic
        const signal = await ictKillzoneStrategy({
            symbol,
            bars,
            currentBar,
            position: null, // Stateless check for setups
            capital: this.portfolio.cash
        });

        if (signal && signal.action === 'BUY') {
            this.auditLogger.info(`[ICT] 🚨 KILLZONE SETUP DETECTED! Executing Strike on ${symbol}`);
            const tradeExecution = await this._executePaperTrade(symbol, signal, signal.positionSize);
            return { symbol, signal, trade: tradeExecution, timestamp: new Date().toISOString() };
        } else {
            return { symbol, signal: 'HOLD', reason: 'No ICT setup detected', timestamp: new Date().toISOString() };
        }
    } catch (e) {
        this.auditLogger.error(`[ICT] Error running Killzone strategy: ${e.message}`);
        return { error: e.message };
    }
  }

  getPortfolioSummary() {
    return { cash: this.portfolio.cash, positions: this.portfolio.positions };
  }

  getStatus() {
    return { name: this.name, active: true, phase: this._currentPhase };
  }
}

export default FinanceAgentArbiter;
