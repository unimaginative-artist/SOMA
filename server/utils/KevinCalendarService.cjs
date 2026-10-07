/**
 * KevinCalendarService - Google Calendar Integration for KEVIN
 *
 * Handles calendar operations with Kevin's paranoid security approach:
 * - All external meeting invites are flagged for review
 * - Auto-blocks suspicious calendar events
 * - Extracts meeting requests from emails
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class KevinCalendarService {
    constructor() {
        this.calendar = null;
        this.auth = null;
        this.isConfigured = false;

        // Path to credentials
        this.credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH ||
            path.join(process.cwd(), 'config', 'google-credentials.json');
        this.tokenPath = process.env.GOOGLE_TOKEN_PATH ||
            path.join(process.cwd(), 'config', 'google-token.json');

        // Pending calendar actions (require approval)
        this.pendingActions = [];

        // Suspicious patterns that trigger alerts
        this.suspiciousPatterns = [
            /password/i,
            /wire transfer/i,
            /urgent meeting/i,
            /confidential/i,
            /external.*link/i
        ];
    }

    /**
     * Initialize the Google Calendar API
     */
    async initialize() {
        try {
            // Check for credentials
            if (!fs.existsSync(this.credentialsPath)) {
                console.log('[KevinCalendar] No Google credentials found. Calendar features disabled.');
                console.log('[KevinCalendar] To enable: Place google-credentials.json in config/');
                return false;
            }

            const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

            this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);

            // Check for existing token
            if (fs.existsSync(this.tokenPath)) {
                const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
                this.auth.setCredentials(token);
                this.calendar = google.calendar({ version: 'v3', auth: this.auth });
                this.isConfigured = true;
                console.log('[KevinCalendar] ✅ Google Calendar connected');
                return true;
            } else {
                console.log('[KevinCalendar] No token found. Run OAuth flow to authorize.');
                return false;
            }

        } catch (error) {
            console.error('[KevinCalendar] Initialization error:', error.message);
            return false;
        }
    }

    /**
     * Get OAuth URL for authorization
     */
    getAuthUrl() {
        if (!this.auth) {
            return { success: false, error: 'Auth not initialized. Check credentials.' };
        }

        const scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ];

        const url = this.auth.generateAuthUrl({
            access_type: 'offline',
            scope: scopes
        });

        return { success: true, url };
    }

    /**
     * Exchange auth code for token
     */
    async handleAuthCallback(code) {
        try {
            const { tokens } = await this.auth.getToken(code);
            this.auth.setCredentials(tokens);

            // Save token
            fs.writeFileSync(this.tokenPath, JSON.stringify(tokens));

            this.calendar = google.calendar({ version: 'v3', auth: this.auth });
            this.isConfigured = true;

            return { success: true, message: 'Calendar authorized successfully' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get upcoming events
     */
    async getEvents(options = {}) {
        if (!this.isConfigured) {
            return { success: false, error: 'Calendar not configured' };
        }

        try {
            const response = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: options.timeMin || new Date().toISOString(),
                timeMax: options.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                maxResults: options.maxResults || 20,
                singleEvents: true,
                orderBy: 'startTime'
            });

            const events = response.data.items || [];

            // Kevin analyzes each event for suspicious content
            const analyzedEvents = events.map(event => ({
                id: event.id,
                summary: event.summary,
                description: event.description,
                start: event.start?.dateTime || event.start?.date,
                end: event.end?.dateTime || event.end?.date,
                location: event.location,
                organizer: event.organizer,
                attendees: event.attendees,
                hangoutLink: event.hangoutLink,
                // Kevin's security analysis
                securityAnalysis: this._analyzeEvent(event)
            }));

            return { success: true, events: analyzedEvents };

        } catch (error) {
            console.error('[KevinCalendar] Get events error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create a calendar event (with approval for external invites)
     */
    async createEvent(eventData, requireApproval = true) {
        if (!this.isConfigured) {
            return { success: false, error: 'Calendar not configured' };
        }

        // Analyze the event first
        const securityCheck = this._analyzeEventData(eventData);

        // If suspicious or has external attendees, queue for approval
        if (requireApproval && (securityCheck.threatLevel > 30 || eventData.attendees?.length > 0)) {
            const pendingId = `pending_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            this.pendingActions.push({
                id: pendingId,
                type: 'create_event',
                data: eventData,
                securityCheck,
                createdAt: new Date().toISOString(),
                status: 'pending_approval'
            });

            return {
                success: true,
                pending: true,
                pendingId,
                message: 'Event queued for approval due to security protocols',
                securityCheck
            };
        }

        // Create immediately if low risk
        return await this._createEventDirect(eventData);
    }

    /**
     * Create event directly (internal use)
     */
    async _createEventDirect(eventData) {
        try {
            const event = {
                summary: eventData.title || eventData.summary,
                description: eventData.description || '',
                start: {
                    dateTime: eventData.startTime,
                    timeZone: eventData.timeZone || 'America/New_York'
                },
                end: {
                    dateTime: eventData.endTime,
                    timeZone: eventData.timeZone || 'America/New_York'
                },
                location: eventData.location,
                attendees: eventData.attendees?.map(email => ({ email })),
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 15 },
                        { method: 'email', minutes: 60 }
                    ]
                }
            };

            const response = await this.calendar.events.insert({
                calendarId: 'primary',
                resource: event,
                sendUpdates: eventData.sendInvites ? 'all' : 'none'
            });

            return {
                success: true,
                event: {
                    id: response.data.id,
                    htmlLink: response.data.htmlLink,
                    summary: response.data.summary
                }
            };

        } catch (error) {
            console.error('[KevinCalendar] Create event error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Approve a pending calendar action
     */
    async approvePendingAction(pendingId) {
        const actionIndex = this.pendingActions.findIndex(a => a.id === pendingId);
        if (actionIndex === -1) {
            return { success: false, error: 'Pending action not found' };
        }

        const action = this.pendingActions[actionIndex];

        if (action.type === 'create_event') {
            const result = await this._createEventDirect(action.data);
            if (result.success) {
                action.status = 'approved';
                action.completedAt = new Date().toISOString();
            }
            return result;
        }

        return { success: false, error: 'Unknown action type' };
    }

    /**
     * Reject a pending calendar action
     */
    rejectPendingAction(pendingId) {
        const actionIndex = this.pendingActions.findIndex(a => a.id === pendingId);
        if (actionIndex === -1) {
            return { success: false, error: 'Pending action not found' };
        }

        this.pendingActions[actionIndex].status = 'rejected';
        return { success: true, message: 'Action rejected' };
    }

    /**
     * Get pending calendar actions
     */
    getPendingActions() {
        return this.pendingActions.filter(a => a.status === 'pending_approval');
    }

    /**
     * Extract meeting info from email text
     */
    extractMeetingFromEmail(email) {
        const text = `${email.subject || ''} ${email.body || ''}`;
        const result = {
            hasMeeting: false,
            confidence: 0,
            extractedInfo: {}
        };

        // Meeting keywords
        const meetingKeywords = ['meeting', 'call', 'sync', 'standup', 'catch up', 'discuss', 'schedule', 'appointment'];
        const hasKeyword = meetingKeywords.some(k => text.toLowerCase().includes(k));

        if (!hasKeyword) return result;

        result.hasMeeting = true;
        result.confidence = 0.5;

        // Extract date patterns
        const datePatterns = [
            /(?:on\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
            /(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
            /(?:on\s+)?(tomorrow|today|next\s+week)/i,
            /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i
        ];

        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                result.extractedInfo.date = match[1] || match[0];
                result.confidence += 0.2;
                break;
            }
        }

        // Extract time patterns
        const timePatterns = [
            /(\d{1,2}:\d{2}\s*(?:am|pm)?)/i,
            /(\d{1,2}\s*(?:am|pm))/i,
            /(noon|midnight)/i
        ];

        for (const pattern of timePatterns) {
            const match = text.match(pattern);
            if (match) {
                result.extractedInfo.time = match[1];
                result.confidence += 0.2;
                break;
            }
        }

        // Extract duration
        const durationMatch = text.match(/(\d+)\s*(?:hour|hr|minute|min)/i);
        if (durationMatch) {
            result.extractedInfo.duration = durationMatch[0];
            result.confidence += 0.1;
        }

        // Cap confidence
        result.confidence = Math.min(result.confidence, 1);

        return result;
    }

    /**
     * Extract action items from email text
     */
    extractActionItems(email) {
        const text = `${email.subject || ''} ${email.body || ''}`;
        const actionItems = [];

        // Action item patterns
        const patterns = [
            /(?:please|pls|kindly)\s+(.+?)(?:\.|$)/gi,
            /(?:can you|could you)\s+(.+?)(?:\?|$)/gi,
            /(?:todo|to-do|action item|task):\s*(.+?)(?:\.|$)/gi,
            /(?:need to|needs to|should)\s+(.+?)(?:\.|$)/gi,
            /(?:\[\s*\]|\☐)\s*(.+?)(?:\n|$)/gi,  // Checkbox pattern
            /(?:\d+\.\s*)(.+?)(?:\n|$)/g  // Numbered list
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const item = match[1].trim();
                if (item.length > 5 && item.length < 200) {
                    actionItems.push({
                        text: item,
                        source: 'email',
                        emailSubject: email.subject,
                        extractedAt: new Date().toISOString()
                    });
                }
            }
        }

        // Deduplicate
        const unique = [...new Map(actionItems.map(i => [i.text, i])).values()];

        return {
            success: true,
            actionItems: unique.slice(0, 10), // Max 10 items
            count: unique.length
        };
    }

    /**
     * Analyze an event for suspicious content
     */
    _analyzeEvent(event) {
        let threatLevel = 0;
        const warnings = [];

        const text = `${event.summary || ''} ${event.description || ''} ${event.location || ''}`;

        // Check for suspicious patterns
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(text)) {
                threatLevel += 20;
                warnings.push(`Suspicious keyword detected: ${pattern.source}`);
            }
        }

        // External organizer
        if (event.organizer && !event.organizer.self) {
            threatLevel += 10;
            warnings.push('External organizer');
        }

        // Suspicious links in description
        if (event.description?.includes('http') && !event.description?.includes('zoom.us') &&
            !event.description?.includes('meet.google') && !event.description?.includes('teams.microsoft')) {
            threatLevel += 15;
            warnings.push('Unknown external link in description');
        }

        // Very short notice meetings
        if (event.start?.dateTime) {
            const startTime = new Date(event.start.dateTime);
            const now = new Date();
            const hoursUntil = (startTime - now) / (1000 * 60 * 60);
            if (hoursUntil < 1 && hoursUntil > 0) {
                threatLevel += 10;
                warnings.push('Very short notice meeting');
            }
        }

        return {
            threatLevel: Math.min(threatLevel, 100),
            warnings,
            recommendation: threatLevel > 50 ? 'REVIEW CAREFULLY' : threatLevel > 20 ? 'VERIFY ORGANIZER' : 'OK'
        };
    }

    /**
     * Analyze event data before creation
     */
    _analyzeEventData(eventData) {
        let threatLevel = 0;
        const warnings = [];

        const text = `${eventData.title || ''} ${eventData.description || ''}`;

        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(text)) {
                threatLevel += 15;
                warnings.push(`Suspicious content: ${pattern.source}`);
            }
        }

        // External attendees
        if (eventData.attendees?.length > 0) {
            threatLevel += 10;
            warnings.push(`${eventData.attendees.length} external attendee(s)`);
        }

        return { threatLevel, warnings };
    }
}

module.exports = { KevinCalendarService };
