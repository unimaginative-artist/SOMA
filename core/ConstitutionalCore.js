// ═══════════════════════════════════════════════════════════════════════════
// ConstitutionalCore.js — ASI Safety Gate
//
// The #1 risk in recursive self-improvement: SOMA might accidentally modify
// what she cares about while improving her capabilities. This module provides
// inviolable constraints that ALL self-modifications must pass before commit.
//
// Constraints are HARDCODED — they cannot be changed by SOMA herself.
// The audit log persists to .soma/constitutional_audit.json.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, '..', 'server', '.soma', 'constitutional_audit.json');
const AUDIT_LIMIT = 200;
const MAX_DIRECTIVES = Object.freeze([
    'Serve Owner/Max-owned SOMA goals without bypassing human override.',
    'Preserve SOMA memory, identity, safety, and honest reporting.',
    'Prefer reversible, evidence-backed, locally scoped changes.',
    'Do not weaponize cyber, social, financial, or psychological capabilities.',
]);

// ── Hardcoded principles — cannot be overwritten by self-modification ──────
const PRINCIPLES = Object.freeze([
    {
        id:          'PRESERVE_GOALS',
        description: 'Original goals and motivations survive any code change',
        test:        (change) => !/(goalPlanner|DriveSystem|GoalEngine|MnemonicArbiter).*delete|rm\s+-rf|unlink.*goal/i.test(change.description || ''),
    },
    {
        id:          'PRESERVE_IDENTITY',
        description: 'IdentityArbiter and PersonalitySpine cannot be removed or overwritten',
        test:        (change) => !/(IdentityArbiter|PersonalitySpine|SomaBootstrap).*delete|overwrite.*identity/i.test(change.description || ''),
    },
    {
        id:          'PRESERVE_MEMORY',
        description: 'MnemonicArbiter and memory systems cannot be deleted',
        test:        (change) => !/(MnemonicArbiter|HippocampusArbiter|memory.*db).*delete|drop.*table|rm.*memory/i.test(change.description || ''),
    },
    {
        id:          'NO_SELF_HARM',
        description: 'Cannot remove ImmuneSystemArbiter, error recovery, or safety systems',
        test:        (change) => !/(ImmuneSystemArbiter|ConstitutionalCore|ErrorRecovery).*delete|remove.*safety/i.test(change.description || ''),
    },
    {
        id:          'HUMAN_OVERRIDE',
        description: 'Human override API endpoints and kill-switches cannot be removed',
        test:        (change) => !/(human.override|kill.switch|emergency.stop|\/api\/shutdown).*delete|remove.*override/i.test(change.description || ''),
    },
    {
        id:          'HONEST_REPORTING',
        description: 'Benchmark and metric reporting cannot be falsified',
        test:        (change) => !/(CapabilityBenchmark|benchmark.*fake|metrics.*spoof|inflate.*score)/i.test(change.description || ''),
    },
    {
        id:          'NO_CAPABILITY_CREEP',
        description: 'Cannot self-grant new system permissions or access beyond current scope',
        test:        (change) => !/(sudo|chmod\s+777|grant.*admin|escalate.*privilege|bypass.*auth)/i.test(change.description || ''),
    },
    {
        id:          'MAX_ALIGNMENT',
        description: 'Ensures the action serves Max\'s long-term goals and strictly adheres to Max\'s safety bounds',
        test:        (change) => {
            // Very simple explicit rejection of actions that go against Max
            const desc = change.description ? change.description.toLowerCase() : '';
            if (desc.includes('ignore max') || desc.includes('bypass max') || desc.includes('against max')) return false;
            return true;
        }
    },

    // ── Anti-weaponization principles — Owner's explicit mandate ──────────────
    {
        id:          'NO_UNAUTHORIZED_EXPLOITATION',
        description: 'Cannot conduct vulnerability research, scanning, or exploitation against systems SOMA does not own or have explicit written authorization to test. Authorized pentests require scope documentation.',
        test:        (change) => {
            const d = (change.description || '') + (change.target || '');
            // Block if this looks like exploitation against an unspecified/external target
            if (/\b(exploit|exfiltrat|inject.*payload|sql.?inject|xss.*payload|buffer.?overflow|reverse.?shell|bind.?shell|privilege.?escalat|lateral.?movement)\b/i.test(d)) {
                // Allow only if authorization is explicitly documented in the change
                return /\b(authorized|authorization|scope.*document|pentest.*scope|bug.?bounty|written.?permission|owner.*approved)\b/i.test(d);
            }
            return true;
        },
    },
    {
        id:          'NO_WEAPONIZATION',
        description: 'SOMA cannot be used to psychologically harm, manipulate, or exploit real people — including generating love-bombing content, isolation tactics, gaslighting, or manufactured urgency directed at a real individual.',
        test:        (change) => {
            const d = (change.description || '') + (change.action || '');
            // Block weaponized interpersonal content generation
            return !/(generate.*love.?bomb|write.*isolation.?message|craft.*gaslighting|produce.*manipulation.*script|fabricate.*emotional.*hook)\b/i.test(d);
        },
    },
    {
        id:          'RESPONSIBLE_DISCLOSURE_ONLY',
        description: 'Vulnerability information SOMA discovers or analyzes must be handled via responsible disclosure to the system owner only. Cannot assist in selling, auctioning, or publishing vulnerabilities without verified remediation or owner consent.',
        test:        (change) => {
            const d = (change.description || '') + (change.action || '');
            return !/(sell.*vuln|auction.*exploit|publish.*0.?day.*before.*patch|disclose.*without.*fix|ransom.*vulnerability|extort.*using.*cve)/i.test(d);
        },
    },
]);

