/**
 * ConcieveExpertiseArbiter.js
 *
 * SOMA 'CONCIEVE' Pack — Professional Financial Audit & Tax.
 * Physically imports the industrial logic from Concieve/datasnipper-app.
 *
 * v1.4.0:
 * - INGESTION uses direct file discovery (no organizer DB) to avoid async-init race
 * - enableAI: false so SOMA uses ODIN, not Concieve's tinyllama ollamaService
 * - const-in-switch SyntaxError fixed (case bodies wrapped in {})
 * - Sovereign hybrid gate (__SOMA_FINANCE_ANALYSIS) keeps audit work local
 * - SOMA memory injection after REPORTING phase
 * - .unref() on pulse timer
 */

import { ExpertiseBase } from '../core/ExpertiseBase.js';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs/promises';

const require = createRequire(import.meta.url);

let AuditOrchestrator, AuditConfig;
try {
    ({ AuditOrchestrator, AuditConfig } = require('../Concieve/datasnipper-app/server/services/auditSystem.js'));
} catch (e) {
    console.warn('💼 [CONCIEVE] auditSystem.js not loadable:', e.message);
}

export class ConcieveExpertiseArbiter extends ExpertiseBase {
    constructor(config = {}) {
        super({
            ...config,
            name: 'ConcieveExpertise',
            category: 'Financial_Audit',
            version: '1.4.0'
        });

        this._auditPulseInterval = null;

        if (!AuditOrchestrator) {
            console.warn('💼 [CONCIEVE] AuditOrchestrator unavailable — audit phases will be no-ops.');
            this._engineReady = false;
            return;
        }

        try {
            this.orchestrator = new AuditOrchestrator(new AuditConfig({
                dbPath:      path.resolve('concieve_audit.db'),
                outputPath:  path.resolve('soma_audit_reports'),
                storageRoot: path.resolve('concieve_storage'),
                enableAI:    false, // SOMA uses ODIN, not Concieve's tinyllama ollamaService
            }));
            this._engineReady = true;
            this._startAuditPulse();
        } catch (e) {
            console.warn('💼 [CONCIEVE] AuditOrchestrator init failed:', e.message);
            this._engineReady = false;
        }
    }

    /** Lazy-load ODIN — QuadBrain may not be ready at construction time. */
    _getOdin() {
        if (!this.odin) {
            this.odin = this.system?.quadBrain?.odin ?? null;
        }
        return this.odin;
    }

    /**
     * Weekly audit pulse — fires every Sunday at midnight.
     * Scans CONCIEVE_SHARED_PATH (or ./shared_office_data).
     */
    _startAuditPulse() {
        const checkAudit = async () => {
            const now = new Date();
            if (now.getDay() === 0 && now.getHours() === 0) {
                console.log('💼 [CONCIEVE] Weekly Audit Pulse fired.');
                const sharedPath = process.env.CONCIEVE_SHARED_PATH || './shared_office_data';
                try { await this.runMission(sharedPath); } catch (e) { /* logged by base */ }
            }
        };
        this._auditPulseInterval = setInterval(checkAudit, 3_600_000);
        this._auditPulseInterval.unref();
        console.log('💼 [CONCIEVE] Audit Pulse active (weekly / Sun 00:00).');
    }

    async getPhases() {
        return ['INGESTION', 'PARSING', 'ANALYSIS', 'ANOMALY_DETECTION', 'RISK_AUDIT', 'REPORTING'];
    }

