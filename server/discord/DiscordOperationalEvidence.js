import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redactText } from '../../core/RedactionUtils.js';
import { generateArchitectureReport } from '../../core/StructuredArchitectureAudit.js';

// These handlers report observations, never create goals or execute source code.
export function improvementStatusReply(system = {}) {
    const kernel = system.asiKernel?.getStatus?.();
    const director = system.selfEvolutionDirector?.getStatus?.();
    if (!kernel || !director) return 'I cannot verify my self-improvement status right now: the live cycle or experiment service is unavailable. I should not claim progress without those records.';
    const latest = director.recent?.at(-1);
    const cycle = system.asiKernel?.getCycles?.(1)?.at(-1);
    const admission = cycle?.phases?.execute?.admission;
    const goals = system.goalPlanner?.goals instanceof Map ? [...system.goalPlanner.goals.values()] : [];
    const activeMission = goals.find(goal => goal.status === 'active' && goal.metadata?.source === 'autonomous_mission_director');
    const lines = [
        `I checked the live self-improvement records (${new Date().toISOString()}).`,
        `Retained verified improvements in the recorded cycle window: ${Number(kernel.successCycles) || 0}. Active experiments: ${director.active?.length || 0}.`,
        `Latest cycle: ${kernel.lastResult || 'none recorded'}; waiting for execution: ${Number(kernel.pendingCycles) || 0}; waiting for admission: ${Number(kernel.awaitingApproval) || 0}.`,
    ];
    if (latest) lines.push(`Last experiment: ${latest.id} — ${latest.state}${latest.reason ? ` (${String(latest.reason).slice(0, 350)})` : ''}.`);
    if (admission?.reason) lines.push(`Admission: ${admission.reason}.`);
    if (activeMission && /deferred|pending_approval/.test(kernel.lastResult || '')) lines.push(`Current autonomous mission: ${activeMission.title} (${activeMission.id}).`);
    if (!kernel.successCycles) lines.push('Research, queued proposals and a rolled-back patch are not a retained improvement. I have no verified gain to report from this window.');
    return redactText(lines.join('\n')).slice(0, 1850);
}

export function isCodebaseInspectionRequest(input = '') {
    const text = String(input);
    if (/\b(?:change|edit|fix|patch|modify|delete|implement|rewrite)\b/i.test(text)) return false;
    const hasVerb = /\b(?:look (?:at|through)|inspect|review|read|check|audit|analyze|evaluate|examine|survey|explore)\b/i.test(text);
    const hasTarget = /\b(?:code\s*base|repo(?:sitory)?|source(?: code)?|architecture|system|design|components?|weaknesses?|shortfalls?)\b/i.test(text);
    return hasVerb && hasTarget;
}

