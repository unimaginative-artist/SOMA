import React, { useState, useEffect, useCallback } from 'react';

const SEVERITY_COLOR = {
    critical: 'text-red-400 bg-red-500/10 border-red-500/30',
    high:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
    medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    low:      'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
};

const ACTION_ICON = {
    excel_analysis:  '📊',
    manual_fix:      '✏️',
    manual_review:   '👁️',
    soma_suggestion: '🧠',
    ingestion:       '📥',
    report_generated:'📄',
};

function timeSince(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function ChainBadge({ verified }) {
    if (verified === null) return null;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
            verified
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${verified ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`} />
            {verified ? 'Chain Verified' : 'Chain Tampered'}
        </span>
    );
}

export default function AuditRibbon() {
    const [stats,        setStats]        = useState(null);
    const [entries,      setEntries]      = useState([]);
    const [verifyResult, setVerifyResult] = useState(null);
    const [verifying,    setVerifying]    = useState(false);
    const [fileFilter,   setFileFilter]   = useState('');
    const [loading,      setLoading]      = useState(true);
    const [logForm,      setLogForm]      = useState({ open: false, actor: '', action: 'manual_fix', filePath: '', note: '' });
    const [logSaving,    setLogSaving]    = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [statsRes, recentRes] = await Promise.all([
                fetch('/api/soma/audit/stats').then(r => r.json()),
                fetch('/api/soma/audit/recent?limit=100').then(r => r.json()),
            ]);
            setStats(statsRes);
            setEntries(recentRes.entries || []);
        } catch { /* backend may not be up yet */ }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleVerify = async () => {
        setVerifying(true);
        try {
            const result = await fetch('/api/soma/audit/verify').then(r => r.json());
            setVerifyResult(result);
        } catch { setVerifyResult({ valid: false, reason: 'Could not reach server' }); }
        setVerifying(false);
    };

    const handleLogEntry = async () => {
        if (!logForm.actor || !logForm.action) return;
        setLogSaving(true);
        try {
            await fetch('/api/soma/audit/entry', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    actor:    logForm.actor,
                    action:   logForm.action,
                    filePath: logForm.filePath || null,
                    metadata: logForm.note ? { note: logForm.note } : {}
                })
            });
            setLogForm(f => ({ ...f, open: false, note: '' }));
            await load();
        } catch { /* non-fatal */ }
        setLogSaving(false);
    };

    const filtered = fileFilter.trim()
        ? entries.filter(e => (e.file_path || '').toLowerCase().includes(fileFilter.toLowerCase()))
        : entries;

    return (
        <div className="h-full flex flex-col bg-[#09090b] text-zinc-200 overflow-hidden">

            {/* Header */}
            <div className="px-6 py-4 border-b border-white/5 bg-black/30 flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-sm font-bold tracking-widest uppercase text-zinc-100">Audit Ribbon</h1>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Immutable hash-chained log of every analysis and edit</p>
                </div>
                <div className="flex items-center gap-3">
                    {verifyResult && <ChainBadge verified={verifyResult.valid} />}
                    <button
                        onClick={handleVerify}
                        disabled={verifying}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-50"
                    >
                        {verifying ? 'Verifying…' : 'Verify Chain'}
                    </button>
                    <button
                        onClick={() => setLogForm(f => ({ ...f, open: !f.open }))}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                    >
                        + Log Entry
                    </button>
                    <button onClick={load} className="p-1.5 rounded-md border border-white/5 hover:bg-white/5 transition-all text-zinc-500 hover:text-zinc-300" title="Refresh">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Manual log form */}
            {logForm.open && (
                <div className="px-6 py-4 border-b border-white/5 bg-zinc-900/60 shrink-0">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Record Manual Action</p>
                    <div className="flex gap-3 flex-wrap">
                        <input
                            value={logForm.actor}
                            onChange={e => setLogForm(f => ({ ...f, actor: e.target.value }))}
                            placeholder="Your name"
                            className="px-3 py-1.5 text-xs bg-black/40 border border-white/10 rounded-md text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 w-36"
                        />
                        <select
                            value={logForm.action}
                            onChange={e => setLogForm(f => ({ ...f, action: e.target.value }))}
                            className="px-3 py-1.5 text-xs bg-black/40 border border-white/10 rounded-md text-zinc-200 focus:outline-none focus:border-cyan-500/50"
                        >
                            <option value="manual_fix">Manual Fix</option>
                            <option value="manual_review">Manual Review</option>
                            <option value="approved">Approved</option>
                            <option value="escalated">Escalated</option>
                        </select>
                        <input
                            value={logForm.filePath}
                            onChange={e => setLogForm(f => ({ ...f, filePath: e.target.value }))}
                            placeholder="File path (optional)"
                            className="px-3 py-1.5 text-xs bg-black/40 border border-white/10 rounded-md text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 flex-1 min-w-[200px]"
                        />
                        <input
                            value={logForm.note}
                            onChange={e => setLogForm(f => ({ ...f, note: e.target.value }))}
                            placeholder="Note (e.g. fixed Sheet1!B47)"
                            className="px-3 py-1.5 text-xs bg-black/40 border border-white/10 rounded-md text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 flex-1 min-w-[200px]"
                        />
                        <button
                            onClick={handleLogEntry}
                            disabled={logSaving || !logForm.actor}
                            className="px-4 py-1.5 text-xs font-bold rounded-md bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 transition-all disabled:opacity-50"
                        >
                            {logSaving ? 'Sealing…' : 'Seal to Chain'}
                        </button>
                    </div>
                </div>
            )}

            {/* Stats bar */}
            {stats && (
                <div className="px-6 py-3 border-b border-white/5 bg-black/20 flex items-center gap-6 shrink-0">
                    {[
                        { label: 'Total Entries', value: stats.total?.toLocaleString() },
                        { label: 'Files Tracked', value: stats.files?.toLocaleString() },
                        { label: 'Actors', value: stats.actors?.toLocaleString() },
                        { label: 'Tip Hash', value: stats.tip_hash ? `${stats.tip_hash.slice(0, 8)}…${stats.tip_hash.slice(-8)}` : '—' },
                    ].map(s => (
                        <div key={s.label} className="flex flex-col">
                            <span className="text-[9px] text-zinc-600 uppercase tracking-widest">{s.label}</span>
                            <span className="text-xs font-mono text-zinc-300 mt-0.5">{s.value ?? '—'}</span>
                        </div>
                    ))}
                    {verifyResult?.valid === false && (
                        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/30">
                            <span className="text-[10px] text-red-400 font-bold">⚠ TAMPER DETECTED at entry #{verifyResult.tampered_at_idx}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Filter */}
            <div className="px-6 py-2 border-b border-white/5 shrink-0">
                <input
                    value={fileFilter}
                    onChange={e => setFileFilter(e.target.value)}
                    placeholder="Filter by file path…"
                    className="w-full max-w-sm px-3 py-1.5 text-[11px] bg-black/30 border border-white/5 rounded-md text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/40 font-mono"
                />
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
                {loading && (
                    <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">Loading chain…</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                        <svg className="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <p className="text-[11px] uppercase tracking-widest">No entries yet</p>
                        <p className="text-[10px] text-zinc-700 mt-1">Entries appear when SOMA analyzes files or auditors log actions</p>
                    </div>
                )}

                {filtered.map((entry, i) => {
                    const meta = entry.metadata || {};
                    const filename = entry.file_path ? entry.file_path.split(/[\\/]/).pop() : null;
                    const topFinding = meta.sheets
                        ?.flatMap(s => s.findings || [])
                        .sort((a, b) => {
                            const order = { critical: 0, high: 1, medium: 2, low: 3 };
                            return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
                        })[0];

                    return (
                        <div key={entry.idx ?? i} className="flex gap-3 group">
                            {/* Timeline spine */}
                            <div className="flex flex-col items-center w-5 shrink-0 pt-1">
                                <div className="w-2 h-2 rounded-full bg-zinc-700 group-hover:bg-cyan-500 transition-colors shrink-0" />
                                {i < filtered.length - 1 && <div className="w-px flex-1 bg-white/5 mt-1" />}
                            </div>

                            {/* Entry card */}
                            <div className="flex-1 pb-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-base leading-none">{ACTION_ICON[entry.action] || '🔗'}</span>
                                        <span className="text-[11px] font-semibold text-zinc-200">{entry.actor}</span>
                                        <span className="text-[10px] text-zinc-500">{entry.action?.replace(/_/g, ' ')}</span>
                                        {filename && (
                                            <span className="text-[10px] font-mono text-cyan-500/70 truncate max-w-[200px]" title={entry.file_path}>
                                                {filename}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[9px] text-zinc-600 shrink-0">{timeSince(entry.timestamp)}</span>
                                </div>

                                {/* Top finding */}
                                {topFinding && (
                                    <div className={`mt-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-mono ${SEVERITY_COLOR[topFinding.severity] || SEVERITY_COLOR.low}`}>
                                        <span className="font-bold uppercase tracking-wider mr-2">{topFinding.severity}</span>
                                        {topFinding.cell && <span className="mr-2 opacity-70">{topFinding.cell}</span>}
                                        {topFinding.message?.slice(0, 100)}
                                    </div>
                                )}

                                {/* Summary stats for analysis entries */}
                                {meta.totalFindings !== undefined && (
                                    <div className="mt-1.5 flex items-center gap-3 text-[9px] text-zinc-600">
                                        {meta.criticalCount > 0 && <span className="text-red-500">{meta.criticalCount} critical</span>}
                                        {meta.highCount > 0 && <span className="text-orange-500">{meta.highCount} high</span>}
                                        <span>{meta.totalFindings} total findings</span>
                                    </div>
                                )}

                                {/* Manual note */}
                                {meta.note && (
                                    <p className="mt-1.5 text-[10px] text-zinc-400 italic">"{meta.note}"</p>
                                )}

                                {/* Hash + download report */}
                                <div className="mt-1 flex items-center gap-3">
                                    <p className="text-[9px] font-mono text-zinc-700">
                                        #{entry.idx} · {entry.entry_hash?.slice(0, 16)}…
                                    </p>
                                    {entry.file_path && entry.action === 'excel_analysis' && (
                                        <a
                                            href={`/api/soma/excel/report?filePath=${encodeURIComponent(entry.file_path)}`}
                                            download
                                            className="text-[9px] font-bold uppercase tracking-widest text-cyan-500/60 hover:text-cyan-400 transition-colors"
                                        >
                                            ↓ Export Report
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
