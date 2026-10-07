import * as React from 'react';
import { useRef, useState } from 'react';
import { WidgetData, UserProfile, WidgetType, ChatSession } from '../types';
import WidgetFrame from './ui/WidgetFrame';
import OracleWidget from './widgets/OracleWidget';
import StatsWidget from './widgets/StatsWidget';
import GalleryWidget from './widgets/GalleryWidget';
import MediaWidget from './widgets/MediaWidget';
import ProjectsWidget from './widgets/ProjectsWidget';
import ActivityWidget from './widgets/ActivityWidget';
import SignalWidget from './widgets/SignalWidget';
import HubFeedWidget from './widgets/HubFeedWidget';
import MetricsWidget from './widgets/MetricsWidget';
import { ProfileWidget } from './widgets/ProfileWidget';
import ArtDisplayWidget from './widgets/ArtDisplayWidget';
import AppsFeedWidget from './widgets/AppsFeedWidget';
import SocialActivityWidget from './widgets/SocialActivityWidget';
import WidgetCatalog from './ui/WidgetCatalog';
import WidgetConfigModal from './ui/WidgetConfigModal';
import QuickChatModal from './ui/QuickChatModal';
import { INITIAL_WIDGETS } from '../constants';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  widgets: WidgetData[];
  userProfile: UserProfile;
  isEditMode: boolean;
  onUpdateWidget: (id: string, updates: Partial<WidgetData>) => void;
  onRemoveWidget: (id: string) => void;
  onAddWidget: (widget: WidgetData) => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onReorderWidget: (dragIndex: number, hoverIndex: number) => void;
  showCatalog: boolean;
  setShowCatalog: (show: boolean) => void;
  onEditProfile: () => void;
  profileStatus?: 'idle' | 'loading' | 'saved' | 'error';
}

