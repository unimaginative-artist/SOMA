/**
 * Pulse language servers — the same code-intelligence engines VS Code and Cursor use.
 *
 * Pulse's editor (Monaco) only understood JavaScript/TypeScript inside open files. This bridge runs
 * real Language Server Protocol servers on the backend and relays JSON-RPC to the browser:
 *
 *   GET    /api/pulse/lsp/servers                  which servers are installed / running
 *   POST   /api/pulse/lsp/:server/start            spawn (replaces any older session for that server)
 *   GET    /api/pulse/lsp/session/:id/stream       SSE: server -> browser messages (queued until connected)
 *   POST   /api/pulse/lsp/session/:id/send         browser -> server message(s)
 *   GET    /api/pulse/lsp/session/:id/log          stderr tail (debugging)
 *   DELETE /api/pulse/lsp/session/:id              shutdown
 *
 * Servers: TypeScript/JavaScript (typescript-language-server + tsserver) and Python (Pyright) from
 * server/lsp-host; Go/Rust/C++ are picked up automatically if gopls/rust-analyzer/clangd are on PATH.
 * Servers start on demand and stop after 10 idle minutes. All routes are local-only (localOnlyGuard).
 * Routine server->client requests (configuration, capability registration, progress) are answered
 * here so the browser client stays small.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, execFile, execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = process.cwd();
const ROOT_URI = pathToFileURL(WORKSPACE_ROOT).href;
const ROOT_NAME = path.basename(WORKSPACE_ROOT);
const HOST_PKG = path.join(__dirname, '..', 'lsp-host', 'package.json');
const IDLE_MS = 10 * 60 * 1000;
const MAX_QUEUE = 2000;
const IS_WIN = process.platform === 'win32';

function hostResolve(spec) {
  try { return createRequire(HOST_PKG).resolve(spec); } catch { return null; }
}

const pathCache = new Map();
function onPath(cmd) {
  const hit = pathCache.get(cmd);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value = null;
  try {
    value = execFileSync(IS_WIN ? 'where.exe' : 'which', [cmd], { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map((s) => s.trim()).find(Boolean) || null;
  } catch {}
  pathCache.set(cmd, { at: Date.now(), value });
  return value;
}

function typescriptLanguageServerCli() {
  const pkgPath = hostResolve('typescript-language-server/package.json');
  if (!pkgPath) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['typescript-language-server'];
  return bin ? path.join(path.dirname(pkgPath), bin) : null;
}

// Pyright enumerates every Python file under the workspace before its first diagnostics. SOMA's folder
// holds ~5,500 .py files (cloned repos, data, venvs) but only ~75 of its own, so scanning everything
// took ~17s. Limiting "include" to SOMA's code folders cut that to ~3s; files opened from anywhere
// else are still analyzed (open files always are) and their sibling imports still resolve.
const PYTHON_SETTINGS = {
  python: {
    analysis: {
      diagnosticMode: 'openFilesOnly', // don't type-check the whole repo in the background
      typeCheckingMode: 'basic',
      autoSearchPaths: true,
      useLibraryCodeForTypes: true,
      indexing: false,
      include: ['server', 'appendages', 'backend', 'Concieve', 'scripts', 'arbiters', 'siren-bridge', 'marionette', 'cluster', 'core', '*.py'],
    },
  },
};

export const SERVER_DEFS = {
  typescript: {
    label: 'TypeScript / JavaScript',
    languages: ['javascript', 'typescript'],
    resolve() {
      const cli = typescriptLanguageServerCli();
      const tsserver = hostResolve('typescript/lib/tsserver.js');
      if (!cli || !tsserver) return { error: 'typescript-language-server is not installed in server/lsp-host' };
      return {
        command: process.execPath,
        args: [cli, '--stdio'],
        initializationOptions: {
          tsserver: { path: tsserver, logVerbosity: 'off' },
          maxTsServerMemory: 2048, // SOMA shares this machine; cap tsserver's heap
          preferences: { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true },
        },
      };
    },
  },
  python: {
    label: 'Python (Pyright)',
    languages: ['python'],
    resolve() {
      const cli = hostResolve('pyright/langserver.index.js');
      if (!cli) return { error: 'pyright is not installed in server/lsp-host' };
      return { command: process.execPath, args: [cli, '--stdio'], settings: PYTHON_SETTINGS };
    },
  },
  go: {
    label: 'Go (gopls)',
    languages: ['go'],
    resolve() { const c = onPath('gopls'); return c ? { command: c, args: [] } : { error: 'gopls is not installed' }; },
  },
  rust: {
    label: 'Rust (rust-analyzer)',
    languages: ['rust'],
    resolve() { const c = onPath('rust-analyzer'); return c ? { command: c, args: [] } : { error: 'rust-analyzer is not installed' }; },
  },
  cpp: {
    label: 'C / C++ (clangd)',
    languages: ['cpp', 'c'],
    resolve() { const c = onPath('clangd'); return c ? { command: c, args: ['--background-index=false'] } : { error: 'clangd is not installed' }; },
  },
};

// ── Sessions ─────────────────────────────────────────────────────────────────
const sessions = new Map();   // sessionId -> session
const byServer = new Map();   // serverId -> sessionId (one live session per server)
let seq = 0;

function frame(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function writeToServer(s, message) {
  if (!s.exited && s.child.stdin.writable) s.child.stdin.write(frame(message));
}

function emit(s, event) {
  if (s.clients.size === 0) {
    if (event.type === 'message') {
      s.queue.push(event);
      if (s.queue.length > MAX_QUEUE) s.queue.shift();
    }
    return;
  }
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of s.clients) client.write(data);
}

function lookupSetting(settings, section) {
  if (!settings) return null;
  if (!section) return settings;
  const value = section.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), settings);
  return value === undefined ? null : value;
}

function handleServerMessage(s, message) {
  if (message.method && message.id !== undefined) {
    let result;
    let handled = true;
    switch (message.method) {
      case 'workspace/configuration':
        result = (message.params?.items || []).map((item) => lookupSetting(s.spec.settings, item.section));
        break;
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
        result = null;
        break;
      case 'workspace/workspaceFolders':
        result = [{ uri: ROOT_URI, name: ROOT_NAME }];
        break;
      default:
        handled = false;
    }
    if (handled) {
      writeToServer(s, { jsonrpc: '2.0', id: message.id, result });
      return;
    }
  }
  if (message.method === 'window/logMessage') {
    // Keep the server's own log (visible via /log) — it's how slow startups get diagnosed
    s.stderr = (s.stderr + `[log] ${String(message.params?.message || '').slice(0, 400)}\n`).slice(-16000);
    return;
  }
  if (message.method === '$/progress' || message.method === 'telemetry/event') return;
  emit(s, { type: 'message', message });
}

function parseServerOutput(s) {
  for (;;) {
    const headerEnd = s.buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = s.buffer.subarray(0, headerEnd).toString('ascii');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { s.buffer = s.buffer.subarray(headerEnd + 4); continue; }
    const start = headerEnd + 4;
    const length = Number(match[1]);
    if (s.buffer.length < start + length) return;
    const body = s.buffer.subarray(start, start + length).toString('utf8');
    s.buffer = s.buffer.subarray(start + length);
    let message;
    try { message = JSON.parse(body); } catch { continue; }
    handleServerMessage(s, message);
  }
}

// The bridge owns workspace identity: root, folders, init options and required client capabilities.
function prepareClientMessage(s, message) {
  if (message?.method !== 'initialize') return message;
  const params = message.params || {};
  const capabilities = params.capabilities || {};
  return {
    ...message,
    params: {
      ...params,
      processId: process.pid, // servers exit on their own if SOMA dies
      rootUri: ROOT_URI,
      rootPath: WORKSPACE_ROOT,
      workspaceFolders: [{ uri: ROOT_URI, name: ROOT_NAME }],
      initializationOptions: { ...(s.spec.initializationOptions || {}), ...(params.initializationOptions || {}) },
      capabilities: {
        ...capabilities,
        workspace: { ...(capabilities.workspace || {}), configuration: true, workspaceFolders: true },
      },
    },
  };
}

function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(pid, 'SIGTERM'); } catch {} }
}

function stopSession(id, reason = 'stopped') {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (byServer.get(s.serverId) === id) byServer.delete(s.serverId);
  emit(s, { type: 'exit', reason, code: s.exitCode });
  for (const client of s.clients) { try { client.end(); } catch {} }
  s.clients.clear();
  if (!s.exited) {
    // Kill the whole process tree right away. A polite shutdown let the wrapper exit first and
    // orphan its tsserver children; language servers keep no state worth a graceful exit.
    killTree(s.child.pid);
  }
}

function startSession(serverId) {
  const def = SERVER_DEFS[serverId];
  const spec = def.resolve();
  if (spec.error) throw new Error(spec.error);
  const previous = byServer.get(serverId);
  if (previous) stopSession(previous, 'replaced by a newer Pulse window');

  const id = `lsp${Date.now().toString(36)}${(++seq).toString(36)}`;
  const child = spawn(spec.command, spec.args, { cwd: WORKSPACE_ROOT, windowsHide: true, env: { ...process.env } });
  const s = {
    id, serverId, spec, child,
    clients: new Set(), queue: [], stderr: '', buffer: Buffer.alloc(0),
    startedAt: Date.now(), lastActivity: Date.now(), exited: false, exitCode: null,
  };
  child.stdout.on('data', (chunk) => { s.buffer = Buffer.concat([s.buffer, chunk]); parseServerOutput(s); });
  child.stderr.on('data', (chunk) => { s.stderr = (s.stderr + chunk.toString('utf8')).slice(-8000); });
  child.on('error', (error) => { s.stderr += `\n[spawn error] ${error.message}`; });
  child.on('exit', (code) => {
    s.exited = true;
    s.exitCode = code;
    emit(s, { type: 'exit', reason: 'server process exited', code });
    if (byServer.get(serverId) === id) byServer.delete(serverId);
  });
  sessions.set(id, s);
  byServer.set(serverId, id);
  return s;
}

function describeServers() {
  return Object.entries(SERVER_DEFS).map(([id, def]) => {
    const spec = def.resolve();
    const sessionId = byServer.get(id);
    const s = sessionId ? sessions.get(sessionId) : null;
    return {
      id, label: def.label, languages: def.languages,
      available: !spec.error, reason: spec.error || null,
      running: Boolean(s && !s.exited), sessionId: s?.id || null, pid: s?.child.pid || null,
      uptimeMs: s ? Date.now() - s.startedAt : null,
    };
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.exited) { sessions.delete(id); continue; }
    if (s.clients.size === 0 && now - s.lastActivity > IDLE_MS) stopSession(id, 'idle');
  }
}, 60_000).unref();

process.once('exit', () => { for (const s of sessions.values()) killTree(s.child.pid); });

export default function createPulseLspRoutes() {
  const router = express.Router();

  router.get('/pulse/lsp/servers', (_req, res) => {
    res.json({ success: true, rootUri: ROOT_URI, rootPath: WORKSPACE_ROOT.replace(/\\/g, '/'), servers: describeServers() });
  });

  router.post('/pulse/lsp/:server/start', (req, res) => {
    const serverId = req.params.server;
    if (!SERVER_DEFS[serverId]) return res.status(404).json({ success: false, error: `Unknown language server: ${serverId}` });
    try {
      const s = startSession(serverId);
      res.json({ success: true, sessionId: s.id, server: serverId, pid: s.child.pid, rootUri: ROOT_URI, rootPath: WORKSPACE_ROOT.replace(/\\/g, '/') });
    } catch (error) {
      res.status(503).json({ success: false, error: error.message });
    }
  });

  router.get('/pulse/lsp/session/:id/stream', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: 'No such language server session' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'hello', sessionId: s.id, server: s.serverId })}\n\n`);
    for (const event of s.queue.splice(0)) res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (s.exited) res.write(`data: ${JSON.stringify({ type: 'exit', reason: 'server process exited', code: s.exitCode })}\n\n`);
    s.clients.add(res);
    s.lastActivity = Date.now();
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      s.clients.delete(res);
      s.lastActivity = Date.now();
    });
  });

  router.post('/pulse/lsp/session/:id/send', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s || s.exited) return res.status(410).json({ success: false, error: 'Language server session is not running' });
    const messages = Array.isArray(req.body) ? req.body : [req.body];
    for (const raw of messages) {
      if (!raw || typeof raw !== 'object') continue;
      const message = prepareClientMessage(s, raw);
      writeToServer(s, message);
      // Push settings once the handshake completes (Pyright reads them via workspace/configuration too)
      if (message.method === 'initialized' && s.spec.settings) {
        writeToServer(s, { jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: s.spec.settings } });
      }
    }
    s.lastActivity = Date.now();
    res.json({ success: true });
  });

  router.get('/pulse/lsp/session/:id/log', (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: 'No such language server session' });
    res.json({ success: true, exited: s.exited, exitCode: s.exitCode, stderr: s.stderr });
  });

  router.delete('/pulse/lsp/session/:id', (req, res) => {
    stopSession(req.params.id, 'closed by Pulse');
    res.json({ success: true });
  });

  return router;
}
