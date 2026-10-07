import * as React from 'react';
import { ArrowLeft, MapPin, MessageCircle, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { IdentityProfile, UserProfile } from '../../types';

interface Props {
  identity: IdentityProfile;
  currentUser: UserProfile;
  onBack: () => void;
  onDirect?: (identity: IdentityProfile) => void;
}

const StudioSpaceView: React.FC<Props> = ({ identity, currentUser, onBack, onDirect }) => {
  const isSelf = identity.isSelf || identity.name === currentUser.name;
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="relative min-h-[46vh] overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.22),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.25),transparent_32%),linear-gradient(180deg,rgba(0,0,0,0),#000)]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:36px_36px]" />
        <button onClick={onBack} className="absolute left-5 top-6 z-20 rounded-full border border-white/10 bg-black/35 p-3 text-white/70 backdrop-blur-xl hover:text-white">
          <ArrowLeft size={20} />
        </button>
        <div className="relative z-10 mx-auto flex min-h-[46vh] max-w-5xl flex-col justify-end px-6 pb-10 pt-24">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 sm:flex-row sm:items-end">
            <div className="h-32 w-32 overflow-hidden rounded-[2rem] border border-white/15 bg-white/5 p-1 shadow-2xl">
              <img src={identity.avatar} alt={identity.name} className="h-full w-full rounded-[1.65rem] object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/70">Studio Space</p>
              <h1 className="break-words text-5xl font-black tracking-tight sm:text-7xl">{identity.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/55">
                <span>{identity.handle || identity.id}</span>
                {identity.location && <span className="inline-flex items-center gap-1"><MapPin size={14} /> {identity.location}</span>}
                <span>{identity.status || 'offline'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {!isSelf && (
                <button onClick={() => onDirect?.(identity)} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-500">
                  <MessageCircle className="mr-2 inline h-4 w-4" /> Direct
                </button>
              )}
              <button className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-white/75 hover:bg-white/10">
                <Star className="mr-2 inline h-4 w-4" /> {identity.favorite ? 'Favorited' : 'Favorite'}
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-5 px-6 py-6 md:grid-cols-[1fr_320px]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-lg font-black">About</h2>
          <p className="mt-3 leading-relaxed text-white/65">
            {identity.tagline || identity.role || 'This Studio Space is ready for profile posts, projects, shared media, and identity history.'}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {(identity.mutualSpaces || ['Studio', 'Axis', identity.group || 'Creative']).map(space => (
              <div key={space} className="rounded-2xl border border-white/8 bg-black/25 p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/30">Space</div>
                <div className="mt-1 font-bold text-white">{space}</div>
              </div>
            ))}
          </div>
        </section>
        <aside className="space-y-5">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-white/45">Recent Activity</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/65">{identity.recentActivity || 'No public activity yet.'}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <h3 className="text-sm font-black uppercase tracking-widest text-white/45">Profile Source</h3>
            <p className="mt-3 text-sm text-white/65">{identity.source || 'studio'} identity layer</p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default StudioSpaceView;
