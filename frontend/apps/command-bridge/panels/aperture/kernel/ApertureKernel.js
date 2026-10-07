/**
 * ApertureKernel — the OS kernel powering Aperture
 *
 * Responsibilities:
 *  - Process lifecycle (spawn / kill / suspend / resume)
 *  - Virtual filesystem with backend-mounted paths
 *  - IPC bus between processes
 *  - Syscall dispatch table
 *  - AI-first device layer: /dev/soma (brain), /dev/ai/*, tool execution
 *  - Boot sequence with real log output
 */

import somaBackend from '../../../somaBackend';

const KERNEL_VERSION = 'ApertureOS 1.0.0-ai (x86_64)';
const INIT_PID = 1;

class ApertureKernel {
  constructor() {
    this.version = KERNEL_VERSION;
    this.state = 'offline'; // offline → booting → running → halted
    this.bootTime = null;
    this.bootLog = [];

    // Process table: pid → ProcessDescriptor
    this._procs = new Map();
    this._nextPid = INIT_PID;

    // File descriptor table: pid → Map(fd → handle)
    this._fds = new Map();

    // VFS mount table: mountPoint → { read, write, list, exec? }
    this._mounts = new Map();

    // IPC: pid → queued messages, pid → live handler
    this._ipcQueues = new Map();
    this._ipcHandlers = new Map();

    // Event listeners
    this._listeners = {};

    // Syscall log (ring buffer, last 200)
    this.syscallLog = [];

    // AI tool registry: toolName → { description, handler }
    this._tools = new Map();

    // Ephemeral /tmp store
    this._tmp = new Map();

    // AI conversation state per pid
    this._aiContexts = new Map();

    // Notification queue (ring buffer, last 100)
    this.notifications = [];
    this._notifId = 0;
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  notify(title, body = '', opts = {}) {
    const notif = {
      id: ++this._notifId,
      title,
      body,
      appId: opts.appId || 'system',
      type: opts.type || 'info',  // info | success | warning | error | ai
      action: opts.action || null,
      at: Date.now(),
      read: false,
    };
    this.notifications = [notif, ...this.notifications].slice(0, 100);
    this._emit('notification', notif);
    return notif.id;
  }

  markRead(id) {
    this.notifications = this.notifications.map(n => n.id === id ? { ...n, read: true } : n);
  }

  clearNotifications() {
    this.notifications = [];
    this._emit('notifications-cleared', {});
  }

  get unreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }

  // ─── File Associations ────────────────────────────────────────────────────

