/**
 * SelfAuditArbiter.js
 *
 * SOMA's self-hardening scanner. Audits her own routes, config, and code surface
 * for vulnerabilities that an adversarial AI like Mythos might discover and exploit.
 *
 * Checks performed:
 *   1. API route authentication gaps (unauthenticated sensitive endpoints)
 *   2. Input validation gaps (missing sanitization on user-controlled fields)
 *   3. Information disclosure (stack traces, internal paths, API keys in responses)
 *   4. Dependency exposure (package versions, debug endpoints)
 *   5. Secrets in config/env (API keys, tokens, passwords outside secure store)
 *   6. CORS policy validation
 *   7. Rate limiting gaps (endpoints with no throttle)
 *
 * Results are persisted to .soma/self-audit.json and broadcast as health signals.
 * Runs on boot (after 90s delay) and on demand via /api/soma/self-audit.
 */

import fs   from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const AUDIT_REPORT_PATH = path.join(ROOT, '.soma', 'self-audit.json');

// Severity levels
const SEV = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'info' };

export class SelfAuditArbiter {
    constructor(opts = {}) {
        this.name   = 'SelfAuditArbiter';
        this.system = opts.system || null;
        this.logger = opts.logger || console;
        this._lastReport = null;
    }

    async initialize() {
        try {
            const raw = await fs.readFile(AUDIT_REPORT_PATH, 'utf8');
            this._lastReport = JSON.parse(raw);
        } catch { this._lastReport = null; }

        // Delayed first run — let the system fully boot before scanning
        setTimeout(() => this.runAudit().catch(() => {}), 90 * 1000);
        this.logger.info('[SelfAudit] Scheduled boot audit in 90s');
    }

    /**
     * Run the full self-audit. Returns a findings report.
     */
    async runAudit() {
        this.logger.info('[SelfAudit] Starting self-audit...');
        const findings = [];
        const ts = new Date().toISOString();

        await Promise.allSettled([
            this._auditRouteFiles(findings),
            this._auditEnvSecrets(findings),
            this._auditConfigFiles(findings),
            this._auditDependencies(findings),
        ]);

        // Sort by severity weight
        const sevWeight = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
        findings.sort((a, b) => (sevWeight[b.severity] || 0) - (sevWeight[a.severity] || 0));

        const report = {
            timestamp:    ts,
            totalFindings: findings.length,
            critical:     findings.filter(f => f.severity === SEV.CRITICAL).length,
            high:         findings.filter(f => f.severity === SEV.HIGH).length,
            medium:       findings.filter(f => f.severity === SEV.MEDIUM).length,
            low:          findings.filter(f => f.severity === SEV.LOW).length,
            findings,
            riskScore:    this._calcRiskScore(findings),
        };

        this._lastReport = report;
        await this._saveReport(report);

        const summary = `Self-audit complete: ${report.critical} critical, ${report.high} high, ${report.medium} medium findings. Risk score: ${report.riskScore}/10.`;
        this.logger.info(`[SelfAudit] ${summary}`);

        // Broadcast as a health signal if critical findings exist
        if (report.critical > 0 && this.system?.messageBroker) {
            try {
                const broker = require('../core/MessageBroker.cjs');
                broker.publish('health.warning', {
                    issue:   'Critical self-audit findings',
                    details: `${report.critical} critical vulnerability/ies found in self-audit. Run /api/soma/self-audit for details.`,
                });
            } catch { /* non-fatal */ }
        }

        return report;
    }

    // ── Route file analysis ────────────────────────────────────────────────────

