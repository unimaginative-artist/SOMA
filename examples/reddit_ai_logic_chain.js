/**
 * Reddit Sentiment → AI Prediction Logic Chain Example
 *
 * Shows how Reddit signals integrate into SOMA's prediction system
 */

import { RedditSignalDetector } from '../arbiters/RedditSignalDetector.js';

// Example: Reddit posts about BTC
const redditPosts = [
    {
        title: "BIG PUSH COMING FOR BTC 🚀🚀🚀",
        body: "Loading up on calls. Massive rally incoming. Broke through resistance at $50k with huge volume. Technical setup is perfect. To the moon! 💎",
        author: "crypto_bull",
        subreddit: "cryptocurrency",
        upvotes: 1250,
        comments: 340,
        url: "https://reddit.com/r/cryptocurrency/..."
    },
    {
        title: "BTC Halving in 2028 - Historically Bullish",
        body: "Long DD post about Bitcoin halving historically leading to bull runs. Previous halvings: 2012 (+9000%), 2016 (+2800%), 2020 (+700%). Pattern suggests next halving will be bullish.",
        author: "btc_researcher",
        subreddit: "bitcoin",
        upvotes: 890,
        comments: 156,
        url: "https://reddit.com/r/bitcoin/..."
    },
    {
        title: "Everyone's bearish on BTC right now",
        body: "Classic contrarian signal. When sentiment is this bearish, usually means bottom is in. Time to accumulate.",
        author: "contrarian_trader",
        subreddit: "satoshistreetbets",
        upvotes: 450,
        comments: 89,
        url: "https://reddit.com/r/satoshistreetbets/..."
    }
];

// Initialize detector
const detector = new RedditSignalDetector();

console.log('═'.repeat(70));
console.log('              REDDIT SENTIMENT → AI LOGIC CHAIN');
console.log('═'.repeat(70));

// Step 1: Analyze individual posts
console.log('\n[STEP 1] Analyzing Individual Posts:\n');

