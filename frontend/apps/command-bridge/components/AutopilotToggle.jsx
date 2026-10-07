import React, { useState, useEffect, useCallback } from 'react';
import { Zap, ZapOff, Target, Clock, Users } from 'lucide-react';

const AutopilotToggle = ({ enabled = true }) => {
    const [status, setStatus] = useState({ enabled: false, components: { goals: false, rhythms: false, social: false } });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchStatus = useCallback(async () => {
        if (!enabled) return;
        try {
            const res = await fetch('/api/autopilot/status');
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            if (data.success) {
                setStatus({ enabled: data.enabled, components: data.components });
                setError(null);
            }
        } catch (e) {
            setError('Backend offline');
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        fetchStatus();
        const t = setInterval(fetchStatus, 10000);
        return () => clearInterval(t);
    }, [enabled, fetchStatus]);

    const toggle = async (nextEnabled, component) => {
        if (!enabled) return;
        setLoading(true);
        try {
            const body = component ? { enabled: nextEnabled, component } : { enabled: nextEnabled };
            const res = await fetch('/api/autopilot/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            if (data.success) {
                setStatus({ enabled: data.enabled, components: data.components });
                setError(null);
            }
        } catch (e) {
            setError('Backend offline');
        } finally { setLoading(false); }
    };

    const allOn = status.components.goals && status.components.rhythms && status.components.social;
    const anyOn = status.components.goals || status.components.rhythms || status.components.social;
    const borderColor = allOn ? 'border-emerald-500/40' : anyOn ? 'border-amber-500/40' : 'border-red-500/30';
    const insetState = allOn
        ? 'ring-1 ring-inset ring-emerald-500/30'
        : anyOn
            ? 'ring-1 ring-inset ring-amber-500/30'
            : 'ring-1 ring-inset ring-red-500/20';

    const components = [
        { key: 'goals', label: 'Goals', icon: Target, color: 'text-rose-400' },
        { key: 'rhythms', label: 'Rhythms', icon: Clock, color: 'text-cyan-400' },
        { key: 'social', label: 'Social', icon: Users, color: 'text-amber-400' }
    ];

    const controlsDisabled = !enabled || loading;

    return (
        <div className={`box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border ${borderColor} ${insetState} bg-black/40 backdrop-blur-sm p-3 transition-colors duration-300 ${!enabled ? 'opacity-50 grayscale' : ''}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    {allOn ? <Zap className="w-3.5 h-3.5 text-emerald-400" /> : <ZapOff className="w-3.5 h-3.5 text-zinc-500" />}
                    <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-400 font-bold">Autopilot</span>
                </div>
                <button
                    onClick={() => toggle(!allOn)}
                    disabled={controlsDisabled}
                    className={`relative h-5 w-9 flex-shrink-0 overflow-hidden rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/30 ${allOn ? 'bg-emerald-500/60' : 'bg-zinc-700'}`}
                >
                    <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-300 ${allOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
            </div>
            {error && (
                <div className="mb-2 text-[9px] text-rose-400 uppercase tracking-[0.25em] font-bold">{error}</div>
            )}
            <div className="grid min-w-0 grid-cols-3 gap-1.5">
                {components.map(({ key, label, icon: Icon, color }) => (
                    <button
                        key={key}
                        onClick={() => toggle(!status.components[key], key)}
                        disabled={controlsDisabled}
                        className={`box-border flex h-7 min-w-0 max-w-full items-center justify-center gap-1 overflow-hidden rounded-md px-1 py-1 text-[9px] font-mono leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/30
                            ${status.components[key] ? `bg-white/[0.06] ${color} ring-1 ring-inset ring-white/10` : 'bg-white/[0.02] text-zinc-600 ring-1 ring-inset ring-white/5'}`}
                    >
                        <Icon className="w-2.5 h-2.5 flex-shrink-0" />
                        <span className="min-w-0 truncate">{label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default AutopilotToggle;
