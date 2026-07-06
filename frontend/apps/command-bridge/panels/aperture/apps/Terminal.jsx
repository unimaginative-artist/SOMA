/**
 * Aperture Terminal — aperture-sh
 *
 * AI-first shell: every unrecognized command is routed to SOMA.
 * Built-in commands mirror a real Unix shell.
 * `ai <message>` → direct SOMA chat with rolling context
 * `tool <name> [args]` → kernel AI tool invocation
 * `think <message>` → deep reasoning request
 * `exec <app>` → launch Aperture app
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as TermIcon } from 'lucide-react';
import kernel from '../kernel/ApertureKernel';
import somaBackend from '../../../somaBackend';

const PROMPT_BASE = 'root@aperture';
const ANSI = {
  reset: '', green: '', cyan: '', yellow: '', red: '', dim: '', bold: '',
};

function ts() {
  const s = Math.floor((Date.now() - (kernel.bootTime || Date.now())) / 1000);
  return `[${s.toFixed(3).padStart(8, ' ')}]`;
}

// ─── Built-in command handlers ──────────────────────────────────────────────

async function cmdHelp() {
  return [
    '╔═══════════════════════════════════════════╗',
    '║  ApertureOS Shell (aperture-sh 1.0)       ║',
    '║  AI-first OS — SOMA is always available   ║',
    '╚═══════════════════════════════════════════╝',
    '',
    'SYSTEM COMMANDS',
    '  uname [-a]          System information',
    '  uptime              Time since kernel boot',
    '  ps                  Running process table',
    '  kill <pid>          Terminate process by PID',
    '  mem                 Memory usage report',
    '  mount               Virtual filesystem mounts',
    '  dmesg               Kernel boot log',
    '  clear               Clear terminal',
    '',
    'FILESYSTEM',
    '  ls [path]           List VFS directory',
    '  cat <path>          Read VFS file',
    '  write <path> <data> Write to /tmp/*',
    '  stat <path>         File info',
    '',
    'APPLICATIONS',
    '  exec <app>          Launch app  (files|notes|tasks|calendar|portal|status|archive|settings|terminal|processes)',
    '',
    'AI LAYER — AI-FIRST FEATURES',
    '  ai <message>        Ask SOMA anything (rolling context per session)',
    '  think <message>     Deep reasoning request',
    '  tool list           List all kernel AI tools',
    '  tool <name> <json>  Call a kernel AI tool',
    '  recall <query>      Search SOMA memory',
    '  search <query>      Web search via Brave',
    '  ipc <pid> <msg>     Send IPC message to process',
    '  broadcast <msg>     Broadcast IPC to all processes',
    '',
    '  Any unrecognized command is auto-routed to SOMA.',
  ].join('\n');
}

async function cmdUname(args) {
  const info = kernel.syscall('uname');
  if (args.includes('-a')) {
    return `${info.sysname} aperture 1.0.0 ${new Date().toUTCString()} x86_64 ApertureOS`;
  }
  return info.sysname;
}

async function cmdUptime() {
  const secs = kernel.syscall('uptime');
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mem = kernel.syscall('mem');
  return `up ${h}h ${m}m ${s}s  |  load: ${(Math.random() * 0.8 + 0.1).toFixed(2)}  |  mem: ${mem.processes}MB / ${mem.total}MB`;
}

async function cmdPs() {
  const procs = kernel.syscall('ps');
  const hdr = '  PID  PPID  MEM    STATE       NAME';
  const sep = '  ─────────────────────────────────────────';
  const rows = procs.map(p =>
    `  ${String(p.pid).padEnd(5)}${String(p.ppid).padEnd(6)}${(p.memory + 'MB').padEnd(7)}${p.state.padEnd(12)}${p.name}`
  );
  return [hdr, sep, ...rows].join('\n');
}

async function cmdKill(args) {
  const target = parseInt(args[0]);
  if (isNaN(target)) return 'kill: usage: kill <pid>';
  const ok = kernel.kill(target, args[1] || 'SIGTERM');
  return ok ? `Sent SIGTERM to process ${target}` : `kill: (${target}) — no such process or protected`;
}

async function cmdMem() {
  const m = kernel.syscall('mem');
  const bar = (used, total) => {
    const pct = Math.min(1, used / total);
    const filled = Math.round(pct * 20);
    return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + `] ${used}MB / ${total}MB`;
  };
  return [
    'Memory usage',
    `  Kernel   ${bar(m.kernel, m.total)}`,
    `  Procs    ${bar(m.processes, m.total)}`,
    `  Total    ${m.total}MB allocated`,
  ].join('\n');
}

async function cmdMount() {
  const mounts = kernel.syscall('mounts');
  return mounts.map(mp => `${mp.padEnd(16)} on ${mp.padEnd(16)} type aperture-vfs (rw,noatime)`).join('\n');
}

async function cmdLs(args) {
  const path = args[0] || '/';
  const entries = await kernel.vfsList(path);
  if (!entries || !entries.length) return `ls: cannot access '${path}': No such directory`;
  return entries.map(e => {
    const prefix = e.type === 'dir' ? 'd' : e.type === 'device' ? 'c' : '-';
    const name = e.type === 'dir' ? `${e.name}/` : e.name;
    return `${prefix}rwxr-xr-x  aperture  aperture  ${name}${e.title ? `  (${e.title})` : ''}`;
  }).join('\n');
}

async function cmdCat(args) {
  const path = args[0];
  if (!path) return 'cat: missing file operand\nusage: cat <path>';
  const content = await kernel.vfsRead(path);
  if (content === null || content === undefined) return `cat: ${path}: No such file or directory`;
  return content;
}

async function cmdWrite(args) {
  const path = args[0];
  const data = args.slice(1).join(' ');
  if (!path || !data) return 'write: usage: write <path> <data>\n(only /tmp/* is writable)';
  const ok = await kernel.vfsWrite(path, data);
  return ok ? `Written to ${path}` : `write: ${path}: Permission denied or path not writable`;
}

async function cmdStat(args) {
  const path = args[0];
  if (!path) return 'stat: missing path';
  const info = kernel.syscall('stat', { path });
  if (!info) return `stat: ${path}: No such file or directory`;
  return [
    `  File: ${path}`,
    `  Mount: ${info.mount}`,
    `  Type: ${info.type}`,
    `  Access: rw-r--r--`,
    `  Modified: ${new Date().toISOString()}`,
  ].join('\n');
}

async function cmdExec(args, callerPid) {
  const appId = args[0];
  if (!appId) return 'exec: usage: exec <app>';
  const pid = kernel.syscall('exec', { app: appId }, callerPid);
  return `Spawned '${appId}' → PID ${pid}`;
}

async function cmdDmesg() {
  if (!kernel.bootLog.length) return '[no kernel log]';
  return kernel.bootLog.map(entry => {
    const elapsed = ((entry.at - (kernel.bootTime || entry.at)) / 1000).toFixed(6);
    return `${ts()} ${entry.message}`;
  }).join('\n');
}

async function cmdTool(args, callerPid) {
  const name = args[0];
  if (!name || name === 'list') {
    const tools = kernel.syscall('tools');
    return ['Available kernel AI tools:', ''].concat(
      tools.map(t => `  ${t.name.padEnd(20)} ${t.description}`)
    ).join('\n');
  }
  let parsedArgs = {};
  if (args[1]) {
    try { parsedArgs = JSON.parse(args.slice(1).join(' ')); }
    catch { parsedArgs = { input: args.slice(1).join(' '), query: args.slice(1).join(' '), prompt: args.slice(1).join(' ') }; }
  }
  parsedArgs.pid = callerPid;
  return await kernel.callTool(name, parsedArgs);
}

async function cmdRecall(args) {
  const query = args.join(' ');
  if (!query) return 'recall: usage: recall <query>';
  return await kernel.callTool('recall', { query });
}

async function cmdSearch(args) {
  const query = args.join(' ');
  if (!query) return 'search: usage: search <query>';
  return await kernel.callTool('web_search', { query });
}

async function cmdIpc(args, callerPid) {
  const toPid = parseInt(args[0]);
  const message = args.slice(1).join(' ');
  if (!toPid || !message) return 'ipc: usage: ipc <pid> <message>';
  const ok = kernel.send(callerPid, toPid, { type: 'shell-message', text: message });
  return ok ? `Sent IPC to PID ${toPid}` : `ipc: PID ${toPid} not found`;
}

async function cmdBroadcast(args, callerPid) {
  const message = args.join(' ');
  if (!message) return 'broadcast: usage: broadcast <message>';
  kernel.broadcast({ type: 'shell-broadcast', text: message }, callerPid);
  return `Broadcast sent to ${kernel.listProcesses().length - 1} processes`;
}

// ─── Command registry ─────────────────────────────────────────────────────

const BUILTINS = {
  help: cmdHelp,
  uname: cmdUname,
  uptime: cmdUptime,
  ps: cmdPs,
  kill: cmdKill,
  mem: cmdMem,
  mount: cmdMount,
  ls: cmdLs,
  cat: cmdCat,
  write: cmdWrite,
  stat: cmdStat,
  exec: cmdExec,
  dmesg: cmdDmesg,
  tool: cmdTool,
  recall: cmdRecall,
  search: cmdSearch,
  ipc: cmdIpc,
  broadcast: cmdBroadcast,
  open: async (args, callerPid) => {
    const path = args[0];
    if (!path) return 'open: usage: open <path|url>';
    const result = kernel.open(path, callerPid);
    return `Opening ${path} → ${result.appId} (PID ${result.pid})`;
  },
  echo: async (args) => args.join(' '),
  pwd: async () => '/',
  whoami: async () => 'root (aperture kernel context)',
  hostname: async () => 'aperture.local',
  date: async () => new Date().toString(),
  env: async () => [
    'OS=ApertureOS',
    'SHELL=aperture-sh',
    'AI_BRAIN=soma/deepseek-cascade',
    'VFS_MOUNTS=/proc,/dev,/axis,/reflections,/portal,/soma,/tmp',
    'TERM=aperture-256color',
  ].join('\n'),
};

// ─── Terminal component ───────────────────────────────────────────────────

const INITIAL_LINES = [
  { text: kernel.version || 'ApertureOS 1.0.0', type: 'system' },
  { text: "aperture-sh — AI-first shell. Type 'help' or just ask SOMA anything.", type: 'system' },
  { text: '', type: 'blank' },
];

export default function Terminal() {
  const [lines, setLines] = useState(INITIAL_LINES);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [pid] = useState(() => {
    if (kernel.state === 'running') return kernel.spawn('terminal', 'aperture-sh', { ppid: 1 });
    return null;
  });

  const endRef = useRef(null);
  const inputRef = useRef(null);

  const prompt = `root@aperture:~$`;

  const appendLines = useCallback((...newLines) => {
    setLines(prev => [...prev, ...newLines.map(l =>
      typeof l === 'string' ? { text: l, type: 'output' } : l
    )]);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (!pid) return;
    kernel.onMessage(pid, msg => {
      appendLines({ text: `[IPC:${msg.from}] ${JSON.stringify(msg.message)}`, type: 'ipc' });
    });
    return () => {
      kernel.offMessage(pid);
      if (pid) kernel.kill(pid, 'SIGHUP');
    };
  }, [pid, appendLines]);

  // Boot log tail if kernel boots after terminal opens
  useEffect(() => {
    const unsub = kernel.on('boot-log', ({ message }) => {
      if (message.trim()) appendLines({ text: `${ts()} ${message}`, type: 'boot' });
    });
    return unsub;
  }, [appendLines]);

  const runCommand = useCallback(async (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    appendLines({ text: `${prompt} ${trimmed}`, type: 'prompt' });
    setHistory(prev => [trimmed, ...prev.slice(0, 99)]);
    setHistIdx(-1);

    if (trimmed === 'clear') { setLines([]); return; }

    const [cmd, ...args] = trimmed.split(/\s+/);

    // ai / think → direct SOMA
    if (cmd === 'ai' || cmd === 'think' || cmd === 'ask') {
      const question = args.join(' ');
      if (!question) { appendLines({ text: `${cmd}: provide a message`, type: 'error' }); return; }
      setBusy(true);
      appendLines({ text: `[SOMA thinking...]`, type: 'dim' });
      const reply = await kernel.callTool('soma_chat', { prompt: (cmd === 'think' ? '[DEEP REASONING] ' : '') + question, pid });
      setLines(prev => [...prev.slice(0, -1), { text: `[SOMA] ${reply}`, type: 'ai' }]);
      setBusy(false);
      return;
    }

    // soma cli commands
    if (cmd === 'soma' && args[0] === 'publish') {
      const site = args[1];
      if (!site) { appendLines({ text: 'soma: usage: soma publish <site>', type: 'error' }); return; }
      setBusy(true);
      try {
        const r = await somaBackend.fetch('/api/gmn/sites/publish-artifact', {
          method: 'POST',
          body: JSON.stringify({ site })
        });
        if (r.success) {
          appendLines({ text: `✓ Published: ${r.canonical}`, type: 'output' });
        } else {
          appendLines({ text: `soma: publish failed: ${r.error || 'Unknown error'}`, type: 'error' });
        }
      } catch (e) {
        appendLines({ text: `soma: network error: ${e.message}`, type: 'error' });
      } finally {
        setBusy(false);
      }
      return;
    }

    const handler = BUILTINS[cmd];
    if (handler) {
      setBusy(true);
      try {
        const out = await handler(args, pid);
        if (out) appendLines(...out.split('\n').map(t => ({ text: t, type: 'output' })));
      } catch (e) {
        appendLines({ text: `${cmd}: ${e.message}`, type: 'error' });
      } finally {
        setBusy(false);
      }
      return;
    }

    // Unknown command → route to SOMA
    setBusy(true);
    appendLines({ text: `[SOMA — auto-routing '${cmd}']`, type: 'dim' });
    const reply = await kernel.callTool('soma_chat', { prompt: trimmed, pid });
    setLines(prev => [...prev.slice(0, -1), { text: `[SOMA] ${reply}`, type: 'ai' }]);
    setBusy(false);
  }, [pid, prompt, appendLines]);

  const handleKey = useCallback(async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (busy) return;
      const val = input;
      setInput('');
      await runCommand(val);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx < 0 ? '' : (history[idx] || ''));
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      if (busy) setBusy(false);
      appendLines({ text: `${prompt} ${input}^C`, type: 'prompt' });
      setInput('');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const partial = input.split(' ')[0];
      const matches = Object.keys(BUILTINS).filter(k => k.startsWith(partial));
      if (matches.length === 1) setInput(input.replace(partial, matches[0]) + ' ');
      else if (matches.length > 1) appendLines({ text: matches.join('  '), type: 'dim' });
    }
  }, [busy, history, histIdx, input, prompt, appendLines, runCommand]);

  const typeClass = {
    system: 'ap-term-system',
    boot: 'ap-term-boot',
    prompt: 'ap-term-prompt',
    output: 'ap-term-output',
    ai: 'ap-term-ai',
    error: 'ap-term-error',
    dim: 'ap-term-dim',
    ipc: 'ap-term-ipc',
    blank: 'ap-term-blank',
  };

  return (
    <div className="ap-terminal" onClick={() => inputRef.current?.focus()}>
      <div className="ap-term-header">
        <TermIcon size={13} />
        <span>aperture-sh</span>
        {pid && <small>PID {pid}</small>}
        {busy && <span className="ap-term-busy">●</span>}
      </div>
      <div className="ap-term-body">
        {lines.map((line, i) => (
          <div key={i} className={`ap-term-line ${typeClass[line.type] || ''}`}>
            {line.text === '' ? ' ' : line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="ap-term-inputrow">
        <span className="ap-term-promptlabel">{prompt}</span>
        <input
          ref={inputRef}
          className="ap-term-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {busy && <span className="ap-term-cursor-blink">▋</span>}
      </div>
    </div>
  );
}
