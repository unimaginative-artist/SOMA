const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const process = require('process');

class KevinEmailManager {
    constructor() {
        const allowInsecureTls = process.env.KEVIN_ALLOW_INSECURE_TLS === 'true';
        if (allowInsecureTls) {
            console.warn('[KevinEmailManager] KEVIN_ALLOW_INSECURE_TLS=true. TLS certificate verification is disabled for email transport.');
        }

        this.config = {
            imap: {
                user: process.env.EMAIL_ADDRESS,
                password: process.env.APP_PASSWORD,
                host: 'imap.gmail.com',
                port: 993,
                tls: true,
                rejectUnauthorized: !allowInsecureTls,
                tlsOptions: { rejectUnauthorized: !allowInsecureTls },
                authTimeout: 10000 // Extended timeout
            }
        };

        // SMTP config for sending emails
        this.smtpConfig = {
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, // SSL
            tls: {
                rejectUnauthorized: !allowInsecureTls
            },
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.APP_PASSWORD
            }
        };

        // Draft queue - emails awaiting approval
        this.draftQueue = [];
    }

    /**
     * Get SMTP transporter for sending emails
     */
    getTransporter() {
        if (!this.smtpConfig.auth.user || !this.smtpConfig.auth.pass) {
            throw new Error("Missing EMAIL_ADDRESS or APP_PASSWORD env vars for SMTP");
        }
        return nodemailer.createTransport(this.smtpConfig);
    }

    async connect() {
        if (!this.config.imap.user || !this.config.imap.password) {
            throw new Error("Missing EMAIL_ADDRESS or APP_PASSWORD env vars");
        }
        return await imap.connect(this.config);
    }

    /**
     * Fetch unread emails with full thread history context
     */
    async getUnread(limit = 5) {
        let connection;
        try {
            connection = await this.connect();
            await connection.openBox('INBOX');

            const searchCriteria = ['UNSEEN'];
            const fetchOptions = {
                bodies: ['HEADER', 'TEXT', ''],
                markSeen: false,
                struct: true
            };

            const messages = await connection.search(searchCriteria, fetchOptions);
            // Sort by date descending and take limit
            const recent = messages.sort((a, b) =>
                new Date(b.attributes.date) - new Date(a.attributes.date)
            ).slice(0, limit);

            const emails = [];

            for (const item of recent) {
                const all = item.parts.find(p => p.which === '');
                const id = item.attributes.uid;
                const idHeader = "header.message-id";

                const parsed = await simpleParser(all ? all.body : '');

                // Basic Info
                const emailInfo = {
                    id: id,
                    seq: item.seq,
                    subject: parsed.subject,
                    from: parsed.from.text,
                    date: parsed.date,
                    body: parsed.text || parsed.html || "",
                    threadId: null // Gmail thread ID if available via X-GM-THRID usually requires extensions
                };

                emails.push(emailInfo);
            }

            return emails;
        } catch (e) {
            console.error("[KevinEmailManager] Fetch Error:", e);
            throw e;
        } finally {
            if (connection) connection.end();
        }
    }

    /**
     * Organize an email: apply labels, star it, or move it
     */
    async organize(emailUid, { category, priority, shouldStar, labels = [] }) {
        let connection;
        try {
            connection = await this.connect();
            await connection.openBox('INBOX');

            // 1. Star if needed
            if (shouldStar || priority === 'High') {
                await connection.addFlags(emailUid, '\\Flagged'); // Star
            }

            // Always mark as Seen (Read) when organizing to prevent scanning loop
            try {
                await connection.addFlags(emailUid, '\\Seen');
            } catch (seenErr) {
                console.log("Error marking email as seen:", seenErr.message);
            }

            // 2. Mark Important if Urgent
            if (category === 'Urgent Response Needed') {
                // Gmail doesn't map \Important directly via standard IMAP flags usually, but we can try
                // or just depend on labels.
            }

            // 3. Apply Labels (Kevin-Specific)
            // Gmail IMAP uses X-GM-LABELS. imap-simple supports addFlags but for specific gmail labels
            // we might need raw command or 'addLabels' if supported, but imap-simple allows adding custom flags/labels?
            // Actually imap-simple `addFlags` creates labels in Gmail.

            const tags = [...labels];
            if (category) tags.push(`Kevin/${category}`);
            if (priority) tags.push(`Kevin/${priority}`);

            if (tags.length > 0) {
                // Gmail expects labels to be added specifically. 
                // Note: 'imap-simple' addFlags might not treat string as label but as system flag.
                // We will iterate and try to add them.
                try {
                    await connection.addFlags(emailUid, tags);
                } catch (err) {
                    console.log("Error adding labels:", err.message);
                }
            }

            return { success: true, actions: { star: shouldStar, labels: tags } };

        } catch (e) {
            console.error("[KevinEmailManager] Organize Error:", e);
            return { success: false, error: e.message };
        } finally {
            if (connection) connection.end();
        }
    }

    /**
     * Save a draft to the queue (awaiting approval)
     */
    async saveDraft(to, subject, body, originalEmailId = null, metadata = {}) {
        const draft = {
            id: `draft_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            to,
            subject,
            body,
            originalEmailId,
            metadata,
            createdAt: new Date().toISOString(),
            status: 'pending_approval'
        };

        this.draftQueue.push(draft);
        console.log(`[KevinEmailManager] Draft saved: ${draft.id} - To: ${to}`);

        return {
            success: true,
            draft,
            message: "Draft saved to approval queue. Use approveDraft() to send."
        };
    }

    /**
     * Get all pending drafts
     */
    getDrafts() {
        return this.draftQueue.filter(d => d.status === 'pending_approval');
    }

    /**
     * Get a specific draft by ID
     */
    getDraft(draftId) {
        return this.draftQueue.find(d => d.id === draftId);
    }

    /**
     * Approve and send a draft
     */
    async approveDraft(draftId) {
        const draft = this.getDraft(draftId);
        if (!draft) {
            return { success: false, error: 'Draft not found' };
        }

        if (draft.status !== 'pending_approval') {
            return { success: false, error: `Draft already ${draft.status}` };
        }

        const result = await this.sendEmail(draft.to, draft.subject, draft.body);

        if (result.success) {
            draft.status = 'sent';
            draft.sentAt = new Date().toISOString();
        } else {
            draft.status = 'failed';
            draft.error = result.error;
        }

        return result;
    }

    /**
     * Reject/delete a draft
     */
    rejectDraft(draftId) {
        const index = this.draftQueue.findIndex(d => d.id === draftId);
        if (index === -1) {
            return { success: false, error: 'Draft not found' };
        }

        this.draftQueue[index].status = 'rejected';
        return { success: true, message: 'Draft rejected' };
    }

    /**
     * Send an email directly (use with caution - prefer draft approval flow)
     */
    async sendEmail(to, subject, body, options = {}) {
        try {
            const transporter = this.getTransporter();

            const mailOptions = {
                from: `"KEVIN Security" <${process.env.EMAIL_ADDRESS}>`,
                to: to,
                subject: subject,
                text: body,
                html: options.html || this._formatAsHtml(body),
                replyTo: options.replyTo || process.env.EMAIL_ADDRESS,
                // Add In-Reply-To header if this is a reply
                ...(options.inReplyTo && {
                    inReplyTo: options.inReplyTo,
                    references: options.references || options.inReplyTo
                })
            };

            const info = await transporter.sendMail(mailOptions);

            console.log(`[KevinEmailManager] Email sent: ${info.messageId}`);

            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };

        } catch (error) {
            console.error('[KevinEmailManager] Send Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Reply to an email (fetches original and sends reply)
     */
    async replyToEmail(originalEmailId, replyBody) {
        let connection;
        try {
            // Fetch original email details
            connection = await this.connect();
            await connection.openBox('INBOX');

            const fetchOptions = {
                bodies: ['HEADER', ''],
                struct: true
            };

            const messages = await connection.search([['UID', originalEmailId]], fetchOptions);

            if (messages.length === 0) {
                return { success: false, error: 'Original email not found' };
            }

            const item = messages[0];
            const all = item.parts.find(p => p.which === '');
            const parsed = await simpleParser(all ? all.body : '');

            // Build reply
            const replySubject = parsed.subject.startsWith('Re:')
                ? parsed.subject
                : `Re: ${parsed.subject}`;

            const replyTo = parsed.from.value[0].address;

            // Send the reply
            const result = await this.sendEmail(replyTo, replySubject, replyBody, {
                inReplyTo: parsed.messageId,
                references: parsed.references ? `${parsed.references} ${parsed.messageId}` : parsed.messageId
            });

            return result;

        } catch (error) {
            console.error('[KevinEmailManager] Reply Error:', error);
            return { success: false, error: error.message };
        } finally {
            if (connection) connection.end();
        }
    }

    /**
     * Format plain text as simple HTML
     */
    _formatAsHtml(text) {
        // Kevin's signature style
        const signature = `
            <br><br>
            <hr style="border: 1px solid #333;">
            <p style="color: #666; font-size: 12px;">
                🛡️ <strong>KEVIN</strong> - Security Intelligence System<br>
                <em>Stay paranoid. Stay safe.</em>
            </p>
        `;

        const htmlBody = text
            .replace(/\n/g, '<br>')
            .replace(/⚠️/g, '⚠️')
            .replace(/🔒/g, '🔒')
            .replace(/🛡️/g, '🛡️');

        return `
            <div style="font-family: 'Courier New', monospace; padding: 20px; background: #1a1a1a; color: #00ff00;">
                ${htmlBody}
                ${signature}
            </div>
        `;
    }
}

module.exports = { KevinEmailManager };
