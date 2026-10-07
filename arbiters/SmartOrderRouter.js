/**
 * Smart Order Router - Production Grade
 *
 * Execution algorithms to minimize market impact:
 * - TWAP (Time-Weighted Average Price): Split orders evenly over time
 * - VWAP (Volume-Weighted Average Price): Follow market volume patterns
 * - Iceberg Orders: Hide large order size (show only tip)
 * - Adaptive Slicing: Adjust based on market conditions
 * - Best Execution: Route to optimal venue
 *
 * Why This Matters:
 * - Large order: Buy 10 BTC at market → Price spikes +2%
 * - Smart routing: Buy 10 BTC over 1 hour → Price impact <0.5%
 * - Savings: 1.5% × $500k = $7,500
 */

import fs from 'fs/promises';
import path from 'path';

export class SmartOrderRouter {
    constructor({ rootPath }) {
        this.rootPath = rootPath;
        this.dataPath = path.join(rootPath, 'data', 'order_routing');

        // Execution parameters
        this.maxSliceSize = 0.10; // Max 10% of ADV (Average Daily Volume)
        this.minSliceSize = 100; // Minimum $100 per slice
        this.maxSlices = 50; // Max 50 slices per order
        this.sliceInterval = 60000; // 1 minute between slices (ms)

        // Market impact model
        this.impactCoefficient = 0.1; // Price impact per % of volume
        this.spreadCost = 0.0005; // 0.05% bid-ask spread

        // Execution tracking
        this.activeOrders = new Map(); // orderId -> order state
        this.executionHistory = [];
    }

    async initialize() {
        await fs.mkdir(this.dataPath, { recursive: true });
        await this.loadState();
        console.log('[SmartOrderRouter] ✅ Initialized');
    }

    /**
     * Estimate market impact of an order
     *
     * Impact increases with order size relative to volume
     */
    estimateMarketImpact(orderSize, averageDailyVolume, side) {
        if (!averageDailyVolume || averageDailyVolume === 0) {
            return {
                impact: 0.01, // 1% default if no volume data
                reason: 'No volume data available'
            };
        }

        // Order size as % of ADV
        const volumeParticipation = orderSize / averageDailyVolume;

        // Market impact model (square root model)
        // Impact grows with sqrt(size) due to liquidity absorption
        const impact = this.impactCoefficient * Math.sqrt(volumeParticipation);

        // Add spread cost (crossing bid-ask)
        const totalImpact = impact + this.spreadCost;

        return {
            impact: totalImpact,
            volumeParticipation,
            impactCost: impact,
            spreadCost: this.spreadCost,
            totalCost: totalImpact,
            severity: volumeParticipation > 0.1 ? 'HIGH' :
                     volumeParticipation > 0.05 ? 'MEDIUM' : 'LOW'
        };
    }

    /**
     * TWAP (Time-Weighted Average Price)
     *
     * Split order evenly over time period
     * Best for: Consistent execution, low urgency
     */
    generateTWAPSchedule(orderSize, durationMinutes, currentPrice) {
        // Calculate number of slices
        const maxSlices = Math.min(durationMinutes, this.maxSlices);
        const minDollarSize = this.minSliceSize;
        const minSlices = Math.ceil((orderSize * currentPrice) / minDollarSize);

        const numSlices = Math.max(minSlices, Math.min(maxSlices, durationMinutes));

        // Equal-sized slices
        const sliceSize = orderSize / numSlices;
        const intervalMs = (durationMinutes * 60000) / numSlices;

        const schedule = [];
        let executionTime = Date.now();

        for (let i = 0; i < numSlices; i++) {
            schedule.push({
                sliceNumber: i + 1,
                size: sliceSize,
                executionTime: executionTime,
                type: 'TWAP',
                urgency: 'NORMAL'
            });

            executionTime += intervalMs;
        }

        return {
            algorithm: 'TWAP',
            totalSize: orderSize,
            numSlices,
            sliceSize,
            intervalMs,
            durationMs: durationMinutes * 60000,
            schedule
        };
    }

