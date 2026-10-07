/**
 * KevinThreatDatabase - Known Threat Intelligence Database
 *
 * Contains:
 * - Malicious attachment hashes (SHA256)
 * - Suspicious patterns
 * - Email categorization rules
 * - Learned safe/unsafe senders
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class KevinThreatDatabase {
    constructor() {
        // Data file path
        this.dataPath = process.env.KEVIN_THREAT_DB_PATH ||
            path.join(process.cwd(), 'data', 'kevin_threat_db.json');

        // Known malicious hashes from old Kevin's knowledge base
        this.maliciousHashes = new Set([
            '9b0d7ea7e0b7ac2645b1211f8e23173c9cef2f69e999c879685a367f0cf9ffb8',
            '96f9b611068d409912155a4db2e24314dc03e72bbd24f7a077aa08f6b23ebf34',
            '9c587d3ffeff0e42b5da835716a403c70f44222119e61fb11ce46b6682249af3',
            '24a0785f8831c02796c78c55c35332756958b6cb740bb53ddb084f79ca7ea63b',
            'bf2c855a8df304d7502481482c9348193a341c912aa9e84a261e322287025f30',
            'f69358d9f2bd1ca5048b0d4d77464a90817fa73aff65a691817ecf730c4bf405',
            '21bdcec31298ec87bf355ebfcf75ffb586c0bd1fe5499672dc00c126a30926ed',
            'cd4a0c49041fb5228a953104163463d2c9c350f8d11cd5664ea48d31502a1c03',
            'cc6bd300d938cb7a739079d5a0ce0df9bbf1ca72f12364caa9aed6c7829742d7',
            '579f45913beda44da67237ba4dbd1b6a47b93c07d1d055fa34daee537b0b9a1f',
            'aa0529889cf399e1215ecde317512ee297ad5b08465e308c5f2952a8ece36df6',
            'fa1697bc8242ab8d7b70701edf1bba9ad3b8a2f132b58bae3426bfd9e00e1fae',
            'f34a9d0603c5e3872c64f484e969a391eb3248c8707537118cd69f91a82f56ac',
            '32199e7cc928b6fca221256ec638532d4372e97c4b598f1d9832198c9f7f9f0a',
            'e223f180895f08278a5ddc8d79c4f8d4cb3551a9079c061d275aca0d3cc73f27',
            'a6c3d8cf3c47d60c1a33c1671caba30431e1be30936940b289da9bbf03d26c98',
            '76598b562eab21f460c3c4605a5d9948fd6efe99b24dc92d728e94daec4573f9',
            '9c39c0c72d4f755e570c02b28820062c155c7d3cbbb9b59c394693134ba2f76e',
            '6f03d8a20121c6b3d87ca993be4f24cb62d7c8973ba8b90e42157aaea23a09a4',
            '22038e6b7db53e3649cdfe7466703b264743cd411b7c71904de7d8430559802f',
            'ff808f553899828466077fb7c9130870930375c4e96212fb59be2d60c37d9495',
            'f4559ceadebf27cb34d904b6e5d0d11add09f392c2d7a2e8a964a6bd4a218388',
            'ab225ba53ab72f8fdc157ec1b8bd82ef10398efe72d468e2ee23f94784bb036d',
            '1cb37bcb26fc9e4dca286e763258f7dc631233ae9ba418f3f2e662a672232d33',
            'cd12bb6c00af5ee96c585fa48984ed5eb6cba3132cb5f71b053a49ad0940009b',
            'a0f4915b4fe88c082901e0455c859df3820c2a796da6e50ba8f3c47ce8ce200d',
            '36983be59925a271303b58c214dbf64f7fd351bd47f51253a80288609477cde9',
            '34d2ca1e1bacfffd924ee5cb869fc14b77cf79d7b0dfe6a1f0d04a1eefc8254b',
            'eae9fdffafd5cb33602e70c8999d56606177b9889d26e1a3d6f038ba8a6884fa',
            'be5d683f337041c4bb2ae841076f181598fafaa0ded6576f346292be6e5e2f35',
            // ... (100+ more hashes stored)
        ]);

        // Email categorization keywords (from old Kevin config)
        this.categoryKeywords = {
            Work: ['meeting', 'project', 'deadline', 'presentation', 'report', 'agenda',
                'sprint', 'standup', 'review', 'feedback', 'milestone', 'deliverable',
                'client', 'stakeholder', 'proposal', 'contract', 'invoice business'],
            Personal: ['birthday', 'dinner', 'weekend', 'family', 'friend', 'party',
                'vacation', 'trip', 'holiday', 'celebration', 'reunion', 'wedding'],
            Bills: ['invoice', 'payment', 'statement', 'due', 'bill', 'balance',
                'receipt', 'charge', 'subscription', 'renewal', 'account'],
            Shopping: ['order', 'shipped', 'delivery', 'tracking', 'deal', 'purchase',
                'confirmation', 'dispatch', 'arriving', 'package', 'return', 'refund'],
            Newsletters: ['unsubscribe', 'newsletter', 'update', 'weekly', 'digest',
                'subscription', 'bulletin', 'announcement', 'news'],
            Security: ['password', 'reset', 'verify', 'authentication', 'login attempt',
                'suspicious', 'security alert', 'breach', 'compromised']
        };

        // Suspicious attachment extensions
        this.suspiciousExtensions = [
            '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.vbe',
            '.js', '.jse', '.wsf', '.wsh', '.ps1', '.msi', '.msp', '.hta',
            '.cpl', '.jar', '.reg', '.dll', '.lnk', '.iso', '.img'
        ];

        // Phishing indicators
        this.phishingPatterns = [
            /urgent.*action.*required/i,
            /verify.*account.*immediately/i,
            /your.*account.*suspended/i,
            /click.*here.*to.*confirm/i,
            /update.*payment.*information/i,
            /unusual.*activity.*detected/i,
            /password.*expire/i,
            /security.*alert.*verify/i,
            /bank.*account.*locked/i,
            /prize.*winner.*claim/i,
            /lottery.*congratulations/i,
            /inheritance.*million/i,
            /nigerian.*prince/i,
            /wire.*transfer.*fee/i,
            /dear.*customer.*valued/i,
            /act.*now.*limited.*time/i
        ];

        // Safe senders (learned)
        this.safeSenders = new Set();

        // Blocked senders
        this.blockedSenders = new Set();

        // Decision audit trail for reversible security actions
        this.trustDecisions = [];

        // Sender/domain memory. This is KEVIN's long-term reputation cache.
        this.senderMemory = {};
        this.domainMemory = {};

        // Load persisted data
        this._loadData();
    }

    /**
     * Check if an attachment hash is known malicious
     */
    isHashMalicious(hash) {
        return this.maliciousHashes.has(hash.toLowerCase());
    }

    /**
     * Calculate SHA256 hash of content
     */
    calculateHash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Check attachment for threats
     */
    analyzeAttachment(filename, content) {
        const result = {
            filename,
            isSafe: true,
            threatLevel: 0,
            warnings: [],
            evidence: [],
            hash: null,
            extension: path.extname(filename || '').toLowerCase(),
            category: 'unknown'
        };

        // Check extension
        const ext = result.extension;
        if (['.pdf'].includes(ext)) result.category = 'document_pdf';
        else if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) result.category = 'office_document';
        else if (['.zip', '.rar', '.7z', '.gz'].includes(ext)) result.category = 'archive';
        else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) result.category = 'image';
        else if (this.suspiciousExtensions.includes(ext)) result.category = 'executable_or_script';

        if (this.suspiciousExtensions.includes(ext)) {
            result.isSafe = false;
            result.threatLevel += 50;
            result.warnings.push(`Dangerous file type: ${ext}`);
            result.evidence.push({ type: 'dangerous_extension', severity: 'high', detail: ext, score: 50 });
        }

        if (['.zip', '.rar', '.7z', '.iso', '.img'].includes(ext)) {
            result.threatLevel += 20;
            result.warnings.push(`Container/archive requires sandbox inspection: ${ext}`);
            result.evidence.push({ type: 'container_attachment', severity: 'medium', detail: ext, score: 20 });
        }

        if (/\.(pdf|docx?|xlsx?|pptx?)\.(exe|scr|js|vbs|ps1|bat|cmd)$/i.test(filename || '')) {
            result.isSafe = false;
            result.threatLevel += 45;
            result.warnings.push('Document-disguised executable');
            result.evidence.push({ type: 'document_disguised_executable', severity: 'critical', detail: filename, score: 45 });
        }

        // Check hash if content provided
        if (content) {
            const hash = this.calculateHash(content);
            result.hash = hash;
            if (this.isHashMalicious(hash)) {
                result.isSafe = false;
                result.threatLevel = 100;
                result.warnings.push('KNOWN MALWARE - Hash match in threat database');
                result.evidence.push({ type: 'known_malware_hash', severity: 'critical', detail: hash, score: 100 });
            }
        }

        // Double extension check (e.g., invoice.pdf.exe)
        const doubleExtMatch = filename.match(/\.[a-z]{2,4}\.[a-z]{2,4}$/i);
        if (doubleExtMatch) {
            result.threatLevel += 30;
            result.warnings.push('Suspicious double extension');
            result.evidence.push({ type: 'double_extension', severity: 'medium', detail: filename, score: 30 });
        }

        result.threatLevel = Math.min(100, result.threatLevel);
        result.isSafe = result.threatLevel < 40;

        return result;
    }

    /**
     * Categorize an email based on content
     */
    categorizeEmail(email) {
        const text = `${email.subject || ''} ${email.body || ''}`.toLowerCase();
        const scores = {};

        for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
            scores[category] = 0;
            for (const keyword of keywords) {
                if (text.includes(keyword.toLowerCase())) {
                    scores[category]++;
                }
            }
        }

        // Find highest scoring category
        let bestCategory = 'General';
        let bestScore = 0;
        for (const [category, score] of Object.entries(scores)) {
            if (score > bestScore) {
                bestScore = score;
                bestCategory = category;
            }
        }

        return {
            category: bestCategory,
            confidence: Math.min(bestScore / 3, 1), // Normalize to 0-1
            scores
        };
    }

    /**
     * Check email for phishing indicators
     */
    checkPhishing(email) {
        const text = `${email.subject || ''} ${email.body || ''}`;
        const indicators = [];

        for (const pattern of this.phishingPatterns) {
            if (pattern.test(text)) {
                indicators.push(pattern.source);
            }
        }

        // Check for mismatched links
        const linkPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
        let match;
        while ((match = linkPattern.exec(text)) !== null) {
            const [, href, displayText] = match;
            if (displayText.includes('http') && !href.includes(displayText.replace(/https?:\/\//, '').split('/')[0])) {
                indicators.push('Mismatched link URL');
            }
        }

        const threatScore = Math.min(indicators.length * 20, 100);

        return {
            isPhishing: threatScore >= 40,
            threatScore,
            indicators
        };
    }

    /**
     * Build a structured, defensible security verdict for an email.
     */
    buildEmailVerdict(email = {}) {
        const evidence = [];
        const riskFactors = [];
        const mitigations = [];
        let score = 0;

        const sender = this._extractEmail(email.from || '').toLowerCase();
        const subject = String(email.subject || '');
        const body = String(email.body || '');
        const text = `${subject} ${body}`;

        if (sender && this.blockedSenders.has(sender)) {
            score = 100;
            riskFactors.push('Sender is blocked');
            evidence.push({ type: 'sender_blocked', severity: 'critical', detail: sender, score: 100 });
        } else if (sender && this.safeSenders.has(sender)) {
            mitigations.push('Sender is on the safe list');
            evidence.push({ type: 'sender_safe', severity: 'info', detail: sender, score: -20 });
            score -= 20;
        }

        const domain = sender.split('@')[1] || '';
        const senderRep = this._getSenderMemory(sender);
        const domainRep = this._getDomainMemory(domain);
        if (senderRep.interactions > 0) {
            evidence.push({ type: 'sender_memory', severity: 'info', detail: `${senderRep.interactions} prior interaction(s), trust ${senderRep.trustScore}`, score: -Math.round(senderRep.trustScore * 10) });
            score -= Math.round(senderRep.trustScore * 10);
        }
        if (domainRep.riskScore > 0) {
            score += Math.round(domainRep.riskScore * 0.35);
            riskFactors.push(`Domain reputation risk: ${domainRep.riskScore}`);
            evidence.push({ type: 'domain_reputation', severity: domainRep.riskScore >= 60 ? 'high' : 'medium', detail: domain, score: Math.round(domainRep.riskScore * 0.35) });
        }

        const phishing = this.checkPhishing(email);
        if (phishing.indicators.length) {
            score += phishing.threatScore;
            riskFactors.push(...phishing.indicators.map(i => `Phishing pattern: ${i}`));
            evidence.push(...phishing.indicators.map(indicator => ({
                type: 'phishing_pattern',
                severity: phishing.threatScore >= 60 ? 'high' : 'medium',
                detail: indicator,
                score: 20
            })));
        }

        if (/\burgent\b|\bimmediately\b|\bact now\b/i.test(text)) {
            score += 20;
            riskFactors.push('Urgency or pressure language');
            evidence.push({ type: 'pressure_language', severity: 'medium', detail: 'Urgency wording detected', score: 20 });
        }

        if (/\b(password|login|verify your account|credential|2fa|mfa)\b/i.test(text)) {
            score += 30;
            riskFactors.push('Credential or account verification request');
            evidence.push({ type: 'credential_request', severity: 'high', detail: 'Credential/account wording detected', score: 30 });
        }

        if (/\b(wire|transfer|payment|bank|invoice|gift card|crypto)\b/i.test(text)) {
            score += 25;
            riskFactors.push('Financial action requested');
            evidence.push({ type: 'financial_request', severity: 'high', detail: 'Payment/transfer wording detected', score: 25 });
        }

        const urls = body.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g) || [];
        if (urls.length > 3) {
            score += 10;
            riskFactors.push(`Many links present (${urls.length})`);
            evidence.push({ type: 'link_volume', severity: 'low', detail: `${urls.length} URLs found`, score: 10 });
        }

        for (const url of urls.slice(0, 5)) {
            try {
                const hostname = new URL(url).hostname.toLowerCase();
                if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
                    score += 35;
                    riskFactors.push('IP-address URL present');
                    evidence.push({ type: 'ip_url', severity: 'high', detail: url, score: 35 });
                }
                if (['.xyz', '.top', '.buzz', '.click', '.loan', '.work'].some(tld => hostname.endsWith(tld))) {
                    score += 20;
                    riskFactors.push(`Suspicious URL TLD: ${hostname}`);
                    evidence.push({ type: 'suspicious_tld', severity: 'medium', detail: hostname, score: 20 });
                }
            } catch {
                score += 20;
                riskFactors.push('Malformed URL present');
                evidence.push({ type: 'malformed_url', severity: 'medium', detail: url, score: 20 });
            }
        }

        const attachments = this._normalizeAttachments(email.attachments || []);
        for (const attachment of attachments.slice(0, 10)) {
            const analysis = this.analyzeAttachment(attachment.filename || attachment.name || 'attachment', attachment.content || attachment.buffer || attachment.data);
            if (analysis.threatLevel > 0) {
                score += analysis.threatLevel;
                riskFactors.push(...analysis.warnings);
                evidence.push(...analysis.evidence);
            }
        }

        if (this._looksLikeImpersonation(sender, subject, body)) {
            score += 25;
            riskFactors.push('Possible brand or executive impersonation');
            evidence.push({ type: 'impersonation_signal', severity: 'high', detail: 'Brand/executive wording with external sender context', score: 25 });
        }

        const category = this.categorizeEmail(email);
        score = Math.max(0, Math.min(100, score));
        const verdict = score >= 80 ? 'block' : score >= 55 ? 'high_risk' : score >= 30 ? 'caution' : 'allow';
        const confidence = evidence.length >= 4 ? 0.9 : evidence.length >= 2 ? 0.78 : evidence.length === 1 ? 0.66 : 0.58;
        const requiresApproval = verdict !== 'allow' || /\b(send|reply|schedule|pay|transfer|approve)\b/i.test(text);

        // Generate dynamic safety/risk explanation
        let analysis = '';
        if (sender && this.blockedSenders.has(sender)) {
            analysis = `The sender "${sender}" is explicitly blocked in SOMA's threat database. Interacting with this email is highly discouraged.`;
        } else if (sender && this.safeSenders.has(sender) && score < 55) {
            analysis = `The sender "${sender}" is on the safe/trusted list. The email is marked as safe.`;
        } else {
            if (score >= 55) {
                analysis = `Flagged as unsafe (Score: ${score}%). Kevin detected the following warning indicators: ${riskFactors.join(', ')}.`;
            } else if (score > 0) {
                analysis = `Marked as safe with minor warnings (Score: ${score}%). Triggers detected: ${riskFactors.join(', ')}.`;
            } else {
                analysis = `Marked as safe. Kevin scanned the email and found no suspicious links, keywords, or phishing patterns.`;
            }
        }

        const result = {
            success: true,
            verdict,
            confidence,
            score,
            category: category.category,
            riskFactors,
            mitigations,
            evidence,
            recommendedAction: this._recommendedAction(verdict),
            reversible: true,
            requiresApproval,
            subject,
            sender,
            analysis
        };
        this.recordEmailOutcome({
            sender,
            domain,
            verdict,
            score,
            evidence,
            subject,
            urls: urls.length,
            attachments: attachments.length
        });
        return result;
    }

    _normalizeAttachments(attachments) {
        if (!Array.isArray(attachments)) return [];
        return attachments.map(item => ({
            filename: item.filename || item.name || item.path || 'attachment',
            content: item.content || item.buffer || item.data || null,
            size: item.size || item.length || 0,
            contentType: item.contentType || item.mimeType || ''
        }));
    }

    _looksLikeImpersonation(sender, subject, body) {
        const text = `${subject} ${body}`.toLowerCase();
        const domain = String(sender || '').split('@')[1] || '';
        const protectedBrands = ['google', 'microsoft', 'apple', 'amazon', 'paypal', 'github', 'bank', 'irs', 'docusign'];
        const mentionsBrand = protectedBrands.some(brand => text.includes(brand));
        const fromBrandDomain = protectedBrands.some(brand => domain.includes(brand));
        const executivePressure = /\b(ceo|cfo|boss|executive|director|confidential|wire|gift card|urgent)\b/i.test(text);
        return (mentionsBrand && !fromBrandDomain) || executivePressure;
    }

    _getSenderMemory(sender) {
        if (!sender) return { interactions: 0, trustScore: 0, riskScore: 0, reasons: [] };
        return this.senderMemory[sender] || { sender, firstSeen: null, lastSeen: null, interactions: 0, trustScore: 0, riskScore: 0, reasons: [] };
    }

    _getDomainMemory(domain) {
        if (!domain) return { interactions: 0, trustScore: 0, riskScore: 0, reasons: [] };
        return this.domainMemory[domain] || { domain, firstSeen: null, lastSeen: null, interactions: 0, trustScore: 0, riskScore: 0, reasons: [] };
    }

    recordEmailOutcome({ sender, domain, verdict, score, evidence = [], subject = '', urls = 0, attachments = 0 }) {
        const now = new Date().toISOString();
        const normalizedSender = String(sender || '').toLowerCase();
        const normalizedDomain = String(domain || normalizedSender.split('@')[1] || '').toLowerCase();
        const riskDelta = Math.min(100, Math.max(0, Number(score) || 0));
        const trustDelta = verdict === 'allow' ? 0.05 : -0.08;
        const reasons = evidence.map(e => e.type || e.detail).filter(Boolean).slice(0, 12);

        if (normalizedSender) {
            const memory = this._getSenderMemory(normalizedSender);
            this.senderMemory[normalizedSender] = {
                ...memory,
                sender: normalizedSender,
                firstSeen: memory.firstSeen || now,
                lastSeen: now,
                interactions: (memory.interactions || 0) + 1,
                trustScore: Math.max(-1, Math.min(1, Number(memory.trustScore || 0) + trustDelta)),
                riskScore: Math.round(((Number(memory.riskScore || 0) * Math.max(0, memory.interactions || 0)) + riskDelta) / Math.max(1, (memory.interactions || 0) + 1)),
                lastVerdict: verdict,
                lastSubject: String(subject || '').slice(0, 160),
                urls,
                attachments,
                reasons: [...new Set([...(memory.reasons || []), ...reasons])].slice(-25)
            };
        }

        if (normalizedDomain) {
            const memory = this._getDomainMemory(normalizedDomain);
            this.domainMemory[normalizedDomain] = {
                ...memory,
                domain: normalizedDomain,
                firstSeen: memory.firstSeen || now,
                lastSeen: now,
                interactions: (memory.interactions || 0) + 1,
                trustScore: Math.max(-1, Math.min(1, Number(memory.trustScore || 0) + trustDelta)),
                riskScore: Math.round(((Number(memory.riskScore || 0) * Math.max(0, memory.interactions || 0)) + riskDelta) / Math.max(1, (memory.interactions || 0) + 1)),
                lastVerdict: verdict,
                reasons: [...new Set([...(memory.reasons || []), ...reasons])].slice(-25)
            };
        }
        this._saveData();
    }

    getReputationCache() {
        return {
            success: true,
            senders: Object.values(this.senderMemory).sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0)),
            domains: Object.values(this.domainMemory).sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0))
        };
    }

    _recommendedAction(verdict) {
        switch (verdict) {
            case 'block':
                return 'Do not interact. Block or report after operator approval.';
            case 'high_risk':
                return 'Do not click links or send data. Verify through a known-good channel.';
            case 'caution':
                return 'Proceed only after checking sender identity and request context.';
            default:
                return 'No obvious threat. Use normal caution.';
        }
    }

    /**
     * Add a sender to safe list
     */
    markSenderSafe(sender) {
        const email = this._extractEmail(sender);
        this.safeSenders.add(email.toLowerCase());
        this.blockedSenders.delete(email.toLowerCase());
        this._recordDecision('safe_sender', email, { reversible: true });
        this._saveData();
        return { success: true, sender: email, reversible: true, action: 'safe_sender' };
    }

    /**
     * Block a sender
     */
    blockSender(sender) {
        const email = this._extractEmail(sender);
        this.blockedSenders.add(email.toLowerCase());
        this.safeSenders.delete(email.toLowerCase());
        this._recordDecision('block_sender', email, { reversible: true });
        this._saveData();
        return { success: true, sender: email, reversible: true, action: 'block_sender' };
    }

    unblockSender(sender) {
        const email = this._extractEmail(sender);
        this.blockedSenders.delete(email.toLowerCase());
        this._recordDecision('unblock_sender', email, { reversible: true });
        this._saveData();
        return { success: true, sender: email, reversible: true, action: 'unblock_sender' };
    }

    unmarkSenderSafe(sender) {
        const email = this._extractEmail(sender);
        this.safeSenders.delete(email.toLowerCase());
        this._recordDecision('unmark_safe_sender', email, { reversible: true });
        this._saveData();
        return { success: true, sender: email, reversible: true, action: 'unmark_safe_sender' };
    }

    /**
     * Check if sender is safe
     */
    isSenderSafe(sender) {
        const email = this._extractEmail(sender).toLowerCase();
        return this.safeSenders.has(email);
    }

    /**
     * Check if sender is blocked
     */
    isSenderBlocked(sender) {
        const email = this._extractEmail(sender).toLowerCase();
        return this.blockedSenders.has(email);
    }

    /**
     * Add a malicious hash to the database
     */
    addMaliciousHash(hash) {
        this.maliciousHashes.add(hash.toLowerCase());
        this._saveData();
    }

    /**
     * Get database stats
     */
    getStats() {
        return {
            maliciousHashes: this.maliciousHashes.size,
            phishingPatterns: this.phishingPatterns.length,
            safeSenders: this.safeSenders.size,
            blockedSenders: this.blockedSenders.size,
            decisions: this.trustDecisions.length,
            categories: Object.keys(this.categoryKeywords).length
        };
    }

    getTrustState() {
        return {
            success: true,
            safeSenders: [...this.safeSenders],
            blockedSenders: [...this.blockedSenders],
            recentDecisions: this.trustDecisions.slice(-25).reverse()
        };
    }

    /**
     * Extract email from "Name <email>" format
     */
    _extractEmail(sender) {
        const match = sender.match(/<([^>]+)>/);
        return match ? match[1] : sender;
    }

    /**
     * Load persisted data
     */
    _loadData() {
        try {
            if (fs.existsSync(this.dataPath)) {
                const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
                if (data.safeSenders) this.safeSenders = new Set(data.safeSenders);
                if (data.blockedSenders) this.blockedSenders = new Set(data.blockedSenders);
                if (data.trustDecisions) this.trustDecisions = data.trustDecisions.slice(-200);
                if (data.senderMemory && typeof data.senderMemory === 'object') this.senderMemory = data.senderMemory;
                if (data.domainMemory && typeof data.domainMemory === 'object') this.domainMemory = data.domainMemory;
                if (data.customHashes) {
                    data.customHashes.forEach(h => this.maliciousHashes.add(h));
                }
                console.log('[KevinThreatDB] Loaded threat database');
            }
        } catch (error) {
            console.log('[KevinThreatDB] No saved data found, using defaults');
        }
    }

    /**
     * Save data to disk
     */
    _saveData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                safeSenders: [...this.safeSenders],
                blockedSenders: [...this.blockedSenders],
                trustDecisions: this.trustDecisions.slice(-200),
                senderMemory: this.senderMemory,
                domainMemory: this.domainMemory,
                updatedAt: new Date().toISOString()
            };
            fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[KevinThreatDB] Save error:', error.message);
        }
    }

    _recordDecision(action, target, metadata = {}) {
        this.trustDecisions.push({
            id: `decision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            action,
            target,
            metadata,
            timestamp: new Date().toISOString()
        });
        if (this.trustDecisions.length > 200) {
            this.trustDecisions = this.trustDecisions.slice(-200);
        }
    }
}

module.exports = { KevinThreatDatabase };
