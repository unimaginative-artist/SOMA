/**
 * KevinSecurityAudit - Configuration Security Validator
 *
 * Inspired by clawdbot's audit.ts
 *
 * Features:
 * - Validate Kevin's security configuration
 * - Detect risky settings (open access, missing auth, etc.)
 * - Check file permissions on sensitive files
 * - Provide actionable recommendations
 *
 * Severity Levels:
 * - critical: Immediate action required
 * - warn: Should be addressed
 * - info: Informational/best practice
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Audit finding severity
const Severity = {
    CRITICAL: 'critical',
    WARN: 'warn',
    INFO: 'info'
};

class KevinSecurityAudit {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(process.cwd(), 'data', 'kevin');
        this.configDir = options.configDir || path.join(process.cwd(), 'config');
        this.findings = [];
    }

    /**
     * Run full security audit
     */
    async runAudit(kevinInstance = null) {
        this.findings = [];
        const startTime = Date.now();

        console.log('[SecurityAudit] Starting Kevin security audit...');

        // 1. Configuration checks
        await this._auditConfiguration(kevinInstance);

        // 2. File permission checks
        await this._auditFilePermissions();

        // 3. Credential checks
        await this._auditCredentials();

        // 4. Network/access checks
        await this._auditNetworkAccess(kevinInstance);

        // 5. Allowlist checks
        await this._auditAllowlists(kevinInstance);

        const duration = Date.now() - startTime;

        // Summarize
        const summary = {
            duration: `${duration}ms`,
            totalFindings: this.findings.length,
            critical: this.findings.filter(f => f.severity === Severity.CRITICAL).length,
            warnings: this.findings.filter(f => f.severity === Severity.WARN).length,
            info: this.findings.filter(f => f.severity === Severity.INFO).length,
            passed: this.findings.length === 0 ||
                    this.findings.every(f => f.severity === Severity.INFO)
        };

        console.log(`[SecurityAudit] Complete: ${summary.critical} critical, ${summary.warnings} warnings`);

        return {
            success: true,
            summary,
            findings: this.findings,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Add a finding
     */
    _addFinding(severity, category, title, description, recommendation = null) {
        this.findings.push({
            severity,
            category,
            title,
            description,
            recommendation,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Audit Kevin's configuration
     */
    async _auditConfiguration(kevin) {
        // Check if email credentials are set
        if (!process.env.EMAIL_ADDRESS || !process.env.APP_PASSWORD) {
            this._addFinding(
                Severity.INFO,
                'email',
                'Email credentials not configured',
                'Kevin is running in simulation mode without real email access',
                'Set EMAIL_ADDRESS and APP_PASSWORD environment variables for real email monitoring'
            );
        }

        if (process.env.KEVIN_ALLOW_INSECURE_TLS === 'true') {
            this._addFinding(
                Severity.CRITICAL,
                'email',
                'Email TLS verification disabled',
                'KEVIN_ALLOW_INSECURE_TLS=true disables certificate verification for Kevin email transport',
                'Unset KEVIN_ALLOW_INSECURE_TLS except during a short local proxy diagnostic'
            );
        }

        // Check Gmail webhook config
        if (!process.env.GMAIL_PUBSUB_TOPIC) {
            this._addFinding(
                Severity.INFO,
                'email',
                'Gmail Pub/Sub not configured',
                'Real-time email notifications via webhooks are not set up',
                'Configure GMAIL_PUBSUB_TOPIC for real-time email alerts instead of polling'
            );
        }

        // Check notification channels
        const hasSlack = !!process.env.SLACK_WEBHOOK_URL || !!process.env.SLACK_BOT_TOKEN;
        const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
        const hasDiscord = !!process.env.DISCORD_WEBHOOK_URL;

        if (!hasSlack && !hasTelegram && !hasDiscord) {
            this._addFinding(
                Severity.WARN,
                'notifications',
                'No notification channels configured',
                'Kevin cannot send security alerts to any external channel',
                'Configure at least one of: SLACK_WEBHOOK_URL, TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID, or DISCORD_WEBHOOK_URL'
            );
        }

        // Check if running with elevated permissions
        if (process.getuid && process.getuid() === 0) {
            this._addFinding(
                Severity.WARN,
                'permissions',
                'Running as root',
                'Kevin is running with root/admin privileges',
                'Run Kevin as a non-privileged user for better security isolation'
            );
        }
    }

    /**
     * Audit file permissions on sensitive files
     */
    async _auditFilePermissions() {
        const sensitiveFiles = [
            path.join(this.configDir, 'kevin_notifications.json'),
            path.join(this.dataDir, 'sender_allowlist.json'),
            path.join(this.dataDir, 'kevin_threat_db.json'),
            path.join(process.cwd(), '.env')
        ];

        for (const filePath of sensitiveFiles) {
            if (fs.existsSync(filePath)) {
                try {
                    const stats = fs.statSync(filePath);
                    const mode = stats.mode;

                    // Check for world-readable (others read: 0o004)
                    if (mode & 0o004) {
                        this._addFinding(
                            Severity.WARN,
                            'permissions',
                            `World-readable file: ${path.basename(filePath)}`,
                            `${filePath} is readable by all users`,
                            `Run: chmod 600 "${filePath}"`
                        );
                    }

                    // Check for world-writable (others write: 0o002)
                    if (mode & 0o002) {
                        this._addFinding(
                            Severity.CRITICAL,
                            'permissions',
                            `World-writable file: ${path.basename(filePath)}`,
                            `${filePath} is writable by all users - HIGH RISK`,
                            `Run: chmod 600 "${filePath}"`
                        );
                    }
                } catch (e) {
                    // Windows doesn't support Unix permissions the same way
                    // Skip this check on Windows
                }
            }
        }
    }

    /**
     * Audit credentials and secrets
     */
    async _auditCredentials() {
        // Check for hardcoded credentials in config files
        const configFiles = [
            path.join(this.configDir, 'kevin_notifications.json'),
            path.join(process.cwd(), 'config.json')
        ];

        for (const filePath of configFiles) {
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');

                    // Look for potential secrets
                    const secretPatterns = [
                        { pattern: /password['"]\s*:\s*['"][^'"]+['"]/i, name: 'password' },
                        { pattern: /api[_-]?key['"]\s*:\s*['"][^'"]+['"]/i, name: 'API key' },
                        { pattern: /secret['"]\s*:\s*['"][^'"]+['"]/i, name: 'secret' },
                        { pattern: /token['"]\s*:\s*['"][A-Za-z0-9_-]{20,}['"]/i, name: 'token' }
                    ];

                    for (const { pattern, name } of secretPatterns) {
                        if (pattern.test(content)) {
                            this._addFinding(
                                Severity.CRITICAL,
                                'credentials',
                                `Potential ${name} in config file`,
                                `${path.basename(filePath)} may contain a hardcoded ${name}`,
                                'Move secrets to environment variables and remove from config files'
                            );
                        }
                    }
                } catch (e) {
                    // Ignore read errors
                }
            }
        }

        // Check for weak/short tokens
        const hookToken = process.env.GMAIL_HOOK_TOKEN;
        if (hookToken && hookToken.length < 32) {
            this._addFinding(
                Severity.WARN,
                'credentials',
                'Weak webhook token',
                `GMAIL_HOOK_TOKEN is only ${hookToken.length} characters`,
                'Use a token of at least 32 characters for webhook authentication'
            );
        }
    }

    /**
     * Audit network/access configuration
     */
    async _auditNetworkAccess(kevin) {
        // Check if webhook is bound to all interfaces
        const webhookPort = process.env.GMAIL_WEBHOOK_PORT;
        if (webhookPort && !process.env.GMAIL_WEBHOOK_BIND) {
            this._addFinding(
                Severity.INFO,
                'network',
                'Webhook binding not specified',
                'Gmail webhook may bind to all network interfaces',
                'Set GMAIL_WEBHOOK_BIND=127.0.0.1 if only local access is needed'
            );
        }

        // Check if running without TLS in production
        if (process.env.NODE_ENV === 'production' && !process.env.TLS_CERT) {
            this._addFinding(
                Severity.WARN,
                'network',
                'No TLS in production',
                'Running in production without TLS encryption',
                'Configure TLS_CERT and TLS_KEY for HTTPS, or use a reverse proxy'
            );
        }

        const listening = await this._getListeningPorts();
        const risky = listening.filter(row => {
            const local = String(row.localAddress || '');
            const globallyBound = local === '0.0.0.0' || local === '::' || local === '*';
            return globallyBound && [22, 80, 443, 3000, 3001, 3389, 8080, 8081].includes(Number(row.port));
        });
        for (const port of risky.slice(0, 10)) {
            this._addFinding(
                Severity.WARN,
                'network',
                `Sensitive port globally bound: ${port.port}`,
                `Port ${port.port} appears to be listening on ${port.localAddress}`,
                'Bind dev services to 127.0.0.1 unless remote access is required'
            );
        }
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
                    return {
                        localAddress: address.replace(/:\d+$/, ''),
                        port: Number((address.match(/:(\d+)$/) || [])[1]),
                        raw: line
                    };
                })
                .filter(row => row.port);
        } catch {
            return [];
        }
    }

    /**
     * Audit allowlists and access control
     */
    async _auditAllowlists(kevin) {
        // Load allowlist if it exists
        const allowlistPath = path.join(this.dataDir, 'sender_allowlist.json');

        if (fs.existsSync(allowlistPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
                const senders = data.senders || [];

                // Check for wildcard entries
                if (senders.includes('*') || senders.includes('@*')) {
                    this._addFinding(
                        Severity.CRITICAL,
                        'access',
                        'Wildcard in sender allowlist',
                        'Sender allowlist contains a wildcard entry allowing all senders',
                        'Remove wildcard entries and explicitly approve trusted senders'
                    );
                }

                // Check for suspiciously large allowlist
                if (senders.length > 1000) {
                    this._addFinding(
                        Severity.WARN,
                        'access',
                        'Very large allowlist',
                        `Sender allowlist contains ${senders.length} entries`,
                        'Review allowlist for stale or unnecessary entries'
                    );
                }

                // Check for free email domains that might be abused
                const freeEmailDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
                const freeEmailCount = senders.filter(s =>
                    freeEmailDomains.some(d => s.endsWith('@' + d) || s.endsWith('.' + d))
                ).length;

                if (freeEmailCount > 50) {
                    this._addFinding(
                        Severity.INFO,
                        'access',
                        'Many free email addresses in allowlist',
                        `${freeEmailCount} entries use free email providers`,
                        'Consider using domain-based allowlisting for business contacts'
                    );
                }
            } catch (e) {
                this._addFinding(
                    Severity.WARN,
                    'access',
                    'Cannot parse allowlist',
                    `Error reading sender allowlist: ${e.message}`,
                    'Check allowlist file format'
                );
            }
        }

        // Check blocked senders (threat database)
        const threatDbPath = path.join(process.cwd(), 'data', 'kevin_threat_db.json');
        if (fs.existsSync(threatDbPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(threatDbPath, 'utf8'));

                // Check if threat database is being maintained
                if (!data.updatedAt) {
                    this._addFinding(
                        Severity.INFO,
                        'access',
                        'Threat database has no timestamp',
                        'Cannot verify when threat database was last updated',
                        'Ensure threat database is regularly updated'
                    );
                } else {
                    const lastUpdate = new Date(data.updatedAt);
                    const daysSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

                    if (daysSinceUpdate > 30) {
                        this._addFinding(
                            Severity.WARN,
                            'access',
                            'Stale threat database',
                            `Threat database was last updated ${Math.round(daysSinceUpdate)} days ago`,
                            'Update threat intelligence regularly for best protection'
                        );
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
    }

    /**
     * Get findings by severity
     */
    getFindings(severity = null) {
        if (!severity) return this.findings;
        return this.findings.filter(f => f.severity === severity);
    }

    /**
     * Quick check for critical issues only
     */
    async quickCheck(kevin) {
        await this.runAudit(kevin);
        return {
            hasCritical: this.findings.some(f => f.severity === Severity.CRITICAL),
            criticalCount: this.findings.filter(f => f.severity === Severity.CRITICAL).length,
            criticalFindings: this.findings.filter(f => f.severity === Severity.CRITICAL)
        };
    }
}

module.exports = { KevinSecurityAudit, Severity };
