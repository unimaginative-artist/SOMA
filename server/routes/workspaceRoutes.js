/**
 * server/routes/workspaceRoutes.js
 * Tie workspace — projects, tasks, and file attachments.
 * Stores data in data/workspace/ as JSON (no new deps).
 */

import express from 'express';
import fs      from 'fs/promises';
import path    from 'path';
import crypto  from 'crypto';
import { createRequire } from 'module';
import { ContentExtractor } from '../utils/ContentExtractor.js';
import axisStore from '../axis/AxisStore.js';
import { reasonGrounded } from '../context/GroundedReasoning.js';

const require   = createRequire(import.meta.url);
const multer    = require('multer');
const DATA_DIR  = path.join(process.cwd(), 'data', 'workspace');
const FILES_DIR = path.join(DATA_DIR, 'uploads');
const extractor = new ContentExtractor();

function safeSegment(value = '') {
    return String(value || 'unassigned').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unassigned';
}

function projectFilesDir(projectId = '') {
    return path.join(FILES_DIR, safeSegment(projectId));
}

const storage = multer.diskStorage({
    destination: async (req, _file, cb) => {
        const dir = projectFilesDir(req.params.id);
        await fs.mkdir(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        cb(null, `${Date.now()}-${crypto.randomUUID()}-${file.originalname.replace(/[^a-z0-9.\-_]/gi, '_')}`);
    },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function fileExt(name = '') {
    return String(name).split('.').pop()?.toLowerCase() || '';
}

function enrichFileRecord(file) {
    const storedName = file?.storedName || '';
    return {
        ...file,
        path: storedName ? safeFilePath(file) : file?.path,
        ext: fileExt(file?.originalName || storedName),
    };
}

function uid(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
}

function safeFilePath(fileOrName = '', projectId = null) {
    const storedName = typeof fileOrName === 'object' ? fileOrName.storedName : fileOrName;
    const scopedProjectId = typeof fileOrName === 'object' ? fileOrName.projectDir : projectId;
    const root = path.resolve(scopedProjectId ? projectFilesDir(scopedProjectId) : FILES_DIR);
    const resolved = path.resolve(root, path.basename(storedName || ''));
    if (!resolved.startsWith(root + path.sep)) {
        throw new Error('invalid file path');
    }
    return resolved;
}

async function sha256File(filePath) {
    const buf = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function appendAudit(system, { actor = 'AXIS', action, filePath = null, metadata = {} }) {
    try {
        return system?.auditLedger?.append?.({ actor, action, filePath, metadata });
    } catch (e) {
        console.warn('[workspaceRoutes] audit append failed:', e.message);
        return null;
    }
}

function actorFromReq(req) {
    return req.headers['x-axis-user-name'] || req.headers['x-tie-user-name'] || req.headers['x-soma-actor'] || 'AXIS';
}

function axisUserFromReq(req) {
    return {
        userId: req.headers['x-axis-user-id'] || 'anon',
        userName: req.headers['x-axis-user-name'] || 'Anonymous',
    };
}

function canManageProject(projectId, req) {
    try {
        const user = axisUserFromReq(req);
        const project = axisStore.getProject(projectId);
        if (!project) return { ok: false, status: 404, error: 'Project not found' };
        if (project.created_by === user.userId) return { ok: true, project, user, role: 'owner' };
        const member = axisStore.getProjectMember(projectId, user.userId);
        const role = member?.role || '';
        if (!['owner', 'contributor', 'reviewer'].includes(role)) return { ok: false, status: 403, error: 'Project permission denied' };
        return { ok: true, project, user, role };
    } catch (e) {
        return { ok: false, status: 500, error: e.message };
    }
}

async function extractWorkbookText(filePath) {
    const XLSX = await loadXLSX();
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const chunks = [];
    for (const sheetName of workbook.SheetNames.slice(0, 20)) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!rows.length) continue;
        const previewRows = rows.slice(0, 500).map(row => row.map(cell => String(cell ?? '').trim()).join('\t')).join('\n');
        chunks.push(`Sheet: ${sheetName}\n${previewRows}`);
    }
    return chunks.join('\n\n---\n\n').trim();
}

async function loadXLSX() {
    const mod = await import('xlsx');
    return mod.default || mod;
}

async function extractIndexableContent(file) {
    const enriched = enrichFileRecord(file);
    const ext = `.${fileExt(enriched.originalName || enriched.path)}`;
    if (['.xlsx', '.xls'].includes(ext)) {
        return extractWorkbookText(enriched.path);
    }
    return extractor.extract(enriched.path, { originalName: enriched.originalName, mimeType: enriched.mimetype });
}

async function indexProjectFile(system, file, project = null) {
    const arbiter = system?.hybridSearchArbiter || system?.hybridSearch;
    if (!arbiter) {
        return { ok: false, skipped: true, error: 'Hybrid Search Arbiter not initialized' };
    }

    const enriched = enrichFileRecord(file);
    const content = await extractIndexableContent(file);
    if (!content || !content.trim()) {
        return { ok: false, skipped: true, error: 'No indexable text extracted' };
    }

    const document = {
        id: `axis_project_file:${file.projectId}:${file.id}:v${file.version || 1}`,
        name: enriched.originalName,
        path: enriched.path,
        content: content.slice(0, 250000),
        metadata: {
            source: 'axis_project_file',
            universe: 'axis',
            projectId: file.projectId,
            projectName: project?.name || '',
            fileId: file.id,
            fileVersion: file.version || 1,
            checksum: file.checksum,
            originalName: file.originalName,
            path: enriched.path,
            extension: fileExt(file.originalName),
            uploadedBy: file.uploadedBy,
            uploadedAt: file.uploadedAt,
        },
    };

    if (typeof arbiter.indexBatch === 'function') {
        const result = await arbiter.indexBatch([document], { universe: 'axis' });
        return { ok: true, result, documentId: document.id, chars: document.content.length };
    }
    const result = await arbiter.indexDocument(document);
    return { ok: !!result?.success, result, documentId: document.id, chars: document.content.length };
}

function updateFileById(files, id, updater) {
    const idx = files.findIndex(f => f.id === id);
    if (idx === -1) return { files, file: null };
    const next = [...files];
    next[idx] = updater(next[idx], idx);
    return { files: next, file: next[idx] };
}

function safeSheetName(name = 'Sheet') {
    return String(name || 'Sheet').replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet';
}

function addAoaSheet(XLSX, workbook, name, rows, opts = {}) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    sheet['!cols'] = Array.from({ length: colCount }, (_, ci) => {
        const maxLen = rows.reduce((max, row) => Math.max(max, String(row[ci] ?? '').length), 8);
        return { wch: Math.min(Math.max(maxLen + 2, 10), opts.maxWidth || 72) };
    });
    if (rows.length > 1 && colCount > 1) {
        sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: colCount - 1 } }) };
    }
    sheet['!freeze'] = { xSplit: 0, ySplit: opts.freezeRows ?? 1 };
    const finalName = safeSheetName(name);
    XLSX.utils.book_append_sheet(workbook, sheet, finalName);
    sheet.__somaSheetName = finalName;
    return sheet;
}

