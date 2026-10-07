import * as React from 'react';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Layout, Database, Palette, Camera, Type, Share2, MousePointerClick } from 'lucide-react';
import { WidgetData } from '../../types';
import { RENDER_BUTTON } from './StyledButtons';

interface Props {
  widget: WidgetData;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<WidgetData>) => void;
}

// Presets
const BUTTON_STYLES = [
    { id: 'COSMOS', label: 'Cosmos' },
    { id: 'MULTICOLOR', label: 'Multicolor' },
    { id: 'ORBIT', label: 'Orbit' },
    { id: 'NEON', label: 'Neon' },
    { id: 'BRUTALIST', label: 'Brutalist' },
    { id: 'MINIMAL', label: 'Minimal' },
    { id: 'GLITCH', label: 'Glitch' },
    { id: 'SOFT', label: 'Soft' },
    { id: 'GLASS', label: 'Glass' },
    { id: 'CYBER', label: 'Cyber' },
    { id: 'RETRO', label: 'Retro' },
    { id: 'LIQUID', label: 'Liquid' },
];

const IMG_FILTERS = [
    { id: 'NONE', label: 'None' },
    { id: 'NOIR', label: 'Noir (B&W)' },
    { id: 'SEPIA', label: 'Sepia' },
    { id: 'VINTAGE', label: 'Vintage' },
    { id: 'CYBER', label: 'Cyber (Blue)' },
    { id: 'MATRIX', label: 'Matrix' },
    { id: 'DREAM', label: 'Dream Blur' },
    { id: 'GRAIN', label: 'High Grain' },
];

const SOCIAL_PLATFORMS = [
    { id: 'github', label: 'GitHub' },
    { id: 'twitter', label: 'Twitter / X' },
    { id: 'linkedin', label: 'LinkedIn' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'dribbble', label: 'Dribbble' },
    { id: 'youtube', label: 'YouTube' },
    { id: 'twitch', label: 'Twitch' },
    { id: 'discord', label: 'Discord' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'behance', label: 'Behance' },
    { id: 'pinterest', label: 'Pinterest' },
    { id: 'patreon', label: 'Patreon' },
    { id: 'spotify', label: 'Spotify' },
    { id: 'soundcloud', label: 'SoundCloud' },
    { id: 'email', label: 'Email (mailto:)' },
];

