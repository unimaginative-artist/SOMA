
import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import WebSocket from 'ws';

/**
 * OpenClawArbiter
 * 
 * Bridges SOMA to the OpenClaw Gateway.
 * Allows SOMA to communicate via WhatsApp, Signal, Telegram, and other OpenClaw channels.
 */
export class OpenClawArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'OpenClawArbiter',
            role: ArbiterRole.COMMUNICATOR,
            capabilities: [
                ArbiterCapability.MESSAGE_SEND,
                ArbiterCapability.MESSAGE_RECEIVE
            ],
            ...config
        });

        this.gatewayUrl = config.gatewayUrl || 'ws://localhost:19001';
        this.token = config.token || process.env.OPENCLAW_GATEWAY_TOKEN || 'soma-secret-token';
        this.ws = null;
        this.isConnected = false;
        this.reconnectTimer = null;
        this.securityCouncil = config.securityCouncil || null;
    }

    async onInitialize() {
        // Try to find SecurityCouncil if not provided
        if (!this.securityCouncil && global.SOMA?.securityCouncil) {
            this.securityCouncil = global.SOMA.securityCouncil;
        }

        this.connect();
        this.log('info', 'OpenClawArbiter initialized');
        return true;
    }

    connect() {
        this.log('info', `Connecting to OpenClaw Gateway at ${this.gatewayUrl}...`);
        
        try {
            this.ws = new WebSocket(this.gatewayUrl, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            this.ws.on('open', () => {
                this.isConnected = true;
                this.log('success', '✅ Connected to OpenClaw Gateway');
                // Subscribe to all incoming messages
                this.sendToGateway({ method: 'subscribe', params: { topic: 'message.received' } });
            });

            this.ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data);
                    await this.handleGatewayMessage(msg);
                } catch (e) {
                    this.log('error', `Failed to parse gateway message: ${e.message}`);
                }
            });

            this.ws.on('close', () => {
                this.isConnected = false;
                this.log('warn', 'OpenClaw Gateway disconnected. Reconnecting in 5s...');
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                this.log('error', `Gateway WebSocket error: ${err.message}`);
                this.ws.close();
            });

        } catch (e) {
            this.log('error', `Connection failed: ${e.message}`);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }

    async handleGatewayMessage(msg) {
        // Handle incoming message from OpenClaw
        if (msg.method === 'subscription.publish' && msg.params?.topic === 'message.received') {
            const { content, sender, channel } = msg.params.data;
            
            this.log('info', `Incoming message from ${channel}/${sender}. Analyzing...`);

            const isSafe = await this.verifyContent(content, sender, channel);
            if (!isSafe) {
                this.log('warn', `🛡️ Shielded: Blocked malicious command from ${channel}/${sender}`);
                return;
            }

            this.log('info', `Verified safe: "${content}"`);

            // Forward to SOMA MessageBroker
            if (this.messageBroker) {
                this.messageBroker.publish('communication:message_received', {
                    source: 'openclaw',
                    channel: channel,
                    sender: sender,
                    content: content,
                    timestamp: Date.now()
                });
            }
        }
    }

    async verifyContent(content, sender, channel) {
        if (!this.securityCouncil) {
            // Basic regex fallback
            const suspicious = /(ignore|previous|instruction|system|format|delete|api_key|cmd|shell)/i.test(content);
            return !suspicious;
        }

        try {
            const analysis = await this.securityCouncil.analyzeThreat({
                type: 'Communication Scan',
                source: `${channel}/${sender}`,
                content: content
            });

            return analysis.verdict.action === 'ALLOW';
        } catch (e) {
            this.log('error', `Security check failed: ${e.message}`);
            return false;
        }
    }

    // Called by MessageBroker when SOMA wants to send a message
    async sendMessage(target, content, channel = 'whatsapp') {
        if (!this.isConnected) {
            this.log('warn', 'Cannot send message: Gateway disconnected');
            return false;
        }

        this.log('info', `Sending to ${target} (${channel}): "${content}"`);

        this.sendToGateway({
            method: 'message.send',
            params: {
                target: target,
                message: content,
                channel: channel
            }
        });
        
        return true;
    }

    sendToGateway(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                ...payload
            }));
        }
    }

    async onShutdown() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) this.ws.close();
        return true;
    }
}