function setHyperlink(sheet, cell, target, tooltip = '') {
    if (!sheet[cell]) sheet[cell] = { t: 's', v: cell };
    sheet[cell].l = { Target: target, Tooltip: tooltip || target };
}

function addComment(sheet, cell, text, author = 'SOMA') {
    if (!sheet[cell]) sheet[cell] = { t: 's', v: '' };
    sheet[cell].c = [{ a: author, t: text }];
}

function setFormula(sheet, cell, formula, fallback = 0) {
    sheet[cell] = { t: 'n', f: formula, v: fallback };
}

function quoteSheet(name = '') {
    return `'${String(name).replace(/'/g, "''")}'`;
}

function linkTarget(sheetName, cell = 'A1') {
    return `#${quoteSheet(sheetName)}!${cell}`;
}

function allFindings(analysis = {}) {
    return (analysis.sheets || []).flatMap(sheet => (sheet.findings || []).map(f => ({ ...f, sheet: f.sheet || sheet.sheetName })));
}

async function buildSmartWorkbook({ file, project, system }) {
    const XLSX = await loadXLSX();
    const enriched = enrichFileRecord(file);
    const ext = fileExt(enriched.originalName || enriched.path);
    const isWorkbook = ['xlsx', 'xls'].includes(ext);
    const generatedAt = new Date();
    const workbook = XLSX.utils.book_new();
    workbook.Props = {
        Title: `AXIS Evidence Package - ${enriched.originalName}`,
        Subject: `Project evidence export for ${project?.name || file.projectId}`,
        Author: 'SOMA Axis Project Intelligence',
        Company: 'SOMA',
        CreatedDate: generatedAt,
    };

    let analysis = null;
    if (isWorkbook) {
        const { ExcelAnalyzer } = await import('../finance/ExcelAnalyzer.js');
        analysis = new ExcelAnalyzer().analyze(enriched.path);
    }

    const findings = allFindings(analysis);
    const critical = findings.filter(f => f.severity === 'critical').length;
    const high = findings.filter(f => f.severity === 'high').length;
    const medium = findings.filter(f => f.severity === 'medium').length;
    const status = critical ? 'Critical review required' : high ? 'High-priority review required' : findings.length ? 'Review recommended' : 'No major findings detected';

    const cover = addAoaSheet(XLSX, workbook, 'Cover', [
        ['AXIS SMART WORKBOOK'],
        ['A project evidence package generated by SOMA'],
        [],
        ['Project', project?.name || file.projectId],
        ['File', enriched.originalName],
        ['Version', file.version || 1],
        ['Generated', generatedAt.toISOString()],
        ['Status', status],
        [],
        ['Open', 'Sheet', 'Purpose'],
        ['Go', 'Executive Summary', 'Risk level, totals, and SOMA summary'],
        ['Go', 'Findings', 'Filterable issue table with links back to source rows'],
        ['Go', 'Evidence Ledger', 'Integrity metadata, hash, project, and audit context'],
        ['Go', 'Sheet Profile', 'Per-sheet counts and review focus'],
        ['Go', 'Read Me', 'How to use this workbook'],
    ], { maxWidth: 86 });

    const summary = addAoaSheet(XLSX, workbook, 'Executive Summary', [
        ['AXIS Smart Workbook Package'],
        ['Generated', generatedAt.toISOString()],
        ['Project', project?.name || file.projectId],
        ['File', enriched.originalName],
        ['Version', file.version || 1],
        ['Status', status],
        [],
        ['Metric', 'Value'],
        ['Total findings', findings.length],
        ['Critical findings', critical],
        ['High findings', high],
        ['Medium findings', medium],
        ['Sheets analyzed', analysis?.sheetCount ?? 'N/A'],
        ['Indexed for SOMA search', file.intelligence?.indexed ? 'Yes' : 'No'],
        ['Indexed document', file.intelligence?.documentId || 'N/A'],
        ['Checksum', file.checksum || ''],
        [],
        ['SOMA Note'],
        [analysis?.summary || 'This export packages the file, integrity evidence, extracted content, and automated analysis metadata into one workbook.'],
    ], { maxWidth: 90 });
    setFormula(summary, 'B9', 'COUNTA(Findings!A2:A10000)', findings.length);
    setFormula(summary, 'B10', 'COUNTIF(Findings!B:B,"CRITICAL")', critical);
    setFormula(summary, 'B11', 'COUNTIF(Findings!B:B,"HIGH")', high);
    setFormula(summary, 'B12', 'COUNTIF(Findings!B:B,"MEDIUM")', medium);
    addComment(summary, 'A1', 'Formula-backed counts update if the Findings sheet is edited.');

    const findingRows = findings.length ? findings.map((f, index) => [
        `F-${String(index + 1).padStart(3, '0')}`,
        String(f.severity || '').toUpperCase(),
        f.type || '',
        f.sheet || '',
        f.cell || '',
        f.message || '',
        f.formula ? `=${f.formula}` : '',
        f.cachedValue ?? f.value ?? '',
        f.recomputedValue ?? '',
        f.delta ?? '',
        'Open source',
    ]) : [['', 'OK', 'none', '', '', 'No automated findings detected.', '', '', '', '', '']];

    const findingsSheet = addAoaSheet(XLSX, workbook, 'Findings', [
        ['ID', 'Severity', 'Type', 'Sheet', 'Cell', 'Message', 'Formula', 'Cached Value', 'Recomputed Value', 'Delta', 'Source'],
        ...findingRows,
    ], { maxWidth: 96 });

    const ledger = addAoaSheet(XLSX, workbook, 'Evidence Ledger', [
        ['Field', 'Value'],
        ['File ID', file.id],
        ['Project ID', file.projectId],
        ['Project Name', project?.name || ''],
        ['Original Name', file.originalName],
        ['Stored Path', enriched.path],
        ['SHA-256', file.checksum || ''],
        ['MIME Type', file.mimetype || ''],
        ['Size Bytes', file.size || 0],
        ['Uploaded By', file.uploadedBy || ''],
        ['Uploaded At', file.uploadedAt ? new Date(file.uploadedAt).toISOString() : ''],
        ['Download Count', file.downloadCount || 0],
        ['Last Downloaded At', file.lastDownloadedAt ? new Date(file.lastDownloadedAt).toISOString() : ''],
        ['Search Status', file.intelligence?.indexingStatus || 'unknown'],
        ['Index Error', file.intelligence?.indexError || ''],
        ['Excel Last Scan', file.intelligence?.lastScanAt ? new Date(file.intelligence.lastScanAt).toISOString() : ''],
        ['Excel Ledger Hash', file.intelligence?.ledger?.hash || ''],
    ], { maxWidth: 110 });
    addComment(ledger, 'B6', 'This SHA-256 hash identifies the uploaded source file content.');

    if (analysis?.sheets?.length) {
        const profile = addAoaSheet(XLSX, workbook, 'Sheet Profile', [
            ['Sheet', 'Cells Analyzed', 'Findings', 'Critical', 'High', 'Medium'],
            ...analysis.sheets.map(sheet => {
                const sf = sheet.findings || [];
                return [
                    sheet.sheetName,
                    sheet.cellCount || 0,
                    sf.length,
                    sf.filter(f => f.severity === 'critical').length,
                    sf.filter(f => f.severity === 'high').length,
                    sf.filter(f => f.severity === 'medium').length,
                ];
            }),
        ]);
        for (let r = 1; r <= analysis.sheets.length; r++) {
            const sheetName = profile[`A${r + 1}`]?.v;
            if (sheetName) setHyperlink(profile, `A${r + 1}`, linkTarget(safeSheetName(`Raw ${sheetName}`)), 'Open raw sheet preview');
        }
    }

    const rawSheetNames = new Map();
    if (isWorkbook) {
        const source = XLSX.readFile(enriched.path, { cellDates: true, cellFormula: true });
        for (const sheetName of source.SheetNames.slice(0, 8)) {
            const sheet = source.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }).slice(0, 1000);
            const raw = addAoaSheet(XLSX, workbook, `Raw ${sheetName}`, rows.length ? rows : [['No rows detected']], { maxWidth: 60 });
            rawSheetNames.set(sheetName, raw.__somaSheetName);
        }
    } else {
        const content = await extractIndexableContent(file).catch(() => '');
        const lines = String(content || '').split(/\r?\n/).slice(0, 2000);
        const extracted = addAoaSheet(XLSX, workbook, 'Extracted Text', [
            ['Line', 'Content'],
            ...lines.map((line, index) => [index + 1, line]),
        ], { maxWidth: 120 });
        rawSheetNames.set('Extracted Text', extracted.__somaSheetName);
    }

    findings.forEach((f, index) => {
        const row = index + 2;
        const rawName = rawSheetNames.get(f.sheet);
        if (rawName && f.cell) {
            setHyperlink(findingsSheet, `K${row}`, linkTarget(rawName, f.cell), `Open ${f.sheet}!${f.cell}`);
        }
    });

    setHyperlink(cover, 'A11', linkTarget('Executive Summary'), 'Open Executive Summary');
    setHyperlink(cover, 'A12', linkTarget('Findings'), 'Open Findings');
    setHyperlink(cover, 'A13', linkTarget('Evidence Ledger'), 'Open Evidence Ledger');
    setHyperlink(cover, 'A14', linkTarget('Sheet Profile'), 'Open Sheet Profile');
    setHyperlink(cover, 'A15', linkTarget('Read Me'), 'Open Read Me');

    addAoaSheet(XLSX, workbook, 'Read Me', [
        ['How to use this workbook'],
        ['1', 'Start with Executive Summary for risk level and project context.'],
        ['2', 'Use Findings for cell-level review and filtering by severity.'],
        ['3', 'Use Evidence Ledger to verify integrity, source path, checksum, and audit metadata.'],
        ['4', 'Use Source links in Findings to jump to the raw preview row/cell when available.'],
        ['5', 'Use Raw sheets or Extracted Text for source inspection.'],
        ['6', 'Treat automated findings as triage, not final professional judgment.'],
    ], { maxWidth: 100 });

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const audit = appendAudit(system, {
        actor: 'SOMA',
        action: 'axis_project_smart_workbook_export',
        filePath: enriched.path,
        metadata: {
            projectId: file.projectId,
            fileId: file.id,
            originalName: file.originalName,
            version: file.version || 1,
            checksum: file.checksum,
            findings: findings.length,
            critical,
            high,
        },
    });
    return { buffer, audit, findingCount: findings.length };
}