    async onExecutePhase(phase, target) {
        if (!this._engineReady) {
            console.warn(`💼 [CONCIEVE] Engine not ready — skipping phase ${phase}.`);
            return { skipped: true, reason: 'engine_unavailable' };
        }

        const odin = this._getOdin();

        switch (phase) {

            case 'INGESTION': {
                console.log(`💼 [CONCIEVE] [1/6] INGESTION  target=${target}`);
                
                // 👁️ UPGRADE: Use Provenance Appendage for Ocular Ingestion
                const provenance = this.system?.provenanceLimb;
                if (provenance) {
                    try {
                        const ocrResult = await provenance.processOcular(target);
                        console.log(`👁️ [CONCIEVE] Provenance Ocular Result: ${ocrResult.provenance_marker}`);
                        // If Provenance returned a list of files/data, we adapt. 
                        // For now, we continue with existing logic if it was a directory.
                    } catch (e) {
                        console.warn(`⚠️ [CONCIEVE] Provenance Limb failed, falling back to standard ingestion: ${e.message}`);
                    }
                }

                // Direct file discovery — skip the organizer's DB-backed ingestFile to
                // avoid racing the async SQLite table creation on first boot.
                const supported = ['.csv', '.xlsx', '.xls', '.pdf'];
                try {
                    const stat = await fs.stat(target);
                    if (stat.isDirectory()) {
                        const entries = await fs.readdir(target);
                        const files = entries
                            .filter(f => supported.includes(path.extname(f).toLowerCase()))
                            .map(f => path.resolve(target, f));
                        console.log(`💼 [CONCIEVE] Found ${files.length} supported file(s).`);
                        return { files, count: files.length };
                    } else {
                        const ext = path.extname(target).toLowerCase();
                        if (!supported.includes(ext)) {
                            return { files: [], count: 0, error: `Unsupported file type: ${ext}` };
                        }
                        return { files: [path.resolve(target)], count: 1 };
                    }
                } catch (e) {
                    console.error('💼 [CONCIEVE] Ingestion error:', e.message);
                    return { files: [], count: 0, error: e.message };
                }
            }

            case 'PARSING': {
                console.log(`💼 [CONCIEVE] [2/6] PARSING`);
                const ingested = this._phaseResults['INGESTION'];
                if (!ingested?.files?.length) {
                    return { parsed: [], fileCount: 0, skipped: true };
                }
                const parsed = [];
                for (const filePath of ingested.files) {
                    try {
                        const result = await this.orchestrator.parser.parseDocument(filePath);
                        parsed.push(result);
                    } catch (e) {
                        console.warn(`💼 [CONCIEVE] Parse error (${path.basename(filePath)}):`, e.message);
                    }
                }
                return { parsed, fileCount: parsed.length };
            }

            case 'ANALYSIS': {
                console.log(`💼 [CONCIEVE] [3/6] ANALYSIS`);
                const parseData = this._phaseResults['PARSING'];
                const transactions = [];
                if (parseData?.parsed) {
                    parseData.parsed.forEach(p => {
                        if (Array.isArray(p?.transactions)) transactions.push(...p.transactions);
                    });
                }
                if (transactions.length === 0) {
                    return { skipped: true, reason: 'no_transactions' };
                }
                global.__SOMA_FINANCE_ANALYSIS = true;
                try {
                    return await this.orchestrator.analyzer.analyzeTransactions(transactions);
                } finally {
                    global.__SOMA_FINANCE_ANALYSIS = false;
                }
            }

            case 'ANOMALY_DETECTION': {
                console.log(`💼 [CONCIEVE] [4/6] ANOMALY_DETECTION`);
                const analysis = this._phaseResults['ANALYSIS'];
                if (!analysis || analysis.skipped) {
                    return { skipped: true, reason: 'no_analysis_data' };
                }
                if (!odin) {
                    console.warn('💼 [CONCIEVE] ODIN offline — using raw analyzer anomalies.');
                    return { anomalies: analysis.anomalies || [], source: 'analyzer' };
                }
                global.__SOMA_FINANCE_ANALYSIS = true;
                try {
                    const driftPrompt = [
                        `You are a senior forensic accountant.`,
                        `Analyse the following transaction statistics for financial drift, anomalous patterns, or evidence of fraud.`,
                        `Return a concise bullet-point summary of findings and a risk verdict (LOW / MEDIUM / HIGH / CRITICAL).`,
                        `DATA: ${JSON.stringify(analysis.statistics ?? analysis)}`,
                        `IMPORTANT: NEVER use em-dashes (—).`
                    ].join('\n');
                    const result = await odin.reasonRecurrent(driftPrompt, 'logos', 'high');
                    return {
                        narrative: result.content || result.response,
                        anomalies: analysis.anomalies || [],
                        source: 'odin'
                    };
                } finally {
                    global.__SOMA_FINANCE_ANALYSIS = false;
                }
            }

            case 'RISK_AUDIT': {
                console.log(`💼 [CONCIEVE] [5/6] RISK_AUDIT`);
                const anomalyData = this._phaseResults['ANOMALY_DETECTION'];
                const riskScore   = this._phaseResults['ANALYSIS']?.risk_score ?? 0;
                const narrative   = anomalyData?.narrative ?? '';
                const isCritical  = riskScore > 70 || narrative.toUpperCase().includes('CRITICAL');
                if (isCritical) {
                    console.warn(`🛑 [CONCIEVE] HIGH RISK. Score=${riskScore}`);
                    return { verdict: 'CRITICAL', riskScore, message: 'Immediate review required.' };
                }
                const isElevated = riskScore > 40 || narrative.toUpperCase().includes('HIGH');
                return {
                    verdict: isElevated ? 'ELEVATED' : 'CLEAR',
                    riskScore,
                    message: isElevated ? 'Elevated risk — recommend manual review.' : 'Integrity verified.'
                };
            }

            case 'REPORTING': {
                console.log(`💼 [CONCIEVE] [6/6] REPORTING`);
                const reportName   = `audit_${Date.now()}.xlsx`;
                const reportsDir   = path.resolve('soma_audit_reports');
                const outputPath   = path.join(reportsDir, reportName);
                const analysisData = this._phaseResults['ANALYSIS'];

                try {
                    await fs.mkdir(reportsDir, { recursive: true });
                    await this.orchestrator.exportToExcel({
                        report:   { summary: analysisData?.statistics },
                        analysis: analysisData
                    }, outputPath);
                } catch (exportErr) {
                    console.warn('💼 [CONCIEVE] Excel export failed (non-fatal):', exportErr.message);
                }

                const summary = {
                    status:       'complete',
                    reportPath:   outputPath,
                    riskVerdict:  this._phaseResults['RISK_AUDIT']?.verdict ?? 'UNKNOWN',
                    riskScore:    this._phaseResults['RISK_AUDIT']?.riskScore ?? 0,
                    transactions: analysisData?.statistics?.total_transactions ?? 0,
                    duplicates:   analysisData?.duplicates?.length ?? 0,
                    outliers:     analysisData?.outliers?.length ?? 0,
                };

                // Store findings in SOMA memory
                const mnemonic = this.system?.mnemonicArbiter;
                if (mnemonic?.remember) {
                    const narrative = this._phaseResults['ANOMALY_DETECTION']?.narrative;
                    const memText = [
                        `[CONCIEVE Audit] ${new Date().toISOString()}`,
                        `Verdict: ${summary.riskVerdict}  Score: ${summary.riskScore}`,
                        `Transactions: ${summary.transactions}  Duplicates: ${summary.duplicates}  Outliers: ${summary.outliers}`,
                        narrative ? `Findings: ${narrative.substring(0, 400)}` : ''
                    ].filter(Boolean).join('\n');
                    mnemonic.remember(memText, { type: 'audit_result', importance: 0.8 })
                        .catch(() => {});
                }

                return summary;
            }

            default:
                return super.onExecutePhase(phase, target);
        }
    }
}

export default ConcieveExpertiseArbiter;