export function isMaxFolderInspectionRequest(input = '') {
    const text = String(input || '');
    return /\bmax(?:['’]s)?\b/i.test(text)
        && /\b(?:open|show|list|look|inspect|review|read|see|rundown|explore)\b/i.test(text)
        && /\b(?:folder|directory|repo|files?|contents?|changes?|updates?|additions?|today|built|worked on|it)\b/i.test(text);
}

export async function inspectProjectFolder({ root, project = 'MAX', now = new Date() }) {
    const realRoot = await fs.realpath(root);
    const stat = await fs.stat(realRoot);
    if (!stat.isDirectory()) throw new Error(`${project} path is not a directory`);
    const excluded = new Set(['.git', '.env', '.max', '.soma', 'node_modules', 'data', 'logs', 'dist', 'build']);
    const top = (await fs.readdir(realRoot, { withFileTypes: true }))
        .filter(entry => !excluded.has(entry.name.toLowerCase()) && !entry.isSymbolicLink())
        .map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`).sort();
    const matches = [];
    for (const folder of ['core', 'server', 'scripts', 'tests', 'simulation', 'simulations', 'tools']) {
        const directory = path.join(realRoot, folder);
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            if (!entry.isFile() || !/(?:simulat|rsi|self.?improv|bee|market|research)/i.test(entry.name)
                || !/\.(?:[cm]?js|py|ts|md)$/i.test(entry.name)) continue;
            const file = path.join(directory, entry.name);
            const detail = await fs.stat(file);
            matches.push({ path: `${folder}/${entry.name}`, modifiedAt: detail.mtime.toISOString(), bytes: detail.size });
        }
    }
    matches.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
    const recent = matches.slice(0, 8);
    return { root: realRoot, project, top, recent,
        reply: redactText([
            `I listed the ${project} folder at ${realRoot} (${new Date(now).toISOString()}).`,
            `Top level: ${top.slice(0, 35).join(', ') || 'empty'}.`,
            `Relevant source files by modification time: ${recent.length
                ? recent.map(item => `${item.path} (${item.modifiedAt}, ${item.bytes} bytes)`).join('; ')
                : 'none in the bounded scan'}.`,
            'These are filesystem observations. Modification times do not prove what changed, passed tests, or improved RSI. No job was started and no code was changed.'
        ].join('\n')).slice(0, 1850) };
}

export function resolveInspectionProject(input, history = [], { userId, now = Date.now() } = {}) {
    const explicit = text => /\bmax(?:['’]s|s)?\b/i.test(text) ? 'MAX' : /\b(?:soma(?:['’]s)?|your (?:code\s*base|repo|source))\b/i.test(text) ? 'SOMA' : null;
    if (explicit(input)) return explicit(input);
    if (!/\b(?:his|her|its|that|the)\b/i.test(input)) return null;
    // Only this human's recent messages establish a referent. Bot claims aren't evidence.
    for (const row of history.slice(-8).reverse()) {
        const timestamp = row.createdAt;
        if (row.bot || row.authorId !== userId || !Number.isFinite(timestamp) || now - timestamp > 30 * 60_000 || timestamp > now) continue;
        if (/\b(?:another|other) (?:project|repo)|\b(?:project|repo) (?:called|named)\b/i.test(row.content)) return null;
        const project = explicit(row.content);
        if (project) return project;
    }
    return null;
}

const inside = (root, target) => { const rel = path.relative(root, target); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };

export async function inspectImprovementCodebase({ root, project, query = '' }) {
    if (/\b(?:architecture|weaknesses?|shortfalls?|flaws?|bottlenecks?)\b/i.test(query)) {
        const audit = await generateArchitectureReport({ root, project, query });
        return {
            reads: audit.findings.map(f => ({ path: f.filePath, lineNumbers: f.lineNumbers, findingId: f.id })),
            findings: audit.findings,
            reply: redactText(audit.reportText)
        };
    }
    const realRoot = await fs.realpath(root);
    const files = [];
    for (const folder of ['core', 'server', 'arbiters']) {
        const directory = path.join(realRoot, folder);
        let realDirectory;
        try { realDirectory = await fs.realpath(directory); } catch { continue; }
        if (!inside(realRoot, realDirectory)) continue;
        for (const entry of await fs.readdir(realDirectory, { withFileTypes: true })) {
            if ((entry.isFile() || entry.isSymbolicLink()) && /(?:self.?improv|self.?evol|self.?repair|self.?editor|reflectionengine|asikernel)/i.test(entry.name) && /\.(?:[cm]?js|ts)$/i.test(entry.name)) files.push(`${folder}/${entry.name}`);
        }
    }
    files.sort((a, b) => /SelfImprovement(?:Loop|Engine)/.test(b) - /SelfImprovement(?:Loop|Engine)/.test(a) || a.localeCompare(b));
    const reads = [];
    for (const file of files.slice(0, 4)) {
        const filename = await fs.realpath(path.join(realRoot, file));
        if (!inside(realRoot, filename)) continue;
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size > 256_000) continue;
        const content = await fs.readFile(filename, 'utf8');
        const lines = content.split(/\r?\n/);
        const matches = lines.map((line, i) => ({ line, number: i + 1 }))
            .filter(({ line }) => /Would evolve|selfEditor\.commit|selfRepairPipeline|repairPipeline|applyPatch|modify_code|evaluateCompleted|evaluateProbation|async (?:evolve|approve|runCycle)|\/\/ await.*self\.evolve/.test(line)).slice(0, 3);
        reads.push({ path: file, sha256: createHash('sha256').update(content).digest('hex'), lineCount: lines.length, matches });
    }
    if (!reads.length) return { reads, reply: `I checked ${project}'s core/server/arbiters folders, but found no self-improvement entry points in that bounded scan. That does not prove the rest of the repository lacks them. No code was changed.` };
    const excerpts = reads.map(read => `${read.path} (${read.lineCount} lines read)\n${read.matches.length ? read.matches.map(m => `  L${m.number}: ${m.line.trim().slice(0, 105)}`).join('\n') : '  No execution hook matched in this first-pass read.'}`).join('\n').slice(0, 1150);
    const placeholder = reads.some(read => read.matches.some(m => /Would evolve|\/\/ await.*self\.evolve/.test(m.line)));
    return { reads, reply: redactText([
        `I read ${reads.length} self-improvement source files in ${project}.`,
        placeholder ? 'One loop still contains a placeholder: a “Would evolve” log/commented execution call. That path is not evidence of real code improvement.' : 'These are source-level findings, not proof that the loop is running.',
        excerpts,
        'This is a bounded inspection, not a full audit. Next verification: trace startup wiring and completed test/deployment receipts. I have not run tests, queued work or changed code.'
    ].join('\n\n')).slice(0, 1850) };
}
