import * as React from 'react';
import { UserProfile, WidgetData } from '../../types';
import { Radio, Github, Twitter, Linkedin, Instagram, ArrowUpRight, Dribbble, Youtube, Twitch, Mail, Music, Disc, Video, Share2 } from 'lucide-react';
import { RENDER_BUTTON } from '../ui/StyledButtons';

interface Props {
    data: WidgetData;
    profile?: UserProfile;
    onUpdateProfile?: (updates: Partial<UserProfile>) => void;
}

const presenceOptions = [
    { key: 'online', label: 'Online', dot: 'bg-emerald-500', headline: 'Online', subtext: 'Available and actively building.' },
    { key: 'building', label: 'Building', dot: 'bg-cyan-400', headline: 'Building', subtext: 'Focused on SOMA, Axis, and useful systems.' },
    { key: 'focused', label: 'Focused', dot: 'bg-amber-300', headline: 'Focus Mode', subtext: 'Deep work active. Route only important signals.' },
    { key: 'autonomous', label: 'Autonomous', dot: 'bg-purple-400', headline: 'SOMA Active', subtext: 'SOMA can monitor, queue, and organize in the background.' },
    { key: 'away', label: 'Away', dot: 'bg-zinc-500', headline: 'Away', subtext: 'Low attention mode. Capture updates for later.' },
];

const SignalWidget: React.FC<Props> = ({ data, profile, onUpdateProfile }) => {
  const settings = data.settings || {};
  const content = data.content || {};
  const socials = content.socials || {};
  const presence = String((profile as any)?.axis?.status || content.status || 'online');
  const activePresence = presenceOptions.find(option => option.key === presence) || presenceOptions[0];

  const buttonStyle = settings.buttonStyle || 'COSMOS';
  const buttonText = settings.buttonText || 'Contact';
  const buttonColor = settings.buttonColor || '#ffffff';

  const hasSocials = Object.values(socials).some(val => val && (val as string).length > 0);
  const setPresence = (status: string) => {
      const option = presenceOptions.find(item => item.key === status) || presenceOptions[0];
      onUpdateProfile?.({
          axis: {
              ...((profile as any)?.axis || {}),
              status,
              presenceText: option.subtext,
          },
      } as Partial<UserProfile>);
  };

  const getIcon = (key: string) => {
      switch(key) {
          case 'github': return <Github size={18} />;
          case 'twitter': return <Twitter size={18} />;
          case 'linkedin': return <Linkedin size={18} />;
          case 'instagram': return <Instagram size={18} />;
          case 'dribbble': return <Dribbble size={18} />;
          case 'youtube': return <Youtube size={18} />;
          case 'twitch': return <Twitch size={18} />;
          case 'email': return <Mail size={18} />;
          case 'tiktok': return <Video size={18} />;
          case 'discord': return <MessageIcon size={18} />; // Custom svg fallback if needed or generic
          case 'behance': return <Share2 size={18} />;
          case 'pinterest': return <Share2 size={18} />;
          case 'patreon': return <HeartIcon size={18} />;
          case 'spotify': return <Music size={18} />;
          case 'soundcloud': return <Disc size={18} />;
          default: return <ArrowUpRight size={18} />;
      }
  };

  return (
    <div className="w-full h-full flex flex-col justify-between p-4 relative overflow-hidden bg-[#0A0A0A] group/widget">
      
        {/* Header */}
        <div className="flex items-center justify-between z-10">
            <div className="flex items-center gap-2 text-white/50">
                <Radio size={16} className={presence === 'away' ? 'text-zinc-400' : presence === 'focused' ? 'text-amber-300' : 'text-emerald-400'} />
                <span className="text-xs font-mono uppercase tracking-widest">Status</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${activePresence.dot} animate-pulse shadow-[0_0_10px_currentColor] text-emerald-500`}></div>
        </div>

        {/* Main Status */}
        <div className="flex-1 flex min-h-0 flex-col justify-center z-10 py-2">
            <h3 className="text-base font-bold text-white mb-1 leading-tight">
                {content.headline || activePresence.headline}
            </h3>
            <p className="text-xs text-white/50 leading-relaxed font-light line-clamp-2">
                {(profile as any)?.axis?.presenceText || content.subtext || activePresence.subtext}
            </p>
        </div>

        {/* Footer Area with Socials & Custom Button */}
        <div className="flex shrink-0 flex-col gap-2 z-10">
             <div className="grid grid-cols-5 gap-1">
                {presenceOptions.slice(0, 5).map(option => (
                    <button
                        key={option.key}
                        type="button"
                        onClick={() => setPresence(option.key)}
                        title={option.label}
                        className={`h-6 min-w-0 rounded-md border px-1 text-[8px] font-bold uppercase leading-none transition-colors ${presence === option.key ? 'border-white/25 bg-white/15 text-white' : 'border-white/5 bg-white/5 text-white/35 hover:text-white'}`}
                    >
                        <span className="block truncate">{option.label}</span>
                    </button>
                ))}
             </div>
             {/* Social Row */}
             {hasSocials && (
                 <div className="flex gap-4 items-center px-1 overflow-x-auto no-scrollbar pb-1 mask-gradient-right">
                    {Object.entries(socials).map(([key, url]) => {
                        if (!url) return null;
                        return (
                            <a 
                                key={key} 
                                href={url as string} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-white/30 hover:text-white transition-colors hover:scale-110 transform duration-200"
                                title={key}
                            >
                                {getIcon(key)}
                            </a>
                        );
                    })}
                 </div>
             )}

             {/* The Custom Button */}
             <div className="w-full shrink-0">
                 {RENDER_BUTTON(buttonStyle, {
                     text: buttonText,
                     onClick: () => window.location.href = `mailto:${socials.email || ''}`,
                     color: buttonColor
                 })}
             </div>
        </div>
        
        {/* Background Noise/Texture */}
        <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.28)_0,transparent_62%)]"></div>
    </div>
  );
};

// Simple Fallback Icons
const MessageIcon = ({size}: {size: number}) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const HeartIcon = ({size}: {size: number}) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
);

export default SignalWidget;
