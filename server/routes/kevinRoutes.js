import express from 'express';
import { requireEnterpriseAuth } from '../loaders/authMiddleware.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { KevinHtmlSanitizer } = require('../utils/KevinHtmlSanitizer.cjs');

const router = express.Router();

// Middleware to get Kevin instance from the app or request
const getKevin = (req) => {
    // Try multiple sources for Kevin arbiter
    let kevin = req.app.locals.kevinArbiter;
    
    // Fallback to global SOMA if available
    if (!kevin && global.SOMA && global.SOMA.kevinArbiter) {
        kevin = global.SOMA.kevinArbiter;
    }
    
    // Fallback to global kevinManager (old launcher style)
    if (!kevin && global.kevinManager) {
        kevin = global.kevinManager;
    }
    
    if (!kevin) {
        console.error('[KevinRoutes] Kevin arbiter not found in:', {
            appLocals: !!req.app.locals.kevinArbiter,
            globalSOMA: !!(global.SOMA && global.SOMA.kevinArbiter),
            globalKevin: !!global.kevinManager
        });
    }
    
    return kevin;
};

const unavailable = (res, capability) => {
    return res.status(501).json({
        success: false,
        error: `${capability} is not supported by this KEVIN runtime`
    });
};

const callKevin = async (req, res, method, args = [], capability = method) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin[method] !== 'function') return unavailable(res, capability);

    try {
        const result = await kevin[method](...args);
        res.json(result);
    } catch (error) {
        console.error(`[KevinRoutes] ${method} failed:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const callService = async (req, res, serviceName, method, args = [], capability = `${serviceName}.${method}`) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const service = kevin[serviceName];
    if (!service) return unavailable(res, capability);
    if (typeof service[method] !== 'function') return unavailable(res, capability);

    try {
        const result = await service[method](...args);
        res.json(result || { success: false, error: `${capability} returned no result` });
    } catch (error) {
        console.error(`[KevinRoutes] ${capability} failed:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
};

router.get('/status', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin.getStatus !== 'function') return unavailable(res, 'status');
    res.json(kevin.getStatus());
});

router.get('/scan-log', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin.getScanLog !== 'function') return unavailable(res, 'scan log');
    res.json(kevin.getScanLog());
});

router.post('/toggle', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin.toggle !== 'function') return unavailable(res, 'power toggle');
    res.json(kevin.toggle());
});

router.post('/chat', async (req, res) => {
    const { message, context } = req.body;
    await callKevin(req, res, 'chat', [message, context], 'chat');
});

router.get('/capabilities', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin.getCapabilities === 'function') return res.json(kevin.getCapabilities());

    const config = kevin.getConfig ? kevin.getConfig() : kevin.config || {};
    res.json({
        success: true,
        agentic: { enabled: false, autonomy: 'legacy' },
        core: {
            online: !!kevin.isOnline,
            mood: kevin.mood || 'unknown',
            personality: !!kevin.engine
        },
        integrations: {
            email: {
                configured: !!(process.env.EMAIL_ADDRESS && process.env.APP_PASSWORD),
                connected: !!kevin.useRealEmail,
                monitoredAccounts: config.monitored_accounts?.length || 0
            },
            calendar: { configured: !!kevin.calendarService?.isConfigured },
            research: { configured: !!kevin.researchService?.isConfigured?.() },
            notifications: { configured: !!kevin.notificationService },
            sms: { available: !!kevin.smsService },
            threatDatabase: { available: !!kevin.threatDatabase }
        },
        actions: {
            chat: typeof kevin.chat === 'function',
            think: typeof kevin.think === 'function',
            draftReplies: typeof kevin.draftParanoidReply === 'function',
            investigateSenders: typeof kevin.investigateSender === 'function',
            calendarEvents: typeof kevin.createCalendarEvent === 'function'
        }
    });
});

router.get('/cockpit', async (req, res) => {
    await callKevin(req, res, 'getCockpitSummary', [], 'operator cockpit summary');
});

router.get('/approvals', async (req, res) => {
    await callKevin(req, res, 'getPendingApprovals', [], 'pending approvals');
});

router.get('/trust-graph', async (req, res) => {
    await callKevin(req, res, 'getTrustGraph', [], 'trust graph');
});