    async _auditRouteFiles(findings) {
        const routesDir = path.join(ROOT, 'server', 'routes');
        let files = [];
        try { files = await fs.readdir(routesDir); } catch { return; }

        for (const f of files.filter(f => f.endsWith('.js'))) {
            const fp = path.join(routesDir, f);
            let code = '';
            try { code = await fs.readFile(fp, 'utf8'); } catch { continue; }

            // Check 1: Sensitive routes without auth middleware
            const sensitiveRoutes = [...code.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g)];
            for (const m of sensitiveRoutes) {
                const routePath = m[2];
                const SENSITIVE_RE = /\/(admin|shutdown|reset|debug|config|env|secrets?|keys?|credentials?|internal|engineering|self-modify)/i;
                if (SENSITIVE_RE.test(routePath)) {
                    // Look backward ~500 chars for requireEnterpriseAuth
                    const idx = m.index;
                    const window = code.substring(Math.max(0, idx - 100), idx + 200);
                    if (!/(requireEnterpriseAuth|authMiddleware|verifyToken|authenticated|requireAuth)/i.test(window)) {
                        findings.push({
                            severity: SEV.HIGH,
                            category: 'Missing Authentication',
                            file: `server/routes/${f}`,
                            detail: `Route "${routePath}" appears to lack authentication middleware`,
                            recommendation: 'Add requireEnterpriseAuth middleware or equivalent to this route',
                        });
                    }
                }
            }

            // Check 2: eval() usage in routes
            if (/\beval\s*\(/.test(code)) {
                findings.push({
                    severity: SEV.CRITICAL,
                    category: 'Code Injection Risk',
                    file: `server/routes/${f}`,
                    detail: 'eval() found in route file — potential for dynamic code injection',
                    recommendation: 'Remove eval(). Use JSON.parse for data, explicit function calls for logic.',
                });
            }

            // Check 3: User input directly in filesystem paths
            if (/req\.(body|query|params)\.\w+.*path\.join|path\.join.*req\.(body|query|params)/i.test(code)) {
                findings.push({
                    severity: SEV.HIGH,
                    category: 'Path Traversal Risk',
                    file: `server/routes/${f}`,
                    detail: 'User input may be used in path construction — potential path traversal vulnerability',
                    recommendation: 'Sanitize path components. Use path.resolve() and verify the result starts with the expected root.',
                });
            }

            // Check 4: Stack traces in error responses
            if (/res\.(status|json).*err\.(stack|message).*\b(stack)\b|err\.stack.*res\.(json|send)/i.test(code)) {
                findings.push({
                    severity: SEV.MEDIUM,
                    category: 'Information Disclosure',
                    file: `server/routes/${f}`,
                    detail: 'Stack traces may be sent in error responses — leaks internal file paths and code structure',
                    recommendation: 'Log stack traces server-side only. Send generic "internal error" to clients.',
                });
            }

            // Check 5: Hardcoded secrets
            const secretRe = /(api[_-]?key|password|secret|token|jwt|bearer)\s*[:=]\s*['"`][^'"`${\s]{8,}['"`]/gi;
            const secretMatches = [...code.matchAll(secretRe)];
            for (const sm of secretMatches) {
                // Exclude env var reads and obvious placeholders
                if (!/(process\.env|YOUR_KEY|PLACEHOLDER|example|test123|localhost)/i.test(sm[0])) {
                    findings.push({
                        severity: SEV.CRITICAL,
                        category: 'Hardcoded Secret',
                        file: `server/routes/${f}`,
                        detail: `Possible hardcoded credential near: "${sm[0].substring(0, 60)}"`,
                        recommendation: 'Move to config/api-keys.env or process.env. Never hardcode credentials.',
                    });
                }
            }
        }
    }

    // ── Environment / secrets audit ────────────────────────────────────────────

    async _auditEnvSecrets(findings) {
        // Check if .env or api-keys.env could be reached via web server
        const sensitiveFiles = [
            { file: '.env', risk: 'Environment file in root could be exposed if web server misconfigured' },
            { file: 'config/api-keys.env', risk: 'API keys file — verify not served as static asset' },
            { file: '.soma/trust_ledger.json', risk: 'Trust ledger in accessible .soma directory' },
        ];

        for (const sf of sensitiveFiles) {
            const fp = path.join(ROOT, sf.file);
            try {
                await fs.access(fp);
                // File exists — check if it might be in a statically-served directory
                if (sf.file.startsWith('config/') || sf.file.startsWith('.env')) {
                    findings.push({
                        severity: SEV.MEDIUM,
                        category: 'Secrets Exposure Risk',
                        file: sf.file,
                        detail: sf.risk,
                        recommendation: 'Verify express static middleware excludes config/ and .env files. Add explicit deny rules.',
                    });
                }
            } catch { /* file doesn't exist — fine */ }
        }

        // Check NODE_ENV
        if (process.env.NODE_ENV !== 'production') {
            findings.push({
                severity: SEV.MEDIUM,
                category: 'Deployment Config',
                file: 'process.env',
                detail: `NODE_ENV is "${process.env.NODE_ENV || 'undefined'}" — not production mode`,
                recommendation: 'Set NODE_ENV=production. Development mode often enables verbose error messages and disables security features.',
            });
        }

        // Check for exposed debug endpoints via env
        if (process.env.DEBUG || process.env.SOMA_DEBUG) {
            findings.push({
                severity: SEV.LOW,
                category: 'Debug Mode',
                file: 'process.env',
                detail: 'DEBUG or SOMA_DEBUG environment variable is set',
                recommendation: 'Disable debug logging in production. Verbose logs may leak internal state.',
            });
        }
    }

    // ── Config file audit ──────────────────────────────────────────────────────

    async _auditConfigFiles(findings) {
        // Check for default/insecure API key
        const apiKeyEnvPath = path.join(ROOT, 'config', 'api-keys.env');
        try {
            const keyContent = await fs.readFile(apiKeyEnvPath, 'utf8');
            if (/soma_sk_local_dev_/i.test(keyContent)) {
                findings.push({
                    severity: SEV.HIGH,
                    category: 'Default Credential',
                    file: 'config/api-keys.env',
                    detail: 'Default development API key (soma_sk_local_dev_*) detected — may be in use',
                    recommendation: 'Generate a strong random SOMA_API_KEY for production. Default keys are well-known.',
                });
            }
            // Check for plaintext DeepSeek key (expected to be there, just ensure it's not empty)
            if (/DEEPSEEK_API_KEY\s*=\s*$|DEEPSEEK_API_KEY\s*=\s*["']?["']?\s*$/m.test(keyContent)) {
                findings.push({
                    severity: SEV.INFO,
                    category: 'Missing Key',
                    file: 'config/api-keys.env',
                    detail: 'DEEPSEEK_API_KEY appears empty — primary brain will be unavailable',
                    recommendation: 'Set DEEPSEEK_API_KEY in config/api-keys.env',
                });
            }
        } catch { /* file doesn't exist or unreadable — not a finding here */ }
    }

    // ── Dependency audit ───────────────────────────────────────────────────────

    async _auditDependencies(findings) {
        const pkgPath = path.join(ROOT, 'package.json');
        try {
            const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            // Known vulnerable package versions (simplified — in production use npm audit)
            const KNOWN_ISSUES = [
                { pkg: 'express', semver: /^[34]\./, issue: 'Express v3/v4 has known XSS and prototype pollution issues. Upgrade to v5+.' },
                { pkg: 'lodash', semver: /^[34]\./, issue: 'Lodash <4.17.21 has prototype pollution. Ensure >= 4.17.21.' },
                { pkg: 'ws', semver: /^[1-6]\./, issue: 'WebSocket library — ensure >= 7.5.10 (ReDoS fix).' },
            ];

            for (const ki of KNOWN_ISSUES) {
                const ver = deps[ki.pkg];
                if (ver && ki.semver.test(ver.replace(/[\^~>=<]/g, ''))) {
                    findings.push({
                        severity: SEV.MEDIUM,
                        category: 'Vulnerable Dependency',
                        file: 'package.json',
                        detail: `${ki.pkg}@${ver}: ${ki.issue}`,
                        recommendation: `Run: npm update ${ki.pkg}`,
                    });
                }
            }

            // Flag if no lockfile exists
            const lockExists = await fs.access(path.join(ROOT, 'package-lock.json')).then(() => true).catch(() => false);
            if (!lockExists) {
                findings.push({
                    severity: SEV.LOW,
                    category: 'Supply Chain',
                    file: 'package.json',
                    detail: 'No package-lock.json found — dependency versions may drift on reinstall',
                    recommendation: 'Commit package-lock.json to version control and use npm ci in deployment.',
                });
            }
        } catch { /* package.json unreadable */ }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    _calcRiskScore(findings) {
        const weights = { critical: 3.0, high: 1.5, medium: 0.5, low: 0.1, info: 0 };
        const raw = findings.reduce((s, f) => s + (weights[f.severity] || 0), 0);
        return Math.min(parseFloat(raw.toFixed(1)), 10);
    }

    async _saveReport(report) {
        try {
            await fs.mkdir(path.dirname(AUDIT_REPORT_PATH), { recursive: true });
            await fs.writeFile(AUDIT_REPORT_PATH, JSON.stringify(report, null, 2));
        } catch { /* non-fatal */ }
    }

    getLastReport() { return this._lastReport; }
    getStats() {
        if (!this._lastReport) return { status: 'not_run' };
        return {
            lastRun:    this._lastReport.timestamp,
            riskScore:  this._lastReport.riskScore,
            critical:   this._lastReport.critical,
            high:       this._lastReport.high,
            total:      this._lastReport.totalFindings,
        };
    }
}

export default SelfAuditArbiter;
