/**
 * StructuredArchitectureAudit.js
 * 
 * Generates grounded, structured architectural audit reports for MAX and SOMA.
 * Adheres strictly to the 12-pillar audit contract:
 * - Finding ID
 * - Severity (HIGH, MEDIUM, LOW)
 * - File Path & Line Numbers
 * - Observed Fact (grounded in verified source code)
 * - Evidence (verbatim source match)
 * - Impact (operational consequence)
 * - Recommendation (prescriptive architectural fix)
 * - Research Needed (follow-up verification required)
 * - Safe Test (non-destructive empirical check)
 * - Modification Required (scope of proposed change)
 * 
 * Explicitly separates:
 * 1. Grounded Observations
 * 2. Interpretations / Hypotheses
 * 3. Recommendations / Next Steps
 */

import fs from 'fs/promises';
import path from 'path';

export async function generateArchitectureReport({ root, project = 'MAX', query = '' }) {
    const realRoot = await fs.realpath(root);
    const findings = [];

    if (project.toUpperCase() === 'MAX') {
        // Finding 1: Check SelfImprovementLoop.js for mock/stub evolve method
        const loopPath = path.join(realRoot, 'core', 'SelfImprovementLoop.js');
        try {
            const content = await fs.readFile(loopPath, 'utf8');
            const lines = content.split(/\r?\n/);
            let evolveLine = -1;
            let logLine = -1;
            for (let i = 0; i < lines.length; i++) {
                if (/async evolve\s*\(/.test(lines[i])) evolveLine = i + 1;
                if (/console\.log\(`\[SelfImprovement\] 🔧 Would evolve:/.test(lines[i])) logLine = i + 1;
            }

            if (evolveLine !== -1 && logLine !== -1) {
                findings.push({
                    id: 'FINDING-MAX-ARCH-01',
                    severity: 'HIGH',
                    filePath: 'core/SelfImprovementLoop.js',
                    lineNumbers: `${evolveLine}-${logLine + 5}`,
                    observedFact: 'The evolve() method in SelfImprovementLoop does not execute code modifications; it only logs a "Would evolve" string and simulates tension reduction.',
                    evidence: lines[logLine - 1].trim(),
                    impact: 'Autonomous self-improvement loops in MAX cannot apply live code improvements, giving a false appearance of evolution without real modification.',
                    recommendation: 'Deprecate the stubbed SelfImprovementLoop or route evolution proposals to a governed pipeline like SelfModificationGovernance.',
                    researchNeeded: 'Verify whether SelfImprovementEngine or SelfEditor contains an alternative active execution path.',
                    safeTest: 'Invoke SelfImprovementLoop.run() in a sandbox and assert that no filesystem changes or git commits occur.',
                    modificationRequired: 'Replace simulation log with sandboxed candidate evaluation harness or remove autonomous execution claim.'
                });
            }
        } catch {}

        // Finding 2: Check SomaBridge.js LAN / auto-start polling
        const bridgePath = path.join(realRoot, 'core', 'SomaBridge.js');
        try {
            const content = await fs.readFile(bridgePath, 'utf8');
            const lines = content.split(/\r?\n/);
            let pollLine = -1;
            for (let i = 0; i < lines.length; i++) {
                if (/this\._checkEvery\s*=\s*60_000/.test(lines[i])) {
                    pollLine = i + 1;
                    break;
                }
            }
            if (pollLine !== -1) {
                findings.push({
                    id: 'FINDING-MAX-ARCH-02',
                    severity: 'MEDIUM',
                    filePath: 'core/SomaBridge.js',
                    lineNumbers: `${pollLine}-${pollLine + 5}`,
                    observedFact: 'SomaBridge polls localhost SOMA health with a 60-second fixed backoff interval when disconnected.',
                    evidence: lines[pollLine - 1].trim(),
                    impact: 'When SOMA restarts or recovers, MAX remains in degraded local-brain fallback for up to 60 seconds before re-establishing QuadBrain.',
                    recommendation: 'Implement exponential backoff with immediate event-driven reconnect on Marionette readiness signals.',
                    researchNeeded: 'Check if Marionette daemon can emit an IPC wake event to MAX on SOMA boot.',
                    safeTest: 'Kill and restart SOMA while observing the latency before MAX logs "SOMA online".',
                    modificationRequired: 'Add reactive IPC/WebSocket ping probe alongside the 60s fallback timer.'
                });
            }
        } catch {}
    } else if (project.toUpperCase() === 'SOMA') {
        // Report observed source-level candidates, not invented architectural
        // weaknesses or hard-coded line numbers from an older revision.
        const relative = 'arbiters/DiscordArbiter.js';
        try {
            const target = await fs.realpath(path.join(realRoot, relative));
            const resolved = path.relative(realRoot, target);
            if (resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('Source escapes inspection root');
            const lines = (await fs.readFile(target, 'utf8')).split(/\r?\n/);
            const index = lines.findIndex(line => line.includes('this.pendingImagePromptChannels = new Map()'));
            if (index >= 0) findings.push({
                id: 'FINDING-SOMA-ARCH-01', severity: 'LOW', filePath: relative,
                lineNumbers: String(index + 1),
                observedFact: 'A pending Discord image request is held in an in-memory Map.',
                evidence: lines[index].trim(),
                impact: 'A pending five-minute image prompt may be forgotten after a process restart; this is a continuity risk, not evidence of lost completed images.',
                recommendation: 'Persist short-lived prompt intent or make the follow-up image classifier independent of this Map.',
                researchNeeded: 'Trace other image-intent persistence paths before deciding whether this is a user-visible defect.',
                safeTest: 'Ask for an image, restart the bot, then send a short subject prompt and inspect the reply without generating media.',
                modificationRequired: 'Only if the restart test reproduces the continuity gap.'
            });
        } catch {}
    }

    // Format Markdown Report separating Observations, Interpretations, Recommendations
    const sections = [];

    sections.push(`### 🏛️ Architecture & Weakness Analysis: ${project}`);
    sections.push(`*Inspection root*: \`${realRoot}\` | *Findings identified*: ${findings.length}\n`);

    sections.push('#### 1. Grounded Observations (Code Facts)');
    if (findings.length === 0) {
        sections.push('- No candidate finding in this bounded entry-point scan. This is not a clean bill of health for the repository.');
    } else {
        for (const f of findings) {
            sections.push(`##### [${f.id}] ${f.observedFact} (${f.severity} Severity)
- **File & Lines**: \`${f.filePath}:${f.lineNumbers}\`
- **Code Evidence**: \`${f.evidence}\`
- **Observed Fact**: ${f.observedFact}
- **Impact**: ${f.impact}
- **Safe Test**: ${f.safeTest}
- **Modification Required**: ${f.modificationRequired}`);
        }
    }

    sections.push('\n#### 2. Interpretations & Hypotheses');
    if (project.toUpperCase() === 'MAX' && findings.some(f => f.id === 'FINDING-MAX-ARCH-01'))
        sections.push('- **Hypothesis**: The placeholder evolution path may have been retained deliberately as a safe dry-run. The source line alone cannot establish intent or active runtime use.');
    else if (project.toUpperCase() === 'SOMA' && findings.length)
        sections.push('- **Hypothesis**: Restarting during the brief image-prompt window may lose that conversational context. Verify with a restart test before treating it as a confirmed incident.');
    else sections.push('- No supported architectural hypothesis from this bounded scan.');

    sections.push('\n#### 3. Prescriptive Recommendations & Safe Next Steps');
    if (findings.length > 0) {
        for (const f of findings) {
            sections.push(`- **${f.id} Action**: ${f.recommendation} *(Research needed: ${f.researchNeeded})*`);
        }
    } else {
        sections.push('- Maintain continuous automated invariant testing on cross-agent IPC bridges.');
    }
    sections.push('- **Safety Gate**: Any candidate modifications must be verified through the 12-stage self-improvement pipeline inside an isolated sandbox prior to production deployment.');

    return {
        project,
        findings,
        reportText: sections.join('\n')
    };
}
