import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { createRequire } from 'module';
import ExcelAnalyzer from './ExcelAnalyzer.js';
import axisStore from '../axis/AxisStore.js';

const require = createRequire(import.meta.url);
const { getApprovalSystem } = require('../ApprovalSystem.cjs');
const approvalSystem = getApprovalSystem();
const XLSX = require('xlsx');

class ExcelOperator {
    constructor() {
        this.analyzer = new ExcelAnalyzer();
        this.receiptsDir = path.resolve(process.cwd(), 'data', 'finance', 'receipts');
        this.backupsDir = path.resolve(process.cwd(), 'data', 'finance', 'backups');
        this.reportsDir = path.resolve(process.cwd(), 'data', 'finance', 'reports');
        this.init();
    }

    async init() {
        await fs.mkdir(this.receiptsDir, { recursive: true });
        await fs.mkdir(this.backupsDir, { recursive: true });
        await fs.mkdir(this.reportsDir, { recursive: true });
    }

    // Resolve workbook from explicit path or projects index
    async resolveWorkbook(filenameOrPath) {
        if (path.isAbsolute(filenameOrPath) && existsSync(filenameOrPath)) {
            return filenameOrPath;
        }

        // Try process.cwd() / filenameOrPath
        const localPath = path.resolve(process.cwd(), filenameOrPath);
        if (existsSync(localPath)) return localPath;

        // Try scanning project uploads in SOMA's data folder
        // SOMA stores uploads in C:\Users\YOUR_USER\Desktop\The Stack\SOMA\data\projects\ or similar
        const possibleDirs = [
            path.resolve(process.cwd(), 'data', 'projects'),
            path.resolve(process.cwd(), 'data', 'uploads'),
            path.resolve(process.cwd(), 'data', 'finance')
        ];

        for (const dir of possibleDirs) {
            try {
                if (!existsSync(dir)) continue;
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (file.toLowerCase() === path.basename(filenameOrPath).toLowerCase()) {
                        return path.join(dir, file);
                    }
                }
            } catch {}
        }

