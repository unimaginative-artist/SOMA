import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import KevinIntentRouter from '../core/KevinIntentRouter.js';
import UserPersona from '../core/UserPersona.js';
const require = createRequire(import.meta.url);
const execAsync = promisify(exec);
const KevinPersonalityEngine = require('../core/KevinPersonalityEngine.cjs');
const { KevinEmailManager } = require('../server/utils/KevinEmailManager.cjs');
const { KevinResearchService } = require('../server/utils/KevinResearchService.cjs');
const { KevinCalendarService } = require('../server/utils/KevinCalendarService.cjs');
const { KevinThreatDatabase } = require('../server/utils/KevinThreatDatabase.cjs');
const { KevinNotificationService } = require('../server/utils/KevinNotificationService.cjs');
const { KevinPairingService } = require('../server/utils/KevinPairingService.cjs');
const { KevinGmailWebhook } = require('../server/utils/KevinGmailWebhook.cjs');
const { KevinSecurityAudit } = require('../server/utils/KevinSecurityAudit.cjs');
const { KevinSMSService } = require('../server/utils/KevinSMSService.cjs');
const { KevinHtmlSanitizer } = require('../server/utils/KevinHtmlSanitizer.cjs');

/**
 * KevinArbiter
 * 
 * Operator Guard / Security Cockpit for KEVIN.
 *
 * KEVIN is not a general assistant. He is the operator-facing control surface
 * for email/link/sender security, local watch, trust decisions, evidence-first
 * verdicts, and approval-gated actions. Personality is UX, not authority.
 */