router.get('/verdict-timeline', async (req, res) => {
    await callKevin(req, res, 'getVerdictTimeline', [req.query.limit || 50], 'verdict timeline');
});

router.get('/evidence-ledger', async (req, res) => {
    await callKevin(req, res, 'getEvidenceLedger', [req.query.limit || 100], 'evidence ledger');
});

router.get('/local-watch', async (req, res) => {
    await callKevin(req, res, 'getLocalWatchSummary', [], 'local watch');
});

router.get('/dependency-audit', async (req, res) => {
    await callKevin(req, res, 'getDependencyAuditStatus', [req.query.force === 'true'], 'dependency audit');
});

router.post('/local-watch/rebaseline', async (req, res) => {
    await callKevin(req, res, 'resetFileBaseline', [], 'file baseline reset');
});

router.post('/sanitize-email', (req, res) => {
    const { html } = req.body || {};
    const sanitized = KevinHtmlSanitizer.sanitize(html || '');
    return res.json(sanitized);
});

router.post('/investigate-email', async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, error: 'email object required' });
    await callKevin(req, res, 'deepInvestigateEmail', [email], 'email deep investigation');
});

router.post('/links/inspect', async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'url required' });
    await callKevin(req, res, 'inspectLinkLite', [url], 'link inspection');
});

router.get('/briefing', async (req, res) => {
    await callKevin(req, res, 'getSecurityBriefing', [], 'security briefing');
});

router.get('/reputation', async (req, res) => {
    await callKevin(req, res, 'getReputationMemory', [], 'reputation memory');
});

router.get('/reputation-cache', async (req, res) => {
    await callKevin(req, res, 'getReputationCache', [], 'sender/domain reputation cache');
});

router.post('/pairing/challenge', async (req, res) => {
    const { sender, metadata } = req.body || {};
    if (!sender) return res.status(400).json({ success: false, error: 'sender required' });
    await callKevin(req, res, 'createPairingChallenge', [sender, metadata || {}], 'pairing challenge');
});

router.post('/rewrite-user-style', async (req, res) => {
    const { text, guidance } = req.body || {};
    if (!text) return res.status(400).json({ success: false, error: 'text required' });
    await callKevin(req, res, 'rewriteInUserStyle', [text, guidance || ''], 'user style rewrite');
});

router.post('/intent', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin._detectIntent !== 'function') return unavailable(res, 'intent routing');

    const { message, context } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'message is required' });

    try {
        res.json({ success: true, intent: kevin._detectIntent(message, context || {}) });
    } catch (error) {
        console.error('[KevinRoutes] intent routing failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/user-persona', async (req, res) => {
    await callKevin(req, res, 'getUserPersona', [], 'user persona');
});

router.post('/user-persona', async (req, res) => {
    await callKevin(req, res, 'updateUserPersona', [req.body || {}], 'user persona update');
});

router.post('/user-persona/learn', async (req, res) => {
    const { samples } = req.body || {};
    if (!Array.isArray(samples)) {
        return res.status(400).json({ success: false, error: 'samples must be an array of example messages' });
    }
    await callKevin(req, res, 'learnUserPersona', [samples], 'user persona learning');
});

// Get current configuration
router.get('/config', requireEnterpriseAuth, async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const config = kevin._redactConfig ? kevin._redactConfig() : (kevin.getConfig ? kevin.getConfig() : kevin.config || {});
    res.json({ success: true, config });
});

// Update configuration
router.post('/config', requireEnterpriseAuth, async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    if (typeof kevin.updateConfig !== 'function') {
        return res.status(501).json({ success: false, error: 'Kevin config updates are not supported by this runtime' });
    }

    try {
        const result = await kevin.updateConfig(req.body);
        res.json(result);
    } catch (error) {
        console.error('[KevinRoutes] Config update failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Internal thinking endpoint for other agents
router.post('/think', async (req, res) => {
    const { input, context } = req.body;
    await callKevin(req, res, 'think', [{ input, context }], 'internal thinking');
});

// =========================================================================
// 📧 Email Draft & Reply Endpoints
// =========================================================================

// Get pending drafts
router.get('/drafts', async (req, res) => {
    await callKevin(req, res, 'getDrafts', [], 'email drafts');
});

// Draft a paranoid reply to an email
router.post('/draft-reply', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { email, guidance } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'Email object required' });
    }

    await callKevin(req, res, 'draftParanoidReply', [email, guidance || ''], 'email reply drafting');
});

