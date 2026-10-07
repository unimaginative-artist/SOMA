import * as React from 'react';
import { useState, useEffect } from 'react';
import { WidgetData, UserProfile } from '../../types';
import { MapPin, Clock, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  data: WidgetData;
  profile: UserProfile;
  isEditMode: boolean;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onOpenProfile?: () => void;
  profileStatus?: 'idle' | 'loading' | 'saved' | 'error';
}

export const ProfileWidget: React.FC<Props> = ({ data, profile, isEditMode, onOpenProfile, profileStatus = 'idle' }) => {
  const [time, setTime] = useState<string>('');
  
  // Settings from Widget Configuration
  const imageFilter = data.settings?.profileFilter || 'NONE';

  const activeFilterClass = (() => {
      switch(imageFilter) {
          case 'NOIR': return 'grayscale contrast-125 brightness-50';
          case 'SEPIA': return 'sepia contrast-110 brightness-50';
          case 'VINTAGE': return 'sepia-[.3] contrast-125 hue-rotate-[-10deg] saturate-150 brightness-50';
          case 'CYBER': return 'hue-rotate-180 contrast-125 saturate-200 brightness-50';
          case 'MATRIX': return 'grayscale sepia-[.8] hue-rotate-[50deg] contrast-125 brightness-50';
          case 'DREAM': return 'blur-[1px] brightness-75 contrast-90 saturate-150';
          case 'GRAIN': return 'contrast-150 brightness-50 sepia-[.2]';
          case 'NONE': return 'grayscale brightness-50 contrast-125'; // Match original hardcoded style
          default: return 'grayscale brightness-50 contrast-125';
      }
  })();

  // Real-time clock effect
  useEffect(() => {
    const updateTime = () => {
      const options: Intl.DateTimeFormatOptions = { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false,
        timeZone: profile.timezone.includes('UTC+9') ? 'Asia/Tokyo' : undefined 
      };
      setTime(new Date().toLocaleTimeString('en-US', options));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [profile.timezone]);

  const rawTopics: string[] = profile.publicIdentity?.topics?.slice(0, 3) || [];
  const TAGS = rawTopics.length
      ? rawTopics.map(t => t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`)
      : ['#Builder', '#AI', '#Systems'];
  const statusLabel = profileStatus === 'loading'
      ? 'Syncing'
      : profileStatus === 'saved'
          ? 'Saved'
          : profileStatus === 'error'
              ? 'Offline'
              : 'Online';
  const statusClass = profileStatus === 'error' ? 'bg-rose-400' : profileStatus === 'loading' ? 'bg-amber-300' : 'bg-emerald-400';

  return (
    <div className="w-full h-full min-h-[420px] flex flex-col relative group overflow-hidden bg-black">
        {/* Immersive Background Image (Top Half) with Breathing Animation */}
        <div className="absolute top-0 left-0 w-full h-[120%] z-0 overflow-hidden">
             <motion.img 
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                src={profile.coverImage || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop"} 
                className={`w-full h-full object-cover ${activeFilterClass}`} 
             />
             <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#000000]/60 to-[#000000]" />
        </div>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-end overflow-y-auto p-5 pt-20 sm:p-7 sm:pt-20 md:p-10 lg:p-12 custom-scrollbar">
            
            {/* Avatar / Name Group */}
            <div className="mb-5 flex min-w-0 items-end justify-between md:mb-6">
                <div className="min-w-0">
                    <h1 className="break-words text-[clamp(2rem,5vw,3.5rem)] font-sans font-bold text-white tracking-tight mb-2 leading-[0.95]">
                        {profile.name}
                    </h1>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-white/50 text-sm md:text-base font-medium">
                         {profile.location && (
                            <>
                              <span className="flex min-w-0 items-center gap-1.5"><MapPin size={14} className="shrink-0"/> <span className="truncate">{profile.location}</span></span>
                              <span className="hidden h-1 w-1 rounded-full bg-white/20 sm:block"></span>
                            </>
                         )}
                         <span className="flex items-center gap-1.5 font-mono"><Clock size={14}/> {time}</span>
                    </div>
                </div>
            </div>

            {/* Stats Row */}
            <div className="mb-6 grid grid-cols-3 gap-3 border-y border-white/5 py-4 sm:mb-8 sm:flex sm:items-center sm:gap-8 sm:border-y-0 sm:py-0">
                <div className="flex min-w-0 flex-col">
                    <span className="text-lg font-bold text-white sm:text-xl">
                        {(profile as any).bluesky?.followersCount != null
                            ? Number((profile as any).bluesky.followersCount).toLocaleString()
                            : (profile.axis?.friends?.length ?? 0)}
                    </span>
                    <span className="truncate text-[10px] text-white/40 font-medium uppercase tracking-wider sm:text-xs">Followers</span>
                </div>
                <div className="hidden w-px h-8 bg-white/10 sm:block"></div>
                <div className="flex min-w-0 flex-col">
                    <span className="text-lg font-bold text-white sm:text-xl">
                        {(profile as any).bluesky?.followsCount != null
                            ? Number((profile as any).bluesky.followsCount).toLocaleString()
                            : 0}
                    </span>
                    <span className="truncate text-[10px] text-white/40 font-medium uppercase tracking-wider sm:text-xs">Following</span>
                </div>
                <div className="hidden w-px h-8 bg-white/10 sm:block"></div>
                <div className="flex min-w-0 flex-col">
                    <span className="text-lg font-bold text-white sm:text-xl">
                        {(profile.studio?.portfolio?.length ?? 0)}
                    </span>
                    <span className="truncate text-[10px] text-white/40 font-medium uppercase tracking-wider sm:text-xs">Works</span>
                </div>
            </div>

            {/* Quote / Bio */}
            <div className="mb-5 max-w-2xl md:mb-6">
                {profile.manifesto && (
                    <h2 className="break-words text-[clamp(1.125rem,2.3vw,1.65rem)] font-bold text-white leading-tight mb-3">
                        "{profile.manifesto}"
                    </h2>
                )}
                <div className="space-y-1 text-white/60 text-sm md:text-base font-light">
                    <p className="flex min-w-0 items-center gap-2"><Zap size={14} className="shrink-0 text-yellow-400" /> <span className="break-words">{profile.role}</span></p>
                    <p className="break-words leading-relaxed">{profile.bio}</p>
                </div>
            </div>

            {/* Tags */}
            <div className="flex max-w-full flex-wrap gap-2 md:max-w-[75%]">
                {TAGS.map((tag, i) => (
                    <span key={i} className="px-3 py-1 rounded-full bg-white/5 border border-white/5 text-white/50 text-[10px] font-medium backdrop-blur-sm">
                        {tag}
                    </span>
                ))}
            </div>
        </div>

        <button
            type="button"
            onClick={onOpenProfile}
            className="absolute bottom-4 right-4 z-30 flex max-w-[min(78%,280px)] items-center gap-2.5 rounded-full border border-white/10 bg-black/45 py-1.5 pl-1.5 pr-3 text-left shadow-2xl backdrop-blur-xl transition-all duration-300 hover:scale-[1.02] hover:border-white/20 hover:bg-black/70 disabled:pointer-events-none sm:bottom-5 sm:right-5"
            disabled={!onOpenProfile || isEditMode}
            title="Open profile"
        >
            <div className="relative h-10 w-10 shrink-0">
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 opacity-50 blur-[2px]" />
                <div className="relative h-full w-full overflow-hidden rounded-full bg-gradient-to-br from-white/10 to-white/5 p-[2px]">
                    <img
                        src={profile.avatar}
                        alt={profile.name}
                        className="h-full w-full rounded-full object-cover brightness-95"
                    />
                </div>
            </div>
            <div className="min-w-0">
                <div className="truncate text-sm font-bold leading-tight text-white">{profile.name}</div>
                <div className="truncate text-[9px] font-mono uppercase tracking-[0.16em] text-white/45">{profile.role}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.14em] text-white/35">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusClass}`} />
                    {statusLabel}
                </div>
            </div>
        </button>
    </div>
  );
};
