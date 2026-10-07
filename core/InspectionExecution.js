import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveWithinRoot } from './PathSafety.js';
import { EXECUTION_PROMPT, executionResult, formatToolFeedback, simpleInspectionAction, toolSucceeded } from './ExecutionProtocol.js';
import { globalProcedureStore } from './ProcedureLearningStore.js';

const SOURCE_DIRS = ['core', 'arbiters', 'server', 'shared', 'src', 'scripts', 'config', 'tests', 'docs'];
const SKIP = new Set(['node_modules', '.git', '.soma', 'data', 'SOMA', 'dist', 'build', 'backup', 'vendor']);
const TEXT_FILE = /\.(?:[cm]?js|jsx|tsx?|py|md|txt|html?|css|json)$/i;
const SECRET = /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|[^\\/]*(?:credentials|private[-_]?key|auth[-_]?secret|sessions|security|token)[^\\/]*\.(?:json|txt|key|pem)|\.ssh|\.aws)(?:[\\/]|$)|\.(?:pem|key|p12|pfx)$/i;
const string = { type: 'string', minLength: 1, maxLength: 500 };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

async function safePath(root, candidate, allowRoot = false) {
    if (typeof candidate !== 'string' || SECRET.test(candidate)) throw new Error('Sensitive or invalid inspection path.');
    const absolute = resolveWithinRoot(root, candidate, 'Inspection path', { allowRoot });
    const [realRoot, real] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
    resolveWithinRoot(realRoot, real, 'Real inspection path', { allowRoot });
    if (SECRET.test(real)) throw new Error('Sensitive inspection path.');
    return real;
}

async function walkSources(root, directory, visit) {
    let scanned = 0, truncated = false, stopped = false;
    const started = Date.now();
    async function walk(dir, depth = 0) {
        if (stopped || depth > 12 || scanned >= 6000 || Date.now() - started > 5000) { truncated = true; return; }
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Visit source subdirectories before large flat file collections.
        const candidates = [...entries.filter(e => e.isDirectory()), ...entries.filter(e => e.isFile() && TEXT_FILE.test(e.name))];
        for (const entry of candidates) {
            if (entry.isSymbolicLink() || SECRET.test(entry.name) || SKIP.has(entry.name)) continue;
            if (stopped || scanned >= 6000 || Date.now() - started > 5000) { truncated = true; break; }
            const relative = path.relative(root, path.join(dir, entry.name));
            // Revalidate real paths, including Windows junctions, before reading.
            let real;
            try { real = await safePath(root, relative); } catch { continue; }
            if (entry.isDirectory()) await walk(real, depth + 1);
            else {
                scanned++;
                if (await visit(real, relative) === false) { stopped = true; truncated = true; break; }
            }
        }
    }
    const dir = await safePath(root, directory, true);
    if (path.resolve(dir) === path.resolve(await fs.realpath(root))) {
        for (const name of SOURCE_DIRS) {
            try { await walk(await safePath(root, name)); } catch { /* absent source directory */ }
        }
        if (!stopped) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (stopped || scanned >= 6000 || Date.now() - started > 5000) { truncated = true; break; }
                if (entry.isFile() && TEXT_FILE.test(entry.name) && !SECRET.test(entry.name)) {
                    scanned++;
                    if (await visit(await safePath(root, entry.name), entry.name) === false) { stopped = true; truncated = true; break; }
                }
            }
        }
    } else await walk(dir);
    return { scannedFiles: scanned, truncated, scope: directory === '.' ? ['root files', ...SOURCE_DIRS] : [directory] };
}

