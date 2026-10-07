/**
 * Pulse IDE backend — the real plumbing behind the Pulse tab.
 *
 * Before this existed, Pulse called endpoints that 404'd and silently fell
 * back to a hard-coded demo project, fake terminal output, and a preview that
 * waited forever for a server nobody started. Everything here is real:
 *
 *   GET    /api/files/tree?dir=.            one-level directory listing (lazy tree)
 *   GET    /api/files/raw?path=             raw file bytes (images etc.)
 *   POST   /api/pulse/term                  create a terminal session (real PTY)
 *   GET    /api/pulse/term                  list sessions
 *   GET    /api/pulse/term/:id/stream       SSE output stream (scrollback replayed)
 *   POST   /api/pulse/term/:id/input        keystrokes
 *   POST   /api/pulse/term/:id/resize       cols/rows
 *   DELETE /api/pulse/term/:id              kill session
 *   POST   /api/tools/shell/start           start a long-running process (dev server)
 *   GET    /api/tools/shell/processes       managed processes + detected URLs
 *   POST   /api/tools/shell/stop            stop a managed process (whole tree)
 *   GET    /api/pulse/dev-servers           which local ports are actually serving
 *
 * Anything that spawns processes is restricted to loopback callers: SOMA
 * listens on 0.0.0.0, and an interactive shell must not be reachable from LAN.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, execFile, execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import deepSeekGateway from '../core/DeepSeekGateway.js';
import costLedger from '../core/CostLedger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === 'win32';
const WORKSPACE_ROOT = process.cwd();

const TREE_SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', '.cache']);
const SCROLLBACK_LIMIT = 256 * 1024;
const PROCESS_LOG_LIMIT = 128 * 1024;
const IDLE_SESSION_MS = 30 * 60 * 1000;
const PROBE_PORTS = [3000, 3002, 3100, 4173, 4200, 5000, 5173, 5174, 8000, 8080, 8088, 8888, 3001];

let pty = null;
let ptyLoadError = null;
try {
  const requirePty = createRequire(path.join(__dirname, '..', 'pty-host', 'package.json'));
  pty = requirePty('@lydell/node-pty');
} catch (error) {
  ptyLoadError = error.message;
}

function isLoopback(req) {
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function requireLoopback(req, res, next) {
  if (isLoopback(req)) return next();
  res.status(403).json({ success: false, error: 'Pulse terminal/process control is only available from this machine' });
}

function safeResolve(target = '.') {
  const resolved = path.resolve(WORKSPACE_ROOT, String(target || '.'));
  const relative = path.relative(WORKSPACE_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path outside workspace');
  }
  return resolved;
}

function toWorkspacePath(absPath) {
  return path.relative(WORKSPACE_ROOT, absPath).replace(/\\/g, '/') || '.';
}

function appendCapped(buffer, chunk, limit) {
  const next = buffer + chunk;
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
}

// Prefer PowerShell 7 on Windows: 5.1 has no `&&`, which git/npm one-liners rely on.
let windowsShell = null;
function resolveWindowsShell() {
  if (windowsShell) return windowsShell;
  windowsShell = 'powershell.exe';
  try {
    const found = execFileSync('where.exe', ['pwsh'], { windowsHide: true, encoding: 'utf8', timeout: 3000 })
      .split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (found) windowsShell = found;
  } catch {}
  return windowsShell;
}

function defaultShell() {
  if (process.env.PULSE_SHELL) return { file: process.env.PULSE_SHELL, args: [] };
  if (IS_WIN) return { file: resolveWindowsShell(), args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

// ── Terminal sessions ────────────────────────────────────────────────────────
const sessions = new Map();
let sessionSeq = 0;

function broadcastSession(session, event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of session.clients) client.write(frame);
}

function createSession({ cols = 100, rows = 24, cwd } = {}) {
  const id = `t${Date.now().toString(36)}${(++sessionSeq).toString(36)}`;
  const workdir = cwd ? safeResolve(cwd) : WORKSPACE_ROOT;
  const shell = defaultShell();
  const session = {
    id, cwd: workdir, shell: shell.file, backend: pty ? 'pty' : 'pipe',
    scrollback: '', clients: new Set(), exited: false, exitCode: null,
    createdAt: Date.now(), lastActivity: Date.now(), pending: '', flushTimer: null,
  };

  const onOutput = (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    session.scrollback = appendCapped(session.scrollback, text, SCROLLBACK_LIMIT);
    session.pending += text;
    // Coalesce bursts (e.g. npm install) into ~60 frames/sec instead of one per chunk
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => {
        session.flushTimer = null;
        const data = session.pending;
        session.pending = '';
        if (data) broadcastSession(session, { type: 'data', data });
      }, 16);
    }
  };
  const onExit = (code) => {
    session.exited = true;
    session.exitCode = code;
    broadcastSession(session, { type: 'exit', code });
  };

  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  if (pty) {
    const proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color', cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0), cwd: workdir, env,
    });
    proc.onData(onOutput);
    proc.onExit(({ exitCode }) => onExit(exitCode));
    session.write = (data) => proc.write(data);
    session.resize = (c, r) => { try { proc.resize(Math.max(20, c | 0), Math.max(5, r | 0)); } catch {} };
    session.kill = () => { try { proc.kill(); } catch {} killTree(proc.pid); };
    session.pid = proc.pid;
  } else {
    // Degraded fallback: no TTY, so no full-screen apps, but commands, cwd and
    // streaming output still work. The UI labels this mode.
    const args = IS_WIN ? ['-NoLogo', '-NoProfile', '-Command', '-'] : ['-i'];
    const proc = spawn(shell.file, args, { cwd: workdir, env, windowsHide: true });
    proc.stdout.on('data', onOutput);
    proc.stderr.on('data', onOutput);
    proc.on('exit', onExit);
    session.write = (data) => {
      const normalized = String(data).replace(/\r/g, '\n');
      onOutput(normalized.replace(/\n/g, '\r\n'));
      proc.stdin.write(normalized);
    };
    session.resize = () => {};
    session.kill = () => killTree(proc.pid);
    session.pid = proc.pid;
  }

  sessions.set(id, session);
  return session;
}

function describeSession(s) {
  return {
    id: s.id, pid: s.pid, backend: s.backend, shell: s.shell, cwd: toWorkspacePath(s.cwd),
    exited: s.exited, exitCode: s.exitCode, clients: s.clients.size, createdAt: s.createdAt,
  };
}

// ── Managed background processes (dev servers) ──────────────────────────────
const processes = new Map();
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})[^\s'"\x1b]*/i;

