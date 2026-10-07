/**
 * core/cluster/CrossNodeTandemBridge.js
 * 
 * SOMA Cluster Mesh Bridge — Connects Machine A (Primary Node) to Machine B (Worker Node).
 * Maintains a persistent WebSocket link to ws://<host>:<port>/ws for real-time telemetry,
 * heartbeats, and agent state replication. Periodically verifies HTTP health, tracks latency,
 * and handles sleep/wake transitions gracefully without ever destabilizing Machine A.
 */

import { EventEmitter } from 'events';
import http from 'http';
import WebSocket from 'ws';

export class CrossNodeTandemBridge extends EventEmitter {
    constructor(options = {}) {
        super();
        this.remoteHost = options.remoteHost || process.env.MACHINE_B_HOST || '192.168.1.250';
        this.remotePort = options.remotePort || parseInt(process.env.MACHINE_B_PORT || '3001', 10);
        this.pollIntervalMs = options.pollIntervalMs || 10000;
        this.reconnectDelayMs = options.reconnectDelayMs || 5000;

        this.ws = null;
        this.pollTimer = null;
        this.reconnectTimer = null;
        this._isDestroyed = false;

        this.state = 'initializing'; // initializing, online, asleep, offline, error
        this.lastSeen = 0;
        this.latencyMs = null;
        this.telemetry = {
            uptime: 0,
            memoryUsage: null,
            activeAgents: 0,
            components: {}
        };
        this.metrics = {
            messagesReceived: 0,
            messagesSent: 0,
            reconnectAttempts: 0,
            consecutiveFailures: 0
        };
    }

    /**
     * Start the bridge: initiates health polling and persistent WebSocket connection.
     */
    start() {
        if (this._isDestroyed) return this;
        this._pollHealth();
        this._connectWs();
        if (!this.pollTimer) {
            this.pollTimer = setInterval(() => this._pollHealth(), this.pollIntervalMs);
            if (this.pollTimer.unref) this.pollTimer.unref();
        }
        return this;
    }

    /**
     * Stop and cleanup all sockets and timers.
     */
    stop() {
        this._isDestroyed = true;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.terminate();
            } catch (_) {}
            this.ws = null;
        }
        this._transitionState('offline');
        return this;
    }

    isOnline() {
        return this.state === 'online';
    }

    getStatus() {
        return {
            nodeId: 'machine-b',
            role: 'worker',
            host: this.remoteHost,
            port: this.remotePort,
            state: this.state,
            latencyMs: this.latencyMs,
            lastSeen: this.lastSeen,
            telemetry: { ...this.telemetry },
            metrics: { ...this.metrics },
            timestamp: Date.now()
        };
    }

    /**
     * Measure HTTP round-trip latency and retrieve health endpoint state.
     */
    async ping() {
        const start = Date.now();
        return new Promise((resolve) => {
            const req = http.request({
                host: this.remoteHost,
                port: this.remotePort,
                path: '/api/health',
                method: 'GET',
                timeout: 3500
            }, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    const elapsed = Date.now() - start;
                    try {
                        const parsed = JSON.parse(body);
                        resolve({ ok: res.statusCode === 200, latencyMs: elapsed, data: parsed });
                    } catch {
                        resolve({ ok: res.statusCode === 200, latencyMs: elapsed, data: null });
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, latencyMs: null, error: 'TIMEOUT' });
            });

            req.on('error', (err) => {
                resolve({ ok: false, latencyMs: null, error: err.code || err.message });
            });

            req.end();
        });
    }

    /**
     * Send a message through the WebSocket link if open.
     */
    sendWsMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            const payload = typeof message === 'string' ? message : JSON.stringify(message);
            this.ws.send(payload);
            this.metrics.messagesSent++;
            return true;
        } catch (e) {
            this.emit('error', e);
            return false;
        }
    }

    _pollHealth() {
        this.ping().then(result => {
            if (result.ok) {
                this.latencyMs = result.latencyMs;
                this.lastSeen = Date.now();
                this.metrics.consecutiveFailures = 0;
                if (result.data) {
                    if (result.data.memory && typeof result.data.memory.usagePercent === 'number') {
                        this.telemetry.memoryUsage = result.data.memory.usagePercent;
                    }
                    if (result.data.uptime) {
                        this.telemetry.uptime = result.data.uptime;
                    }
                    if (result.data.components) {
                        this.telemetry.components = result.data.components;
                    }
                }
                if (this.state !== 'online') {
                    this._transitionState('online');
                }
                this.emit('telemetry', this.getStatus());
            } else {
                this.metrics.consecutiveFailures++;
                if (this.metrics.consecutiveFailures >= 2) {
                    // Node likely suspended or asleep
                    this._transitionState('asleep');
                }
            }
        }).catch(() => {
            this.metrics.consecutiveFailures++;
            if (this.metrics.consecutiveFailures >= 2) {
                this._transitionState('asleep');
            }
        });
    }

    _connectWs() {
        if (this._isDestroyed) return;
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        const wsUrl = `ws://${this.remoteHost}:${this.remotePort}/ws`;
        try {
            this.ws = new WebSocket(wsUrl, {
                handshakeTimeout: 4000
            });

            this.ws.on('open', () => {
                this.lastSeen = Date.now();
                this._transitionState('online');
                this.emit('ws_open');
            });

            this.ws.on('message', (rawData) => {
                this.lastSeen = Date.now();
                this.metrics.messagesReceived++;
                try {
                    const parsed = JSON.parse(rawData.toString());
                    this._handleIncomingMessage(parsed);
                } catch {
                    this.emit('raw_message', rawData);
                }
            });

            this.ws.on('close', () => {
                this.ws = null;
                this._scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                this.emit('ws_error', err.message);
                if (this.ws) {
                    try { this.ws.terminate(); } catch (_) {}
                    this.ws = null;
                }
                this._scheduleReconnect();
            });
        } catch (err) {
            this._scheduleReconnect();
        }
    }

    _handleIncomingMessage(msg) {
        if (!msg) return;
        // Machine B transmits {"type":"init","data":{ agents: [...], uptime: ... }}
        if (msg.type === 'init' && msg.data) {
            if (Array.isArray(msg.data.agents)) {
                this.telemetry.activeAgents = msg.data.agents.length;
            }
            if (msg.data.uptime) {
                this.telemetry.uptime = msg.data.uptime;
            }
        } else if (msg.type === 'pulse' || msg.type === 'heartbeat') {
            if (msg.data?.memory?.usagePercent) {
                this.telemetry.memoryUsage = msg.data.memory.usagePercent;
            }
        }
        this.emit('message', msg);
    }

    _scheduleReconnect() {
        if (this._isDestroyed || this.reconnectTimer) return;
        this.metrics.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._connectWs();
        }, this.reconnectDelayMs);
        if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    }

    _transitionState(newState) {
        if (this.state === newState) return;
        const oldState = this.state;
        this.state = newState;
        this.emit('state_change', { from: oldState, to: newState });
    }
}

// Global Singleton Instance
let _tandemBridge = null;

export function getCrossNodeTandemBridge(options = {}) {
    if (!_tandemBridge) {
        _tandemBridge = new CrossNodeTandemBridge(options);
    }
    return _tandemBridge;
}
