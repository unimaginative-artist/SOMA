/**
 * KevinNotificationService - Multi-Channel Alerts for KEVIN
 *
 * Supports:
 * - Slack (via webhooks or Bot API)
 * - Telegram (via Bot API)
 * - Discord (via webhooks)
 * - Desktop notifications (via system)
 *
 * All alerts are queued and rate-limited to prevent spam.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { EventEmitter } = require('events');

class KevinNotificationService extends EventEmitter {
    constructor() {
        super();
        // Config file path for persistence
        this.configPath = process.env.KEVIN_NOTIFY_CONFIG_PATH ||
            path.join(process.cwd(), 'config', 'kevin_notifications.json');

        // NEW: Multiple webhooks per channel type
        this.webhooks = [];

        // LEGACY: Channel-based config (for backward compatibility)
        this.channels = {
            slack: {
                enabled: false,
                webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
                botToken: process.env.SLACK_BOT_TOKEN || '',
                defaultChannel: process.env.SLACK_CHANNEL || '#general'
            },
            telegram: {
                enabled: false,
                botToken: process.env.TELEGRAM_BOT_TOKEN || '',
                chatId: process.env.TELEGRAM_CHAT_ID || ''
            },
            discord: {
                enabled: false,
                webhookUrl: process.env.DISCORD_WEBHOOK_URL || ''
            }
        };

        // Load saved config first
        this._loadConfig();
        
        // Migrate env vars to webhooks if config is empty
        this._migrateEnvVars();

        // Initialize channels based on webhooks
        this._initializeChannels();

        // Alert queue
        this.queue = [];
        this.processing = false;

        // Rate limiting (per webhook AND per channel for legacy)
        this.rateLimits = new Map(); // webhookId -> { count, resetAt, limit }

        // Alert history
        this.alertHistory = [];
        this.alertDedupe = new Map();
        this.dedupeWindowMs = Number(process.env.KEVIN_NOTIFY_DEDUPE_MS || 10 * 60 * 1000);

        console.log(`[KevinNotify] Initialized with ${this.webhooks.length} webhooks`);
    }

    /**
     * Migrate env vars to webhooks (one-time migration)
     */
    _migrateEnvVars() {
        if (this.webhooks.length > 0) return; // Already have webhooks

        // Slack
        if (process.env.SLACK_WEBHOOK_URL) {
            this.webhooks.push({
                id: crypto.randomUUID(),
                type: 'slack',
                name: 'Slack (env)',
                url: process.env.SLACK_WEBHOOK_URL,
                enabled: true,
                createdAt: Date.now()
            });
            console.log('[KevinNotify] Migrated Slack from env var');
        }

        // Telegram
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            this.webhooks.push({
                id: crypto.randomUUID(),
                type: 'telegram',
                name: 'Telegram (env)',
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                chatId: process.env.TELEGRAM_CHAT_ID,
                enabled: true,
                createdAt: Date.now()
            });
            console.log('[KevinNotify] Migrated Telegram from env var');
        }

        // Discord
        if (process.env.DISCORD_WEBHOOK_URL) {
            this.webhooks.push({
                id: crypto.randomUUID(),
                type: 'discord',
                name: 'Discord (env)',
                url: process.env.DISCORD_WEBHOOK_URL,
                enabled: true,
                createdAt: Date.now()
            });
            console.log('[KevinNotify] Migrated Discord from env var');
        }

        if (this.webhooks.length > 0) {
            this._saveConfig();
        }
    }

    /**
     * Add a new webhook
     */
    addWebhook(webhook) {
        const newWebhook = {
            id: webhook.id || crypto.randomUUID(),
            type: webhook.type, // 'slack', 'discord', 'telegram'
            name: webhook.name || `${webhook.type} webhook`,
            enabled: webhook.enabled !== undefined ? webhook.enabled : true,
            createdAt: webhook.createdAt || Date.now()
        };

        // Type-specific fields
        if (webhook.type === 'telegram') {
            newWebhook.botToken = webhook.botToken;
            newWebhook.chatId = webhook.chatId;
        } else {
            newWebhook.url = webhook.url;
        }

        this.webhooks.push(newWebhook);
        this._saveConfig();

        console.log(`[KevinNotify] Added ${webhook.type} webhook: ${newWebhook.name}`);
        return newWebhook;
    }

    /**
     * Remove a webhook by ID
     */
    removeWebhook(id) {
        const index = this.webhooks.findIndex(w => w.id === id);
        if (index === -1) return false;

        const removed = this.webhooks.splice(index, 1)[0];
        this._saveConfig();

        console.log(`[KevinNotify] Removed webhook: ${removed.name}`);
        return true;
    }

    /**
     * Toggle webhook enabled state
     */
    toggleWebhook(id) {
        const webhook = this.webhooks.find(w => w.id === id);
        if (!webhook) return null;

        webhook.enabled = !webhook.enabled;
        this._saveConfig();

        console.log(`[KevinNotify] Toggled webhook ${webhook.name}: ${webhook.enabled}`);
        return webhook;
    }

    /**
     * Get all webhooks
     */
    getWebhooks() {
        return this.webhooks.map(w => ({
            ...w,
            // Truncate sensitive data for display
            url: w.url ? w.url.substring(0, 50) + '...' : undefined,
            botToken: w.botToken ? '***' : undefined
        }));
    }

    /**
     * Get webhook by ID (full data)
     */
    getWebhookById(id) {
        return this.webhooks.find(w => w.id === id);
    }

    /**
     * Check and initialize configured channels
     */
    _initializeChannels() {
        // Slack
        if (this.channels.slack.webhookUrl || this.channels.slack.botToken) {
            this.channels.slack.enabled = true;
            console.log('[KevinNotify] ✅ Slack notifications enabled');
        }

        // Telegram
        if (this.channels.telegram.botToken && this.channels.telegram.chatId) {
            this.channels.telegram.enabled = true;
            console.log('[KevinNotify] ✅ Telegram notifications enabled');
        }

        // Discord
        if (this.channels.discord.webhookUrl) {
            this.channels.discord.enabled = true;
            console.log('[KevinNotify] ✅ Discord notifications enabled');
        }

        const enabledCount = Object.values(this.channels).filter(c => c.enabled).length;
        if (enabledCount === 0) {
            console.log('[KevinNotify] ⚠️  No notification channels configured');
            console.log('[KevinNotify] Set SLACK_WEBHOOK_URL, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, or DISCORD_WEBHOOK_URL');
        }
    }

    /**
     * Get configuration status
     */
    getStatus() {
        return {
            slack: {
                enabled: this.channels.slack.enabled,
                configured: !!(this.channels.slack.webhookUrl || this.channels.slack.botToken)
            },
            telegram: {
                enabled: this.channels.telegram.enabled,
                configured: !!(this.channels.telegram.botToken && this.channels.telegram.chatId)
            },
            discord: {
                enabled: this.channels.discord.enabled,
                configured: !!this.channels.discord.webhookUrl
            },
            queueLength: this.queue.length,
            recentAlerts: this.alertHistory.slice(-10)
        };
    }

    /**
     * Send a security alert to all enabled channels
     */
    async sendSecurityAlert(alert) {
        const formattedAlert = {
            type: alert.type || 'SECURITY_ALERT',
            title: alert.title || 'Kevin Security Alert',
            message: alert.message,
            severity: alert.severity || 'medium', // low, medium, high, critical
            timestamp: new Date().toISOString(),
            details: alert.details || {},
            source: alert.source || 'email_scan'
        };

        const dedupeKey = this._alertDedupeKey(formattedAlert);
        const now = Date.now();
        this._pruneAlertDedupe(now);
        const previous = this.alertDedupe.get(dedupeKey);
        if (previous && now - previous < this.dedupeWindowMs) {
            const suppressedAlert = {
                ...formattedAlert,
                suppressed: true,
                suppressionReason: 'duplicate_alert',
                suppressedUntil: new Date(previous + this.dedupeWindowMs).toISOString()
            };
            this.alertHistory.push(suppressedAlert);
            if (this.alertHistory.length > 100) this.alertHistory.shift();
            return {
                success: true,
                suppressed: true,
                reason: 'duplicate_alert',
                alert: suppressedAlert,
                results: {}
            };
        }
        this.alertDedupe.set(dedupeKey, now);

        // Add to history
        this.alertHistory.push(formattedAlert);
        if (this.alertHistory.length > 100) this.alertHistory.shift();

        // Send to all enabled channels
        const results = {};

        if (this.channels.slack.enabled) {
            results.slack = await this._sendSlack(formattedAlert);
        }

        if (this.channels.telegram.enabled) {
            results.telegram = await this._sendTelegram(formattedAlert);
        }

        if (this.channels.discord.enabled) {
            results.discord = await this._sendDiscord(formattedAlert);
        }

        return {
            success: true,
            alert: formattedAlert,
            results
        };
    }

    _alertDedupeKey(alert) {
        const details = alert.details || {};
        const core = [
            alert.type,
            alert.severity,
            alert.source,
            details.sender,
            details.subject,
            details.domain,
            details.url,
            alert.title,
            String(alert.message || '').slice(0, 180)
        ].filter(Boolean).join('|').toLowerCase();
        return crypto.createHash('sha256').update(core || JSON.stringify(alert)).digest('hex');
    }

    _pruneAlertDedupe(now = Date.now()) {
        for (const [key, timestamp] of this.alertDedupe.entries()) {
            if (now - timestamp > this.dedupeWindowMs) this.alertDedupe.delete(key);
        }
    }

    /**
     * Send a threat detection alert
     */
    async sendThreatAlert(email, threatInfo) {
        return this.sendSecurityAlert({
            type: 'THREAT_DETECTED',
            title: `🚨 Threat Detected: ${threatInfo.type || 'Suspicious Email'}`,
            message: `From: ${email.from}\nSubject: ${email.subject}`,
            severity: threatInfo.level >= 70 ? 'critical' : threatInfo.level >= 40 ? 'high' : 'medium',
            details: {
                sender: email.from,
                subject: email.subject,
                threatLevel: threatInfo.level,
                indicators: threatInfo.indicators || [],
                recommendation: threatInfo.recommendation || 'Review carefully'
            },
            source: 'threat_detection'
        });
    }

    /**
     * Send a daily summary
     */
    async sendDailySummary(summary) {
        return this.sendSecurityAlert({
            type: 'DAILY_SUMMARY',
            title: '📊 Kevin Daily Security Summary',
            message: `Emails scanned: ${summary.scanned}\nThreats blocked: ${summary.blocked}\nDrafts pending: ${summary.pendingDrafts}`,
            severity: 'low',
            details: summary,
            source: 'daily_summary'
        });
    }

    // =================================================================
    // Slack Integration
    // =================================================================

    async _sendSlack(alert) {
        if (!this._checkRateLimit('slack')) {
            return { success: false, error: 'Rate limited' };
        }

        const blocks = this._formatSlackBlocks(alert);

        try {
            if (this.channels.slack.webhookUrl) {
                return await this._sendSlackWebhook(blocks);
            } else if (this.channels.slack.botToken) {
                return await this._sendSlackBot(blocks);
            }
        } catch (error) {
            console.error('[KevinNotify] Slack error:', error.message);
            return { success: false, error: error.message };
        }
    }

    _formatSlackBlocks(alert) {
        const severityEmoji = {
            low: ':information_source:',
            medium: ':warning:',
            high: ':rotating_light:',
            critical: ':fire:'
        };

        return {
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: alert.title,
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `${severityEmoji[alert.severity] || ':shield:'} *Severity:* ${alert.severity.toUpperCase()}\n\n${alert.message}`
                    }
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `:robot_face: KEVIN Security | ${alert.timestamp}`
                        }
                    ]
                }
            ]
        };
    }

    async _sendSlackWebhook(payload) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.channels.slack.webhookUrl);
            const data = JSON.stringify(payload);

            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    resolve({ success: res.statusCode === 200, response: body });
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    async _sendSlackBot(payload) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                channel: this.channels.slack.defaultChannel,
                ...payload
            });

            const options = {
                hostname: 'slack.com',
                path: '/api/chat.postMessage',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.channels.slack.botToken}`,
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        resolve({ success: response.ok, response });
                    } catch {
                        resolve({ success: false, response: body });
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    // =================================================================
    // Telegram Integration
    // =================================================================

    async _sendTelegram(alert) {
        if (!this._checkRateLimit('telegram')) {
            return { success: false, error: 'Rate limited' };
        }

        const message = this._formatTelegramMessage(alert);

        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                chat_id: this.channels.telegram.chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${this.channels.telegram.botToken}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        resolve({ success: response.ok, response });
                    } catch {
                        resolve({ success: false, response: body });
                    }
                });
            });

            req.on('error', (error) => {
                console.error('[KevinNotify] Telegram error:', error.message);
                resolve({ success: false, error: error.message });
            });

            req.write(data);
            req.end();
        });
    }

    _formatTelegramMessage(alert) {
        const severityEmoji = {
            low: 'ℹ️',
            medium: '⚠️',
            high: '🚨',
            critical: '🔥'
        };

        let message = `<b>${severityEmoji[alert.severity] || '🛡️'} ${alert.title}</b>\n\n`;
        message += `<b>Severity:</b> ${alert.severity.toUpperCase()}\n`;
        message += `<b>Type:</b> ${alert.type}\n\n`;
        message += `${alert.message}\n\n`;

        if (alert.details && Object.keys(alert.details).length > 0) {
            message += '<b>Details:</b>\n';
            for (const [key, value] of Object.entries(alert.details)) {
                if (typeof value !== 'object') {
                    message += `• ${key}: ${value}\n`;
                }
            }
        }

        message += `\n🤖 <i>KEVIN Security - ${alert.timestamp}</i>`;

        return message;
    }

    // =================================================================
    // Discord Integration
    // =================================================================

    async _sendDiscord(alert) {
        if (!this._checkRateLimit('discord')) {
            return { success: false, error: 'Rate limited' };
        }

        if (!this.channels.discord.webhookUrl) {
            console.error('[KevinNotify] Discord webhook URL not configured');
            return { success: false, error: 'Discord webhook URL not configured' };
        }

        const embed = this._formatDiscordEmbed(alert);

        return new Promise((resolve, reject) => {
            try {
                const url = new URL(this.channels.discord.webhookUrl);
                const data = JSON.stringify(embed);

                console.log(`[KevinNotify] Sending to Discord webhook: ${url.hostname}${url.pathname}`);

                const options = {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data)
                    }
                };

                const req = https.request(options, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        const success = res.statusCode >= 200 && res.statusCode < 300;
                        if (!success) {
                            console.error(`[KevinNotify] Discord returned ${res.statusCode}: ${body}`);
                        } else {
                            console.log('[KevinNotify] Discord notification sent successfully');
                        }
                        resolve({ success, statusCode: res.statusCode, response: body });
                    });
                });

                req.on('error', (error) => {
                    console.error('[KevinNotify] Discord error:', error.message);
                    resolve({ success: false, error: error.message });
                });

                req.write(data);
                req.end();
            } catch (error) {
                console.error('[KevinNotify] Discord setup error:', error.message);
                resolve({ success: false, error: `Invalid Discord webhook URL: ${error.message}` });
            }
        });
    }

    _formatDiscordEmbed(alert) {
        const severityColors = {
            low: 0x3498db,      // Blue
            medium: 0xf39c12,   // Orange
            high: 0xe74c3c,     // Red
            critical: 0x9b59b6  // Purple
        };

        return {
            username: 'KEVIN Security',
            avatar_url: 'https://i.imgur.com/4M34hi2.png', // Shield icon
            embeds: [{
                title: alert.title,
                description: alert.message,
                color: severityColors[alert.severity] || 0x95a5a6,
                fields: [
                    {
                        name: 'Severity',
                        value: alert.severity.toUpperCase(),
                        inline: true
                    },
                    {
                        name: 'Type',
                        value: alert.type,
                        inline: true
                    }
                ],
                footer: {
                    text: `KEVIN Security | ${alert.timestamp}`
                }
            }]
        };
    }

    // =================================================================
    // Rate Limiting
    // =================================================================

    _checkRateLimit(channel) {
        const limit = this.rateLimits[channel];
        if (!limit) return true;

        // Reset counter if window expired
        if (Date.now() > limit.resetAt) {
            limit.count = 0;
            limit.resetAt = Date.now() + 60000;
        }

        // Check if over limit
        if (limit.count >= limit.limit) {
            return false;
        }

        limit.count++;
        return true;
    }

    // =================================================================
    // Two-Way Chat (Telegram Polling)
    // =================================================================

    startPolling() {
        if (this.channels.telegram.enabled && this.channels.telegram.botToken) {
            console.log('[KevinNotify] Starting Telegram polling...');
            this.telegramOffset = 0;
            this.pollingInterval = setInterval(() => this._pollTelegramUpdates(), 3000);
        }
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    async _pollTelegramUpdates() {
        if (!this.channels.telegram.botToken) return;

        try {
            const url = `https://api.telegram.org/bot${this.channels.telegram.botToken}/getUpdates?offset=${this.telegramOffset + 1}&timeout=10`;
            
            const req = https.get(url, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        if (response.ok && response.result.length > 0) {
                            response.result.forEach(update => {
                                this.telegramOffset = update.update_id;
                                if (update.message && update.message.text) {
                                    // Emit event for KevinArbiter
                                    if (this.events) {
                                        this.events.emit('telegram_message', {
                                            text: update.message.text,
                                            chatId: update.message.chat.id,
                                            user: update.message.from.username || update.message.from.first_name
                                        });
                                    } else {
                                        // Fallback if no event emitter attached directly (should attach in KevinArbiter)
                                        console.log(`[KevinNotify] Telegram message from ${update.message.from.username}: ${update.message.text}`);
                                    }
                                }
                            });
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                });
            });
            
            req.on('error', () => {}); // Ignore network errors during poll
            
        } catch (error) {
            // Silent fail for polling
        }
    }

    // =================================================================
    // Configuration
    // =================================================================

    /**
     * Configure a notification channel
     */
    configure(channel, config) {
        if (!this.channels[channel]) {
            return { success: false, error: 'Unknown channel' };
        }

        Object.assign(this.channels[channel], config);
        this._initializeChannels();
        this._saveConfig(); // Persist to disk

        return {
            success: true,
            channel,
            enabled: this.channels[channel].enabled
        };
    }

    /**
     * Load configuration from disk
     */
    _loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

                // Load webhooks if present
                if (saved.webhooks && Array.isArray(saved.webhooks)) {
                    this.webhooks = saved.webhooks;
                }

                // Merge saved channel config with current (env vars are defaults)
                if (this.channels) {
                    if (saved.slack) {
                        Object.assign(this.channels.slack, saved.slack);
                    }
                    if (saved.telegram) {
                        Object.assign(this.channels.telegram, saved.telegram);
                    }
                    if (saved.discord) {
                        Object.assign(this.channels.discord, saved.discord);
                    }
                }

                console.log('[KevinNotify] Loaded saved notification config');
            }
        } catch (error) {
            console.log('[KevinNotify] No saved config found, using defaults');
        }
    }

    /**
     * Save configuration to disk
     */
    _saveConfig() {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Save both webhooks array and legacy channels config
            const configToSave = {
                webhooks: this.webhooks,
                slack: {
                    enabled: this.channels.slack.enabled,
                    webhookUrl: this.channels.slack.webhookUrl,
                    botToken: this.channels.slack.botToken,
                    defaultChannel: this.channels.slack.defaultChannel
                },
                telegram: {
                    enabled: this.channels.telegram.enabled,
                    botToken: this.channels.telegram.botToken,
                    chatId: this.channels.telegram.chatId
                },
                discord: {
                    enabled: this.channels.discord.enabled,
                    webhookUrl: this.channels.discord.webhookUrl
                },
                updatedAt: new Date().toISOString()
            };

            fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
            console.log('[KevinNotify] Configuration saved');
        } catch (error) {
            console.error('[KevinNotify] Failed to save config:', error.message);
        }
    }

    /**
     * Test a notification channel
     */
    async testChannel(channel) {
        console.log(`[KevinNotify] Testing channel: ${channel}`);
        console.log(`[KevinNotify] Config state:`, this.channels[channel]);

        if (!this.channels[channel]) {
             return { success: false, error: 'Unknown channel' };
        }

        // Try to initialize if not enabled but config exists
        if (!this.channels[channel].enabled) {
             this._initializeChannels();
        }

        if (!this.channels[channel].enabled) {
            return { success: false, error: 'Channel not configured or disabled' };
        }

        const testAlert = {
            type: 'TEST',
            title: '🧪 KEVIN Test Notification',
            message: 'This is a test alert from KEVIN Security System.',
            severity: 'low',
            timestamp: new Date().toISOString(),
            details: { test: true },
            source: 'test'
        };

        switch (channel) {
            case 'slack':
                return await this._sendSlack(testAlert);
            case 'telegram':
                return await this._sendTelegram(testAlert);
            case 'discord':
                return await this._sendDiscord(testAlert);
            default:
                return { success: false, error: 'Unknown channel' };
        }
    }
}

module.exports = { KevinNotificationService };
