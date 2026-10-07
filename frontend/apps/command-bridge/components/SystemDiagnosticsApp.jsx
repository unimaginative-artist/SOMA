import React, { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  Activity,
  Wifi,
  Zap,
  Flame,
  Server,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
  Database
} from 'lucide-react';

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '—';
  const mb = bytes / 1048576;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
};

const Card = ({ title, icon: Icon, children, tone = 'neutral' }) => (
  <div className={`diagnostics-card diagnostics-card-${tone}`}>
    <div className="diagnostics-card-header">
      <div className="diagnostics-card-title">
        <span className={`diagnostics-card-icon diagnostics-card-icon-${tone}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span>{title}</span>
      </div>
    </div>
    <div className="diagnostics-card-body">{children}</div>
  </div>
);

const SystemDiagnosticsApp = ({ isOpen, onClose, somaBackend, diagnosticLogs = [], isConnected }) => {
  const [snapshot, setSnapshot] = useState(null);
  const [health, setHealth] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [gpu, setGpu] = useState([]);
  const [network, setNetwork] = useState([]);
  const [memoryTiers, setMemoryTiers] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);
  const [lastScanAt, setLastScanAt] = useState(null);

  useEffect(() => {
    if (!isOpen || !isConnected) return;
    let active = true;

    const fetchAll = async () => {
      try {
        const [
          stateRes,
          healthRes,
          procRes,
          gpuRes,
          netRes,
          memRes
        ] = await Promise.allSettled([
          somaBackend.fetch('/api/system/state'),
          somaBackend.fetch('/api/health'),
          somaBackend.fetch('/api/system/processes'),
          somaBackend.fetch('/api/system/gpu'),
          somaBackend.fetch('/api/system/network'),
          somaBackend.fetch('/api/memory/status')
        ]);

        if (!active) return;
        setError(null);

        if (stateRes.status === 'fulfilled') setSnapshot(stateRes.value.snapshot || null);
        if (healthRes.status === 'fulfilled') setHealth(healthRes.value || null);
        if (procRes.status === 'fulfilled' && procRes.value.success) setProcesses(procRes.value.processes || []);
        if (gpuRes.status === 'fulfilled' && gpuRes.value.success) setGpu(gpuRes.value.gpus || []);
        if (netRes.status === 'fulfilled' && netRes.value.success) setNetwork(netRes.value.adapters || []);
        if (memRes.status === 'fulfilled') setMemoryTiers(memRes.value || null);
      } catch (e) {
        if (!active) return;
        setError(e.message);
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isOpen, isConnected, somaBackend]);

  const systemStatus = snapshot?.status || 'initializing';
  const uptime = snapshot?.uptime || 0;
  const cpu = snapshot?.cpu;
  const ram = snapshot?.ram;
  const gpuLoad = useMemo(() => {
    if (!Array.isArray(gpu) || gpu.length === 0) return null;
    return gpu.reduce((sum, g) => sum + (Number(g.utilization) || 0), 0) / gpu.length;
  }, [gpu]);

  const handleScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setError(null);
    try {
      await somaBackend.fetch('/api/command', { method: 'POST', body: JSON.stringify({ action: 'run_diagnostics' }) });
      setLastScanAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setIsScanning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="diagnostics-overlay">
      <div className="diagnostics-shell">
        <style>{`
          .diagnostics-overlay {
            position: fixed;
            inset: 0;
            background: radial-gradient(circle at top, rgba(25,25,30,0.92), rgba(5,5,8,0.98));
            backdrop-filter: blur(10px);
            z-index: 250;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
          }
          .diagnostics-shell {
            width: min(1200px, 95vw);
            max-height: 92vh;
            display: flex;
            flex-direction: column;
            gap: 20px;
            position: relative;
            background:
              radial-gradient(circle at 10% 5%, rgba(56,189,248,0.08), transparent 55%),
              radial-gradient(circle at 90% 0%, rgba(168,85,247,0.08), transparent 55%),
              linear-gradient(145deg, rgba(18,18,22,0.96), rgba(8,8,12,0.98));
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 30px 80px rgba(0,0,0,0.6);
            border-radius: 24px;
            padding: 24px;
            font-family: 'Space Grotesk', 'Sora', 'Segoe UI', sans-serif;
          }
          .diagnostics-shell::after {
            content: '';
            position: absolute;
            inset: 24px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.04);
            pointer-events: none;
          }
          .diagnostics-body {
            overflow-y: auto;
            padding-right: 4px;
            max-height: calc(92vh - 220px);
          }
          .diagnostics-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }
          .diagnostics-header h2 {
            font-size: 20px;
            font-weight: 700;
            color: #f8fafc;
            letter-spacing: 0.02em;
            margin: 0;
          }
          .diagnostics-subtitle {
            font-size: 12px;
            color: #9ca3af;
            letter-spacing: 0.2em;
            text-transform: uppercase;
          }
          .diagnostics-chip-row {
            margin-top: 10px;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .diagnostics-chip {
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.12);
            font-size: 11px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #cbd5f5;
          }
          .diagnostics-actions {
            display: flex;
            gap: 12px;
            align-items: center;
            flex-wrap: wrap;
          }
          .diagnostics-button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.04);
            color: #e2e8f0;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            transition: all 0.2s ease;
          }
          .diagnostics-button:hover {
            background: rgba(255,255,255,0.08);
          }
          .diagnostics-close {
            background: rgba(255,255,255,0.06);
          }
          .diagnostics-grid {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 16px;
          }
          .diagnostics-card {
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.06);
            padding: 16px;
            background: rgba(11,11,14,0.9);
            transition: transform 0.2s ease, border-color 0.2s ease;
          }
          .diagnostics-card:hover {
            transform: translateY(-2px);
            border-color: rgba(255,255,255,0.12);
          }
          .diagnostics-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            color: #e5e7eb;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.16em;
          }
          .diagnostics-card-title {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .diagnostics-card-icon {
            width: 28px;
            height: 28px;
            border-radius: 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #f8fafc;
          }
          .diagnostics-card-icon-neutral { background: rgba(148,163,184,0.12); }
          .diagnostics-card-icon-success { background: rgba(16,185,129,0.15); }
          .diagnostics-card-icon-warning { background: rgba(251,191,36,0.18); }
          .diagnostics-card-icon-danger { background: rgba(248,113,113,0.16); }
          .diagnostics-card-body {
            color: #e5e7eb;
            font-size: 13px;
          }
          .diagnostics-card-success { border-color: rgba(16,185,129,0.2); }
          .diagnostics-card-warning { border-color: rgba(251,191,36,0.2); }
          .diagnostics-card-danger { border-color: rgba(248,113,113,0.2); }
          .diagnostics-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 180px;
            overflow: auto;
          }
          .diagnostics-list-item {
            padding: 10px;
            border-radius: 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            display: flex;
            justify-content: space-between;
            font-size: 12px;
          }
          .diagnostics-logs {
            background: #060607;
            border-radius: 14px;
            padding: 14px;
            border: 1px solid rgba(255,255,255,0.08);
            max-height: 220px;
            overflow: auto;
            font-family: 'IBM Plex Mono', 'JetBrains Mono', monospace;
            font-size: 11px;
            color: #cbd5f5;
          }
          .diagnostics-logs-line {
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.04);
          }
          .diagnostics-logs-line:last-child { border-bottom: none; }
          .diagnostics-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 999px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.16em;
          }
          .diagnostics-pill-success {
            background: rgba(16,185,129,0.14);
            color: #34d399;
            border: 1px solid rgba(16,185,129,0.3);
          }
          .diagnostics-pill-warning {
            background: rgba(251,191,36,0.16);
            color: #fbbf24;
            border: 1px solid rgba(251,191,36,0.3);
          }
          .diagnostics-pill-danger {
            background: rgba(248,113,113,0.16);
            color: #f87171;
            border: 1px solid rgba(248,113,113,0.3);
          }
          .diagnostics-row {
            display: flex;
            gap: 16px;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
          }
          .diagnostics-kicker {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: #64748b;
          }
          .diagnostics-alert {
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(239,68,68,0.08);
            border: 1px solid rgba(239,68,68,0.3);
            color: #fca5a5;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          @media (max-width: 1100px) {
            .diagnostics-grid { grid-template-columns: repeat(6, 1fr); }
            .diagnostics-body { max-height: calc(92vh - 240px); }
          }
          @media (max-width: 720px) {
            .diagnostics-overlay { padding: 12px; }
            .diagnostics-shell { padding: 16px; }
            .diagnostics-grid { grid-template-columns: repeat(4, 1fr); }
            .diagnostics-body { max-height: calc(92vh - 260px); }
          }
        `}</style>

        <div className="diagnostics-header">
          <div>
            <div className="diagnostics-subtitle">System Diagnostics</div>
            <h2>Command Bridge Health Console</h2>
            <div className="diagnostics-chip-row">
              <div className="diagnostics-chip">CPU {Number.isFinite(cpu) ? `${cpu.toFixed(1)}%` : '—'}</div>
              <div className="diagnostics-chip">RAM {Number.isFinite(ram) ? `${ram.toFixed(1)}%` : '—'}</div>
              <div className="diagnostics-chip">GPU {Number.isFinite(gpuLoad) ? `${gpuLoad.toFixed(1)}%` : '—'}</div>
            </div>
          </div>
          <div className="diagnostics-actions">
            <div className="diagnostics-kicker">
              {lastScanAt ? `Last scan ${new Date(lastScanAt).toLocaleTimeString()}` : 'No scan yet'}
            </div>
            <button className="diagnostics-button" onClick={handleScan}>
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Scanning' : 'Run Full Scan'}
            </button>
            <button className="diagnostics-button diagnostics-close" onClick={onClose}>
              <X className="w-4 h-4" />
              Close
            </button>
          </div>
        </div>
        <div className="diagnostics-row">
          {error ? (
            <div className="diagnostics-alert">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          ) : (
            <div className="diagnostics-kicker">Realtime telemetry active</div>
          )}
        </div>

        <div className="diagnostics-body">
        <div className="diagnostics-grid">
          <div className="diagnostics-card diagnostics-card-success" style={{ gridColumn: 'span 4' }}>
            <div className="diagnostics-card-header">
              <div className="diagnostics-card-title">
                <span className="diagnostics-card-icon diagnostics-card-icon-success">
                  <Shield className="w-4 h-4" />
                </span>
                Core Health
              </div>
              <span className={`diagnostics-pill ${systemStatus === 'online' ? 'diagnostics-pill-success' : 'diagnostics-pill-warning'}`}>
                {systemStatus}
              </span>
            </div>
            <div className="diagnostics-card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>Uptime</span>
                <span>{Math.round(uptime / 60)} min</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>Backend</span>
                <span>{health?.status || 'initializing'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Memory Pressure</span>
                <span>{snapshot?.cognitive?.learning?.active ? 'Learning' : 'Stable'}</span>
              </div>
            </div>
          </div>

          <div className="diagnostics-card" style={{ gridColumn: 'span 4' }}>
            <div className="diagnostics-card-header">
              <div className="diagnostics-card-title">
                <span className="diagnostics-card-icon diagnostics-card-icon-warning">
                  <Flame className="w-4 h-4" />
                </span>
                Autonomy
              </div>
            </div>
            <div className="diagnostics-card-body">
              <div className="diagnostics-list">
                <div className="diagnostics-list-item">
                  <span>Active Arbiters</span>
                  <span>{snapshot?.counts?.arbiters || 0}</span>
                </div>
                <div className="diagnostics-list-item">
                  <span>Micro Agents</span>
                  <span>{snapshot?.counts?.microAgents || 0}</span>
                </div>
                <div className="diagnostics-list-item">
                  <span>Fragments</span>
                  <span>{snapshot?.counts?.fragments || 0}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="diagnostics-card" style={{ gridColumn: 'span 6' }}>
            <div className="diagnostics-card-header">
              <div className="diagnostics-card-title">
                <span className="diagnostics-card-icon diagnostics-card-icon-neutral">
                  <Server className="w-4 h-4" />
                </span>
                Top Processes
              </div>
            </div>
            <div className="diagnostics-card-body">
              <div className="diagnostics-list">
                {processes.length > 0 ? processes.map((proc) => (
                  <div key={`${proc.pid}-${proc.name}`} className="diagnostics-list-item">
                    <span>{proc.name}</span>
                    <span>{proc.cpu?.toFixed?.(1) || 0} CPU · {proc.workingSetMB} MB</span>
                  </div>
                )) : (
                  <div style={{ color: '#6b7280' }}>No process telemetry available.</div>
                )}
              </div>
            </div>
          </div>

          <div className="diagnostics-card" style={{ gridColumn: 'span 6' }}>
            <div className="diagnostics-card-header">
              <div className="diagnostics-card-title">
                <span className="diagnostics-card-icon diagnostics-card-icon-neutral">
                  <Wifi className="w-4 h-4" />
                </span>
                Network Interfaces
              </div>
            </div>
            <div className="diagnostics-card-body">
              <div className="diagnostics-list">
                {network.length > 0 ? network.map((net) => (
                  <div key={net.name} className="diagnostics-list-item">
                    <span>{net.name}</span>
                    <span>RX {formatBytes(net.receivedBytes)} · TX {formatBytes(net.sentBytes)}</span>
                  </div>
                )) : (
                  <div style={{ color: '#6b7280' }}>No adapter stats available.</div>
                )}
              </div>
            </div>
          </div>

          <div className="diagnostics-card" style={{ gridColumn: 'span 6' }}>
            <div className="diagnostics-card-header">
              <div className="diagnostics-card-title">
                <span className="diagnostics-card-icon diagnostics-card-icon-neutral">
                  <Database className="w-4 h-4" />
                </span>
                Memory Tiers
              </div>
            </div>
            <div className="diagnostics-card-body">
              {memoryTiers ? (
                <div className="diagnostics-list">
                  {['hot', 'warm', 'cold'].map((tier) => (
                    <div key={tier} className="diagnostics-list-item">
                      <span>{tier.toUpperCase()}</span>
                      <span>{memoryTiers[tier]?.used || 0} · {memoryTiers[tier]?.hitRate || 0}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#6b7280' }}>Memory tiers unavailable.</div>
              )}
            </div>
          </div>

          <div className="diagnostics-card" style={{ gridColumn: 'span 6' }}>
            <div className="diagnostics-card-header">
              <div className="diagnostics-card-title">
                <span className="diagnostics-card-icon diagnostics-card-icon-neutral">
                  <Zap className="w-4 h-4" />
                </span>
                GPU Overview
              </div>
            </div>
            <div className="diagnostics-card-body">
              {gpu.length > 0 ? (
                <div className="diagnostics-list">
                  {gpu.map((g, idx) => (
                    <div key={`${g.name}-${idx}`} className="diagnostics-list-item">
                      <span>{g.name}</span>
                      <span>{g.utilization}% · {g.memoryUsedMB}/{g.memoryTotalMB} MB</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#6b7280' }}>GPU telemetry unavailable.</div>
              )}
            </div>
          </div>

        </div>

        <Card title="Diagnostic Stream" icon={Activity} tone="neutral">
          <div className="diagnostics-logs">
            {diagnosticLogs.length > 0 ? diagnosticLogs.slice(0, 120).map((line, idx) => (
              <div key={`${idx}-${line}`} className="diagnostics-logs-line">{line}</div>
            )) : (
              <div style={{ color: '#64748b' }}>
                <CheckCircle2 className="w-4 h-4" style={{ display: 'inline-block', marginRight: 6 }} />
                Diagnostics stream ready. Run a scan to populate the feed.
              </div>
            )}
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
};

export default SystemDiagnosticsApp;
