/**
 * FinancialCitationGuard.js
 *
 * Hard structural gate on financial responses.
 * Scans for dollar amounts and percentages that lack an explicit source citation.
 *
 * A "cited" number is one followed (within 120 chars) by any of:
 *   - Cell reference:     Sheet1!B47  |  B47  |  (B47)
 *   - Source label:       (Source: …) |  [Source: …]  |  per …
 *   - Document reference: (Doc: …)    |  (p.12)        |  (Page 12)
 *   - Explicit unknown:   "insufficient data" | "cannot cite" | "verify"
 *
 * Numbers inside ExcelAnalyzer output blocks (already cited by the tool)
 * are excluded from scanning.
 */

// Matches dollar amounts: $1,024,500  $1.2M  $47,320.50
const MONEY_PATTERN = /\$[\d,]+(?:\.\d{1,2})?(?:\s*[MBK](?:illion|illion)?)?/gi;

// Matches percentages: 12.5%  2.47%
const PCT_PATTERN = /\b\d+(?:\.\d+)?%/g;

// Citation patterns accepted within 120 chars after the number.
// Patterns are ordered from most-specific to least to reduce false positives.
const CITATION_PATTERNS = [
    /[A-Za-z_][\w]*![A-Z]{1,3}\d+/,                // Sheet1!B47 — cross-sheet reference (most specific)
    /\b[A-Z]{1,3}\d{1,5}(?!\w)/,                   // B47, C12 — cell address not followed by word chars
    /\(Source:/i,                                   // (Source: ...)
    /\[Source:/i,                                   // [Source: ...]
    /\(Doc:/i,                                      // (Doc: ...)
    /\(p\.\s*\d+\)/i,                              // (p.12)
    /\(Page\s*\d+\)/i,                             // (Page 12)
    /\(line\s*\d+\)/i,                             // (line 47)
    /per\s+(?:the\s+)?(?:document|file|report|workbook|sheet|ledger|tab)/i,
    /insufficient\s+data/i,
    /cannot\s+cite/i,
    /no\s+source\s+available/i,
    /verify\s+(?:against|source|applicable)/i,
    /cached\s+values?\s+as\s+of/i,
    /\(Sheet\d*\b/i,                               // (Sheet1, (Sheet2
    /\(Tab\s*\d*\b/i,                              // (Tab, (Tab 3
];

// Blocks injected by ExcelAnalyzer are already sourced — skip them
const SKIP_BLOCK_PATTERN = /\[EXCEL ANALYSIS[^\]]*\][\s\S]*?\[\/EXCEL ANALYSIS[^\]]*\]/gi;

export class FinancialCitationGuard {

    validate(text, excelContext = '') {
        // Strip already-cited tool output blocks
        const cleanText = text.replace(SKIP_BLOCK_PATTERN, '');

        const violations = [];

        const checkPatterns = [
            { pattern: MONEY_PATTERN, type: 'dollar_amount' },
            { pattern: PCT_PATTERN,   type: 'percentage' },
        ];

        for (const { pattern, type } of checkPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(cleanText)) !== null) {
                const after = cleanText.slice(match.index, match.index + match[0].length + 120);
                const cited = CITATION_PATTERNS.some(cp => cp.test(after));
                if (!cited) {
                    violations.push({
                        type,
                        value:   match[0],
                        excerpt: cleanText.slice(Math.max(0, match.index - 20), match.index + 60).replace(/\n/g, ' ').trim(),
                    });
                }
            }
        }

        return {
            valid:      violations.length === 0,
            violations,
            score:      violations.length === 0 ? 1.0 : Math.max(0, 1 - (violations.length * 0.15)),
        };
    }

    /**
     * Appends a structured warning block to the response when uncited numbers are found.
     * The block is visible to the user so they know to verify manually.
     */
    annotate(text, violations) {
        if (!violations.length) return text;

        const items = violations
            .slice(0, 5)
            .map(v => `  • ${v.value} — no source citation found near: "…${v.excerpt}…"`)
            .join('\n');

        const overflow = violations.length > 5 ? `\n  … and ${violations.length - 5} more.` : '';

        return `${text}

---
⚠ CITATION WARNING — ${violations.length} figure${violations.length > 1 ? 's' : ''} could not be verified against a cited source:
${items}${overflow}

Please verify these figures against the source document before relying on them professionally.`;
    }
}

export default new FinancialCitationGuard();
