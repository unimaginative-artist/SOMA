/**
 * Portfolio Optimizer - Production Grade
 *
 * Modern Portfolio Theory (Markowitz):
 * - Calculates optimal asset allocation to maximize Sharpe ratio
 * - Builds correlation/covariance matrices
 * - Generates efficient frontier
 * - Implements risk parity allocation
 * - Dynamic rebalancing based on market regime
 *
 * Key Concepts:
 * - Expected Return: E[R] = average historical return
 * - Volatility: σ = standard deviation of returns
 * - Correlation: ρ = how assets move together
 * - Sharpe Ratio: (Return - RiskFreeRate) / Volatility
 * - Efficient Frontier: Best risk/return combinations
 */

import fs from 'fs/promises';
import path from 'path';

export class PortfolioOptimizer {
    constructor({ rootPath }) {
        this.rootPath = rootPath;
        this.dataPath = path.join(rootPath, 'data', 'portfolio');

        // Optimization parameters
        this.riskFreeRate = 0.04; // 4% annual risk-free rate (T-bills)
        this.targetVolatility = 0.15; // 15% annual volatility target
        this.rebalanceThreshold = 0.05; // Rebalance if allocation drifts >5%

        // Constraints
        this.minWeight = 0.02; // Min 2% per position (avoid dust)
        this.maxWeight = 0.30; // Max 30% per position (concentration limit)
        this.maxPositions = 20; // Max 20 positions in portfolio

        // Historical data
        this.priceHistory = new Map(); // symbol -> [prices]
        this.returnHistory = new Map(); // symbol -> [returns]
        this.portfolioHistory = [];
    }

    async initialize() {
        await fs.mkdir(this.dataPath, { recursive: true });
        await this.loadState();
        console.log('[PortfolioOptimizer] ✅ Initialized');
    }