async function buildProjectSmartWorkbook({ project, files = [], system }) {
    const XLSX = await loadXLSX();
    const generatedAt = new Date();
    const workbook = XLSX.utils.book_new();
    const tasks = (() => {
        try { return axisStore.getTasks(project.id).map(task => ({ ...task, tags: JSON.parse(task.tags || '[]') })); } catch { return []; }
    })();
    const activity = (() => {
        try { return axisStore.getProjectActivity(project.id, 200); } catch { return []; }
    })();
    const decisions = activity.filter(row => row.action === 'project.decision_pinned');

    workbook.Props = {
        Title: `AXIS Project Intelligence Package - ${project.name || project.id}`,
        Subject: 'Project files, tasks, decisions, and evidence export',
        Author: 'SOMA Axis Project Intelligence',
        Company: 'SOMA',
        CreatedDate: generatedAt,
    };

    addAoaSheet(XLSX, workbook, 'Cover', [
        ['AXIS PROJECT INTELLIGENCE PACKAGE'],
        ['A collaboration export generated by SOMA'],
        [],
        ['Project', project.name || project.id],
        ['Description', project.description || ''],
        ['Generated', generatedAt.toISOString()],
        ['Files', files.length],
        ['Tasks', tasks.length],
        ['Pinned Decisions', decisions.length],
        [],
        ['Open', 'Sheet', 'Purpose'],
        ['Go', 'Project Summary', 'Project totals and current status'],
        ['Go', 'File Inventory', 'Uploaded files, hashes, index state, and export links'],
        ['Go', 'Task Ledger', 'Tasks, owners, status, priority, and due dates'],
        ['Go', 'Decisions', 'Pinned decisions with source message metadata'],
        ['Go', 'Activity Timeline', 'Recent project activity'],
        ['Go', 'Read Me', 'How to use this workbook'],
    ], { maxWidth: 96 });

    addAoaSheet(XLSX, workbook, 'Project Summary', [
        ['Metric', 'Value'],
        ['Project ID', project.id],
        ['Project Name', project.name || ''],
        ['Description', project.description || ''],
        ['Status', project.status || 'active'],
        ['Files Uploaded', files.length],
        ['Indexed Files', files.filter(file => file.intelligence?.indexed || file.intelligence?.indexingStatus === 'indexed').length],
        ['Tasks Total', tasks.length],
        ['Tasks Done', tasks.filter(task => task.status === 'done').length],
        ['Tasks Open', tasks.filter(task => task.status !== 'done').length],
        ['Pinned Decisions', decisions.length],
        ['Generated', generatedAt.toISOString()],
    ], { maxWidth: 100 });

    addAoaSheet(XLSX, workbook, 'File Inventory', [
        ['File ID', 'Name', 'Type', 'Size Bytes', 'Version', 'SHA-256', 'Uploaded By', 'Uploaded At', 'Index Status', 'Indexed Document', 'Excel Findings', 'Download URL', 'Smart Workbook URL'],
        ...files.map(file => {
            const enriched = enrichFileRecord(file);
            return [
                file.id,
                file.originalName,
                fileExt(file.originalName || enriched.path),
                file.size || 0,
                file.version || 1,
                file.checksum || '',
                file.uploadedBy || '',
                file.uploadedAt ? new Date(file.uploadedAt).toISOString() : '',
                file.intelligence?.indexingStatus || (file.intelligence?.indexed ? 'indexed' : 'unknown'),
                file.intelligence?.documentId || '',
                file.intelligence?.totalFindings ?? '',
                `/api/workspace/files/${file.id}/download`,
                `/api/workspace/files/${file.id}/smart-workbook`,
            ];
        }),
    ], { maxWidth: 110 });

    addAoaSheet(XLSX, workbook, 'Task Ledger', [
        ['Task ID', 'Title', 'Status', 'Priority', 'Assignee', 'Due Date', 'Created By', 'Created At', 'Updated At', 'Description'],
        ...tasks.map(task => [
            task.id,
            task.title,
            task.status || 'todo',
            task.priority || 'medium',
            task.assignee_name || task.assignee_id || '',
            task.due_date ? new Date(Number(task.due_date)).toISOString() : '',
            task.created_by_name || task.created_by || '',
            task.created_at ? new Date(Number(task.created_at)).toISOString() : '',
            task.updated_at ? new Date(Number(task.updated_at)).toISOString() : '',
            task.description || '',
        ]),
    ], { maxWidth: 100 });

    addAoaSheet(XLSX, workbook, 'Decisions', [
        ['Decision ID', 'Summary', 'Actor', 'Created At', 'Source Message', 'Source Channel', 'Source Text'],
        ...decisions.map(row => [
            row.id,
            row.summary || '',
            row.actor_name || '',
            row.created_at ? new Date(Number(row.created_at)).toISOString() : '',
            row.metadata?.sourceMessageId || '',
            row.metadata?.sourceChannelId || '',
            row.metadata?.sourceText || '',
        ]),
    ], { maxWidth: 120 });

    addAoaSheet(XLSX, workbook, 'Activity Timeline', [
        ['Activity ID', 'Action', 'Summary', 'Actor', 'Target Type', 'Target ID', 'Created At'],
        ...activity.map(row => [
            row.id,
            row.action,
            row.summary || '',
            row.actor_name || '',
            row.target_type || '',
            row.target_id || '',
            row.created_at ? new Date(Number(row.created_at)).toISOString() : '',
        ]),
    ], { maxWidth: 110 });

    addAoaSheet(XLSX, workbook, 'Read Me', [
        ['How to use this project export'],
        ['1', 'Start with Project Summary for current project totals.'],
        ['2', 'Use File Inventory to verify uploads, hashes, index state, and file-specific exports.'],
        ['3', 'Use Task Ledger for delivery tracking and ownership review.'],
        ['4', 'Use Decisions to preserve project calls that would otherwise be buried in chat.'],
        ['5', 'Use Activity Timeline for audit and collaboration history.'],
    ], { maxWidth: 100 });

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const audit = appendAudit(system, {
        actor: 'SOMA',
        action: 'axis_project_intelligence_workbook_export',
        metadata: {
            projectId: project.id,
            fileCount: files.length,
            taskCount: tasks.length,
            decisionCount: decisions.length,
        },
    });
    return { buffer, audit };
}

