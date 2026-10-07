/**
 * Advanced Trading System Example
 *
 * This example shows how to use all 7 systems together
 * to create a complete trading workflow.
 */

import { TradeLearningEngine } from '../arbiters/TradeLearningEngine.js';
import { MultiTimeframeAnalyzer } from '../arbiters/MultiTimeframeAnalyzer.js';
import { AdaptivePositionSizer } from '../arbiters/AdaptivePositionSizer.js';
import { MarketRegimeDetector } from '../arbiters/MarketRegimeDetector.js';
import { BacktestEngine } from '../arbiters/BacktestEngine.js';
import { RiskManager } from '../arbiters/RiskManager.js';
import { PerformanceAnalytics } from '../arbiters/PerformanceAnalytics.js';

/**
 * Example 1: Complete Analysis Pipeline
 */
export async function completeAnalysisPipeline(symbol) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`COMPLETE ANALYSIS: ${symbol}`);
    console.log('='.repeat(60));

    // Initialize systems
    const regimeDetector = new MarketRegimeDetector();
    const mtfAnalyzer = new MultiTimeframeAnalyzer();
    const learningEngine = new TradeLearningEngine({
        quadBrain: global.SOMA?.quadBrain,
        mnemonic: global.SOMA?.mnemonic,
        rootPath: process.cwd()
    });
    const positionSizer = new AdaptivePositionSizer({
        basePositionSize: 1000,
        maxPositionSize: 5000,
        minPositionSize: 100
    });

    await learningEngine.initialize();

    // STEP 1: Detect market regime
    console.log('\n[STEP 1] Detecting market regime...');
    const regime = await regimeDetector.detectRegime(symbol);

    console.log(`\nMarket Regime: ${regime.type}`);
    console.log(`Confidence: ${(regime.confidence * 100).toFixed(0)}%`);
    console.log(`Recommended Strategies:`);
    regime.strategies.forEach(s => console.log(`  - ${s}`));

    if (regime.warnings.length > 0) {
        console.log(`Warnings:`);
        regime.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
    }

    // STEP 2: Multi-timeframe analysis
    console.log('\n[STEP 2] Multi-timeframe analysis...');
    const mtfAnalysis = await mtfAnalyzer.analyzeSymbol(symbol);

    console.log(`\nTimeframe Alignment: ${mtfAnalysis.synthesis.alignment}`);
    console.log(`Confidence: ${(mtfAnalysis.synthesis.confidence * 100).toFixed(0)}%`);
    console.log(`\nTimeframe Breakdown:`);
    mtfAnalysis.synthesis.timeframeResults.forEach(({ tf, signal, trend }) => {
        console.log(`  ${tf}: ${signal} (${trend})`);
    });

    // STEP 3: Check historical performance
    console.log('\n[STEP 3] Checking trade history...');
    const historicalInsights = await learningEngine.getStrategyInsights(
        symbol,
        'Momentum breakout strategy' // Example thesis
    );

    console.log(`\nHistorical Performance:`);
    console.log(`  Sample Size: ${historicalInsights.sampleSize || 0} trades`);
    console.log(`  Win Rate: ${((historicalInsights.confidence || 0.5) * 100).toFixed(1)}%`);
    console.log(`  Insights: ${historicalInsights.insights}`);

    if (historicalInsights.adjustments && historicalInsights.adjustments.length > 0) {
        console.log(`  Recommended Adjustments:`);
        historicalInsights.adjustments.forEach(adj => {
            console.log(`    - ${adj.type}: ${adj.recommendation}`);
        });
    }

    // STEP 4: Calculate position size
    console.log('\n[STEP 4] Calculating position size...');

    // Combine all confidence signals
    const combinedConfidence = (
        regime.confidence * 0.3 +
        parseFloat(mtfAnalysis.synthesis.confidence) * 0.3 +
        (historicalInsights.confidence || 0.5) * 0.4
    );

    const accountBalance = 100000; // $100k account

    const positionSizing = positionSizer.calculatePositionSize({
        confidence: combinedConfidence,
        historicalWinRate: historicalInsights.confidence || 0.5,
        volatility: parseFloat(mtfAnalysis.timeframes['1H']?.volatility || 50) / 100,
        riskScore: 30 // Example risk score from agents
    }, accountBalance);

    console.log(`\n✅ Recommended Position Size: $${positionSizing.positionSize}`);
    console.log(`\nReasoning:\n${positionSizing.reasoning}`);

    // STEP 5: Risk check
    console.log('\n[STEP 5] Risk management check...');

    const riskSystem = new RiskManager({
        rootPath: process.cwd()
    });

    // Update risk limits
    riskSystem.updateLimits({
        maxPositionSize: 5000 / accountBalance, // Convert to percentage
        maxDailyLoss: 0.05,
        maxDrawdown: 0.15,
        maxConcentration: 0.25
    });

    const trade = {
        symbol,
        side: 'buy',
        size: positionSizing.positionSize / 100, // Convert to shares (example price $100)
        price: 100, // Example current price
        sector: 'Technology', // Example
        volatility: parseFloat(mtfAnalysis.timeframes['1H']?.volatility || 50) / 100
    };

    // Update RiskManager portfolio state
    riskSystem.updatePortfolio({
        totalValue: accountBalance,
        cash: accountBalance * 0.5,
        positions: new Map(), // Empty for first trade
        unrealizedPnL: 0,
        realizedPnL: 0,
        dailyPnL: 0
    });

    const riskEval = await riskSystem.validateTrade(trade);

    console.log(`\nRisk Evaluation: ${riskEval.approved ? '✅ APPROVED' : '❌ REJECTED'}`);
    console.log(`Reason: ${riskEval.reason}`);

    if (riskEval.checks) {
        console.log(`\nDetailed Checks:`);
        riskEval.checks.forEach(check => {
            const icon = check.passed ? '✅' : '❌';
            console.log(`  ${icon} ${check.reason}`);
        });
    }

    // STEP 6: Final decision
    console.log(`\n${'='.repeat(60)}`);
    console.log('FINAL DECISION');
    console.log('='.repeat(60));

    const shouldTrade = riskEval.approved &&
                       regime.type !== 'TRENDING_BEAR' &&
                       combinedConfidence > 0.6;

    if (shouldTrade) {
        console.log(`\n✅ EXECUTE TRADE:`);
        console.log(`  Symbol: ${symbol}`);
        console.log(`  Side: BUY`);
        console.log(`  Size: $${positionSizing.positionSize}`);
        console.log(`  Regime: ${regime.type}`);
        console.log(`  MTF Alignment: ${mtfAnalysis.synthesis.alignment}`);
        console.log(`  Combined Confidence: ${(combinedConfidence * 100).toFixed(0)}%`);
    } else {
        console.log(`\n❌ DO NOT TRADE`);
        if (!riskEval.approved) {
            console.log(`  Reason: Risk check failed - ${riskEval.reason}`);
        } else if (regime.type === 'TRENDING_BEAR') {
            console.log(`  Reason: Bearish market regime`);
        } else {
            console.log(`  Reason: Insufficient confidence (${(combinedConfidence * 100).toFixed(0)}%)`);
        }
    }

    console.log('='.repeat(60));

    return {
        regime,
        mtfAnalysis,
        historicalInsights,
        positionSizing,
        riskEval,
        shouldTrade,
        combinedConfidence
    };
}