export class KevinArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'KevinArbiter',
            role: ArbiterRole.GUARDIAN,
            capabilities: [
                ArbiterCapability.NETWORK_ACCESS,
                ArbiterCapability.READ_FILES,
                ArbiterCapability.MONITOR_HEALTH
            ]
        });
        this.tier = 'operational';

        // Event Emitter for Dashboard Compatibility
        this.events = new EventEmitter();

        this.messageBroker = opts.messageBroker;
        this.engine = new KevinPersonalityEngine(this.messageBroker);
        this.intentRouter = new KevinIntentRouter();
        this.userPersona = new UserPersona();
        this.identity = {
            name: 'K.E.V.I.N.',
            role: 'Operator Guard',
            productClass: 'Personal Security Cockpit',
            mission: 'Protect the operator at the edge: email, links, senders, local watch, trust decisions, and approval-gated actions.',
            principles: [
                'Operator-facing control surface',
                'Email/link/sender security',
                'Local system watch',
                'Approval gate for risky actions',
                'Trust graph for people, domains, apps, and files',
                'Evidence-first verdict engine',
                'Small autonomous routines, never uncontrolled autonomy',
                'Personality as UX, not the core product'
            ],
            autonomy: 'guarded',
            notA: ['general assistant', 'unbounded autonomous agent', 'replacement for dedicated enterprise security tooling']
        };
        
        // ... (rest of constructor)
        this.isOnline = false;
        this.mood = 'idle'; // idle, scanning, threat, offline
        this.emailManager = new KevinEmailManager(); // Initialize real email manager
        this.researchService = new KevinResearchService(); // Initialize research service
        this.calendarService = new KevinCalendarService(); // Initialize calendar service
        this.threatDatabase = new KevinThreatDatabase(); // Initialize threat intelligence database
        this.notificationService = new KevinNotificationService(); // Initialize notification service
        this.pairingService = new KevinPairingService(); // Sender verification via pairing codes
        this.gmailWebhook = new KevinGmailWebhook(); // Real-time Gmail notifications
        this.securityAudit = new KevinSecurityAudit(); // Security configuration validator
        this.smsService = new KevinSMSService({ emailManager: this.emailManager }); // Two-way SMS
        this.useRealEmail = false;
        this.isScanning = false;

        // Wire up SMS events
        this._setupSMSHandlers();
        // Wire up Telegram events
        this._setupTelegramHandlers();

        // Action items extracted from emails
        this.actionItems = [];
        // Meeting requests detected
        this.meetingRequests = [];

        this.stats = {
            scanned: 0,
            threats: 0,
            spam: 0,
            uptime: 0,
            startTime: 0,
            draftedReplies: 0,
            actionsExtracted: 0,
            prioritizedEmails: 0,
            timeSaved: '0m'
        };

        this.scanLogs = [];
        this.config = {
            sensitivity: 85,
            protocols: {
                heuristics: true,
                zeroTrust: true,
                toneAnalysis: true
            },
            monitored_accounts: ['redacted@example.com']
        };
        
        this.configPath = path.join(process.cwd(), '.soma', 'kevin_config.json');
        this.dataDir = path.join(process.cwd(), 'data', 'kevin');
        this.evidenceLedgerPath = path.join(this.dataDir, 'evidence-ledger.jsonl');
        this.localWatchStatePath = path.join(this.dataDir, 'local-watch-state.json');
        this.fileBaselinePath = path.join(this.dataDir, 'file-baseline.json');
        this.dependencyAuditPath = path.join(this.dataDir, 'dependency-audit.json');

        // Conversational State for SMS
        this.smsSessions = new Map(); // phone -> { lastAlertTarget, pendingAction, history }

        // Loop
        this.scanInterval = null;
    }

    async onInitialize() {
        // Load persisted config first
        await this.loadConfig();
        await this._refreshRealStats();

        this.auditLogger.info('Kevin Arbiter initialized (Operator Guard / Security Cockpit Mode)');

        // Register with MessageBroker so lobe-scoped routing works
        if (this.messageBroker && typeof this.messageBroker.registerArbiter === 'function') {
            this.messageBroker.registerArbiter(this.name, {
                role: this.role,
                capabilities: this.capabilities,
                instance: this,
                lobe: 'THALAMUS'
            });
        }

        // Check if we can use real email
        if (process.env.EMAIL_ADDRESS && process.env.APP_PASSWORD) {
            this.auditLogger.info('📧 Real Email Credentials Detected. Kevin is connecting to Gmail...');
            try {
                // Test connection
                const conn = await this.emailManager.connect();
                conn.end();
                this.useRealEmail = true;
                this.auditLogger.info('✅ Connected to Gmail successfully.');
            } catch (e) {
                this.auditLogger.warn('⚠️ Failed to connect to Gmail despite credentials. Falling back to simulation.', e.message);
            }
        }

        // Initialize calendar service
        try {
            const calendarReady = await this.calendarService.initialize();
            if (calendarReady) {
                this.auditLogger.info('📅 Google Calendar connected');
            } else {
                this.auditLogger.info('📅 Calendar not configured - place google-credentials.json in config/');
            }
        } catch (e) {
            this.auditLogger.warn('📅 Calendar initialization failed:', e.message);
        }

        // Check research service
        if (this.researchService.isConfigured()) {
            this.auditLogger.info('🔍 Tavily research service active');
        } else {
            this.auditLogger.info('🔍 Research service not configured - set TAVILY_API_KEY for deep research');
        }

        // Log threat database status
        const threatStats = this.threatDatabase.getStats();
        this.auditLogger.info(`🛡️ Threat database loaded: ${threatStats.maliciousHashes} malicious hashes, ${threatStats.phishingPatterns} patterns`);

        // Log notification service status
        const notifyStatus = this.notificationService.getStatus();
        const enabledChannels = ['slack', 'telegram', 'discord'].filter(c => notifyStatus[c]?.enabled);
        if (enabledChannels.length > 0) {
            this.auditLogger.info(`🔔 Notifications enabled: ${enabledChannels.join(', ')}`);
            // Start polling if Telegram is enabled
            if (notifyStatus.telegram?.enabled) {
                this.notificationService.startPolling();
            }
        } else {
            this.auditLogger.info('🔔 No notification channels configured - set SLACK_WEBHOOK_URL, TELEGRAM_BOT_TOKEN, or DISCORD_WEBHOOK_URL');
        }
    }

    // Compatibility wrapper for launcher_ULTRA.mjs
    on(event, handler) {
        this.events.on(event, handler);
    }

    emit(event, data) {
        this.events.emit(event, data);
    }

    // =========================================================================
    // 🎮 Control Methods
    // =========================================================================

    // Alias for start() to match KEVINManager
    async start() {
        if (!this.isOnline) this.toggle();
    }

    toggle() {
        this.isOnline = !this.isOnline;
        if (this.isOnline) {
            this.stats.startTime = Date.now();
            this.mood = 'idle';
            this.startScanLoop();
            this.auditLogger.info('Kevin activated');
            this.emit('status', 'running');
        } else {
            this.stopScanLoop();
            this.mood = 'offline';
            this.auditLogger.info('Kevin deactivated');
            this.emit('status', 'stopped');
        }
        return { status: this.isOnline ? 'started' : 'stopped' };
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            const savedConfig = JSON.parse(data);
            this.config = { ...this.config, ...savedConfig };
            
            // Migrate legacy saved credentials for this process only, then remove secrets from disk.
            if (this.config.email && this.config.password && !process.env.APP_PASSWORD) {
                process.env.EMAIL_ADDRESS = this.config.email;
                process.env.APP_PASSWORD = this.config.password;
            }
            if (this.config.password || this.config.appPassword || this.config.token) {
                delete this.config.password;
                delete this.config.appPassword;
                delete this.config.token;
                await this.saveConfig();
                this.auditLogger.warn('Kevin config contained persisted secrets. Migrated current process and scrubbed config file.');
            }
            
            this.auditLogger.info('Kevin configuration loaded from disk');
        } catch (e) {
            this.auditLogger.info('No existing Kevin config found, using defaults');
        }
    }

    _redactConfig(config = this.config) {
        const clone = JSON.parse(JSON.stringify(config || {}));
        for (const key of ['password', 'appPassword', 'token', 'apiKey', 'secret']) {
            if (clone[key]) clone[key] = '***';
        }
        if (clone.email) {
            const [name, domain] = String(clone.email).split('@');
            clone.email = domain ? `${name.slice(0, 2)}***@${domain}` : '***';
        }
        clone.credentials = {
            emailConfigured: !!process.env.EMAIL_ADDRESS,
            appPasswordConfigured: !!process.env.APP_PASSWORD,
            source: process.env.APP_PASSWORD ? 'environment' : 'not_configured'
        };
        return clone;
    }

    async saveConfig() {
        try {
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            const persisted = { ...this.config };
            delete persisted.password;
            delete persisted.appPassword;
            delete persisted.token;
            delete persisted.apiKey;
            delete persisted.secret;
            await fs.writeFile(this.configPath, JSON.stringify(persisted, null, 2));
            this.auditLogger.info('Kevin configuration saved to disk');
        } catch (e) {
            this.auditLogger.error('Failed to save Kevin config:', e);
        }
    }

    async updateConfig(newConfig) {
        const sanitized = { ...newConfig };
        
        // Accept credentials for this process, but never persist app passwords/tokens.
        if (sanitized.email) {
            process.env.EMAIL_ADDRESS = sanitized.email;
        }
        if (sanitized.password || sanitized.appPassword) {
            process.env.APP_PASSWORD = sanitized.password || sanitized.appPassword;
        }
        delete sanitized.password;
        delete sanitized.appPassword;
        delete sanitized.token;
        delete sanitized.apiKey;
        delete sanitized.secret;

        this.config = { ...this.config, ...sanitized };

        await this.saveConfig();
        this.auditLogger.info('Kevin configuration updated and saved');
        return { success: true, config: this._redactConfig() };
    }

    async _appendEvidence(event = {}) {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            const record = {
                id: event.id || `kev_ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                timestamp: new Date().toISOString(),
                source: event.source || 'kevin',
                type: event.type || 'event',
                target: event.target || null,
                verdict: event.verdict || null,
                score: Number(event.score || 0),
                decision: event.decision || null,
                reversible: event.reversible !== false,
                requiresApproval: !!event.requiresApproval,
                evidence: Array.isArray(event.evidence) ? event.evidence.slice(0, 20) : [],
                metadata: event.metadata || {}
            };
            await fs.appendFile(this.evidenceLedgerPath, `${JSON.stringify(record)}\n`);
            return record;
        } catch (error) {
            this.auditLogger.warn(`Kevin evidence ledger write failed: ${error.message}`);
            return null;
        }
    }

    async _readEvidenceLedger(limit = 500) {
        try {
            const raw = await fs.readFile(this.evidenceLedgerPath, 'utf8');
            return raw
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-Math.max(1, Number(limit) || 500))
                .map(line => JSON.parse(line));
        } catch {
            return [];
        }
    }

    async _refreshRealStats() {
        const evidence = await this._readEvidenceLedger(1000);
        const scans = evidence.filter(e => ['email_verdict', 'link_verdict', 'local_watch', 'security_audit'].includes(e.type));
        const threats = evidence.filter(e => ['block', 'high_risk', 'threat', 'critical'].includes(String(e.verdict || e.decision || '').toLowerCase()));
        const spam = evidence.filter(e => String(e.verdict || e.decision || '').toLowerCase().includes('spam'));
        this.stats.scanned = Math.max(this.scanLogs.length, scans.length);
        this.stats.threats = threats.length;
        this.stats.spam = spam.length;
        this.stats.draftedReplies = this.emailManager?.draftQueue?.filter?.(d => d.status !== 'rejected').length || this.stats.draftedReplies || 0;
        this.stats.actionsExtracted = this.actionItems.length + this.meetingRequests.length;
        this.stats.prioritizedEmails = this.scanLogs.filter(log => ['threat', 'blocked', 'warning'].includes(log.status)).length;
        const minutesSaved = Math.max(0, (this.stats.draftedReplies * 4) + (this.stats.actionsExtracted * 3) + (this.stats.spam * 1));
        this.stats.timeSaved = minutesSaved >= 60 ? `${Math.floor(minutesSaved / 60)}h ${minutesSaved % 60}m` : `${minutesSaved}m`;
        return this.stats;
    }

    async getEvidenceLedger(limit = 100) {
        return {
            success: true,
            events: (await this._readEvidenceLedger(limit)).reverse()
        };
    }

    getReputationCache() {
        return this.threatDatabase?.getReputationCache?.() || { success: true, senders: [], domains: [] };
    }

    getCapabilities() {
        const notificationStatus = this.notificationService?.getStatus?.() || {};
        const notificationChannels = ['slack', 'telegram', 'discord'].reduce((channels, channel) => {
            channels[channel] = !!notificationStatus[channel]?.enabled;
            return channels;
        }, {});

        return {
            success: true,
            identity: this.identity,
            agentic: {
                enabled: true,
                autonomy: 'guarded',
                requiresApprovalFor: [
                    'sending email replies',
                    'creating calendar events',
                    'blocking senders',
                    'external notifications'
                ]
            },
            surfaces: {
                operatorControl: true,
                emailLinkSenderSecurity: true,
                localSystemWatch: true,
                approvalGate: true,
                trustGraph: {
                    people: true,
                    domains: true,
                    apps: false,
                    files: false
                },
                evidenceFirstVerdicts: typeof this.threatDatabase?.buildEmailVerdict === 'function',
                smallAutonomousRoutines: true,
                personalityAsUx: true
            },
            core: {
                online: this.isOnline,
                mood: this.mood,
                personality: !!this.engine,
                simulationLoop: !!this.scanInterval
            },
            integrations: {
                email: {
                    configured: !!(process.env.EMAIL_ADDRESS && process.env.APP_PASSWORD),
                    connected: this.useRealEmail,
                    monitoredAccounts: this.config?.monitored_accounts?.length || 0
                },
                calendar: {
                    configured: !!this.calendarService?.isConfigured,
                    pendingActions: this.calendarService?.getPendingActions?.().length || 0
                },
                research: {
                    configured: !!this.researchService?.isConfigured?.()
                },
                notifications: {
                    configured: Object.values(notificationChannels).some(Boolean),
                    channels: notificationChannels
                },
                sms: {
                    configured: !!this.smsService?.isConfigured?.(),
                    available: !!this.smsService
                },
                userPersona: {
                    available: !!this.userPersona
                },
                threatDatabase: {
                    available: !!this.threatDatabase,
                    stats: this.threatDatabase?.getStats?.() || null,
                    structuredVerdicts: typeof this.threatDatabase?.buildEmailVerdict === 'function',
                    reversibleTrust: typeof this.threatDatabase?.unblockSender === 'function'
                }
            },
            actions: {
                chat: typeof this.chat === 'function',
                think: typeof this.think === 'function',
                routeIntent: !!this.intentRouter,
                userStyleDrafting: !!this.userPersona,
                draftReplies: typeof this.draftParanoidReply === 'function',
                approveDrafts: typeof this.approveDraft === 'function',
                investigateSenders: typeof this.investigateSender === 'function',
                investigateDomains: typeof this.investigateDomain === 'function',
                investigateUrls: typeof this.investigateUrl === 'function',
                securityVerdicts: typeof this.buildSecurityVerdict === 'function',
                reversibleTrust: typeof this.getTrustState === 'function',
                calendarEvents: typeof this.createCalendarEvent === 'function',
                actionItems: typeof this.getActionItems === 'function',
                meetingRequests: typeof this.getMeetingRequests === 'function'
            }
        };
    }

    async getCockpitSummary() {
        const threatStats = this.threatDatabase?.getStats?.() || {};
        const trustState = this.threatDatabase?.getTrustState?.() || { safeSenders: [], blockedSenders: [], recentDecisions: [] };
        const calendarStatus = this.getCalendarStatus?.() || {};
        const drafts = this.emailManager?.getDrafts?.() || [];
        const auditFindings = this.securityAudit?.getFindings?.() || [];
        const criticalFindings = auditFindings.filter(f => f.severity === 'critical');

        return {
            success: true,
            identity: this.identity,
            online: this.isOnline,
            mood: this.mood,
            localWatch: {
                enabled: true,
                mode: this.useRealEmail ? 'email_and_local_watch' : 'local_scrutiny',
                recentFindings: auditFindings.slice(-10),
                critical: criticalFindings.length
            },
            approvals: {
                draftReplies: drafts.length,
                calendar: calendarStatus.pendingActions || 0,
                meetingRequests: this.meetingRequests.filter(r => r.status === 'pending_review').length,
                actionItems: this.actionItems.filter(i => i.status === 'pending').length
            },
            trustGraph: {
                people: {
                    safe: trustState.safeSenders?.length || 0,
                    blocked: trustState.blockedSenders?.length || 0
                },
                domains: this._getDomainTrustCounts(trustState),
                apps: this._getObservedAppCounts(),
                files: await this._getObservedFileCounts(),
                recentDecisions: trustState.recentDecisions || []
            },
            verdictEngine: {
                structured: typeof this.threatDatabase?.buildEmailVerdict === 'function',
                maliciousHashes: threatStats.maliciousHashes || 0,
                phishingPatterns: threatStats.phishingPatterns || 0,
                decisions: threatStats.decisions || 0
            },
            autonomy: {
                level: 'guarded',
                allowedWithoutApproval: ['scan', 'classify', 'summarize evidence', 'draft pending review'],
                requiresApproval: this.identity.principles.includes('Approval gate for risky actions')
                    ? ['send email', 'create calendar event', 'block sender', 'trust sender', 'external notification']
                    : []
            }
        };
    }

    async getPendingApprovals() {
        const drafts = this.emailManager?.getDrafts?.() || [];
        const calendar = this.calendarService?.getPendingActions?.() || [];
        const meetings = this.meetingRequests.filter(r => r.status === 'pending_review');
        const reviewEvents = (await this._readEvidenceLedger(80))
            .filter(event => event.requiresApproval || Number(event.score || 0) >= 55 || ['block', 'high_risk', 'caution'].includes(String(event.verdict || '').toLowerCase()))
            .slice(0, 20);

        return {
            success: true,
            approvals: [
                ...drafts.map(draft => ({
                    id: draft.id || draft.draftId || `draft_${draft.createdAt || Date.now()}`,
                    type: 'draft_reply',
                    title: draft.subject || 'Email draft',
                    target: draft.to || draft.recipient || 'unknown',
                    evidence: draft.metadata?.threatLevel?.verdict?.evidence || [],
                    confidence: draft.metadata?.threatLevel?.verdict?.confidence || null,
                    recommendedAction: 'Review the body before sending.',
                    reversible: true,
                    raw: draft
                })),
                ...calendar.map(item => ({
                    id: item.id || item.pendingId,
                    type: 'calendar_event',
                    title: item.summary || item.title || 'Calendar event',
                    target: item.attendees?.join?.(', ') || 'calendar',
                    evidence: [{ type: 'approval_gate', severity: 'medium', detail: 'Calendar changes require operator approval.' }],
                    recommendedAction: 'Approve only after attendee/time verification.',
                    reversible: true,
                    raw: item
                })),
                ...meetings.map(request => ({
                    id: request.id,
                    type: 'meeting_request',
                    title: request.email?.subject || 'Meeting request',
                    target: request.email?.from || 'unknown sender',
                    evidence: [{ type: 'extracted_meeting', severity: 'low', detail: `Confidence ${Math.round((request.confidence || 0) * 100)}%` }],
                    confidence: request.confidence || null,
                    recommendedAction: 'Schedule only after confirming details.',
                    reversible: true,
                    raw: request
                })),
                ...reviewEvents.map(event => ({
                    id: event.id,
                    type: 'security_review',
                    title: event.target || event.type || 'Security review',
                    target: event.source || event.target || 'evidence ledger',
                    evidence: event.evidence || [],
                    confidence: event.confidence || null,
                    score: event.score,
                    verdict: event.verdict,
                    recommendedAction: event.decision || 'Review evidence before trusting or acting.',
                    reversible: true,
                    timestamp: event.timestamp,
                    raw: event
                }))
            ]
        };
    }

    _getDomainTrustCounts(trustState = {}) {
        const safe = new Set();
        const blocked = new Set();
        for (const sender of trustState.safeSenders || []) {
            const domain = String(sender).split('@')[1];
            if (domain) safe.add(domain);
        }
        for (const sender of trustState.blockedSenders || []) {
            const domain = String(sender).split('@')[1];
            if (domain) blocked.add(domain);
        }
        return { safe: safe.size, blocked: blocked.size, observed: safe.size + blocked.size };
    }

    _getObservedAppCounts() {
        return {
            watched: 0,
            observed: this.scanLogs.filter(log => log.type === 'process' || log.type === 'port').length,
            source: 'local_watch'
        };
    }

    async _getObservedFileCounts() {
        try {
            const state = JSON.parse(await fs.readFile(this.localWatchStatePath, 'utf8'));
            return {
                watched: Number(state.filesWatched || 0),
                observed: Number(state.riskyFiles || 0),
                source: 'local_watch'
            };
        } catch {
            return { watched: 0, observed: 0, source: 'not_scanned' };
        }
    }

    async getTrustGraph() {
        const trustState = this.threatDatabase?.getTrustState?.() || { safeSenders: [], blockedSenders: [], recentDecisions: [] };
        const nodes = [
            { id: 'operator', label: 'Operator', type: 'operator', status: 'root' },
            { id: 'kevin', label: 'KEVIN', type: 'guard', status: 'active' }
        ];
        const edges = [{ source: 'operator', target: 'kevin', relation: 'delegates_guard' }];
        const domainIds = new Set();

        const addSender = (sender, status) => {
            const senderId = `sender:${sender}`;
            nodes.push({ id: senderId, label: sender, type: 'person', status });
            edges.push({ source: 'kevin', target: senderId, relation: status === 'blocked' ? 'blocks' : 'trusts' });

            const domain = String(sender).split('@')[1];
            if (domain) {
                const domainId = `domain:${domain}`;
                if (!domainIds.has(domainId)) {
                    domainIds.add(domainId);
                    nodes.push({ id: domainId, label: domain, type: 'domain', status: 'observed' });
                }
                edges.push({ source: senderId, target: domainId, relation: 'uses_domain' });
            }
        };

        trustState.safeSenders?.forEach(sender => addSender(sender, 'safe'));
        trustState.blockedSenders?.forEach(sender => addSender(sender, 'blocked'));

        const localWatch = await this.getLocalWatchSummary();
        for (const finding of localWatch.findings || []) {
            const findingId = `finding:${finding.type}`;
            nodes.push({ id: findingId, label: finding.type, type: 'finding', status: finding.severity || 'observed' });
            edges.push({ source: 'kevin', target: findingId, relation: 'observes' });
            for (const item of finding.items || []) {
                const itemId = `file:${item}`;
                nodes.push({ id: itemId, label: item, type: 'file', status: finding.severity || 'observed' });
                edges.push({ source: findingId, target: itemId, relation: 'contains' });
            }
        }

        return { success: true, nodes, edges, recentDecisions: trustState.recentDecisions || [] };
    }

    async getVerdictTimeline(limit = 50) {
        const trustState = this.threatDatabase?.getTrustState?.() || { recentDecisions: [] };
        const scanEvents = (this.scanLogs || []).map(log => ({
            id: `scan_${log.id || log.time}`,
            type: 'scan',
            timestamp: log.timestamp || log.time || new Date().toISOString(),
            title: log.subject || 'Email scan',
            verdict: log.status || 'unknown',
            score: log.threatLevel || 0,
            target: log.from || log.sender || null,
            evidence: log.indicators || []
        }));
        const decisionEvents = (trustState.recentDecisions || []).map(decision => ({
            id: decision.id,
            type: 'trust_decision',
            timestamp: decision.timestamp,
            title: decision.action,
            verdict: decision.action,
            target: decision.target,
            evidence: [decision.metadata]
        }));

        const evidenceEvents = (await this._readEvidenceLedger(Number(limit) || 50)).map(event => ({
            id: event.id,
            type: event.type,
            timestamp: event.timestamp,
            title: event.target || event.type,
            verdict: event.verdict || event.decision || 'observed',
            score: event.score,
            target: event.target,
            evidence: event.evidence || []
        }));

        return {
            success: true,
            events: [...scanEvents, ...decisionEvents, ...evidenceEvents]
                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                .slice(0, Number(limit) || 50)
        };
    }

    async getLocalWatchSummary() {
        const root = process.cwd();
        const findings = [];
        const hiddenAllow = new Set(['.git', '.env', '.soma', '.gemini', '.claude', '.gitignore', '.gitattributes', '.gitmodules', '.npmrc']);
        let files = [];

        try {
            files = await fs.readdir(root, { withFileTypes: true });
            const unexpectedHidden = files
                .filter(f => f.name.startsWith('.') && !hiddenAllow.has(f.name))
                .map(f => f.name);
            if (unexpectedHidden.length) {
                findings.push({
                    severity: 'medium',
                    type: 'unexpected_hidden_files',
                    detail: `${unexpectedHidden.length} unexpected hidden root artifact(s)`,
                    items: unexpectedHidden.slice(0, 10)
                });
            }

            const riskyRootFiles = files
                .filter(f => /\.(exe|bat|cmd|ps1|vbs|scr|msi)$/i.test(f.name))
                .map(f => f.name);
            if (riskyRootFiles.length) {
                findings.push({
                    severity: 'medium',
                    type: 'root_executables',
                    detail: `${riskyRootFiles.length} executable/script artifact(s) in project root`,
                    items: riskyRootFiles.slice(0, 10)
                });
            }

            const secretCandidates = files
                .filter(f => f.isFile() && /\.(json|env|yml|yaml|txt|log)$/i.test(f.name))
                .map(f => path.join(root, f.name));
            const secretHits = [];
            const secretPattern = /\b(password|app[_-]?password|api[_-]?key|secret|token|bearer|sk-[A-Za-z0-9_-]{16,})\b/i;
            for (const filePath of secretCandidates.slice(0, 40)) {
                try {
                    const stat = await fs.stat(filePath);
                    if (stat.size > 1_000_000) continue;
                    const content = await fs.readFile(filePath, 'utf8');
                    if (secretPattern.test(content)) {
                        secretHits.push(path.basename(filePath));
                    }
                } catch {}
            }
            if (secretHits.length) {
                findings.push({
                    severity: 'high',
                    type: 'secret_marker_in_root_file',
                    detail: `${secretHits.length} root file(s) contain credential-like markers`,
                    items: secretHits.slice(0, 10)
                });
            }

            if (files.some(f => f.name === 'package-lock.json')) {
                const audit = await this._runDependencyAudit();
                findings.push({
                    severity: audit.summary?.critical || audit.summary?.high ? 'high' : audit.totalVulnerabilities ? 'medium' : 'info',
                    type: 'dependency_audit',
                    detail: audit.totalVulnerabilities
                        ? `${audit.totalVulnerabilities} dependency vulnerability finding(s)`
                        : 'No dependency vulnerabilities reported by npm audit',
                    items: audit.topFindings || ['package-lock.json'],
                    audit
                });
            }
        } catch (error) {
            findings.push({ severity: 'low', type: 'watch_error', detail: error.message });
        }

        const baseline = await this._checkFileBaseline();
        if (baseline.changed.length || baseline.missing.length || baseline.created) {
            findings.push({
                severity: baseline.created ? 'info' : 'medium',
                type: baseline.created ? 'file_baseline_created' : 'file_baseline_changed',
                detail: baseline.created
                    ? `${baseline.files.length} important file baseline(s) created`
                    : `${baseline.changed.length} important file(s) changed, ${baseline.missing.length} missing`,
                items: [...baseline.changed, ...baseline.missing].slice(0, 12)
            });
        }

        const listeningPorts = await this._getListeningPorts();
        const riskyPorts = listeningPorts.filter(port => {
            const local = String(port.localAddress || '');
            const p = Number(port.port);
            const globallyBound = local === '0.0.0.0' || local === '::' || local === '*';
            return globallyBound && [22, 80, 443, 3000, 3001, 3389, 8080, 8081].includes(p);
        });
        if (riskyPorts.length) {
            findings.push({
                severity: 'medium',
                type: 'globally_bound_sensitive_ports',
                detail: `${riskyPorts.length} sensitive local port(s) appear globally bound`,
                items: riskyPorts.slice(0, 10).map(p => `${p.localAddress}:${p.port}`)
            });
        }

        const envFlags = ['EMAIL_ADDRESS', 'APP_PASSWORD', 'TAVILY_API_KEY', 'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL']
            .filter(key => !!process.env[key])
            .map(key => ({ key, configured: true }));

        const state = {
            updatedAt: new Date().toISOString(),
            filesWatched: files.length,
            riskyFiles: findings.filter(f => /file|secret|executable/i.test(f.type)).reduce((sum, f) => sum + (f.items?.length || 1), 0),
            listeningPorts: listeningPorts.length,
            findings: findings.length
        };
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.localWatchStatePath, JSON.stringify(state, null, 2));
        } catch {}

        return {
            success: true,
            root,
            mode: this.useRealEmail ? 'email_and_local_watch' : 'local_scrutiny',
            uptime: Math.floor(process.uptime()),
            process: {
                pid: process.pid,
                platform: process.platform,
                node: process.version,
                memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
            },
            envFlags,
            findings,
            listeningPorts: listeningPorts.slice(0, 25),
            status: findings.some(f => f.severity === 'critical') ? 'critical' : findings.length ? 'watch' : 'clean'
        };
    }

    async _getListeningPorts() {
        try {
            if (process.platform === 'win32') {
                const { stdout } = await execAsync('powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"', { timeout: 5000 });
                const parsed = stdout.trim() ? JSON.parse(stdout) : [];
                return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({
                    localAddress: row.LocalAddress,
                    port: Number(row.LocalPort),
                    pid: Number(row.OwningProcess)
                })).filter(row => row.port);
            }
            const { stdout } = await execAsync('netstat -tunlp 2>/dev/null || netstat -an', { timeout: 5000 });
            return stdout.split(/\r?\n/)
                .filter(line => /\bLISTEN\b/i.test(line))
                .map(line => {
                    const parts = line.trim().split(/\s+/);
                    const address = parts[3] || parts[0] || '';
                    const port = Number((address.match(/:(\d+)$/) || [])[1]);
                    const localAddress = address.replace(/:\d+$/, '');
                    return { localAddress, port, raw: line };
                })
                .filter(row => row.port);
        } catch (error) {
            return [{ localAddress: 'unknown', port: 0, error: error.message }].filter(row => row.port);
        }
    }

    async getDependencyAuditStatus(force = false) {
        return this._runDependencyAudit({ force });
    }

    async resetFileBaseline() {
        try {
            await fs.rm(this.fileBaselinePath, { force: true });
        } catch {}
        const baseline = await this._checkFileBaseline();
        await this._appendEvidence({
            type: 'file_baseline',
            source: 'kevin.fileBaseline',
            target: 'important_files',
            verdict: 'allow',
            score: 0,
            decision: 'operator_rebaseline',
            evidence: [{ type: 'baseline_reset', severity: 'info', detail: `${baseline.files.length} important file baseline(s) reset` }],
            requiresApproval: false
        });
        return { success: true, baseline };
    }

    async _runDependencyAudit(options = {}) {
        try {
            const lockPath = path.join(process.cwd(), 'package-lock.json');
            let lockHash = null;
            try {
                const lockData = await fs.readFile(lockPath);
                lockHash = crypto.createHash('sha256').update(lockData).digest('hex');
            } catch {
                return { success: true, skipped: true, reason: 'No package-lock.json found', totalVulnerabilities: 0, summary: {}, topFindings: [] };
            }

            if (!options.force) {
                try {
                    const cached = JSON.parse(await fs.readFile(this.dependencyAuditPath, 'utf8'));
                    const ageMs = Date.now() - new Date(cached.generatedAt || 0).getTime();
                    if (cached.lockHash === lockHash && ageMs < 6 * 60 * 60 * 1000) {
                        return { ...cached, cached: true };
                    }
                } catch {}
            }

            const { stdout } = await execAsync('npm audit --json', { cwd: process.cwd(), timeout: 25000, maxBuffer: 8 * 1024 * 1024 });
            return this._normalizeNpmAudit(stdout, lockHash);
        } catch (error) {
            const stdout = error.stdout || '';
            let lockHash = null;
            try {
                const lockData = await fs.readFile(path.join(process.cwd(), 'package-lock.json'));
                lockHash = crypto.createHash('sha256').update(lockData).digest('hex');
            } catch {}
            if (stdout) return this._normalizeNpmAudit(stdout, lockHash);
            return {
                success: false,
                error: error.message,
                totalVulnerabilities: 0,
                summary: {},
                topFindings: []
            };
        }
    }

    async _normalizeNpmAudit(raw, lockHash = null) {
        try {
            const parsed = JSON.parse(raw || '{}');
            const vulnerabilities = parsed.vulnerabilities || {};
            const summary = parsed.metadata?.vulnerabilities || {};
            const topFindings = Object.entries(vulnerabilities)
                .sort(([, a], [, b]) => (b.cvss?.score || 0) - (a.cvss?.score || 0))
                .slice(0, 10)
                .map(([name, item]) => `${name}: ${item.severity || 'unknown'}`);
            const totalVulnerabilities = Number(summary.total ?? ['critical', 'high', 'moderate', 'low', 'info']
                .reduce((sum, key) => sum + (Number(summary[key]) || 0), 0));
            const result = {
                success: true,
                totalVulnerabilities,
                summary,
                topFindings,
                lockHash,
                generatedAt: new Date().toISOString()
            };
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.dependencyAuditPath, JSON.stringify(result, null, 2));
            if (totalVulnerabilities > 0) {
                await this._appendEvidence({
                    type: 'dependency_audit',
                    source: 'kevin.npmAudit',
                    target: 'package-lock.json',
                    verdict: summary.critical || summary.high ? 'high_risk' : 'caution',
                    score: Math.min(100, (summary.critical || 0) * 30 + (summary.high || 0) * 20 + (summary.moderate || 0) * 8 + (summary.low || 0) * 3),
                    decision: 'review_dependency_vulnerabilities',
                    evidence: topFindings.map(detail => ({ type: 'npm_vulnerability', severity: 'medium', detail })),
                    requiresApproval: false,
                    metadata: summary
                });
            }
            return result;
        } catch (error) {
            return { success: false, error: error.message, totalVulnerabilities: 0, summary: {}, topFindings: [] };
        }
    }

    async _checkFileBaseline() {
        const watched = [
            '.env',
            'config/api-keys.env',
            '.soma/kevin_config.json',
            'server/routes/kevinRoutes.js',
            'arbiters/KevinArbiter.js',
            'server/utils/KevinThreatDatabase.cjs',
            'server/utils/KevinEmailManager.cjs',
            'package.json',
            'package-lock.json'
        ];
        const current = {};
        for (const rel of watched) {
            const abs = path.join(process.cwd(), rel);
            try {
                const data = await fs.readFile(abs);
                current[rel] = crypto.createHash('sha256').update(data).digest('hex');
            } catch {}
        }
        let previous = null;
        try {
            previous = JSON.parse(await fs.readFile(this.fileBaselinePath, 'utf8'));
        } catch {}
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this.fileBaselinePath, JSON.stringify({ updatedAt: new Date().toISOString(), files: current }, null, 2));
        if (!previous?.files) {
            return { created: true, files: Object.keys(current), changed: [], missing: [] };
        }
        const changed = Object.keys(current).filter(file => previous.files[file] && previous.files[file] !== current[file]);
        const missing = Object.keys(previous.files).filter(file => !current[file]);
        if (changed.length || missing.length) {
            await this._appendEvidence({
                type: 'file_baseline',
                source: 'kevin.fileBaseline',
                target: 'important_files',
                verdict: 'caution',
                score: Math.min(100, changed.length * 15 + missing.length * 20),
                decision: 'review_file_changes',
                evidence: [
                    ...changed.map(file => ({ type: 'file_changed', severity: 'medium', detail: file })),
                    ...missing.map(file => ({ type: 'file_missing', severity: 'medium', detail: file }))
                ],
                requiresApproval: false
            });
        }
        return { created: false, files: Object.keys(current), changed, missing };
    }

    async inspectLinkLite(url) {
        if (!url) return { success: false, error: 'url required' };

        const evidence = [];
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            const malformed = {
                success: true,
                verdict: 'caution',
                score: 35,
                evidence: [{ type: 'malformed_url', severity: 'medium', detail: 'URL could not be parsed' }],
                recommendedAction: 'Do not open until the URL is corrected and verified.'
            };
            await this._appendEvidence({
                type: 'link_verdict',
                source: 'kevin.linkInspector',
                target: url,
                verdict: malformed.verdict,
                score: malformed.score,
                decision: malformed.recommendedAction,
                evidence: malformed.evidence,
                requiresApproval: true
            });
            return malformed;
        }

        const hostname = parsed.hostname.toLowerCase();
        let score = 0;
        const suspiciousTlds = ['.xyz', '.top', '.buzz', '.click', '.loan', '.work'];
        const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly'];

        if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
            score += 35;
            evidence.push({ type: 'ip_url', severity: 'high', detail: 'Hostname is a raw IP address' });
        }
        if (suspiciousTlds.some(tld => hostname.endsWith(tld))) {
            score += 25;
            evidence.push({ type: 'suspicious_tld', severity: 'medium', detail: hostname });
        }
        if (shorteners.includes(hostname)) {
            score += 20;
            evidence.push({ type: 'url_shortener', severity: 'medium', detail: hostname });
        }
        if (hostname.startsWith('xn--')) {
            score += 35;
            evidence.push({ type: 'punycode', severity: 'high', detail: 'Possible homograph domain' });
        }
        if (parsed.protocol !== 'https:') {
            score += 15;
            evidence.push({ type: 'non_https', severity: 'low', detail: parsed.protocol });
        }

        const redirectChain = [];
        if (typeof fetch === 'function') {
            try {
                let current = url;
                for (let i = 0; i < 4; i++) {
                    const response = await fetch(current, { method: 'HEAD', redirect: 'manual' });
                    redirectChain.push({ url: current, status: response.status, location: response.headers.get('location') || null });
                    const location = response.headers.get('location');
                    if (!location || response.status < 300 || response.status >= 400) break;
                    current = new URL(location, current).toString();
                }
                if (redirectChain.length > 1) {
                    score += 10;
                    evidence.push({ type: 'redirect_chain', severity: 'low', detail: `${redirectChain.length - 1} redirect(s)` });
                }
            } catch (error) {
                evidence.push({ type: 'metadata_fetch_failed', severity: 'info', detail: error.message });
            }
        }

        score = Math.min(score, 100);
        const verdict = score >= 70 ? 'high_risk' : score >= 30 ? 'caution' : 'allow';
        const result = {
            success: true,
            url,
            hostname,
            verdict,
            score,
            confidence: evidence.length ? 0.76 : 0.55,
            evidence,
            redirectChain,
            recommendedAction: verdict === 'allow' ? 'No obvious URL risk from metadata.' : 'Verify before opening; do not enter credentials.'
        };
        await this._appendEvidence({
            type: 'link_verdict',
            source: 'kevin.linkInspector',
            target: url,
            verdict,
            score,
            decision: result.recommendedAction,
            evidence,
            requiresApproval: verdict !== 'allow',
            metadata: { hostname, redirectChain }
        });
        await this._refreshRealStats();
        return result;
    }

    async getSecurityBriefing() {
        const cockpit = await this.getCockpitSummary();
        const localWatch = await this.getLocalWatchSummary();
        const timeline = await this.getVerdictTimeline(10);
        const approvalsTotal = Object.values(cockpit.approvals || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const unknownSenders = (this.scanLogs || []).filter(log => !log.from && !log.sender).length;

        return {
            success: true,
            title: 'KEVIN Security Briefing',
            generatedAt: new Date().toISOString(),
            summary: [
                `${approvalsTotal} pending approval(s)`,
                `${cockpit.trustGraph.people.safe} safe sender(s), ${cockpit.trustGraph.people.blocked} blocked sender(s)`,
                `Local watch: ${localWatch.status}`,
                `${timeline.events.length} recent verdict event(s)`
            ],
            priorities: [
                ...(approvalsTotal ? ['Review pending approval queue'] : []),
                ...(localWatch.findings.length ? ['Review local watch findings'] : []),
                ...(unknownSenders ? ['Classify unknown senders'] : [])
            ],
            cockpit,
            localWatch,
            timeline: timeline.events
        };
    }

    getReputationMemory() {
        const trustState = this.threatDatabase?.getTrustState?.() || { safeSenders: [], blockedSenders: [], recentDecisions: [] };
        const reputation = new Map();

        const ensure = target => {
            if (!reputation.has(target)) {
                reputation.set(target, {
                    target,
                    safeInteractions: 0,
                    suspiciousInteractions: 0,
                    reversals: 0,
                    firstSeen: null,
                    lastSeen: null,
                    confidenceTrend: 'unknown'
                });
            }
            return reputation.get(target);
        };

        trustState.safeSenders?.forEach(sender => {
            const row = ensure(sender);
            row.safeInteractions++;
            row.confidenceTrend = 'trusted';
        });
        trustState.blockedSenders?.forEach(sender => {
            const row = ensure(sender);
            row.suspiciousInteractions++;
            row.confidenceTrend = 'blocked';
        });
        trustState.recentDecisions?.forEach(decision => {
            const row = ensure(decision.target);
            row.lastSeen = decision.timestamp;
            if (!row.firstSeen) row.firstSeen = decision.timestamp;
            if (String(decision.action).startsWith('un')) row.reversals++;
        });

        return { success: true, reputation: [...reputation.values()] };
    }

    createPairingChallenge(sender, metadata = {}) {
        return this.createPairingRequest(sender, metadata);
    }

    async rewriteInUserStyle(text, guidance = '') {
        if (!text) return { success: false, error: 'text required' };
        const instructions = await this.userPersona.getDraftingInstructions({ userGuidance: guidance });
        const prompt = `${instructions}\n\nRewrite this text in the operator's voice. Return only the rewritten text:\n\n${text}`;
        let rewritten = '';

        try {
            if (this.quadBrain) {
                const result = await this.quadBrain.reason(prompt, { temperature: 0.55, brain: 'aurora' });
                rewritten = result.response || result.text || '';
            } else if (this.messageBroker) {
                const response = await this.messageBroker.request('brain', {
                    action: 'generate',
                    prompt,
                    options: { temperature: 0.55 }
                });
                rewritten = response?.text || response?.response || '';
            }
        } catch (error) {
            this.auditLogger.warn('User style rewrite fell back:', error.message);
        }

        if (!rewritten) {
            rewritten = String(text)
                .replace(/\bI(?:'|’)ve analyzed\b/gi, 'I looked over')
                .replace(/\bthreat indicators\b/gi, 'concerns')
                .replace(/\bKEVIN\b/g, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
        }

        return { success: true, rewritten, persona: await this.userPersona.getProfile() };
    }

    async reloadCredentials() {
        this.auditLogger.info('🔄 Kevin reloading credentials from environment...');

        // Re-initialize manager with new process.env
        this.emailManager = new KevinEmailManager();

        // Clean up old SMS service timers before instantiating a new one
        if (this.smsService && typeof this.smsService.cleanup === 'function') {
            this.smsService.cleanup();
        }

        // Re-initialize SMS service with new email manager to pick up credentials
        this.smsService = new KevinSMSService({ emailManager: this.emailManager });
        this._setupSMSHandlers(); // Re-attach event listeners

        // Re-initialize notification service to pick up new env vars
        this.notificationService = new KevinNotificationService();
        const notifyStatus = this.notificationService.getStatus();
        const enabledChannels = ['slack', 'telegram', 'discord'].filter(c => notifyStatus[c]?.enabled);
        if (enabledChannels.length > 0) {
            this.auditLogger.info(`🔔 Notification channels reloaded: ${enabledChannels.join(', ')}`);
        }

        if (process.env.EMAIL_ADDRESS && process.env.APP_PASSWORD) {
            try {
                this.auditLogger.info('📨 Testing new email credentials...');
                const conn = await this.emailManager.connect();
                conn.end();
                this.useRealEmail = true;
                this.auditLogger.info('✅ New credentials verified. Switched to Real Email Mode.');
                return { success: true };
            } catch (e) {
                this.useRealEmail = false;
                this.auditLogger.warn('❌ New credentials failed validation. Reverting to Simulation.', e.message);
                return { success: false, error: e.message };
            }
        } else {
            this.useRealEmail = false;
            this.auditLogger.info('ℹ️ Credentials removed. Reverting to Simulation.');
            return { success: true };
        }
    }

    // =========================================================================
    // 📝 Email Reply & Draft Methods
    // =========================================================================

    /**
     * Draft a paranoid reply to an email
     * @param {Object} email - The email to reply to
     * @param {string} userGuidance - Optional guidance from user about what to say
     * @returns {Object} - Draft object with reply content
     */
    async draftParanoidReply(email, userGuidance = '') {
        if (!this.isOnline) {
            return { success: false, error: "Kevin is offline. Wake me up first." };
        }

        const threatLevel = this._assessThreatLevel(email);
        const userStyleInstructions = await this.userPersona.getDraftingInstructions({
            threatLevel,
            userGuidance
        });

        const prompt = `
You are KEVIN's protected drafting pipeline.

KEVIN's job is to assess risk. The outbound email must sound like the operator, not like KEVIN.

ORIGINAL EMAIL:
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}
Body: ${email.body?.substring(0, 1500) || '[No body]'}

THREAT ASSESSMENT: ${threatLevel.level} (Score: ${threatLevel.score}/100)
THREAT INDICATORS: ${threatLevel.indicators.join(', ') || 'None detected'}

${userStyleInstructions}

Draft a reply that:
1. ${threatLevel.score > 70 ? 'Politely but firmly refuses/questions the request' : 'Addresses the email appropriately'}
2. Follows the User Persona cadence and style
3. Does not mention threat scores, scans, or KEVIN unless asked
4. Keeps it concise (under 200 words)
5. Uses a natural operator-style sign-off if one is needed

Write ONLY the email body (no subject line, no "Dear X" - just start the reply):
`;

        try {
            let replyContent = '';

            // Use QuadBrain if available, otherwise use fallback
            if (this.quadBrain) {
                const result = await this.quadBrain.reason(prompt, {
                    temperature: 0.7,
                    brain: 'aurora'
                });
                replyContent = result.response || result.text;
            } else if (this.messageBroker) {
                // Try to use message broker to reach a brain
                const response = await this.messageBroker.request('brain', {
                    action: 'generate',
                    prompt,
                    options: { temperature: 0.7 }
                });
                replyContent = response?.text || response?.response;
            }

            // Fallback if no brain available
            if (!replyContent) {
                replyContent = this._generateFallbackReply(email, threatLevel);
            }

            // Save to draft queue
            const subject = email.subject?.startsWith('Re:')
                ? email.subject
                : `Re: ${email.subject}`;

            const draft = await this.emailManager.saveDraft(
                email.from,
                subject,
                replyContent,
                email.id,
                {
                    threatLevel: threatLevel,
                    generatedBy: 'kevin',
                    persona: 'user',
                    originalSubject: email.subject
                }
            );

            this.stats.draftedReplies++;
            this.emit('draft', draft);

            return {
                success: true,
                draft: draft.draft,
                threatAssessment: threatLevel
            };

        } catch (error) {
            this.auditLogger.error('Draft generation failed', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Assess threat level of an email
     */
    _assessThreatLevel(email) {
        if (this.threatDatabase?.buildEmailVerdict) {
            const verdict = this.threatDatabase.buildEmailVerdict(email);
            return {
                score: verdict.score,
                level: verdict.verdict === 'block' ? 'CRITICAL'
                    : verdict.verdict === 'high_risk' ? 'HIGH'
                        : verdict.verdict === 'caution' ? 'MEDIUM'
                            : 'LOW',
                indicators: verdict.riskFactors,
                verdict
            };
        }

        let score = 0;
        const indicators = [];

        const subject = (email.subject || '').toLowerCase();
        const body = (email.body || '').toLowerCase();
        const from = (email.from || '').toLowerCase();

        // Check for urgent/pressure tactics
        if (subject.includes('urgent') || body.includes('urgent')) {
            score += 25;
            indicators.push('Urgency tactics detected');
        }

        // Check for financial requests
        if (body.includes('wire') || body.includes('transfer') || body.includes('payment')) {
            score += 30;
            indicators.push('Financial request');
        }

        // Check for credential requests
        if (body.includes('password') || body.includes('login') || body.includes('verify your account')) {
            score += 35;
            indicators.push('Credential phishing attempt');
        }

        // Check for suspicious domains
        const suspiciousDomains = ['.ru', '.cn', '.xyz', '.top', '.buzz', '.click'];
        if (suspiciousDomains.some(d => from.includes(d))) {
            score += 20;
            indicators.push('Suspicious sender domain');
        }

        // Check for impersonation
        if (body.includes('ceo') || body.includes('boss') || body.includes('executive')) {
            score += 15;
            indicators.push('Possible impersonation');
        }

        // Check for links
        const linkCount = (body.match(/https?:\/\//g) || []).length;
        if (linkCount > 3) {
            score += 10;
            indicators.push(`Multiple links (${linkCount})`);
        }

        // Check for attachments mentioned
        if (body.includes('attachment') || body.includes('attached') || body.includes('.exe') || body.includes('.zip')) {
            score += 15;
            indicators.push('Attachment reference');
        }

        // Determine level
        let level = 'LOW';
        if (score >= 70) level = 'CRITICAL';
        else if (score >= 50) level = 'HIGH';
        else if (score >= 30) level = 'MEDIUM';

        return { score: Math.min(score, 100), level, indicators };
    }

    /**
     * Generate fallback reply when no AI brain is available
     */
    _generateFallbackReply(email, threatLevel) {
        if (threatLevel.score >= 70) {
            return `Thanks for reaching out. I need to verify this through a trusted channel before moving forward.

Please send over any additional context you can share, and I will follow up once I have confirmed the request.`;
        } else if (threatLevel.score >= 40) {
            return `Thanks for reaching out. I saw your note and want to double-check a couple of details before I act on it.

Can you confirm the request and send any supporting context?`;
        } else {
            return `Thanks for reaching out. I got your message and will take a look.

Appreciate it.`;
        }
    }

    async getUserPersona() {
        return { success: true, persona: await this.userPersona.getProfile() };
    }

    async updateUserPersona(profilePatch = {}) {
        return { success: true, persona: await this.userPersona.updateProfile(profilePatch) };
    }

    async learnUserPersona(samples = []) {
        return { success: true, persona: await this.userPersona.learnFromSamples(samples) };
    }

    getTrustState() {
        return this.threatDatabase.getTrustState();
    }

    async buildSecurityVerdict(email = {}) {
        const verdict = this.threatDatabase.buildEmailVerdict(email);
        await this._appendEvidence({
            type: 'email_verdict',
            source: 'kevin.threatDatabase',
            target: verdict.sender || email.from || email.subject || 'email',
            verdict: verdict.verdict,
            score: verdict.score,
            decision: verdict.recommendedAction,
            reversible: verdict.reversible,
            requiresApproval: verdict.requiresApproval,
            evidence: verdict.evidence,
            metadata: {
                subject: verdict.subject,
                category: verdict.category,
                confidence: verdict.confidence
            }
        });
        await this._refreshRealStats();
        return verdict;
    }

    unblockSender(sender) {
        return this.threatDatabase.unblockSender(sender);
    }

    unmarkSenderSafe(sender) {
        return this.threatDatabase.unmarkSenderSafe(sender);
    }

    /**
     * Get pending drafts
     */
    getDrafts() {
        return {
            success: true,
            drafts: this.emailManager.getDrafts()
        };
    }

    /**
     * Approve and send a draft
     */
    async approveDraft(draftId) {
        const result = await this.emailManager.approveDraft(draftId);
        if (result.success) {
            this.emit('email_sent', { draftId, ...result });
            this.auditLogger.info(`Draft ${draftId} approved and sent`);
            await this._appendEvidence({
                type: 'draft_approval',
                source: 'kevin.emailManager',
                target: draftId,
                verdict: 'approved',
                decision: 'sent',
                evidence: [{ type: 'operator_approval', severity: 'info', detail: 'Draft approved and sent' }]
            });
            await this._refreshRealStats();
        }
        return result;
    }

    /**
     * Reject a draft
     */
    rejectDraft(draftId) {
        const result = this.emailManager.rejectDraft(draftId);
        if (result.success) {
            this.emit('draft_rejected', { draftId });
            this.auditLogger.info(`Draft ${draftId} rejected`);
            this._appendEvidence({
                type: 'draft_approval',
                source: 'kevin.emailManager',
                target: draftId,
                verdict: 'rejected',
                decision: 'not_sent',
                evidence: [{ type: 'operator_rejection', severity: 'info', detail: 'Draft rejected' }]
            }).catch(() => {});
        }
        return result;
    }

    /**
     * Quick reply - draft + auto-approve (use with caution)
     */
    async quickReply(emailId, message) {
        // First fetch the email
        const emails = await this.emailManager.getUnread(50);
        const email = emails.find(e => e.id === emailId);

        if (!email) {
            return { success: false, error: 'Email not found' };
        }

        const draft = await this.draftParanoidReply(email, message);
        if (!draft.success) return draft;

        // Auto-approve if threat level is low
        if (draft.threatAssessment.score < 30) {
            return await this.approveDraft(draft.draft.id);
        }

        return {
            success: true,
            draft: draft.draft,
            message: 'Draft created but requires manual approval due to threat level',
            threatAssessment: draft.threatAssessment
        };
    }

    // =========================================================================
    // 🔍 Threat Research Methods
    // =========================================================================

    /**
     * Research a suspicious sender
     */
    async investigateSender(sender) {
        const fallback = this._basicSenderAnalysis(sender);
        if (!this.researchService.isConfigured()) {
            return {
                success: true,
                degraded: true,
                error: 'Research service not configured. Set TAVILY_API_KEY in environment.',
                verdict: this._buildTargetVerdict('sender', sender, fallback),
                fallback
            };
        }

        this.auditLogger.info(`Investigating sender: ${sender}`);
        const result = await this.researchService.researchSender(sender);

        if (result.success) {
            this.emit('investigation', {
                type: 'sender',
                target: sender,
                result: result
            });
        }

        return {
            ...result,
            verdict: this._buildTargetVerdict('sender', sender, result)
        };
    }

    /**
     * Research a suspicious domain
     */
    async investigateDomain(domain) {
        const fallback = this._basicDomainAnalysis(domain);
        if (!this.researchService.isConfigured()) {
            return {
                success: true,
                degraded: true,
                error: 'Research service not configured. Set TAVILY_API_KEY in environment.',
                verdict: this._buildTargetVerdict('domain', domain, fallback),
                fallback
            };
        }

        this.auditLogger.info(`Investigating domain: ${domain}`);
        const result = await this.researchService.researchDomain(domain);

        if (result.success) {
            this.emit('investigation', {
                type: 'domain',
                target: domain,
                result: result
            });
        }

        return {
            ...result,
            verdict: this._buildTargetVerdict('domain', domain, result)
        };
    }

    /**
     * Check a suspicious URL
     */
    async investigateUrl(url) {
        const fallback = this._basicUrlAnalysis(url);
        if (!this.researchService.isConfigured()) {
            return {
                success: true,
                degraded: true,
                error: 'Research service not configured. Set TAVILY_API_KEY in environment.',
                verdict: this._buildTargetVerdict('url', url, fallback),
                fallback
            };
        }

        this.auditLogger.info(`Investigating URL: ${url}`);
        const result = await this.researchService.checkUrl(url);

        if (result.success) {
            this.emit('investigation', {
                type: 'url',
                target: url,
                result: result
            });
        }

        return {
            ...result,
            verdict: this._buildTargetVerdict('url', url, result)
        };
    }

    /**
     * AI-Powered LLM Zero-Shot Spear-Phishing & Social Engineering Classifier
     */
    async aiAnalyzeEmail(email) {
        const brain = this.quadBrain || global.somaBrain || global.__SOMA_SYSTEM?.brain;
        if (!brain?.callBrain) {
            return { success: false, reason: 'QuadBrain unavailable' };
        }

        const prompt = [
            `You are KEVIN's Zero-Shot Spear-Phishing & Social Engineering Classifier.`,
            `Analyze the following email for subtle phishing, executive impersonation, urgent wire fraud, or malicious links.`,
            `Sender: "${email.from}"`,
            `Subject: "${email.subject}"`,
            `Body: "${(email.body || '').slice(0, 800)}"`,
            `Return ONLY valid JSON matching this schema:`,
            `{`,
            `  "isPhishing": true,`,
            `  "aiThreatScore": 85,`,
            `  "spearPhishingRisk": "HIGH",`,
            `  "detectedTactics": ["Executive Impersonation", "Urgency Pressure"],`,
            `  "reasoning": "Detailed social engineering analysis..."`,
            `}`
        ].join('\n');

        try {
            const aiResp = await Promise.race([
                brain.callBrain('LOGOS', prompt, { source: 'kevin_threat_classifier' }, 'fast'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
            ]);

            const text = typeof aiResp === 'string' ? aiResp : (aiResp?.response || aiResp?.text || '');
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    success: true,
                    isPhishing: !!parsed.isPhishing,
                    aiThreatScore: Math.min(100, Math.max(0, Number(parsed.aiThreatScore) || 50)),
                    spearPhishingRisk: parsed.spearPhishingRisk || 'MEDIUM',
                    detectedTactics: Array.isArray(parsed.detectedTactics) ? parsed.detectedTactics : [],
                    reasoning: parsed.reasoning || 'QuadBrain analyzed email metadata and body semantics.'
                };
            }
        } catch (e) {
            console.warn('[KevinArbiter] aiAnalyzeEmail fallback:', e.message);
        }

        return { success: false, reason: 'AI analysis deferred to heuristics' };
    }

    /**
     * Deep investigation of an email (combines all research, QuadBrain AI, and HTML Sandboxing)
     */
    async deepInvestigateEmail(email) {
        const results = {
            sender: null,
            domain: null,
            urls: [],
            overallThreatScore: 0,
            recommendations: [],
            aiAnalysis: null,
            sanitized: null,
            verdict: this.threatDatabase?.buildEmailVerdict
                ? this.threatDatabase.buildEmailVerdict(email)
                : null
        };

        // 1. Sanitize HTML & isolate links in sandbox
        results.sanitized = KevinHtmlSanitizer.sanitize(email.body || '');

        // 2. Investigate sender
        results.sender = await this.investigateSender(email.from);

        // 3. Extract and check URLs from body
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
        const urls = (email.body || '').match(urlRegex) || [];

        for (const url of urls.slice(0, 5)) { // Limit to 5 URLs
            const urlResult = await this.investigateUrl(url);
            results.urls.push(urlResult);
        }

        // 4. Run QuadBrain LLM Spear-Phishing Analysis
        results.aiAnalysis = await this.aiAnalyzeEmail(email);

        // 5. Calculate overall threat score
        let totalScore = 0;
        let factors = 0;

        if (results.sender?.overallThreatScore) {
            totalScore += results.sender.overallThreatScore;
            factors++;
        }

        results.urls.forEach(u => {
            if (u.threatScore) {
                totalScore += u.threatScore;
                factors++;
            }
        });

        results.overallThreatScore = factors > 0 ? Math.round(totalScore / factors) : 0;

        if (results.verdict?.score > results.overallThreatScore) {
            results.overallThreatScore = results.verdict.score;
        }

        if (results.aiAnalysis?.success && results.aiAnalysis.aiThreatScore > results.overallThreatScore) {
            results.overallThreatScore = results.aiAnalysis.aiThreatScore;
        }

        // 6. Generate recommendations & dispatch high-risk alerts
        if (results.overallThreatScore >= 70) {
            results.recommendations.push('🚨 HIGH RISK: Do not interact with this email');
            results.recommendations.push('Delete immediately or report as phishing');

            // Dispatch SMS & Push Notification Alert for High-Risk Email
            if (this.smsService?.sendUrgentSMS) {
                this.smsService.sendUrgentSMS(`🚨 KEVIN ALERT: High-risk email detected from "${email.from}". Threat Score: ${results.overallThreatScore}/100. Subject: "${email.subject}"`).catch(e => console.warn('[KevinArbiter] SMS alert error:', e.message));
            }
            if (this.notificationService?.sendUrgentNotification) {
                this.notificationService.sendUrgentNotification('High Risk Email', `From: ${email.from} | Score: ${results.overallThreatScore}`).catch(e => console.warn('[KevinArbiter] Notification error:', e.message));
            }
        } else if (results.overallThreatScore >= 40) {
            results.recommendations.push('⚠️ MODERATE RISK: Exercise caution');
            results.recommendations.push('Verify sender through alternate channel before responding');
        } else {
            results.recommendations.push('✅ LOW RISK: Email appears legitimate');
            results.recommendations.push('Standard security practices apply');
        }

        if (results.aiAnalysis?.detectedTactics?.length) {
            results.recommendations.push(`🧠 AI Threat Signals Detected: ${results.aiAnalysis.detectedTactics.join(', ')}`);
        }

        return {
            success: true,
            email: {
                from: email.from,
                subject: email.subject
            },
            investigation: results
        };
    }

    _buildTargetVerdict(kind, target, analysis = {}) {
        const score = Math.max(
            Number(analysis.threatScore) || 0,
            Number(analysis.overallThreatScore) || 0,
            Number(analysis.riskScore) || 0
        );
        const indicators = analysis.indicators || analysis.riskFactors || [];
        const verdict = score >= 80 ? 'block' : score >= 55 ? 'high_risk' : score >= 30 ? 'caution' : 'allow';

        return {
            success: true,
            target,
            kind,
            verdict,
            score,
            confidence: indicators.length >= 2 ? 0.78 : indicators.length === 1 ? 0.64 : 0.52,
            evidence: indicators.map(detail => ({
                type: `${kind}_indicator`,
                severity: score >= 55 ? 'high' : score >= 30 ? 'medium' : 'low',
                detail,
                score
            })),
            riskFactors: indicators,
            recommendedAction: verdict === 'allow'
                ? 'No obvious threat. Use normal caution.'
                : 'Verify through a known-good channel before interacting.',
            requiresApproval: ['block', 'high_risk'].includes(verdict),
            reversible: true,
            degraded: !!analysis.note
        };
    }

    /**
     * Basic sender analysis (fallback when no API)
     */
    _basicSenderAnalysis(sender) {
        const email = sender.match(/<(.+?)>/)?.[1] || sender;
        const domain = email.split('@')[1] || '';

        const suspiciousDomains = ['.ru', '.cn', '.xyz', '.top', '.buzz', '.click', '.loan'];
        const freeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];

        let threatScore = 0;
        const indicators = [];

        if (suspiciousDomains.some(d => domain.endsWith(d))) {
            threatScore += 30;
            indicators.push('Suspicious TLD');
        }

        if (freeDomains.includes(domain)) {
            indicators.push('Free email provider (verify identity)');
        }

        return {
            email,
            domain,
            threatScore,
            indicators,
            note: 'Basic analysis only - configure TAVILY_API_KEY for deep research'
        };
    }

    /**
     * Basic domain analysis (fallback)
     */
    _basicDomainAnalysis(domain) {
        const suspiciousTLDs = ['.xyz', '.top', '.buzz', '.click', '.loan', '.work'];
        let threatScore = 0;

        if (suspiciousTLDs.some(tld => domain.endsWith(tld))) {
            threatScore += 25;
        }

        return {
            domain,
            threatScore,
            note: 'Basic analysis only - configure TAVILY_API_KEY for deep research'
        };
    }

    /**
     * Basic URL analysis (fallback)
     */
    _basicUrlAnalysis(url) {
        let threatScore = 0;
        const indicators = [];

        try {
            const urlObj = new URL(url);

            // IP-based URL
            if (/^\d+\.\d+\.\d+\.\d+$/.test(urlObj.hostname)) {
                threatScore += 40;
                indicators.push('IP-based URL');
            }

            // Suspicious TLD
            const suspiciousTLDs = ['.xyz', '.top', '.buzz', '.click'];
            if (suspiciousTLDs.some(tld => urlObj.hostname.endsWith(tld))) {
                threatScore += 25;
                indicators.push('Suspicious TLD');
            }

            // URL shortener
            const shorteners = ['bit.ly', 'tinyurl', 't.co', 'goo.gl'];
            if (shorteners.some(s => urlObj.hostname.includes(s))) {
                threatScore += 20;
                indicators.push('URL shortener');
            }

        } catch (e) {
            threatScore += 30;
            indicators.push('Invalid URL format');
        }

        return {
            url,
            threatScore,
            indicators,
            note: 'Basic analysis only - configure TAVILY_API_KEY for deep research'
        };
    }

    // =========================================================================
    // 📅 Calendar & Action Item Methods
    // =========================================================================

    /**
     * Get upcoming calendar events with security analysis
     */
    async getCalendarEvents(options = {}) {
        if (!this.calendarService.isConfigured) {
            return {
                success: false,
                error: 'Calendar not configured. Place google-credentials.json in config/',
                configured: false
            };
        }

        return await this.calendarService.getEvents(options);
    }

    /**
     * Create a calendar event (queued if has attendees)
     */
    async createCalendarEvent(eventData) {
        if (!this.calendarService.isConfigured) {
            return { success: false, error: 'Calendar not configured' };
        }

        const result = await this.calendarService.createEvent(eventData);

        if (result.success && !result.pending) {
            this.emit('calendar_event_created', result.event);
        } else if (result.pending) {
            this.emit('calendar_event_pending', { pendingId: result.pendingId });
        }

        return result;
    }

    /**
     * Get pending calendar actions
     */
    getPendingCalendarActions() {
        return {
            success: true,
            actions: this.calendarService.getPendingActions()
        };
    }

    /**
     * Approve a pending calendar action
     */
    async approveCalendarAction(pendingId) {
        const result = await this.calendarService.approvePendingAction(pendingId);
        if (result.success) {
            this.emit('calendar_action_approved', { pendingId, ...result });
        }
        return result;
    }

    /**
     * Reject a pending calendar action
     */
    rejectCalendarAction(pendingId) {
        return this.calendarService.rejectPendingAction(pendingId);
    }

    /**
     * Process an email for meetings and action items
     */
    async processEmailForTasks(email) {
        const results = {
            meetings: null,
            actionItems: null,
            autoCreated: []
        };

        // Extract meeting info
        const meetingInfo = this.calendarService.extractMeetingFromEmail(email);
        if (meetingInfo.hasMeeting && meetingInfo.confidence > 0.6) {
            results.meetings = meetingInfo;

            // Add to meeting requests queue
            this.meetingRequests.push({
                id: `meeting_${Date.now()}`,
                email: {
                    from: email.from,
                    subject: email.subject,
                    id: email.id
                },
                extractedInfo: meetingInfo.extractedInfo,
                confidence: meetingInfo.confidence,
                detectedAt: new Date().toISOString(),
                status: 'pending_review'
            });

            this.emit('meeting_detected', meetingInfo);
        }

        // Extract action items
        const actionItems = this.calendarService.extractActionItems(email);
        if (actionItems.count > 0) {
            results.actionItems = actionItems;

            // Add to action items list
            actionItems.actionItems.forEach(item => {
                this.actionItems.push({
                    ...item,
                    id: `action_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    emailFrom: email.from,
                    emailId: email.id,
                    status: 'pending'
                });
            });

            this.emit('action_items_detected', actionItems);
        }

        return results;
    }

    /**
     * Get all pending action items
     */
    getActionItems(status = 'pending') {
        const items = status === 'all'
            ? this.actionItems
            : this.actionItems.filter(i => i.status === status);

        return {
            success: true,
            actionItems: items,
            count: items.length
        };
    }

    /**
     * Mark action item as complete
     */
    completeActionItem(actionId) {
        const item = this.actionItems.find(i => i.id === actionId);
        if (!item) {
            return { success: false, error: 'Action item not found' };
        }

        item.status = 'completed';
        item.completedAt = new Date().toISOString();

        this.emit('action_item_completed', item);
        return { success: true, item };
    }

    /**
     * Dismiss action item
     */
    dismissActionItem(actionId) {
        const item = this.actionItems.find(i => i.id === actionId);
        if (!item) {
            return { success: false, error: 'Action item not found' };
        }

        item.status = 'dismissed';
        return { success: true, item };
    }

    /**
     * Get detected meeting requests
     */
    getMeetingRequests(status = 'pending_review') {
        const requests = status === 'all'
            ? this.meetingRequests
            : this.meetingRequests.filter(r => r.status === status);

        return {
            success: true,
            requests,
            count: requests.length
        };
    }

    /**
     * Create calendar event from meeting request
     */
    async scheduleMeetingRequest(requestId, eventDetails) {
        const request = this.meetingRequests.find(r => r.id === requestId);
        if (!request) {
            return { success: false, error: 'Meeting request not found' };
        }

        // Merge extracted info with provided details
        const eventData = {
            title: eventDetails.title || `Meeting: ${request.email.subject}`,
            description: eventDetails.description || `Scheduled from email: ${request.email.subject}\nFrom: ${request.email.from}`,
            startTime: eventDetails.startTime,
            endTime: eventDetails.endTime,
            attendees: eventDetails.attendees || [],
            ...eventDetails
        };

        const result = await this.createCalendarEvent(eventData);

        if (result.success || result.pending) {
            request.status = result.pending ? 'pending_calendar_approval' : 'scheduled';
            request.calendarEventId = result.event?.id || result.pendingId;
        }

        return result;
    }

    /**
     * Dismiss a meeting request
     */
    dismissMeetingRequest(requestId) {
        const request = this.meetingRequests.find(r => r.id === requestId);
        if (!request) {
            return { success: false, error: 'Meeting request not found' };
        }

        request.status = 'dismissed';
        return { success: true, request };
    }

    /**
     * Get calendar service status
     */
    getCalendarStatus() {
        return {
            success: true,
            configured: this.calendarService.isConfigured,
            pendingActions: this.calendarService.getPendingActions().length,
            meetingRequests: this.meetingRequests.filter(r => r.status === 'pending_review').length,
            actionItems: this.actionItems.filter(i => i.status === 'pending').length
        };
    }

    // =========================================================================
    // 🗣️ Interaction Methods
    // =========================================================================

    async chat(message, context = {}) {
        if (!this.isOnline) return { success: false, response: "I'm asleep. Go away." };

        const intent = this._detectIntent(message, context);

        // Check if this is a finance/debate request from context
        if (intent.type === 'delegated_think') {
            return this.think({ input: message, context });
        }

        switch (intent.type) {
            case 'calendar':
                return await this._handleCalendarRequest(message, intent);

            case 'email_check':
                return await this._handleEmailCheckRequest(message);

            case 'email_draft':
                return await this._handleEmailDraftRequest(message, intent);

            case 'investigate':
                return await this._handleInvestigateRequest(message, intent);

            case 'block_sender':
                return await this._handleBlockSenderRequest(message, intent);

            case 'safe_sender':
                return await this._handleSafeSenderRequest(message, intent);

            case 'action_items':
                return await this._handleActionItemsRequest(message, intent);

            case 'status':
                return this._handleStatusRequest();

            case 'help':
                return this._handleHelpRequest();

            default:
                // Pass to personality engine for general chat
                // Inject system vitals for "Trapped AI" persona
                const mem = process.memoryUsage();
                const vitals = {
                    cpu: Math.round(os.loadavg()[0] * 10), // Rough proxy for %
                    ram: `${Math.round(mem.rss / 1024 / 1024)}MB`,
                    uptime: Math.floor(process.uptime())
                };
                
                const response = await this.engine.respond(message, { ...context, vitals });
                return { success: true, response };
        }
    }

    /**
     * Unified intent detection for all Kevin capabilities
     */
    _detectIntent(message, context = {}) {
        return this.intentRouter.route(message, context);
    }

    /**
     * Detect if a message is a calendar/scheduling request
     */
    _detectCalendarIntent(message) {
        const lowerMsg = message.toLowerCase();

        const calendarKeywords = [
            'schedule', 'meeting', 'calendar', 'appointment',
            'set up', 'setup', 'book', 'remind', 'reminder',
            'event', 'call', 'sync', 'block time', 'block off'
        ];

        const timeKeywords = [
            'at', 'on', 'tomorrow', 'today', 'next week', 'monday', 'tuesday',
            'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'am', 'pm', 'a.m', 'p.m', 'morning', 'afternoon', 'evening',
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'
        ];

        const hasCalendarKeyword = calendarKeywords.some(k => lowerMsg.includes(k));
        const hasTimeKeyword = timeKeywords.some(k => lowerMsg.includes(k));

        // Also check for date patterns like 1/30, 01/30, 1-30
        const hasDatePattern = /\d{1,2}[\/\-]\d{1,2}/.test(message);
        const hasTimePattern = /\d{1,2}:\d{2}|\d{1,2}\s*(am|pm|a|p)/i.test(message);

        return {
            isCalendarRequest: hasCalendarKeyword && (hasTimeKeyword || hasDatePattern || hasTimePattern),
            hasDate: hasDatePattern || timeKeywords.some(k => lowerMsg.includes(k)),
            hasTime: hasTimePattern
        };
    }

    /**
     * Parse natural language into calendar event data
     */
    _parseCalendarRequest(message) {
        const result = {
            title: null,
            date: null,
            time: null,
            duration: 60, // default 60 minutes
            attendees: [],
            description: null,
            parseSuccess: false
        };

        const lowerMsg = message.toLowerCase();
        const now = new Date();
        const currentYear = now.getFullYear();

        // Extract time - patterns like "10a", "10am", "10:00am", "2pm", "14:00"
        const timePatterns = [
            /at\s+(\d{1,2}):(\d{2})\s*(am|pm|a|p)?/i,
            /at\s+(\d{1,2})\s*(am|pm|a|p)/i,
            /(\d{1,2}):(\d{2})\s*(am|pm|a|p)?/i,
            /(\d{1,2})\s*(am|pm|a|p)\b/i
        ];

        for (const pattern of timePatterns) {
            const match = message.match(pattern);
            if (match) {
                let hours = parseInt(match[1]);
                const minutes = match[2] && !isNaN(parseInt(match[2])) ? parseInt(match[2]) : 0;
                const meridiem = (match[3] || match[2] || '').toLowerCase();

                // Handle am/pm
                if (meridiem.startsWith('p') && hours < 12) {
                    hours += 12;
                } else if (meridiem.startsWith('a') && hours === 12) {
                    hours = 0;
                }

                result.time = { hours, minutes };
                break;
            }
        }

        // Extract date - patterns like "1/30", "01/30", "jan 30", "january 30", "tomorrow", etc.
        // Check for specific date formats first
        const datePatternSlash = message.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
        if (datePatternSlash) {
            const month = parseInt(datePatternSlash[1]) - 1; // 0-indexed
            const day = parseInt(datePatternSlash[2]);
            const year = datePatternSlash[3] ? parseInt(datePatternSlash[3]) : currentYear;
            result.date = new Date(year, month, day);
        }

        // Check for month names
        const months = {
            'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
            'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5, 'jul': 6, 'july': 6,
            'aug': 7, 'august': 7, 'sep': 8, 'september': 8, 'oct': 9, 'october': 9,
            'nov': 10, 'november': 10, 'dec': 11, 'december': 11
        };

        for (const [monthName, monthIndex] of Object.entries(months)) {
            const monthPattern = new RegExp(`${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i');
            const match = message.match(monthPattern);
            if (match) {
                const day = parseInt(match[1]);
                result.date = new Date(currentYear, monthIndex, day);
                break;
            }
        }

        // Check for relative dates
        if (lowerMsg.includes('today')) {
            result.date = new Date();
        } else if (lowerMsg.includes('tomorrow')) {
            result.date = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        } else if (lowerMsg.includes('next week')) {
            result.date = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }

        // Check for day of week
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        for (let i = 0; i < days.length; i++) {
            if (lowerMsg.includes(days[i])) {
                const today = now.getDay();
                let daysUntil = i - today;
                if (daysUntil <= 0) daysUntil += 7; // Next occurrence
                result.date = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
                break;
            }
        }

        // Extract attendees - patterns like "with john", "with john and jane", "invite bob"
        const attendeePatterns = [
            /with\s+([a-zA-Z\s,]+?)(?:\s+(?:about|to|for|at|on|regarding)|$)/i,
            /invite\s+([a-zA-Z\s,]+?)(?:\s+(?:to|for)|$)/i
        ];

        for (const pattern of attendeePatterns) {
            const match = message.match(pattern);
            if (match) {
                const attendeeStr = match[1];
                // Split by "and", ",", "&"
                const attendees = attendeeStr.split(/(?:\s+and\s+|\s*,\s*|\s*&\s*)/)
                    .map(a => a.trim())
                    .filter(a => a.length > 0 && !['me', 'i', 'myself'].includes(a.toLowerCase()));
                result.attendees = attendees;
                break;
            }
        }

        // Extract title/subject - patterns like "about X", "for X", "regarding X"
        const titlePatterns = [
            /(?:about|regarding|for|to discuss)\s+(.+?)(?:\s+(?:at|on|with|tomorrow|today|\d)|$)/i,
            /meeting\s+(?:about|for|regarding|to discuss)\s+(.+?)(?:\s+(?:at|on|with)|$)/i
        ];

        for (const pattern of titlePatterns) {
            const match = message.match(pattern);
            if (match) {
                result.title = match[1].trim();
                break;
            }
        }

        // If no title found, create a generic one
        if (!result.title) {
            if (result.attendees.length > 0) {
                result.title = `Meeting with ${result.attendees.join(', ')}`;
            } else if (lowerMsg.includes('meeting')) {
                result.title = 'Meeting';
            } else if (lowerMsg.includes('call')) {
                result.title = 'Call';
            } else if (lowerMsg.includes('reminder')) {
                result.title = 'Reminder';
            } else {
                result.title = 'Event';
            }
        }

        // Extract duration - patterns like "for 30 minutes", "1 hour", "2 hours"
        const durationMatch = message.match(/for\s+(\d+)\s*(hour|hr|minute|min)s?/i);
        if (durationMatch) {
            const amount = parseInt(durationMatch[1]);
            const unit = durationMatch[2].toLowerCase();
            if (unit.startsWith('hour') || unit.startsWith('hr')) {
                result.duration = amount * 60;
            } else {
                result.duration = amount;
            }
        }

        result.parseSuccess = !!(result.date && result.time);
        return result;
    }

    /**
     * Handle a calendar request from chat
     */
    async _handleCalendarRequest(message, intent) {
        // Check if calendar is configured
        if (!this.calendarService.isConfigured) {
            return {
                success: true,
                response: `I'd love to schedule that, but I can't access your calendar yet. You need to drop a google-credentials.json file in the config folder first. Security first, scheduling second.`,
                action: 'calendar_not_configured'
            };
        }

        // Parse the request
        const parsed = this._parseCalendarRequest(message);

        if (!parsed.parseSuccess) {
            // Ask for clarification in Kevin's style
            let response = `I caught that you want to schedule something, but I need more intel. `;

            if (!parsed.date) {
                response += `What day should I schedule this? `;
            }
            if (!parsed.time) {
                response += `What time are we talking? `;
            }

            response += `Give me the full mission briefing.`;

            return {
                success: true,
                response,
                action: 'calendar_needs_clarification',
                parsed
            };
        }

        // Build the event
        const startTime = new Date(parsed.date);
        startTime.setHours(parsed.time.hours, parsed.time.minutes, 0, 0);

        const endTime = new Date(startTime.getTime() + parsed.duration * 60 * 1000);

        const eventData = {
            title: parsed.title,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            description: `Scheduled by KEVIN from chat: "${message}"`,
            attendees: parsed.attendees
        };

        try {
            const result = await this.calendarService.createEvent(eventData);

            if (result.success) {
                const dateStr = startTime.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                });
                const timeStr = startTime.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                let response = `📅 Mission scheduled. "${parsed.title}" is locked in for ${dateStr} at ${timeStr}. `;

                if (parsed.attendees.length > 0) {
                    response += `I've flagged ${parsed.attendees.join(', ')} as participants - they'll receive the usual interrogation invite. `;
                }

                response += `I'll be monitoring the perimeter.`;

                this.emit('calendar_event_created', result.event);

                return {
                    success: true,
                    response,
                    action: 'calendar_event_created',
                    event: result.event
                };
            } else if (result.pending) {
                const dateStr = startTime.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                });
                const timeStr = startTime.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                return {
                    success: true,
                    response: `📅 I've drafted "${parsed.title}" for ${dateStr} at ${timeStr}, but since it involves external parties (${parsed.attendees.join(', ')}), I need your explicit approval before sending invites. Check your pending actions.`,
                    action: 'calendar_pending_approval',
                    pendingId: result.pendingId
                };
            } else {
                return {
                    success: true,
                    response: `Scheduling failed: ${result.error}. Even my calendar has security protocols.`,
                    action: 'calendar_error',
                    error: result.error
                };
            }
        } catch (error) {
            this.auditLogger.error('Calendar request failed', error);
            return {
                success: true,
                response: `Calendar operation aborted. ${error.message}. Someone's trying to sabotage my scheduling capabilities.`,
                action: 'calendar_error',
                error: error.message
            };
        }
    }

    /**
     * Handle email check requests
     */
    async _handleEmailCheckRequest(message) {
        if (!this.useRealEmail) {
            return {
                success: true,
                response: `I'm running in local scrutiny mode. I can audit this machine, but I need email credentials before I can guard the inbox.`,
                action: 'email_local_only_mode'
            };
        }

        try {
            const emails = await this.emailManager.getUnread(10);

            if (emails.length === 0) {
                return {
                    success: true,
                    response: `Inbox perimeter is clear. No unread emails detected. Either everyone forgot about you, or my security measures are working.`,
                    action: 'email_check',
                    count: 0
                };
            }

            let response = `📬 I found ${emails.length} unread message${emails.length > 1 ? 's' : ''} in your inbox:\n\n`;

            emails.slice(0, 5).forEach((email, i) => {
                const threatLevel = this._assessThreatLevel(email);
                const threatIcon = threatLevel.score >= 50 ? '🚨' : threatLevel.score >= 30 ? '⚠️' : '✅';
                response += `${i + 1}. ${threatIcon} From: ${email.from}\n   Subject: ${email.subject}\n`;
            });

            if (emails.length > 5) {
                response += `\n...and ${emails.length - 5} more. I'm keeping my eyes on all of them.`;
            }

            return {
                success: true,
                response,
                action: 'email_check',
                emails: emails.slice(0, 5),
                count: emails.length
            };
        } catch (error) {
            return {
                success: true,
                response: `Email check failed: ${error.message}. Connection compromised - recommend checking credentials.`,
                action: 'email_error',
                error: error.message
            };
        }
    }

    /**
     * Handle email draft requests
     */
    async _handleEmailDraftRequest(message, intent) {
        if (!this.useRealEmail) {
            return {
                success: true,
                response: `Can't draft inbox replies in local scrutiny mode. I need real email access before I can write replies against actual messages.`,
                action: 'email_local_only_mode'
            };
        }

        if (!intent.targetEmail) {
            return {
                success: true,
                response: `Draft a reply to who? Give me a target email address. I can't just fire blindly.`,
                action: 'email_draft_needs_target'
            };
        }

        // Find most recent email from this sender
        try {
            const emails = await this.emailManager.getUnread(50);
            const targetEmail = emails.find(e =>
                e.from.toLowerCase().includes(intent.targetEmail.toLowerCase())
            );

            if (!targetEmail) {
                return {
                    success: true,
                    response: `No recent emails from ${intent.targetEmail} in your inbox. Either they haven't written, or I've already intercepted and neutralized their communications.`,
                    action: 'email_draft_no_email'
                };
            }

            // Extract guidance from the message
            const guidanceMatch = message.match(/(?:say|tell them|mention|about)\s+(.+)/i);
            const guidance = guidanceMatch ? guidanceMatch[1] : '';

            const draft = await this.draftParanoidReply(targetEmail, guidance);

            if (draft.success) {
                return {
                    success: true,
                    response: `📝 Draft deployed. I've prepared a reply to ${intent.targetEmail}:\n\n---\n${draft.draft.body}\n---\n\nApprove it in your drafts, or I'll hold it for review.`,
                    action: 'email_drafted',
                    draft: draft.draft
                };
            } else {
                return {
                    success: true,
                    response: `Draft failed: ${draft.error}. My creative paranoia encountered an obstacle.`,
                    action: 'email_draft_error'
                };
            }
        } catch (error) {
            return {
                success: true,
                response: `Draft operation failed: ${error.message}. The mission is compromised.`,
                action: 'email_error'
            };
        }
    }

    /**
     * Handle investigation requests
     */
    async _handleInvestigateRequest(message, intent) {
        if (!intent.target) {
            return {
                success: true,
                response: `Investigate what? Give me a sender email, domain, or URL. I need a target for my paranoia.`,
                action: 'investigate_no_target'
            };
        }

        let response = `🔍 Initiating investigation on ${intent.target}...\n\n`;
        let result;

        try {
            switch (intent.subtype) {
                case 'sender':
                    result = await this.investigateSender(intent.target);
                    break;
                case 'url':
                    result = await this.investigateUrl(intent.target);
                    break;
                default:
                    result = await this.investigateDomain(intent.target);
            }

            if (result.success) {
                response += `📊 Threat Score: ${result.overallThreatScore || result.threatScore || 0}/100\n`;

                if (result.indicators?.length > 0) {
                    response += `\n⚠️ Red Flags:\n`;
                    result.indicators.forEach(i => response += `• ${i}\n`);
                }

                if (result.breaches) {
                    response += `\n🔓 Known Breaches: ${result.breaches.join(', ')}\n`;
                }

                response += `\n${result.overallThreatScore >= 50 ? '🚨 HIGH RISK - Recommend blocking' : '✅ Appears relatively safe - but stay vigilant'}`;
            } else if (result.fallback) {
                response += `(Limited analysis - configure TAVILY_API_KEY for deep research)\n\n`;
                response += `📊 Threat Score: ${result.fallback.threatScore}/100\n`;

                if (result.fallback.indicators?.length > 0) {
                    response += `\n⚠️ Flags:\n`;
                    result.fallback.indicators.forEach(i => response += `• ${i}\n`);
                }
            } else {
                response = `Investigation incomplete: ${result.error}`;
            }

            return {
                success: true,
                response,
                action: 'investigation_complete',
                result
            };
        } catch (error) {
            return {
                success: true,
                response: `Investigation failed: ${error.message}. Even my reconnaissance has limits.`,
                action: 'investigate_error'
            };
        }
    }

    /**
     * Handle block sender requests
     */
    async _handleBlockSenderRequest(message, intent) {
        if (!intent.target) {
            return {
                success: true,
                response: `Block who? I need an email address to add to my blacklist.`,
                action: 'block_no_target'
            };
        }

        const result = this.threatDatabase.blockSender(intent.target);

        if (result.success) {
            return {
                success: true,
                response: `🚫 ${intent.target} has been blocked. This is reversible from the trust list if we need to undo it.`,
                action: 'sender_blocked',
                sender: intent.target,
                reversible: true,
                requiresApproval: true,
                result
            };
        } else {
            return {
                success: true,
                response: `Couldn't block ${intent.target}. My blacklist encountered resistance.`,
                action: 'block_error'
            };
        }
    }

    /**
     * Handle safe sender requests
     */
    async _handleSafeSenderRequest(message, intent) {
        if (!intent.target) {
            return {
                success: true,
                response: `Whitelist who? Give me an email to trust - though I'll still be watching them.`,
                action: 'safe_no_target'
            };
        }

        const result = this.threatDatabase.markSenderSafe(intent.target);

        if (result.success) {
            return {
                success: true,
                response: `✅ ${intent.target} has been added to the safe sender list. This is reversible if trust changes.`,
                action: 'sender_trusted',
                sender: intent.target,
                reversible: true,
                requiresApproval: true,
                result
            };
        } else {
            return {
                success: true,
                response: `Couldn't whitelist ${intent.target}. Something's blocking my trust protocols.`,
                action: 'safe_error'
            };
        }
    }

    /**
     * Handle action items requests
     */
    async _handleActionItemsRequest(message, intent) {
        const items = this.getActionItems(intent.action === 'complete' ? 'all' : 'pending');

        if (items.actionItems.length === 0) {
            return {
                success: true,
                response: `No pending action items. Either you're all caught up, or everyone's stopped assigning you tasks. Either way, I'm suspicious.`,
                action: 'action_items_empty'
            };
        }

        let response = `📋 Found ${items.count} action item${items.count > 1 ? 's' : ''}:\n\n`;

        items.actionItems.slice(0, 5).forEach((item, i) => {
            const statusIcon = item.status === 'completed' ? '✅' : item.status === 'dismissed' ? '❌' : '📌';
            response += `${i + 1}. ${statusIcon} ${item.action}\n`;
            if (item.deadline) response += `   Due: ${item.deadline}\n`;
            response += `   From: ${item.emailFrom}\n`;
        });

        if (items.count > 5) {
            response += `\n...and ${items.count - 5} more. You're popular - suspiciously so.`;
        }

        return {
            success: true,
            response,
            action: 'action_items_listed',
            items: items.actionItems
        };
    }

    /**
     * Handle status requests
     */
    _handleStatusRequest() {
        const status = this.getStatus().status;
        const calendarStatus = this.getCalendarStatus();
        const threatStats = this.threatDatabase.getStats();

        let response = `🛡️ KEVIN Status Report:\n\n`;
        response += `Status: ${status.online ? '🟢 ONLINE' : '🔴 OFFLINE'}\n`;
        response += `Mode: ${this.useRealEmail ? '📧 Real Email' : '🎭 Simulation'}\n`;
        response += `Mood: ${status.mood}\n`;
        response += `Uptime: ${status.stats.uptime}\n\n`;

        response += `📊 Scan Stats:\n`;
        response += `• Emails Scanned: ${status.stats.scanned}\n`;
        response += `• Threats Detected: ${status.stats.threats}\n`;
        response += `• Spam Blocked: ${status.stats.spam}\n`;
        response += `• Drafts Written: ${status.stats.draftedReplies}\n\n`;

        response += `🗃️ Threat Database:\n`;
        response += `• Malicious Hashes: ${threatStats.maliciousHashes}\n`;
        response += `• Safe Senders: ${threatStats.safeSenders}\n`;
        response += `• Blocked Senders: ${threatStats.blockedSenders}\n\n`;

        response += `📅 Calendar:\n`;
        response += `• Configured: ${calendarStatus.configured ? 'Yes' : 'No'}\n`;
        response += `• Pending Actions: ${calendarStatus.pendingActions}\n`;
        response += `• Meeting Requests: ${calendarStatus.meetingRequests}\n`;

        response += `\nAll systems nominal. Paranoia levels: Maximum.`;

        return {
            success: true,
            response,
            action: 'status_report'
        };
    }

    /**
     * Handle help requests
     */
    _handleHelpRequest() {
        const response = `🛡️ KEVIN Operator Guard Guide:\n\n` +
            `ROLE:\n` +
            `• Operator-facing security cockpit\n` +
            `• Email/link/sender security\n` +
            `• Local system watch\n` +
            `• Evidence-first verdicts\n` +
            `• Approval gate for risky actions\n` +
            `• Small autonomous routines only - no uncontrolled autonomy\n\n` +

            `🧾 VERDICTS:\n` +
            `• "Check this email for risk"\n` +
            `• "Investigate sender redacted@example.com"\n` +
            `• "Check this URL: https://suspicious.link"\n` +
            `• "Research domain example.xyz"\n\n` +

            `🧭 TRUST GRAPH:\n` +
            `• "Block sender redacted@example.com"\n` +
            `• "Trust sender redacted@example.com"\n` +
            `• "Whitelist redacted@example.com"\n\n` +
            `📅 CALENDAR:\n` +
            `• "Schedule a meeting with John at 10am on 1/30 about project review"\n` +
            `• "Set up a call tomorrow at 3pm"\n` +
            `• "Book a meeting next Tuesday at 2pm for 1 hour"\n\n` +

            `📧 EMAIL:\n` +
            `• "Check my emails" / "What emails do I have?"\n` +
            `• "Draft a reply to user@example.com"\n` +
            `• "Write a response to that suspicious email"\n\n` +

            `📋 ACTION ITEMS:\n` +
            `• "What do I need to do?" / "Show my tasks"\n` +
            `• "What action items are pending?"\n\n` +

            `📊 STATUS:\n` +
            `• "Status" / "How are you?" / "Show stats"\n\n` +

            `Personality is just the interface. Evidence is the authority.`;

        return {
            success: true,
            response,
            action: 'help'
        };
    }

    /**
     * "Think" method for internal/agent-to-agent communication
     * Used by Finance Debate Engine
     */
    async think({ input, context }) {
        // If Kevin is offline, he grumbles but answers for the system
        const wasOffline = !this.isOnline;
        if (wasOffline) {
            // Temporary wake up for internal query
            this.auditLogger.debug('Kevin woken up for internal query');
        }

        let response = "";

        // Finance/Debate Personality
        if (context.mode === 'debate') {
            const symbol = context.symbol || 'UNKNOWN';

            // Kevin is paranoid about finance too.
            // He treats stocks like potential security threats.
            const prompt = `
            You are KEVIN. The paranoid security AI.
            You are being asked to analyze a financial asset: ${symbol}.
            
            CONTEXT: ${input}
            
            Your personality:
            - You treat financial loss as a "security breach".
            - You treat rug-pulls as "social engineering attacks".
            - You are extremely skeptical of "green candles" (probably a trap).
            - You use security terminology for trading (e.g., "firewall at $100", "DDoS attack on the buy wall").
            
            Task: Give a short, punchy opinion on ${symbol}.
        `;

            // If we have access to the main brain, use it for generation with Kevin's persona
            if (this.quadBrain) {
                const result = await this.quadBrain.reason(prompt, {
                    temperature: 0.8,
                    // Force Aurora or Prometheus
                    brain: 'aurora'
                });
                response = result.response || result.text;
            } else {
                // Fallback
                response = `Scanning ${symbol}... High volatility detected. Smells like a honeypot. Recommend extreme caution or immediate blacklisting.`;
            }
        } else {
            response = await this.engine.respond(input, context);
        }

        return { success: true, response, output: response }; // .output for compatibility
    }

    // =========================================================================
    // 📡 Data Access
    // =========================================================================

    getStatus() {
        // Update dynamic stats
        if (this.isOnline) {
            const diff = Date.now() - this.stats.startTime;
            const hrs = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            this.stats.uptime = `${hrs}h ${mins}m`;
        }

        return {
            success: true,
            status: {
                online: this.isOnline,
                mood: this.mood,
                stats: this.stats,
                usingRealEmail: this.useRealEmail,
                config: this._redactConfig()
            }
        };
    }

    getScanLog() {
        return { success: true, logs: this.scanLogs };
    }

    // =========================================================================
    // 🔮 Operational Scan Loop
    // =========================================================================

    startScanLoop() {
        if (this.scanInterval) clearInterval(this.scanInterval);

        this.scanInterval = setInterval(() => {
            this.scanLoop();
        }, 3000);
    }

    stopScanLoop() {
        if (this.scanInterval) clearInterval(this.scanInterval);
        this.scanInterval = null;
    }

    async scanLoop() {
        if (!this.isOnline) return;
        if (this.isScanning) return;

        this.isScanning = true;
        try {
            if (this.useRealEmail) {
            // =========================
            // 📧 REAL GMAIL MODE
            // =========================
            try {
                const unread = await this.emailManager.getUnread(1); // Fetch 1 at a time
                if (unread.length > 0) {
                    const email = unread[0];
                    
                    // Check if it's an SMS reply
                    const smsResult = await this.checkForSMSReply(email);
                    if (smsResult && smsResult.handled) {
                        this.stats.scanned++;
                        this.emit('log', `[SMS] Received reply from ${this.smsService.config.phoneNumber}: "${smsResult.message}"`);
                        
                        // Mark as processed (seen) on IMAP
                        await this.emailManager.organize(email.id, {
                            labels: ['Kevin-SMS-Handled']
                        });

                        if (smsResult.requiresResponse) {
                            await this._handleExternalMessage(smsResult.message, this.smsService.config.phoneNumber, 'SMS', async (reply) => {
                                await this.smsService.sendSMS(reply, { type: 'chat' });
                                this.emit('sms_responded', { query: smsResult.message, response: reply });
                            });
                        }
                        return;
                    }

                    this.stats.scanned++;

                    // ========================================
                    // 🛡️ Enhanced Threat Detection with Database
                    // ========================================
                    let status = 'safe';
                    let action = 'None';
                    let threatLevel = 0;
                    const threatIndicators = [];

                    // Check if sender is blocked
                    if (this.threatDatabase.isSenderBlocked(email.from)) {
                        status = 'blocked';
                        threatLevel = 100;
                        threatIndicators.push('Blocked sender');
                    } else if (this.threatDatabase.isSenderSafe(email.from)) {
                        status = 'safe';
                        threatIndicators.push('Known safe sender');
                    } else {
                        // Check for phishing
                        const phishingCheck = this.threatDatabase.checkPhishing(email);
                        if (phishingCheck.isPhishing) {
                            status = 'threat';
                            threatLevel = phishingCheck.threatScore;
                            threatIndicators.push(...phishingCheck.indicators);
                        }

                        // Categorize email
                        const category = this.threatDatabase.categorizeEmail(email);
                        email.category = category.category;

                        // Basic keyword checks
                        const subject = (email.subject || '').toLowerCase();
                        const body = (email.body || '').toLowerCase();

                        if (subject.includes('urgent') || subject.includes('alert') || subject.includes('fail')) {
                            if (status !== 'threat') status = 'warning';
                            threatLevel = Math.max(threatLevel, 40);
                            threatIndicators.push('Urgent keywords');
                        }

                        if (subject.includes('sale') || subject.includes('promo') || subject.includes('unsubscribe')) {
                            if (status === 'safe') status = 'spam';
                        }
                    }

                    // Update stats
                    if (status === 'threat' || status === 'blocked') {
                        this.stats.threats++;
                    } else if (status === 'spam') {
                        this.stats.spam++;
                    }

                    // Organize based on findings
                    if (status === 'threat' || status === 'blocked') {
                        await this.emailManager.organize(email.id, {
                            category: 'Security Alert',
                            priority: 'High',
                            shouldStar: true,
                            labels: ['Kevin-Flagged', 'Kevin-Threat']
                        });
                        action = 'THREAT DETECTED - Flagged';

                        // 🔔 Send notification for threats
                        try {
                            const alertData = {
                                type: status === 'blocked' ? 'Blocked Sender' : 'Potential Phishing',
                                level: threatLevel,
                                indicators: threatIndicators,
                                recommendation: 'Do not click links or download attachments'
                            };
                            
                            await this.notificationService.sendThreatAlert(email, alertData);
                            
                            // 📱 Proactive SMS Alert (Production Feature)
                            if (this.smsService.config.enabled && threatLevel >= 70) {
                                const smsMsg = `🚨 SECURITY ALERT: ${alertData.type} detected from ${email.from}. High risk! I've flagged it. Check your dashboard.`;
                                await this.sendSMS(smsMsg, { type: 'alert' });
                                
                                // Store context for follow-up conversation
                                const userPhone = this.smsService.config.phoneNumber;
                                if (userPhone && this.smsSessions.has(userPhone)) {
                                    const session = this.smsSessions.get(userPhone);
                                    session.lastAlertTarget = email.from;
                                }
                            }
                        } catch (notifyErr) {
                            this.auditLogger.warn('Notification failed', notifyErr.message);
                        }
                    } else if (status === 'warning') {
                        await this.emailManager.organize(email.id, {
                            category: 'Needs Review',
                            priority: 'Medium',
                            shouldStar: true,
                            labels: ['Kevin-Review']
                        });
                        action = 'Flagged for review';
                    } else if (status === 'spam') {
                        await this.emailManager.organize(email.id, {
                            category: 'Marketing',
                            priority: 'Low',
                            labels: ['Kevin-Spam']
                        });
                        action = 'Labeled Spam';
                    } else {
                        await this.emailManager.organize(email.id, {
                            category: email.category || 'Routine',
                            priority: 'Normal',
                            labels: ['Kevin-Scanned']
                        });
                        action = 'verified';
                    }

                    // Log it
                    const logEntry = {
                        id: Date.now(),
                        time: new Date().toLocaleTimeString(),
                        status: status,
                        origin: email.from.substring(0, 30),
                        from: email.from,
                        body: email.body,
                        score: threatLevel,
                        reason: `Analyzed: ${action}`,
                        subject: email.subject.substring(0, 40)
                    };

                    this.scanLogs.unshift(logEntry);
                    if (this.scanLogs.length > 50) this.scanLogs.pop();
                    await this._appendEvidence({
                        type: 'email_verdict',
                        source: 'kevin.scanLoop',
                        target: email.from || email.subject || `uid:${email.id}`,
                        verdict: status,
                        score: threatLevel,
                        decision: action,
                        evidence: threatIndicators.map(detail => ({
                            type: 'email_scan_indicator',
                            severity: threatLevel >= 70 ? 'high' : threatLevel >= 40 ? 'medium' : 'low',
                            detail,
                            score: threatLevel
                        })),
                        requiresApproval: ['threat', 'blocked', 'warning'].includes(status),
                        metadata: {
                            uid: email.id,
                            subject: email.subject,
                            category: email.category || null
                        }
                    });
                    await this._refreshRealStats();

                    // Emit log for Dashboard/Launcher
                    this.emit('log', `[Real] ${action}: ${email.subject} (From: ${email.from})`);

                    // ========================================
                    // 📅 Process for meetings & action items
                    // ========================================
                    try {
                        const taskResults = await this.processEmailForTasks(email);

                        if (taskResults.meetings?.hasMeeting) {
                            this.emit('log', `[Meeting] Detected in: ${email.subject}`);
                            this.stats.actionsExtracted++;
                        }

                        if (taskResults.actionItems?.count > 0) {
                            this.emit('log', `[Actions] ${taskResults.actionItems.count} items from: ${email.subject}`);
                            this.stats.actionsExtracted += taskResults.actionItems.count;
                        }
                    } catch (taskErr) {
                        this.auditLogger.warn('Task extraction failed', taskErr);
                    }
                }
            } catch (e) {
                this.auditLogger.error('Real scan failed', e);
            }

        } else {
            // --- DE-MOCKED: Local Scrutiny Mode ---
            // Even without Email/SMS, Kevin performs real local security work
            if (this.stats.scanned % 50 === 0) {
                this._runLocalSecurityAudit().catch(e => {});
            }
        }
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * Real-world local file system audit
     */
    async _runLocalSecurityAudit() {
        this.auditLogger.info('🛡️ [KEVIN] Initiating Local Scrutiny Audit...');
        
        try {
            const summary = await this.getLocalWatchSummary();
            const highFindings = summary.findings.filter(f => ['critical', 'high'].includes(f.severity));
            if (summary.findings.length > 0) {
                this.auditLogger.warn(`🚨 KEVIN ALERT: ${summary.findings.length} local watch finding(s)`);
                this.emit('log', `[Security] Local watch findings: ${summary.findings.length}`);
            } else {
                this.auditLogger.debug('🛡️ Local perimeter clean. No suspicious hidden artifacts.');
            }
            await this._appendEvidence({
                type: 'local_watch',
                source: 'kevin.localWatch',
                target: process.cwd(),
                verdict: highFindings.length ? 'high_risk' : (summary.findings.length ? 'caution' : 'allow'),
                score: Math.min(100, summary.findings.length * 15 + highFindings.length * 25),
                decision: summary.status,
                evidence: summary.findings,
                requiresApproval: highFindings.length > 0,
                metadata: { listeningPorts: summary.listeningPorts?.length || 0 }
            });
            
            this.stats.scanned++;
            await this._refreshRealStats();
        } catch (e) {
            this.auditLogger.error(`Local audit failed: ${e.message}`);
        }
    }

    // =========================================================================
    // 🔐 Sender Pairing System (from clawdbot)
    // =========================================================================

    /**
     * Create a pairing request for an unknown sender
     * Returns a code they must reply with to get approved
     */
    createPairingRequest(sender, metadata = {}) {
        return this.pairingService.createPairingRequest(sender, metadata);
    }

    /**
     * Verify a pairing code and approve the sender
     */
    verifyPairingCode(code, fromSender = null) {
        const result = this.pairingService.verifyCode(code, fromSender);
        if (result.success) {
            this.emit('sender_approved', { sender: result.sender, via: 'pairing' });
            this.auditLogger.info(`Sender approved via pairing: ${result.sender}`);
        }
        return result;
    }

    /**
     * Check if a sender is approved (via pairing or manual)
     */
    isSenderApproved(sender) {
        // Check both pairing service and threat database
        return this.pairingService.isApproved(sender) ||
               this.threatDatabase.isSenderSafe(sender);
    }

    /**
     * Get pairing status
     */
    getPairingStatus() {
        return {
            ...this.pairingService.getStatus(),
            pendingPairings: this.pairingService.getPendingPairings(),
            approvedSenders: this.pairingService.getApprovedSenders()
        };
    }

    // =========================================================================
    // 📧 Gmail Webhook (Real-time Notifications)
    // =========================================================================

    /**
     * Start Gmail webhook server for real-time notifications
     */
    async startGmailWebhook() {
        if (!this.gmailWebhook.isConfigured()) {
            return {
                success: false,
                reason: 'not_configured',
                message: 'Set GMAIL_PUBSUB_TOPIC and GOOGLE_APPLICATION_CREDENTIALS'
            };
        }

        // Wire up event handlers
        this.gmailWebhook.on('gmail:notification', async (notification) => {
            this.auditLogger.info(`Gmail notification: historyId=${notification.historyId}`);
            this.emit('gmail_notification', notification);

            // Trigger email scan
            if (this.isOnline && this.useRealEmail) {
                await this.scanLoop();
            }
        });

        this.gmailWebhook.on('gmail:watch-needed', (config) => {
            this.auditLogger.info('Gmail watch setup needed', config);
            this.emit('gmail_watch_needed', config);
        });

        return await this.gmailWebhook.start();
    }

    /**
     * Stop Gmail webhook server
     */
    async stopGmailWebhook() {
        return await this.gmailWebhook.stop();
    }

    /**
     * Get Gmail webhook status
     */
    getGmailWebhookStatus() {
        return this.gmailWebhook.getStatus();
    }

    // =========================================================================
    // 🛡️ Security Audit
    // =========================================================================

    /**
     * Run a full security audit on Kevin's configuration
     */
    async runSecurityAudit() {
        this.auditLogger.info('Running security audit...');
        const result = await this.securityAudit.runAudit(this);

        if (result.summary.critical > 0) {
            this.emit('security_alert', {
                type: 'audit_critical',
                count: result.summary.critical,
                findings: result.findings.filter(f => f.severity === 'critical')
            });
        }

        await this._appendEvidence({
            type: 'security_audit',
            source: 'kevin.securityAudit',
            target: 'kevin_configuration',
            verdict: result.summary.critical > 0 ? 'critical' : result.summary.warnings > 0 ? 'caution' : 'allow',
            score: Math.min(100, (result.summary.critical * 35) + (result.summary.warnings * 10)),
            decision: result.summary.passed ? 'passed' : 'review_required',
            evidence: result.findings,
            requiresApproval: result.summary.critical > 0,
            metadata: result.summary
        });
        await this._refreshRealStats();

        return result;
    }

    /**
     * Quick check for critical security issues
     */
    async quickSecurityCheck() {
        return await this.securityAudit.quickCheck(this);
    }

    /**
     * Get last audit findings
     */
    getSecurityFindings(severity = null) {
        return this.securityAudit.getFindings(severity);
    }

    // =========================================================================
    // 📱 SMS Two-Way Chat
    // =========================================================================

    /**
     * Shared logic for SMS and Telegram messages
     */
    async _handleExternalMessage(message, sourceId, platform, replyCallback) {
        const lowerMsg = message.trim().toLowerCase();
        
        // Track session
        if (!this.smsSessions.has(sourceId)) {
            this.smsSessions.set(sourceId, { history: [], lastAlertTarget: null, pendingAction: null });
        }
        const session = this.smsSessions.get(sourceId);

        this.auditLogger.info(`[Kevin] ${platform} message from ${sourceId}: "${message}"`);

        // 🛑 RED PHONE COMMANDS
        if (['block', 'ban'].includes(lowerMsg)) {
            const emailMatch = message.match(/([^\s]+@[^\s]+)/);
            if (emailMatch) {
                const target = emailMatch[1];
                this.threatDatabase.blockSender(target);
                await this._appendEvidence({
                    type: 'trust_decision',
                    source: `kevin.${platform}`,
                    target,
                    verdict: 'blocked',
                    decision: 'block_sender',
                    evidence: [{ type: 'remote_operator_command', severity: 'medium', detail: `${platform} block command` }],
                    reversible: true
                });
                await replyCallback(`🚫 ${target} blocked.`);
                return;
            }
        }

        if (['safe', 'allow', 'trust'].includes(lowerMsg)) {
            const emailMatch = message.match(/([^\s]+@[^\s]+)/);
            if (emailMatch) {
                const target = emailMatch[1];
                this.threatDatabase.markSenderSafe(target);
                await this._appendEvidence({
                    type: 'trust_decision',
                    source: `kevin.${platform}`,
                    target,
                    verdict: 'trusted',
                    decision: 'safe_sender',
                    evidence: [{ type: 'remote_operator_command', severity: 'medium', detail: `${platform} trust command` }],
                    reversible: true
                });
                await replyCallback(`✅ ${target} trusted.`);
                return;
            }
        }

        // Contextual confirmations
        const isAffirmative = /^(yes|yeah|yep|do it|go ahead|ok|okay|sure|block them|allow them)\b/i.test(lowerMsg);
        if (isAffirmative && session.pendingAction) {
            const { type, target } = session.pendingAction;
            if (type === 'block') {
                this.threatDatabase.blockSender(target);
                session.pendingAction = null;
                await this._appendEvidence({
                    type: 'trust_decision',
                    source: `kevin.${platform}`,
                    target,
                    verdict: 'blocked',
                    decision: 'block_sender_confirmed',
                    evidence: [{ type: 'remote_operator_confirmation', severity: 'medium', detail: `${platform} confirmed block` }],
                    reversible: true
                });
                await replyCallback(`🚫 Done. ${target} is blacklisted.`);
                return;
            }
            if (type === 'allow') {
                this.threatDatabase.markSenderSafe(target);
                session.pendingAction = null;
                await this._appendEvidence({
                    type: 'trust_decision',
                    source: `kevin.${platform}`,
                    target,
                    verdict: 'trusted',
                    decision: 'safe_sender_confirmed',
                    evidence: [{ type: 'remote_operator_confirmation', severity: 'medium', detail: `${platform} confirmed allow` }],
                    reversible: true
                });
                await replyCallback(`✅ Roger that. ${target} is on the safe list.`);
                return;
            }
        }

        // Contextual "I don't like that"
        if (session.lastAlertTarget) {
            if (lowerMsg.includes("don't like") || lowerMsg.includes("hate") || lowerMsg.includes("get rid of")) {
                session.pendingAction = { type: 'block', target: session.lastAlertTarget };
                await replyCallback(`I don't like it either. Should I block ${session.lastAlertTarget} permanently?`);
                return;
            }
            if (lowerMsg.includes("trust") || lowerMsg.includes("is fine") || lowerMsg.includes("know them")) {
                session.pendingAction = { type: 'allow', target: session.lastAlertTarget };
                await replyCallback(`Understood. Should I whitelist ${session.lastAlertTarget}?`);
                return;
            }
        }

        // Chat
        try {
            const result = await this.chat(message, { 
                viaExternal: true, 
                history: session.history.slice(-5),
                lastAlert: session.lastAlertTarget 
            });
            
            const responseText = result.response || result.text || result.output || "Acknowledged.";

            session.history.push({ role: 'user', content: message });
            session.history.push({ role: 'assistant', content: responseText });
            if (session.history.length > 10) session.history.shift();

            await replyCallback(responseText);
        } catch (error) {
            console.error(`[Kevin] ${platform} error:`, error);
            await replyCallback("Having a brain moment. Try again.");
        }
    }

    /**
     * Setup SMS event handlers
     */
    _setupSMSHandlers() {
        this.smsService.on('sms:received', async ({ message, from, timestamp }) => {
            this.emit('sms_received', { message, from, timestamp });
            
            await this._handleExternalMessage(message, from, 'SMS', async (reply) => {
                await this.smsService.sendSMS(reply, { type: 'chat' });
                this.emit('sms_responded', { query: message, response: reply });
            });
        });

        // Handle morning briefing request
        this.smsService.on('briefing:needed', async ({ callback }) => {
            const briefingData = await this._gatherBriefingData();
            await callback(briefingData);
        });
    }

    /**
     * Setup Telegram event handlers
     */
    _setupTelegramHandlers() {
        if (!this.notificationService) return;

        this.notificationService.on('telegram_message', async ({ text, chatId, user }) => {
            this.emit('telegram_received', { message: text, from: user });

            await this._handleExternalMessage(text, `telegram_${chatId}`, 'Telegram', async (reply) => {
                // Send back via notification service (reusing existing alert method or direct send if exposed)
                // We need a direct send method in NotificationService or construct an alert object
                // Let's assume sendSecurityAlert is for alerts, we need a chat method.
                // We'll use _sendTelegram directly via a wrapper or expose it.
                // For now, we'll hack it by sending a "Low" severity alert which formats nicely
                await this.notificationService._sendTelegram({
                    title: 'KEVIN',
                    message: reply,
                    severity: 'low',
                    type: 'CHAT',
                    timestamp: new Date().toISOString()
                });
            });
        });
    }

    /**
     * Gather data for morning briefing
     */
    async _gatherBriefingData() {
        const data = {
            threats: { count: this.stats.threats || 0 },
            pendingEmails: 0,
            calendar: [],
            actionItems: []
        };

        try {
            // Get unread count from real email if available
            if (this.useRealEmail && this.emailManager) {
                const unread = await this.emailManager.getUnread(50);
                data.pendingEmails = unread.length;
            }

            // Get calendar events for today
            if (this.calendarService && this.calendarService.isConfigured) {
                const events = await this.calendarService.getEvents({ 
                    timeMin: new Date().toISOString(),
                    maxResults: 3
                });
                if (events.success) {
                    data.calendar = events.events.map(e => ({
                        title: e.summary,
                        time: new Date(e.start.dateTime || e.start.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    }));
                }
            }

            // Get action items
            const items = this.getActionItems('pending');
            data.actionItems = items.actionItems.slice(0, 3).map(i => i.action);

        } catch (error) {
            console.error('[Kevin] Error gathering briefing data:', error);
        }

        return data;
    }

    /**
     * Configure SMS settings
     */
    async configureSMS(settings) {
        return await this.smsService.configure(settings);
    }

    /**
     * Get SMS configuration
     */
    getSMSConfig() {
        return this.smsService.getConfig();
    }

    /**
     * Get supported carriers
     */
    getSupportedCarriers() {
        return this.smsService.getSupportedCarriers();
    }

    /**
     * Detect carrier from phone number
     */
    async detectCarrier(phoneNumber) {
        return await this.smsService.detectCarrier(phoneNumber);
    }

    /**
     * Send a test SMS
     */
    async sendTestSMS() {
        return await this.smsService.sendTest();
    }

    /**
     * Send SMS message
     */
    async sendSMS(message, options = {}) {
        return await this.smsService.sendSMS(message, options);
    }

    /**
     * Disable SMS
     */
    disableSMS() {
        return this.smsService.disable();
    }

    /**
     * Check incoming email for SMS replies
     */
    async checkForSMSReply(email) {
        return await this.smsService.handleIncomingSMS(email);
    }
}

export default KevinArbiter;