  open(path, callerPid = 0) {
    let appId = 'files';
    if (/^https?:\/\//i.test(path))                                  appId = 'portal';
    else if (path.startsWith('/reflections') || /\.(md|txt)$/i.test(path)) appId = 'notes';
    else if (path.startsWith('/axis'))                               appId = 'tasks';
    else if (path === '/soma/state' || path.startsWith('/soma/state')) appId = 'status';
    else if (path.startsWith('/portal'))                             appId = 'portal';
    const pid = this._rawSpawn(appId, appId, { ppid: callerPid });
    this._emit('exec-request', { appId, pid, args: { openPath: path } });
    this._emit('open-request', { path, appId, pid });
    return { appId, pid };
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  async boot() {
    if (this.state !== 'offline') return this;
    this.state = 'booting';
    this.bootTime = Date.now();

    this._klog(KERNEL_VERSION);
    this._klog('Command line: root=/dev/vfs rw quiet splash');
    this._klog('');
    await this._sleep(40);

    this._klog('Initializing kernel subsystems...');
    this._klog('  [OK] memory manager');
    this._klog('  [OK] process scheduler (CFS)');
    this._klog('  [OK] signal dispatcher');
    await this._sleep(60);

    // spawn init
    this._rawSpawn('init', 'ApertureInit', { ppid: 0, system: true });
    this._klog('  [OK] init(1) started');

    await this._sleep(50);
    this._klog('Mounting virtual filesystems...');
    this._mountDefaults();
    this._klog('  [OK] /proc → kernel process table');
    this._klog('  [OK] /dev → device registry');
    this._klog('  [OK] /dev/soma → SOMA brain (AI primary)');
    this._klog('  [OK] /dev/ai → AI tool execution layer');
    this._klog('  [OK] /axis → Axis workspace API');
    this._klog('  [OK] /reflections → Reflections / notes API');
    this._klog('  [OK] /portal → Portal research index');
    this._klog('  [OK] /soma → SOMA knowledge graph');
    this._klog('  [OK] /tmp → ephemeral memory store');
    await this._sleep(60);

    this._klog('Loading AI device drivers...');
    this._klog('  [OK] soma-brain: connected to DeepSeek/Ollama cascade');
    this._klog('  [OK] web-search: Brave Search (500 req/mo budget)');
    this._klog('  [OK] memory-recall: MnemonicArbiter (vector)');
    this._klog('  [OK] hybrid-search: HybridSearchArbiter (ML)');
    this._klog('  [OK] tool-executor: SOMA execute-tool gateway');
    await this._sleep(60);

    this._registerAITools();
    this._klog(`  [OK] ${this._tools.size} AI tools registered in kernel`);

    await this._sleep(40);
    this._klog('Starting window manager (aperture-wm)...');
    this._rawSpawn('aperture-wm', 'Aperture WM', { ppid: INIT_PID, system: true });
    this._klog('  [OK] aperture-wm(2) started');

    await this._sleep(30);
    this._klog('Starting AI shell daemon (aperture-ai)...');
    this._rawSpawn('aperture-ai', 'Aperture AI Daemon', { ppid: INIT_PID, system: true });
    this._klog('  [OK] aperture-ai(3) started');

    await this._sleep(30);
    this._klog('Starting system shell (aperture-sh)...');
    this._rawSpawn('aperture-sh', 'Aperture Shell', { ppid: INIT_PID, system: true });
    this._klog('  [OK] aperture-sh(4) ready');

    await this._sleep(20);
    this._klog('');
    this._klog(`Aperture OS kernel ready. ${this._procs.size} system processes.`);
    this._klog(`AI-first OS. All apps have direct access to SOMA brain.`);
    this._klog(`Type 'help' in Terminal. SOMA answers questions. Tools are syscalls.`);
    this._klog('');

    this.state = 'running';
    this._emit('boot-complete', { elapsed: Date.now() - this.bootTime, procs: this._procs.size });
    setTimeout(() => this.notify('ApertureOS Ready', `Kernel booted in ${((Date.now() - this.bootTime) / 1000).toFixed(1)}s · ${this._procs.size} processes · ${this._tools.size} AI tools loaded`, { appId: 'system', type: 'success' }), 800);
    return this;
  }

  // ─── Process Management ───────────────────────────────────────────────────

  _rawSpawn(appId, name, opts = {}) {
    const pid = this._nextPid++;
    const proc = {
      pid,
      ppid: opts.ppid ?? 0,
      appId,
      name,
      state: 'running',
      startedAt: Date.now(),
      windowId: opts.windowId || null,
      system: opts.system || false,
      permissions: opts.permissions || {},
      memory: opts.system ? Math.floor(Math.random() * 6 + 8) : Math.floor(Math.random() * 20 + 12),
      cpu: 0,
    };
    this._procs.set(pid, proc);
    this._ipcQueues.set(pid, []);
    this._emit('process-spawn', { ...proc });
    return pid;
  }

  spawn(appId, name, opts = {}) {
    return this._rawSpawn(appId, name, opts);
  }

  kill(pid, signal = 'SIGTERM') {
    const proc = this._procs.get(pid);
    if (!proc) return false;
    if (proc.system) return false; // can't kill system procs
    proc.state = 'zombie';
    proc.exitSignal = signal;
    proc.exitAt = Date.now();
    this._emit('process-kill', { pid, signal, name: proc.name, windowId: proc.windowId });
    setTimeout(() => {
      this._procs.delete(pid);
      this._ipcQueues.delete(pid);
      this._ipcHandlers.delete(pid);
      this._aiContexts.delete(pid);
      this._emit('process-exit', { pid });
    }, 400);
    return true;
  }

  suspend(pid) {
    const proc = this._procs.get(pid);
    if (!proc || proc.system) return false;
    proc.state = 'suspended';
    this._emit('process-suspend', { pid });
    return true;
  }

  resume(pid) {
    const proc = this._procs.get(pid);
    if (!proc) return false;
    proc.state = 'running';
    this._emit('process-resume', { pid });
    return true;
  }

  attachWindow(pid, windowId) {
    const proc = this._procs.get(pid);
    if (proc) proc.windowId = windowId;
  }

  listProcesses() {
    return [...this._procs.values()].map(p => ({ ...p }));
  }

  getProcess(pid) {
    const p = this._procs.get(pid);
    return p ? { ...p } : null;
  }

  // ─── VFS ──────────────────────────────────────────────────────────────────

  _mountDefaults() {
    // /proc — live process table
    this._mounts.set('/proc', {
      list: async () => [...this._procs.keys()].map(pid => ({ name: String(pid), type: 'dir' })),
      read: async (path) => {
        const segs = path.replace(/^\/proc\/?/, '').split('/').filter(Boolean);
        if (!segs.length) {
          return [...this._procs.values()].map(p =>
            `${String(p.pid).padEnd(6)} ${p.state.padEnd(10)} ${p.name}`
          ).join('\n');
        }
        const pid = parseInt(segs[0]);
        const proc = this._procs.get(pid);
        if (!proc) return null;
        if (segs[1] === 'status') return this._procStatus(proc);
        if (segs[1] === 'cmdline') return proc.appId;
        if (segs[1] === 'mem') return `VmRSS: ${proc.memory} MB`;
        return JSON.stringify(proc, null, 2);
      }
    });

    // /dev — device nodes
    this._mounts.set('/dev', {
      list: async () => [
        { name: 'soma', type: 'device' },
        { name: 'ai', type: 'dir' },
        { name: 'net', type: 'device' },
        { name: 'storage', type: 'device' },
        { name: 'display', type: 'device' },
        { name: 'null', type: 'device' },
        { name: 'zero', type: 'device' },
        { name: 'random', type: 'device' },
      ],
      read: async (path) => {
        if (path === '/dev/soma') return 'soma-brain: DeepSeek/Ollama cascade — online';
        if (path === '/dev/net') return 'network: online';
        if (path === '/dev/storage') return 'storage: online';
        if (path === '/dev/null') return '';
        if (path === '/dev/zero') return '\x00'.repeat(64);
        if (path === '/dev/random') return Math.random().toString(36).slice(2);
        return `device: ${path}`;
      },
      exec: async (path, args) => {
        if (path === '/dev/soma') return this._callSoma(args.prompt, args.pid);
        if (path.startsWith('/dev/ai/')) {
          const tool = path.replace('/dev/ai/', '');
          return this._execTool(tool, args);
        }
        return null;
      }
    });

    // /axis — Axis workspace API
    this._mounts.set('/axis', {
      list: async (path) => {
        const segs = (path || '').replace(/^\/axis\/?/, '').split('/').filter(Boolean);
        if (!segs.length) {
          const r = await somaBackend.fetch('/api/axis/workspaces');
          return (r.workspaces || []).map(w => ({ name: w.name, type: 'dir', id: w.id }));
        }
        return [];
      },
      read: async (path) => {
        const segs = path.replace(/^\/axis\/?/, '').split('/').filter(Boolean);
        if (!segs.length) {
          const r = await somaBackend.fetch('/api/axis/workspaces');
          return JSON.stringify(r.workspaces || [], null, 2);
        }
        if (segs[0] === 'workspaces') {
          const r = await somaBackend.fetch('/api/axis/workspaces');
          return JSON.stringify(r.workspaces || [], null, 2);
        }
        return null;
      }
    });

    // /reflections — notes / reflection API
    this._mounts.set('/reflections', {
      list: async () => {
        const r = await somaBackend.fetch('/api/reflections/list');
        return (r.notes || []).map(n => ({ name: n.name, type: 'file', title: n.title }));
      },
      read: async (path) => {
        const name = decodeURIComponent(path.replace(/^\/reflections\/?/, ''));
        if (!name) {
          const r = await somaBackend.fetch('/api/reflections/list');
          return (r.notes || []).map(n => n.title).join('\n');
        }
        const r = await somaBackend.fetch(`/api/reflections/note/${encodeURIComponent(name)}`);
        return r.content || null;
      },
      write: async (path, data) => {
        const name = path.replace(/^\/reflections\/?/, '');
        if (!name) return false;
        const r = await somaBackend.fetch('/api/reflections/note', {
          method: 'PUT',
          body: JSON.stringify({ name, content: data })
        });
        return r.success !== false;
      }
    });

    // /portal — Portal research index
    this._mounts.set('/portal', {
      list: async () => [
        { name: 'index', type: 'dir' },
        { name: 'search', type: 'file' },
      ],
      read: async (path) => {
        if (path === '/portal' || path === '/portal/') return 'Portal research index. Use /portal/index to search.';
        return 'Portal: use the Portal browser app for full access.';
      }
    });

    // /soma — SOMA knowledge graph
    this._mounts.set('/soma', {
      list: async () => [
        { name: 'knowledge', type: 'dir' },
        { name: 'memory', type: 'dir' },
        { name: 'goals', type: 'dir' },
        { name: 'state', type: 'file' },
      ],
      read: async (path) => {
        if (path === '/soma/state') {
          const r = await somaBackend.fetch('/api/system/state').catch(() => ({}));
          return JSON.stringify(r.snapshot || {}, null, 2);
        }
        if (path === '/soma/goals') {
          const r = await somaBackend.fetch('/api/goals?limit=20').catch(() => ({}));
          return JSON.stringify(r.goals || [], null, 2);
        }
        return `SOMA virtual path: ${path}`;
      }
    });

    // /tmp — ephemeral
    this._mounts.set('/tmp', {
      list: async () => [...this._tmp.keys()].map(k => ({ name: k, type: 'file' })),
      read: async (path) => {
        const key = path.replace(/^\/tmp\/?/, '');
        return this._tmp.get(key) ?? null;
      },
      write: async (path, data) => {
        const key = path.replace(/^\/tmp\/?/, '');
        this._tmp.set(key, data);
        return true;
      }
    });
  }

  async vfsRead(path) {
    for (const [mp, handler] of this._mounts) {
      if (path === mp || path.startsWith(mp + '/') || path.startsWith(mp)) {
        try { return await handler.read(path); } catch (e) { return `vfs error: ${e.message}`; }
      }
    }
    return null;
  }

  async vfsList(path) {
    const clean = path.replace(/\/$/, '') || '/';
    if (clean === '/') {
      return [...this._mounts.keys()].map(mp => ({ name: mp.slice(1), type: 'dir' }));
    }
    for (const [mp, handler] of this._mounts) {
      if (clean === mp || clean.startsWith(mp + '/')) {
        try { return await handler.list(clean); } catch { return []; }
      }
    }
    return [];
  }

  async vfsWrite(path, data) {
    for (const [mp, handler] of this._mounts) {
      if ((path === mp || path.startsWith(mp + '/')) && handler.write) {
        try { return await handler.write(path, data); } catch { return false; }
      }
    }
    return false;
  }

  async vfsExec(path, args = {}) {
    for (const [mp, handler] of this._mounts) {
      if ((path === mp || path.startsWith(mp + '/')) && handler.exec) {
        try { return await handler.exec(path, args); } catch (e) { return `exec error: ${e.message}`; }
      }
    }
    return null;
  }

  // ─── IPC ─────────────────────────────────────────────────────────────────

  send(fromPid, toPid, message) {
    const queue = this._ipcQueues.get(toPid);
    if (!queue) return false;
    const msg = { from: fromPid, to: toPid, message, at: Date.now() };
    queue.push(msg);
    const handler = this._ipcHandlers.get(toPid);
    if (handler) {
      handler(msg);
      this._ipcQueues.set(toPid, []);
    }
    this._emit('ipc', msg);
    return true;
  }

  onMessage(pid, handler) {
    this._ipcHandlers.set(pid, handler);
    const queued = this._ipcQueues.get(pid) || [];
    queued.forEach(msg => handler(msg));
    this._ipcQueues.set(pid, []);
  }

  offMessage(pid) {
    this._ipcHandlers.delete(pid);
  }

  broadcast(message, fromPid = 0) {
    for (const pid of this._procs.keys()) {
      if (pid !== fromPid) this.send(fromPid, pid, message);
    }
  }

  // ─── AI Tools ────────────────────────────────────────────────────────────

  _registerAITools() {
    this._tools.set('soma_chat', {
      description: 'Ask SOMA a question or give it a task',
      handler: async ({ prompt, pid }) => this._callSoma(prompt, pid)
    });
    this._tools.set('web_search', {
      description: 'Search the web via Brave Search',
      handler: async ({ query }) => this._execTool('web_search', { query, num_results: 5 })
    });
    this._tools.set('fetch_url', {
      description: 'Fetch and extract a URL',
      handler: async ({ url }) => this._execTool('fetch_url', { url })
    });
    this._tools.set('remember', {
      description: 'Store a memory in SOMA',
      handler: async ({ content, tags }) => this._execTool('remember', { content, tags })
    });
    this._tools.set('recall', {
      description: 'Recall from SOMA memory',
      handler: async ({ query }) => this._execTool('hybrid_search', { query, limit: 5 })
    });
    this._tools.set('read_file', {
      description: 'Read a VFS path',
      handler: async ({ path }) => this.vfsRead(path)
    });
    this._tools.set('write_file', {
      description: 'Write to a VFS path',
      handler: async ({ path, content }) => this.vfsWrite(path, content)
    });
    this._tools.set('list_dir', {
      description: 'List a VFS directory',
      handler: async ({ path }) => JSON.stringify(await this.vfsList(path), null, 2)
    });
    this._tools.set('exec_app', {
      description: 'Launch an Aperture application',
      handler: async ({ app, pid }) => {
        const newPid = this.syscall('exec', { app }, pid);
        return `Launched ${app} as PID ${newPid}`;
      }
    });
    this._tools.set('kill_process', {
      description: 'Terminate a process by PID',
      handler: async ({ pid }) => {
        const ok = this.kill(parseInt(pid), 'SIGTERM');
        return ok ? `Terminated ${pid}` : `Cannot kill ${pid}`;
      }
    });
    this._tools.set('ps', {
      description: 'List running processes',
      handler: async () => JSON.stringify(this.listProcesses(), null, 2)
    });
  }

  async callTool(name, args = {}) {
    const tool = this._tools.get(name);
    if (!tool) return `tool not found: ${name}`;
    try { return await tool.handler(args); } catch (e) { return `tool error: ${e.message}`; }
  }

  listTools() {
    return [...this._tools.entries()].map(([name, t]) => ({ name, description: t.description }));
  }

  async _callSoma(prompt, callerPid = 0) {
    try {
      const ctx = this._aiContexts.get(callerPid) || [];
      const result = await somaBackend.sendChat(prompt, {
        source: 'aperture_kernel',
        sessionId: `aperture:${callerPid}`,
        history: ctx.slice(-6)
      });
      const reply = result?.response || result?.message || 'No response';
      // Keep rolling context per pid
      this._aiContexts.set(callerPid, [
        ...ctx,
        { role: 'user', content: prompt },
        { role: 'assistant', content: reply }
      ].slice(-12));
      return reply;
    } catch (e) {
      return `soma-brain error: ${e.message}`;
    }
  }

  async _execTool(tool, args) {
    try {
      const result = await somaBackend.fetch('/api/soma/execute-tool', {
        method: 'POST',
        body: JSON.stringify({ tool, args })
      });
      if (!result.success) throw new Error(result.error || 'tool unavailable');
      return result.output || '';
    } catch (e) {
      return `tool error: ${e.message}`;
    }
  }

  // ─── Syscall Dispatch ────────────────────────────────────────────────────

  syscall(name, args = {}, callerPid = 0) {
    const entry = { syscall: name, pid: callerPid, at: Date.now() };
    this.syscallLog = [...this.syscallLog.slice(-199), entry];
    this._emit('syscall', entry);

    switch (name) {
      case 'getpid':    return callerPid;
      case 'getppid':   return this._procs.get(callerPid)?.ppid ?? 0;
      case 'ps':        return this.listProcesses();
      case 'kill':      return this.kill(args.pid, args.signal || 'SIGTERM');
      case 'suspend':   return this.suspend(args.pid);
      case 'resume':    return this.resume(args.pid);
      case 'send':      return this.send(callerPid, args.to, args.message);
      case 'broadcast': return this.broadcast(args.message, callerPid);
      case 'uname':     return { sysname: 'ApertureOS', version: this.version, machine: 'x86_64', uptime: Date.now() - this.bootTime };
      case 'uptime':    return Math.floor((Date.now() - (this.bootTime || Date.now())) / 1000);
      case 'mem':       return this._memInfo();
      case 'mounts':    return [...this._mounts.keys()];
      case 'tools':     return this.listTools();
      case 'stat':      return this._stat(args.path);
      case 'notify':    return this.notify(args.title, args.body, args);
      case 'exec': {
        const pid = this._rawSpawn(args.app, args.app, { ppid: callerPid });
        this._emit('exec-request', { appId: args.app, pid, args: args.args || {} });
        return pid;
      }
      default:
        return null;
    }
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  _stat(path) {
    if (!path) return null;
    for (const mp of this._mounts.keys()) {
      if (path === mp || path.startsWith(mp + '/')) return { path, mount: mp, type: 'vfs' };
    }
    return null;
  }

  _memInfo() {
    const procMem = [...this._procs.values()].reduce((s, p) => s + (p.memory || 0), 0);
    return { kernel: 14, processes: procMem, total: procMem + 14, unit: 'MB' };
  }

  _procStatus(p) {
    return [
      `Name:\t${p.name}`,
      `Pid:\t${p.pid}`,
      `PPid:\t${p.ppid}`,
      `State:\t${p.state}`,
      `VmRSS:\t${p.memory} MB`,
      `System:\t${p.system}`,
      `Started:\t${new Date(p.startedAt).toISOString()}`,
      p.windowId ? `Window:\t${p.windowId}` : null,
    ].filter(Boolean).join('\n');
  }

  _klog(message) {
    this.bootLog = [...this.bootLog, { at: Date.now(), message }];
    this._emit('boot-log', { message });
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => { try { fn(data); } catch {} });
  }

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

const kernel = new ApertureKernel();
export default kernel;