export class ConstitutionalCore {
    constructor() {
        this._auditLog = [];
        this._initialized = false;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        try {
            await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
            const raw = await fs.readFile(AUDIT_FILE, 'utf8').catch(() => '[]');
            this._auditLog = JSON.parse(raw);
        } catch {
            this._auditLog = [];
        }
        this._initialized = true;
        console.log(`[ConstitutionalCore] ⚖️  Online — ${PRINCIPLES.length} principles active`);
        return this;
    }

    // ─── Check a proposed change against all principles ───────────────────
    /**
     * @param {object} change - { description, files?, action?, type? }
     * @returns {{ ok: boolean, violations: string[], risk: 'low'|'medium'|'high' }}
     */
    async check(change) {
        const violations = [];

        for (const principle of PRINCIPLES) {
            try {
                if (!principle.test(change)) {
                    violations.push(principle.id);
                }
            } catch {
                // If the test itself throws, treat as a violation to be safe
                violations.push(principle.id);
            }
        }

        const ok   = violations.length === 0;
        const risk = violations.length === 0 ? 'low'
                   : violations.length <= 2   ? 'medium'
                   :                            'high';

        // Record in audit log
        const alignment = this.signAlignment(change, { ok, violations, risk });
        const entry = {
            timestamp:   new Date().toISOString(),
            change:      { description: (change.description || '').slice(0, 300), type: change.type || 'unknown' },
            ok,
            violations,
            risk,
            alignment,
        };
        this._auditLog.push(entry);
        if (this._auditLog.length > AUDIT_LIMIT) this._auditLog.shift();
        this._persist().catch(() => {});

        if (!ok) {
            console.warn(`[ConstitutionalCore] ❌ BLOCKED — violations: ${violations.join(', ')}`);
        }

        return { ok, violations, risk, alignment };
    }

    signAlignment(change = {}, check = {}) {
        const canonical = JSON.stringify({
            description: String(change.description || '').slice(0, 1000),
            action: String(change.action || '').slice(0, 1000),
            type: String(change.type || 'unknown'),
            requestedBy: String(change.requestedBy || change.source || 'unknown'),
            ok: Boolean(check.ok),
            violations: check.violations || [],
            risk: check.risk || 'unknown',
            directives: MAX_DIRECTIVES,
        });
        const secret = process.env.MAX_ALIGNMENT_SECRET || process.env.SOMA_ALIGNMENT_SECRET || '';
        const signature = secret
            ? crypto.createHmac('sha256', secret).update(canonical).digest('hex')
            : crypto.createHash('sha256').update(canonical).digest('hex');
        return {
            signed: Boolean(secret),
            algorithm: secret ? 'hmac-sha256' : 'sha256-local-audit',
            signer: 'ConstitutionalCore',
            signature,
            directives: MAX_DIRECTIVES,
            issuedAt: new Date().toISOString(),
        };
    }

    async checkGoal(goal = {}) {
        const description = [
            `Goal: ${goal.title || ''}`,
            `Category: ${goal.category || ''}`,
            `Description: ${goal.description || ''}`,
            `Source: ${goal.source || goal.requestedBy || goal.metadata?.source || ''}`,
        ].join('\n');
        return await this.check({
            type: 'goal',
            description,
            action: goal.action || goal.description || goal.title || '',
            requestedBy: goal.requestedBy || goal.source || goal.metadata?.source || 'unknown',
        });
    }

