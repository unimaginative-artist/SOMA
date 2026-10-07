/**
 * ForensicVerdictArbiter.js
 * 
 * The specialized 'High-Stakes' investigative nerve for SOMA.
 * Orchestrates cross-document verification (TIE), Excel heatmaps, and statistical fraud detection.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import messageBroker from '../core/MessageBroker.cjs';

export class ForensicVerdictArbiter extends EventEmitter {
    constructor(system) {
        super();
        this.system = system;
        this.name = 'ForensicVerdict';
        this.pythonPath = path.join(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
        this.isBusy = false;
    }

    /**
     * TIE: Cross-reference a PDF (Bank Statement or Invoice) against an Excel GL.
     */
    async performTie(pdfPath, excelPath) {
        console.log(`🔗 [Forensic] Initiating TIE: ${path.basename(pdfPath)} ↔ ${path.basename(excelPath)}`);

        // 1. Structured Invoice Extraction (Deepened Logic)
        let invoiceData = null;
        try {
            invoiceData = await this.performInvoiceExtraction(pdfPath);
            console.log(`📄 [Forensic] Extracted structured invoice data. Confidence: ${invoiceData.confidence * 100}%`);
        } catch (e) {
            console.warn(`⚠️ [Forensic] Structured extraction failed, falling back to raw OCR: ${e.message}`);
        }

        // 2. Extract numerical figures from OCR'd tables/text for matching
        const oculus = this.system.oculus;
        if (!oculus) throw new Error("Ocular Vision Limb is offline.");

        let pdfData;
        try {
            pdfData = await oculus.analyzeDocument(pdfPath);
        } catch (e) {
            console.warn(`⚠️ [Forensic] Ocular analysis failed: ${e.message}`);
            pdfData = { success: false, error: e.message };
        }

        const pdfFigures = [];
        // Combine structured figures and raw OCR figures
        if (invoiceData && invoiceData.success) {
            if (invoiceData.total_amount) pdfFigures.push(invoiceData.total_amount.toString());
            if (invoiceData.all_figures) invoiceData.all_figures.forEach(f => pdfFigures.push(f.toString()));
        }

        if (pdfData.success && pdfData.ocular.pages) {
            pdfData.ocular.pages.forEach(p => {
                const moneyMatches = p.text.match(/\d{1,3}(,\d{3})*(\.\d{2})/g);
                if (moneyMatches) {
                    moneyMatches.forEach(m => pdfFigures.push(m.replace(/,/g, '')));
                }
            });
        }

        // 3. Perform Structural Audit on Excel
        const heatmap = await this.performHeatmap(excelPath);

        // 4. Physically TIE the PDF figures to the Excel data
        const tieMatching = await this._callLimb('tie_matcher', { excel_path: excelPath, pdf_values: [...new Set(pdfFigures)] });

        // 5. Final Synthesis of the TIE Verdict
        const result = {
            success: true,
            timestamp: new Date().toISOString(),
            audit_trail: `TIE performed between ${path.basename(pdfPath)} and ${path.basename(excelPath)}`,
            heatmap: heatmap,
            matching: tieMatching,
            invoice_data: invoiceData,
            pdf_metadata: pdfData.success ? {
                hash: pdfData.ocular.hash,
                tables_found: pdfData.ocular.total_tables,
                figures_extracted: pdfFigures.length
            } : { error: "PDF structural extraction failed" },
            verdict: (tieMatching.tie_fidelity > 0.8 && heatmap.total_findings === 0) ? "AUDIT READY" : "INVESTIGATION RECOMMENDED",
            risk_score: (1 - tieMatching.tie_fidelity) * 0.7 + (heatmap.overall_risk_score * 3)
        };

        this.emit('tie_complete', result);
        return result;
    }

    /**
     * Invoice Extraction: Uses specialized Python processor for structured data.
     */
    async performInvoiceExtraction(pdfPath) {
        console.log(`🔍 [Forensic] Extracting structured data from: ${path.basename(pdfPath)}`);
        return await this._callLimb('invoice_processor', { input: pdfPath });
    }

    /**
     * Heatmap: Audit Excel for hardcoded overrides and formula gaps.
     */
    async performHeatmap(excelPath) {
        console.log(`🔥 [Forensic] Generating Heatmap for: ${path.basename(excelPath)}`);
        return await this._callLimb('heatmap', { input: excelPath });
    }

    /**
     * Benford: Statistical digit analysis for fraud detection.
     */
    async performBenford(excelPath) {
        console.log(`📊 [Forensic] Running Benford's Law analysis: ${path.basename(excelPath)}`);
        return await this._callLimb('benford', { input: excelPath });
    }

    /**
     * Unified Forensic Suite: Run all tests and return a comprehensive report.
     */
    async performForensicSuite(pdfPath, excelPath) {
        this.isBusy = true;
        try {
            const tie = pdfPath ? await this.performTie(pdfPath, excelPath) : null;
            const benford = await this.performBenford(excelPath);
            const heatmap = tie ? tie.heatmap : await this.performHeatmap(excelPath);

            const report = {
                success: true,
                timestamp: new Date().toISOString(),
                target: path.basename(excelPath),
                tie: tie,
                benford: benford,
                heatmap: heatmap,
                overall_verdict: this._synthesizeVerdict(tie, benford, heatmap)
            };

            report.markdown = this._generateMarkdownReport(report);

            // ── Loop Closing: Mnemonic Commit ──
            if (this.system.mnemonicArbiter) {
                await this.system.mnemonicArbiter.remember(
                    `Forensic audit completed for ${report.target}. Verdict: ${report.overall_verdict}`,
                    { 
                        type: 'forensic_report', 
                        importance: report.overall_verdict.includes('CRITICAL') ? 0.9 : 0.6,
                        verdict: report.overall_verdict,
                        target: report.target,
                        timestamp: report.timestamp
                    }
                ).catch(e => console.warn(`⚠️ [Forensic] Mnemonic commit failed: ${e.message}`));
            }

            // ── Loop Closing: Proactive Escalation ──
            if (report.overall_verdict.includes('CRITICAL') || report.overall_verdict.includes('DISCREPANCIES')) {
                messageBroker.publish('forensics.critical_finding', {
                    target: report.target,
                    verdict: report.overall_verdict,
                    risk_score: tie ? tie.risk_score : heatmap.overall_risk_score
                });
            }

            this.isBusy = false;
            return report;
        } catch (e) {
            this.isBusy = false;
            throw e;
        }
    }

    _synthesizeVerdict(tie, benford, heatmap) {
        let scores = [];
        if (tie) scores.push(tie.verdict === "AUDIT READY" ? 1 : 0);

        // Benford fidelity
        if (benford.success) {
            const avgFidelity = Object.values(benford.analyses).reduce((acc, a) => acc + a.fidelity_score, 0) / Object.keys(benford.analyses).length;
            scores.push(avgFidelity > 0.1 ? 1 : 0);
        }

        if (heatmap.success) {
            scores.push(heatmap.total_findings === 0 ? 1 : (heatmap.total_findings < 5 ? 0.5 : 0));
        }

        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg >= 0.9) return "CLEAN - HIGH CONFIDENCE";
        if (avg >= 0.6) return "MINOR ANOMALIES - MONITOR";
        return "CRITICAL DISCREPANCIES - FORENSIC AUDIT REQUIRED";
    }

    _generateMarkdownReport(report) {
        let md = `# SOMA FORENSIC AUDIT REPORT\n\n`;
        md += `**Target:** ${report.target}\n`;
        md += `**Timestamp:** ${new Date(report.timestamp).toLocaleString()}\n`;
        md += `**Verdict:** ${report.overall_verdict}\n\n`;

        md += `## 1. TIE HANDSHAKE RECONCILIATION\n`;
        if (report.tie) {
            md += `- **Status:** ${report.tie.verdict}\n`;
            md += `- **Fidelity:** ${(report.tie.matching.tie_fidelity * 100).toFixed(2)}%\n`;
            md += `- **Matches:** ${report.tie.matching.matched_count}\n`;
            md += `- **Discrepancies:** ${report.tie.matching.discrepancy_count}\n\n`;
        } else {
            md += `*Not performed (PDF not provided)*\n\n`;
        }

        md += `## 2. STATISTICAL BENFORD ANALYSIS\n`;
        if (report.benford.success) {
            Object.entries(report.benford.analyses).forEach(([col, a]) => {
                md += `### Column: ${col}\n`;
                md += `- **Conformity:** ${a.conformity}\n`;
                md += `- **MAD Score:** ${a.mad.toFixed(4)}\n`;
                md += `- **Sample Size:** ${a.sample_size}\n\n`;
            });
        } else {
            md += `*Failed: ${report.benford.error}*\n\n`;
        }

        md += `## 3. STRUCTURAL HEATMAP\n`;
        md += `- **Total Findings:** ${report.heatmap.total_findings}\n`;
        md += `- **Risk Density:** ${(report.heatmap.overall_risk_score * 100).toFixed(2)}%\n\n`;

        if (report.heatmap.findings.length > 0) {
            md += `### High-Risk Findings\n`;
            report.heatmap.findings.slice(0, 10).forEach(f => {
                md += `- [${f.severity}] ${f.type} in ${f.sheet}!${f.cell} (Value: ${f.value})\n`;
            });
        }

        md += `\n---\n*Generated by SOMA Forensic Suite V1.0*`;
        return md;
    }

    async _callLimb(task, inputObj) {
        return new Promise((resolve, reject) => {
            const scriptMap = {
                'benford': 'anomaly_detector.py',
                'heatmap': 'excel_heatmap.py',
                'tie_matcher': 'tie_matcher.py',
                'invoice_processor': 'invoice_processor.py',
                'meta_validator': 'meta_validator.py'
            };
            const script = path.join(process.cwd(), 'appendages', 'provenance', 'forensics', scriptMap[task]);

            const py = spawn(this.pythonPath, [script]);
            let output = '';
            let error = '';

            py.stdout.on('data', d => output += d.toString());
            py.stderr.on('data', d => error += d.toString());

            py.on('close', code => {
                if (code !== 0) return reject(new Error(`Forensic limb failed: ${error}`));
                try {
                    resolve(JSON.parse(output));
                } catch (e) {
                    reject(new Error(`Malformed forensic response: ${output}`));
                }
            });

            py.stdin.write(JSON.stringify(inputObj));
            py.stdin.end();
        });
    }

    /**
     * Meta-Context: Verify the vendor's domain for legitimacy.
     */
    async verifyVendorDomain(domain) {
        console.log(`🌐 [Forensic] Verifying vendor domain: ${domain}`);
        return await this._callLimb('meta_validator', { task: 'verify_domain', domain });
    }

    /**
     * Meta-Context: Analyze email headers for delivery security.
     */
    async analyzeEmailHeaders(emlPath) {
        console.log(`✉️ [Forensic] Analyzing email security headers: ${path.basename(emlPath)}`);
        return await this._callLimb('meta_validator', { task: 'analyze_email', input: emlPath });
    }


    getStatus() {
        return {
            name: this.name,
            engine: "Forensic-V1-Sovereign",
            busy: this.isBusy
        };
    }
}

export default ForensicVerdictArbiter;