function describeProcess(p) {
  return {
    name: p.name, pid: p.pid, command: p.command, cwd: toWorkspacePath(p.cwd),
    status: p.status, exitCode: p.exitCode, url: p.url, startedAt: p.startedAt,
    tail: p.log.slice(-4000),
  };
}

// ── Port probing ─────────────────────────────────────────────────────────────
// Refused ports fail instantly; the timeout only matters for busy servers (SOMA's own
// event loop can take ~1s to answer under load), so keep it generous.
function probePort(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 8192) body += c; });
      res.on('end', () => {
        const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
        const frameBlocked = /deny|sameorigin/i.test(String(res.headers['x-frame-options'] || ''))
          || /frame-ancestors\s+'none'/i.test(String(res.headers['content-security-policy'] || ''));
        resolve({ port, url: `http://localhost:${port}`, status: res.statusCode, title: title?.trim() || null,
          contentType: res.headers['content-type'] || null, frameBlocked });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function findLaunchableProjects() {
  const results = [];
  const visit = (dir, depth) => {
    if (depth > 2 || results.length >= 25) return;
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {};
        const script = ['dev', 'start', 'serve', 'preview'].find((s) => scripts[s]);
        if (script) results.push({ cwd: toWorkspacePath(dir), command: `npm run ${script}`, script: scripts[script] });
      } catch {}
    }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || TREE_SKIP.has(e.name) || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (['dist', 'build', 'data', 'logs', 'hippocampus', 'models', 'SOMA'].includes(e.name)) continue;
      visit(path.join(dir, e.name), depth + 1);
    }
  };
  visit(WORKSPACE_ROOT, 0);
  return results;
}