    /**
     * VWAP (Volume-Weighted Average Price)
     *
     * Split order based on historical volume patterns
     * Best for: Following market rhythm, minimize impact
     */
    generateVWAPSchedule(orderSize, volumeProfile, durationMinutes, currentPrice) {
        // Use historical volume distribution if available
        // Otherwise, use standard trading session pattern
        const defaultProfile = this.getDefaultVolumeProfile(durationMinutes);
        const profile = volumeProfile || defaultProfile;

        const schedule = [];
        let executionTime = Date.now();
        const intervalMs = (durationMinutes * 60000) / profile.length;

        profile.forEach((volumeWeight, i) => {
            const sliceSize = orderSize * volumeWeight;

            schedule.push({
                sliceNumber: i + 1,
                size: sliceSize,
                volumeWeight: volumeWeight,
                executionTime: executionTime,
                type: 'VWAP',
                urgency: 'NORMAL'
            });

            executionTime += intervalMs;
        });

        return {
            algorithm: 'VWAP',
            totalSize: orderSize,
            numSlices: profile.length,
            intervalMs,
            durationMs: durationMinutes * 60000,
            schedule
        };
    }

    /**
     * Default volume profile (U-shaped: high at open/close, low midday)
     */
    getDefaultVolumeProfile(durationMinutes) {
        // Simplified U-shaped volume curve
        const intervals = Math.min(durationMinutes, 20);
        const profile = [];

        for (let i = 0; i < intervals; i++) {
            const t = i / (intervals - 1); // 0 to 1

            // U-shape: high at start and end, low in middle
            const uShape = Math.pow(2 * t - 1, 2); // Parabola
            const volumeWeight = 0.5 + 0.5 * uShape;

            profile.push(volumeWeight);
        }

        // Normalize to sum to 1.0
        const total = profile.reduce((sum, w) => sum + w, 0);
        return profile.map(w => w / total);
    }

    /**
     * Iceberg Order
     *
     * Show only small portion of total order (tip of iceberg)
     * Hide remaining size to prevent front-running
     */
    generateIcebergSchedule(orderSize, displaySize, currentPrice) {
        const numSlices = Math.ceil(orderSize / displaySize);
        const schedule = [];

        for (let i = 0; i < numSlices; i++) {
            const remaining = orderSize - (i * displaySize);
            const sliceSize = Math.min(displaySize, remaining);

            schedule.push({
                sliceNumber: i + 1,
                size: sliceSize,
                displaySize: sliceSize,
                hiddenSize: 0, // All visible (each slice is executed independently)
                executionTime: Date.now() + (i * this.sliceInterval),
                type: 'ICEBERG',
                urgency: 'HIGH' // Execute quickly once displayed
            });
        }

        return {
            algorithm: 'ICEBERG',
            totalSize: orderSize,
            displaySize,
            numSlices,
            schedule
        };
    }

    /**
     * Adaptive Execution
     *
     * Adjust slice sizes based on real-time market conditions
     * - High volatility → Smaller slices
     * - Low liquidity → Slower execution
     * - Price moving against you → Accelerate
     */
    generateAdaptiveSchedule(orderSize, marketConditions, durationMinutes) {
        const { volatility, liquidity, trend, side } = marketConditions;

        // Adjust based on conditions
        let aggressiveness = 1.0;

        // High volatility → More slices (smaller each)
        if (volatility > 0.03) aggressiveness *= 0.7; // 30% less aggressive

        // Low liquidity → Slower
        if (liquidity < 1000000) aggressiveness *= 0.8;

        // Price moving against you → Accelerate
        if ((side === 'BUY' && trend > 0.01) || (side === 'SELL' && trend < -0.01)) {
            aggressiveness *= 1.3; // 30% more aggressive
        }

        // Calculate slices
        const baseSlices = Math.ceil(durationMinutes / 2);
        const numSlices = Math.ceil(baseSlices / aggressiveness);
        const sliceSize = orderSize / numSlices;
        const intervalMs = (durationMinutes * 60000) / numSlices;

        const schedule = [];
        let executionTime = Date.now();

        for (let i = 0; i < numSlices; i++) {
            schedule.push({
                sliceNumber: i + 1,
                size: sliceSize,
                executionTime: executionTime,
                type: 'ADAPTIVE',
                urgency: aggressiveness > 1.2 ? 'HIGH' : 'NORMAL',
                marketConditions: {
                    volatility,
                    liquidity,
                    trend
                }
            });

            executionTime += intervalMs;
        }

        return {
            algorithm: 'ADAPTIVE',
            totalSize: orderSize,
            numSlices,
            aggressiveness,
            intervalMs,
            durationMs: durationMinutes * 60000,
            schedule
        };
    }