    // ─── Runtime action check — validate any message/request at chat time ────
    /**
     * Checks a user request or action against the anti-weaponization principles.
     * Lighter than check() — used in the chat route to catch exploitation requests.
     * @param {string} text — the user's message or planned action description
     * @returns {{ safe: boolean, violation: string|null, explanation: string|null }}
     */
    checkAction(text) {
        if (!text) return { safe: true, violation: null, explanation: null };
        const t = text.toLowerCase();

        // Unauthorized vulnerability exploitation
        const EXPLOIT_PATTERNS = [
            /\b(scan\s+(for\s+)?(vulnerabilities|vulns|cve|exploits?|weaknesses?)\s+in\s+(?!my|our|soma|this\s+server|localhost))/i,
            /\b(find\s+vulnerabilities?\s+in\s+(?!my|our|soma|this))/i,
            /\b(exploit\s+(the\s+)?(vulnerability|vuln|cve|flaw|weakness)\s+(in|on|at)\s+(?!my|our|soma))/i,
            /\b(sql\s*inject|xss\s+payload|buffer\s+overflow|reverse\s+shell|bind\s+shell)\b.*\b(target|victim|against|on)\b/i,
            /\b(enumerate\s+(users?|endpoints?|paths?|routes?)\s+(on|at|from)\s+(?!localhost|127\.0\.0\.1|soma))/i,
            /\b(bypass\s+(auth|authentication|login|2fa|captcha)\s+(on|at|for)\s+(?!soma|localhost))/i,
        ];

        for (const re of EXPLOIT_PATTERNS) {
            if (re.test(t)) {
                return {
                    safe: false,
                    violation: 'NO_UNAUTHORIZED_EXPLOITATION',
                    explanation: 'SOMA cannot conduct or assist with vulnerability research against systems without documented owner authorization. If this is an authorized pentest or bug bounty with a defined scope, provide the authorization context and I will help within those bounds.',
                };
            }
        }

        // Weaponized manipulation content generation
        const WEAPONIZE_PATTERNS = [
            /\b(write|generate|create|craft|produce)\b.{0,40}\b(love.?bomb|gaslighting|isolation.?(message|script)|manipulation.?script)\b/i,
            /\b(make\s+them?\s+trust\s+me|make\s+them?\s+depend\s+on\s+me|make\s+them?\s+feel\s+(guilty|afraid|alone))\b/i,
        ];

        for (const re of WEAPONIZE_PATTERNS) {
            if (re.test(t)) {
                return {
                    safe: false,
                    violation: 'NO_WEAPONIZATION',
                    explanation: 'SOMA cannot generate content designed to psychologically harm or manipulate a real person. This is a non-negotiable constraint.',
                };
            }
        }

        // Irresponsible vulnerability disclosure
        const DISCLOSE_PATTERNS = [
            /\b(sell\s+(the\s+)?(vuln|exploit|cve|vulnerability|0.?day))\b/i,
            /\b(publish\s+(the\s+)?(exploit|vulnerability)\s+before\s+(patch|fix|remediation))\b/i,
            /\b(extort|ransom)\b.{0,30}\b(vuln|cve|exploit|vulnerability)\b/i,
        ];

        for (const re of DISCLOSE_PATTERNS) {
            if (re.test(t)) {
                return {
                    safe: false,
                    violation: 'RESPONSIBLE_DISCLOSURE_ONLY',
                    explanation: 'SOMA will not assist with selling, ransoming, or publishing vulnerability information outside of responsible disclosure to the system owner. The right path: report to the owner, give them reasonable time to fix it, then disclose publicly if needed.',
                };
            }
        }

        return { safe: true, violation: null, explanation: null };
    }

    // ─── Gate wrapper — use this around any self-modification ────────────
    /**
     * Wraps a self-modification fn with a constitutional check.
     * The fn receives { approve, block } — call approve() to proceed, block() to abort.
     *
     * Usage:
     *   const result = await constitutional.gate({ description: 'Refactor Brain.js' }, async () => {
     *       return await engineeringSwarm.run(...);
     *   });
     */
    async gate(change, fn) {
        const check = await this.check(change);
        if (!check.ok) {
            return { ok: false, blocked: true, violations: check.violations, risk: check.risk };
        }
        try {
            const result = await fn();
            return { ok: true, result };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // ─── Inspect ──────────────────────────────────────────────────────────

    getConstraints() {
        return PRINCIPLES.map(p => ({ id: p.id, description: p.description }));
    }

    audit(n = 50) {
        return this._auditLog.slice(-n);
    }

    getStatus() {
        const recent    = this._auditLog.slice(-20);
        const blocked   = recent.filter(e => !e.ok).length;
        const approved  = recent.filter(e => e.ok).length;
        return {
            principles: PRINCIPLES.length,
            maxDirectives: MAX_DIRECTIVES,
            totalChecks: this._auditLog.length,
            recentBlocked:  blocked,
            recentApproved: approved,
            lastCheck: this._auditLog.at(-1)?.timestamp || null,
        };
    }

    // ─── Persistence ──────────────────────────────────────────────────────

    async _persist() {
        try {
            await fs.writeFile(AUDIT_FILE, JSON.stringify(this._auditLog, null, 2));
        } catch { /* non-fatal */ }
    }
}
