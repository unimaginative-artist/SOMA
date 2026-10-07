import { ExpertiseBase } from '../../../core/ExpertiseBase.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

export class KevinSecurityRuntime extends ExpertiseBase {
    constructor(config = {}) {
        super({
            ...config,
            name: 'KevinSecurity',
            category: 'Security',
            version: '1.0.0'
        });
        this.manifest = config.manifest || config.expertiseManifest || {};
        this.dbPath = path.join(__dirname, 'security-db.json');
        this.db = null;
    }

    async getPhases() {
        return ['AUDIT', 'SANDBOX_ANALYZE', 'HARDEN', 'THREAT_REPORT'];
    }

    getStatus() {
        return {
            ...super.getStatus(),
            id: this.manifest.id || 'security/kevin',
            persona: 'K.E.V.I.N. Operator Guard',
            thalamus: !!this._getThalamusBrain(),
            dbLoaded: !!this.db
        };
    }

    async _loadDb() {
        if (this.db) return;
        try {
            const raw = await fs.readFile(this.dbPath, 'utf8');
            this.db = JSON.parse(raw);
        } catch (e) {
            console.error('[KevinSecurity] Failed to load security-db.json:', e.message);
            this.db = {
                phishing_heuristics: { keywords: [], suspicious_tlds: [] },
                hardening_checklist: { monitored_env_vars: [], restricted_ports: [] },
                verdict_thresholds: { suspicion_low: 30, suspicion_medium: 55, suspicion_high: 85 }
            };
        }
    }

    async runMission(target = {}) {
        await this._loadDb();
        const request = typeof target === 'string'
            ? { prompt: target, mode: 'audit' }
            : { mode: 'audit', ...target };

        const mode = String(request.mode || 'audit').toLowerCase();
        const startedAt = Date.now();

        let result;
        if (mode === 'audit') {
            result = await this._runAudit();
        } else if (mode === 'sandbox_analyze' || mode === 'analyze') {
            result = await this._runSandboxAnalyze(request);
        } else if (mode === 'harden') {
            result = await this._runHarden();
        } else if (mode === 'threat_report') {
            result = await this._runThreatReport();
        } else {
            result = { error: `Unsupported execution mode: ${mode}` };
        }

        this.metrics.missionsCompleted++;
        this.metrics.lastRun = Date.now();
        this.metrics.avgConfidence = result.confidence || 0.9;

        return {
            success: !result.error,
            mode,
            persona: 'Kevin',
            brain: 'Thalamus',
            elapsedMs: Date.now() - startedAt,
            response: result.response || result.error || 'Mission completed with no output.',
            structured: result
        };
    }

    async _runAudit() {
        const issues = [];
        const envChecks = {};

        // Check environment variables
        const envVars = this.db.hardening_checklist?.monitored_env_vars || [];
        for (const envVar of envVars) {
            const isSet = !!process.env[envVar];
            envChecks[envVar] = isSet;
            if (!isSet) {
                issues.push(`Environment variable missing: ${envVar}`);
            }
        }

        const listeningPorts = await this._getListeningPorts();
        const restrictedPorts = this.db.hardening_checklist?.restricted_ports || [];
        const portScan = [];
        for (const p of restrictedPorts) {
            const listeners = listeningPorts.filter(row => Number(row.port) === Number(p.port));
            portScan.push({
                port: p.port,
                service: p.service,
                status: listeners.length ? 'LISTENING' : 'CLOSED',
                notes: p.description,
                listeners
            });
            if (listeners.some(row => ['0.0.0.0', '::', '*'].includes(String(row.localAddress)))) {
                issues.push(`Restricted port globally bound: ${p.port} (${p.service})`);
            }
        }

        // Formulate response
        const totalIssues = issues.length;
        const healthScore = Math.max(0, 100 - (totalIssues * 15));
        
        let response = `=== SOMA SECURITY HARDIHOOD AUDIT ===\n`;
        response += `Health Score: ${healthScore}%\n`;
        response += `Status: ${healthScore > 80 ? 'CLEAN' : healthScore > 50 ? 'WARNING' : 'CRITICAL'}\n\n`;
        
        if (issues.length > 0) {
            response += `Identified Weaknesses:\n`;
            issues.forEach(iss => response += `- [⚠️] ${iss}\n`);
        } else {
            response += `✅ No missing security environment credentials detected.\n`;
        }

        return {
            healthScore,
            issues,
            portScan,
            response,
            confidence: 0.95
        };
    }

