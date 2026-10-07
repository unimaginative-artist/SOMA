// Offline check of Pulse's language-server bridge (server/routes/pulseLspRoutes.js) against the
// real TypeScript and Python servers — no browser, no running SOMA needed.
//   node scripts/test-pulse-lsp-bridge.mjs
// Uses port 3193 and temporary files in scripts/pulse-lsp-harness (removed afterwards).
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const SOMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(SOMA);
const { default: express } = await import(pathToFileURL(`${SOMA}/node_modules/express/index.js`).href);
const { default: createPulseLspRoutes } = await import(pathToFileURL(`${SOMA}/server/routes/pulseLspRoutes.js`).href);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/api', createPulseLspRoutes());
const server = app.listen(3193, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const B = 'http://127.0.0.1:3193/api';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const norm = (u) => decodeURIComponent(String(u || '')).toLowerCase().replace(/^file:\/+/, '');

// Inside scripts/ (one of Pyright's include folders) so cross-file Python rename/references are exercised
const FIX = 'scripts/pulse-lsp-harness';
fs.mkdirSync(FIX, { recursive: true });
fs.writeFileSync(`${FIX}/geometry.py`, 'def area(width: int, height: int) -> int:\n    """Area of a rectangle."""\n    return width * height\n');
fs.writeFileSync(`${FIX}/app.py`, 'from geometry import area\n\nresult: int = area(3, 4)\nbad: int = "not a number"\nprint(result.bit_length())\n');
fs.writeFileSync(`${FIX}/mathlib.mjs`, '/**\n * Adds two numbers.\n * @param {number} a\n * @param {number} b\n * @returns {number}\n */\nexport function addNumbers(a, b) {\n  return a + b;\n}\n');
fs.writeFileSync(`${FIX}/main.mjs`, "import { addNumbers } from './mathlib.mjs';\n\nconst total = addNumbers(2, 3);\nconsole.log(total.toFixed(1));\n");
fs.writeFileSync(`${FIX}/typed.ts`, "export function greet(name: string): string {\n  return 'hi ' + name;\n}\nconst n: number = greet('x');\n");

const CAPABILITIES = {
  textDocument: {
    synchronization: { didSave: true, dynamicRegistration: false },
    completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], resolveSupport: { properties: ['documentation', 'detail'] } }, contextSupport: true },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
    definition: { linkSupport: true },
    references: {},
    documentHighlight: {},
    rename: { prepareSupport: true },
    formatting: {},
    codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
    publishDiagnostics: { relatedInformation: true },
  },
  workspace: { applyEdit: true, workspaceEdit: { documentChanges: true } },
};