// ── AI editing helpers ───────────────────────────────────────────────────────
const EDIT_CONTEXT_CHARS = 150_000;   // stays under the gateway's 48K-token human budget
const MESSAGE_CHUNK_CHARS = 22_000;   // gateway compacts any single message over 24K chars

const LOCAL_FIM_MODEL = process.env.PULSE_LOCAL_FIM_MODEL || 'qwen2.5-coder:1.5b-base';
const OLLAMA_URL = (process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434').replace(/\/$/, '').replace('localhost', '127.0.0.1');

// Is the coder model loaded in Ollama right now? /api/ps answers in ~1ms; cached briefly.
let fimWarmCache = { at: 0, warm: false };
async function isLocalFimWarm() {
  if (Date.now() - fimWarmCache.at < 2000) return fimWarmCache.warm;
  let warm = false;
  try {
    const ps = await (await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(500) })).json();
    warm = (ps.models || []).some((m) => m.name === LOCAL_FIM_MODEL || m.model === LOCAL_FIM_MODEL);
  } catch {}
  fimWarmCache = { at: Date.now(), warm };
  return warm;
}

// Reload the coder model without blocking the request. Rate-limited so Pulse doesn't keep
// evicting SOMA's own chat model from the GPU.
let lastFimWarmAttempt = 0;
function warmLocalFimInBackground() {
  if (Date.now() - lastFimWarmAttempt < 60_000) return;
  lastFimWarmAttempt = Date.now();
  fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_FIM_MODEL, prompt: '', keep_alive: '30m' }),
    signal: AbortSignal.timeout(60_000),
  }).then(() => { fimWarmCache = { at: 0, warm: false }; }).catch(() => {});
}

// Qwen2.5-Coder fill-in-the-middle via Ollama. Returns { ok, text } and never throws.
async function localFimCompletion(prefix, suffix, signal) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LOCAL_FIM_MODEL,
        prompt: `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
        raw: true,
        stream: false,
        keep_alive: '30m',
        options: { num_predict: 96, temperature: 0, stop: ['<|endoftext|>', '<|fim_pad|>', '<|file_sep|>', '<|fim_prefix|>', '\n\n\n'] },
      }),
      // Only called when the model is already loaded, so a slow answer means contention: fall back fast
      signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
    });
    if (!response.ok) return { ok: false };
    const data = await response.json();
    return { ok: typeof data.response === 'string', text: data.response || '' };
  } catch {
    return { ok: false };
  }
}

// FIM models sometimes re-emit the text that already follows the cursor
function trimSuffixOverlap(text, suffix) {
  let out = String(text || '');
  const tail = String(suffix || '');
  for (let k = Math.min(out.length, tail.length, 300); k > 0; k--) {
    const piece = tail.slice(0, k);
    if (piece.trim() && out.endsWith(piece)) { out = out.slice(0, -k); break; }
  }
  return out.replace(/\s+$/, (ws) => (ws.includes('\n') ? '' : ws));
}

function gatherEditContext({ activePath, files = [], openFiles = [], buffers = {} }) {
  const paths = [...new Set([activePath, ...files, ...openFiles].filter((p) => typeof p === 'string' && p.trim()))].slice(0, 8);
  const context = [];
  let budget = EDIT_CONTEXT_CHARS;
  for (const p of paths) {
    const rel = p.replace(/\\/g, '/');
    let content = typeof buffers[rel] === 'string' ? buffers[rel] : null; // unsaved editor buffer wins
    if (content == null) {
      try { content = fs.readFileSync(safeResolve(rel), 'utf8'); } catch { content = null; }
    }
    const isPrimary = rel === activePath || files.includes(rel);
    if (content != null && content.length > budget && !isPrimary) content = null; // skip big secondary tabs
    if (content != null) {
      if (content.length > budget) content = content.slice(0, budget);
      budget -= content.length;
    }
    context.push({ path: rel, content, exists: content != null });
  }
  return context;
}

const EDIT_SYSTEM_PROMPT = `You are SOMA's code-editing agent inside the Pulse IDE.
Make the smallest correct change that fulfils the user's instruction. You may change several files or create new ones.
Respond with JSON only, exactly this shape:
{"summary": "one or two plain-English sentences", "edits": [{"path": "...", "blocks": [{"search": "...", "replace": "..."}]}], "creates": [{"path": "...", "content": "..."}]}
Rules:
- "search" must be copied EXACTLY from the file shown (same whitespace and indentation) and must appear exactly once in that file. Include enough surrounding lines to make it unique.
- Never rewrite a whole existing file; use small blocks. Order blocks top-to-bottom.
- Only use functions, imports and APIs that actually exist in the files shown. Do not invent them.
- Keep the file's existing style. Do not add explanations inside the code.`;