function textSnippetsForQuestion(content = '', question = '', limit = 14000) {
    const text = String(content || '').replace(/\r/g, '');
    if (text.length <= limit) return text;
    const terms = String(question || '')
        .toLowerCase()
        .split(/[^a-z0-9_$.-]+/i)
        .filter(term => term.length > 3)
        .slice(0, 12);
    const chunks = [];
    for (const term of terms) {
        const idx = text.toLowerCase().indexOf(term);
        if (idx >= 0) {
            const start = Math.max(0, idx - 1600);
            const end = Math.min(text.length, idx + 2600);
            chunks.push(text.slice(start, end));
        }
        if (chunks.join('\n\n---\n\n').length >= limit) break;
    }
    const merged = chunks.length ? chunks.join('\n\n--- matched context ---\n\n') : text.slice(0, limit);
    return merged.slice(0, limit);
}

async function answerProjectFileQuestion(system, { file, project, question }) {
    const enriched = enrichFileRecord(file);
    const content = await extractIndexableContent(file).catch(() => '');
    const context = textSnippetsForQuestion(content, question);
    const intelligence = file.intelligence || {};
    const prompt = [
        'You are SOMA inside Axis Projects. Answer using only the provided project file context and metadata.',
        'Be concrete. If the file does not contain the answer, say that directly and suggest the next file or check.',
        'When useful, cite the file name, sheet/section names, and evidence from the provided text. Do not invent facts.',
        '',
        `Project: ${project?.name || file.projectId}`,
        `Project description: ${project?.description || ''}`,
        `File: ${enriched.originalName}`,
        `Extension: ${fileExt(enriched.originalName || enriched.path)}`,
        `Version: ${file.version || 1}`,
        `Checksum: ${file.checksum || ''}`,
        `Indexed: ${intelligence.indexed ? 'yes' : 'no'} (${intelligence.indexingStatus || 'unknown'})`,
        `Excel findings: total=${intelligence.totalFindings ?? 'unknown'}, critical=${intelligence.criticalCount ?? 'unknown'}, high=${intelligence.highCount ?? 'unknown'}`,
        '',
        `Question: ${question}`,
        '',
        'File context:',
        context || '[No extractable text was available from this file.]'
    ].join('\n');

    const brain = system?.quadBrain || system?.brain || system?.somArbiter;
    if (brain?.reason) {
        const result = await reasonGrounded(brain, prompt, {
            system,
            context: { quickResponse: false, source: 'axis_project_file', projectId: file.projectId, fileId: file.id },
            forceContext: true
        });
        return result?.text || result?.message || result?.response || '';
    }

    const lower = String(question || '').toLowerCase();
    const lines = String(content || '').split(/\r?\n/).filter(Boolean);
    const terms = lower.split(/[^a-z0-9]+/).filter(t => t.length > 3);
    const hits = lines.filter(line => terms.some(term => line.toLowerCase().includes(term))).slice(0, 8);
    if (hits.length) {
        return `I found ${hits.length} matching line(s) in ${enriched.originalName}:\n\n${hits.map(line => `- ${line.slice(0, 240)}`).join('\n')}`;
    }
    return `I can see ${enriched.originalName}, but I do not have enough extracted context to answer that from this file. Try re-indexing the file or asking about a visible sheet, column, section, or term.`;
}