export function inspectionTools(root, observations) {
    const receipts = new Set();
    const tools = {
        list_files: {
            readOnly: true, description: 'List a workspace directory. Never reads secret contents.',
            parameters: schema({ directory: string, filter: string }),
            execute: async ({ directory = '.', filter }) => {
                const real = await safePath(root, directory, true);
                const entries = await fs.readdir(real, { withFileTypes: true });
                const visible = entries.filter(e => !SECRET.test(e.name) && !e.isSymbolicLink() && (!filter || e.name.includes(filter)));
                return { success: true, path: directory, files: visible.slice(0, 100).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })), truncated: visible.length > 100 };
            }
        },
        find_files: {
            readOnly: true, description: 'Find a real source file by basename, case-insensitively. Reports bounded search coverage.',
            parameters: schema({ filename: string, directory: string }, ['filename']),
            execute: async ({ filename, directory = '.' }) => {
                const matches = [];
                const coverage = await walkSources(root, directory, async (real, relative) => {
                    if (path.basename(real).toLowerCase() === path.basename(filename).toLowerCase() && matches.length < 40) matches.push(relative);
                });
                return { success: true, matches, ...coverage };
            }
        },
        read_file: {
            readOnly: true, description: 'Read an existing text file within the workspace; basename lookup is supported. Result states exactly which lines were read.',
            parameters: schema({ path: string, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 500 } }, ['path']),
            execute: async ({ path: filename, startLine = 1, endLine, maxLines = 160 }) => {
                let real;
                try { real = await safePath(root, filename); }
                catch (error) {
                    if (error.code !== 'ENOENT' || /[\\/]/.test(filename)) throw error;
                    const found = await tools.find_files.execute({ filename });
                    if (found.matches.length !== 1) throw new Error(found.matches.length ? 'Ambiguous filename; provide the relative path.' : `File not found in inspected source directories: ${filename}`);
                    real = await safePath(root, found.matches[0]);
                }
                const stat = await fs.stat(real);
                if (!stat.isFile() || !TEXT_FILE.test(real) || stat.size > 1024 * 1024) throw new Error('Inspection requires a text file no larger than 1 MiB.');
                const content = await fs.readFile(real, 'utf8');
                const lines = content.split(/\r?\n/);
                if (startLine > lines.length || (endLine !== undefined && endLine < startLine)) throw new Error('Invalid line range.');
                const last = Math.min(endLine || lines.length, startLine + maxLines - 1, lines.length);
                const excerpt = lines.slice(startLine - 1, last).join('\n');
                return { success: true, path: path.relative(root, real), startLine, endLine: last, totalLines: lines.length,
                    content: excerpt.slice(0, 16000), truncated: last < lines.length || startLine > 1 || excerpt.length > 16000,
                    sha256: createHash('sha256').update(content).digest('hex') };
            }
        },
        search_code: {
            readOnly: true, description: 'Literal case-insensitive code/text search in bounded source directories. Empty results only describe the reported scope.',
            parameters: schema({ pattern: string, directory: string, maxResults: { type: 'integer', minimum: 1, maximum: 50 } }, ['pattern']),
            execute: async ({ pattern, directory = '.', maxResults = 20 }) => {
                const matches = [];
                const coverage = await walkSources(root, directory, async (real, relative) => {
                    if (matches.length >= maxResults) return false;
                    if ((await fs.stat(real)).size > 1024 * 1024) return;
                    const lines = (await fs.readFile(real, 'utf8')).split(/\r?\n/);
                    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                        if (lines[i].toLowerCase().includes(pattern.toLowerCase())) matches.push(`${relative}:${i + 1}: ${lines[i].trim().slice(0, 250)}`);
                    }
                    if (matches.length >= maxResults) return false;
                });
                return { success: true, matches, ...coverage, truncated: coverage.truncated || matches.length >= maxResults };
            }
        },
        record_observation: {
            readOnly: true, description: 'Record an inspection summary citing successful TOOL_RESULT receiptId values or findings from THIS execution. Does not prove a code modification.',
            parameters: schema({ summary: { type: 'string', minLength: 1, maxLength: 4000 }, evidence: { type: 'array', minItems: 1, maxItems: 20, items: string } }, ['summary', 'evidence']),
            execute: async ({ summary, evidence }) => {
                const successfulObs = observations.filter(o => o.tool !== 'record_observation' && o.outcome?.ok === true);
                if (successfulObs.length === 0) {
                    throw new Error('Must have at least one successful tool observation before recording observation.');
                }
                const resolvedEvidence = (Array.isArray(evidence) ? evidence : [evidence]).map(idOrFinding => {
                    const match = observations.find(o => o.receiptId === idOrFinding && o.tool !== 'record_observation' && o.outcome?.ok === true);
                    if (match) {
                        return { receiptId: match.receiptId, tool: match.tool, args: match.args, result: match.result };
                    }
                    // Compatibility with small models that copy a literal search
                    // hit instead of its ID: it still must match returned data.
                    const source = successfulObs.find(o => o.result?.matches?.includes(idOrFinding));
                    if (!source) throw new Error('Evidence must reference a successful receipt ID or an exact returned search match from this execution.');
                    return { receiptId: source.receiptId, tool: source.tool, args: source.args, result: source.result };
                });
                const receiptId = randomUUID(); receipts.add(receiptId);
                return { success: true, type: 'inspection', receiptId, summary, evidence: resolvedEvidence };
            }
        }
    };
    return { tools, receipts };
}

