/**
 * arbiters/AuditArbiter.js
 * 
 * SOMA Enterprise Audit Layer.
 * 
 * Orchestrates high-fidelity reconciliation (Three-Way Match) and 
 * provides a system of record for financial verification.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { ForensicVerdictArbiter } from './ForensicVerdictArbiter.js';
import path from 'path';

export class AuditArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: 'AuditArbiter',
            role: ArbiterRole.MAINTAINER,
            capabilities: [ArbiterCapability.REASONING, ArbiterCapability.KNOWLEDGE_SYNTHESIS],
        });

        this.system = opts.system;
        this.forensics = new ForensicVerdictArbiter(this.system);
        this.verificationLog = [];
    }

    async initialize() {
        this.auditLogger.success(`🏛️ [${this.name}] Audit Layer Online. Industrial-grade reconciliation active.`);
    }

    /**
     * Three-Way Match: Reconcile Purchase Order, Invoice, and Payment/GL Entry.
     */
    async performThreeWayMatch(poPath, invoicePath, glPath) {
        this.auditLogger.info(`🏛️ [Audit] Initiating Three-Way Match.`);
        
        // 1. Forensic TIE: Invoice vs GL
        const invoiceVsGL = await this.forensics.performTie(invoicePath, glPath);
        
        // 2. Forensic TIE: PO vs GL
        const poVsGL = await this.forensics.performTie(poPath, glPath);

        // 3. Extract PO Structure for deeper match
        let poData = null;
        try {
            poData = await this.forensics.performInvoiceExtraction(poPath);
        } catch (e) { console.warn("PO extraction failed:", e.message); }

        // 4. Synthesis: Cross-match all three
        const invData = invoiceVsGL.invoice_data;
        
        const discrepancies = [
            ...invoiceVsGL.matching.discrepancies || [],
            ...poVsGL.matching.discrepancies || []
        ];

        // Deep Field Matching
        if (invData?.success && poData?.success) {
            if (invData.total_amount !== poData.total_amount) {
                discrepancies.push(`Amount Mismatch: Invoice total ($${invData.total_amount}) != PO total ($${poData.total_amount})`);
            }
        }

        const matchResult = {
            success: invoiceVsGL.success && poVsGL.success && discrepancies.length === 0,
            timestamp: new Date().toISOString(),
            verdict: this._synthesizeThreeWayVerdict(invoiceVsGL, poVsGL, discrepancies),
            invoice_fidelity: invoiceVsGL.matching.tie_fidelity,
            po_fidelity: poVsGL.matching.tie_fidelity,
            discrepancies: discrepancies,
            structured_data: {
                invoice: invData,
                po: poData
            },
            audit_trail: `Three-way match performed between PO: ${path.basename(poPath)}, Invoice: ${path.basename(invoicePath)}, and GL: ${path.basename(glPath)}`
        };

        this.verificationLog.push(matchResult);
        return matchResult;
    }

    _synthesizeThreeWayVerdict(inv, po, discrepancies) {
        if (discrepancies.length > 0) return "CRITICAL MISMATCH - AUDIT FAILED";
        const fidelity = (inv.matching.tie_fidelity + po.matching.tie_fidelity) / 2;
        if (fidelity > 0.9) return "VERIFIED - FULL HANDSHAKE";
        if (fidelity > 0.7) return "PARTIAL MATCH - HUMAN REVIEW REQUIRED";
        return "CRITICAL MISMATCH - LOW FIDELITY";
    }

    getStatus() {
        return {
            name: this.name,
            verifiedCount: this.verificationLog.length,
            latestVerdict: this.verificationLog[this.verificationLog.length - 1]?.verdict || 'None'
        };
    }
}

export default AuditArbiter;