async function requestEditProposal({ instruction, selection, context, model, previous = null, problems = [] }) {
  const messages = [{ role: 'system', content: EDIT_SYSTEM_PROMPT }];
  for (const file of context) {
    if (file.content == null) {
      messages.push({ role: 'user', content: `=== FILE ${file.path} does not exist yet (you may create it) ===` });
      continue;
    }
    const parts = Math.max(1, Math.ceil(file.content.length / MESSAGE_CHUNK_CHARS));
    for (let i = 0; i < parts; i++) {
      const chunk = file.content.slice(i * MESSAGE_CHUNK_CHARS, (i + 1) * MESSAGE_CHUNK_CHARS);
      messages.push({ role: 'user', content: `=== FILE ${file.path}${parts > 1 ? ` (part ${i + 1}/${parts})` : ''} ===\n${chunk}\n=== END ===` });
    }
  }
  let task = `Instruction: ${instruction}`;
  if (selection?.text) task += `\n\nThe user selected lines ${selection.startLine}-${selection.endLine} of ${selection.path || context[0]?.path}:\n${selection.text}`;
  if (previous) {
    task += `\n\nYour previous proposal could not be applied cleanly:\n${problems.map((p) => `- ${p}`).join('\n')}\nReturn a corrected full proposal (all edits again, fixed).`;
  }
  messages.push({ role: 'user', content: task });

  const { data } = await deepSeekGateway.complete({
    model, messages, maxTokens: 8000, temperature: 0.1, priority: 'human',
    actor: 'Pulse', action: 'agent_edit', responseFormat: { type: 'json_object' }, timeoutMs: 180_000,
  });
  const raw = data?.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Model did not return valid JSON');
  }
}

function applyBlocks(original, blocks = []) {
  let text = original;
  const errors = [];
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  blocks.forEach((block, i) => {
    const search = String(block?.search ?? '').replace(/\r?\n/g, eol);
    const replace = String(block?.replace ?? '').replace(/\r?\n/g, eol);
    if (!search) { errors.push(`block ${i + 1}: empty "search"`); return; }
    const idx = text.indexOf(search);
    if (idx === -1) { errors.push(`block ${i + 1}: "search" text not found: ${JSON.stringify(search.slice(0, 80))}`); return; }
    if (text.indexOf(search, idx + 1) !== -1) { errors.push(`block ${i + 1}: "search" text matches more than once: ${JSON.stringify(search.slice(0, 80))}`); return; }
    text = text.slice(0, idx) + replace + text.slice(idx + search.length);
  });
  return { text, errors };
}

let esbuild = null;
function syntaxCheck(filePath, code) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    try { JSON.parse(code); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  const loader = { '.js': 'jsx', '.jsx': 'jsx', '.mjs': 'jsx', '.cjs': 'jsx', '.ts': 'ts', '.tsx': 'tsx' }[ext];
  if (!loader) return { ok: null };
  try {
    esbuild ||= createRequire(path.join(WORKSPACE_ROOT, 'package.json'))('esbuild');
    esbuild.transformSync(code, { loader, logLevel: 'silent' });
    return { ok: true };
  } catch (e) {
    const first = e.errors?.[0];
    if (!first) return { ok: null, error: `syntax check unavailable: ${e.message}` };
    return { ok: false, error: `line ${first.location?.line}: ${first.text}` };
  }
}