async function answerProjectFilesQuestion(system, { files = [], project, question, selectedFileId = null }) {
    const enrichedFiles = files.map(enrichFileRecord);
    const selected = selectedFileId ? files.find(file => file.id === selectedFileId) : null;
    const ordered = [
        ...(selected ? [selected] : []),
        ...files.filter(file => file.id !== selectedFileId),
    ].slice(0, 10);

    const contexts = [];
    for (const file of ordered) {
        const enriched = enrichFileRecord(file);
        const content = await extractIndexableContent(file).catch(() => '');
        const snippet = textSnippetsForQuestion(content, question, selected?.id === file.id ? 9000 : 4500);
        contexts.push([
            `File: ${enriched.originalName}`,
            `ID: ${file.id}`,
            `Extension: ${fileExt(enriched.originalName || enriched.path)}`,
            `Indexed: ${file.intelligence?.indexed ? 'yes' : 'no'} (${file.intelligence?.indexingStatus || 'unknown'})`,
            `Excel findings: total=${file.intelligence?.totalFindings ?? 'unknown'}, critical=${file.intelligence?.criticalCount ?? 'unknown'}, high=${file.intelligence?.highCount ?? 'unknown'}`,
            'Context:',
            snippet || '[No extractable text was available from this file.]',
        ].join('\n'));
    }

    const prompt = [
        'You are SOMA inside Axis Projects, acting as a mini File Intelligence system for one project.',
        'Answer using only the uploaded project files, file metadata, and project context below.',
        'If the answer is not present in the files, say that directly and recommend the next file, upload, scan, or check.',
        'Be concrete. Cite file names when making claims. Do not invent facts.',
        '',
        `Project: ${project?.name || project?.id || 'Unknown project'}`,
        `Project description: ${project?.description || ''}`,
        `Uploaded files: ${enrichedFiles.map(file => file.originalName).join(', ') || 'none'}`,
        selected ? `Selected file focus: ${enrichFileRecord(selected).originalName}` : 'Selected file focus: none',
        '',
        `Question: ${question}`,
        '',
        contexts.length ? contexts.join('\n\n--- project file boundary ---\n\n') : '[No uploaded files are available for this project.]'
    ].join('\n');

    const brain = system?.quadBrain || system?.brain || system?.somArbiter;
    if (brain?.reason) {
        const result = await reasonGrounded(brain, prompt, {
            system,
            context: { quickResponse: false, source: 'axis_project_file_intelligence', projectId: project?.id, selectedFileId },
            forceContext: true
        });
        return result?.text || result?.message || result?.response || '';
    }

    const terms = String(question || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3);
    const hits = [];
    for (const file of ordered) {
        const content = await extractIndexableContent(file).catch(() => '');
        const lines = String(content || '').split(/\r?\n/).filter(Boolean);
        const fileHits = lines.filter(line => terms.some(term => line.toLowerCase().includes(term))).slice(0, 4);
        if (fileHits.length) hits.push({ file: enrichFileRecord(file).originalName, lines: fileHits });
        if (hits.length >= 5) break;
    }
    if (hits.length) {
        return hits.map(hit => `${hit.file}:\n${hit.lines.map(line => `- ${line.slice(0, 220)}`).join('\n')}`).join('\n\n');
    }
    return files.length
        ? 'I can see the project files, but I did not find enough matching extracted context to answer that. Try indexing the files, asking about a specific file, or uploading the missing source document.'
        : 'This project does not have uploaded files yet. Upload files first, then I can search, summarize, compare, or prepare exports from them.';
}

// ── JSON file helpers ─────────────────────────────────────────────────────────

