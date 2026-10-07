/**
 * ConceiveApp.jsx
 * Professional audit & finance collaboration module for SOMA Command Bridge.
 * Powered by SOMA AI for intelligent document analysis, decision tracking,
 * and engagement management.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Users, Briefcase, FileText, MessageSquare, BookOpen,
    Settings, Plus, Trash2, Edit3, Check, X, Search,
    AlertTriangle, ChevronRight, ChevronDown, Upload,
    Brain, Shield, Clock, TrendingUp, BarChart3,
    Send, Loader, RefreshCw, Building2, Mail, Phone,
    Calendar, Flag, CheckCircle, Circle, Star
} from 'lucide-react';

const API = '/api/conceive';

// ── Helpers ───────────────────────────────────────────────────────────────────

const apiFetch = async (path, opts = {}) => {
    const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data;
};

const priorityColors = {
    critical: 'bg-red-500/10 text-red-400 border-red-500/20',
    high:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
    medium:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    low:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

const statusColors = {
    active:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
    review:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    on_hold:   'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

const formatDate = (ts) => {
    if (!ts) return '—';
    const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ stats, engagements, clients, onSelectEngagement }) {
    const recentEngagements = (engagements || []).slice(0, 5);

    return (
        <div className="space-y-6 p-6">
            <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Dashboard</h2>
                <p className="text-zinc-500 text-sm mt-0.5">Overview of all active engagements and intelligence</p>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Clients', value: stats.clients ?? 0, icon: Building2, color: 'blue' },
                    { label: 'Active Engagements', value: stats.active_engagements ?? 0, icon: Briefcase, color: 'purple' },
                    { label: 'Files Processed', value: stats.files_processed ?? 0, icon: FileText, color: 'emerald' },
                    { label: 'Decisions Logged', value: stats.decisions_logged ?? 0, icon: Shield, color: 'amber' },
                ].map(s => (
                    <div key={s.label} className="bg-[#151518] border border-white/5 rounded-xl p-4 flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${s.color}-500/10`}>
                            <s.icon className={`w-5 h-5 text-${s.color}-400`} />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-white">{s.value}</div>
                            <div className="text-xs text-zinc-500">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Recent engagements */}
            <div className="bg-[#151518] border border-white/5 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5">
                    <h3 className="font-semibold text-white text-sm">Recent Engagements</h3>
                </div>
                {recentEngagements.length === 0 ? (
                    <div className="p-12 text-center text-zinc-600">
                        <Briefcase className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p>No engagements yet. Create your first client and engagement.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-white/5">
                        {recentEngagements.map(eng => (
                            <button
                                key={eng.id}
                                onClick={() => onSelectEngagement(eng)}
                                className="w-full px-5 py-4 flex items-center space-x-4 hover:bg-white/5 transition-colors text-left"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-2 mb-1">
                                        <span className="font-medium text-white text-sm truncate">{eng.title}</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${priorityColors[eng.priority] || priorityColors.medium}`}>
                                            {eng.priority}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusColors[eng.status] || statusColors.active}`}>
                                            {eng.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-zinc-500 flex items-center space-x-3">
                                        <span>{eng.client_name || 'No client'}</span>
                                        <span>·</span>
                                        <span>{eng.type}</span>
                                        {eng.due_date && <><span>·</span><span>Due {eng.due_date}</span></>}
                                    </div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="text-sm font-bold text-white">{eng.progress}%</div>
                                    <div className="mt-1 w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${eng.progress}%` }} />
                                    </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Client modal ──────────────────────────────────────────────────────────────

function ClientModal({ client, onSave, onClose }) {
    const [form, setForm] = useState({
        name: client?.name || '',
        industry: client?.industry || '',
        contact_name: client?.contact_name || '',
        contact_email: client?.contact_email || '',
        notes: client?.notes || '',
    });

    const handleSave = async () => {
        if (!form.name.trim()) return;
        try {
            if (client?.id) {
                await apiFetch(`/clients/${client.id}`, { method: 'PUT', body: form });
            } else {
                await apiFetch('/clients', { method: 'POST', body: form });
            }
            onSave();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
                    <h3 className="font-bold text-white">{client ? 'Edit Client' : 'New Client'}</h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6 space-y-4">
                    {[
                        { label: 'Company Name *', key: 'name', placeholder: 'Acme Corporation' },
                        { label: 'Industry', key: 'industry', placeholder: 'Financial Services' },
                        { label: 'Contact Name', key: 'contact_name', placeholder: 'Jane Smith' },
                        { label: 'Contact Email', key: 'contact_email', placeholder: 'redacted@example.com' },
                    ].map(f => (
                        <div key={f.key}>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">{f.label}</label>
                            <input
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                                placeholder={f.placeholder}
                                value={form[f.key]}
                                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                            />
                        </div>
                    ))}
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Notes</label>
                        <textarea
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none"
                            placeholder="Internal notes about this client..."
                            rows={3}
                            value={form.notes}
                            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                        />
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-white/5 flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={!form.name.trim()}
                        className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {client ? 'Save Changes' : 'Create Client'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Clients view ──────────────────────────────────────────────────────────────

function ClientsView({ clients, onRefresh, onNewEngagement }) {
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [search, setSearch] = useState('');

    const filtered = clients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.industry?.toLowerCase().includes(search.toLowerCase())
    );

    const handleDelete = async (id) => {
        if (!confirm('Delete this client and all their engagements?')) return;
        try {
            await apiFetch(`/clients/${id}`, { method: 'DELETE' });
            onRefresh();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">Clients</h2>
                    <p className="text-zinc-500 text-sm mt-0.5">{clients.length} client{clients.length !== 1 ? 's' : ''} on record</p>
                </div>
                <button
                    onClick={() => { setEditing(null); setShowModal(true); }}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    <span>New Client</span>
                </button>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                    className="w-full bg-[#151518] border border-white/5 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
                    placeholder="Search clients..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {filtered.length === 0 ? (
                <div className="py-20 text-center text-zinc-600">
                    <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No clients yet</p>
                    <p className="text-sm mt-1">Add your first client to get started.</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {filtered.map(client => (
                        <div key={client.id} className="bg-[#151518] border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all">
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-3 mb-2">
                                        <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                                            <Building2 className="w-4 h-4 text-blue-400" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-white">{client.name}</h3>
                                            {client.industry && <p className="text-xs text-zinc-500">{client.industry}</p>}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-4 text-xs text-zinc-500">
                                        {client.contact_name && (
                                            <span className="flex items-center space-x-1">
                                                <Users className="w-3 h-3" />
                                                <span>{client.contact_name}</span>
                                            </span>
                                        )}
                                        {client.contact_email && (
                                            <span className="flex items-center space-x-1">
                                                <Mail className="w-3 h-3" />
                                                <span>{client.contact_email}</span>
                                            </span>
                                        )}
                                    </div>
                                    {client.notes && (
                                        <p className="mt-2 text-xs text-zinc-600 line-clamp-1">{client.notes}</p>
                                    )}
                                </div>
                                <div className="flex items-center space-x-2 ml-4 shrink-0">
                                    <button
                                        onClick={() => onNewEngagement(client)}
                                        className="px-3 py-1.5 text-xs font-medium bg-white/5 text-zinc-300 rounded-lg hover:bg-white/10 transition-colors"
                                    >
                                        + Engagement
                                    </button>
                                    <button
                                        onClick={() => { setEditing(client); setShowModal(true); }}
                                        className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                    >
                                        <Edit3 className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(client.id)}
                                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <ClientModal
                    client={editing}
                    onSave={() => { setShowModal(false); onRefresh(); }}
                    onClose={() => setShowModal(false)}
                />
            )}
        </div>
    );
}

// ── Engagement modal ──────────────────────────────────────────────────────────

function EngagementModal({ engagement, clients, defaultClientId, onSave, onClose }) {
    const [form, setForm] = useState({
        client_id: engagement?.client_id ?? defaultClientId ?? '',
        title: engagement?.title || '',
        type: engagement?.type || 'Audit',
        status: engagement?.status || 'active',
        priority: engagement?.priority || 'medium',
        progress: engagement?.progress ?? 0,
        due_date: engagement?.due_date || '',
        objective: engagement?.objective || '',
        notes: engagement?.notes || '',
    });

    const handleSave = async () => {
        if (!form.title.trim()) return;
        try {
            if (engagement?.id) {
                await apiFetch(`/engagements/${engagement.id}`, { method: 'PUT', body: form });
            } else {
                await apiFetch('/engagements', { method: 'POST', body: form });
            }
            onSave();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
                    <h3 className="font-bold text-white">{engagement ? 'Edit Engagement' : 'New Engagement'}</h3>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Client</label>
                        <select
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                            value={form.client_id}
                            onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}
                        >
                            <option value="">— No client —</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Engagement Title *</label>
                        <input
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
                            placeholder="Q4 2025 Financial Audit"
                            value={form.title}
                            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Type</label>
                            <select className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                                value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                                {['Audit', 'Tax Review', 'Compliance', 'Forensic', 'Advisory', 'Due Diligence', 'Other'].map(t => (
                                    <option key={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Priority</label>
                            <select className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                                value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                                {['low', 'medium', 'high', 'critical'].map(p => (
                                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Status</label>
                            <select className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                                value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                                {['active', 'review', 'completed', 'on_hold'].map(s => (
                                    <option key={s} value={s}>{s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Due Date</label>
                            <input
                                type="date"
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
                                value={form.due_date}
                                onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Progress: {form.progress}%</label>
                        <input
                            type="range" min={0} max={100} step={5}
                            className="w-full accent-blue-500"
                            value={form.progress}
                            onChange={e => setForm(p => ({ ...p, progress: parseInt(e.target.value) }))}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Objective</label>
                        <textarea
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none"
                            placeholder="What is the primary objective of this engagement?"
                            rows={2}
                            value={form.objective}
                            onChange={e => setForm(p => ({ ...p, objective: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Internal Notes</label>
                        <textarea
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none"
                            placeholder="Team notes, approach, caveats..."
                            rows={2}
                            value={form.notes}
                            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                        />
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-white/5 flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={!form.title.trim()}
                        className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {engagement ? 'Save Changes' : 'Create Engagement'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Engagements view ──────────────────────────────────────────────────────────

function EngagementsView({ engagements, clients, onRefresh, onSelectEngagement }) {
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');

    const filtered = engagements.filter(e => {
        const matchSearch = e.title.toLowerCase().includes(search.toLowerCase())
            || (e.client_name || '').toLowerCase().includes(search.toLowerCase());
        const matchStatus = filterStatus === 'all' || e.status === filterStatus;
        return matchSearch && matchStatus;
    });

    const handleDelete = async (id) => {
        if (!confirm('Delete this engagement and all its data?')) return;
        try {
            await apiFetch(`/engagements/${id}`, { method: 'DELETE' });
            onRefresh();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">Engagements</h2>
                    <p className="text-zinc-500 text-sm mt-0.5">{engagements.length} total engagement{engagements.length !== 1 ? 's' : ''}</p>
                </div>
                <button
                    onClick={() => { setEditing(null); setShowModal(true); }}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    <span>New Engagement</span>
                </button>
            </div>

            <div className="flex space-x-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                        className="w-full bg-[#151518] border border-white/5 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
                        placeholder="Search engagements..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <select
                    className="bg-[#151518] border border-white/5 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="review">Review</option>
                    <option value="completed">Completed</option>
                    <option value="on_hold">On Hold</option>
                </select>
            </div>

            {filtered.length === 0 ? (
                <div className="py-20 text-center text-zinc-600">
                    <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No engagements found</p>
                    <p className="text-sm mt-1">Try adjusting your filters or create a new engagement.</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {filtered.map(eng => (
                        <div key={eng.id} className="bg-[#151518] border border-white/5 rounded-xl hover:border-white/10 transition-all">
                            <button
                                className="w-full px-5 py-4 flex items-start space-x-4 text-left"
                                onClick={() => onSelectEngagement(eng)}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-2">
                                        <span className="font-semibold text-white">{eng.title}</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${priorityColors[eng.priority] || priorityColors.medium}`}>
                                            {eng.priority}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusColors[eng.status] || statusColors.active}`}>
                                            {eng.status?.replace('_', ' ')}
                                        </span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-white/10 text-zinc-400">{eng.type}</span>
                                    </div>
                                    <div className="flex items-center space-x-4 text-xs text-zinc-500">
                                        {eng.client_name && <span className="flex items-center space-x-1"><Building2 className="w-3 h-3" /><span>{eng.client_name}</span></span>}
                                        {eng.due_date && <span className="flex items-center space-x-1"><Calendar className="w-3 h-3" /><span>Due {eng.due_date}</span></span>}
                                    </div>
                                    {eng.objective && (
                                        <p className="mt-2 text-xs text-zinc-600 line-clamp-1">{eng.objective}</p>
                                    )}
                                    <div className="mt-3 flex items-center space-x-2">
                                        <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${eng.progress}%` }} />
                                        </div>
                                        <span className="text-xs text-zinc-500 shrink-0">{eng.progress}%</span>
                                    </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0 mt-1" />
                            </button>
                            <div className="px-5 py-3 border-t border-white/5 flex justify-end space-x-2">
                                <button
                                    onClick={() => { setEditing(eng); setShowModal(true); }}
                                    className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                >
                                    <Edit3 className="w-3.5 h-3.5" /> <span>Edit</span>
                                </button>
                                <button
                                    onClick={() => handleDelete(eng.id)}
                                    className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <EngagementModal
                    engagement={editing}
                    clients={clients}
                    onSave={() => { setShowModal(false); onRefresh(); }}
                    onClose={() => setShowModal(false)}
                />
            )}
        </div>
    );
}

// ── Engagement detail (files + decisions) ─────────────────────────────────────

function EngagementDetail({ engagement, clients, onBack, onRefresh }) {
    const [tab, setTab] = useState('files');
    const [files, setFiles] = useState([]);
    const [decisions, setDecisions] = useState([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [loadingDecisions, setLoadingDecisions] = useState(false);
    const [addingFile, setAddingFile] = useState(false);
    const [newFileName, setNewFileName] = useState('');
    const [newDecisionTitle, setNewDecisionTitle] = useState('');
    const [newDecisionRationale, setNewDecisionRationale] = useState('');
    const [showDecisionForm, setShowDecisionForm] = useState(false);
    const [editModal, setEditModal] = useState(false);

    const loadFiles = useCallback(async () => {
        setLoadingFiles(true);
        try {
            const data = await apiFetch(`/files?engagement_id=${engagement.id}`);
            setFiles(data.files || []);
        } catch (err) { console.error(err); }
        finally { setLoadingFiles(false); }
    }, [engagement.id]);

    const loadDecisions = useCallback(async () => {
        setLoadingDecisions(true);
        try {
            const data = await apiFetch(`/decisions?engagement_id=${engagement.id}`);
            setDecisions(data.decisions || []);
        } catch (err) { console.error(err); }
        finally { setLoadingDecisions(false); }
    }, [engagement.id]);

    useEffect(() => {
        loadFiles();
        loadDecisions();
    }, [loadFiles, loadDecisions]);

    const handleAddFile = async () => {
        if (!newFileName.trim()) return;
        setAddingFile(true);
        try {
            await apiFetch('/files', { method: 'POST', body: {
                engagement_id: engagement.id,
                name: newFileName.trim(),
                type: newFileName.includes('.') ? newFileName.split('.').pop().toUpperCase() : 'DOC',
                size: '',
            }});
            setNewFileName('');
            loadFiles();
        } catch (err) { console.error(err); }
        finally { setAddingFile(false); }
    };

    const handleDeleteFile = async (id) => {
        try {
            await apiFetch(`/files/${id}`, { method: 'DELETE' });
            loadFiles();
        } catch (err) { console.error(err); }
    };

    const handleAddDecision = async () => {
        if (!newDecisionTitle.trim()) return;
        try {
            await apiFetch('/decisions', { method: 'POST', body: {
                engagement_id: engagement.id,
                title: newDecisionTitle.trim(),
                rationale: newDecisionRationale.trim(),
                actor: 'USER',
            }});
            setNewDecisionTitle('');
            setNewDecisionRationale('');
            setShowDecisionForm(false);
            loadDecisions();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 py-5 border-b border-white/5 bg-[#151518]">
                <button onClick={onBack} className="flex items-center space-x-1.5 text-xs text-zinc-500 hover:text-white transition-colors mb-3">
                    <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                    <span>Back to Engagements</span>
                </button>
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center space-x-2 mb-1">
                            <h2 className="text-xl font-bold text-white">{engagement.title}</h2>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${priorityColors[engagement.priority] || priorityColors.medium}`}>
                                {engagement.priority}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusColors[engagement.status] || statusColors.active}`}>
                                {engagement.status?.replace('_', ' ')}
                            </span>
                        </div>
                        <div className="text-sm text-zinc-500 flex items-center space-x-3">
                            {engagement.client_name && <span>{engagement.client_name}</span>}
                            {engagement.type && <><span>·</span><span>{engagement.type}</span></>}
                            {engagement.due_date && <><span>·</span><span>Due {engagement.due_date}</span></>}
                        </div>
                        {engagement.objective && (
                            <p className="mt-1.5 text-xs text-zinc-600 max-w-xl">{engagement.objective}</p>
                        )}
                    </div>
                    <button
                        onClick={() => setEditModal(true)}
                        className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <Edit3 className="w-3.5 h-3.5" /> <span>Edit</span>
                    </button>
                </div>
                {/* Progress */}
                <div className="mt-3 flex items-center space-x-3">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${engagement.progress}%` }} />
                    </div>
                    <span className="text-xs text-zinc-400">{engagement.progress}% complete</span>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex space-x-1 px-6 py-3 border-b border-white/5 bg-[#151518]">
                {[
                    { id: 'files', label: 'Files', icon: FileText },
                    { id: 'decisions', label: 'Decision Log', icon: Shield },
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        <t.icon className="w-4 h-4" />
                        <span>{t.label}</span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {tab === 'files' && (
                    <div className="space-y-4">
                        {/* Add file input */}
                        <div className="flex items-center space-x-3">
                            <input
                                className="flex-1 bg-[#151518] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
                                placeholder="File name (e.g., Q4_BalanceSheet.xlsx)"
                                value={newFileName}
                                onChange={e => setNewFileName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddFile()}
                            />
                            <button
                                onClick={handleAddFile}
                                disabled={addingFile || !newFileName.trim()}
                                className="flex items-center space-x-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                {addingFile ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                <span>Add File</span>
                            </button>
                        </div>
                        <p className="text-xs text-zinc-600">SOMA AI will automatically analyze each file for audit risks and key figures.</p>

                        {loadingFiles ? (
                            <div className="py-12 text-center text-zinc-600"><Loader className="w-6 h-6 animate-spin mx-auto" /></div>
                        ) : files.length === 0 ? (
                            <div className="py-16 text-center text-zinc-600">
                                <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
                                <p>No files attached yet</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {files.map(file => (
                                    <div key={file.id} className="bg-[#151518] border border-white/5 rounded-xl p-4">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-start space-x-3">
                                                <div className="w-9 h-9 bg-blue-500/10 rounded-lg flex items-center justify-center shrink-0">
                                                    <FileText className="w-4 h-4 text-blue-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center space-x-2">
                                                        <span className="font-medium text-white text-sm">{file.name}</span>
                                                        {file.type && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 text-zinc-500">{file.type}</span>}
                                                        {file.relevance_score > 0.7 && (
                                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                                HIGH RELEVANCE
                                                            </span>
                                                        )}
                                                    </div>
                                                    {file.soma_summary && (
                                                        <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{file.soma_summary}</p>
                                                    )}
                                                    {file.risk_signals?.length > 0 && (
                                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                                            {file.risk_signals.map((r, i) => (
                                                                <span key={i} className="flex items-center space-x-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded border border-red-500/20">
                                                                    <AlertTriangle className="w-2.5 h-2.5" />
                                                                    <span>{r}</span>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="mt-1.5 text-[10px] text-zinc-600">{formatDate(file.created_at)}</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteFile(file.id)}
                                                className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-colors ml-3"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'decisions' && (
                    <div className="space-y-4">
                        {/* Add decision */}
                        {!showDecisionForm ? (
                            <button
                                onClick={() => setShowDecisionForm(true)}
                                className="flex items-center space-x-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-sm rounded-lg transition-colors"
                            >
                                <Plus className="w-4 h-4" /> <span>Log Decision</span>
                            </button>
                        ) : (
                            <div className="bg-[#151518] border border-white/10 rounded-xl p-4 space-y-3">
                                <input
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50"
                                    placeholder="Decision title..."
                                    value={newDecisionTitle}
                                    onChange={e => setNewDecisionTitle(e.target.value)}
                                />
                                <textarea
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none"
                                    placeholder="Rationale and supporting evidence..."
                                    rows={3}
                                    value={newDecisionRationale}
                                    onChange={e => setNewDecisionRationale(e.target.value)}
                                />
                                <div className="flex space-x-2">
                                    <button
                                        onClick={handleAddDecision}
                                        disabled={!newDecisionTitle.trim()}
                                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                    >Log Decision</button>
                                    <button
                                        onClick={() => { setShowDecisionForm(false); setNewDecisionTitle(''); setNewDecisionRationale(''); }}
                                        className="px-4 py-2 text-sm text-zinc-500 hover:text-white transition-colors"
                                    >Cancel</button>
                                </div>
                            </div>
                        )}

                        {loadingDecisions ? (
                            <div className="py-12 text-center text-zinc-600"><Loader className="w-6 h-6 animate-spin mx-auto" /></div>
                        ) : decisions.length === 0 ? (
                            <div className="py-16 text-center text-zinc-600">
                                <Shield className="w-8 h-8 mx-auto mb-3 opacity-30" />
                                <p>No decisions logged yet</p>
                                <p className="text-xs mt-1">Every significant decision should be documented here.</p>
                            </div>
                        ) : (
                            <div className="relative">
                                {/* Timeline line */}
                                <div className="absolute left-4 top-0 bottom-0 w-px bg-white/5" />
                                <div className="space-y-4 pl-10">
                                    {decisions.map((d, i) => (
                                        <div key={d.id} className="relative">
                                            <div className="absolute -left-6 top-2 w-3 h-3 rounded-full border-2 border-blue-500 bg-[#09090b]" />
                                            <div className={`bg-[#151518] border rounded-xl p-4 ${d.is_conflict ? 'border-red-500/30' : 'border-white/5'}`}>
                                                <div className="flex items-start justify-between mb-2">
                                                    <div className="flex items-center space-x-2">
                                                        {d.is_conflict && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
                                                        <span className="font-semibold text-white text-sm">{d.title}</span>
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/5 text-zinc-500">{d.actor}</span>
                                                    </div>
                                                    <div className="flex items-center space-x-2 shrink-0 ml-3">
                                                        <span className={`text-xs font-bold ${
                                                            d.confidence >= 0.8 ? 'text-emerald-400' :
                                                            d.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'
                                                        }`}>{Math.round(d.confidence * 100)}%</span>
                                                        <span className="text-[10px] text-zinc-600 uppercase">conf.</span>
                                                    </div>
                                                </div>
                                                {d.rationale && <p className="text-xs text-zinc-500 leading-relaxed">{d.rationale}</p>}
                                                {d.user_note && <p className="mt-2 text-xs text-blue-400 italic">Note: {d.user_note}</p>}
                                                <div className="mt-2 text-[10px] text-zinc-700">{formatDate(d.created_at)} · {d.change_type}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {editModal && (
                <EngagementModal
                    engagement={engagement}
                    clients={clients}
                    onSave={() => { setEditModal(false); onRefresh(); }}
                    onClose={() => setEditModal(false)}
                />
            )}
        </div>
    );
}

// ── AI Chat view ──────────────────────────────────────────────────────────────

function ChatView({ activeEngagement }) {
    const [messages, setMessages] = useState([{
        id: 0,
        role: 'ai',
        text: 'Hello. I\'m SOMA, your audit and finance intelligence assistant. I can help you analyze documents, identify risks, prepare summaries, and answer questions about your engagements. How can I assist you today?',
        ts: Date.now(),
    }]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const endRef = useRef(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const send = async () => {
        const text = input.trim();
        if (!text || loading) return;
        setInput('');
        const userMsg = { id: Date.now(), role: 'user', text, ts: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);
        try {
            const context = activeEngagement ? {
                engagement_title: activeEngagement.title,
                client_name: activeEngagement.client_name,
            } : {};
            const data = await apiFetch('/chat', { method: 'POST', body: { message: text, context } });
            setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ai', text: data.response, ts: Date.now() }]);
        } catch (err) {
            setMessages(prev => [...prev, { id: Date.now() + 1, role: 'ai', text: `Error: ${err.message}`, ts: Date.now() }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-5 border-b border-white/5 bg-[#151518]">
                <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <Brain className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                        <h2 className="font-bold text-white text-sm">SOMA AI Assistant</h2>
                        <p className="text-xs text-zinc-500">Specialized for audit, compliance, and financial analysis</p>
                    </div>
                    {activeEngagement && (
                        <div className="ml-auto px-3 py-1.5 bg-white/5 rounded-lg border border-white/5 text-xs text-zinc-400">
                            Context: <span className="text-white font-medium">{activeEngagement.title}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'ai' && (
                            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0 mr-3 mt-1">
                                <Brain className="w-4 h-4 text-blue-400" />
                            </div>
                        )}
                        <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                            msg.role === 'user'
                                ? 'bg-blue-600 text-white rounded-tr-sm'
                                : 'bg-[#151518] border border-white/5 text-zinc-200 rounded-tl-sm'
                        }`}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0 mr-3 mt-1">
                            <Brain className="w-4 h-4 text-blue-400 animate-pulse" />
                        </div>
                        <div className="bg-[#151518] border border-white/5 rounded-2xl rounded-tl-sm px-5 py-4">
                            <div className="flex space-x-1.5">
                                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}
                <div ref={endRef} />
            </div>

            <div className="px-6 py-4 border-t border-white/5 bg-[#151518]">
                <div className="flex items-end space-x-3">
                    <div className="flex-1 bg-white/5 rounded-xl border border-white/10 focus-within:border-blue-500/50 transition-all">
                        <textarea
                            className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder:text-zinc-600 resize-none focus:outline-none min-h-[44px] max-h-32"
                            placeholder="Ask about your audit engagement, risk analysis, compliance checks..."
                            rows={1}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        />
                    </div>
                    <button
                        onClick={send}
                        disabled={!input.trim() || loading}
                        className="p-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 active:scale-95 transition-all shadow-lg shadow-blue-500/20"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-[10px] text-zinc-700 mt-2">Powered by SOMA AI · Context-aware audit analysis</p>
            </div>
        </div>
    );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function ConceiveApp() {
    const [activeView, setActiveView] = useState('dashboard');
    const [clients, setClients] = useState([]);
    const [engagements, setEngagements] = useState([]);
    const [stats, setStats] = useState({});
    const [selectedEngagement, setSelectedEngagement] = useState(null);
    const [newEngagementClient, setNewEngagementClient] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [clientsRes, engagementsRes, statsRes] = await Promise.all([
                apiFetch('/clients'),
                apiFetch('/engagements'),
                apiFetch('/stats'),
            ]);
            setClients(clientsRes.clients || []);
            setEngagements(engagementsRes.engagements || []);
            setStats(statsRes.stats || {});
        } catch (err) {
            console.error('[Conceive] Load error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    const handleSelectEngagement = (eng) => {
        setSelectedEngagement(eng);
        setActiveView('engagements');
    };

    const handleNewEngagementForClient = (client) => {
        setNewEngagementClient(client);
        setSelectedEngagement(null);
        setActiveView('engagements');
    };

    const navItems = [
        { id: 'dashboard',    label: 'Dashboard',   icon: BarChart3 },
        { id: 'clients',      label: 'Clients',      icon: Building2 },
        { id: 'engagements',  label: 'Engagements',  icon: Briefcase },
        { id: 'chat',         label: 'AI Assistant', icon: MessageSquare },
    ];

    return (
        <div className="flex h-full bg-[#09090b] text-white overflow-hidden">
            {/* Sidebar */}
            <aside className="w-52 shrink-0 border-r border-white/5 bg-[#0d0d0f] flex flex-col py-5">
                <div className="px-4 mb-6">
                    <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                            <Briefcase className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <div className="font-bold text-sm text-white leading-none">Conceive</div>
                            <div className="text-[10px] text-zinc-600 mt-0.5">Audit Intelligence</div>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 px-2 space-y-0.5">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => {
                                setActiveView(item.id);
                                if (item.id !== 'engagements') setSelectedEngagement(null);
                            }}
                            className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                activeView === item.id
                                    ? 'bg-white/10 text-white'
                                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'
                            }`}
                        >
                            <item.icon className={`w-4 h-4 ${activeView === item.id ? 'text-blue-400' : ''}`} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>

                <div className="px-4 pt-4 border-t border-white/5">
                    <div className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold mb-2">System</div>
                    <div className="space-y-1 text-xs text-zinc-600">
                        <div className="flex justify-between"><span>Clients</span><span className="text-zinc-400">{stats.clients ?? 0}</span></div>
                        <div className="flex justify-between"><span>Active</span><span className="text-zinc-400">{stats.active_engagements ?? 0}</span></div>
                        <div className="flex justify-between"><span>Files</span><span className="text-zinc-400">{stats.files_processed ?? 0}</span></div>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-hidden flex flex-col">
                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-zinc-600">
                            <Loader className="w-8 h-8 animate-spin mx-auto mb-3" />
                            <p className="text-sm">Loading Conceive...</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto">
                        {activeView === 'dashboard' && (
                            <Dashboard
                                stats={stats}
                                engagements={engagements}
                                clients={clients}
                                onSelectEngagement={handleSelectEngagement}
                            />
                        )}

                        {activeView === 'clients' && (
                            <ClientsView
                                clients={clients}
                                onRefresh={loadAll}
                                onNewEngagement={handleNewEngagementForClient}
                            />
                        )}

                        {activeView === 'engagements' && !selectedEngagement && (
                            <EngagementsView
                                engagements={engagements}
                                clients={clients}
                                onRefresh={loadAll}
                                onSelectEngagement={setSelectedEngagement}
                                defaultClientId={newEngagementClient?.id}
                            />
                        )}

                        {activeView === 'engagements' && selectedEngagement && (
                            <EngagementDetail
                                engagement={selectedEngagement}
                                clients={clients}
                                onBack={() => setSelectedEngagement(null)}
                                onRefresh={loadAll}
                            />
                        )}

                        {activeView === 'chat' && (
                            <ChatView activeEngagement={selectedEngagement} />
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
