import React, { useState, useRef } from 'react';
import { Arbiter, ArbiterStatus } from '../types';
import { Activity, Edit2, X, Upload, Save, User, Play, Pause, Zap, Bot } from 'lucide-react';

interface ArbiterGridProps {
  arbiters: Arbiter[];
  layout?: 'list' | 'grid';
  variant?: 'dashboard' | 'detailed';
  onUpdateArbiter?: (id: string, updates: Partial<Arbiter>) => void;
  onToggle?: (id: string) => void;
  onRestart?: (id: string) => void;
  showDetailedLoad?: boolean;
}

const ArbiterGrid: React.FC<ArbiterGridProps> = ({
  arbiters,
  layout = 'grid',
  variant = 'detailed', // Default to detailed if not specified
  onUpdateArbiter,
  onToggle,
  onRestart,
  showDetailedLoad = true
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [tempDescription, setTempDescription] = useState('');
  const [tempAvatar, setTempAvatar] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (arbiter: Arbiter) => {
    setEditingId(arbiter.id);
    setTempName(arbiter.name);
    setTempDescription(arbiter.description || '');
    setTempAvatar(arbiter.avatarUrl);
  };

  const handleSave = () => {
    if (editingId && onUpdateArbiter) {
      onUpdateArbiter(editingId, {
        name: tempName,
        description: tempDescription,
        avatarUrl: tempAvatar
      });
      setEditingId(null);
    }
  };

  const handleRandomizeAvatar = () => {
    // Generate a secure random string for the seed
    const randomSeed = Math.random().toString(36).substring(7);
    setTempAvatar(`https://robohash.org/${randomSeed}?set=set1&bgset=bg1`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getStatusStyles = (status: ArbiterStatus) => {
    switch (status) {
      case ArbiterStatus.BUSY:
        return {
          badge: 'text-[#F0ABFC] bg-[#A855F7]/20 border-[#D8B4FE]/40 shadow-[0_0_10px_rgba(168,85,247,0.4)]',
          border: 'border-[#A855F7]/50 shadow-[inset_0_0_20px_rgba(168,85,247,0.1)]',
          bg: 'bg-[#2E1065]/60',
          // Enhanced neon glow for the indicator
          indicator: 'bg-[#D8B4FE] shadow-[0_0_8px_#D8B4FE,0_0_16px_#A855F7]'
        };
      case ArbiterStatus.IDLE:
        return {
          badge: 'text-cyber-muted bg-white/5 border-white/10',
          border: 'border-white/5 hover:border-cyber-primary/30',
          bg: 'bg-white/[0.02]',
          indicator: 'bg-cyber-muted/50'
        };
      case ArbiterStatus.OFFLINE:
        return {
          badge: 'text-slate-500 bg-slate-900/50 border-slate-700',
          border: 'border-transparent opacity-50',
          bg: 'bg-black/30',
          indicator: 'bg-slate-700'
        };
      default:
        return {
          badge: 'text-slate-400',
          border: 'border-white/5',
          bg: 'bg-transparent',
          indicator: 'bg-slate-500'
        };
    }
  };

  const editingArbiter = arbiters.find(a => a.id === editingId);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar p-1 pt-6 relative">
      <div className={layout === 'grid'
        ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-1 auto-rows-max content-start'
        : 'space-y-2'
      }>
        {/* Sort Logic: Alphabetical (A-Z) for all views per user request */}
        {[...arbiters].sort((a, b) => a.name.localeCompare(b.name)).map((arbiter) => {
          const styles = getStatusStyles(arbiter.status);
          const isBusy = arbiter.status === ArbiterStatus.BUSY;

          // ---------- DASHBOARD VARIANT (Robot Theme, Compact) ----------
          if (variant === 'dashboard') {
            return (
              <div
                key={arbiter.id}
                onClick={() => onToggle && onToggle(arbiter.id)}
                className="group relative flex flex-col p-2 rounded-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer hover:z-30"
              >
                {/* Background & Effects Wrapper (Clipped) */}
                <div className={`absolute inset-0 rounded-lg overflow-hidden border backdrop-blur-sm transition-all duration-300 group-hover:shadow-neon z-0 ${isBusy ? 'bg-cyber-primary/5 border-cyber-primary/40 shadow-[0_0_15px_rgba(168,85,247,0.15)]' : 'bg-[#0F0818]/80 border-white/5 hover:border-cyber-primary/30'}`}>
                  {/* Corner Accents */}
                  <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/10 rounded-tl-lg group-hover:border-cyber-primary/60 transition-colors duration-500"></div>
                  <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/10 rounded-br-lg group-hover:border-cyber-primary/60 transition-colors duration-500"></div>

                  {/* Active State Animations */}
                  {isBusy && (
                    <>
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#A855F7]/10 to-transparent h-[50%] animate-scan-vertical pointer-events-none z-0"></div>
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(168,85,247,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.05)_1px,transparent_1px)] bg-[size:20px_20px] opacity-20 pointer-events-none z-0"></div>
                    </>
                  )}
                </div>

                {/* Header Row (Centered Column) */}
                <div className="flex flex-col items-center justify-center gap-1 mb-1.5 relative z-10 w-full">
                  {/* Avatar Container */}
                  <div className="relative shrink-0 group/avatar">
                    {/* Frame: Holds Border & Shadow (No Overflow Hidden) */}
                    {/* Main Container - Clips Everything & Has Shadow */}
                    <div className={`w-12 h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 xl:w-24 xl:h-24 rounded-lg bg-[#0F0818] border border-white/10 overflow-hidden transition-all duration-300 isolate relative ${isBusy ? 'shadow-[0_0_15px_rgba(168,85,247,0.3)] border-cyber-primary/40' : 'group-hover:shadow-lg group-hover:border-white/30'}`}>

                      {/* Image - Scales underneath border */}
                      <img
                        src={`https://robohash.org/${arbiter.id}?set=set1&bgset=bg1`}
                        alt="Robot Avatar"
                        className="w-full h-full object-cover object-center rounded-md opacity-90 group-hover:opacity-100 transition-all duration-300 bg-black/40"
                      />


                    </div>
                    {/* Hover Name Tooltip */}
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/90 backdrop-blur-md border border-white/20 text-white text-[10px] font-bold rounded shadow-xl whitespace-nowrap z-50 pointer-events-none opacity-0 group-hover/avatar:opacity-100 transition-all duration-300 scale-95 group-hover/avatar:scale-100 uppercase tracking-wider">
                      {arbiter.name}
                      {/* Arrow */}
                      <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 bg-black/90 border-r border-b border-white/20 transform rotate-45"></div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center w-full mt-1">
                    {/* Robot Mood Icon */}
                    <Bot
                      className={`w-5 h-5 transition-all duration-500 
                    ${isBusy
                          ? 'text-emerald-400 animate-pulse drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                          : arbiter.healthScore < 50
                            ? 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                            : 'text-cyber-muted group-hover:text-cyber-primary'
                        }`}
                    />
                  </div>
                </div>

                {/* Load Indicator */}
                <div className="flex items-center justify-center gap-3 mb-1.5 relative z-10 h-auto my-1">
                  <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="16" stroke="white" strokeWidth="4" fill="transparent" className="opacity-10" />
                      <circle cx="18" cy="18" r="16" stroke="#FBBF24" strokeWidth="4" fill="transparent"
                        className="text-amber-400 transition-all duration-1000 ease-out"
                        strokeDasharray="100"
                        strokeDashoffset={100 - (arbiter.load || 0)}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute text-[11px] font-bold text-cyber-white">{arbiter.load}%</span>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex flex-col items-center gap-2 mt-auto pt-2 border-t border-white/5 relative z-10 w-full">
                  {/* Health Capsule */}
                  <div className={`flex items-center justify-center shrink-0 w-16 h-6 rounded-full border transition-all duration-300 relative ${arbiter.healthScore > 90 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-amber-500/10 border-amber-500/30 text-amber-100'}`}>
                    <Activity className={`w-3 h-3 absolute left-2 ${arbiter.healthScore > 90 ? 'text-emerald-400' : 'text-amber-400'}`} />
                    <span className="text-[10px] font-mono font-bold text-center w-full">{arbiter.healthScore}%</span>
                  </div>

                  {/* Capabilities */}
                  <div className="flex flex-wrap justify-center gap-1.5 w-full px-2">
                    {arbiter.capabilities.slice(0, 3).map((cap, i) => (
                      <span
                        key={i}
                        className="text-[9px] px-1.5 py-px rounded bg-white/5 text-cyber-muted/70 border border-white/5 whitespace-nowrap group-hover:border-cyber-primary/20 group-hover:text-cyber-primary/80 transition-colors shrink-0"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action Button */}
                {onToggle && (
                  <div className="flex justify-center gap-2 mt-2 pt-2 border-t border-white/5 relative z-10">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggle(arbiter.id); }}
                      disabled={arbiter.status === ArbiterStatus.BUSY}
                      className={`group/btn relative flex items-center justify-center h-7 w-9 rounded-md transition-all duration-300 ease-out border overflow-hidden
                    ${arbiter.status === ArbiterStatus.OFFLINE
                          ? 'bg-white/5 text-cyber-muted border-white/10 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/30'
                          : arbiter.status === ArbiterStatus.BUSY
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 cursor-not-allowed shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 hover:scale-105 active:scale-95'
                        }`}
                      title={arbiter.status === ArbiterStatus.OFFLINE ? 'Start Operation' : arbiter.status === ArbiterStatus.BUSY ? 'Active Connection' : 'Set to Standby'}
                    >
                      <div className="flex items-center justify-center">
                        {arbiter.status === ArbiterStatus.OFFLINE ? <Play className="w-4 h-4 fill-current opacity-50 group-hover:opacity-100" /> :
                          arbiter.status === ArbiterStatus.BUSY ? <Zap className="w-4 h-4 fill-current animate-pulse" /> :
                            <Pause className="w-4 h-4 fill-current" />}
                      </div>
                    </button>
                  </div>
                )}
              </div>
            );
          }

          // ---------- DETAILED VARIANT (Standard Registry) ----------
          return (
            <div
              key={arbiter.id}
              className={`group relative flex flex-col p-4 rounded-xl border backdrop-blur-md transition-all duration-300 hover:shadow-glow hover:-translate-y-0.5 overflow-hidden text-left ${isBusy ? 'bg-cyber-primary/5 border-cyber-primary/40' : 'bg-[#0F0818]/80 border-white/5 hover:border-cyber-primary/30'
                }`}
            >
              {/* Edit Button (Visible on Hover in Detailed Mode) */}
              {onUpdateArbiter && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleEditClick(arbiter); }}
                  className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 text-cyber-muted hover:text-white hover:bg-cyber-primary/20 opacity-0 group-hover:opacity-100 transition-all duration-300 z-20 border border-white/5 backdrop-blur-md"
                  title="Edit Configuration"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Standard Header with Marquee Name */}
              <div className="flex items-start gap-4 mb-3 relative z-10 w-full overflow-hidden">
                <div className={`w-12 h-12 rounded-lg bg-[#0F0818] border border-white/10 overflow-hidden shrink-0 ${isBusy ? 'shadow-[0_0_15px_rgba(168,85,247,0.3)] border-cyber-primary/40' : ''}`}>
                  <img src={arbiter.avatarUrl || `https://robohash.org/${arbiter.id}?set=set1`} alt={arbiter.name} className="w-full h-full object-cover object-center" />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="relative overflow-hidden w-full h-5 group/text">
                      {/* Faded edges mask */}
                      <div className="absolute inset-0 z-10 bg-gradient-to-r from-[#0F0818] via-transparent to-[#0F0818] opacity-0 group-hover:opacity-100 transition-opacity w-[5%] left-0"></div>
                      <div className="absolute inset-0 z-10 bg-gradient-to-l from-[#0F0818] via-transparent to-[#0F0818] opacity-100 w-[10%] right-0 pointer-events-none"></div>

                      {/* Scrolling Track - Duplicated for seamless loop */}
                      <div className="flex items-center gap-8 w-max animate-scroll-text hover:pause-animation">
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider whitespace-nowrap">{arbiter.name}</h3>
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider whitespace-nowrap" aria-hidden="true">{arbiter.name}</h3>
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider whitespace-nowrap" aria-hidden="true">{arbiter.name}</h3>
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider whitespace-nowrap" aria-hidden="true">{arbiter.name}</h3>
                      </div>
                    </div>

                    <span className={`text-[10px] px-2 py-0.5 rounded border shrink-0 ${styles.badge} font-mono font-bold tracking-tight uppercase`}>
                      {statusToLabel(arbiter.status)}
                    </span>
                  </div>
                  <p className="text-xs text-cyber-muted mt-0.5 font-mono truncate">{arbiter.role}</p>
                </div>
              </div>

              {/* Description Marquee */}
              <div className="relative overflow-hidden w-full h-5 mb-4 group/desc">
                {/* Faded edges mask */}
                <div className="absolute inset-0 z-10 bg-gradient-to-l from-[#0F0818] via-transparent to-[#0F0818] opacity-100 w-[10%] right-0 pointer-events-none"></div>

                <div className="flex items-center gap-8 w-max animate-scroll-text-slow">
                  <p className="text-xs text-cyber-muted/80 font-mono whitespace-nowrap">{arbiter.description}</p>
                  <p className="text-xs text-cyber-muted/80 font-mono whitespace-nowrap" aria-hidden="true">{arbiter.description}</p>
                  <p className="text-xs text-cyber-muted/80 font-mono whitespace-nowrap" aria-hidden="true">{arbiter.description}</p>
                </div>
              </div>

              {/* System Stats (Bar) */}
              <div className="mt-auto pt-3 border-t border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase text-cyber-muted font-bold tracking-wider">System Load</span>
                  <span className="text-[10px] font-mono text-cyber-white font-bold">{arbiter.load || 0}%</span>
                </div>
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mb-3">
                  <div className={`h-full transition-all duration-500 ${isBusy ? 'bg-emerald-400' : 'bg-cyber-primary'}`} style={{ width: `${arbiter.load || 0}%` }} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {arbiter.capabilities.slice(0, 2).map((cap, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-px rounded bg-white/5 text-cyber-muted border border-white/5">{cap}</span>
                    ))}
                  </div>
                  {onToggle && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggle(arbiter.id); }}
                      className="text-[10px] font-bold uppercase tracking-wider text-cyber-primary hover:text-white transition-colors"
                    >
                      {arbiter.status === ArbiterStatus.OFFLINE ? 'Start System' : 'Manage'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Modal Overlay */}
      {editingId && editingArbiter && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm glass-panel rounded-2xl p-5 shadow-glow-strong border border-cyber-primary/20 bg-[#0F0818] max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
              <h3 className="text-sm font-bold text-cyber-white flex items-center gap-2 tracking-wide uppercase">
                <Edit2 className="w-3.5 h-3.5 text-cyber-primary" /> Configure Identity
              </h3>
              <button onClick={() => setEditingId(null)} className="text-cyber-muted hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Avatar Upload */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-black/40 border border-white/10 overflow-hidden relative group cursor-pointer shadow-inner shrink-0" onClick={() => fileInputRef.current?.click()}>
                  <img src={tempAvatar || editingArbiter.avatarUrl || `https://robohash.org/${editingArbiter.id}?set=set1&bgset=bg1`} className="w-full h-full object-cover object-center" alt="Avatar" />
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Upload className="w-5 h-5 text-white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/*"
                  />
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 text-[10px] bg-white/5 hover:bg-white/10 text-cyber-primary px-3 py-1.5 rounded border border-white/5 transition-colors font-mono uppercase font-bold"
                      >
                        Upload Image
                      </button>
                      <button
                        onClick={handleRandomizeAvatar}
                        className="text-[10px] bg-white/5 hover:bg-white/10 text-emerald-400 px-3 py-1.5 rounded border border-white/5 transition-colors font-mono uppercase font-bold"
                        title="Generate New Identity"
                      >
                        <Zap className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-cyber-muted opacity-50 truncate">Upload or randomize identity</p>
                  </div>
                </div>
              </div>

              {/* Name Input */}
              <div>
                <label className="block text-[10px] font-bold text-cyber-muted uppercase tracking-wider mb-1.5">Display Designation</label>
                <div className="glass-input rounded-lg p-2 flex items-center gap-2 focus-within:border-cyber-primary/50 transition-colors">
                  <User className="w-3.5 h-3.5 text-cyber-muted" />
                  <input
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    className="bg-transparent border-none w-full text-xs text-white focus:outline-none placeholder:text-white/20 font-bold"
                    placeholder="Enter agent name..."
                  />
                </div>
              </div>

              {/* Description Input */}
              <div>
                <label className="block text-[10px] font-bold text-cyber-muted uppercase tracking-wider mb-1.5">System Directives</label>
                <div className="glass-input rounded-lg p-2 focus-within:border-cyber-primary/50 transition-colors">
                  <textarea
                    value={tempDescription}
                    onChange={(e) => setTempDescription(e.target.value)}
                    className="bg-transparent border-none w-full text-xs text-cyber-muted/80 focus:outline-none placeholder:text-white/20 font-mono resize-none h-20 leading-relaxed custom-scrollbar"
                    placeholder="Enter system description..."
                  />
                </div>
              </div>

              {/* Core Role Display (Read-only) */}
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <span className="block text-[9px] font-bold text-cyber-muted uppercase tracking-wider mb-1 opacity-60">System Core Role</span>
                <span className="font-mono text-xs text-cyber-accent">{editingArbiter.role}</span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/10">
                <button
                  onClick={() => setEditingId(null)}
                  className="flex-1 py-2 rounded-lg border border-white/10 text-xs font-bold text-cyber-muted hover:bg-white/5 transition-colors"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-2 rounded-lg bg-cyber-primary/20 border border-cyber-primary/40 text-cyber-primary hover:bg-cyber-primary hover:text-cyber-base transition-all duration-300 text-xs font-bold shadow-neon flex items-center justify-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" /> SAVE_CHANGES
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scan-down {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(200%); }
        }
        @keyframes scroll-text {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); } 
        }
        @keyframes scroll-text-slow {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); } 
        }

        .animate-scan-vertical {
            animation: scan-down 3s linear infinite;
        }
        .animate-scroll-text {
             /* 20s for name loop */
            animation: scroll-text 20s linear infinite;
        }
        .animate-scroll-text-slow {
             /* 30s for description loop */
            animation: scroll-text-slow 30s linear infinite;
        }
        .hover\:pause-animation:hover {
            animation-play-state: paused;
        }
      `}</style>
    </div>
  );
};

function statusToLabel(status: ArbiterStatus) {
  if (status === ArbiterStatus.BUSY) return 'BUSY';
  if (status === ArbiterStatus.IDLE) return 'IDLE';
  return status;
}

export default ArbiterGrid;