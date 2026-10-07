import React from 'react';

const PersonaRegistry = ({ personas = [], search = '', onSearch, onSelect }) => {
    const filtered = personas.filter(p => {
        const text = `${p.name || ''} ${p.label || ''} ${p.description || ''} ${p.domain || ''}`.toLowerCase();
        return text.includes((search || '').toLowerCase());
    });

    return (
        <div className="absolute inset-0 z-30 p-8 overflow-auto">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-zinc-400 font-bold">Persona Registry</div>
                    <div className="text-[10px] text-zinc-500">{personas.length} profiles</div>
                </div>

                <div className="mb-5">
                    <input
                        value={search}
                        onChange={(e) => onSearch?.(e.target.value)}
                        placeholder="Search personas..."
                        className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-[10px] text-zinc-200 font-mono"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map((p, idx) => (
                        <button
                            key={`${p.id || p.name || 'persona'}-${idx}`}
                            onClick={() => onSelect?.(p)}
                            className="group text-left p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-cyan-400/40 transition-all shadow-[0_0_20px_rgba(0,0,0,0.2)]"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[12px] text-zinc-200 font-mono truncate">
                                    {p.name || p.label || 'Unknown Persona'}
                                </div>
                                <div className="text-[9px] text-cyan-400 uppercase tracking-widest">
                                    {p.domain || p.type || 'general'}
                                </div>
                            </div>
                            {p.preferredBrain && (
                                <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[9px] uppercase tracking-widest text-cyan-300 mb-2">
                                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]"></span>
                                    {p.preferredBrain}
                                </div>
                            )}
                            <div className="text-[10px] text-zinc-400 line-clamp-3">
                                {p.description || p.bio || 'No description provided.'}
                            </div>
                            {p.traits && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {Object.keys(p.traits).slice(0, 4).map((t) => (
                                        <span key={t} className="text-[9px] px-2 py-0.5 rounded-full border border-white/10 text-zinc-400">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </button>
                    ))}
                    {filtered.length === 0 && (
                        <div className="col-span-full text-center text-zinc-500 text-[11px]">
                            No personas found. Load personas or check IdentityArbiter.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PersonaRegistry;
