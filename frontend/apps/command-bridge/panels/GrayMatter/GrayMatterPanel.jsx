import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wifi, WifiOff, Plus, Trash2, RefreshCw, Shield, ShieldCheck, Radio, Circle } from 'lucide-react';

const POLL_MS = 5000;

function timeAgo(ms) {
    if (!ms) return '—';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60)  return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

function StatusDot({ online }) {
    return (
        <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: online ? '#22d3ee' : '#3f3f46',
            boxShadow: online ? '0 0 6px #22d3ee88' : 'none',
        }} />
    );
}

function PeerRow({ peer, onRemove }) {
    const [removing, setRemoving] = useState(false);
    const online = peer.status === 'online';

    const handleRemove = async () => {
        if (peer.isLocal) return;
        setRemoving(true);
        try {
            await fetch(`/api/soma/gmn/peer/${encodeURIComponent(peer.address)}`, { method: 'DELETE' });
            onRemove(peer.id);
        } catch { setRemoving(false); }
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderRadius: 8, background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${online ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.05)'}`,
            transition: 'border-color 0.2s',
        }}>
            <StatusDot online={online} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: online ? '#e4e4e7' : '#52525b', truncate: true }}>
                        {peer.isLocal ? '⬡ This Node' : peer.name || peer.id}
                    </span>
                    {peer.trusted && (
                        <span title="Verified via 512-bit handshake" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#22d3ee', background: 'rgba(34,211,238,0.1)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                            <ShieldCheck size={9} /> VERIFIED
                        </span>
                    )}
                    {peer.isLocal && (
                        <span style={{ fontSize: 9, color: '#818cf8', background: 'rgba(99,102,241,0.12)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>LOCAL</span>
                    )}
                </div>
                <div style={{ fontSize: 11, color: '#52525b', fontFamily: "'Geist Mono', monospace" }}>
                    {peer.address}
                    {peer.connectedAt && !peer.isLocal && (
                        <span style={{ marginLeft: 8, color: '#3f3f46' }}>· connected {timeAgo(peer.connectedAt)}</span>
                    )}
                    {peer.reputation != null && !peer.isLocal && (
                        <span style={{ marginLeft: 8, color: peer.reputation > 0.7 ? '#22d3ee' : peer.reputation > 0.4 ? '#fbbf24' : '#ef4444' }}>
                            · rep {(peer.reputation * 100).toFixed(0)}%
                        </span>
                    )}
                </div>
            </div>
            {!peer.isLocal && (
                <button onClick={handleRemove} disabled={removing} title="Remove peer"
                    style={{ background: 'none', border: 'none', cursor: removing ? 'default' : 'pointer', padding: 4, color: removing ? '#27272a' : '#52525b', borderRadius: 4, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                    onMouseEnter={e => { if (!removing) e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = removing ? '#27272a' : '#52525b'; }}
                >
                    <Trash2 size={13} />
                </button>
            )}
        </div>
    );
}

export default function GrayMatterPanel() {
    const [nodes, setNodes]       = useState([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(null);
    const [input, setInput]       = useState('');
    const [connecting, setConn]   = useState(false);
    const [connMsg, setConnMsg]   = useState(null);
    const [lastPoll, setLastPoll] = useState(null);
    const pollRef = useRef(null);

    const fetchNodes = useCallback(async () => {
        try {
            const d = await fetch('/api/soma/gmn/nodes').then(r => r.json());
            if (d.success) {
                setNodes(d.nodes || []);
                setError(null);
            } else {
                setError(d.error || 'Failed to fetch peers');
            }
        } catch (e) {
            setError('GMN unreachable');
        } finally {
            setLoading(false);
            setLastPoll(Date.now());
        }
    }, []);

    useEffect(() => {
        fetchNodes();
        pollRef.current = setInterval(fetchNodes, POLL_MS);
        return () => clearInterval(pollRef.current);
    }, [fetchNodes]);

    const handleConnect = async () => {
        const addr = input.trim();
        if (!addr) return;
        setConn(true);
        setConnMsg(null);
        try {
            const d = await fetch('/api/soma/gmn/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: addr }),
            }).then(r => r.json());
            if (d.success) {
                setConnMsg({ ok: true, text: `Connecting to ${addr}…` });
                setInput('');
                setTimeout(fetchNodes, 1500);
            } else {
                setConnMsg({ ok: false, text: d.error || 'Connection failed' });
            }
        } catch (e) {
            setConnMsg({ ok: false, text: e.message });
        } finally {
            setConn(false);
            setTimeout(() => setConnMsg(null), 4000);
        }
    };

    const handleRemove = (id) => {
        setNodes(prev => prev.filter(n => n.id !== id));
    };

    const peers = nodes.filter(n => !n.isLocal);
    const local = nodes.find(n => n.isLocal);
    const onlineCount = peers.filter(n => n.status === 'online').length;

    return (
        <div style={{ width: '100%', height: '100%', background: '#09090b', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Radio size={14} color="#22d3ee" />
                    </div>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e4e4e7', margin: 0 }}>Gray Matter Network</h2>
                    <button onClick={fetchNodes} title="Refresh" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
                        onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                    >
                        <RefreshCw size={13} />
                    </button>
                </div>
                <p style={{ fontSize: 12, color: '#52525b', margin: 0 }}>
                    Federated SOMA nodes · each instance is its own server · end-to-end encrypted
                </p>
            </div>

            <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 10 }}>
                    {[
                        { label: 'Peers Online',   value: loading ? '—' : onlineCount,         color: '#22d3ee' },
                        { label: 'Total Known',    value: loading ? '—' : peers.length,         color: '#818cf8' },
                        { label: 'Beacon Status',  value: 'Active',                             color: '#22d3ee' },
                        { label: 'Discovery',      value: 'UDP :7778',                          color: '#52525b' },
                    ].map(s => (
                        <div key={s.label} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "'Geist Mono', monospace" }}>{s.value}</div>
                            <div style={{ fontSize: 10, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* This node */}
                {local && (
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>This Node</div>
                        <PeerRow peer={local} onRemove={() => {}} />
                    </div>
                )}

                {/* Manual connect */}
                <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Connect to Node</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleConnect()}
                            placeholder="192.168.1.x:7777 or domain:7777"
                            style={{
                                flex: 1, background: '#18181b', border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 8, padding: '8px 12px', color: '#e4e4e7', fontSize: 13,
                                outline: 'none', fontFamily: "'Geist Mono', monospace",
                            }}
                            onFocus={e => e.target.style.borderColor = 'rgba(34,211,238,0.4)'}
                            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                        />
                        <button onClick={handleConnect} disabled={!input.trim() || connecting}
                            style={{
                                padding: '8px 16px', borderRadius: 8, border: 'none',
                                background: input.trim() && !connecting ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)',
                                color: input.trim() && !connecting ? '#22d3ee' : '#52525b',
                                fontSize: 13, fontWeight: 600, cursor: input.trim() && !connecting ? 'pointer' : 'default',
                                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', flexShrink: 0,
                            }}
                        >
                            <Plus size={14} />
                            {connecting ? 'Connecting…' : 'Connect'}
                        </button>
                    </div>
                    {connMsg && (
                        <div style={{ marginTop: 8, fontSize: 12, color: connMsg.ok ? '#22d3ee' : '#ef4444', padding: '6px 10px', borderRadius: 6, background: connMsg.ok ? 'rgba(34,211,238,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${connMsg.ok ? 'rgba(34,211,238,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                            {connMsg.text}
                        </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 11, color: '#3f3f46', lineHeight: 1.5 }}>
                        Nodes on your local network are discovered automatically via UDP beacon every 30s.
                        Use manual connect for nodes on other networks (requires the other SOMA's IP and port 7777 to be reachable).
                    </div>
                </div>

                {/* Peer list */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Connected Peers
                        </div>
                        {lastPoll && (
                            <div style={{ fontSize: 10, color: '#27272a' }}>
                                updated {timeAgo(lastPoll)}
                            </div>
                        )}
                    </div>
                    {loading ? (
                        <div style={{ color: '#52525b', fontSize: 12, padding: '20px 0' }}>Loading…</div>
                    ) : error ? (
                        <div style={{ color: '#ef4444', fontSize: 12, padding: '12px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                            {error}
                        </div>
                    ) : peers.length === 0 ? (
                        <div style={{ padding: '24px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.06)', textAlign: 'center' }}>
                            <WifiOff size={22} color="#27272a" style={{ margin: '0 auto 10px' }} />
                            <div style={{ fontSize: 13, color: '#52525b', marginBottom: 4 }}>No peers connected</div>
                            <div style={{ fontSize: 11, color: '#3f3f46' }}>
                                Start another SOMA instance on your network — it will appear here automatically.
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {peers.map(peer => (
                                <PeerRow key={peer.id} peer={peer} onRemove={handleRemove} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Security info */}
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                        <Shield size={13} color="#818cf8" />
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Security</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#52525b', lineHeight: 1.6 }}>
                        All peer connections use a <strong style={{ color: '#71717a' }}>6-stage Ed25519 handshake</strong> with AES-256-GCM session encryption.
                        Nodes with reputation below 20% are quarantined automatically.
                        Outbound data is filtered by Thalamus to prevent private data leakage.
                    </div>
                </div>

            </div>
        </div>
    );
}
