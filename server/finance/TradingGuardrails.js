/**
 * TradingGuardrails - Safety System for Automated Trading
 *
 * Prevents catastrophic losses through multiple safety layers:
 * - Position sizing limits
 * - Daily loss limits
 * - Confidence thresholds
 * - Cooldown periods
 * - Market hours checking
 */

class TradingGuardrails {
  constructor(config = {}) {
    // Configuration with sensible defaults
    this.config = {
      maxTradeValue: config.maxTradeValue || 1000,        // Max $1000 per trade
      maxDailyLoss: config.maxDailyLoss || 500,           // Stop if lose $500 in a day
      maxDailyTrades: config.maxDailyTrades || 10,        // Max 10 trades per day
      minConfidence: config.minConfidence || 0.75,        // Only trade if 75%+ confidence
      cooldownMs: config.cooldownMs || 300000,            // 5 min between trades
      maxPositionSize: config.maxPositionSize || 0.20,    // Max 20% of portfolio per position
      requireMarketHours: config.requireMarketHours !== undefined ? config.requireMarketHours : true
    };
    this.activeTier = config.promotionTier || 'paper';

    // State tracking
    this.dailyLoss = 0;
    this.dailyTradeCount = 0;
    this.lastTradeTime = 0;
    this.dailyResetTime = this.getNextMidnight();
    this.blockedUntil = 0;

    // Trade history for analysis
    this.tradeHistory = [];

    console.log('[Guardrails] Initialized with config:', this.config);
  }

  /**
   * Validate if a trade should be allowed
   */
  validateTrade(order, analysis, accountInfo) {
    const now = Date.now();

    // Reset daily counters at midnight
    if (now > this.dailyResetTime) {
      this._resetDailyCounters();
    }

    const checks = [];

    // 1. Check if trading is blocked
    if (now < this.blockedUntil) {
      const remainingMin = Math.ceil((this.blockedUntil - now) / 60000);
      return {
        allowed: false,
        reason: `Trading blocked for ${remainingMin} more minutes due to safety trigger`,
        checks
      };
    }

    // 2. Confidence threshold
    const confidenceCheck = this._checkConfidence(analysis);
    checks.push(confidenceCheck);
    if (!confidenceCheck.passed) {
      return { allowed: false, reason: confidenceCheck.message, checks };
    }

    // 3. Trade size limit
    const tradeSizeCheck = this._checkTradeSize(order);
    checks.push(tradeSizeCheck);
    if (!tradeSizeCheck.passed) {
      return { allowed: false, reason: tradeSizeCheck.message, checks };
    }

    // 4. Daily loss limit
    const dailyLossCheck = this._checkDailyLoss();
    checks.push(dailyLossCheck);
    if (!dailyLossCheck.passed) {
      return { allowed: false, reason: dailyLossCheck.message, checks };
    }

    // 5. Daily trade count limit
    const dailyTradesCheck = this._checkDailyTrades();
    checks.push(dailyTradesCheck);
    if (!dailyTradesCheck.passed) {
      return { allowed: false, reason: dailyTradesCheck.message, checks };
    }

    // 6. Cooldown period
    const cooldownCheck = this._checkCooldown(now);
    checks.push(cooldownCheck);
    if (!cooldownCheck.passed) {
      return { allowed: false, reason: cooldownCheck.message, checks };
    }

    // 7. Position size limit
    if (accountInfo) {
      const positionSizeCheck = this._checkPositionSize(order, accountInfo);
      checks.push(positionSizeCheck);
      if (!positionSizeCheck.passed) {
        return { allowed: false, reason: positionSizeCheck.message, checks };
      }
    }

    // 8. Market hours check
    if (this.config.requireMarketHours) {
      const marketHoursCheck = this._checkMarketHours();
      checks.push(marketHoursCheck);
      if (!marketHoursCheck.passed) {
        return { allowed: false, reason: marketHoursCheck.message, checks };
      }
    }

    // All checks passed
    this.lastTradeTime = now;
    this.dailyTradeCount++;

    return {
      allowed: true,
      reason: 'All safety checks passed',
      checks
    };
  }

  /**
   * Record trade result for tracking
   */
  recordTrade(order, result) {
    const trade = {
      timestamp: Date.now(),
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      price: result.filled_avg_price,
      value: order.qty * (result.filled_avg_price || 0),
      success: result.status === 'filled'
    };

    this.tradeHistory.push(trade);

    // Keep only last 100 trades
    if (this.tradeHistory.length > 100) {
      this.tradeHistory.shift();
    }
  }

  /**
   * Record a loss and check if we should block trading
   */
  recordLoss(amount) {
    this.dailyLoss += Math.abs(amount);

    console.log(`[Guardrails] Daily loss updated: $${this.dailyLoss.toFixed(2)}`);

    // Emergency stop if loss exceeds 150% of limit
    if (this.dailyLoss > this.config.maxDailyLoss * 1.5) {
      this._emergencyStop('Excessive losses detected');
    }
  }

  /**
   * Emergency stop trading
   */
  _emergencyStop(reason) {
    this.blockedUntil = Date.now() + (24 * 60 * 60 * 1000); // Block for 24 hours
    console.error(`[Guardrails] 🚨 EMERGENCY STOP: ${reason}`);
    console.error(`[Guardrails] Trading blocked for 24 hours`);
  }