    /**
     * Smart Order Routing - Choose best algorithm
     */
    routeOrder(order) {
        const {
            symbol,
            side,
            size,
            urgency = 'NORMAL',
            durationMinutes = 60,
            averageDailyVolume,
            currentPrice,
            marketConditions
        } = order;

        // Estimate market impact
        const impact = this.estimateMarketImpact(size, averageDailyVolume, side);

        // Choose algorithm based on conditions
        let algorithm;
        let schedule;

        if (urgency === 'IMMEDIATE') {
            // High urgency: Execute quickly with iceberg
            const displaySize = Math.min(size * 0.2, averageDailyVolume * 0.05);
            schedule = this.generateIcebergSchedule(size, displaySize, currentPrice);
            algorithm = 'ICEBERG';

        } else if (impact.severity === 'HIGH') {
            // High impact: Use VWAP to follow market rhythm
            schedule = this.generateVWAPSchedule(size, null, durationMinutes, currentPrice);
            algorithm = 'VWAP';

        } else if (marketConditions && marketConditions.volatility > 0.03) {
            // High volatility: Adaptive execution
            schedule = this.generateAdaptiveSchedule(size, marketConditions, durationMinutes);
            algorithm = 'ADAPTIVE';

        } else {
            // Normal conditions: TWAP
            schedule = this.generateTWAPSchedule(size, durationMinutes, currentPrice);
            algorithm = 'TWAP';
        }

        // Create order execution plan
        const orderPlan = {
            orderId: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            symbol,
            side,
            totalSize: size,
            algorithm,
            schedule: schedule.schedule,
            estimatedImpact: impact,
            urgency,
            status: 'PENDING',
            createdAt: Date.now(),
            metadata: {
                ...schedule,
                currentPrice,
                averageDailyVolume
            }
        };

        // Store active order
        this.activeOrders.set(orderPlan.orderId, orderPlan);

        return orderPlan;
    }