/**
 * Example 2: Backtest a Strategy
 */
export async function backtestExample(symbol) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`BACKTEST: ${symbol}`);
    console.log('='.repeat(60));

    const backtestEngine = new BacktestEngine({
        quadBrain: global.SOMA?.quadBrain,
        mtfAnalyzer: new MultiTimeframeAnalyzer(),
        positionSizer: new AdaptivePositionSizer(),
        regimeDetector: new MarketRegimeDetector(),
        rootPath: process.cwd()
    });

    await backtestEngine.initialize();

    // Define a simple momentum strategy
    const momentumStrategy = async ({ bars, currentBar, position, capital }) => {
        // Get recent closes
        const closes = bars.slice(-20).map(b => b.close);
        const currentPrice = currentBar.close;

        // Calculate 10-day momentum
        const momentum = ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100;

        // Buy if momentum > 5% and no position
        if (momentum > 5 && !position) {
            return {
                action: 'BUY',
                positionSize: capital * 0.1, // 10% of capital
                stopLoss: currentPrice * 0.97, // 3% stop loss
                takeProfit: currentPrice * 1.10, // 10% take profit
                context: { momentum, strategy: 'momentum_breakout' }
            };
        }

        // Sell if momentum turns negative or have position for >5 days
        if (position && (momentum < -2 || currentBar.timestamp - position.entryDate > 5 * 24 * 60 * 60 * 1000)) {
            return {
                action: 'SELL',
                context: { momentum, strategy: 'momentum_breakout' }
            };
        }

        return null;
    };

    // Run backtest
    const result = await backtestEngine.runBacktest(
        symbol,
        'Momentum Breakout',
        momentumStrategy,
        {
            startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
            endDate: new Date(),
            initialCapital: 100000,
            timeframe: '1D'
        }
    );

    console.log(result.report);

    return result;
}

/**
 * Example 3: Complete Trade Loop with Learning
 */
