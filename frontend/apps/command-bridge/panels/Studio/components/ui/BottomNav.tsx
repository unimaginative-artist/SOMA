import * as React from 'react';
import { Home, MessageSquare, Users, Edit3 } from 'lucide-react';
import { AppView } from '../../types';
import { NavTheme } from './NavConfigModal';

interface Props {
    currentView: AppView;
    onNavigate: (view: AppView) => void;
    onAdd?: () => void;
    theme: NavTheme;
    isEditMode: boolean;
    onEditNav: () => void;
}

const BottomNav: React.FC<Props> = ({ currentView, onNavigate, theme, isEditMode, onEditNav }) => {
  const { style, color, scale = 1 } = theme;

  // --- PRODUCTION READY STYLE RENDERERS ---

  const renderIsland = () => (
      <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-full px-8 py-4 flex items-center gap-10 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] pointer-events-auto transition-all duration-300 ring-1 ring-white/5">
         {renderButtons('text-white/40 hover:text-white', `text-white bg-white/10 shadow-[0_0_15px_-3px_rgba(255,255,255,0.2)]`)}
      </div>
  );

  const renderDock = () => (
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl px-6 py-4 flex items-center gap-6 shadow-2xl pointer-events-auto mb-6 transition-all duration-300 hover:border-white/20 hover:bg-white/10">
         {renderButtons('text-white/60 hover:text-white hover:-translate-y-2 transition-transform duration-200', `text-white -translate-y-3 scale-110 drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)]`)}
      </div>
  );

  const renderCyber = () => (
      <div 
        className="bg-black border px-10 py-4 flex items-center gap-12 pointer-events-auto"
        style={{ 
            borderColor: color, 
            boxShadow: `0 0 20px -5px ${color}40`,
            clipPath: 'polygon(10% 0, 100% 0, 100% 70%, 90% 100%, 0 100%, 0 30%)'
        }}
      >
         {renderButtons('text-white/40 hover:text-white', 'text-white')}
      </div>
  );

  const renderMinimal = () => (
      <div className="flex items-center gap-14 pointer-events-auto bg-black/80 px-10 py-5 rounded-full backdrop-blur-md border border-white/5 shadow-2xl">
          {renderButtons(
              'text-white/30 hover:text-white hover:scale-110 transition-all duration-300', 
              `text-white scale-125 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]`
            )}
      </div>
  );

  const renderGlow = () => (
      <div className="relative group/glow">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 rounded-full blur opacity-25 group-hover/glow:opacity-50 transition duration-1000 group-hover/glow:duration-200"></div>
          <div className="relative bg-black border border-white/10 rounded-full px-10 py-5 flex items-center gap-12 pointer-events-auto">
             {renderButtons('text-white/40 hover:text-white', 'text-white')}
          </div>
      </div>
  );

  const renderButtons = (baseClass: string, activeClass: string) => (
      <>
        <button 
            onClick={() => onNavigate('home')}
            className={`p-2 rounded-xl transition-all duration-300 ${currentView === 'home' ? activeClass : baseClass}`}
        >
            <Home size={22} fill={currentView === 'home' ? "currentColor" : "none"} strokeWidth={currentView === 'home' ? 2 : 1.5} />
        </button>
        <button 
            onClick={() => onNavigate('chats')}
            className={`p-2 rounded-xl transition-all duration-300 ${currentView === 'chats' ? activeClass : baseClass}`}
            title="Directs"
        >
            <MessageSquare size={22} fill={currentView === 'chats' ? "currentColor" : "none"} strokeWidth={currentView === 'chats' ? 2 : 1.5} />
        </button>
        <button
            onClick={() => onNavigate('community')}
            className={`p-2 rounded-xl transition-all duration-300 ${currentView === 'community' ? activeClass : baseClass}`}
        >
            <Users size={22} fill={currentView === 'community' ? "currentColor" : "none"} strokeWidth={currentView === 'community' ? 2 : 1.5} />
        </button>
      </>
  );

  const getContent = () => {
      switch(style) {
          case 'DOCK': return renderDock();
          case 'CYBER': return renderCyber();
          case 'MINIMAL': return renderMinimal();
          case 'GLOW': return renderGlow();
          case 'ISLAND': 
          default: return renderIsland();
      }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[999] flex justify-center p-3 pointer-events-none group/nav sm:p-6 md:p-8">
      <div 
        className="relative max-w-[calc(100%-1rem)] transition-transform duration-300 origin-bottom" 
        style={{ transform: `scale(${scale})` }}
      >
          {isEditMode && (
              <button 
                onClick={onEditNav}
                className="absolute -top-16 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-4 py-1.5 rounded-full text-xs font-bold pointer-events-auto animate-bounce shadow-lg shadow-indigo-500/30 z-[1000] flex items-center gap-2 border border-indigo-400/50 hover:bg-indigo-400 transition-colors"
              >
                 <Edit3 size={12} /> Edit Nav
              </button>
          )}
          
          <div className={`${isEditMode ? 'ring-2 ring-indigo-500 rounded-full p-2' : ''} transition-all`}>
            {getContent()}
          </div>
      </div>
    </div>
  );
};

export default BottomNav;
