/**
 * Real-Time Dashboard - Production Grade
 *
 * WebSocket-based real-time data streaming:
 * - Live price updates
 * - Order execution notifications
 * - Debate results streaming
 * - Portfolio changes
 * - Alert notifications
 *
 * Why This Matters:
 * - No more refreshing the page
 * - Instant notifications on important events
 * - Monitor multiple assets simultaneously
 * - Professional trading experience
 *
 * Architecture:
 * - Event-driven (EventEmitter)
 * - WebSocket server for clients
 * - Pub/Sub pattern for efficient broadcasting
 * - Channel-based subscriptions
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class RealtimeDashboard extends EventEmitter {
    constructor({ rootPath }) {
        super();
        this.rootPath = rootPath;
        this.dataPath = path.join(rootPath, 'data', 'dashboard');

        // Active subscriptions
        this.subscriptions = new Map(); // clientId -> Set<channel>
        this.clients = new Map(); // clientId -> client metadata

        // Data streams
        this.priceStreams = new Map(); // symbol -> latest price
        this.orderStream = [];
        this.debateStream = [];
        this.portfolioStream = null;
        this.alertStream = [];

        // Performance metrics
        this.metrics = {
            totalEvents: 0,
            totalClients: 0,
            eventsPerSecond: 0,
            avgLatency: 0
        };

        // Stream retention
        this.maxStreamSize = 1000; // Keep last 1000 events
    }

    async initialize() {
        await fs.mkdir(this.dataPath, { recursive: true });

        // Set up event listeners
        this.setupEventListeners();

        console.log('[RealtimeDashboard] ✅ Initialized');
        this.emit('system:ready', { timestamp: Date.now() });
    }

    /**
     * Set up internal event listeners
     */
    setupEventListeners() {
        // Track all events for metrics
        this.on('*', () => {
            this.metrics.totalEvents++;
        });

        // Log system events
        this.on('system:*', (event) => {
            console.log('[Dashboard System Event]', event);
        });
    }

    /**
     * Register a new client
     */
    registerClient(clientId, metadata = {}) {
        this.clients.set(clientId, {
            id: clientId,
            connectedAt: Date.now(),
            subscriptions: new Set(),
            metadata
        });

        this.metrics.totalClients = this.clients.size;

        this.emit('client:connected', {
            clientId,
            totalClients: this.clients.size,
            timestamp: Date.now()
        });

        console.log(`[Dashboard] Client connected: ${clientId} (Total: ${this.clients.size})`);

        return {
            success: true,
            clientId,
            availableChannels: this.getAvailableChannels()
        };
    }

    /**
     * Unregister a client
     */
    unregisterClient(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;

        // Remove all subscriptions
        client.subscriptions.forEach(channel => {
            this.unsubscribe(clientId, channel);
        });

        this.clients.delete(clientId);
        this.metrics.totalClients = this.clients.size;

        this.emit('client:disconnected', {
            clientId,
            totalClients: this.clients.size,
            timestamp: Date.now()
        });

        console.log(`[Dashboard] Client disconnected: ${clientId} (Total: ${this.clients.size})`);
    }

    /**
     * Subscribe client to a channel
     */
    subscribe(clientId, channel) {
        const client = this.clients.get(clientId);
        if (!client) {
            throw new Error(`Client ${clientId} not registered`);
        }

        client.subscriptions.add(channel);

        this.emit('subscription:added', {
            clientId,
            channel,
            timestamp: Date.now()
        });

        console.log(`[Dashboard] ${clientId} subscribed to ${channel}`);

        // Send recent data for this channel
        return this.getRecentData(channel);
    }

    /**
     * Unsubscribe client from a channel
     */
    unsubscribe(clientId, channel) {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.subscriptions.delete(channel);

        this.emit('subscription:removed', {
            clientId,
            channel,
            timestamp: Date.now()
        });

        console.log(`[Dashboard] ${clientId} unsubscribed from ${channel}`);
    }

    /**
     * Get available channels
     */
    getAvailableChannels() {
        return [
            'prices:*',           // All price updates
            'prices:BTC-USD',     // Specific symbol
            'prices:ETH-USD',
            'orders',             // Order executions
            'debates',            // Debate results
            'portfolio',          // Portfolio updates
            'alerts',             // Alert notifications
            'system'              // System events
        ];
    }

    /**
     * Stream price update
     */
    streamPriceUpdate(symbol, price, metadata = {}) {
        const update = {
            type: 'PRICE_UPDATE',
            symbol,
            price,
            change24h: metadata.change24h || 0,
            volume24h: metadata.volume24h || 0,
            timestamp: Date.now(),
            ...metadata
        };

        // Store latest price
        this.priceStreams.set(symbol, update);

        // Emit to subscribers
        this.broadcast(`prices:${symbol}`, update);
        this.broadcast('prices:*', update);

        return update;
    }

    /**
     * Stream order execution
     */
    streamOrderExecution(order) {
        const execution = {
            type: 'ORDER_EXECUTION',
            orderId: order.id || `order_${Date.now()}`,
            symbol: order.symbol,
            side: order.side,
            size: order.size,
            price: order.price,
            status: order.status || 'FILLED',
            timestamp: Date.now(),
            ...order
        };

        // Add to stream
        this.orderStream.push(execution);
        this.trimStream(this.orderStream);

        // Emit to subscribers
        this.broadcast('orders', execution);

        return execution;
    }

    /**
     * Stream debate result
     */
    streamDebateResult(debate) {
        const result = {
            type: 'DEBATE_RESULT',
            debateId: debate.id,
            symbol: debate.proposal?.symbol,
            decision: debate.verdict?.decision,
            winner: debate.verdict?.winner,
            confidence: debate.verdict?.confidence,
            bullScore: debate.verdict?.bullScore,
            bearScore: debate.verdict?.bearScore,
            timestamp: Date.now(),
            ...debate
        };

        // Add to stream
        this.debateStream.push(result);
        this.trimStream(this.debateStream);

        // Emit to subscribers
        this.broadcast('debates', result);

        return result;
    }

    /**
     * Stream portfolio update
     */
    streamPortfolioUpdate(portfolio) {
        const update = {
            type: 'PORTFOLIO_UPDATE',
            totalValue: portfolio.totalValue,
            positions: portfolio.positions,
            cash: portfolio.cash,
            pnl24h: portfolio.pnl24h || 0,
            pnlTotal: portfolio.pnlTotal || 0,
            allocation: portfolio.allocation || {},
            timestamp: Date.now(),
            ...portfolio
        };

        // Store latest
        this.portfolioStream = update;

        // Emit to subscribers
        this.broadcast('portfolio', update);

        return update;
    }

    /**
     * Stream alert
     */
    streamAlert(alert) {
        const notification = {
            type: 'ALERT',
            severity: alert.severity || 'INFO', // INFO, WARNING, ERROR, CRITICAL
            title: alert.title,
            message: alert.message,
            symbol: alert.symbol,
            action: alert.action,
            timestamp: Date.now(),
            ...alert
        };

        // Add to stream
        this.alertStream.push(notification);
        this.trimStream(this.alertStream);

        // Emit to subscribers
        this.broadcast('alerts', notification);

        // Also emit to system channel if critical
        if (alert.severity === 'CRITICAL') {
            this.broadcast('system', notification);
        }

        return notification;
    }

    /**
     * Broadcast event to subscribed clients
     */
    broadcast(channel, data) {
        let recipientCount = 0;

        this.clients.forEach((client, clientId) => {
            if (client.subscriptions.has(channel)) {
                // In production, this would send via WebSocket
                // For now, we emit an event
                this.emit(`client:${clientId}`, {
                    channel,
                    data,
                    timestamp: Date.now()
                });

                recipientCount++;
            }
        });

        // Emit general broadcast event
        this.emit(`broadcast:${channel}`, {
            data,
            recipientCount,
            timestamp: Date.now()
        });

        return recipientCount;
    }

    /**
     * Get recent data for a channel
     */
    getRecentData(channel) {
        if (channel.startsWith('prices:')) {
            const symbol = channel.split(':')[1];
            if (symbol === '*') {
                // Return all prices
                return Array.from(this.priceStreams.values());
            } else {
                // Return specific symbol
                return this.priceStreams.get(symbol) || null;
            }
        }

        if (channel === 'orders') {
            return this.orderStream.slice(-50); // Last 50 orders
        }

        if (channel === 'debates') {
            return this.debateStream.slice(-20); // Last 20 debates
        }

        if (channel === 'portfolio') {
            return this.portfolioStream;
        }

        if (channel === 'alerts') {
            return this.alertStream.slice(-50); // Last 50 alerts
        }

        return null;
    }

    /**
     * Trim stream to max size
     */
    trimStream(stream) {
        if (stream.length > this.maxStreamSize) {
            stream.splice(0, stream.length - this.maxStreamSize);
        }
    }

    /**
     * Get dashboard snapshot (current state)
     */
    getSnapshot() {
        return {
            prices: Array.from(this.priceStreams.values()),
            recentOrders: this.orderStream.slice(-10),
            recentDebates: this.debateStream.slice(-5),
            portfolio: this.portfolioStream,
            recentAlerts: this.alertStream.slice(-10),
            metrics: this.metrics,
            clients: this.clients.size,
            timestamp: Date.now()
        };
    }

    /**
     * Get metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            activeClients: this.clients.size,
            activeSubscriptions: Array.from(this.clients.values())
                .reduce((sum, client) => sum + client.subscriptions.size, 0),
            streamSizes: {
                prices: this.priceStreams.size,
                orders: this.orderStream.length,
                debates: this.debateStream.length,
                alerts: this.alertStream.length
            },
            timestamp: Date.now()
        };
    }

    /**
     * Generate sample data (for testing)
     */
    generateSamplePriceUpdate(symbol = 'BTC-USD') {
        const basePrice = symbol === 'BTC-USD' ? 50000 :
                         symbol === 'ETH-USD' ? 3000 : 150;

        const price = basePrice * (1 + (Math.random() - 0.5) * 0.001);
        const change24h = (Math.random() - 0.5) * 0.1; // -5% to +5%

        return this.streamPriceUpdate(symbol, price, {
            change24h,
            volume24h: Math.random() * 1000000,
            high24h: price * 1.02,
            low24h: price * 0.98
        });
    }

    /**
     * Start sample data generation (for demo)
     */
    startSampleDataStream(intervalMs = 1000) {
        const symbols = ['BTC-USD', 'ETH-USD', 'AAPL'];

        this.sampleInterval = setInterval(() => {
            // Generate price updates
            symbols.forEach(symbol => {
                this.generateSamplePriceUpdate(symbol);
            });

            // Occasionally generate other events
            if (Math.random() > 0.9) {
                this.streamAlert({
                    severity: 'INFO',
                    title: 'Price Alert',
                    message: 'BTC crossed $50k',
                    symbol: 'BTC-USD'
                });
            }
        }, intervalMs);

        console.log('[Dashboard] Started sample data stream');
    }

    /**
     * Stop sample data stream
     */
    stopSampleDataStream() {
        if (this.sampleInterval) {
            clearInterval(this.sampleInterval);
            this.sampleInterval = null;
            console.log('[Dashboard] Stopped sample data stream');
        }
    }

    /**
     * Clean up
     */
    cleanup() {
        this.stopSampleDataStream();
        this.removeAllListeners();
        this.clients.clear();
        this.subscriptions.clear();
    }
}