class Client {
  constructor(serverId) { this.serverId = serverId; this.pending = new Map(); this.nextId = 1; this.notes = []; this.waiters = []; }
  async start() {
    const r = await (await fetch(`${B}/pulse/lsp/${this.serverId}/start`, { method: 'POST' })).json();
    if (!r.success) throw new Error(r.error);
    Object.assign(this, r);
    this.ctrl = new AbortController();
    const res = await fetch(`${B}/pulse/lsp/session/${r.sessionId}/stream`, { signal: this.ctrl.signal });
    this.readLoop(res.body.getReader());
    return r;
  }
  async readLoop(reader) {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split('\n')) if (line.startsWith('data: ')) this.onEvent(JSON.parse(line.slice(6)));
        }
      }
    } catch {}
  }
  onEvent(ev) {
    if (ev.type !== 'message') { if (ev.type === 'exit') this.exitEvent = ev; return; }
    const m = ev.message;
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      return;
    }
    if (m.method && m.id !== undefined) { this.send({ jsonrpc: '2.0', id: m.id, result: null }); return; }
    this.notes.push(m);
    this.waiters = this.waiters.filter((w) => { if (w.pred(m)) { w.resolve(m); return false; } return true; });
  }
  send(msg) { return fetch(`${B}/pulse/lsp/session/${this.sessionId}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }); }
  request(method, params, timeout = 90000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, timeout);
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { return this.send({ jsonrpc: '2.0', method, params }); }
  waitFor(pred, timeout = 90000) {
    const hit = this.notes.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => { this.waiters.push({ pred, resolve }); setTimeout(() => reject(new Error('timed out waiting for notification')), timeout); });
  }
  uri(rel) { return `${this.rootUri}/${rel.split('/').map(encodeURIComponent).join('/')}`; }
  open(rel, languageId) { return this.notify('textDocument/didOpen', { textDocument: { uri: this.uri(rel), languageId, version: 1, text: fs.readFileSync(rel, 'utf8') } }); }
  async init() {
    const t0 = Date.now();
    const result = await this.request('initialize', { processId: null, capabilities: CAPABILITIES, clientInfo: { name: 'pulse-harness' } });
    await this.notify('initialized', {});
    this.initMs = Date.now() - t0;
    return result;
  }
  async stop() { this.ctrl?.abort(); await fetch(`${B}/pulse/lsp/session/${this.sessionId}`, { method: 'DELETE' }); }
}
const diagFor = (client, rel, pattern) => client.waitFor((m) => m.method === 'textDocument/publishDiagnostics'
  && norm(m.params.uri).endsWith(rel.toLowerCase()) && m.params.diagnostics.some((d) => pattern.test(d.message)));
const hoverText = (h) => { const c = h?.contents; if (!c) return ''; if (typeof c === 'string') return c; if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.value)).join('\n'); return c.value || ''; };
const labels = (c) => (Array.isArray(c) ? c : c?.items || []).map((i) => i.label);
const locs = (d) => (Array.isArray(d) ? d : d ? [d] : []).map((l) => ({ uri: l.targetUri || l.uri, range: l.targetSelectionRange || l.range }));
const editFiles = (we) => Object.keys(we?.changes || {}).concat((we?.documentChanges || []).map((dc) => dc.textDocument?.uri).filter(Boolean)).map(norm);
// Every live process in the trees started by THIS harness (a running SOMA may have its own servers)
const processTree = (rootPids) => {
  const script = `$ProgressPreference = 'SilentlyContinue'; $roots = @(${rootPids.filter(Boolean).join(',')}); $all = Get-CimInstance Win32_Process; `
    + '$ids = New-Object System.Collections.Generic.HashSet[int]; foreach ($r in $roots) { [void]$ids.Add([int]$r) }; '
    + 'do { $added = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true } } } while ($added); '
    + '@($ids | ForEach-Object { $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($proc) { [pscustomobject]@{ id = $_; mb = [math]::Round($proc.WorkingSet64 / 1MB) } } }) | ConvertTo-Json -Compress';
  try {
    const raw = execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
};
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

try {
  const servers = await (await fetch(`${B}/pulse/lsp/servers`)).json();
  check('servers endpoint lists TS + Python as available', servers.servers.find((s) => s.id === 'typescript')?.available && servers.servers.find((s) => s.id === 'python')?.available,
    servers.servers.map((s) => `${s.id}:${s.available ? 'yes' : 'no'}`).join(' '));

  // ── Python ────────────────────────────────────────────────────────────────
  const py = new Client('python');
  await py.start();
  const pyInit = await py.init();
  check('pyright initializes with hover/completion/definition/rename', Boolean(pyInit.capabilities.hoverProvider && pyInit.capabilities.completionProvider && pyInit.capabilities.definitionProvider && pyInit.capabilities.renameProvider), `${py.initMs}ms`);
  const pyT = Date.now();
  await py.open(`${FIX}/app.py`, 'python');
  const pyDiag = await diagFor(py, `${FIX}/app.py`, /not assignable|incompatible|"str"|Literal\['not a number'\]/i).catch((e) => null);
  check('python: type error reported', Boolean(pyDiag), pyDiag ? `${Date.now() - pyT}ms: ${pyDiag.params.diagnostics.map((d) => `L${d.range.start.line + 1} ${d.message.split('\n')[0]}`).join(' | ')}` : 'none');
  const pyHover = await py.request('textDocument/hover', { textDocument: { uri: py.uri(`${FIX}/app.py`) }, position: { line: 2, character: 16 } });
  check('python: hover shows the function signature', /area|width/.test(hoverText(pyHover)), hoverText(pyHover).replace(/\s+/g, ' ').slice(0, 100));
  const pyComp = await py.request('textDocument/completion', { textDocument: { uri: py.uri(`${FIX}/app.py`) }, position: { line: 4, character: 13 }, context: { triggerKind: 2, triggerCharacter: '.' } });
  check('python: completion after "result." offers int methods', labels(pyComp).includes('bit_length'), `${labels(pyComp).length} items`);
  const pyDef = locs(await py.request('textDocument/definition', { textDocument: { uri: py.uri(`${FIX}/app.py`) }, position: { line: 2, character: 16 } }));
  check('python: go-to-definition lands in the other (unopened) file', pyDef.some((l) => norm(l.uri).endsWith('geometry.py') && l.range.start.line === 0), JSON.stringify(pyDef.map((l) => `${norm(l.uri).split('/').pop()}:${l.range.start.line}`)));
  await py.open(`${FIX}/geometry.py`, 'python');
  const pyRename = await py.request('textDocument/rename', { textDocument: { uri: py.uri(`${FIX}/geometry.py`) }, position: { line: 0, character: 5 }, newName: 'rect_area' });
  const pyFiles = editFiles(pyRename);
  check('python: rename edits both files', pyFiles.some((f) => f.endsWith('geometry.py')) && pyFiles.some((f) => f.endsWith('app.py')), pyFiles.map((f) => f.split('/').pop()).join(', '));

  // ── TypeScript / JavaScript ───────────────────────────────────────────────
  const ts = new Client('typescript');
  await ts.start();
  const tsInit = await ts.init();
  check('tsserver initializes with hover/completion/definition/rename/formatting', Boolean(tsInit.capabilities.hoverProvider && tsInit.capabilities.completionProvider && tsInit.capabilities.definitionProvider && tsInit.capabilities.renameProvider && tsInit.capabilities.documentFormattingProvider), `${ts.initMs}ms`);
  const tsT = Date.now();
  await ts.open(`${FIX}/typed.ts`, 'typescript');
  await ts.open(`${FIX}/main.mjs`, 'javascript');
  const tsDiag = await diagFor(ts, `${FIX}/typed.ts`, /not assignable to type 'number'/).catch(() => null);
  check('typescript: type error reported', Boolean(tsDiag), tsDiag ? `${Date.now() - tsT}ms` : 'none');
  const tsHover = await ts.request('textDocument/hover', { textDocument: { uri: ts.uri(`${FIX}/main.mjs`) }, position: { line: 2, character: 16 } });
  check('javascript: hover shows signature + JSDoc from the other file', /addNumbers/.test(hoverText(tsHover)) && /Adds two numbers/.test(hoverText(tsHover)), hoverText(tsHover).replace(/\s+/g, ' ').slice(0, 100));
  const tsComp = await ts.request('textDocument/completion', { textDocument: { uri: ts.uri(`${FIX}/main.mjs`) }, position: { line: 3, character: 18 }, context: { triggerKind: 2, triggerCharacter: '.' } });
  check('javascript: completion after "total." offers number methods', labels(tsComp).includes('toFixed'), `${labels(tsComp).length} items`);
  const tsDef = locs(await ts.request('textDocument/definition', { textDocument: { uri: ts.uri(`${FIX}/main.mjs`) }, position: { line: 2, character: 16 } }));
  check('javascript: go-to-definition lands in mathlib.mjs', tsDef.some((l) => norm(l.uri).endsWith('mathlib.mjs')), JSON.stringify(tsDef.map((l) => `${norm(l.uri).split('/').pop()}:${l.range.start.line}`)));
  const tsRefs = locs(await ts.request('textDocument/references', { textDocument: { uri: ts.uri(`${FIX}/main.mjs`) }, position: { line: 2, character: 16 }, context: { includeDeclaration: true } }));
  check('javascript: find references spans both files', new Set(tsRefs.map((l) => norm(l.uri).split('/').pop())).size >= 2, `${tsRefs.length} refs`);
  // Rename at the definition (renaming an import alias only renames the local binding, by design)
  await ts.open(`${FIX}/mathlib.mjs`, 'javascript');
  const tsRename = await ts.request('textDocument/rename', { textDocument: { uri: ts.uri(`${FIX}/mathlib.mjs`) }, position: { line: 6, character: 18 }, newName: 'sumNumbers' });
  const tsFiles = editFiles(tsRename);
  check('javascript: rename edits both files', tsFiles.some((f) => f.endsWith('mathlib.mjs')) && tsFiles.some((f) => f.endsWith('main.mjs')), tsFiles.map((f) => f.split('/').pop()).join(', '));
  const fmt = await ts.request('textDocument/formatting', { textDocument: { uri: ts.uri(`${FIX}/typed.ts`) }, options: { tabSize: 2, insertSpaces: true } });
  check('typescript: formatting responds', Array.isArray(fmt), `${fmt?.length ?? 0} edits`);

  const tree = processTree([py.pid, ts.pid]);
  console.log(`      this harness's language servers: ${tree.length} processes, ${tree.reduce((sum, p) => sum + p.mb, 0)}MB`);

  // ── Shutdown ──────────────────────────────────────────────────────────────
  await py.stop();
  await ts.stop();
  await new Promise((r) => setTimeout(r, 2500));
  const after = await (await fetch(`${B}/pulse/lsp/servers`)).json();
  check('stopping sessions leaves no server running', after.servers.every((s) => !s.running));
  const leftover = tree.filter((p) => isAlive(p.id));
  check('no language server processes left behind', tree.length > 0 && leftover.length === 0, `${leftover.length} of ${tree.length} still running`);
} catch (error) {
  check('harness completed without throwing', false, error.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  fs.rmSync(FIX, { recursive: true, force: true });
  server.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
setTimeout(() => process.exit(results.every(Boolean) ? 0 : 1), 300);