    async _runHarden() {
        const response = `=== K.E.V.I.N. SYSTEM HARDENING VERDICT ===
1. [DNS] Ensure SPF ('v=spf1 mx ~all') and DMARC ('p=quarantine') policies are active for monitored domains.
2. [ENVIRONMENT] Store all API keys in config/api-keys.env instead of primary .env to avoid accidental repository commit leaks.
3. [PORTS] Secure socket connections for bridge interfaces. Verify bound interface is 127.0.0.1 rather than 0.0.0.0 unless clustering is required.
4. [AUTONOMY] Autopilot loop remains in 'guarded' mode. Run periodic audit sessions if micro-agents perform actions.`;

        return {
            hardenList: [
                "Configure SPF and DMARC policies for email safety",
                "Isolate API credentials to config/api-keys.env",
                "Bind WebSocket connections to 127.0.0.1 local interface"
            ],
            response,
            confidence: 0.95
        };
    }

    async _runSandboxAnalyze(request) {
        const emailSubject = request.subject || '';
        const emailBody = request.body || '';
        const sender = request.sender || '';
        
        const heuristics = this.db.phishing_heuristics || { keywords: [], suspicious_tlds: [] };
        const foundKeywords = [];
        const matchingTLDs = [];

        // Run basic text analysis
        heuristics.keywords.forEach(kw => {
            if (emailSubject.toLowerCase().includes(kw) || emailBody.toLowerCase().includes(kw)) {
                foundKeywords.push(kw);
            }
        });

        heuristics.suspicious_tlds.forEach(tld => {
            if (sender.toLowerCase().endsWith(tld)) {
                matchingTLDs.push(tld);
            }
        });

        // Compute threat heuristics score
        let heuristicScore = 0;
        heuristicScore += foundKeywords.length * 20;
        if (matchingTLDs.length > 0) heuristicScore += 45;
        
        // Cap heuristics score at 95
        heuristicScore = Math.min(heuristicScore, 95);

        // Query Thalamus Lobe for deeper contextual evaluation
        const brain = this._getThalamusBrain();
        let explanation = '';
        
        if (brain) {
            const thalamusPrompt = `[THALAMUS EVALUATION]
SENDER: "${sender}"
SUBJECT: "${emailSubject}"
BODY:
"${emailBody.substring(0, 1500)}"

HEURISTIC FLAGS:
- Suspicious Keywords found: ${JSON.stringify(foundKeywords)}
- Suspicious TLD found: ${JSON.stringify(matchingTLDs)}
- Heuristic Score: ${heuristicScore}

Provide a security analyst verdict explaining:
1. Is this message a threat (phishing, scam, spam)?
2. Brief risk justification.
Keep response under 150 words.`;
            
            try {
                const brainResult = await brain.reason(thalamusPrompt, {
                    temperature: 0.1,
                    brain: 'THALAMUS',
                    quickResponse: true
                });
                explanation = brainResult?.text || brainResult?.response || '';
            } catch (err) {
                explanation = `Thalamus query failed: ${err.message}. Relying on heuristic fallback.`;
            }
        } else {
            explanation = `Thalamus brain lobe offline. Heuristic alert triggered due to flags: ${JSON.stringify(foundKeywords)}.`;
        }

        const isUnsafe = heuristicScore >= this.db.verdict_thresholds.suspicion_medium;
        const response = `=== SANDBOX LINK/EMAIL ANALYSIS ===
Sender Verdict: ${isUnsafe ? 'UNSAFE' : 'SAFE'} (Risk Score: ${heuristicScore}/100)
Heuristic Triggers: ${foundKeywords.length + matchingTLDs.length} detected.

Analysis:
${explanation}`;

        return {
            isUnsafe,
            score: heuristicScore,
            triggers: { keywords: foundKeywords, tlds: matchingTLDs },
            explanation,
            response,
            confidence: 0.90
        };
    }

    async _runThreatReport() {
        const kevinArbiter = this.system?.kevinArbiter || null;
        const stats = kevinArbiter?.stats || { scanned: 0, threats: 0, spam: 0 };
        const gmail = kevinArbiter?.gmailWebhook?.getStatus?.() || {};
        const sms = kevinArbiter?.smsService?.getConfig?.() || {};
        const email = {
            configured: !!(process.env.EMAIL_ADDRESS && process.env.APP_PASSWORD),
            connected: !!kevinArbiter?.useRealEmail
        };

        const response = `=== SECURITY BRIEFING BRIEFING ===
Uptime Monitoring active.
Email Scans: ${stats.scanned} total inspects performed.
Verdicts: ${stats.threats} threat targets neutralized, ${stats.spam} spam targets filtered.
Active Monitors: Email ${email.connected ? 'connected' : email.configured ? 'configured-not-connected' : 'not-configured'}, Gmail webhook ${gmail.running ? 'running' : 'offline'}, SMS ${sms.config?.enabled ? 'enabled' : 'disabled'}.`;

        return {
            stats,
            monitors: { email, gmail, sms: sms.config || sms },
            response,
            confidence: 0.95
        };
    }

    _getThalamusBrain() {
        return this.system?.quadBrain || null;
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
}

export default KevinSecurityRuntime;