// Approve and send a draft
router.post('/approve-draft', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { draftId } = req.body;
    if (!draftId) {
        return res.status(400).json({ success: false, error: 'draftId required' });
    }

    await callKevin(req, res, 'approveDraft', [draftId], 'draft approval');
});

// Reject a draft
router.post('/reject-draft', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { draftId } = req.body;
    if (!draftId) {
        return res.status(400).json({ success: false, error: 'draftId required' });
    }

    await callKevin(req, res, 'rejectDraft', [draftId], 'draft rejection');
});

// Quick reply (draft + auto-send if low risk)
router.post('/quick-reply', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { emailId, message } = req.body;
    if (!emailId) {
        return res.status(400).json({ success: false, error: 'emailId required' });
    }

    await callKevin(req, res, 'quickReply', [emailId, message || ''], 'quick reply');
});

// =========================================================================
// 🔍 Threat Research Endpoints
// =========================================================================

// Investigate a sender
router.post('/investigate-sender', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { sender } = req.body;
    if (!sender) {
        return res.status(400).json({ success: false, error: 'sender required' });
    }

    await callKevin(req, res, 'investigateSender', [sender], 'sender investigation');
});

// Investigate a domain
router.post('/investigate-domain', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { domain } = req.body;
    if (!domain) {
        return res.status(400).json({ success: false, error: 'domain required' });
    }

    await callKevin(req, res, 'investigateDomain', [domain], 'domain investigation');
});

// Investigate a URL
router.post('/investigate-url', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ success: false, error: 'url required' });
    }

    await callKevin(req, res, 'investigateUrl', [url], 'URL investigation');
});

// Deep investigation of an email (full analysis)
router.post('/deep-investigate', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'email object required' });
    }

    await callKevin(req, res, 'deepInvestigateEmail', [email], 'deep email investigation');
});

router.post('/verdict/email', async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
        return res.status(400).json({ success: false, error: 'email object required' });
    }
    await callKevin(req, res, 'buildSecurityVerdict', [email], 'email security verdict');
});

// Research status (check if Tavily is configured)
router.get('/research-status', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    res.json({
        success: true,
        configured: kevin.researchService?.isConfigured() || false,
        message: kevin.researchService?.isConfigured()
            ? 'Tavily research service active'
            : 'Set TAVILY_API_KEY for deep threat research'
    });
});

// =========================================================================
// 📅 Calendar & Task Endpoints
// =========================================================================

// Get calendar status
router.get('/calendar-status', async (req, res) => {
    await callKevin(req, res, 'getCalendarStatus', [], 'calendar status');
});

// Get upcoming calendar events
router.get('/calendar/events', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { timeMin, timeMax, maxResults } = req.query;
    await callKevin(req, res, 'getCalendarEvents', [{
        timeMin,
        timeMax,
        maxResults: maxResults ? parseInt(maxResults) : undefined
    }], 'calendar events');
});

// Create calendar event
router.post('/calendar/events', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    await callKevin(req, res, 'createCalendarEvent', [req.body], 'calendar event creation');
});

// Get pending calendar actions
router.get('/calendar/pending', async (req, res) => {
    await callKevin(req, res, 'getPendingCalendarActions', [], 'pending calendar actions');
});

// Approve pending calendar action
router.post('/calendar/approve', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { pendingId } = req.body;
    if (!pendingId) {
        return res.status(400).json({ success: false, error: 'pendingId required' });
    }

    await callKevin(req, res, 'approveCalendarAction', [pendingId], 'calendar approval');
});

// Reject pending calendar action
router.post('/calendar/reject', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { pendingId } = req.body;
    if (!pendingId) {
        return res.status(400).json({ success: false, error: 'pendingId required' });
    }

    await callKevin(req, res, 'rejectCalendarAction', [pendingId], 'calendar rejection');
});

// =========================================================================
// ✅ Action Items Endpoints
// =========================================================================

// Get action items
router.get('/action-items', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { status } = req.query;
    await callKevin(req, res, 'getActionItems', [status || 'pending'], 'action items');
});

