/**
 * arbiters/ContextSearchArbiter.js
 * 
 * The "Hound" Lobe: Autonomous context-seeking for discrepancy resolution.
 * Searches local archives (email, chat logs, docs) to find justifications 
 * for financial anomalies.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

export class ContextSearchArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: 'ContextSearch',
            role: ArbiterRole.OBSERVER,
            capabilities: [ArbiterCapability.READ_FILES, ArbiterCapability.REASONING],
        });
        
        this.archivePaths = opts.archivePaths || [
            path.join(process.cwd(), 'data', 'archives', 'emails'),
            path.join(process.cwd(), 'data', 'archives', 'slack'),
            path.join(process.cwd(), 'data', 'vault', 'reflections')
        ];
    }

    async initialize() {
        this.auditLogger.success(`🐕 [${this.name}] Hound Lobe active. Ready to track down context.`);
        for (const p of this.archivePaths) {
            await fs.mkdir(p, { recursive: true }).catch(() => {});
        }
    }

    /**
     * Resolves a discrepancy by searching archives for keywords.
     */
    async resolveDiscrepancy(discrepancyText, targetVendor) {
        this.auditLogger.info(`🐕 [Hound] Tracking context for: "${discrepancyText}" (Vendor: ${targetVendor})`);
        
        // Extract keywords for search (amounts, vendor name, etc.)
        const keywords = new Set();
        if (targetVendor) keywords.add(targetVendor.toLowerCase());
        
        const amountMatch = discrepancyText.match(/\d+(?:\.\d+)?/g);
        if (amountMatch) amountMatch.forEach(a => keywords.add(a));
        
        const importantWords = discrepancyText.toLowerCase().match(/\b(approve|fee|shipping|tax|adjustment|error|manager|discount)\b/g);
        if (importantWords) importantWords.forEach(w => keywords.add(w));

        const findings = [];

        for (const archivePath of this.archivePaths) {
            try {
                const files = await fs.readdir(archivePath);
                for (const file of files) {
                    const content = await fs.readFile(path.join(archivePath, file), 'utf8');
                    const lowerContent = content.toLowerCase();
                    
                    let matches = 0;
                    keywords.forEach(kw => {
                        if (lowerContent.includes(kw)) matches++;
                    });

                    if (matches >= 2) { // At least two keyword matches
                        findings.push({
                            source: path.basename(archivePath),
                            file: file,
                            relevance: matches / keywords.size,
                            snippet: this._getSnippet(content, Array.from(keywords))
                        });
                    }
                }
            } catch (e) {
                console.warn(`⚠️ [Hound] Failed to read archive ${archivePath}: ${e.message}`);
            }
        }

        const sortedFindings = findings.sort((a, b) => b.relevance - a.relevance);
        
        return {
            success: sortedFindings.length > 0,
            justification: sortedFindings[0] || null,
            all_findings: sortedFindings.slice(0, 5)
        };
    }

    _getSnippet(content, keywords) {
        const firstKw = keywords[0];
        const idx = content.toLowerCase().indexOf(firstKw);
        if (idx === -1) return content.slice(0, 200) + "...";
        return "..." + content.slice(Math.max(0, idx - 50), idx + 150).replace(/\n/g, ' ') + "...";
    }

    getStatus() {
        return {
            name: this.name,
            archivesTracked: this.archivePaths.length,
            ready: true
        };
    }
}

export default ContextSearchArbiter;