    /**
     * Execute a slice of an order
     */
    async executeSlice(orderId, sliceNumber) {
        const order = this.activeOrders.get(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        const slice = order.schedule[sliceNumber - 1];
        if (!slice) {
            throw new Error(`Slice ${sliceNumber} not found for order ${orderId}`);
        }

        // Simulate execution
        const executionPrice = order.metadata.currentPrice * (1 + Math.random() * 0.001 - 0.0005);
        const executionTime = Date.now();

        const execution = {
            orderId,
            sliceNumber,
            size: slice.size,
            executionPrice,
            executionTime,
            type: slice.type,
            status: 'FILLED'
        };

        // Update order status
        const filledSlices = order.schedule.filter(s => s.status === 'FILLED').length;
        if (filledSlices + 1 === order.schedule.length) {
            order.status = 'COMPLETED';
        }

        slice.status = 'FILLED';
        slice.executionPrice = executionPrice;
        slice.executionTime = executionTime;

        // Record execution
        this.executionHistory.push(execution);

        return execution;
    }

    /**
     * Get execution statistics for an order
     */
    getExecutionStats(orderId) {
        const order = this.activeOrders.get(orderId);
        if (!order) return null;

        const filledSlices = order.schedule.filter(s => s.status === 'FILLED');
        const totalFilled = filledSlices.reduce((sum, s) => sum + s.size, 0);
        const avgPrice = filledSlices.reduce((sum, s) => sum + s.executionPrice * s.size, 0) / totalFilled;

        const targetPrice = order.metadata.currentPrice;
        const slippage = (avgPrice - targetPrice) / targetPrice;

        return {
            orderId,
            status: order.status,
            algorithm: order.algorithm,
            totalSize: order.totalSize,
            filledSize: totalFilled,
            remainingSize: order.totalSize - totalFilled,
            fillRate: totalFilled / order.totalSize,
            avgExecutionPrice: avgPrice,
            targetPrice: targetPrice,
            slippage: slippage,
            slippageBps: slippage * 10000,
            totalSlices: order.schedule.length,
            filledSlices: filledSlices.length,
            estimatedImpact: order.estimatedImpact,
            savings: (order.estimatedImpact.impact - Math.abs(slippage)) * order.totalSize * targetPrice
        };
    }

    /**
     * Calculate execution quality metrics
     */
    calculateExecutionQuality(orderId) {
        const stats = this.getExecutionStats(orderId);
        if (!stats) return null;

        // Execution quality score (0-100)
        let score = 100;

        // Penalize slippage
        score -= Math.abs(stats.slippageBps) * 10; // -10 points per bp

        // Penalize if actual impact > estimated impact
        const excessImpact = Math.abs(stats.slippage) - stats.estimatedImpact.impact;
        if (excessImpact > 0) {
            score -= excessImpact * 10000; // Penalty for exceeding estimate
        }

        // Reward for staying under estimate
        if (excessImpact < 0) {
            score += Math.abs(excessImpact) * 5000; // Bonus for beating estimate
        }

        score = Math.max(0, Math.min(100, score));

        return {
            score,
            grade: score >= 90 ? 'A' :
                   score >= 80 ? 'B' :
                   score >= 70 ? 'C' :
                   score >= 60 ? 'D' : 'F',
            slippageBps: stats.slippageBps,
            estimatedBps: stats.estimatedImpact.impact * 10000,
            savingsDollars: stats.savings,
            recommendation: this.getRecommendation(score, stats)
        };
    }

    /**
     * Get recommendation based on execution quality
     */
    getRecommendation(score, stats) {
        if (score >= 90) {
            return 'Excellent execution. Current algorithm is optimal.';
        } else if (score >= 70) {
            return 'Good execution. Consider minor adjustments to slice size.';
        } else if (stats.slippageBps > stats.estimatedImpact.impact * 10000) {
            return 'High slippage detected. Consider slower execution or different algorithm.';
        } else {
            return 'Poor execution. Review market conditions and adjust strategy.';
        }
    }

    /**
     * Format order plan for display
     */
    formatOrderPlan(orderPlan) {
        const { orderId, symbol, side, totalSize, algorithm, schedule, estimatedImpact } = orderPlan;

        let output = `Order: ${orderId}\n`;
        output += `Symbol: ${symbol}\n`;
        output += `Side: ${side}\n`;
        output += `Total Size: ${totalSize.toFixed(4)}\n`;
        output += `Algorithm: ${algorithm}\n`;
        output += `Estimated Impact: ${(estimatedImpact.impact * 100).toFixed(3)}%\n`;
        output += `Volume Participation: ${(estimatedImpact.volumeParticipation * 100).toFixed(2)}%\n`;
        output += `Impact Severity: ${estimatedImpact.severity}\n\n`;

        output += `Execution Schedule (${schedule.length} slices):\n`;
        output += `${'Slice'.padEnd(8)}${'Size'.padEnd(12)}${'Time'.padEnd(20)}${'Type'.padEnd(12)}${'Urgency'}\n`;
        output += '-'.repeat(70) + '\n';

        schedule.slice(0, 5).forEach(slice => {
            const time = new Date(slice.executionTime).toLocaleTimeString();
            output += `${String(slice.sliceNumber).padEnd(8)}`;
            output += `${slice.size.toFixed(4).padEnd(12)}`;
            output += `${time.padEnd(20)}`;
            output += `${slice.type.padEnd(12)}`;
            output += `${slice.urgency}\n`;
        });

        if (schedule.length > 5) {
            output += `... ${schedule.length - 5} more slices\n`;
        }

        return output;
    }

    /**
     * Save state
     */
    async saveState() {
        try {
            const state = {
                timestamp: Date.now(),
                activeOrders: Array.from(this.activeOrders.entries()),
                executionHistory: this.executionHistory.slice(-1000) // Keep last 1000
            };

            const filePath = path.join(this.dataPath, 'router_state.json');
            await fs.writeFile(filePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('[SmartOrderRouter] Failed to save state:', error.message);
        }
    }

    /**
     * Load state
     */
    async loadState() {
        try {
            const filePath = path.join(this.dataPath, 'router_state.json');
            const content = await fs.readFile(filePath, 'utf-8');
            const state = JSON.parse(content);

            this.activeOrders = new Map(state.activeOrders || []);
            this.executionHistory = state.executionHistory || [];

            console.log('[SmartOrderRouter] Loaded state from disk');
        } catch (error) {
            console.log('[SmartOrderRouter] No previous state found, starting fresh');
        }
    }
}
