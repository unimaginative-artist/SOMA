import * as React from 'react';
import { motion } from 'framer-motion';

const ITEMS = [
    "SOMA INDEX: 4,291.00 [+12.4%]",
    "SYSTEM: OPTIMAL",
    "NETWORK: ENCRYPTED",
    "NEW CONTRACT AVAILABLE: NEURAL_INTERFACE_V2",
    "REMINDER: DRINK WATER",
    "FLUX: @kaito_san MENTIONED YOU",
    "BRAINROT: TRENDING #CYBER_AESTHETICS",
    "UPTIME: 99.99%",
    "AUDIT LOG: CLEAN",
];

const SystemTicker: React.FC = () => {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 bg-black/80 backdrop-blur-md border-t border-white/10 z-50 flex items-center overflow-hidden pointer-events-none">
        <div className="flex items-center gap-4 px-4 h-full bg-black/50 z-10 border-r border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-mono text-emerald-500 font-bold tracking-widest">LIVE</span>
        </div>
        
        <div className="flex-1 overflow-hidden relative">
             <motion.div 
                className="whitespace-nowrap flex gap-16 items-center text-[10px] font-mono text-white/60 uppercase tracking-widest"
                animate={{ x: [0, -1000] }}
                transition={{ repeat: Infinity, duration: 30, ease: "linear" }}
             >
                {[...ITEMS, ...ITEMS, ...ITEMS].map((item, i) => (
                    <span key={i} className="flex items-center gap-2">
                        {item} <span className="text-white/20">///</span>
                    </span>
                ))}
             </motion.div>
        </div>
        
        <div className="hidden md:flex items-center gap-4 px-4 h-full bg-black/50 z-10 border-l border-white/10 ml-auto">
             <span className="text-[10px] font-mono text-white/30">V.2.5.0</span>
        </div>
    </div>
  );
};

export default SystemTicker;