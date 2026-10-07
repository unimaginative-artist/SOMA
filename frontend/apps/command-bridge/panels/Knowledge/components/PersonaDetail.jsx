import React from 'react';

const PERSONA_BRAIN_COLORS = {
    AURORA: '#c084fc',
    PROMETHEUS: '#fbbf24',
    LOGOS: '#22d3ee',
    THALAMUS: '#f87171'
};

const PersonaDetail = ({ persona, assignment, onClose, onActivate, onUpdate }) => {
    if (!persona) return null;
    const routedBrain = assignment?.brain || persona.preferredBrain || persona.domain || 'AUTO';
    const routingColor = PERSONA_BRAIN_COLORS[routedBrain] || '#a1a1aa';

    return (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="w-[460px] bg-[#111114]/95 border border-white/10 rounded-2xl p-6 shadow-2xl backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-100">
                            {persona.name || persona.label || 'Persona'}
                        </div>
                        <div className="mt-1 text-[9px] uppercase tracking-[0.28em] text-zinc-500">
                            Persona Profile
                        </div>
                    </div>
                    <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-white">×</button>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <div className="text-[8px] uppercase tracking-[0.25em] text-zinc-500">Routed Brain</div>
                        <div className="mt-1 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: routingColor }}>
                            {routedBrain}
                        </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <div className="text-[8px] uppercase tracking-[0.25em] text-zinc-500">Confidence</div>
                        <div className="mt-1 text-xs font-bold text-zinc-200">
                            {assignment?.confidence ? `${Math.round(assignment.confidence * 100)}%` : 'Unknown'}
                        </div>
                    </div>
                </div>
                <div className="mb-3 text-[10px] text-zinc-500">
                    {assignment?.reason || 'No routing explanation available.'}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-3 text-[12px] leading-relaxed text-zinc-300">
                    {persona.description || persona.bio || 'No description available.'}
                </div>
                <div className="mt-4">
                    <label className="text-[9px] uppercase tracking-[0.26em] text-zinc-500">Preferred Brain</label>
                    <select
                        className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[10px] text-zinc-200 font-mono"
                        value={persona.preferredBrain || 'auto'}
                        onChange={(e) => onUpdate?.({ preferredBrain: e.target.value })}
                    >
                        <option value="auto">Auto</option>
                        <option value="AURORA">AURORA</option>
                        <option value="LOGOS">LOGOS</option>
                        <option value="PROMETHEUS">PROMETHEUS</option>
                        <option value="THALAMUS">THALAMUS</option>
                    </select>
                </div>
                {persona.traits && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(persona.traits).slice(0, 8).map(([k, v]) => (
                            <span key={k} className="text-[9px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-zinc-400">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                )}
                <div className="mt-6 flex items-center justify-end gap-2">
                    <button
                        onClick={() => onActivate?.(persona)}
                        className="px-3 py-1.5 text-[10px] uppercase tracking-widest border border-cyan-400/40 text-cyan-300 rounded-xl hover:bg-cyan-400/10"
                    >
                        Activate
                    </button>
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-[10px] uppercase tracking-widest border border-white/10 text-zinc-400 rounded-xl hover:bg-white/5"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PersonaDetail;
