/**
 * ProcessViewer — live Aperture OS process table + AI tool log
 * Shows all kernel processes, syscall ring buffer, IPC feed, AI tool invocations.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Activity, Brain, Cpu, MessageSquare, Radio, RefreshCw, Trash2, Zap, Search } from 'lucide-react';
import kernel from '../kernel/ApertureKernel';

function MemBar({ value, max, color }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="apv-membar">
      <div className="apv-membar-fill" style={{ width: `${pct}%`, background: color }} />
      <span>{value}MB</span>
    </div>
  );
}

const STATE_COLOR = {
  running: '#46d99f',
  suspended: '#ffc85c',
  zombie: '#fb8d98',
};

export default function ProcessViewer() {
  const [procs, setProcs] = useState(() => kernel.listProcesses());
  const [syscalls, setSyscalls] = useState(() => [...kernel.syscallLog].reverse().slice(0, 40));
  const [ipcFeed, setIpcFeed] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('procs');
  const [filter, setFilter] = useState('');
  const [tick, setTick] = useState(0);
  const ipcRef = useRef([]);

  const refresh = () => {
    setProcs(kernel.listProcesses());
    setSyscalls([...kernel.syscallLog].reverse().slice(0, 40));
    setTick(t => t + 1);
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 1200);
    const u1 = kernel.on('process-spawn', refresh);
    const u2 = kernel.on('process-kill', refresh);
    const u3 = kernel.on('process-exit', () => { refresh(); setSelected(null); });
    const u4 = kernel.on('ipc', msg => {
      ipcRef.current = [msg, ...ipcRef.current].slice(0, 60);
      setIpcFeed([...ipcRef.current]);
    });
    return () => { clearInterval(interval); u1(); u2(); u3(); u4(); };
  }, []);

  const totalMem = procs.reduce((s, p) => s + (p.memory || 0), 0);
  const running = procs.filter(p => p.state === 'running').length;
  const suspended = procs.filter(p => p.state === 'suspended').length;

  const selectedProc = procs.find(p => p.id === selected?.id) || selected;

  return (
    <div className="ap-procview">
      {/* Summary strip */}
      <div className="apv-summary">
        <div className="apv-stat">
          <Cpu size={13} />
          <span>{procs.length} Aperture virtual processes</span>
        </div>
        <div className="apv-stat">
          <Activity size={13} />
          <span>{running} running · {suspended} suspended</span>
        </div>
        <div className="apv-stat">
          <Brain size={13} />
          <span title="Modeled by ApertureKernel, not native Windows telemetry">{totalMem}MB modeled budget</span>
        </div>
        <button className="apv-refresh" onClick={refresh}><RefreshCw size={12} /></button>
      </div>

      {/* Tabs */}
      <div className="apv-tabs" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[['procs', Cpu, 'Processes'], ['syscalls', Zap, 'Syscalls'], ['ipc', Radio, 'IPC'], ['tools', Brain, 'AI Tools']].map(([id, Icon, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        {tab === 'procs' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', marginRight: '8px' }}>
            <Search size={11} style={{ opacity: 0.5 }} />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter PID or name..."
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#c8dae5', fontSize: '11px', width: '130px' }}
            />
          </div>
        )}
      </div>

      {/* Process table */}
      {tab === 'procs' && (
        <div className="apv-content">
          <table className="apv-table">
            <thead>
              <tr>
                <th>PID</th>
                <th>NAME</th>
                <th>STATE</th>
                <th>MEM</th>
                <th>PPID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {procs
                .filter(p => !filter || p.name?.toLowerCase().includes(filter.toLowerCase()) || String(p.pid).includes(filter) || p.state?.toLowerCase().includes(filter.toLowerCase()))
                .map(p => (
                <tr
                  key={p.pid}
                  className={`${selected?.pid === p.pid ? 'selected' : ''} ${p.system ? 'system' : ''}`}
                  onClick={() => setSelected(p)}
                >
                  <td className="apv-pid">{p.pid}</td>
                  <td className="apv-name">{p.name}{p.system && <span className="apv-tag">sys</span>}</td>
                  <td>
                    <span className="apv-state" style={{ color: STATE_COLOR[p.state] || '#9faeb8' }}>
                      {p.state}
                    </span>
                  </td>
                  <td>
                    <MemBar value={p.memory || 0} max={totalMem} color={p.system ? '#5c71dd' : '#42e0da'} />
                  </td>
                  <td className="apv-ppid">{p.ppid}</td>
                  <td>
                    {!p.system && (
                      <button className="apv-kill" title="Kill process" onClick={e => { e.stopPropagation(); kernel.kill(p.pid, 'SIGKILL'); }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selected && (
            <div className="apv-detail">
              <strong>{selected.name}</strong>
              <div className="apv-detail-grid">
                <span>PID</span><span>{selected.pid}</span>
                <span>PPID</span><span>{selected.ppid}</span>
                <span>State</span><span style={{ color: STATE_COLOR[selected.state] }}>{selected.state}</span>
                <span>Memory</span><span>{selected.memory}MB</span>
                <span>System</span><span>{selected.system ? 'yes' : 'no'}</span>
                <span>App</span><span>{selected.appId}</span>
                {selected.windowId && <><span>Window</span><span>{selected.windowId}</span></>}
                <span>Started</span><span>{new Date(selected.startedAt).toLocaleTimeString()}</span>
              </div>
              {!selected.system && (
                <div className="apv-detail-actions">
                  <button onClick={() => kernel.suspend(selected.pid)}>Suspend</button>
                  <button onClick={() => kernel.resume(selected.pid)}>Resume</button>
                  <button className="danger" onClick={() => kernel.kill(selected.pid, 'SIGKILL')}>Kill</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Syscall log */}
      {tab === 'syscalls' && (
        <div className="apv-content apv-log">
          {!syscalls.length && <p className="apv-empty">No syscalls recorded yet.</p>}
          {syscalls.map((s, i) => (
            <div key={i} className="apv-log-entry">
              <span className="apv-log-pid">pid:{s.pid}</span>
              <span className="apv-log-name">{s.syscall}</span>
              <span className="apv-log-time">{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}

      {/* IPC feed */}
      {tab === 'ipc' && (
        <div className="apv-content apv-log">
          {!ipcFeed.length && <p className="apv-empty">No IPC messages yet. Use <code>ipc &lt;pid&gt; &lt;msg&gt;</code> in Terminal.</p>}
          {ipcFeed.map((m, i) => (
            <div key={i} className="apv-log-entry apv-log-ipc">
              <MessageSquare size={11} />
              <span className="apv-log-pid">{m.from} → {m.to}</span>
              <span className="apv-log-msg">{typeof m.message === 'object' ? JSON.stringify(m.message) : String(m.message)}</span>
              <span className="apv-log-time">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}

      {/* AI tools */}
      {tab === 'tools' && (
        <div className="apv-content apv-tools">
          <p className="apv-tools-header">Kernel AI tools available via <code>tool &lt;name&gt;</code> in Terminal</p>
          {kernel.listTools().map(t => (
            <div key={t.name} className="apv-tool-entry">
              <Brain size={12} />
              <span className="apv-tool-name">{t.name}</span>
              <span className="apv-tool-desc">{t.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