// Complete action item
router.post('/action-items/complete', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { actionId } = req.body;
    if (!actionId) {
        return res.status(400).json({ success: false, error: 'actionId required' });
    }

    await callKevin(req, res, 'completeActionItem', [actionId], 'action item completion');
});

// Dismiss action item
router.post('/action-items/dismiss', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { actionId } = req.body;
    if (!actionId) {
        return res.status(400).json({ success: false, error: 'actionId required' });
    }

    await callKevin(req, res, 'dismissActionItem', [actionId], 'action item dismissal');
});

// =========================================================================
// 📧 Meeting Requests Endpoints
// =========================================================================

// Get detected meeting requests
router.get('/meeting-requests', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { status } = req.query;
    await callKevin(req, res, 'getMeetingRequests', [status || 'pending_review'], 'meeting requests');
});

// Schedule a meeting request
router.post('/meeting-requests/schedule', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { requestId, eventDetails } = req.body;
    if (!requestId || !eventDetails) {
        return res.status(400).json({ success: false, error: 'requestId and eventDetails required' });
    }

    await callKevin(req, res, 'scheduleMeetingRequest', [requestId, eventDetails], 'meeting scheduling');
});

// Dismiss meeting request
router.post('/meeting-requests/dismiss', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { requestId } = req.body;
    if (!requestId) {
        return res.status(400).json({ success: false, error: 'requestId required' });
    }

    await callKevin(req, res, 'dismissMeetingRequest', [requestId], 'meeting dismissal');
});

// Process email for tasks (manual trigger)
router.post('/process-email', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (typeof kevin.processEmailForTasks !== 'function') return unavailable(res, 'email task extraction');

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'email object required' });
    }

    try {
        const result = await kevin.processEmailForTasks(email);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[KevinRoutes] processEmailForTasks failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Calendar OAuth flow (if needed)
router.get('/calendar/auth-url', async (req, res) => {
    await callService(req, res, 'calendarService', 'getAuthUrl', [], 'calendar OAuth URL');
});

router.post('/calendar/auth-callback', async (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ success: false, error: 'Authorization code required' });
    }

    await callService(req, res, 'calendarService', 'handleAuthCallback', [code], 'calendar OAuth callback');
});

// =========================================================================
// 🔔 Notification Endpoints (Slack/Telegram/Discord)
// =========================================================================

// Get notification status
router.get('/notifications/status', async (req, res) => {
    await callService(req, res, 'notificationService', 'getStatus', [], 'notification status');
});

// Send a test notification
router.post('/notifications/test', async (req, res) => {
    try {
        const kevin = getKevin(req);
        if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

        const { channel } = req.body;
        if (!channel) {
            return res.status(400).json({ success: false, error: 'channel required (slack, telegram, discord)' });
        }

        await callService(req, res, 'notificationService', 'testChannel', [channel], 'notification test');
    } catch (error) {
        console.error('[KevinRoutes] Notify Test Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Configure notification channel
router.post('/notifications/configure', requireEnterpriseAuth, async (req, res) => {
    try {
        const kevin = getKevin(req);
        if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

        const { channel, config } = req.body;
        if (!channel || !config) {
            return res.status(400).json({ success: false, error: 'channel and config required' });
        }

        await callService(req, res, 'notificationService', 'configure', [channel, config], 'notification configuration');
    } catch (error) {
        console.error('[KevinRoutes] Notify Config Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send a custom alert
router.post('/notifications/send', async (req, res) => {
    try {
        const kevin = getKevin(req);
        if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

        const { title, message, severity, type } = req.body;
        if (!message) {
            return res.status(400).json({ success: false, error: 'message required' });
        }

        await callService(req, res, 'notificationService', 'sendSecurityAlert', [{
            type: type || 'CUSTOM_ALERT',
            title: title || 'Kevin Alert',
            message,
            severity: severity || 'medium'
        }], 'notification send');
    } catch (error) {
        console.error('[KevinRoutes] Notify Send Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get notification history
router.get('/notifications/history', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const status = kevin.notificationService?.getStatus();
    res.json({
        success: true,
        history: status?.recentAlerts || []
    });
});

// =========================================================================
// 🛡️ Threat Database Endpoints
// =========================================================================

// Get threat database stats
router.get('/threats/stats', async (req, res) => {
    await callService(req, res, 'threatDatabase', 'getStats', [], 'threat database stats');
});

// Check attachment for threats
router.post('/threats/check-attachment', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { filename, content } = req.body;
    if (!filename) {
        return res.status(400).json({ success: false, error: 'filename required' });
    }

    await callService(req, res, 'threatDatabase', 'analyzeAttachment', [filename, content], 'attachment threat analysis');
});

// Check email for phishing
router.post('/threats/check-phishing', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'email object required' });
    }

    await callService(req, res, 'threatDatabase', 'checkPhishing', [email], 'phishing analysis');
});

// Categorize an email
router.post('/threats/categorize', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'email object required' });
    }

    await callService(req, res, 'threatDatabase', 'categorizeEmail', [email], 'email categorization');
});

// Mark sender as safe
router.post('/threats/safe-sender', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { sender } = req.body;
    if (!sender) {
        return res.status(400).json({ success: false, error: 'sender required' });
    }

    // Remove matching threat logs for this sender from local memory
    if (kevin.scanLogs) {
        kevin.scanLogs = kevin.scanLogs.filter(log => {
            const logSender = log.origin || log.from || '';
            return logSender.toLowerCase() !== sender.toLowerCase();
        });
    }

    await callService(req, res, 'threatDatabase', 'markSenderSafe', [sender], 'safe sender marking');
});

// Block a sender
router.post('/threats/block-sender', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });

    const { sender } = req.body;
    if (!sender) {
        return res.status(400).json({ success: false, error: 'sender required' });
    }

    await callService(req, res, 'threatDatabase', 'blockSender', [sender], 'sender blocking');
});