    /**
     * Calculate returns from price series
     */
    calculateReturns(prices) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
            returns.push(ret);
        }
        return returns;
    }

    /**
     * Calculate expected return (mean of historical returns)
     */
    calculateExpectedReturn(returns) {
        if (returns.length === 0) return 0;
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        return mean;
    }

    /**
     * Calculate volatility (standard deviation)
     */
    calculateVolatility(returns) {
        if (returns.length < 2) return 0;

        const mean = this.calculateExpectedReturn(returns);
        const variance = returns.reduce((sum, r) => {
            return sum + Math.pow(r - mean, 2);
        }, 0) / returns.length;

        return Math.sqrt(variance);
    }

    /**
     * Calculate covariance between two return series
     */
    calculateCovariance(returns1, returns2) {
        if (returns1.length !== returns2.length || returns1.length === 0) {
            return 0;
        }

        const mean1 = this.calculateExpectedReturn(returns1);
        const mean2 = this.calculateExpectedReturn(returns2);

        const covariance = returns1.reduce((sum, r1, i) => {
            const r2 = returns2[i];
            return sum + (r1 - mean1) * (r2 - mean2);
        }, 0) / returns1.length;

        return covariance;
    }

    /**
     * Calculate correlation matrix
     */
    calculateCorrelationMatrix(symbols, returnData) {
        const n = symbols.length;
        const correlations = Array(n).fill(0).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    correlations[i][j] = 1.0;
                } else {
                    const returns1 = returnData[symbols[i]];
                    const returns2 = returnData[symbols[j]];

                    const cov = this.calculateCovariance(returns1, returns2);
                    const vol1 = this.calculateVolatility(returns1);
                    const vol2 = this.calculateVolatility(returns2);

                    if (vol1 > 0 && vol2 > 0) {
                        correlations[i][j] = cov / (vol1 * vol2);
                    }
                }
            }
        }

        return correlations;
    }

    /**
     * Calculate covariance matrix
     */
    calculateCovarianceMatrix(symbols, returnData) {
        const n = symbols.length;
        const covariances = Array(n).fill(0).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const returns1 = returnData[symbols[i]];
                const returns2 = returnData[symbols[j]];
                covariances[i][j] = this.calculateCovariance(returns1, returns2);
            }
        }

        return covariances;
    }

    /**
     * Calculate portfolio variance
     * Var(P) = w^T * Cov * w
     */
    calculatePortfolioVariance(weights, covarianceMatrix) {
        const n = weights.length;
        let variance = 0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                variance += weights[i] * weights[j] * covarianceMatrix[i][j];
            }
        }

        return variance;
    }

    /**
     * Calculate portfolio expected return
     * E[R_p] = Σ (w_i * E[R_i])
     */
    calculatePortfolioReturn(weights, expectedReturns) {
        return weights.reduce((sum, w, i) => sum + w * expectedReturns[i], 0);
    }

    /**
     * Calculate portfolio Sharpe ratio
     * Sharpe = (E[R_p] - R_f) / σ_p
     */
    calculateSharpeRatio(portfolioReturn, portfolioVolatility) {
        if (portfolioVolatility === 0) return 0;
        return (portfolioReturn - this.riskFreeRate) / portfolioVolatility;
    }

    /**
     * Equal weight allocation (baseline)
     */
    equalWeightAllocation(symbols) {
        const n = symbols.length;
        const weight = 1.0 / n;

        const allocation = {};
        symbols.forEach(symbol => {
            allocation[symbol] = weight;
        });

        return allocation;
    }

    /**
     * Risk parity allocation
     * Each asset contributes equally to portfolio risk
     */
    riskParityAllocation(symbols, returnData) {
        const volatilities = symbols.map(s => this.calculateVolatility(returnData[s]));

        // Inverse volatility weighting
        const invVols = volatilities.map(v => v > 0 ? 1 / v : 0);
        const sumInvVols = invVols.reduce((sum, iv) => sum + iv, 0);

        const allocation = {};
        symbols.forEach((symbol, i) => {
            allocation[symbol] = sumInvVols > 0 ? invVols[i] / sumInvVols : 0;
        });

        return allocation;
    }

    /**
     * Maximum Sharpe Ratio allocation (simplified)
     *
     * Full implementation would use quadratic programming.
     * This uses a simplified heuristic approach.
     */
    maxSharpeAllocation(symbols, returnData) {
        const expectedReturns = symbols.map(s => this.calculateExpectedReturn(returnData[s]));
        const volatilities = symbols.map(s => this.calculateVolatility(returnData[s]));

        // Calculate Sharpe ratio for each asset
        const sharpeRatios = expectedReturns.map((ret, i) => {
            const vol = volatilities[i];
            return vol > 0 ? (ret - this.riskFreeRate) / vol : 0;
        });

        // Normalize Sharpe ratios to get weights
        // This is a simplified version - not true mean-variance optimization
        const positiveSharpes = sharpeRatios.map(s => Math.max(s, 0));
        const sumSharpes = positiveSharpes.reduce((sum, s) => sum + s, 0);

        const allocation = {};
        symbols.forEach((symbol, i) => {
            let weight = sumSharpes > 0 ? positiveSharpes[i] / sumSharpes : 0;

            // Apply constraints
            weight = Math.max(weight, this.minWeight);
            weight = Math.min(weight, this.maxWeight);

            allocation[symbol] = weight;
        });

        // Normalize to sum to 1.0
        const totalWeight = Object.values(allocation).reduce((sum, w) => sum + w, 0);
        Object.keys(allocation).forEach(symbol => {
            allocation[symbol] = totalWeight > 0 ? allocation[symbol] / totalWeight : 0;
        });

        return allocation;
    }

    /**
     * Minimum variance allocation
     * Finds portfolio with lowest volatility
     */
    minVarianceAllocation(symbols, returnData) {
        const covMatrix = this.calculateCovarianceMatrix(symbols, returnData);
        const n = symbols.length;

        // Simplified: inverse covariance weighting
        // True implementation would solve: min w^T * Cov * w subject to Σw = 1

        // Calculate diagonal variances
        const variances = symbols.map((s, i) => covMatrix[i][i]);
        const invVars = variances.map(v => v > 0 ? 1 / v : 0);
        const sumInvVars = invVars.reduce((sum, iv) => sum + iv, 0);

        const allocation = {};
        symbols.forEach((symbol, i) => {
            allocation[symbol] = sumInvVars > 0 ? invVars[i] / sumInvVars : 0;
        });

        return allocation;
    }

    /**
     * Optimize portfolio using specified method
     */
    optimizePortfolio(symbols, priceData, method = 'max_sharpe') {
        // Calculate returns for all symbols
        const returnData = {};
        symbols.forEach(symbol => {
            const prices = priceData[symbol];
            if (prices && prices.length > 1) {
                returnData[symbol] = this.calculateReturns(prices);
            }
        });

        // Filter symbols with insufficient data
        const validSymbols = symbols.filter(s => {
            return returnData[s] && returnData[s].length >= 30;
        });

        if (validSymbols.length === 0) {
            return {
                success: false,
                reason: 'Insufficient price data for optimization'
            };
        }

        // Limit to max positions
        const selectedSymbols = validSymbols.slice(0, this.maxPositions);

        // Calculate allocation based on method
        let allocation;
        switch (method) {
            case 'equal_weight':
                allocation = this.equalWeightAllocation(selectedSymbols);
                break;
            case 'risk_parity':
                allocation = this.riskParityAllocation(selectedSymbols, returnData);
                break;
            case 'max_sharpe':
                allocation = this.maxSharpeAllocation(selectedSymbols, returnData);
                break;
            case 'min_variance':
                allocation = this.minVarianceAllocation(selectedSymbols, returnData);
                break;
            default:
                allocation = this.equalWeightAllocation(selectedSymbols);
        }

        // Calculate portfolio metrics
        const expectedReturns = selectedSymbols.map(s => this.calculateExpectedReturn(returnData[s]));
        const covMatrix = this.calculateCovarianceMatrix(selectedSymbols, returnData);
        const weights = selectedSymbols.map(s => allocation[s]);

        const portfolioReturn = this.calculatePortfolioReturn(weights, expectedReturns);
        const portfolioVariance = this.calculatePortfolioVariance(weights, covMatrix);
        const portfolioVolatility = Math.sqrt(portfolioVariance);
        const sharpeRatio = this.calculateSharpeRatio(portfolioReturn, portfolioVolatility);

        // Calculate correlation matrix
        const correlationMatrix = this.calculateCorrelationMatrix(selectedSymbols, returnData);

        return {
            success: true,
            method,
            allocation,
            metrics: {
                expectedReturn: portfolioReturn,
                volatility: portfolioVolatility,
                sharpeRatio: sharpeRatio,
                annualizedReturn: portfolioReturn * 252, // Daily to annual
                annualizedVolatility: portfolioVolatility * Math.sqrt(252)
            },
            correlationMatrix,
            symbols: selectedSymbols,
            timestamp: Date.now()
        };
    }

    /**
     * Generate efficient frontier
     * Returns multiple portfolio allocations with different risk/return profiles
     */
    generateEfficientFrontier(symbols, priceData, numPoints = 10) {
        const frontier = [];

        // Calculate returns
        const returnData = {};
        symbols.forEach(symbol => {
            const prices = priceData[symbol];
            if (prices && prices.length > 1) {
                returnData[symbol] = this.calculateReturns(prices);
            }
        });

        const validSymbols = symbols.filter(s => returnData[s] && returnData[s].length >= 30);

        if (validSymbols.length < 2) {
            return {
                success: false,
                reason: 'Need at least 2 assets with sufficient data'
            };
        }

        // Generate portfolios with different allocations
        for (let i = 0; i < numPoints; i++) {
            const t = i / (numPoints - 1); // 0 to 1

            // Blend between min variance and max return
            // This is simplified - true frontier uses quadratic programming
            const minVarAlloc = this.minVarianceAllocation(validSymbols, returnData);
            const maxSharpeAlloc = this.maxSharpeAllocation(validSymbols, returnData);

            const blendedAlloc = {};
            validSymbols.forEach(symbol => {
                blendedAlloc[symbol] = (1 - t) * minVarAlloc[symbol] + t * maxSharpeAlloc[symbol];
            });

            // Calculate metrics
            const expectedReturns = validSymbols.map(s => this.calculateExpectedReturn(returnData[s]));
            const covMatrix = this.calculateCovarianceMatrix(validSymbols, returnData);
            const weights = validSymbols.map(s => blendedAlloc[s]);

            const portfolioReturn = this.calculatePortfolioReturn(weights, expectedReturns);
            const portfolioVariance = this.calculatePortfolioVariance(weights, covMatrix);
            const portfolioVolatility = Math.sqrt(portfolioVariance);
            const sharpeRatio = this.calculateSharpeRatio(portfolioReturn, portfolioVolatility);

            frontier.push({
                allocation: blendedAlloc,
                expectedReturn: portfolioReturn * 252, // Annualized
                volatility: portfolioVolatility * Math.sqrt(252), // Annualized
                sharpeRatio
            });
        }

        // Sort by volatility (low to high)
        frontier.sort((a, b) => a.volatility - b.volatility);

        return {
            success: true,
            frontier,
            minVolatility: frontier[0],
            maxSharpe: frontier.reduce((max, p) => p.sharpeRatio > max.sharpeRatio ? p : max, frontier[0])
        };
    }

    /**
     * Check if portfolio needs rebalancing
     */
    needsRebalancing(currentAllocation, targetAllocation) {
        const drifts = [];

        for (const symbol in targetAllocation) {
            const target = targetAllocation[symbol];
            const current = currentAllocation[symbol] || 0;
            const drift = Math.abs(current - target);

            if (drift > this.rebalanceThreshold) {
                drifts.push({ symbol, current, target, drift });
            }
        }

        return {
            needsRebalance: drifts.length > 0,
            drifts,
            maxDrift: drifts.length > 0 ? Math.max(...drifts.map(d => d.drift)) : 0
        };
    }

    /**
     * Generate rebalancing trades
     */
    generateRebalancingTrades(currentAllocation, targetAllocation, portfolioValue) {
        const trades = [];

        for (const symbol in targetAllocation) {
            const targetWeight = targetAllocation[symbol];
            const currentWeight = currentAllocation[symbol] || 0;
            const drift = targetWeight - currentWeight;

            if (Math.abs(drift) > this.rebalanceThreshold) {
                const dollarAmount = drift * portfolioValue;

                trades.push({
                    symbol,
                    action: dollarAmount > 0 ? 'BUY' : 'SELL',
                    currentWeight: currentWeight,
                    targetWeight: targetWeight,
                    drift: drift,
                    dollarAmount: Math.abs(dollarAmount),
                    reason: `Rebalance: ${(currentWeight * 100).toFixed(1)}% → ${(targetWeight * 100).toFixed(1)}%`
                });
            }
        }

        // Sort by drift magnitude (largest first)
        trades.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

        return trades;
    }

    /**
     * Format allocation for display
     */
    formatAllocation(allocation, totalValue = 10000) {
        const sorted = Object.entries(allocation)
            .sort(([, a], [, b]) => b - a);

        let output = '';
        sorted.forEach(([symbol, weight]) => {
            const dollarAmount = weight * totalValue;
            output += `  ${symbol.padEnd(12)} ${(weight * 100).toFixed(2)}%  ($${dollarAmount.toFixed(2)})\n`;
        });

        return output.trim();
    }

    /**
     * Save state
     */
    async saveState() {
        try {
            const state = {
                timestamp: Date.now(),
                portfolioHistory: this.portfolioHistory.slice(-100) // Keep last 100
            };

            const filePath = path.join(this.dataPath, 'optimizer_state.json');
            await fs.writeFile(filePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('[PortfolioOptimizer] Failed to save state:', error.message);
        }
    }

    /**
     * Load state
     */
    async loadState() {
        try {
            const filePath = path.join(this.dataPath, 'optimizer_state.json');
            const content = await fs.readFile(filePath, 'utf-8');
            const state = JSON.parse(content);

            this.portfolioHistory = state.portfolioHistory || [];

            console.log('[PortfolioOptimizer] Loaded state from disk');
        } catch (error) {
            console.log('[PortfolioOptimizer] No previous state found, starting fresh');
        }
    }
}
