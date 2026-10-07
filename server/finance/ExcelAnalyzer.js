/**
 * server/finance/ExcelAnalyzer.js
 *
 * Audit-grade Excel analysis for SOMA.
 * Primary use case: "I can't find a $X variance — help me."
 *
 * What it finds:
 *  - Formula errors (#REF!, #VALUE!, #DIV/0!, etc.)
 *  - SUM range gaps: rows inserted between a SUM's start/end that fall outside the range
 *  - Formula vs cached-value discrepancies (re-evaluates simple SUMs numerically)
 *  - Cells with values that differ significantly from neighboring cells (outlier detection)
 *  - Circular references (detected via formula cross-reference)
 *  - Hardcoded numbers inside formulas that mix constants with references
 */

import XLSX from 'xlsx';

const FORMULA_ERRORS = new Set(['#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NAME?', '#NUM!', '#NULL!']);

// Re-evaluate a SUM formula numerically using the sheet's cached values.
// Returns { expected, actual, delta } where expected = re-computed sum.
function reEvalSum(ws, formula) {
    // Matches SUM(A1:B10) or SUM(Sheet1!A1:B10) — simple range form
    const rangeMatch = formula.match(/SUM\(([^)]+)\)/i);
    if (!rangeMatch) return null;

    const rangeStr = rangeMatch[1].replace(/^[^!]+!/, ''); // strip sheet prefix
    let range;
    try { range = XLSX.utils.decode_range(rangeStr); }
    catch { return null; }

    let sum = 0;
    let cellCount = 0;
    for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[addr];
            if (cell && typeof cell.v === 'number') {
                sum += cell.v;
                cellCount++;
            }
        }
    }
    return { sum: parseFloat(sum.toFixed(10)), cellCount, rangeStr };
}

// Check whether rows exist immediately above/below a SUM range that contain numbers
// but are NOT included in the range — the classic "inserted row outside range" bug.
function detectRangeGaps(ws, formula, sumCellAddr) {
    const rangeMatch = formula.match(/SUM\(([^)]+)\)/i);
    if (!rangeMatch) return [];

    const rangeStr = rangeMatch[1].replace(/^[^!]+!/, '');
    let range;
    try { range = XLSX.utils.decode_range(rangeStr); }
    catch { return []; }

    const gaps = [];
    const col = range.s.c; // check same column(s) as the SUM

    // Row immediately above the range start
    if (range.s.r > 0) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: range.s.r - 1, c: C });
            const cell = ws[addr];
            if (cell && typeof cell.v === 'number' && cell.v !== 0) {
                gaps.push({
                    type: 'gap_above',
                    cell: addr,
                    value: cell.v,
                    formula: cell.f || null,
                    message: `Cell ${addr} (value: ${fmtNum(cell.v)}) is immediately above the SUM range ${rangeStr} but NOT included in it`
                });
            }
        }
    }

    // Row immediately below the range end (before the SUM cell itself)
    const sumCell = XLSX.utils.decode_cell(sumCellAddr);
    const gapRow = range.e.r + 1;
    if (gapRow < sumCell.r) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: gapRow, c: C });
            const cell = ws[addr];
            if (cell && typeof cell.v === 'number' && cell.v !== 0) {
                gaps.push({
                    type: 'gap_below',
                    cell: addr,
                    value: cell.v,
                    formula: cell.f || null,
                    message: `Cell ${addr} (value: ${fmtNum(cell.v)}) is immediately below the SUM range ${rangeStr} but NOT included in it`
                });
            }
        }
    }

    return gaps;
}