const DashboardCanvas: React.FC<Props> = ({ 
    widgets, userProfile, isEditMode, onUpdateWidget, onRemoveWidget, onAddWidget, onUpdateProfile, onReorderWidget,
    showCatalog, setShowCatalog, onEditProfile, profileStatus = 'idle'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeQuickChat, setActiveQuickChat] = useState<ChatSession | null>(null);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const fixedOrder: WidgetType[] = [
      'PROFILE',
      'ART_DISPLAY',
      'STATS',
      'SIGNAL',
      'SOCIAL_ACTIVITY',
      'GALLERY',
      'HUB_FEED',
      'ECOSYSTEM',
  ];
  const fixedLayout: Partial<Record<WidgetType, Pick<WidgetData, 'colSpan' | 'rowSpan'>>> = {
      PROFILE: { colSpan: 1, rowSpan: 2 },
      ART_DISPLAY: { colSpan: 2, rowSpan: 1 },
      STATS: { colSpan: 1, rowSpan: 2 },
      SOCIAL_ACTIVITY: { colSpan: 1, rowSpan: 2 },
      GALLERY: { colSpan: 2, rowSpan: 2 },
      HUB_FEED: { colSpan: 1, rowSpan: 2 },
      ECOSYSTEM: { colSpan: 1, rowSpan: 1 },
      SIGNAL: { colSpan: 1, rowSpan: 1 },
  };
  const fixedWidgets = fixedOrder
      .map((type) => widgets.find(widget => widget.type === type) || INITIAL_WIDGETS.find(widget => widget.type === type))
      .map((widget) => widget ? { ...widget, ...(fixedLayout[widget.type] || {}) } : widget)
      .filter(Boolean) as WidgetData[];
  
  const handleCatalogSelect = (type: WidgetType, col: number, row: number, title: string) => {
      const newWidget: WidgetData = {
          id: `w-${Date.now()}`,
          type,
          title,
          colSpan: col,
          rowSpan: row,
          content: type === 'TEXT' ? { text: 'New Note' } : {}
      };
      onAddWidget(newWidget);
      setShowCatalog(false);
  };

  const handleEditWidget = (id: string) => {
      const widget = widgets.find(w => w.id === id);
      if (widget?.type === 'PROFILE') {
          onEditProfile();
      } else {
          setEditingWidgetId(id);
      }
  };

  // --- Drag & Drop Handlers ---
  const handleDragStart = (index: number) => {
      setDraggedIndex(index);
  };

  const handleDragEnter = (index: number) => {
      if (draggedIndex === null || draggedIndex === index) return;
      onReorderWidget(draggedIndex, index);
      setDraggedIndex(index);
  };

  const handleDragEnd = () => {
      setDraggedIndex(null);
  };

  const editingWidget = widgets.find(w => w.id === editingWidgetId);

  return (
    <div ref={containerRef} className="relative mx-auto min-h-full w-full px-3 pb-32 pt-3 sm:px-5 sm:pt-4 md:px-8 md:pt-5">
      
      {false && <WidgetCatalog 
        isOpen={showCatalog} 
        onClose={() => setShowCatalog(false)} 
        onSelect={handleCatalogSelect} 
      />}

      <AnimatePresence>
        {editingWidget && (
            <WidgetConfigModal
                widget={editingWidget}
                isOpen={!!editingWidget}
                onClose={() => setEditingWidgetId(null)}
                onSave={onUpdateWidget}
            />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeQuickChat && (
            <QuickChatModal 
                chat={activeQuickChat} 
                currentUser={userProfile}
                onClose={() => setActiveQuickChat(null)} 
            />
        )}
      </AnimatePresence>

      {/* Grid Container */}
      <motion.div 
        layout
        className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 auto-rows-[230px] md:auto-rows-[210px] gap-3 sm:gap-4 ${isEditMode ? 'opacity-100' : ''} grid-flow-dense`}
      >
        {fixedWidgets.map((widget, index) => (
          <WidgetFrame
            key={widget.id}
            widget={widget}
            isEditMode={false}
            onUpdate={onUpdateWidget}
            onRemove={onRemoveWidget}
            onEdit={handleEditWidget}
            // Drag Props
            index={index}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
          >
            {renderWidgetContent(widget)}
          </WidgetFrame>
        ))}
        
        {false && isEditMode && (
             <motion.button
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="col-span-1 row-span-1 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-white/40 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all gap-3 min-h-[220px] group cursor-pointer"
                onClick={() => setShowCatalog(true)}
             >
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform border border-white/5 group-hover:bg-white/10">
                    <span className="text-xl font-light">+</span>
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50 group-hover:text-white">Add Widget</span>
             </motion.button>
        )}
      </motion.div>
    </div>
  );

  function renderWidgetContent(widget: WidgetData) {
    const dispatchNav = (view: string, context: any) => {
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view, context } }));
    };

    switch (widget.type) {
      case 'PROFILE': return (
        <ProfileWidget
          data={widget}
          profile={userProfile}
          isEditMode={isEditMode}
          onUpdateProfile={onUpdateProfile}
          onOpenProfile={onEditProfile}
          profileStatus={profileStatus}
        />
      );
      case 'ART_DISPLAY': return <ArtDisplayWidget data={widget} currentUser={userProfile} onNavigate={dispatchNav} />;
      case 'INSPIRE': return <OracleWidget data={widget} allWidgets={widgets} userProfile={userProfile} />;
      case 'STATS': return <StatsWidget data={widget} />;
      case 'GALLERY': return (
        <GalleryWidget 
            data={widget} 
            currentUser={userProfile} 
            isWidget={true} 
            onChatSelect={(chat) => setActiveQuickChat(chat)} 
        />
      );
      case 'MEDIA': return <MediaWidget data={widget} />;
      case 'PROJECTS': return <ProjectsWidget data={widget} />;
      case 'ACTIVITY': return <ActivityWidget data={widget} />;
      case 'SIGNAL': return <SignalWidget data={widget} profile={userProfile} onUpdateProfile={onUpdateProfile} />;
      case 'HUB_FEED': return <HubFeedWidget data={widget} onNavigate={dispatchNav} />;
      case 'METRICS': return <MetricsWidget data={widget} />;
      case 'ECOSYSTEM': return <AppsFeedWidget data={widget} onNavigate={(view) => dispatchNav(view, {})} />;
      case 'SOCIAL_ACTIVITY': return <SocialActivityWidget data={widget} />;
      case 'TEXT': 
        return (
            <div className="p-8 flex items-center justify-center h-full text-center relative overflow-hidden group">
                <p className="font-display text-xl md:text-2xl font-medium leading-tight text-white/90 relative z-10" contentEditable={isEditMode} suppressContentEditableWarning>
                    {widget.content?.text || "Empty Note"}
                </p>
            </div>
        );
      default: return <div className="p-4 text-white/50 text-xs">Unknown Component</div>;
    }
  }
};

export default DashboardCanvas;