function applyProposal(proposal, context) {
  const changes = [];
  const problems = [];
  const byPath = new Map(context.map((f) => [f.path, f]));
  const normalizePath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

  for (const edit of Array.isArray(proposal?.edits) ? proposal.edits : []) {
    const p = normalizePath(edit.path);
    const file = byPath.get(p);
    if (!file || file.content == null) { problems.push(`${p}: can't edit a file that wasn't provided (use "creates" for new files)`); continue; }
    const { text, errors } = applyBlocks(file.content, edit.blocks);
    errors.forEach((e) => problems.push(`${p}: ${e}`));
    if (text === file.content) continue;
    const syntax = syntaxCheck(p, text);
    if (syntax.ok === false) problems.push(`${p}: edit breaks syntax (${syntax.error})`);
    changes.push({ path: p, original: file.content, modified: text, isNew: false, syntax });
  }
  for (const create of Array.isArray(proposal?.creates) ? proposal.creates : []) {
    const p = normalizePath(create.path);
    try { safeResolve(p); } catch { problems.push(`${p}: path outside workspace`); continue; }
    if (fs.existsSync(safeResolve(p)) || byPath.get(p)?.content != null) { problems.push(`${p}: already exists — edit it instead of creating`); continue; }
    const content = String(create.content ?? '');
    const syntax = syntaxCheck(p, content);
    if (syntax.ok === false) problems.push(`${p}: new file has a syntax error (${syntax.error})`);
    changes.push({ path: p, original: '', modified: content, isNew: true, syntax });
  }
  return { changes, problems };
}

function shutdownAll() {
  for (const s of sessions.values()) { try { s.kill(); } catch {} }
  for (const p of processes.values()) { if (p.status === 'running') killTree(p.pid); }
}
process.once('exit', shutdownAll);

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.clients.size === 0 && now - s.lastActivity > IDLE_SESSION_MS) {
      s.kill();
      sessions.delete(id);
    }
  }
}, 60 * 1000).unref();

