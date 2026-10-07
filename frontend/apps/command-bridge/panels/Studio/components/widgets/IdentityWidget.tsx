import * as React from 'react';
import { WidgetData } from '../../types';
import { MapPin, Globe, Fingerprint } from 'lucide-react';

interface Props {
    data: WidgetData;
}

const IdentityWidget: React.FC<Props> = ({ data }) => {
  const content = data.content || {};

  return (
    <div className="w-full h-full flex flex-col md:flex-row relative">
      {/* Background/Cover */}
      <div className="absolute inset-0 z-0">
         <img src="https://picsum.photos/800/800?grayscale" className="w-full h-full object-cover opacity-20 mix-blend-overlay" />
         <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col justify-end p-6 md:p-8 h-full w-full">
         <div className="flex items-start justify-between mb-4">
             <div className="w-16 h-16 md:w-20 md:h-20 rounded-full border-2 border-white/20 overflow-hidden relative group">
                <img src={content.avatar} alt="Avatar" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
             </div>
             <Fingerprint className="text-white/20" size={32} />
         </div>

         <h1 className="text-3xl md:text-5xl font-display font-bold tracking-tight text-white mb-2">
             {content.name}
         </h1>
         <h2 className="text-lg md:text-2xl text-white/60 font-light mb-4 md:mb-6 tracking-wide">
             {content.role}
         </h2>

         <div className="w-full h-px bg-white/10 mb-4 md:mb-6" />

         <p className="text-white/80 leading-relaxed font-light text-base md:text-lg max-w-md line-clamp-4 md:line-clamp-none">
             {content.bio}
         </p>

         <div className="flex flex-wrap gap-4 mt-6">
             <span className="flex items-center gap-2 text-xs md:text-sm text-white/50 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                 <MapPin size={12} /> Tokyo, JP
             </span>
             <span className="flex items-center gap-2 text-xs md:text-sm text-white/50 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                 <Globe size={12} /> UTC+9
             </span>
         </div>
      </div>
    </div>
  );
};

export default IdentityWidget;