redditPosts.forEach((post, i) => {
    const signal = detector.analyzePost(post);

    console.log(`Post ${i + 1}: "${post.title}"`);
    console.log(`  Type: ${signal.type}`);
    console.log(`  Strength: ${(signal.strength * 100).toFixed(0)}%`);
    console.log(`  Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
    console.log(`  Patterns: ${signal.patterns.length}`);
    if (signal.reasons.length > 0) {
        console.log(`  Reasons:`);
        signal.reasons.forEach(r => console.log(`    - ${r}`));
    }
    console.log();
});

// Step 2: Aggregate signals for BTC
console.log('\n[STEP 2] Aggregating Signals for BTC-USD:\n');

const aggregated = detector.aggregateSignals(redditPosts, 'BTC-USD');

console.log(`Overall Signal: ${aggregated.type}`);
console.log(`Strength: ${(aggregated.strength * 100).toFixed(1)}%`);
console.log(`Confidence: ${(aggregated.confidence * 100).toFixed(1)}%`);
console.log(`Signal Count: ${aggregated.signalCount} posts`);
console.log(`Viral: ${aggregated.viral ? 'YES 🔥' : 'No'}`);
console.log(`\nSummary: ${aggregated.summary}`);

// Step 3: Convert to prediction adjustment
console.log('\n[STEP 3] Converting to AI Prediction Adjustment:\n');

const adjustment = detector.toPredictionAdjustment(aggregated);

console.log(`Confidence Adjustment: ${adjustment.confidenceAdjustment > 0 ? '+' : ''}${(adjustment.confidenceAdjustment * 100).toFixed(1)}%`);
console.log(`Direction Bias: ${adjustment.directionBias > 0 ? 'BULLISH' : adjustment.directionBias < 0 ? 'BEARISH' : 'NEUTRAL'} (${(adjustment.directionBias * 100).toFixed(1)}%)`);
console.log(`Volatility Multiplier: ${adjustment.volatilityMultiplier.toFixed(2)}x`);
console.log(`\nReasoning: ${adjustment.reasoning}`);

// Step 4: Apply to trading decision
console.log('\n[STEP 4] Applying to Trading Decision:\n');

// Simulate base analysis
const baseAnalysis = {
    symbol: 'BTC-USD',
    baseConfidence: 0.65,  // 65% base confidence from technical analysis
    direction: 'BUY',
    positionSize: 1000,
    reasoning: 'Technical breakout above $50k resistance'
};

// Apply Reddit adjustment
const finalConfidence = Math.min(
    baseAnalysis.baseConfidence + adjustment.confidenceAdjustment,
    1.0
);

const finalPositionSize = baseAnalysis.positionSize * adjustment.volatilityMultiplier;

console.log(`BASE Analysis:`);
console.log(`  Confidence: ${(baseAnalysis.baseConfidence * 100).toFixed(1)}%`);
console.log(`  Direction: ${baseAnalysis.direction}`);
console.log(`  Position Size: $${baseAnalysis.positionSize}`);
console.log(`  Reasoning: ${baseAnalysis.reasoning}`);

console.log(`\n🧠 REDDIT ADJUSTMENT:`);
console.log(`  Confidence: ${(baseAnalysis.baseConfidence * 100).toFixed(1)}% → ${(finalConfidence * 100).toFixed(1)}%`);
console.log(`  Position Size: $${baseAnalysis.positionSize} → $${finalPositionSize.toFixed(0)}`);
console.log(`  Additional Factor: ${adjustment.reasoning}`);

console.log(`\n✅ FINAL DECISION:`);
console.log(`  Symbol: ${baseAnalysis.symbol}`);
console.log(`  Action: ${baseAnalysis.direction}`);
console.log(`  Confidence: ${(finalConfidence * 100).toFixed(1)}%`);
console.log(`  Position Size: $${finalPositionSize.toFixed(0)}`);
console.log(`  Combined Reasoning:`);
console.log(`    1. ${baseAnalysis.reasoning}`);
console.log(`    2. ${adjustment.reasoning}`);

// Step 5: Logic chain visualization
console.log('\n[STEP 5] Complete Logic Chain:\n');

console.log(`
┌─────────────────────────────────────────────────────────────┐
│                    INPUT: Reddit Posts                       │
│  - "BIG PUSH COMING FOR BTC 🚀🚀🚀" (1250 upvotes)          │
│  - "BTC Halving - Historically Bullish" (890 upvotes)       │
│  - "Everyone's bearish" (contrarian, 450 upvotes)           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              PATTERN DETECTION (AI Analysis)                 │
│  ✅ Bullish Pattern: "big push coming"                      │
│  ✅ Rocket Emojis: 3x 🚀 (bullish)                          │
│  ✅ High Engagement: 1250 upvotes, 340 comments             │
│  ✅ Contrarian Signal: "everyone's bearish"                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  SIGNAL AGGREGATION                          │
│  Type: ${aggregated.type.padEnd(49)} │
│  Strength: ${((aggregated.strength * 100).toFixed(1) + '%').padEnd(45)} │
│  Confidence: ${((aggregated.confidence * 100).toFixed(1) + '%').padEnd(43)} │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              PREDICTION ADJUSTMENT (AI Logic)                │
│  Base Confidence: 65%                                        │
│  Reddit Boost: ${adjustment.confidenceAdjustment > 0 ? '+' : ''}${(adjustment.confidenceAdjustment * 100).toFixed(1)}%                                         │
│  Final Confidence: ${(finalConfidence * 100).toFixed(1)}%                                        │
│                                                              │
│  Base Position: $1000                                        │
│  Volatility Adj: ${adjustment.volatilityMultiplier.toFixed(2)}x                                           │
│  Final Position: $${finalPositionSize.toFixed(0).padEnd(45)} │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     TRADING DECISION                         │
│  ✅ ${baseAnalysis.direction} ${baseAnalysis.symbol.padEnd(48)} │
│  ✅ Confidence: ${(finalConfidence * 100).toFixed(1)}%                                        │
│  ✅ Size: $${finalPositionSize.toFixed(0).padEnd(50)} │
│  ✅ Reasoning: Technical + Reddit Sentiment Aligned         │
└─────────────────────────────────────────────────────────────┘
`);

console.log('═'.repeat(70));
console.log('\n💡 KEY INSIGHT:');
console.log('   Reddit sentiment is NOT the only factor, but it ENHANCES');
console.log('   the existing technical/fundamental analysis.');
console.log('   Base: 65% confidence → With Reddit: 73% confidence');
console.log('   This is how SOMA adapts to social sentiment! 🧠\n');
console.log('═'.repeat(70));