export async function completeTradeLoop(symbol, entryPrice, exitPrice) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`COMPLETE TRADE LOOP: ${symbol}`);
    console.log('='.repeat(60));

    // Initialize systems
    const learningEngine = new TradeLearningEngine({
        quadBrain: global.SOMA?.quadBrain,
        mnemonic: global.SOMA?.mnemonic,
        rootPath: process.cwd()
    });

    const positionSizer = new AdaptivePositionSizer();
    const analytics = new PerformanceAnalytics({ rootPath: process.cwd() });

    await learningEngine.initialize();
    await analytics.initialize();

    // Create trade record
    const trade = {
        id: `trade_${Date.now()}`,
        symbol,
        side: 'long',
        entryPrice,
        exitPrice,
        quantity: 10, // Example
        pnl: (exitPrice - entryPrice) * 10,
        pnlPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
        timestamp: Date.now(),

        // Context
        thesis: 'Momentum breakout on strong volume',
        sentiment: { score: 0.75, analysis: 'Bullish sentiment' },
        technicals: { rsi: 65, trend: 'UPTREND' },
        riskScore: 30,
        confidence: 0.8,
        timeframe: '1D',
        marketCondition: 'TRENDING_BULL',
        volatility: 0.35,
        strategy: 'momentum_breakout',
        regime: 'TRENDING_BULL'
    };

    console.log(`\nTrade Details:`);
    console.log(`  Entry: $${entryPrice}`);
    console.log(`  Exit: $${exitPrice}`);
    console.log(`  P&L: ${trade.pnl > 0 ? '+' : ''}$${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%)`);

    // Record in learning engine
    console.log(`\n[Learning Engine] Analyzing trade outcome...`);
    await learningEngine.recordTrade(trade);

    // Update position sizer
    console.log(`\n[Position Sizer] Updating state...`);
    positionSizer.updateFromTrade(trade);

    const psStats = positionSizer.getStats();
    console.log(`  Win Streak: ${psStats.consecutiveWins}`);
    console.log(`  Loss Streak: ${psStats.consecutiveLosses}`);
    console.log(`  Drawdown: ${psStats.currentDrawdown}%`);

    // Record in analytics
    console.log(`\n[Analytics] Recording performance...`);
    await analytics.recordTrade(trade);

    // Generate insights
    console.log(`\n[Analytics] Performance Report:`);
    const report = analytics.generateReport();
    console.log(report);

    return {
        trade,
        learningEngine,
        positionSizer,
        analytics
    };
}

/**
 * Example 4: Performance Analytics
 */
export async function analyticsExample() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PERFORMANCE ANALYTICS EXAMPLE`);
    console.log('='.repeat(60));

    const analytics = new PerformanceAnalytics({ rootPath: process.cwd() });
    await analytics.initialize();

    // Simulate some trades
    const mockTrades = [
        { symbol: 'BTC-USD', pnl: 150, pnlPercent: 5.2, strategy: 'momentum', regime: 'TRENDING_BULL', timestamp: Date.now() - 10000 },
        { symbol: 'ETH-USD', pnl: -80, pnlPercent: -2.1, strategy: 'momentum', regime: 'TRENDING_BULL', timestamp: Date.now() - 9000 },
        { symbol: 'AAPL', pnl: 220, pnlPercent: 8.5, strategy: 'breakout', regime: 'RANGING', timestamp: Date.now() - 8000 },
        { symbol: 'TSLA', pnl: 180, pnlPercent: 6.2, strategy: 'momentum', regime: 'TRENDING_BULL', timestamp: Date.now() - 7000 },
        { symbol: 'MSFT', pnl: -50, pnlPercent: -1.5, strategy: 'breakout', regime: 'VOLATILE', timestamp: Date.now() - 6000 }
    ];

    for (const trade of mockTrades) {
        await analytics.recordTrade(trade);
    }

    // Generate report
    const report = analytics.generateReport();
    console.log(report);

    // Get equity curve
    console.log(`\n${'='.repeat(60)}`);
    console.log(`EQUITY CURVE`);
    console.log('='.repeat(60));

    const equityCurve = analytics.getEquityCurve();
    equityCurve.forEach(point => {
        const date = new Date(point.date).toISOString().split('T')[0];
        const arrow = point.pnl > 0 ? '↑' : '↓';
        console.log(`${date}: $${point.equity.toFixed(2)} ${arrow} (${point.trade})`);
    });

    // Export to CSV
    const csvFile = await analytics.exportToCSV();
    console.log(`\n✅ Exported to: ${csvFile}`);
}

/**
 * Run examples
 */
export async function runAllExamples() {
    try {
        // Example 1: Complete analysis
        await completeAnalysisPipeline('BTC-USD');

        // Example 2: Backtest
        // await backtestExample('BTC-USD');

        // Example 3: Trade loop with learning
        // await completeTradeLoop('BTC-USD', 50000, 52000);

        // Example 4: Analytics
        // await analyticsExample();

    } catch (error) {
        console.error('Error running examples:', error);
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllExamples();
}