async function readJSON(file, fallback = []) {
    try {
        const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

async function writeJSON(file, data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── Router ────────────────────────────────────────────────────────────────────

export default function createWorkspaceRoutes(_system) {
    const router = express.Router();

    // ── Projects ──────────────────────────────────────────────────────────────

    router.get('/projects', async (_req, res) => {
        const projects = await readJSON('projects.json');
        res.json({ ok: true, projects });
    });

    router.post('/projects', async (req, res) => {
        const { name, description, status = 'active', color = '#00aaff', icon = '◈' } = req.body;
        if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
        const projects = await readJSON('projects.json');
        const project = {
            id:          `proj-${Date.now()}`,
            name:        name.trim(),
            description: description?.trim() || '',
            status,
            color,
            icon,
            createdAt:   Date.now(),
            updatedAt:   Date.now(),
        };
        projects.push(project);
        await writeJSON('projects.json', projects);
        res.json({ ok: true, project });
    });

    router.get('/projects/:id', async (req, res) => {
        const projects = await readJSON('projects.json');
        const project  = projects.find(p => p.id === req.params.id);
        if (!project) return res.status(404).json({ ok: false, error: 'not found' });
        res.json({ ok: true, project });
    });

    router.put('/projects/:id', async (req, res) => {
        const projects = await readJSON('projects.json');
        const idx      = projects.findIndex(p => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' });
        projects[idx]  = { ...projects[idx], ...req.body, id: req.params.id, updatedAt: Date.now() };
        await writeJSON('projects.json', projects);
        res.json({ ok: true, project: projects[idx] });
    });

    router.delete('/projects/:id', async (req, res) => {
        const projects = await readJSON('projects.json');
        await writeJSON('projects.json', projects.filter(p => p.id !== req.params.id));
        // Clean up tasks and files
        const tasks = await readJSON('tasks.json');
        await writeJSON('tasks.json', tasks.filter(t => t.projectId !== req.params.id));
        const files = await readJSON('files.json');
        const removed = files.filter(f => f.projectId === req.params.id);
        await writeJSON('files.json', files.filter(f => f.projectId !== req.params.id));
        for (const f of removed) {
            try { await fs.unlink(safeFilePath(f)); } catch {}
        }
        try { await fs.rm(projectFilesDir(req.params.id), { recursive: true, force: true }); } catch {}
        res.json({ ok: true });
    });

    // ── Tasks ─────────────────────────────────────────────────────────────────

    router.get('/projects/:id/tasks', async (req, res) => {
        const tasks = await readJSON('tasks.json');
        res.json({ ok: true, tasks: tasks.filter(t => t.projectId === req.params.id) });
    });

    router.post('/projects/:id/tasks', async (req, res) => {
        const { title, assignee = '', priority = 'medium', dueDate = null } = req.body;
        if (!title?.trim()) return res.status(400).json({ ok: false, error: 'title required' });
        const tasks = await readJSON('tasks.json');
        const task  = {
            id:        `task-${Date.now()}`,
            projectId: req.params.id,
            title:     title.trim(),
            assignee,
            priority,
            dueDate,
            done:      false,
            createdAt: Date.now(),
        };
        tasks.push(task);
        await writeJSON('tasks.json', tasks);
        res.json({ ok: true, task });
    });

    router.put('/tasks/:id', async (req, res) => {
        const tasks = await readJSON('tasks.json');
        const idx   = tasks.findIndex(t => t.id === req.params.id);
        if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' });
        tasks[idx]  = { ...tasks[idx], ...req.body, id: req.params.id };
        await writeJSON('tasks.json', tasks);
        res.json({ ok: true, task: tasks[idx] });
    });

    router.delete('/tasks/:id', async (req, res) => {
        const tasks = await readJSON('tasks.json');
        await writeJSON('tasks.json', tasks.filter(t => t.id !== req.params.id));
        res.json({ ok: true });
    });

    // ── Files ─────────────────────────────────────────────────────────────────

    router.get('/projects/:id/files', async (req, res) => {
        const files = await readJSON('files.json');
        res.json({ ok: true, files: files.filter(f => f.projectId === req.params.id).map(enrichFileRecord) });
    });

    router.post('/projects/:id/files/ask', async (req, res) => {
        const question = String(req.body?.question || req.body?.message || '').trim();
        if (!question) return res.status(400).json({ ok: false, error: 'question required' });
        const selectedFileId = req.body?.selectedFileId ? String(req.body.selectedFileId) : null;
        try {
            const allFiles = await readJSON('files.json');
            const files = allFiles.filter(f => f.projectId === req.params.id);
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === req.params.id) || axisStore.getProject(req.params.id) || { id: req.params.id };
            const answer = await answerProjectFilesQuestion(_system, { files, project, question, selectedFileId });
            const audit = appendAudit(_system, {
                actor: actorFromReq(req),
                action: 'axis_project_files_ask',
                metadata: {
                    projectId: req.params.id,
                    selectedFileId,
                    fileCount: files.length,
                    question: question.slice(0, 500),
                    answerChars: String(answer || '').length,
                },
            });
            try {
                axisStore.addProjectActivity({
                    projectId: req.params.id,
                    actorId: axisUserFromReq(req).userId,
                    actorName: axisUserFromReq(req).userName,
                    action: 'project.files_question',
                    targetType: 'project_files',
                    targetId: req.params.id,
                    summary: `Asked SOMA about ${files.length} project file${files.length === 1 ? '' : 's'}`,
                    metadata: { question: question.slice(0, 240), selectedFileId, audit: audit ? { idx: audit.idx, hash: audit.entry_hash } : null },
                });
            } catch {}
            res.json({
                ok: true,
                answer,
                files: files.map(enrichFileRecord),
                selectedFileId,
                ledger: audit ? { idx: audit.idx, hash: audit.entry_hash, timestamp: audit.timestamp } : null,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/projects/:id/brief', async (req, res) => {
        try {
            const allFiles = await readJSON('files.json');
            const files = allFiles.filter(f => f.projectId === req.params.id);
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === req.params.id) || axisStore.getProject(req.params.id) || { id: req.params.id, name: req.params.id };
            const activity = (() => { try { return axisStore.getProjectActivity(req.params.id, 80); } catch { return []; } })();
            const tasks = (() => { try { return axisStore.getTasks(req.params.id, {}); } catch { return []; } })();
            const decisions = activity.filter(row => row.action === 'project.decision_pinned').slice(0, 8);
            const filesSummary = files.map(enrichFileRecord).map(file => {
                const intel = file.intelligence || {};
                return `${file.originalName} (${file.ext || 'file'}, ${Math.round(Number(file.size || 0) / 1024)}KB, ${intel.indexingStatus || 'unknown'}, findings:${intel.totalFindings || 0})`;
            }).join('\n');
            const ask = [
                'Create a concise project collaboration brief for Axis Projects.',
                'Use only the project, files, tasks, decisions, and activity context below.',
                'Include: current state, risks, missing information, next actions, and useful file evidence.',
                'Do not invent progress. Keep it operational and concrete.',
                '',
                `Project: ${project.name || project.id}`,
                `Description: ${project.description || project.summary || ''}`,
                '',
                `Files:\n${filesSummary || 'No uploaded files.'}`,
                '',
                `Tasks:\n${tasks.slice(0, 20).map(t => `- ${t.title} [${t.status || 'todo'}] ${t.assignee_name || 'Unassigned'}`).join('\n') || 'No tasks.'}`,
                '',
                `Decisions:\n${decisions.map(d => `- ${d.summary}`).join('\n') || 'No pinned decisions.'}`,
                '',
                `Recent activity:\n${activity.slice(0, 12).map(a => `- ${a.action}: ${a.summary || a.target_id || ''}`).join('\n') || 'No activity.'}`,
            ].join('\n');
            let brief = '';
            const brain = _system?.quadBrain || _system?.brain || _system?.somArbiter;
            if (brain?.reason) {
                const result = await reasonGrounded(brain, ask, {
                    system: _system,
                    context: { quickResponse: false, source: 'axis_project_brief', projectId: req.params.id },
                    forceContext: true
                });
                brief = result?.text || result?.message || result?.response || '';
            }
            if (!brief) {
                const openTasks = tasks.filter(t => (t.status || 'todo') !== 'done');
                const blocked = tasks.filter(t => t.status === 'blocked');
                const unindexed = files.filter(f => !(f.intelligence?.indexed || f.intelligence?.indexingStatus === 'indexed'));
                brief = [
                    `Project brief for ${project.name || project.id}`,
                    '',
                    `State: ${files.length} file(s), ${openTasks.length} open task(s), ${decisions.length} pinned decision(s).`,
                    blocked.length ? `Risk: ${blocked.length} blocked task(s) need review.` : 'Risk: no blocked tasks recorded.',
                    unindexed.length ? `Evidence gap: ${unindexed.length} file(s) are not searchable yet.` : 'Evidence: uploaded files are searchable where supported.',
                    '',
                    'Next actions:',
                    ...openTasks.slice(0, 4).map(t => `- ${t.title}`),
                    ...(openTasks.length ? [] : ['- Create the next concrete task.']),
                ].join('\n');
            }
            const audit = appendAudit(_system, {
                actor: actorFromReq(req),
                action: 'axis_project_brief',
                metadata: { projectId: req.params.id, fileCount: files.length, taskCount: tasks.length, decisionCount: decisions.length },
            });
            try {
                axisStore.addProjectActivity({
                    projectId: req.params.id,
                    actorId: axisUserFromReq(req).userId,
                    actorName: axisUserFromReq(req).userName,
                    action: 'project.brief_generated',
                    targetType: 'project',
                    targetId: req.params.id,
                    summary: `SOMA brief generated for ${project.name || req.params.id}`,
                    metadata: { audit: audit ? { idx: audit.idx, hash: audit.entry_hash } : null },
                });
            } catch {}
            res.json({ ok: true, brief, ledger: audit ? { idx: audit.idx, hash: audit.entry_hash, timestamp: audit.timestamp } : null });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/projects/:id/files/smart-workbook', async (req, res) => {
        try {
            const allFiles = await readJSON('files.json');
            const files = allFiles.filter(f => f.projectId === req.params.id);
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === req.params.id) || axisStore.getProject(req.params.id) || { id: req.params.id, name: req.params.id };
            const { buffer } = await buildProjectSmartWorkbook({ project, files, system: _system });
            const base = String(project.name || project.id || 'project').replace(/[^a-zA-Z0-9._-]/g, '_');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="AXIS_Project_Intelligence_${base}.xlsx"`);
            res.send(buffer);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/projects/:id/files', upload.single('file'), async (req, res) => {
        const access = canManageProject(req.params.id, req);
        if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
        if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });
        const files = await readJSON('files.json');
        const now = Date.now();
        const filePath = safeFilePath(req.file.filename, req.params.id);
        const checksum = await sha256File(filePath);
        const previousVersions = files.filter(f =>
            f.projectId === req.params.id
            && String(f.originalName || '').toLowerCase() === String(req.file.originalname || '').toLowerCase()
        );
        const version = previousVersions.reduce((max, f) => Math.max(max, Number(f.version || 1)), 0) + 1;
        const entry = {
            id:           uid('file'),
            projectId:    req.params.id,
            projectDir:   req.params.id,
            originalName: req.file.originalname,
            storedName:   req.file.filename,
            size:         req.file.size,
            mimetype:     req.file.mimetype,
            ext:          fileExt(req.file.originalname),
            checksum,
            version,
            uploadedAt:   now,
            updatedAt:    now,
            uploadedBy:   actorFromReq(req),
            intelligence: {
                indexed: false,
                indexingStatus: 'pending',
                indexedAt: null,
                indexError: null,
                documentId: null,
                excelAnalyzed: false,
                lastScanAt: null,
                totalFindings: null,
                criticalCount: null,
                highCount: null,
            },
        };
        files.push(entry);
        await writeJSON('files.json', files);
        try {
            axisStore.addProjectActivity({
                projectId: req.params.id,
                actorId: access.user.userId,
                actorName: access.user.userName,
                action: 'project.file_uploaded',
                targetType: 'file',
                targetId: entry.id,
                summary: `File uploaded: ${entry.originalName}`,
                metadata: { size: entry.size, version, checksum },
            });
        } catch {}
        const enriched = enrichFileRecord(entry);
        const audit = appendAudit(_system, {
            actor: actorFromReq(req),
            action: 'axis_project_file_upload',
            filePath: enriched.path,
            metadata: {
                projectId: req.params.id,
                fileId: entry.id,
                originalName: entry.originalName,
                version,
                size: entry.size,
                checksum,
            },
        });
        let indexedFile = entry;
        try {
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === req.params.id) || null;
            const indexResult = await indexProjectFile(_system, entry, project);
            const currentFiles = await readJSON('files.json');
            const updated = updateFileById(currentFiles, entry.id, file => ({
                ...file,
                intelligence: {
                    ...(file.intelligence || {}),
                    indexed: !!indexResult.ok,
                    indexingStatus: indexResult.ok ? 'indexed' : (indexResult.skipped ? 'skipped' : 'failed'),
                    indexedAt: indexResult.ok ? Date.now() : null,
                    indexError: indexResult.ok ? null : indexResult.error,
                    documentId: indexResult.documentId || null,
                    indexedChars: indexResult.chars || 0,
                },
            }));
            await writeJSON('files.json', updated.files);
            indexedFile = updated.file || entry;
            if (indexResult.ok) {
                appendAudit(_system, {
                    actor: 'SOMA',
                    action: 'axis_project_file_index',
                    filePath: enriched.path,
                    metadata: {
                        projectId: req.params.id,
                        fileId: entry.id,
                        documentId: indexResult.documentId,
                        chars: indexResult.chars,
                        checksum,
                    },
                });
            }
        } catch (e) {
            const currentFiles = await readJSON('files.json');
            const updated = updateFileById(currentFiles, entry.id, file => ({
                ...file,
                intelligence: {
                    ...(file.intelligence || {}),
                    indexed: false,
                    indexingStatus: 'failed',
                    indexedAt: null,
                    indexError: e.message,
                },
            }));
            await writeJSON('files.json', updated.files);
            indexedFile = updated.file || entry;
        }
        res.json({ ok: true, file: { ...enrichFileRecord(indexedFile), audit: audit ? { idx: audit.idx, hash: audit.entry_hash, timestamp: audit.timestamp } : null } });
    });

    router.post('/files/:id/index', async (req, res) => {
        const files = await readJSON('files.json');
        const idx = files.findIndex(f => f.id === req.params.id);
        const file = files[idx];
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        const access = canManageProject(file.projectId, req);
        if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
        try {
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === file.projectId) || null;
            const indexResult = await indexProjectFile(_system, file, project);
            const updated = updateFileById(files, file.id, current => ({
                ...current,
                intelligence: {
                    ...(current.intelligence || {}),
                    indexed: !!indexResult.ok,
                    indexingStatus: indexResult.ok ? 'indexed' : (indexResult.skipped ? 'skipped' : 'failed'),
                    indexedAt: indexResult.ok ? Date.now() : null,
                    indexError: indexResult.ok ? null : indexResult.error,
                    documentId: indexResult.documentId || null,
                    indexedChars: indexResult.chars || 0,
                },
            }));
            await writeJSON('files.json', updated.files);
            if (indexResult.ok) {
                appendAudit(_system, {
                    actor: actorFromReq(req),
                    action: 'axis_project_file_reindex',
                    filePath: enrichFileRecord(file).path,
                    metadata: {
                        projectId: file.projectId,
                        fileId: file.id,
                        documentId: indexResult.documentId,
                        chars: indexResult.chars,
                        checksum: file.checksum,
                    },
                });
            }
            res.json({ ok: !!indexResult.ok, file: enrichFileRecord(updated.file), ...indexResult });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/files/:id/download', async (req, res) => {
        const files = await readJSON('files.json');
        const idx = files.findIndex(f => f.id === req.params.id);
        const file  = files[idx];
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        const filePath = safeFilePath(file);
        files[idx] = { ...file, lastDownloadedAt: Date.now(), downloadCount: Number(file.downloadCount || 0) + 1 };
        await writeJSON('files.json', files);
        appendAudit(_system, {
            actor: actorFromReq(req),
            action: 'axis_project_file_download',
            filePath,
            metadata: { projectId: file.projectId, fileId: file.id, originalName: file.originalName, version: file.version || 1 },
        });
        res.download(filePath, file.originalName);
    });

    router.post('/files/:id/analyze', async (req, res) => {
        const files = await readJSON('files.json');
        const idx = files.findIndex(f => f.id === req.params.id);
        const file = files[idx];
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        const enriched = enrichFileRecord(file);
        if (!/\.(xlsx|xls)$/i.test(enriched.originalName || enriched.path || '')) {
            return res.status(400).json({ ok: false, error: 'Only Excel workbooks can use this analyzer.' });
        }

        try {
            const { ExcelAnalyzer } = await import('../finance/ExcelAnalyzer.js');
            const { ReportGenerator } = await import('../finance/ReportGenerator.js');
            const analysis = new ExcelAnalyzer({ varianceThreshold: req.body?.varianceThreshold ?? 0.01 }).analyze(enriched.path);
            const filename = enriched.originalName || path.basename(enriched.path);
            const markdownReport = new ReportGenerator().toMarkdown(analysis, { filename, preparedFor: req.body?.preparedFor });
            const audit = appendAudit(_system, {
                actor: actorFromReq(req),
                action: 'axis_project_excel_analysis',
                filePath: enriched.path,
                metadata: {
                    projectId: file.projectId,
                    fileId: file.id,
                    originalName: file.originalName,
                    version: file.version || 1,
                    checksum: file.checksum,
                    totalFindings: analysis.totalFindings,
                    criticalCount: analysis.criticalCount,
                    highCount: analysis.highCount,
                },
            });

            files[idx] = {
                ...file,
                intelligence: {
                    ...(file.intelligence || {}),
                    excelAnalyzed: true,
                    lastScanAt: Date.now(),
                    totalFindings: analysis.totalFindings || 0,
                    criticalCount: analysis.criticalCount || 0,
                    highCount: analysis.highCount || 0,
                    ledger: audit ? { idx: audit.idx, hash: audit.entry_hash, timestamp: audit.timestamp } : null,
                },
            };
            await writeJSON('files.json', files);

            res.json({
                ok: true,
                file: enrichFileRecord(files[idx]),
                totalFindings: analysis.totalFindings || 0,
                criticalCount: analysis.criticalCount || 0,
                highCount: analysis.highCount || 0,
                markdownReport,
                ledger: audit ? { idx: audit.idx, hash: audit.entry_hash, timestamp: audit.timestamp } : null,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/files/:id/report', async (req, res) => {
        const files = await readJSON('files.json');
        const file = files.find(f => f.id === req.params.id);
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        const enriched = enrichFileRecord(file);
        if (!/\.(xlsx|xls)$/i.test(enriched.originalName || enriched.path || '')) {
            return res.status(400).json({ ok: false, error: 'Only Excel workbooks can generate reports.' });
        }
        try {
            const { ExcelAnalyzer } = await import('../finance/ExcelAnalyzer.js');
            const { ReportGenerator } = await import('../finance/ReportGenerator.js');
            const analysis = new ExcelAnalyzer().analyze(enriched.path);
            const html = new ReportGenerator().toHTML(analysis, {
                filename: enriched.originalName || path.basename(enriched.path),
                preparedFor: req.query.preparedFor || '',
                preparedBy: 'SOMA Axis Project Intelligence',
            });
            const safeName = String(enriched.originalName || 'workbook').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.(xlsx|xls)$/i, '');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="AXIS_Project_Report_${safeName}.html"`);
            res.send(html);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/files/:id/smart-workbook', async (req, res) => {
        const files = await readJSON('files.json');
        const file = files.find(f => f.id === req.params.id);
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        try {
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === file.projectId) || null;
            const { buffer } = await buildSmartWorkbook({ file, project, system: _system });
            const base = String(file.originalName || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="AXIS_Smart_Workbook_${base}_v${file.version || 1}.xlsx"`);
            res.send(buffer);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/files/:id/ask', async (req, res) => {
        const files = await readJSON('files.json');
        const file = files.find(f => f.id === req.params.id);
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        const question = String(req.body?.question || req.body?.message || '').trim();
        if (!question) return res.status(400).json({ ok: false, error: 'question required' });
        try {
            const projects = await readJSON('projects.json');
            const project = projects.find(p => p.id === file.projectId) || axisStore.getProject(file.projectId) || null;
            const answer = await answerProjectFileQuestion(_system, { file, project, question });
            const audit = appendAudit(_system, {
                actor: actorFromReq(req),
                action: 'axis_project_file_ask',
                filePath: enrichFileRecord(file).path,
                metadata: {
                    projectId: file.projectId,
                    fileId: file.id,
                    originalName: file.originalName,
                    question: question.slice(0, 500),
                    answerChars: String(answer || '').length,
                },
            });
            try {
                axisStore.addProjectActivity({
                    projectId: file.projectId,
                    actorId: axisUserFromReq(req).userId,
                    actorName: axisUserFromReq(req).userName,
                    action: 'project.file_question',
                    targetType: 'file',
                    targetId: file.id,
                    summary: `Asked SOMA about ${file.originalName}`,
                    metadata: { question: question.slice(0, 240), audit: audit ? { idx: audit.idx, hash: audit.entry_hash } : null },
                });
            } catch {}
            res.json({
                ok: true,
                answer,
                file: enrichFileRecord(file),
                ledger: audit ? { idx: audit.idx, hash: audit.entry_hash, timestamp: audit.timestamp } : null,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.delete('/files/:id', async (req, res) => {
        const files = await readJSON('files.json');
        const file  = files.find(f => f.id === req.params.id);
        if (!file) return res.status(404).json({ ok: false, error: 'not found' });
        const access = canManageProject(file.projectId, req);
        if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
        const filePath = safeFilePath(file);
        try { await fs.unlink(filePath); } catch {}
        await writeJSON('files.json', files.filter(f => f.id !== req.params.id));
        appendAudit(_system, {
            actor: actorFromReq(req),
            action: 'axis_project_file_delete',
            filePath,
            metadata: { projectId: file.projectId, fileId: file.id, originalName: file.originalName, version: file.version || 1, checksum: file.checksum },
        });
        try {
            axisStore.addProjectActivity({
                projectId: file.projectId,
                actorId: access.user.userId,
                actorName: access.user.userName,
                action: 'project.file_deleted',
                targetType: 'file',
                targetId: file.id,
                summary: `File deleted: ${file.originalName}`,
                metadata: { version: file.version || 1, checksum: file.checksum },
            });
        } catch {}
        res.json({ ok: true });
    });

    return router;
}