export function describeInspection(obs) {
    const r = obs.result;
    if (obs.tool === 'read_file') return `Read ${r.path}, lines ${r.startLine}–${r.endLine} of ${r.totalLines}${r.truncated ? ' (partial)' : ''}.\n${r.content.slice(0, 2500)}`;
    if (obs.tool === 'list_files') return `Files in ${r.path}${r.truncated ? ' (partial listing)' : ''}:\n${r.files.map(f => `${f.name}${f.type === 'dir' ? '/' : ''}`).join('\n')}`;
    const count = r.matches?.length || 0;
    const heading = r.truncated && count === 0
        ? `Partial search: no matches among ${r.scannedFiles || 0} scanned files.`
        : `${count} matches in ${r.scannedFiles || 0} scanned files${r.truncated ? ' (partial search)' : ''}.`;
    return `${heading}\n${(r.matches || []).join('\n')}\nEligible scope: ${(r.scope || []).join(', ')}. This does not establish runtime activation.`;
}

export async function runInspection(executor, goal, { signal } = {}) {
    const observations = [], errors = [], toolsUsed = new Set();
    const session = inspectionTools(executor.inspectionRoot || process.cwd(), observations);
    executor._inspectionSession = session;
    const tools = executor._getToolCollection(goal);
    const manifest = [...tools].map(([name, t]) => ({ name, description: t.description, args: t.parameters || t.args }));
    const task = goal.description || goal.title;
    const simple = simpleInspectionAction(task);
    const started = Date.now();
    let formats = 0, verificationErrors = 0, iterations = 0;

    // Emit initial lifecycle events
    executor.jobStore?.appendEvent(goal.id, { type: 'planning_started', timestamp: Date.now() });
    executor.jobStore?.appendEvent(goal.id, { type: 'execution_started', timestamp: Date.now() });

    const finish = (state, stopReason, summary, receipt) => {
        if (state === 'completed' && receipt) {
            executor.jobStore?.appendEvent(goal.id, { type: 'verification_passed', receiptId: receipt.receiptId, timestamp: Date.now() });
            try {
                globalProcedureStore.recordProcedure({
                    taskType: 'inspect',
                    taskDescription: task,
                    orderedToolSequence: [...toolsUsed],
                    verificationSteps: ['record_observation'],
                    result: summary,
                    durationMs: Date.now() - started,
                    sourceJobId: goal.id
                });
            } catch {}
        } else if (state !== 'completed') {
            executor.jobStore?.appendEvent(goal.id, { type: 'verification_failed', reason: stopReason, errors, timestamp: Date.now() });
        }

        return executionResult({
            state,
            done: state === 'completed',
            stopReason,
            summary,
            iterations,
            toolsUsed: [...toolsUsed],
            toolResults: observations.map((o, idx) => ({
                step: o.step || idx + 1,
                tool: o.tool,
                success: o.outcome?.ok,
                receiptId: o.receiptId,
                result: o.result
            })),
            errors,
            observations,
            evidence: receipt?.evidence || observations.filter(o => o.outcome?.ok && o.tool !== 'record_observation').map(({ tool, args, result, receiptId }) => ({ tool, args, result, receiptId })),
            verification: { passed: !!receipt, status: receipt ? 'verified_inspection_receipts' : 'not_verified', receiptId: receipt?.receiptId || null },
            completionEvidence: receipt ? { passed: true, type: 'inspection', facts: receipt.evidence } : null
        });
    };

    for (; iterations < executor.maxIterations;) {
        if (signal?.aborted) return finish('cancelled', 'operator_cancelled', 'Inspection cancelled.');
        if (Date.now() - started > executor.sessionTimeout) return finish('incomplete', 'session_timeout', 'Inspection reached its time budget.');
        let call;
        const latest = observations.at(-1);
        if (simple) {
            if (!latest) call = simple;
            else if (!latest.outcome?.ok) return finish('failed', 'tool_failed', latest.result.error || 'Inspection tool failed.');
            else if (latest.tool === 'record_observation') return finish('completed', 'inspection_verified', latest.result.summary, latest.result);
            else call = { tool: 'record_observation', args: { summary: describeInspection(latest), evidence: [latest.receiptId] } };
        } else {
            let response;
            try { response = await executor._callDirectAPI(EXECUTION_PROMPT, `INSPECTION TASK (read-only): ${task}\nAVAILABLE TOOLS:\n${JSON.stringify(manifest)}\n${formatToolFeedback(observations)}`, false, { actor: 'SomaAgenticExecutor', action: 'inspection' }); }
            catch (error) { errors.push(error.message); return finish('failed', 'model_unavailable', 'The execution model failed; no completion is established.'); }
            if (signal?.aborted) return finish('cancelled', 'operator_cancelled', 'Inspection cancelled.');
            const text = String(response?.text || response?.response || response || '').trim();
            iterations++;
            const stopped = text.match(/^(BLOCKED|FAILED):\s*([^\n]+)$/i);
            if (stopped) return finish(stopped[1].toLowerCase(), 'model_reported_stop', stopped[2]);
            if (/^DONE:\s*yes\s*\nRESULT:/i.test(text)) {
                const receipt = latest?.tool === 'record_observation' && latest.outcome?.ok && session.receipts.has(latest.result.receiptId) ? latest.result : null;
                if (receipt) return finish('completed', 'inspection_verified', receipt.summary, receipt);
                const error = 'DONE is unverified: first inspect sources, then record_observation with successful receipt IDs.';
                errors.push(error); observations.push({ thought: error });
                if (++verificationErrors >= 2) return finish('failed', 'verification_failed', error);
                continue;
            }
            call = executor._parseToolCall(text, goal);
            if (!call) {
                const error = `${executor._lastToolParseError} Your previous response did not execute an action. Emit one valid TOOL call now, or return BLOCKED: with the exact reason.`;
                errors.push(error); observations.push({ _formatError: true, thought: error });
                if (++formats >= 3) return finish('failed', 'format_repair_exhausted', 'The model did not emit valid tool calls after three corrections.');
                continue;
            }
        }
        if (simple) iterations++;
        let result;
        executor.jobStore?.appendEvent(goal.id, { type: 'tool_started', tool: call.tool, args: call.args, timestamp: Date.now() });
        try { result = await executor._dispatchTool(call, goal); }
        catch (error) { result = { success: false, error: error.message }; }
        toolsUsed.add(call.tool);
        const ok = toolSucceeded(result);
        if (!ok) errors.push(result?.error || `${call.tool} returned failure.`);
        observations.push({ receiptId: randomUUID(), tool: call.tool, args: call.args, result, outcome: { ok }, observedAt: Date.now(), goalId: goal.id });
        executor.jobStore?.appendEvent(goal.id, { type: 'tool_finished', tool: call.tool, success: ok, error: result?.error, timestamp: Date.now() });
        executor.jobStore?.updateJob(goal.id, {
            status: 'executing',
            toolsUsed: [...toolsUsed],
            toolResults: observations.map((o, idx) => ({ step: idx + 1, tool: o.tool, success: o.outcome?.ok, receiptId: o.receiptId })),
            heartbeatAt: Date.now()
        });
    }
    // A deterministic receipt is itself the final host-verified report.
    const last = observations.at(-1);
    if (simple && last?.tool === 'record_observation' && last.outcome?.ok) return finish('completed', 'inspection_verified', last.result.summary, last.result);
    return finish('incomplete', 'max_iterations_reached', 'The step budget ended before verified completion. No background continuation was scheduled.');
}