const WidgetConfigModal: React.FC<Props> = ({ widget, isOpen, onClose, onSave }) => {
  const [formData, setFormData] = useState<WidgetData>(widget);
  const [activeTab, setActiveTab] = useState<'general' | 'content' | 'style'>('general');

  // Reset form data when widget changes
  useEffect(() => {
    setFormData(widget);
  }, [widget]);

  const handleSave = () => {
    onSave(widget.id, formData);
    onClose();
  };

  const updateContent = (key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      content: { ...prev.content, [key]: value }
    }));
  };

  const updateNestedContent = (parent: string, key: string, value: any) => {
      setFormData(prev => ({
          ...prev,
          content: { 
              ...prev.content, 
              [parent]: {
                  ...(prev.content?.[parent] || {}),
                  [key]: value
              } 
          }
      }));
  };

  const updateSetting = (key: string, value: any) => {
      setFormData(prev => ({
          ...prev,
          settings: { ...prev.settings, [key]: value }
      }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="relative w-full max-w-2xl bg-[#0F0F0F] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/5">
                  <Layout size={20} className="text-white/70" />
              </div>
              <div>
                  <h2 className="text-lg font-bold text-white leading-none">Configure Widget</h2>
                  <p className="text-xs text-white/40 mt-1 font-mono uppercase tracking-wider">{widget.type} // {widget.id}</p>
              </div>
           </div>
           <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <X size={20} />
           </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-6 border-b border-white/5 gap-6">
            <button 
                onClick={() => setActiveTab('general')}
                className={`py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'general' ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white'}`}
            >
                General
            </button>
            <button 
                onClick={() => setActiveTab('content')}
                className={`py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'content' ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white'}`}
            >
                Data & Content
            </button>
            <button 
                onClick={() => setActiveTab('style')}
                className={`py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'style' ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white'}`}
            >
                Appearance
            </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            
            {activeTab === 'general' && (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Widget Title</label>
                        <input 
                            type="text" 
                            value={formData.title} 
                            onChange={(e) => setFormData({...formData, title: e.target.value})}
                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Columns (Width)</label>
                            <div className="flex items-center gap-4 bg-black/20 border border-white/10 rounded-xl p-2">
                                <input 
                                    type="range" min="1" max="4" step="1"
                                    value={formData.colSpan}
                                    onChange={(e) => setFormData({...formData, colSpan: parseInt(e.target.value)})}
                                    className="flex-1 accent-white"
                                />
                                <span className="w-8 text-center font-mono text-sm">{formData.colSpan}</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Rows (Height)</label>
                            <div className="flex items-center gap-4 bg-black/20 border border-white/10 rounded-xl p-2">
                                <input 
                                    type="range" min="1" max="4" step="1"
                                    value={formData.rowSpan}
                                    onChange={(e) => setFormData({...formData, rowSpan: parseInt(e.target.value)})}
                                    className="flex-1 accent-white"
                                />
                                <span className="w-8 text-center font-mono text-sm">{formData.rowSpan}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'content' && (
                <div className="space-y-6">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-3">
                        <Database size={16} className="text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-blue-200/70">
                            Edit the data for this widget.
                        </p>
                    </div>

                    {/* SIGNAL WIDGET SPECIFIC: Social Media Links */}
                    {widget.type === 'SIGNAL' && (
                        <div className="space-y-6">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Share2 size={16} className="text-purple-400" /> Social Links
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {SOCIAL_PLATFORMS.map((platform) => (
                                    <div key={platform.id} className="space-y-1">
                                        <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">{platform.label}</label>
                                        <input 
                                            type="text" 
                                            value={formData.content?.socials?.[platform.id] || ''}
                                            onChange={(e) => updateNestedContent('socials', platform.id, e.target.value)}
                                            placeholder={`https://${platform.id === 'email' ? '' : platform.id.toLowerCase() + '.com/'}...`}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-white/30 text-xs"
                                        />
                                    </div>
                                ))}
                            </div>
                            
                            <div className="h-px bg-white/10 my-4" />
                            
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Type size={16} className="text-orange-400" /> Status Text
                            </h3>
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Headline</label>
                                    <input 
                                        type="text" 
                                        value={formData.content?.headline || ''}
                                        onChange={(e) => updateContent('headline', e.target.value)}
                                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-white/30 text-sm"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Subtext</label>
                                    <textarea 
                                        value={formData.content?.subtext || ''}
                                        onChange={(e) => updateContent('subtext', e.target.value)}
                                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-white/30 text-sm resize-none h-20"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Generic Fallback */}
                    {widget.type !== 'SIGNAL' && (
                        Object.keys(formData.content || {}).length > 0 ? (
                             <div className="space-y-4">
                                {Object.entries(formData.content || {}).map(([key, value]) => (
                                    <div key={key} className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">{key}</label>
                                        {typeof value === 'string' && value.length > 50 ? (
                                             <textarea 
                                                value={value as string}
                                                onChange={(e) => updateContent(key, e.target.value)}
                                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors h-24 resize-y text-sm"
                                             />
                                        ) : (
                                            <input 
                                                type="text" 
                                                value={value as string}
                                                onChange={(e) => updateContent(key, e.target.value)}
                                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors text-sm"
                                            />
                                        )}
                                    </div>
                                ))}
                             </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="text-center text-white/20 text-sm py-8 italic">
                                    No editable content found for this widget type.
                                </div>
                            </div>
                        )
                    )}
                </div>
            )}

            {activeTab === 'style' && (
                <div className="space-y-8">
                     {/* PROFILE SPECIFIC CUSTOMIZATION */}
                     {widget.type === 'PROFILE' && (
                         <>
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Camera size={16} className="text-blue-400" /> Profile Image Filter
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {IMG_FILTERS.map(filter => (
                                        <button
                                            key={filter.id}
                                            onClick={() => updateSetting('profileFilter', filter.id)}
                                            className={`px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-all ${
                                                formData.settings?.profileFilter === filter.id 
                                                ? 'bg-white text-black border-white' 
                                                : 'bg-white/5 text-white/60 border-white/5 hover:border-white/20'
                                            }`}
                                        >
                                            {filter.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="w-full h-px bg-white/10 my-4" />
                         </>
                     )}

                     {/* SIGNAL WIDGET SPECIFIC CUSTOMIZATION */}
                     {widget.type === 'SIGNAL' && (
                         <>
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <MousePointerClick size={16} className="text-emerald-400" /> Contact Button Style
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {BUTTON_STYLES.map(style => (
                                        <div key={style.id} className={`relative group ${formData.settings?.buttonStyle === style.id ? 'ring-2 ring-white rounded-xl p-1' : 'p-1'}`}>
                                             <div onClick={() => updateSetting('buttonStyle', style.id)}>
                                                {RENDER_BUTTON(style.id, {
                                                    text: style.label,
                                                    color: formData.settings?.buttonColor || '#ffffff',
                                                    onClick: () => updateSetting('buttonStyle', style.id)
                                                })}
                                             </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        <Type size={16} className="text-indigo-400" /> Button Text
                                    </h3>
                                    <input 
                                        type="text" 
                                        value={formData.settings?.buttonText || 'Contact'}
                                        onChange={(e) => updateSetting('buttonText', e.target.value)}
                                        placeholder="e.g. Hire Me"
                                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 text-sm"
                                    />
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                        <Palette size={16} className="text-pink-400" /> Button Color
                                    </h3>
                                    <div className="flex items-center gap-4">
                                        <input 
                                            type="color" 
                                            value={formData.settings?.buttonColor || '#ffffff'}
                                            onChange={(e) => updateSetting('buttonColor', e.target.value)}
                                            className="w-12 h-12 rounded-xl cursor-pointer bg-transparent border-none" 
                                        />
                                        <span className="text-xs font-mono text-white/50">{formData.settings?.buttonColor || '#ffffff'}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="w-full h-px bg-white/10 my-4" />
                         </>
                     )}

                     {/* GENERIC STYLES */}
                     <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-black/40 border border-white/10 hover:border-white/30 cursor-pointer transition-all">
                            <div className="w-full aspect-video bg-[#000] rounded-lg mb-3 border border-white/5"></div>
                            <h3 className="text-sm font-medium text-white">Default Dark</h3>
                        </div>
                        <div className="p-4 rounded-xl bg-black/40 border border-white/10 hover:border-white/30 cursor-pointer transition-all">
                            <div className="w-full aspect-video bg-white/5 rounded-lg mb-3 border border-white/5 backdrop-blur-md"></div>
                            <h3 className="text-sm font-medium text-white">Glassmorphism</h3>
                        </div>
                     </div>
                     
                     <div className="space-y-2">
                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Custom CSS Classes</label>
                        <input 
                            type="text" 
                            placeholder="e.g. bg-red-500 text-black"
                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-colors text-sm font-mono"
                        />
                     </div>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-[#0A0A0A] flex justify-end gap-3">
            <button 
                onClick={onClose}
                className="px-6 py-3 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
                Cancel
            </button>
            <button 
                onClick={handleSave}
                className="px-6 py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-neutral-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5"
            >
                <Save size={16} /> Save Changes
            </button>
        </div>
      </motion.div>
    </div>
  );
};

export default WidgetConfigModal;
