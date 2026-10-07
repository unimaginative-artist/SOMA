/**
 * Reddit Signal Detector - Production Grade
 *
 * Detects actionable trading signals from Reddit sentiment:
 * - "Big push coming for BTC" → Bullish signal
 * - "GME short squeeze incoming" → High volatility play
 * - "Everyone's bearish on TSLA" → Contrarian signal
 *
 * This feeds into AI prediction logic as a factor.
 */

export class RedditSignalDetector {
    constructor() {
        // Signal patterns (regex + keywords)
        this.bullishPatterns = [
            /big\s+(push|move|pump|rally|run)\s+(coming|incoming|soon)/i,
            /to\s+the\s+moon/i,
            /massive\s+(rally|pump|breakout)/i,
            /loading\s+(up|calls|shares)/i,
            /huge\s+(upside|potential|gains)/i,
            /gamma\s+squeeze/i,
            /short\s+squeeze\s+(imminent|incoming|coming)/i,
            /about\s+to\s+(explode|moon|rip)/i
        ];

        this.bearishPatterns = [
            /(dump|crash|collapse)\s+(incoming|coming|soon)/i,
            /puts\s+(printing|loaded)/i,
            /(bearish|dumping)\s+hard/i,
            /everyone('s|s)?\s+(bullish|buying)/i, // Contrarian
            /top\s+is\s+in/i,
            /bubble\s+(popping|burst)/i,
            /rug\s+pull/i
        ];

        this.volatilityPatterns = [
            /earnings\s+(play|yolo)/i,
            /all\s+in/i,
            /yolo/i,
            /degenerate\s+play/i,
            /0dte/i,  // Zero days to expiration options
            /high\s+risk/i
        ];

        // Emoji sentiment
        this.bullishEmojis = ['🚀', '💎', '🌙', '📈', '💪', '🔥', '🐂'];
        this.bearishEmojis = ['🐻', '📉', '💀', '🔻', '⚠️'];
    }

    /**
     * Analyze Reddit posts for trading signals
     */
    analyzePost(post) {
        const text = `${post.title} ${post.body || ''}`;
        const signal = {
            type: 'NEUTRAL',
            strength: 0,  // -1 to +1
            confidence: 0, // 0 to 1
            reasons: [],
            patterns: []
        };

        // Check bullish patterns
        let bullishMatches = 0;
        for (const pattern of this.bullishPatterns) {
            if (pattern.test(text)) {
                bullishMatches++;
                signal.patterns.push(`Bullish: ${pattern.source}`);
            }
        }

        // Check bearish patterns
        let bearishMatches = 0;
        for (const pattern of this.bearishPatterns) {
            if (pattern.test(text)) {
                bearishMatches++;
                signal.patterns.push(`Bearish: ${pattern.source}`);
            }
        }

        // Check volatility patterns
        let volatilityMatches = 0;
        for (const pattern of this.volatilityPatterns) {
            if (pattern.test(text)) {
                volatilityMatches++;
                signal.patterns.push(`High volatility: ${pattern.source}`);
            }
        }

        // Count emojis
        const bullishEmojiCount = this.countEmojis(text, this.bullishEmojis);
        const bearishEmojiCount = this.countEmojis(text, this.bearishEmojis);

        // Calculate signal
        const netSentiment = bullishMatches - bearishMatches;

        if (netSentiment > 0) {
            signal.type = 'BULLISH';
            signal.strength = Math.min(netSentiment / 3, 1); // Normalize to 0-1
            signal.reasons.push(`${bullishMatches} bullish patterns detected`);
        } else if (netSentiment < 0) {
            signal.type = 'BEARISH';
            signal.strength = Math.max(netSentiment / 3, -1);
            signal.reasons.push(`${bearishMatches} bearish patterns detected`);
        }

        // Emoji boost
        if (bullishEmojiCount > 3) {
            signal.strength = Math.min(signal.strength + 0.2, 1);
            signal.reasons.push(`${bullishEmojiCount} 🚀 emojis (bullish)`);
        }

        if (bearishEmojiCount > 3) {
            signal.strength = Math.max(signal.strength - 0.2, -1);
            signal.reasons.push(`${bearishEmojiCount} 🐻 emojis (bearish)`);
        }

        // Volatility flag
        if (volatilityMatches > 0) {
            signal.volatility = 'HIGH';
            signal.reasons.push('High volatility indicators (YOLO, earnings play, etc.)');
        }

        // Confidence based on upvotes and engagement
        signal.confidence = this.calculateConfidence(post, signal);

        // Add post metadata
        signal.post = {
            title: post.title,
            author: post.author,
            subreddit: post.subreddit,
            upvotes: post.upvotes,
            comments: post.comments,
            url: post.url
        };

        return signal;
    }

    /**
     * Analyze multiple posts and aggregate signal
     */
    aggregateSignals(posts, symbol) {
        const signals = posts
            .filter(p => this.mentionsSymbol(p, symbol))
            .map(p => this.analyzePost(p));

        if (signals.length === 0) {
            return {
                type: 'NO_SIGNAL',
                strength: 0,
                confidence: 0,
                reason: 'No relevant posts found'
            };
        }

        // Weighted average by confidence
        let totalStrength = 0;
        let totalWeight = 0;

        for (const signal of signals) {
            const weight = signal.confidence;
            totalStrength += signal.strength * weight;
            totalWeight += weight;
        }

        const avgStrength = totalWeight > 0 ? totalStrength / totalWeight : 0;

        // Determine type
        let type = 'NEUTRAL';
        if (avgStrength > 0.3) type = 'BULLISH';
        else if (avgStrength > 0.6) type = 'STRONG_BULLISH';
        else if (avgStrength < -0.3) type = 'BEARISH';
        else if (avgStrength < -0.6) type = 'STRONG_BEARISH';

        // Check for mention spike (viral)
        const isViral = signals.length > 10 && signals.some(s => s.post.upvotes > 500);

        return {
            type,
            strength: avgStrength,
            confidence: totalWeight / signals.length,
            signalCount: signals.length,
            topSignals: signals
                .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
                .slice(0, 3),
            viral: isViral,
            summary: this.generateSummary(type, avgStrength, signals, isViral)
        };
    }

    /**
     * Check if post mentions symbol
     */
    mentionsSymbol(post, symbol) {
        const text = `${post.title} ${post.body || ''}`.toUpperCase();

        // Direct symbol mention
        if (text.includes(symbol.toUpperCase())) return true;

        // Common variations
        const variations = this.getSymbolVariations(symbol);
        return variations.some(v => text.includes(v.toUpperCase()));
    }

    /**
     * Get symbol variations (e.g., BTC-USD → BTC, BITCOIN)
     */
    getSymbolVariations(symbol) {
        const variations = [symbol];

        // Crypto variations
        if (symbol.includes('BTC')) variations.push('BITCOIN', 'BTC');
        if (symbol.includes('ETH')) variations.push('ETHEREUM', 'ETH');
        if (symbol.includes('SOL')) variations.push('SOLANA', 'SOL');

        // Stock ticker with $
        if (symbol.match(/^[A-Z]{1,5}$/)) {
            variations.push(`$${symbol}`);
        }

        return variations;
    }

    /**
     * Count emojis in text
     */
    countEmojis(text, emojiList) {
        let count = 0;
        for (const emoji of emojiList) {
            const matches = text.match(new RegExp(emoji, 'g'));
            if (matches) count += matches.length;
        }
        return count;
    }

    /**
     * Calculate confidence based on post quality
     */
    calculateConfidence(post, signal) {
        let confidence = 0.5; // Base confidence

        // High upvotes = higher confidence
        if (post.upvotes > 1000) confidence += 0.3;
        else if (post.upvotes > 500) confidence += 0.2;
        else if (post.upvotes > 100) confidence += 0.1;

        // High engagement (comments) = higher confidence
        if (post.comments > 200) confidence += 0.1;
        else if (post.comments > 50) confidence += 0.05;

        // Long posts = more analysis (higher confidence)
        const textLength = (post.title + (post.body || '')).length;
        if (textLength > 1000) confidence += 0.1; // DD (Due Diligence)

        // Multiple pattern matches = higher confidence
        if (signal.patterns.length > 2) confidence += 0.1;

        // Quality subreddit boost
        const qualitySubreddits = ['stocks', 'investing', 'options'];
        if (qualitySubreddits.includes(post.subreddit.toLowerCase())) {
            confidence += 0.1;
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * Generate human-readable summary
     */
    generateSummary(type, strength, signals, isViral) {
        const signalCount = signals.length;
        const avgUpvotes = signals.reduce((sum, s) => sum + s.post.upvotes, 0) / signalCount;

        let summary = `${type} signal from ${signalCount} Reddit posts (avg ${avgUpvotes.toFixed(0)} upvotes). `;

        if (isViral) {
            summary += '🔥 VIRAL ALERT: High post volume + engagement. ';
        }

        // Top reasons
        const topReasons = signals
            .flatMap(s => s.reasons)
            .slice(0, 3);

        if (topReasons.length > 0) {
            summary += `Key indicators: ${topReasons.join(', ')}. `;
        }

        return summary;
    }

    /**
     * Convert signal to prediction adjustment
     * This integrates into AI logic
     */
    toPredictionAdjustment(signal) {
        if (signal.type === 'NO_SIGNAL') {
            return {
                confidenceAdjustment: 0,
                directionBias: 0,
                volatilityMultiplier: 1.0,
                reasoning: 'No Reddit signal'
            };
        }

        // Confidence adjustment (-20% to +20% based on signal strength and confidence)
        const confidenceAdjustment = signal.strength * signal.confidence * 0.2;

        // Direction bias (-1 = bearish, +1 = bullish)
        const directionBias = signal.strength;

        // Volatility multiplier (higher if YOLO/viral)
        let volatilityMultiplier = 1.0;
        if (signal.viral) volatilityMultiplier = 1.5;
        if (signal.topSignals.some(s => s.volatility === 'HIGH')) volatilityMultiplier = 1.3;

        return {
            confidenceAdjustment,
            directionBias,
            volatilityMultiplier,
            reasoning: signal.summary,
            raw: signal
        };
    }
}
