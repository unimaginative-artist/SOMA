import * as React from 'react';
import { useEffect, useState } from 'react';
import { WidgetData } from '../../types';
import { Plus, Users } from 'lucide-react';

interface Community {
    id: string;
    name: string;
    icon?: string;
    image?: string;
    cover_image?: string;
    my_role?: string;
}

interface Props {
    data: WidgetData;
    onNavigate?: (view: string, context?: any) => void;
}

const HubFeedWidget: React.FC<Props> = ({ data, onNavigate }) => {
  const [communities, setCommunities] = useState<Community[]>([]);

  useEffect(() => {
      let cancelled = false;
      const axisUser = (() => { try { return JSON.parse(localStorage.getItem('axis_user_v2') || 'null'); } catch { return null; } })();
      fetch('/api/axis/communities', {
          headers: {
              'Content-Type': 'application/json',
              'x-axis-user-id': axisUser?.id || 'studio-user',
              'x-axis-user-name': axisUser?.name || 'Studio User',
              'x-axis-user-color': axisUser?.color || 'violet',
          },
      })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
              if (cancelled || !Array.isArray(d?.communities)) return;
              setCommunities(d.communities.map((item: any) => ({
                  id: item.id,
                  name: item.name,
                  icon: item.icon,
                  image: item.cover_image || item.coverImage || item.image,
                  my_role: item.my_role,
              })));
          })
          .catch(() => {});
      return () => { cancelled = true; };
  }, []);

  const handleCommunityClick = (id: string) => {
      onNavigate?.('community-hub', { communityId: id });
  };

  const handleExplore = () => {
      onNavigate?.('community-hub', { mode: 'explore' });
  };

  const display = communities.slice(0, 7);

  return (
    <div className="w-full h-full flex flex-col p-6">
       <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
              <Users size={20} className="text-white" />
              <h3 className="text-xl font-bold text-white tracking-tight font-display">Communities</h3>
          </div>
          <span className="text-xs font-medium text-white/40 bg-white/5 px-2 py-1 rounded-full">
              {communities.length > 0 ? `${communities.filter(c => c.my_role).length} joined` : 'Active Nodes'}
          </span>
      </div>

      <div className="grid grid-cols-4 gap-3 flex-1 content-start">
         {display.length === 0
             ? Array.from({ length: 7 }).map((_, i) => (
                 <div key={i} className="flex flex-col items-center gap-2">
                     <div className="w-full aspect-square rounded-2xl bg-white/5 border border-white/5 animate-pulse" />
                     <div className="h-2.5 w-10 rounded bg-white/5 animate-pulse" />
                 </div>
             ))
             : display.map(item => (
                 <div
                    key={item.id}
                    onClick={() => handleCommunityClick(item.id)}
                    className="flex flex-col items-center gap-2 group cursor-pointer"
                 >
                     <div className="w-full aspect-square rounded-2xl bg-white/5 border border-white/5 overflow-hidden relative shadow-lg">
                         {item.image
                             ? <img src={item.image} className="w-full h-full object-cover opacity-60 group-hover:opacity-90 group-hover:scale-110 transition-all duration-500" />
                             : <div className="w-full h-full flex items-center justify-center text-2xl">{item.icon || '💬'}</div>
                         }
                     </div>
                     <span className="text-[10px] font-medium text-white/40 group-hover:text-white transition-colors truncate max-w-full">{item.name}</span>
                 </div>
             ))
         }

         <div
            onClick={handleExplore}
            className="flex flex-col items-center gap-2 group cursor-pointer"
         >
             <div className="w-full aspect-square rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center overflow-hidden relative group-hover:border-white/30 transition-all shadow-[0_0_15px_rgba(168,85,247,0.15)] group-hover:shadow-[0_0_25px_rgba(168,85,247,0.3)]">
                 <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                 <Plus size={24} className="text-white opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-all" />
             </div>
             <span className="text-[10px] font-bold text-indigo-300 group-hover:text-white transition-colors">Join</span>
         </div>
      </div>
    </div>
  );
};

export default HubFeedWidget;