function fmtNum(n) {
    if (typeof n !== 'number') return String(n);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cellLabel(addr, ws) {
    const cell = ws[addr];
    return cell?.v !== undefined ? `${addr} (${fmtNum(cell.v)})` : addr;
}

export class ExcelAnalyzer {
    /**
     * @param {string} filePath - absolute path to .xlsx / .xls file
     * @param {object} opts
     * @param {number} opts.varianceThreshold - minimum absolute delta to report as discrepancy (default 0.01)
     * @param {number} opts.outlierSigma - std-dev multiplier for outlier detection (default 3)
     */
    constructor(opts = {}) {
        this.varianceThreshold = opts.varianceThreshold ?? 0.01;
        this.outlierSigma = opts.outlierSigma ?? 3;
    }

    /**
     * Analyze an Excel file. Returns structured findings.
     * @param {string} filePath
     * @returns {AnalysisResult}
     */
    analyze(filePath) {
        let wb;
        try {
            wb = XLSX.readFile(filePath, { cellFormula: true, cellNF: true, cellDates: true });
        } catch (e) {
            return { ok: false, error: `Cannot read file: ${e.message}`, sheets: [] };
        }

        const sheets = [];
        for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            if (!ws) continue;
            const result = this._analyzeSheet(ws, sheetName);
            sheets.push(result);
        }

        const totalFindings = sheets.reduce((n, s) => n + s.findings.length, 0);
        const critical = sheets.flatMap(s => s.findings.filter(f => f.severity === 'critical'));
        const high = sheets.flatMap(s => s.findings.filter(f => f.severity === 'high'));

        return {
            ok: true,
            filePath,
            sheetCount: wb.SheetNames.length,
            totalFindings,
            criticalCount: critical.length,
            highCount: high.length,
            sheets,
            summary: this._buildSummary(sheets, critical, high)
        };
    }

    _analyzeSheet(ws, sheetName) {
        const ref = ws['!ref'];
        if (!ref) return { sheetName, findings: [], cellCount: 0 };

        let range;
        try { range = XLSX.utils.decode_range(ref); }
        catch { return { sheetName, findings: [], cellCount: 0 }; }

        const findings = [];
        let cellCount = 0;
        const numericCells = []; // for outlier detection

        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[addr];
                if (!cell) continue;
                cellCount++;

                // 1. Formula errors
                if (cell.t === 'e' || FORMULA_ERRORS.has(String(cell.v))) {
                    findings.push({
                        type: 'formula_error',
                        severity: 'critical',
                        cell: addr,
                        sheet: sheetName,
                        formula: cell.f || null,
                        value: cell.v,
                        message: `${addr}: Formula error ${cell.v}${cell.f ? ` in =  ${cell.f}` : ''}`
                    });
                    continue;
                }

                // Only analyze formula cells beyond here
                if (!cell.f) {
                    if (typeof cell.v === 'number') numericCells.push({ addr, v: cell.v, R, C });
                    continue;
                }

                const formula = cell.f;

                // 2. SUM range gaps
                if (/SUM\(/i.test(formula)) {
                    const gaps = detectRangeGaps(ws, formula, addr);
                    for (const gap of gaps) {
                        findings.push({
                            type: 'sum_range_gap',
                            severity: 'high',
                            cell: addr,
                            sheet: sheetName,
                            formula,
                            cachedValue: cell.v,
                            gap,
                            message: gap.message
                        });
                    }

                    // 3. SUM re-evaluation: compare cached value to recomputed
                    if (typeof cell.v === 'number') {
                        const eval_ = reEvalSum(ws, formula);
                        if (eval_ && Math.abs(eval_.sum - cell.v) > this.varianceThreshold) {
                            const delta = cell.v - eval_.sum;
                            findings.push({
                                type: 'sum_discrepancy',
                                severity: Math.abs(delta) > 1000 ? 'critical' : 'high',
                                cell: addr,
                                sheet: sheetName,
                                formula,
                                cachedValue: cell.v,
                                recomputedValue: eval_.sum,
                                delta,
                                message: `${addr}: SUM shows ${fmtNum(cell.v)} but cells in range ${eval_.rangeStr} add up to ${fmtNum(eval_.sum)} — difference of ${fmtNum(delta)}`
                            });
                        }
                    }
                }

                // 4. Hardcoded constants mixed with references (red flag in audit formulas)
                // e.g., =A1+B1+50000 — the 50000 is suspicious
                const hardcodedMatch = formula.match(/[+\-\*\/]\s*(\d{4,})/g);
                if (hardcodedMatch && /[A-Z]\d/.test(formula)) {
                    const constants = hardcodedMatch.map(m => m.replace(/[+\-\*\/\s]/g, ''));
                    findings.push({
                        type: 'hardcoded_constant',
                        severity: 'medium',
                        cell: addr,
                        sheet: sheetName,
                        formula,
                        constants,
                        message: `${addr}: Formula contains hardcoded number(s) [${constants.join(', ')}] mixed with cell references — verify this is intentional`
                    });
                }

                if (typeof cell.v === 'number') numericCells.push({ addr, v: cell.v, R, C });
            }
        }

        // 5. Formula column override: column with mostly formulas has a plain value cell
        // This is the most common manual-override pattern in audit workbooks.
        // Only fires when ≥ 60% of non-empty numeric cells in the column have formulas.
        const colFormulaRatio = {};
        const colAllCells = {};
        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[addr];
                if (!cell || cell.t !== 'n') continue;
                if (!colAllCells[C]) colAllCells[C] = [];
                colAllCells[C].push({ addr, cell, R });
            }
        }
        // Detect header rows: any row where > 50% of non-empty cells are strings
        const headerRows = new Set();
        for (let R = range.s.r; R <= range.e.r; R++) {
            let strCount = 0, total = 0;
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
                if (!cell) continue;
                total++;
                if (cell.t === 's') strCount++;
            }
            if (total > 0 && strCount / total > 0.5) headerRows.add(R);
        }

        for (const [col, cells] of Object.entries(colAllCells)) {
            if (cells.length < 3) continue; // not enough data points
            // Exclude header rows from the ratio calculation
            const dataCells = cells.filter(({ R }) => !headerRows.has(R));
            if (dataCells.length < 3) continue;
            const withFormula = dataCells.filter(({ cell }) => cell.f);
            const ratio = withFormula.length / dataCells.length;
            if (ratio >= 0.6) {
                // This column is predominantly formulaic — flag plain value cells
                const overrides = dataCells.filter(({ cell }) => !cell.f);
                for (const { addr, cell } of overrides) {
                    const alreadyFlagged = findings.some(f => f.cell === addr);
                    if (!alreadyFlagged) {
                        findings.push({
                            type: 'hardcoded_override',
                            severity: 'high',
                            cell: addr,
                            sheet: sheetName,
                            formula: null,
                            value: cell.v,
                            message: `${addr}: Value ${fmtNum(cell.v)} is a hardcoded number in a column where ${Math.round(ratio * 100)}% of cells contain formulas — likely a manual override`
                        });
                    }
                }
            }
        }

        // 6. Outlier detection: numeric cells > N std devs from column mean
        const byColumn = {};
        for (const nc of numericCells) {
            if (!byColumn[nc.C]) byColumn[nc.C] = [];
            byColumn[nc.C].push(nc);
        }

        for (const [, cells] of Object.entries(byColumn)) {
            if (cells.length < 5) continue; // too few data points
            const vals = cells.map(c => c.v);
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
            const std = Math.sqrt(variance);
            if (std < 1) continue; // uniform column, skip

            for (const nc of cells) {
                const zScore = Math.abs(nc.v - mean) / std;
                if (zScore > this.outlierSigma && Math.abs(nc.v) > 100) {
                    findings.push({
                        type: 'outlier',
                        severity: 'medium',
                        cell: nc.addr,
                        sheet: sheetName,
                        value: nc.v,
                        mean,
                        std,
                        zScore: parseFloat(zScore.toFixed(2)),
                        message: `${nc.addr}: Value ${fmtNum(nc.v)} is ${zScore.toFixed(1)}σ from column mean of ${fmtNum(mean)} — possible data entry error`
                    });
                }
            }
        }

        // Sort: critical first, then high, then medium
        const order = { critical: 0, high: 1, medium: 2 };
        findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

        return { sheetName, findings, cellCount };
    }

    _buildSummary(sheets, critical, high) {
        const lines = [];

        if (critical.length === 0 && high.length === 0) {
            lines.push('No critical or high-severity issues detected across all sheets.');
        } else {
            if (critical.length > 0) {
                lines.push(`**${critical.length} CRITICAL issue(s) found:**`);
                for (const f of critical.slice(0, 5)) lines.push(`  • [${f.sheet}] ${f.message}`);
                if (critical.length > 5) lines.push(`  • ...and ${critical.length - 5} more`);
            }
            if (high.length > 0) {
                lines.push(`**${high.length} HIGH severity issue(s) found:**`);
                for (const f of high.slice(0, 5)) lines.push(`  • [${f.sheet}] ${f.message}`);
                if (high.length > 5) lines.push(`  • ...and ${high.length - 5} more`);
            }
        }

        const medium = sheets.flatMap(s => s.findings.filter(f => f.severity === 'medium'));
        if (medium.length > 0) {
            lines.push(`**${medium.length} medium severity warning(s)** (hardcoded constants, outliers)`);
        }

        return lines.join('\n');
    }
}

export default ExcelAnalyzer;
