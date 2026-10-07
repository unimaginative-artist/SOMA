
import React, { useState, useEffect } from 'react';
import { Bot, X } from 'lucide-react';
import { SteveContextManager } from '../lib/SteveContextManager';

const TIPS = [
  "Did you know you can right-click nodes to duplicate them? Just saying.",
  "Your memory usage is creeping up. Maybe close a few tabs?",
  "I've been monitoring your workflow. It's... unique.",
  "Don't forget to commit your changes. I won't save you if you crash.",
  "Security audit recommended. I smell vulnerability.",
  "Efficiency is down 4% in the last hour. Need coffee?",
  "I can automate that repetitive task if you just ask nicely."
];

const SteveToast = () => {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Check if enabled
    if (!SteveContextManager.getSetting('proactiveGuidance')) return;

    const interval = setInterval(() => {
      // Random chance to show a tip every 2 minutes
      if (Math.random() > 0.7) { 
        setMessage(TIPS[Math.floor(Math.random() * TIPS.length)]);
        setVisible(true);
        
        // Auto hide after 8s
        setTimeout(() => setVisible(false), 8000);
      }
    }, 120000); // Check every 2m

    return () => clearInterval(interval);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 right-8 z-[1050] max-w-xs animate-in slide-in-from-right duration-500">
      <div className="bg-[#0c0c0e]/90 backdrop-blur-xl border border-emerald-500/30 rounded-xl p-4 shadow-2xl flex items-start gap-3 relative overflow-hidden group">
        
        {/* Glow Effect */}
        <div className="absolute inset-0 bg-emerald-500/5 animate-pulse pointer-events-none" />
        
        {/* Icon */}
        <div className="mt-1 p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20 shrink-0">
           <Bot className="w-4 h-4 text-emerald-400" />
        </div>

        {/* Content */}
        <div className="flex-1">
           <h4 className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Suggestion</h4>
           <p className="text-xs text-zinc-300 leading-relaxed font-medium">"{message}"</p>
        </div>

        {/* Close */}
        <button 
          onClick={() => setVisible(false)}
          className="text-zinc-500 hover:text-white transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default SteveToast;