export default function createPulseIdeRoutes() {
  const router = express.Router();

  // ── Files ──────────────────────────────────────────────────────────────────
  router.get('/files/tree', (req, res) => {
    try {
      const dir = req.query.dir || '.';
      const resolved = safeResolve(dir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true })
        .filter((e) => !TREE_SKIP.has(e.name))
        .map((e) => ({
          name: e.name,
          path: toWorkspacePath(path.join(resolved, e.name)),
          type: e.isDirectory() ? 'directory' : 'file',
        }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
      res.json({ success: true, root: WORKSPACE_ROOT, dir: toWorkspacePath(resolved), files: entries });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  router.get('/files/raw', (req, res) => {
    try {
      const resolved = safeResolve(req.query.path);
      if (!fs.existsSync(resolved)) return res.status(404).json({ success: false, error: 'File not found' });
      res.sendFile(resolved);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Path-style static serving so an HTML preview's relative CSS/JS/images resolve
  // (the preview injects <base href="/api/files/serve/<dir>/">).
  router.get(/^\/files\/serve\/(.*)$/, (req, res) => {
    try {
      const resolved = safeResolve(decodeURIComponent(req.params[0] || ''));
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        return res.status(404).send('Not found');
      }
      res.sendFile(resolved);
    } catch (error) {
      res.status(400).send(error.message);
    }
  });

  // ── Terminal ───────────────────────────────────────────────────────────────
  router.get('/pulse/term',requireLoopback, (_req, res) => {
    res.json({ success: true, ptyAvailable: !!pty, ptyLoadError, sessions: [...sessions.values()].map(describeSession) });
  });

  router.post('/pulse/term', requireLoopback, (req, res) => {
    try {
      const session = createSession(req.body || {});
      res.json({ success: true, ...describeSession(session), ptyLoadError: pty ? null : ptyLoadError });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/pulse/term/:id/stream', requireLoopback, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'No such terminal session' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'hello', ...describeSession(session) })}\n\n`);
    if (session.scrollback) res.write(`data: ${JSON.stringify({ type: 'data', data: session.scrollback })}\n\n`);
    if (session.exited) res.write(`data: ${JSON.stringify({ type: 'exit', code: session.exitCode })}\n\n`);
    session.clients.add(res);
    session.lastActivity = Date.now();
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(keepAlive);
      session.clients.delete(res);
      session.lastActivity = Date.now();
    });
  });

  router.post('/pulse/term/:id/input', requireLoopback, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session || session.exited) return res.status(404).json({ success: false, error: 'Terminal session not running' });
    session.lastActivity = Date.now();
    session.write(String(req.body?.data ?? ''));
    res.json({ success: true });
  });

  router.post('/pulse/term/:id/resize', requireLoopback, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'No such terminal session' });
    session.resize(req.body?.cols, req.body?.rows);
    res.json({ success: true });
  });

  router.delete('/pulse/term/:id', requireLoopback, (req, res) => {
    const session = sessions.get(req.params.id);
    if (session) { session.kill(); sessions.delete(req.params.id); }
    res.json({ success: true });
  });

  // ── Managed processes ──────────────────────────────────────────────────────
  router.post('/tools/shell/start', requireLoopback, (req, res) => {
    try {
      const command = String(req.body?.command || '').trim();
      if (!command) return res.status(400).json({ success: false, error: 'command is required' });
      const name = String(req.body?.name || command).slice(0, 80);
      const cwd = safeResolve(req.body?.cwd || '.');
      const existing = processes.get(name);
      if (existing?.status === 'running') {
        return res.json({ success: true, alreadyRunning: true, ...describeProcess(existing) });
      }
      const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: !IS_WIN,
        env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' } });
      const entry = { name, command, cwd, pid: child.pid, status: 'running', exitCode: null, url: null, log: '', startedAt: Date.now() };
      const onData = (chunk) => {
        const text = chunk.toString('utf8');
        entry.log = appendCapped(entry.log, text, PROCESS_LOG_LIMIT);
        if (!entry.url) {
          const m = text.replace(/\x1b\[[0-9;]*m/g, '').match(URL_RE);
          if (m) entry.url = `http://localhost:${m[1]}`;
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => { entry.status = 'error'; entry.log = appendCapped(entry.log, `\n[spawn error] ${err.message}\n`, PROCESS_LOG_LIMIT); });
      child.on('exit', (code) => { entry.status = 'exited'; entry.exitCode = code; });
      processes.set(name, entry);
      res.json({ success: true, ...describeProcess(entry) });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  router.get('/tools/shell/processes', requireLoopback, (_req, res) => {
    res.json({ success: true, processes: [...processes.values()].map(describeProcess) });
  });

  router.post('/tools/shell/stop', requireLoopback, (req, res) => {
    const entry = processes.get(String(req.body?.name || ''));
    if (!entry) return res.status(404).json({ success: false, error: 'No such process' });
    if (entry.status === 'running') killTree(entry.pid);
    entry.status = 'stopped';
    res.json({ success: true, ...describeProcess(entry) });
  });

  // ── Preview discovery ──────────────────────────────────────────────────────
  router.get('/pulse/dev-servers', async (_req, res) => {
    const managedPorts = [...processes.values()]
      .map((p) => Number((p.url || '').split(':').pop()))
      .filter(Boolean);
    const ports = [...new Set([...managedPorts, ...PROBE_PORTS])];
    const probed = (await Promise.all(ports.map((p) => probePort(p)))).filter(Boolean);
    res.json({
      success: true,
      servers: probed,
      processes: [...processes.values()].map(describeProcess),
      projects: findLaunchableProjects(),
    });
  });

  // ── Real spend from SOMA's cost ledger (the credits meter used to read a stub) ──
  router.get('/pulse/usage', (_req, res) => {
    try {
      const s = costLedger.getStatus();
      res.json({
        success: true,
        today: { totalCost: `$${Number(s.dailySpent || 0).toFixed(4)}`, spent: s.dailySpent },
        month: { spent: s.monthlySpent, cap: s.monthlyCap },
        budget: { cap: s.dailyCap, dailyPct: s.dailyPct },
        blocked: s.blocked,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── AI: inline completion (fill-in-the-middle) ─────────────────────────────
  router.post('/pulse/ai/complete', async (req, res) => {
    const { prefix = '', suffix = '' } = req.body || {};
    const head = String(prefix).slice(-6000);
    const tail = String(suffix).slice(0, 2500);
    if (!head.trim()) return res.json({ success: true, text: '' });
    // The editor cancels stale requests while you type; stop paying for those
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const t0 = Date.now();
    // Local first when the small FIM coder model is already in VRAM (~20ms). If SOMA's chat models have
    // pushed it out, answer from DeepSeek right away and reload it in the background, instead of making
    // the user wait for a cold load. PULSE_COMPLETION_PROVIDER=deepseek skips local entirely.
    if ((process.env.PULSE_COMPLETION_PROVIDER || 'auto') !== 'deepseek') {
      if (await isLocalFimWarm()) {
        const local = await localFimCompletion(head, tail, controller.signal);
        if (controller.signal.aborted) return;
        if (local.ok) {
          return res.json({ success: true, text: trimSuffixOverlap(local.text, tail), provider: 'local', model: LOCAL_FIM_MODEL, latencyMs: Date.now() - t0 });
        }
      } else {
        warmLocalFimInBackground();
      }
    }
    try {
      const { text, finishReason } = await deepSeekGateway.fim({
        prompt: head, suffix: tail, maxTokens: 160, temperature: 0, stop: ['\n\n\n'],
        signal: controller.signal, timeoutMs: 8000, actor: 'Pulse', action: 'inline_completion',
      });
      res.json({ success: true, text: trimSuffixOverlap(text, tail), finishReason, provider: 'deepseek', latencyMs: Date.now() - t0 });
    } catch (error) {
      if (controller.signal.aborted) return;
      res.status(error.code === 'DEEPSEEK_BUDGET_BLOCKED' ? 429 : 502).json({ success: false, error: error.message });
    }
  });

  // ── AI: multi-file agent edit (proposes diffs; never writes to disk) ────────
  router.post('/pulse/ai/edit', async (req, res) => {
    const { instruction = '', activePath = '', selection = null, files = [], openFiles = [], buffers = {}, quality = 'fast' } = req.body || {};
    if (!String(instruction).trim()) return res.status(400).json({ success: false, error: 'instruction is required' });
    const t0 = Date.now();
    try {
      const context = gatherEditContext({ activePath, files, openFiles, buffers });
      if (!context.some((f) => f.content != null)) {
        return res.status(400).json({ success: false, error: 'No readable files to edit — open a file or @mention one' });
      }
      const model = quality === 'pro' ? 'deepseek-v4-pro' : 'deepseek-flash';
      let proposal = await requestEditProposal({ instruction, selection, context, model });
      let result = applyProposal(proposal, context);
      let attempts = 1;
      if (result.problems.length) {
        proposal = await requestEditProposal({ instruction, selection, context, model, previous: proposal, problems: result.problems });
        result = applyProposal(proposal, context);
        attempts = 2;
      }
      res.json({
        success: result.changes.length > 0,
        summary: String(proposal.summary || '').slice(0, 2000),
        changes: result.changes,
        problems: result.problems,
        model, attempts, latencyMs: Date.now() - t0,
        ...(result.changes.length ? {} : { error: result.problems[0] || 'The model proposed no applicable changes' }),
      });
    } catch (error) {
      res.status(error.code === 'DEEPSEEK_BUDGET_BLOCKED' ? 429 : 502).json({ success: false, error: error.message });
    }
  });

  return router;
}
