import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Star, UserRound, X } from 'lucide-react';
import { IdentityProfile } from '../../types';

interface Props {
  identity: IdentityProfile;
  compact?: boolean;
  showName?: boolean;
  onDirect?: (identity: IdentityProfile) => void;
  onOpenStudio?: (identity: IdentityProfile) => void;
  onFavorite?: (identity: IdentityProfile) => void;
}

const statusClass = (status?: string) => {
  if (status === 'online') return 'bg-emerald-400';
  if (status === 'away') return 'bg-amber-300';
  return 'bg-zinc-500';
};

const cardChrome = (style?: string) => {
  switch (style) {
    case 'void': return 'bg-[#050507]/98 border-white/8';
    case 'signal': return 'bg-[#071416]/95 border-cyan-300/15';
    case 'warm': return 'bg-[#17110d]/95 border-amber-200/15';
    case 'glass':
    default: return 'bg-[#101012]/95 border-white/10';
  }
};

export const MiniProfileCard: React.FC<Props & { onClose?: () => void }> = ({
  identity,
  onDirect,
  onOpenStudio,
  onFavorite,
  onClose,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 8, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 8, scale: 0.96 }}
    className={`absolute z-[160] mt-2 w-72 overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-2xl ${cardChrome(identity.cardStyle)}`}
  >
    <div className="relative h-24 bg-gradient-to-br from-violet-500/25 via-cyan-400/10 to-black" style={{ background: `linear-gradient(135deg, ${identity.accentColor || '#8b5cf6'}33, rgba(34,211,238,.08), #000)` }}>
      <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-black/30 p-1.5 text-white/45 hover:text-white">
        <X size={14} />
      </button>
    </div>
    <div className="-mt-10 px-5 pb-5">
      <div className="relative h-20 w-20 rounded-3xl border border-white/15 bg-black p-1 shadow-xl">
        <img src={identity.avatar} alt={identity.name} className="h-full w-full rounded-[20px] object-cover" />
        <span className={`absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-black ${statusClass(identity.status)}`} />
      </div>
      <div className="mt-3">
        <h3 className="text-lg font-black leading-tight text-white">{identity.name}</h3>
        {identity.visibleFields?.handle !== false && <p className="text-xs text-white/45">{identity.handle || identity.id}</p>}
        {identity.visibleFields?.role !== false && <p className="mt-2 text-sm leading-relaxed text-white/65">{identity.tagline || identity.role || 'Studio identity'}</p>}
        {identity.badge && (
          <span className="mt-2 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/65" style={{ borderColor: `${identity.accentColor || '#8b5cf6'}55`, background: `${identity.accentColor || '#8b5cf6'}18` }}>
            {identity.badge}
          </span>
        )}
      </div>
      {identity.visibleFields?.spaces !== false && <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {(identity.mutualSpaces || ['Studio', 'Axis', identity.group || 'Creative']).slice(0, 3).map(space => (
          <span key={space} className="rounded-xl border border-white/8 bg-white/[0.04] px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
            {space}
          </span>
        ))}
      </div>}
      {identity.visibleFields?.activity !== false && identity.recentActivity && (
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-2 text-xs text-white/55">
          {identity.recentActivity}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button onClick={() => onOpenStudio?.(identity)} className="flex-1 rounded-2xl bg-white px-3 py-2.5 text-xs font-black text-black hover:bg-white/90">
          Studio
        </button>
        {!identity.isSelf && (
          <button onClick={() => onDirect?.(identity)} className="rounded-2xl bg-blue-600 px-3 py-2.5 text-white hover:bg-blue-500">
            <MessageCircle size={16} />
          </button>
        )}
        {!identity.isSelf && (
          <button onClick={() => onFavorite?.(identity)} className={`rounded-2xl px-3 py-2.5 ${identity.favorite ? 'bg-yellow-300/15 text-yellow-300' : 'bg-white/5 text-white/45 hover:text-white'}`}>
            <Star size={16} fill={identity.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    </div>
  </motion.div>
);

const IdentityChip: React.FC<Props> = ({ identity, compact = false, showName = true, onDirect, onOpenStudio, onFavorite }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(prev => !prev);
        }}
        className={`inline-flex min-w-0 items-center gap-2 rounded-full border bg-white/[0.045] text-left backdrop-blur-xl transition-all hover:bg-white/[0.075] ${
          compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
        }`}
        style={{ borderColor: `${identity.accentColor || '#ffffff'}22` }}
        title={identity.name}
      >
        <span className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} relative shrink-0 overflow-hidden rounded-full bg-white/8`}>
          {identity.avatar ? (
            <img src={identity.avatar} alt={identity.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-white/45"><UserRound size={16} /></span>
          )}
          <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-black ${statusClass(identity.status)}`} />
        </span>
        {showName && (
          <span className="min-w-0 pr-1">
            <span className="block truncate text-sm font-bold leading-tight text-white">{identity.name}</span>
            {!compact && identity.visibleFields?.role !== false && <span className="block truncate text-[10px] text-white/40">{identity.role || identity.handle || 'Studio'}</span>}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button className="fixed inset-0 z-[150] cursor-default" onClick={() => setOpen(false)} />
            <MiniProfileCard
              identity={identity}
              onDirect={onDirect}
              onOpenStudio={onOpenStudio}
              onFavorite={onFavorite}
              onClose={() => setOpen(false)}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default IdentityChip;