router.post('/threats/unblock-sender', async (req, res) => {
    const { sender } = req.body;
    if (!sender) {
        return res.status(400).json({ success: false, error: 'sender required' });
    }

    await callKevin(req, res, 'unblockSender', [sender], 'sender unblocking');
});

router.post('/threats/unmark-safe-sender', async (req, res) => {
    const { sender } = req.body;
    if (!sender) {
        return res.status(400).json({ success: false, error: 'sender required' });
    }

    await callKevin(req, res, 'unmarkSenderSafe', [sender], 'safe sender removal');
});

router.get('/threats/trust-state', async (req, res) => {
    await callKevin(req, res, 'getTrustState', [], 'trust state');
});

// Add malicious hash to database
router.post('/threats/add-hash', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (!kevin.threatDatabase || typeof kevin.threatDatabase.addMaliciousHash !== 'function') {
        return unavailable(res, 'malicious hash registration');
    }

    const { hash } = req.body;
    if (!hash) {
        return res.status(400).json({ success: false, error: 'hash required' });
    }

    kevin.threatDatabase.addMaliciousHash(hash);
    res.json({ success: true, message: 'Hash added to threat database' });
});

// =========================================================================
// 📱 SMS Endpoints
// =========================================================================

// Get SMS configuration
router.get('/sms/config', requireEnterpriseAuth, async (req, res) => {
    await callService(req, res, 'smsService', 'getConfig', [], 'SMS configuration');
});

// Get supported carriers
router.get('/sms/carriers', async (req, res) => {
    const kevin = getKevin(req);
    if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
    if (!kevin.smsService || typeof kevin.smsService.getSupportedCarriers !== 'function') {
        return unavailable(res, 'SMS carriers');
    }
    res.json({ success: true, carriers: kevin.smsService.getSupportedCarriers() });
});

// Configure SMS
router.post('/sms/configure', requireEnterpriseAuth, async (req, res) => {
    try {
        const kevin = getKevin(req);
        if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
        
        console.log('[KevinRoutes] Configuring SMS...');
        await callService(req, res, 'smsService', 'configure', [req.body], 'SMS configuration');
    } catch (error) {
        console.error('[KevinRoutes] SMS Configure Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send test SMS
router.post('/sms/test', async (req, res) => {
    try {
        const kevin = getKevin(req);
        if (!kevin) return res.status(503).json({ success: false, error: 'Kevin offline' });
        
        await callService(req, res, 'smsService', 'sendTest', [], 'SMS test');
    } catch (error) {
        console.error('[KevinRoutes] SMS Test Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
