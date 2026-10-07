import React from 'react';

const PersonaDetail = ({ persona, onClose, onActivate, onUpdate }) => {
    if (!persona) return null;

    return (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="w-[420px] bg-[#111114] border border-white/10 rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div className="text-[12px] font-mono text-zinc-200">
                        {persona.name || persona.label || 'Persona'}
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white">×</button>
                </div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mb-2">
                    {persona.domain || persona.type || 'general'}
                </div>
                {persona.preferredBrain && (
                    <div className="text-[9px] uppercase tracking-[0.3em] text-cyan-400 mb-3">
                        Preferred Brain: {persona.preferredBrain}
                    </div>
                )}
                <div className="text-[9px] uppercase tracking-[0.3em] text-zinc-500 mb-3">
                    Registered: {persona.path || 'unknown'}
                </div>
                <div className="text-[11px] text-zinc-400 leading-relaxed">
                    {persona.description || persona.bio || 'No description available.'}
                </div>
                <div className="mt-4">
                    <label className="text-[9px] uppercase tracking-[0.3em] text-zinc-500">Preferred Brain</label>
                    <select
                        className="mt-2 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-[10px] text-zinc-200 font-mono"
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
                            <span key={k} className="text-[9px] px-2 py-0.5 rounded-full border border-white/10 text-zinc-400">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                )}
                <div className="mt-6 flex items-center justify-end gap-2">
                    <button
                        onClick={() => onActivate?.(persona)}
                        className="px-3 py-1.5 text-[10px] uppercase tracking-widest border border-cyan-400/40 text-cyan-300 rounded-md hover:bg-cyan-400/10"
                    >
                        Activate
                    </button>
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-[10px] uppercase tracking-widest border border-white/10 text-zinc-400 rounded-md hover:bg-white/5"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PersonaDetail;
