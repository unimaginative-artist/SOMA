import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, Minimize2, Trash2, Settings2, GripVertical } from 'lucide-react';
import { WidgetData } from '../../types';

interface WidgetFrameProps {
  widget: WidgetData;
  isEditMode: boolean;
  onUpdate: (id: string, updates: Partial<WidgetData>) => void;
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  children: React.ReactNode;
  // Drag props
  index?: number;
  onDragStart?: (index: number) => void;
  onDragEnter?: (index: number) => void;
  onDragEnd?: () => void;
}

const WidgetFrame: React.FC<WidgetFrameProps> = ({ 
  widget, 
  isEditMode, 
  onUpdate, 
  onRemove, 
  onEdit,
  children,
  index,
  onDragStart,
  onDragEnter,
  onDragEnd
}) => {
  const colSpanClasses: Record<number, string> = {
    1: 'lg:col-span-1',
    2: 'lg:col-span-2',
    3: 'lg:col-span-3',
    4: 'lg:col-span-4',
  };

  const rowSpanClasses: Record<number, string> = {
    1: 'md:row-span-1',
    2: 'md:row-span-2',
    3: 'md:row-span-3',
    4: 'md:row-span-4',
  };
  
  const getSpanClasses = () => {
    // Responsive spanning logic
    const tabletSpan = widget.colSpan >= 2 ? 'md:col-span-2' : 'md:col-span-1';
    const desktopSpan = colSpanClasses[Math.min(4, Math.max(1, widget.colSpan))] || 'lg:col-span-1';
    
    // Mobile Optimization: 
    // Allow content-heavy widgets like GALLERY, HUB_FEED, and PROFILE to take 2 rows on mobile.
    // Others default to 1 row to keep the feed compact.
    const isTallWidget = ['PROFILE', 'GALLERY', 'HUB_FEED', 'SOCIAL_ACTIVITY'].includes(widget.type);
    const mobileRowSpan = widget.type === 'GALLERY' ? 'row-span-2' : isTallWidget ? 'row-span-2' : 'row-span-1';
    
    const rowSpan = widget.type === 'GALLERY' ? Math.max(2, widget.rowSpan) : widget.rowSpan;
    const desktopRowSpan = rowSpanClasses[Math.min(4, Math.max(1, rowSpan))] || 'md:row-span-1';
    
    return `col-span-1 ${tabletSpan} ${desktopSpan} ${mobileRowSpan} ${desktopRowSpan}`;
  };

  const handleResize = (dim: 'col' | 'row', delta: number) => {
    const key = dim === 'col' ? 'colSpan' : 'rowSpan';
    const current = widget[key];
    const next = Math.max(1, Math.min(4, current + delta));
    onUpdate(widget.id, { [key]: next });
  };

  // Profile widget gets special "no container" treatment to look like the background
  const isProfile = widget.type === 'PROFILE';
  const isDeletable = widget.type !== 'PROFILE';

  return (
    <motion.div
      layout={!isProfile} 
      id={widget.id} 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, scale: isEditMode ? 0.98 : 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      draggable={isEditMode}
      onDragStart={() => {
        if (isEditMode && onDragStart && index !== undefined) onDragStart(index);
      }}
      onDragEnter={() => {
        if (isEditMode && onDragEnter && index !== undefined) onDragEnter(index);
      }}
      onDragEnd={() => {
        if (isEditMode && onDragEnd) onDragEnd();
      }}
      onDragOver={(e) => e.preventDefault()} // Necessary for drop to work
      className={`relative group flex flex-col ${getSpanClasses()} ${
          isProfile ? 'rounded-b-3xl -mx-4 -mt-4 md:rounded-3xl md:mx-0 md:mt-0 z-40' : 'rounded-3xl z-0'
      } ${isEditMode ? 'ring-2 ring-white/10 z-20 cursor-grab active:cursor-grabbing hover:ring-white/30' : ''}`}
    >
        {/* Edit Controls */}
        <AnimatePresence>
            {isEditMode && (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-6 p-6 rounded-3xl"
                >
                     <div className="text-white/20">
                        <GripVertical size={32} />
                     </div>

                     {/* Simplified Edit Controls */}
                    <div className="flex items-center gap-4 text-white">
                         <div className="flex items-center bg-white/10 rounded-full border border-white/5">
                            <button onClick={() => handleResize('col', -1)} className="p-3 hover:bg-white/10 rounded-l-full transition-colors"><Minimize2 size={16}/></button>
                            <span className="text-xs font-mono w-8 text-center border-l border-r border-white/5 h-full flex items-center justify-center">{widget.colSpan}</span>
                            <button onClick={() => handleResize('col', 1)} className="p-3 hover:bg-white/10 rounded-r-full transition-colors"><Maximize2 size={16}/></button>
                         </div>
                         
                         {onEdit && (
                             <button 
                                onClick={() => onEdit(widget.id)} 
                                className="p-3 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full hover:bg-blue-500/30 transition-colors"
                                title="Configure Widget"
                             >
                                <Settings2 size={16} />
                             </button>
                         )}

                         {isDeletable && (
                             <button 
                                onClick={() => onRemove(widget.id)} 
                                className="p-3 bg-red-500/20 text-red-400 border border-red-500/30 rounded-full hover:bg-red-500/30 transition-colors"
                                title="Remove Widget"
                             >
                                <Trash2 size={16}/>
                             </button>
                         )}
                    </div>
                    <div className="text-white/40 text-xs font-mono uppercase tracking-widest pointer-events-none">{widget.title}</div>
                </motion.div>
            )}
        </AnimatePresence>

        <div className={`min-h-0 flex-1 relative flex flex-col overflow-hidden ${isEditMode ? 'blur-[2px] opacity-50' : ''}`}>
            {children}
        </div>
    </motion.div>
  );
};

export default WidgetFrame;
