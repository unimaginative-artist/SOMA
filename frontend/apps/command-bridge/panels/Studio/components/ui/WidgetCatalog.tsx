import * as React from 'react';
import { motion } from 'framer-motion';
import { WidgetType } from '../../types';
import { X, Activity, Database, Radio, Image as ImageIcon, Music, Type, Sparkles, Layers, AppWindow, Crown, MessageCircle } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (type: WidgetType, defaultCol: number, defaultRow: number, defaultTitle: string) => void;
}

const WIDGET_TYPES: { type: WidgetType; label: string; desc: string; icon: any; col: number; row: number }[] = [
    { type: 'STATS', label: 'Top 8', desc: 'Display your top connections.', icon: Crown, col: 1, row: 1 },
    { type: 'SOCIAL_ACTIVITY', label: 'SOMA Social', desc: 'Live autonomous social activity.', icon: MessageCircle, col: 1, row: 1 },
    { type: 'ECOSYSTEM', label: 'Apps Feed', desc: 'Brainrot, Signal, Flux updates.', icon: AppWindow, col: 1, row: 1 },
    { type: 'HUB_FEED', label: 'Activity', desc: 'Updates from your network.', icon: Activity, col: 1, row: 2 },
    { type: 'ART_DISPLAY', label: 'Portfolio', desc: 'Interactive work display.', icon: Layers, col: 2, row: 1 },
    { type: 'METRICS', label: 'Metrics', desc: 'Value tracking.', icon: Database, col: 2, row: 1 },
    { type: 'SIGNAL', label: 'Status', desc: 'Availability signal.', icon: Radio, col: 1, row: 1 },
    { type: 'GALLERY', label: 'Gallery', desc: 'Visual work display.', icon: ImageIcon, col: 2, row: 2 },
    { type: 'MEDIA', label: 'Player', desc: 'Audio controller.', icon: Music, col: 1, row: 1 },
    { type: 'INSPIRE', label: 'Oracle', desc: 'Daily inspiration.', icon: Sparkles, col: 1, row: 1 },
    { type: 'TEXT', label: 'Note', desc: 'Simple text block.', icon: Type, col: 1, row: 1 },
];

const WidgetCatalog: React.FC<Props> = ({ isOpen, onClose, onSelect }) => {
    if (!isOpen) return null;

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-neutral-950/60 backdrop-blur-md flex items-center justify-center p-4"
        >
            <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-4xl bg-[#0F0F0F] border border-white/10 rounded-3xl overflow-hidden flex flex-col max-h-[85vh] shadow-2xl"
            >
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Add Widget</h2>
                        <p className="text-white/40 text-sm mt-0.5">Customize your studio environment</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white"><X size={20} /></button>
                </div>
                
                <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 scrollbar-thin scrollbar-thumb-white/10">
                    {WIDGET_TYPES.map((widget) => (
                        <button 
                            key={widget.type}
                            onClick={() => onSelect(widget.type, widget.col, widget.row, widget.label)}
                            className="group flex flex-col items-start p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-all text-left"
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className="p-2.5 rounded-xl bg-white/5 text-white/70 group-hover:text-white group-hover:bg-white/10 transition-colors">
                                    <widget.icon size={20} />
                                </div>
                                <span className="font-medium text-white/90">{widget.label}</span>
                            </div>
                            
                            <p className="text-sm text-white/40 group-hover:text-white/60 transition-colors mb-4 line-clamp-2">
                                {widget.desc}
                            </p>
                            
                            <div className="mt-auto pt-4 border-t border-white/5 w-full flex justify-between items-center text-xs text-white/30">
                                <span>{widget.col} x {widget.row}</span>
                                <span className="group-hover:translate-x-1 transition-transform opacity-0 group-hover:opacity-100">Add →</span>
                            </div>
                        </button>
                    ))}
                </div>
            </motion.div>
        </motion.div>
    );
};

export default WidgetCatalog;
