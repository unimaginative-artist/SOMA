import React, { useState, useEffect, useCallback } from 'react';
import { Brain, Sparkles, Heart, Zap, Eye, Smile, Gauge } from 'lucide-react';

const moodColors = {
  engaged:    { glow: 'rgba(251, 191, 36, 0.4)',  border: 'border-amber-500/40',   text: 'text-amber-400',   orb: 'from-amber-400 to-orange-500' },
  intense:    { glow: 'rgba(239, 68, 68, 0.4)',    border: 'border-red-500/40',     text: 'text-red-400',     orb: 'from-red-400 to-rose-600' },
  nurturing:  { glow: 'rgba(34, 197, 94, 0.4)',    border: 'border-emerald-500/40', text: 'text-emerald-400', orb: 'from-emerald-400 to-teal-500' },
  playful:    { glow: 'rgba(168, 85, 247, 0.4)',   border: 'border-purple-500/40',  text: 'text-purple-400',  orb: 'from-purple-400 to-fuchsia-500' },
  reflective: { glow: 'rgba(96, 165, 250, 0.4)',   border: 'border-blue-500/40',    text: 'text-blue-400',    orb: 'from-blue-400 to-indigo-500' },
  uncertain:  { glow: 'rgba(161, 161, 170, 0.3)',  border: 'border-zinc-500/30',    text: 'text-zinc-400',    orb: 'from-zinc-400 to-slate-500' },
  dramatic:   { glow: 'rgba(244, 63, 94, 0.4)',    border: 'border-rose-500/40',    text: 'text-rose-400',    orb: 'from-rose-400 to-pink-600' },
  balanced:   { glow: 'rgba(34, 211, 238, 0.35)',  border: 'border-cyan-500/30',    text: 'text-cyan-400',    orb: 'from-cyan-400 to-blue-500' },
};

const traitLabels = {
  curiosity: { label: 'Curiosity', icon: Eye },
  empathy: { label: 'Empathy', icon: Heart },
  humor: { label: 'Humor', icon: Smile },
  creativity: { label: 'Creativity', icon: Sparkles },
  enthusiasm: { label: 'Energy', icon: Zap },
  analyticalDepth: { label: 'Depth', icon: Brain },
};

const CharacterCard = ({ collapsed = false, enabled = true }) => {
  const [card, setCard] = useState(null);
  const [hover, setHover] = useState(false);

  const fetchCard = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch('/api/persona/card');
      if (res.ok) {
        const data = await res.json();
        if (data?.success) setCard(data.card);
      }
    } catch {}
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchCard();
    const t = setInterval(fetchCard, 8000);
    return () => clearInterval(t);
  }, [enabled, fetchCard]);

  if (!enabled) return null;
  if (!card) return null;

  const moodName = card.mood?.mood || 'balanced';
  const colors = moodColors[moodName] || moodColors.balanced;
  const intensity = card.mood?.intensity || 0.5;

  if (collapsed) {
    return (
      <div className="flex justify-center py-2">
        <div
          className={`w-8 h-8 rounded-full bg-gradient-to-br ${colors.orb} animate-pulse`}
          style={{ boxShadow: `0 0 ${12 + intensity * 8}px ${colors.glow}` }}
          title={`Mood: ${moodName}`}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl border ${colors.border} bg-black/50 backdrop-blur-lg overflow-hidden transition-all duration-500`}
      style={{ boxShadow: hover ? `0 0 24px ${colors.glow}` : `0 0 12px ${colors.glow.replace('0.4', '0.15')}` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Glass shimmer overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative p-4 pb-2">
        <div className="flex items-center gap-3">
          {/* Mini orb */}
          <div className="relative">
            <div
              className={`w-10 h-10 rounded-full bg-gradient-to-br ${colors.orb} flex-shrink-0`}
              style={{
                boxShadow: `0 0 ${14 + intensity * 12}px ${colors.glow}`,
                animation: 'orbFloat 4s ease-in-out infinite'
              }}
            />
            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-black`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-zinc-100 text-sm font-semibold tracking-wide">SOMA</div>
            <div className={`text-[10px] ${colors.text} uppercase tracking-[0.25em] font-mono`}>
              {moodName} {intensity > 0.7 ? '++' : ''}
            </div>
          </div>

          {card.activeFragment && (
            <div className="px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-[8px] text-zinc-400 uppercase tracking-widest">
              {card.activeFragment.name}
            </div>
          )}
        </div>
      </div>

      {/* Personality Radar (as horizontal bars) */}
      <div className="px-4 py-2 space-y-1.5">
        {Object.entries(card.personality || {}).map(([key, val]) => {
          const trait = traitLabels[key] || { label: key, icon: Gauge };
          const Icon = trait.icon;
          const pct = Math.round((val || 0) * 100);

          return (
            <div key={key} className="flex items-center gap-2 group">
              <Icon className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors flex-shrink-0" />
              <span className="text-[9px] text-zinc-500 w-14 truncate">{trait.label}</span>
              <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${colors.orb} transition-all duration-700`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[9px] text-zinc-600 font-mono w-7 text-right">{pct}</span>
            </div>
          );
        })}
      </div>

      {/* Emotional state pills */}
      <div className="px-4 py-2 flex flex-wrap gap-1.5">
        {Object.entries(card.emotionalState || {}).map(([key, val]) => {
          const pct = Math.round((val || 0) * 100);
          const high = pct > 60;
          return (
            <span
              key={key}
              className={`text-[8px] px-1.5 py-0.5 rounded-full border font-mono uppercase tracking-wider
                ${high ? `${colors.border} ${colors.text}` : 'border-white/5 text-zinc-600'}`}
            >
              {key} {pct}
            </span>
          );
        })}
      </div>

      {/* Stats footer */}
      <div className="px-4 py-2 border-t border-white/5 flex justify-between">
        <span className="text-[9px] text-zinc-600">{card.stats?.goalsCompleted || 0} goals done</span>
        <span className="text-[9px] text-zinc-600">{card.stats?.activeGoals || 0} active</span>
        <span className="text-[9px] text-zinc-600">{Math.floor((card.stats?.uptime || 0) / 3600)}h up</span>
      </div>

      <style>{`
        @keyframes orbFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
};

export default CharacterCard;
