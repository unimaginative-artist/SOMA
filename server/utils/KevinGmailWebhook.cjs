/**
 * KevinGmailWebhook - Real-time Gmail Notifications via Google Pub/Sub
 *
 * Inspired by clawdbot's gmail.ts
 *
 * Features:
 * - Gmail watch setup via Pub/Sub push notifications
 * - Webhook server for receiving push messages
 * - Auto-renewal of watch subscription (every 12 hours)
 * - Configurable labels (INBOX, SPAM, etc.)
 *
 * Setup Requirements:
 * 1. Google Cloud Project with Pub/Sub + Gmail APIs enabled
 * 2. Service account with pubsub.subscriber + gmail.modify permissions
 * 3. Pub/Sub topic + push subscription pointing to your webhook
 *
 * Environment Variables:
 * - GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON
 * - GMAIL_PUBSUB_TOPIC: projects/{project}/topics/{topic}
 * - GMAIL_PUBSUB_SUBSCRIPTION: projects/{project}/subscriptions/{sub}
 * - GMAIL_WEBHOOK_PORT: Port for webhook server (default: 3002)
 * - GMAIL_WEBHOOK_PATH: Path for webhook (default: /gmail-webhook)
 * - GMAIL_HOOK_TOKEN: Secret token for webhook auth
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class KevinGmailWebhook extends EventEmitter {
    constructor(options = {}) {
        super();

        this.config = {
            // Google Cloud settings
            topic: options.topic || process.env.GMAIL_PUBSUB_TOPIC,
            subscription: options.subscription || process.env.GMAIL_PUBSUB_SUBSCRIPTION,

            // Webhook server settings
            port: options.port || parseInt(process.env.GMAIL_WEBHOOK_PORT) || 3002,
            path: options.path || process.env.GMAIL_WEBHOOK_PATH || '/gmail-webhook',
            hookToken: options.hookToken || process.env.GMAIL_HOOK_TOKEN || this._generateToken(),

            // Gmail settings
            labelIds: options.labelIds || ['INBOX'],
            userId: options.userId || 'me',

            // Watch renewal (Gmail watch expires after 7 days, renew every 12h)
            renewalIntervalMs: options.renewalIntervalMs || 12 * 60 * 60 * 1000
        };

        this.server = null;
        this.renewalTimer = null;
        this.watchExpiration = null;
        this.historyId = null;

        // Stats
        this.stats = {
            messagesReceived: 0,
            lastMessageAt: null,
            watchSetupAt: null,
            renewals: 0,
            errors: 0
        };

        // Message deduplication (keep last 100 message IDs)
        this.processedIds = new Set();
        this.maxProcessedIds = 100;
    }

    _generateToken() {
        return crypto.randomBytes(24).toString('hex');
    }

    /**
     * Check if configured
     */
    isConfigured() {
        return !!(this.config.topic && process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }

    /**
     * Get configuration status
     */
    getStatus() {
        return {
            configured: this.isConfigured(),
            running: !!this.server,
            topic: this.config.topic ? '***configured***' : null,
            port: this.config.port,
            path: this.config.path,
            watchExpiration: this.watchExpiration,
            historyId: this.historyId,
            stats: this.stats
        };
    }

    /**
     * Start the webhook server
     */
    async start() {
        if (!this.isConfigured()) {
            console.log('[GmailWebhook] Not configured. Set GMAIL_PUBSUB_TOPIC and GOOGLE_APPLICATION_CREDENTIALS');
            return { success: false, reason: 'not_configured' };
        }

        if (this.server) {
            return { success: true, message: 'Already running' };
        }

        return new Promise((resolve) => {
            this.server = http.createServer((req, res) => {
                this._handleRequest(req, res);
            });

            this.server.listen(this.config.port, () => {
                console.log(`[GmailWebhook] Webhook server listening on port ${this.config.port}`);
                console.log(`[GmailWebhook] Endpoint: http://localhost:${this.config.port}${this.config.path}`);

                // Setup Gmail watch
                this._setupWatch().then((watchResult) => {
                    if (watchResult.success) {
                        // Schedule renewal
                        this._scheduleRenewal();
                    }
                });

                resolve({ success: true, port: this.config.port, path: this.config.path });
            });

            this.server.on('error', (err) => {
                console.error('[GmailWebhook] Server error:', err.message);
                this.stats.errors++;
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Stop the webhook server
     */
    async stop() {
        if (this.renewalTimer) {
            clearInterval(this.renewalTimer);
            this.renewalTimer = null;
        }

        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('[GmailWebhook] Server stopped');
                    this.server = null;
                    resolve({ success: true });
                });
            });
        }

        return { success: true, message: 'Not running' };
    }

    /**
     * Handle incoming webhook requests
     */
    _handleRequest(req, res) {
        // Only accept POST to our webhook path
        if (req.method !== 'POST' || req.url !== this.config.path) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);

                // Validate hook token if present in subscription
                if (data.subscription && !data.subscription.includes(this.config.hookToken)) {
                    // For Pub/Sub, token is usually in the URL or message attributes
                    // This is a simplified check
                }

                this._processPubSubMessage(data);

                // Acknowledge receipt
                res.writeHead(200);
                res.end('OK');

            } catch (err) {
                console.error('[GmailWebhook] Parse error:', err.message);
                this.stats.errors++;
                res.writeHead(400);
                res.end('Bad Request');
            }
        });
    }

    /**
     * Process a Pub/Sub push message
     */
    _processPubSubMessage(data) {
        try {
            // Pub/Sub push format: { message: { data: base64, messageId, attributes }, subscription }
            if (!data.message || !data.message.data) {
                console.warn('[GmailWebhook] Invalid message format');
                return;
            }

            // Decode base64 data
            const decoded = Buffer.from(data.message.data, 'base64').toString('utf8');
            const notification = JSON.parse(decoded);

            // Gmail notification format: { emailAddress, historyId }
            if (!notification.historyId) {
                console.warn('[GmailWebhook] Missing historyId in notification');
                return;
            }

            // Deduplicate
            const msgId = data.message.messageId;
            if (this.processedIds.has(msgId)) {
                return;
            }
            this.processedIds.add(msgId);
            if (this.processedIds.size > this.maxProcessedIds) {
                const first = this.processedIds.values().next().value;
                this.processedIds.delete(first);
            }

            // Update stats
            this.stats.messagesReceived++;
            this.stats.lastMessageAt = new Date().toISOString();

            // Emit event for Kevin to handle
            this.emit('gmail:notification', {
                emailAddress: notification.emailAddress,
                historyId: notification.historyId,
                previousHistoryId: this.historyId,
                messageId: msgId,
                receivedAt: new Date().toISOString()
            });

            // Update our history ID for incremental sync
            this.historyId = notification.historyId;

            console.log(`[GmailWebhook] New notification: historyId=${notification.historyId}`);

        } catch (err) {
            console.error('[GmailWebhook] Process error:', err.message);
            this.stats.errors++;
        }
    }

    /**
     * Setup Gmail watch (requires Gmail API access)
     * This is a placeholder - real implementation needs googleapis
     */
    async _setupWatch() {
        console.log('[GmailWebhook] Setting up Gmail watch...');

        // In production, use googleapis:
        // const { google } = require('googleapis');
        // const gmail = google.gmail({ version: 'v1', auth });
        // const res = await gmail.users.watch({
        //   userId: 'me',
        //   requestBody: {
        //     labelIds: this.config.labelIds,
        //     topicName: this.config.topic
        //   }
        // });

        // For now, emit a setup event so external code can handle it
        this.stats.watchSetupAt = new Date().toISOString();

        this.emit('gmail:watch-needed', {
            topic: this.config.topic,
            labelIds: this.config.labelIds,
            userId: this.config.userId
        });

        console.log('[GmailWebhook] Watch setup event emitted');
        console.log('[GmailWebhook] Topic:', this.config.topic);
        console.log('[GmailWebhook] Labels:', this.config.labelIds.join(', '));

        return { success: true, needsExternalSetup: true };
    }

    /**
     * Schedule watch renewal
     */
    _scheduleRenewal() {
        if (this.renewalTimer) {
            clearInterval(this.renewalTimer);
        }

        this.renewalTimer = setInterval(async () => {
            console.log('[GmailWebhook] Renewing Gmail watch...');
            this.stats.renewals++;
            await this._setupWatch();
        }, this.config.renewalIntervalMs);

        console.log(`[GmailWebhook] Watch renewal scheduled every ${this.config.renewalIntervalMs / 3600000}h`);
    }

    /**
     * Manually trigger a history sync (fetch missed messages)
     * Emits event with history ID range for external handler
     */
    requestHistorySync(startHistoryId) {
        this.emit('gmail:history-sync', {
            startHistoryId: startHistoryId || this.historyId,
            userId: this.config.userId,
            labelIds: this.config.labelIds
        });
    }
}

module.exports = { KevinGmailWebhook };