  /**
   * Individual check methods
   */
  _checkConfidence(analysis) {
    const confidence = analysis?.strategy?.confidence || 0;
    const passed = confidence >= this.config.minConfidence;

    return {
      name: 'Confidence Threshold',
      passed,
      message: passed
        ? `Confidence ${(confidence * 100).toFixed(0)}% ≥ ${(this.config.minConfidence * 100).toFixed(0)}%`
        : `Confidence too low: ${(confidence * 100).toFixed(0)}% < ${(this.config.minConfidence * 100).toFixed(0)}%`,
      value: confidence,
      threshold: this.config.minConfidence
    };
  }

  _checkTradeSize(order) {
    const value = order.value || (order.qty * order.estimatedPrice);
    const passed = value <= this.config.maxTradeValue;

    return {
      name: 'Trade Size Limit',
      passed,
      message: passed
        ? `Trade value $${value.toFixed(2)} ≤ $${this.config.maxTradeValue}`
        : `Trade value $${value.toFixed(2)} exceeds limit of $${this.config.maxTradeValue}`,
      value,
      threshold: this.config.maxTradeValue
    };
  }

  _checkDailyLoss() {
    const passed = this.dailyLoss < this.config.maxDailyLoss;

    return {
      name: 'Daily Loss Limit',
      passed,
      message: passed
        ? `Daily loss $${this.dailyLoss.toFixed(2)} < $${this.config.maxDailyLoss}`
        : `Daily loss limit reached: $${this.dailyLoss.toFixed(2)} ≥ $${this.config.maxDailyLoss}`,
      value: this.dailyLoss,
      threshold: this.config.maxDailyLoss
    };
  }

  _checkDailyTrades() {
    const passed = this.dailyTradeCount < this.config.maxDailyTrades;

    return {
      name: 'Daily Trade Count',
      passed,
      message: passed
        ? `${this.dailyTradeCount} / ${this.config.maxDailyTrades} trades today`
        : `Daily trade limit reached: ${this.dailyTradeCount} ≥ ${this.config.maxDailyTrades}`,
      value: this.dailyTradeCount,
      threshold: this.config.maxDailyTrades
    };
  }

  _checkCooldown(now) {
    const timeSinceLastTrade = now - this.lastTradeTime;
    const passed = timeSinceLastTrade >= this.config.cooldownMs;

    return {
      name: 'Cooldown Period',
      passed,
      message: passed
        ? 'Cooldown period satisfied'
        : `Cooldown active: ${Math.ceil((this.config.cooldownMs - timeSinceLastTrade) / 1000)}s remaining`,
      value: timeSinceLastTrade,
      threshold: this.config.cooldownMs
    };
  }

  _checkPositionSize(order, accountInfo) {
    const portfolioValue = accountInfo.portfolio_value;
    const positionValue = order.value || (order.qty * order.estimatedPrice);
    const positionPercent = positionValue / portfolioValue;
    const passed = positionPercent <= this.config.maxPositionSize;

    return {
      name: 'Position Size Limit',
      passed,
      message: passed
        ? `Position ${(positionPercent * 100).toFixed(1)}% ≤ ${(this.config.maxPositionSize * 100).toFixed(0)}% of portfolio`
        : `Position ${(positionPercent * 100).toFixed(1)}% exceeds ${(this.config.maxPositionSize * 100).toFixed(0)}% limit`,
      value: positionPercent,
      threshold: this.config.maxPositionSize
    };
  }

  _checkMarketHours() {
    const isOpen = this.isMarketOpen();

    return {
      name: 'Market Hours',
      passed: isOpen,
      message: isOpen ? 'Market is open' : 'Market is closed (9:30 AM - 4:00 PM ET, Mon-Fri)',
      value: isOpen
    };
  }

  /**
   * Check if US stock market is currently open
   */
  isMarketOpen() {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const hour = et.getHours();
    const minute = et.getMinutes();
    const day = et.getDay();

    // Weekend
    if (day === 0 || day === 6) return false;

    // Market hours: 9:30 AM - 4:00 PM ET
    if (hour < 9 || hour >= 16) return false;
    if (hour === 9 && minute < 30) return false;

    return true;
  }

  /**
   * Reset daily counters
   */
  _resetDailyCounters() {
    console.log('[Guardrails] Resetting daily counters');
    this.dailyLoss = 0;
    this.dailyTradeCount = 0;
    this.dailyResetTime = this.getNextMidnight();
  }

  /**
   * Get next midnight timestamp
   */
  getNextMidnight() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      config: this.config,
      activeTier: this.activeTier,
      dailyLoss: this.dailyLoss,
      dailyTradeCount: this.dailyTradeCount,
      marketOpen: this.isMarketOpen(),
      tradingBlocked: Date.now() < this.blockedUntil,
      blockedUntil: this.blockedUntil > 0 ? new Date(this.blockedUntil).toISOString() : null,
      recentTrades: this.tradeHistory.slice(-10)
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.promotionTier) this.activeTier = newConfig.promotionTier;
    console.log('[Guardrails] Configuration updated:', this.config);
  }

  applyTierProfile(profile = {}) {
    this.updateConfig(profile);
    this.activeTier = profile.promotionTier || this.activeTier;
    return this.getStatus();
  }
}

export default TradingGuardrails;