        throw new Error(`Workbook file not found: ${filenameOrPath}`);
    }

    // Create a rollback/working copy
    async createWorkingCopy(originalPath) {
        const ext = path.extname(originalPath);
        const name = path.basename(originalPath, ext);
        const backupPath = path.join(this.backupsDir, `${name}_working_${Date.now()}${ext}`);
        await fs.mkdir(this.backupsDir, { recursive: true });
        await fs.copyFile(originalPath, backupPath);
        return backupPath;
    }

    // Run backend analysis and locate variance
    async analyzeAndLocateVariance(filePath, targetVariance = null) {
        const result = this.analyzer.analyze(filePath);
        if (!result.ok) {
            throw new Error(`Excel Analysis failed: ${result.error}`);
        }

        let matchedFindings = [];
        let recommendedCell = null;

        // If a target variance is specified, look for matching variance delta or values
        if (targetVariance !== null) {
            const targetVal = Math.abs(parseFloat(targetVariance));
            
            // Search findings for sum discrepancies matching variance
            for (const sheet of result.sheets) {
                for (const finding of sheet.findings) {
                    if (finding.delta && Math.abs(Math.abs(finding.delta) - targetVal) < 1.0) {
                        matchedFindings.push({
                            sheetName: sheet.sheetName,
                            cell: finding.cell,
                            type: finding.type,
                            message: finding.message,
                            value: finding.cachedValue,
                            delta: finding.delta
                        });
                    }
                }
            }

            // If no matching discrepancy finding, search all numeric cells for matches
            if (matchedFindings.length === 0) {
                try {
                    const wb = XLSX.readFile(filePath);
                    for (const sheetName of wb.SheetNames) {
                        const ws = wb.Sheets[sheetName];
                        const ref = ws['!ref'];
                        if (!ref) continue;
                        const range = XLSX.utils.decode_range(ref);
                        
                        // Check for adjacent column variance in same row (Actual vs Budget style)
                        for (let R = range.s.r; R <= range.e.r; R++) {
                            for (let C = range.s.c; C < range.e.c; C++) {
                                const addrA = XLSX.utils.encode_cell({ r: R, c: C });
                                const addrB = XLSX.utils.encode_cell({ r: R, c: C + 1 });
                                const cellA = ws[addrA];
                                const cellB = ws[addrB];
                                if (cellA && typeof cellA.v === 'number' && cellB && typeof cellB.v === 'number') {
                                    const diff = Math.abs(cellA.v - cellB.v);
                                    if (Math.abs(diff - targetVal) < 1.0) {
                                        matchedFindings.push({
                                            sheetName,
                                            cell: addrA,
                                            type: 'variance_match',
                                            message: `Row ${R + 1} has a variance of ${diff} between cell ${addrA} (${cellA.v}) and cell ${addrB} (${cellB.v}) matching target variance.`,
                                            value: diff
                                        });
                                    }
                                }
                            }
                        }

                        // Check simple single cell values matching targetVal
                        for (let R = range.s.r; R <= range.e.r; R++) {
                            for (let C = range.s.c; C <= range.e.c; C++) {
                                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                                const cell = ws[addr];
                                if (cell && typeof cell.v === 'number') {
                                    if (Math.abs(Math.abs(cell.v) - targetVal) < 1.0) {
                                        // Avoid duplicate listing
                                        const alreadyFound = matchedFindings.some(f => f.sheetName === sheetName && f.cell === addr);
                                        if (!alreadyFound) {
                                            matchedFindings.push({
                                                sheetName,
                                                cell: addr,
                                                type: 'value_match',
                                                message: `Cell ${addr} contains value ${cell.v} which matches variance amount.`,
                                                value: cell.v
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('[ExcelOperator] Error during fallback variance scan:', err);
                }
            }

            if (matchedFindings.length > 0) {
                recommendedCell = matchedFindings[0];
            }
        }

        return {
            analysis: result,
            matchedFindings,
            recommendedCell
        };
    }

    // Propose an action through the approval queue
    async proposeModification(filePath, sheetName, cellAddr, actionType, actionPayload) {
        const receiptId = `receipt-${Date.now()}`;
        const proposal = {
            type: 'file_write',
            action: `finance_excel_${actionType}`,
            details: {
                receiptId,
                filePath,
                sheetName,
                cellAddr,
                actionType,
                actionPayload
            },
            context: {
                app: 'ExcelOperator',
                risk: 'medium'
            }
        };

        const result = await approvalSystem.requestApproval(proposal);
        
        // Log receipt
        const receipt = {
            id: receiptId,
            filePath,
            sheetName,
            cellAddr,
            actionType,
            actionPayload,
            approved: result.approved,
            autoApproved: result.autoApproved,
            reason: result.reason,
            timestamp: Date.now()
        };
        await fs.writeFile(
            path.join(this.receiptsDir, `${receiptId}.json`),
            JSON.stringify(receipt, null, 2),
            'utf8'
        );

        if (!result.approved) {
            throw new Error(`Modification proposal was rejected by user: ${result.reason}`);
        }

        return receipt;
    }

    // Execute modification (adding sheet or adding comments)
    async executeModification(filePath, sheetName, cellAddr, actionType, actionPayload) {
        const wb = XLSX.readFile(filePath, { cellFormula: true, cellNF: true, cellDates: true });
        const ws = wb.Sheets[sheetName];
        if (!ws) throw new Error(`Sheet ${sheetName} not found in workbook.`);

        if (actionType === 'add_comment') {
            // Comments in xlsx are represented in ws['!comments'] or cell.c
            // For safety and compatibility across viewers, we can append a cell modification,
            // or write a clear text log, or insert a row next to it with SOMA's reconciliation comment.
            // Let's insert SOMA's comment in a cell next to the target cell, keeping it non-destructive
            const cell = XLSX.utils.decode_cell(cellAddr);
            const commentCellAddr = XLSX.utils.encode_cell({ r: cell.r, c: cell.c + 1 });
            ws[commentCellAddr] = {
                t: 's',
                v: `[SOMA RECONCILIATION] ${actionPayload.comment}`
            };
        } else if (actionType === 'add_reconciliation_sheet') {
            const newSheetName = actionPayload.sheetName || 'SOMA Reconciliation';
            const data = actionPayload.data || [
                ['SOMA Automated Reconciliation Report'],
                ['Timestamp', new Date().toISOString()],
                ['Target Cell', `${sheetName}!${cellAddr}`],
                ['Reconciliation Details', actionPayload.details]
            ];
            const newWs = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, newWs, newSheetName);
        } else {
            throw new Error(`Unknown modification action type: ${actionType}`);
        }

        XLSX.writeFile(wb, filePath);
        return true;
    }

    // Windows Automation layer: Open Microsoft Excel with specific cell highlighted via COM or spawn process
    async openInExcel(filePath, sheetName = null, cellAddr = null, highlightColorIndex = 6) {
        const absolutePath = path.resolve(filePath).replace(/\//g, '\\');
        
        // Build PowerShell command for COM automation
        let psCommand = `$excel = New-Object -ComObject Excel.Application; $excel.Visible = $true; $wb = $excel.Workbooks.Open('${absolutePath}');`;
        if (sheetName) {
            psCommand += `$ws = $wb.Sheets.Item('${sheetName}'); $ws.Activate();`;
            if (cellAddr) {
                psCommand += `$range = $ws.Range('${cellAddr}'); $range.Select();`;
                psCommand += `$range.Interior.ColorIndex = ${highlightColorIndex};`; // Yellow highlight
            }
        }

        return new Promise((resolve) => {
            exec(`powershell -NoProfile -Command "${psCommand}"`, (error, stdout, stderr) => {
                if (error) {
                    console.warn('[ExcelOperator] Excel COM automation failed, opening file normally. Error:', stderr);
                    // Fallback to opening file normally without cell highlights
                    exec(`start excel "${absolutePath}"`, (err) => {
                        if (err) {
                            exec(`explorer "${absolutePath}"`); // fallback to explorer
                        }
                    });
                    resolve({ success: false, mode: 'fallback_open', error: stderr });
                } else {
                    resolve({ success: true, mode: 'com_active' });
                }
            });
        });
    }
}

export default new ExcelOperator();
