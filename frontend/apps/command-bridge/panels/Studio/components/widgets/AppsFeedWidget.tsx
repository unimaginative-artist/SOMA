import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { WidgetData } from '../../types';
import { Heart, Zap, Play, Radio, Repeat, Sparkles, Flame, Wifi, Brain, Eye, MonitorPlay } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
    data: WidgetData;
    onNavigate?: (view: string) => void;
}

interface FeedItem {
    id: string;
    app: string;
    icon: any;
    color: string;
    bg: string;
    user: string;
    content: string;
    time: string;
    likes: number;
}

const APPS_CONFIG = [
    { name: 'Brainrot', icon: Brain, color: 'text-pink-500', bg: 'bg-pink-500/10' },
    { name: 'Flux', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { name: 'Signal', icon: MonitorPlay, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { name: 'Echo', icon: Wifi, color: 'text-purple-500', bg: 'bg-purple-500/10' },
];

const CONTENT_TEMPLATES = [
    "New viral aesthetic dropped. Check the shader breakdown.",
    "Latency reduced by 40% on the main grid.",
    "Live broadcast started: 'The Future of Interface'",
    "System update available: v4.2.0 [STABLE]",
    "User @kaito just went live.",
    "Trending: Cyber-organic textures in Sector 7.",
    "Connection unstable. Re-routing packets.",
    "New encrypted message received.",
    "Vibe check: 98% positive.",
    "Deploying new contract to the chain.",
    "Render complete. View final output.",
    "New follower detected from cluster A.",
    "Audio stream synced. Bitrate optimal.",
];

const USERS = ['@kaito_vfx', '@system_core', 'Station 9', '@neon_dream', 'Construct_AI', '@null_pointer'];

const AppsFeedWidget: React.FC<Props> = ({ data, onNavigate }) => {
  const [items, setItems] = useState<FeedItem[]>([
      { id: '1', app: 'Brainrot', icon: Brain, color: 'text-pink-500', bg: 'bg-pink-500/10', user: '@kaito_vfx', content: 'New viral aesthetic dropped.', time: 'Just now', likes: 124 },
      { id: '2', app: 'Flux', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10', user: '@system_core', content: 'Latency reduced by 40%.', time: '1m', likes: 89 },
      { id: '3', app: 'Signal', icon: MonitorPlay, color: 'text-emerald-500', bg: 'bg-emerald-500/10', user: 'Station 9', content: 'Live broadcast started.', time: '4m', likes: 432 },
  ]);
  const [likedItems, setLikedItems] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-populate logic
  useEffect(() => {
    const interval = setInterval(() => {
        const app = APPS_CONFIG[Math.floor(Math.random() * APPS_CONFIG.length)];
        const content = CONTENT_TEMPLATES[Math.floor(Math.random() * CONTENT_TEMPLATES.length)];
        const user = USERS[Math.floor(Math.random() * USERS.length)];
        
        const newItem: FeedItem = {
            id: Date.now().toString(),
            app: app.name,
            icon: app.icon,
            color: app.color,
            bg: app.bg,
            user: user,
            content: content,
            time: 'Just now',
            likes: Math.floor(Math.random() * 100)
        };

        setItems(prev => [newItem, ...prev].slice(0, 50)); // Keep max 50 items for scrolling
    }, 3000); // Faster updates: 3s

    return () => clearInterval(interval);
  }, []);

  const toggleLike = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setLikedItems(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
      );
  };

  return (
    <div 
        className="w-full h-full min-h-0 flex flex-col p-5 bg-[#0A0A0A] relative overflow-hidden cursor-pointer group"
        onClick={() => onNavigate && onNavigate('stage')}
    >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 relative z-10 shrink-0">
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform">
                    <Play size={14} className="text-white fill-white" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white leading-none">The Stage</h3>
                    <span className="text-[10px] text-white/40 font-mono">ECOSYSTEM FEED</span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-400 font-mono tracking-wider animate-pulse">LIVE</span>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            </div>
        </div>

        {/* Scrollable Feed List - Removed no-scrollbar to ensure users can scroll */}
        <div 
            ref={scrollRef}
            className="min-h-0 flex-1 flex flex-col gap-3 relative z-10 overflow-y-auto overscroll-contain mask-gradient-bottom scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20"
        >
            <AnimatePresence initial={false}>
                {items.map((item) => (
                    <motion.div 
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.4 }}
                        className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors shrink-0"
                    >
                        <div className={`w-8 h-8 rounded-full ${item.bg} flex items-center justify-center shrink-0`}>
                            <item.icon size={14} className={item.color} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-0.5">
                                <span className="text-xs font-bold text-white truncate">{item.user}</span>
                                <span className="text-[10px] text-white/30 whitespace-nowrap">{item.time}</span>
                            </div>
                            <p className="text-[11px] text-white/60 leading-snug line-clamp-2">
                                {item.content}
                            </p>
                        </div>

                        <div className="flex flex-col items-center justify-center gap-1 self-center">
                            <button 
                                onClick={(e) => toggleLike(e, item.id)}
                                className="p-1.5 hover:bg-white/10 rounded-full transition-colors group/like"
                            >
                                <Heart 
                                    size={14} 
                                    className={`transition-colors ${likedItems.includes(item.id) ? 'fill-pink-500 text-pink-500' : 'text-white/30 group-hover/like:text-white'}`} 
                                />
                            </button>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>

        {/* Bottom Fade for Scroll */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#0A0A0A] to-transparent pointer-events-none z-20" />

        {/* Decorative Glow */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-[50px] pointer-events-none" />
    </div>
  );
};

export default AppsFeedWidget;
