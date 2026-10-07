import * as React from 'react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Layout, Maximize } from 'lucide-react';

export interface NavTheme {
    style: 'ISLAND' | 'DOCK' | 'CYBER' | 'MINIMAL' | 'GLOW';
    color: string;
    scale?: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    currentTheme: NavTheme;
    onSave: (theme: NavTheme) => void;
}

const NAV_STYLES = [
    { id: 'ISLAND', label: 'Island (Default)' },
    { id: 'DOCK', label: 'MacOS Dock' },
    { id: 'CYBER', label: 'Cyber Deck' },
    { id: 'MINIMAL', label: 'Minimal Bar' },
    { id: 'GLOW', label: 'Neon Glow' },
];

const NavConfigModal: React.FC<Props> = ({ isOpen, onClose, currentTheme, onSave }) => {
    const [theme, setTheme] = useState<NavTheme>({ ...currentTheme, scale: currentTheme.scale ?? 1 });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="relative w-full max-w-lg bg-[#0F0F0F] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
            >
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">Configure Navigation</h2>
                    <button onClick={onClose}><X size={20} className="text-white/50 hover:text-white" /></button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                             <Layout size={16} /> Visual Style
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            {NAV_STYLES.map(style => (
                                <button
                                    key={style.id}
                                    onClick={() => setTheme({ ...theme, style: style.id as any })}
                                    className={`px-4 py-3 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${
                                        theme.style === style.id 
                                        ? 'bg-white text-black border-white' 
                                        : 'bg-white/5 text-white/60 border-white/5 hover:border-white/20'
                                    }`}
                                >
                                    {style.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Maximize size={16} /> Navigation Size
                        </h3>
                        <div className="flex items-center gap-4 bg-black/20 border border-white/10 rounded-xl p-3">
                            <span className="text-xs text-white/40 font-mono">SMALL</span>
                            <input 
                                type="range" 
                                min="0.5" 
                                max="1.3" 
                                step="0.1"
                                value={theme.scale}
                                onChange={(e) => setTheme({ ...theme, scale: parseFloat(e.target.value) })}
                                className="flex-1 accent-white" 
                            />
                            <span className="text-xs text-white/40 font-mono">LARGE</span>
                            <span className="text-xs font-mono text-white w-8 text-right">{theme.scale}x</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-white">Accent Color</h3>
                        <div className="flex items-center gap-4">
                            <input 
                                type="color" 
                                value={theme.color}
                                onChange={(e) => setTheme({ ...theme, color: e.target.value })}
                                className="w-12 h-12 rounded-xl cursor-pointer bg-transparent border-none" 
                            />
                            <span className="text-xs font-mono text-white/50 uppercase">{theme.color}</span>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-white/5 bg-[#0A0A0A] flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-3 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5">
                        Cancel
                    </button>
                    <button 
                        onClick={() => { onSave(theme); onClose(); }}
                        className="px-6 py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-neutral-200 transition-colors"
                    >
                        Save
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

export default NavConfigModal;