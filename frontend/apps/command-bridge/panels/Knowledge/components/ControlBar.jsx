import React from 'react';
import {
    AlertTriangle,
    Lock,
    Eraser,
    Camera,
    GitBranch,
    Zap,
    Waves,
    Sparkles,
    Brain,
} from 'lucide-react';

const VIEW_LABELS = { nodes: 'Nodes', personas: 'Personas', mind: 'Mind' };
const VIEW_TITLES = { nodes: 'Neural Mesh', personas: 'Persona Map', mind: 'SOMA Mind' };
const VIEW_OPTIONS = ['nodes', 'personas', 'mind'];

export const ControlBar = ({ onAction, systemStatus, fragmentCount = 0, personaCount = 0, viewMode = 'nodes', onToggleView }) => {
    const actions = [
        { icon: AlertTriangle, label: 'Expose Contradictions', id: 'expose', color: 'hover:text-red-400' },
        { icon: Lock, label: 'Commit Current State', id: 'commit', color: 'hover:text-blue-400' },
        { icon: Eraser, label: 'Prune Low-Energy', id: 'prune', color: 'hover:text-orange-400' },
        { icon: Camera, label: 'Mind Snapshot', id: 'snapshot', color: 'hover:text-white' },
        { icon: GitBranch, label: 'Fork Timeline', id: 'fork', color: 'hover:text-purple-400' },
        { icon: Zap, label: 'Inject Hypothesis', id: 'inject', color: 'hover:text-yellow-400' },
        { icon: Waves, label: 'Run Causal Simulation', id: 'causal', color: 'hover:text-cyan-400' },
        { icon: Sparkles, label: 'Toggle Particles', id: 'toggle_particles', color: 'hover:text-fuchsia-400' },
    ];

    return (
        <div className="absolute top-0 left-0 right-0 z-40 px-6 py-4 flex items-start justify-center pointer-events-none">
            {/* Left Status - Neural Mesh */}
            <div className="absolute top-4 left-6 bg-black/35 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5 flex items-center space-x-4 pointer-events-auto shadow-2xl">
                <div className="flex flex-col items-start">
                    <span className="text-[9px] text-zinc-500 uppercase tracking-[0.26em] font-bold">{VIEW_TITLES[viewMode] || 'Neural Mesh'}</span>
                    <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-zinc-200 tracking-wide font-mono">
                            {viewMode === 'mind' ? '—' : (viewMode === 'personas' ? personaCount : fragmentCount).toLocaleString()}
                            <span className="text-zinc-600 text-xs"> {VIEW_LABELS[viewMode] || 'NODES'}</span>
                        </span>
                    </div>
                </div>
                <div className="ml-2 flex rounded-full border border-white/10 bg-black/25 p-0.5">
                    {VIEW_OPTIONS.map(mode => (
                        <button
                            key={mode}
                            onClick={() => onToggleView?.(mode)}
                            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.18em] transition-all
                                ${viewMode === mode
                                    ? 'bg-white/10 text-white shadow'
                                    : 'text-zinc-500 hover:text-zinc-200'}`}
                            title={`Show ${VIEW_LABELS[mode]}`}
                        >
                            {mode === 'mind' && <Brain size={9} />}
                            {VIEW_LABELS[mode]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Centered Action Bar */}
            <div className="pointer-events-auto bg-black/35 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 flex items-center space-x-1 shadow-2xl ring-1 ring-white/5">
                {actions.map((action) => (
                    <button
                        key={action.id}
                        onClick={() => onAction(action.id)}
                        className={`group relative p-2.5 rounded-xl hover:bg-white/10 transition-all active:scale-95 text-zinc-400 ${action.color}`}
                    >
                        <action.icon size={18} />
                        {/* Tooltip now appears BELOW with z-index separation */}
                        <span className="absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-[#18181b] border border-white/10 text-[10px] font-bold tracking-wide uppercase text-white rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100]">
                            {action.label}
                        </span>
                    </button>
                ))}
            </div>

            {/* System Status - Absolute Right */}
            <div className="absolute top-4 right-6 bg-black/35 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5 flex items-center space-x-4 pointer-events-auto shadow-2xl">
                <div className="flex flex-col items-end">
                    <span className="text-[9px] text-zinc-500 uppercase tracking-[0.26em] font-bold">System Integrity</span>
                    <div className="flex items-center space-x-2">
                        <span className={`w-2 h-2 rounded-full animate-pulse ${systemStatus.color}`}></span>
                        <span className="text-sm font-bold text-zinc-200 tracking-wide transition-all duration-300">{systemStatus.label}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
