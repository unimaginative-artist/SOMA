import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellRing, Plus, Trash2, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

const TYPE_CONFIG = {
    price_above: { label: 'Price Above', icon: TrendingUp, color: 'text-emerald-400', borderColor: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
    price_below: { label: 'Price Below', icon: TrendingDown, color: 'text-red-400', borderColor: 'border-red-500/30', bg: 'bg-red-500/10' }
};

const SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'XRP-USD', 'AVAX-USD', 'BNB-USD', 'LINK-USD'];

export const AlertsPanel = ({ somaBackend, onAlertTriggered }) => {
    const [alerts, setAlerts] = useState([]);
    const [form, setForm] = useState({ symbol: 'BTC-USD', type: 'price_above', value: '', label: '' });
    const [formOpen, setFormOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const fetchAlerts = useCallback(async () => {
        try {
            const res = await fetch('/api/alerts');
            if (!res.ok) return;
            const data = await res.json();
            setAlerts(data.alerts || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 10000);
        return () => clearInterval(interval);
    }, [fetchAlerts]);

    // Listen for real-time alert triggers
    useEffect(() => {
        if (!somaBackend) return;
        const handler = (alert) => {
            setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, status: 'triggered', triggeredAt: alert.triggeredAt, triggeredPrice: alert.triggeredPrice } : a));
            if (onAlertTriggered) onAlertTriggered(alert);
        };
        somaBackend.on('alert_triggered', handler);
        return () => somaBackend.off('alert_triggered', handler);
    }, [somaBackend, onAlertTriggered]);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!form.value) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: form.symbol,
                    type: form.type,
                    value: parseFloat(form.value),
                    label: form.label || undefined
                })
            });
            const data = await res.json();
            if (data.success) {
                setAlerts(prev => [data.alert, ...prev]);
                setForm(prev => ({ ...prev, value: '', label: '' }));
                setFormOpen(false);
            }
        } catch { /* ignore */ } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id) => {
        await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
        setAlerts(prev => prev.filter(a => a.id !== id));
    };

    const handleReset = async (id) => {
        const res = await fetch(`/api/alerts/${id}/reset`, { method: 'POST' });
        const data = await res.json();
        if (data.success) setAlerts(prev => prev.map(a => a.id === id ? data.alert : a));
    };

    const activeCount = alerts.filter(a => a.status === 'active').length;
    const triggeredCount = alerts.filter(a => a.status === 'triggered').length;

    return (
        <div className="h-full flex flex-col text-xs overflow-hidden">
            {/* Header */}
            <div className="p-3 border-b border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    {activeCount > 0 ? <BellRing className="w-4 h-4 text-amber-400 animate-pulse" /> : <Bell className="w-4 h-4 text-slate-500" />}
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Price Alerts</span>
                    <span className="text-[9px] bg-slate-700 text-slate-400 rounded px-1.5 py-0.5 font-mono">{activeCount} active</span>
                    {triggeredCount > 0 && <span className="text-[9px] bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5 font-mono">{triggeredCount} fired</span>}
                </div>
                <button
                    onClick={() => setFormOpen(p => !p)}
                    className={`p-1.5 rounded border transition-all ${formOpen ? 'bg-soma-accent/20 border-soma-accent/50 text-soma-accent' : 'border-white/10 text-slate-500 hover:text-white hover:border-white/20'}`}
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Create Form */}
            {formOpen && (
                <form onSubmit={handleCreate} className="p-3 border-b border-white/5 bg-black/20 space-y-2 shrink-0">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[9px] text-slate-500 uppercase block mb-1">Symbol</label>
                            <select
                                value={form.symbol}
                                onChange={e => setForm(p => ({ ...p, symbol: e.target.value }))}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-soma-accent/50"
                            >
                                {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[9px] text-slate-500 uppercase block mb-1">Condition</label>
                            <select
                                value={form.type}
                                onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-soma-accent/50"
                            >
                                <option value="price_above">Price above</option>
                                <option value="price_below">Price below</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[9px] text-slate-500 uppercase block mb-1">Target Price ($)</label>
                            <input
                                type="number"
                                step="any"
                                placeholder="e.g. 100000"
                                value={form.value}
                                onChange={e => setForm(p => ({ ...p, value: e.target.value }))}
                                required
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-soma-accent/50"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-slate-500 uppercase block mb-1">Label (optional)</label>
                            <input
                                type="text"
                                placeholder="e.g. BTC ATH"
                                value={form.label}
                                onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-soma-accent/50"
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={submitting || !form.value}
                        className="w-full py-1.5 rounded bg-soma-accent/20 hover:bg-soma-accent/30 border border-soma-accent/40 text-soma-accent text-[10px] font-bold transition-all disabled:opacity-40"
                    >
                        {submitting ? 'Creating...' : 'Create Alert'}
                    </button>
                </form>
            )}

            {/* Alert List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {alerts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                        <Bell className="w-8 h-8 mb-3 opacity-30" />
                        <p className="text-xs">No alerts set</p>
                        <p className="text-[10px] mt-1 opacity-70">Click + to create a price alert</p>
                    </div>
                ) : (
                    <div className="p-2 space-y-1.5">
                        {alerts.map(alert => {
                            const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.price_above;
                            const Icon = cfg.icon;
                            const isTriggered = alert.status === 'triggered';
                            return (
                                <div
                                    key={alert.id}
                                    className={`flex items-center gap-2 p-2 rounded border transition-all ${isTriggered ? 'bg-amber-500/10 border-amber-500/40' : `${cfg.bg} ${cfg.borderColor}`}`}
                                >
                                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isTriggered ? 'text-amber-400' : cfg.color}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-bold text-white font-mono">{alert.symbol}</span>
                                            <span className={`text-[9px] ${isTriggered ? 'text-amber-400' : cfg.color}`}>
                                                {cfg.label.toLowerCase()} ${alert.value.toLocaleString()}
                                            </span>
                                        </div>
                                        {alert.label && <div className="text-[9px] text-slate-500 truncate">{alert.label}</div>}
                                        {isTriggered && alert.triggeredPrice && (
                                            <div className="text-[9px] text-amber-400 font-mono">
                                                FIRED @ ${alert.triggeredPrice.toFixed(2)} · {new Date(alert.triggeredAt).toLocaleTimeString()}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {isTriggered && (
                                            <button onClick={() => handleReset(alert.id)} className="p-1 rounded text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all" title="Re-arm">
                                                <RefreshCw className="w-3 h-3" />
                                            </button>
                                        )}
                                        <button onClick={() => handleDelete(alert.id)} className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all" title="Delete">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
