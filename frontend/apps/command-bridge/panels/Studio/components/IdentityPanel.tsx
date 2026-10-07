import * as React from 'react';
import { useState } from 'react';
import { UserProfile } from '../types';
import { MapPin, Globe, Edit2, Check, X, Camera, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateAvatar } from '../services/geminiService';

interface Props {
  profile: UserProfile;
  isEditMode: boolean;
  onUpdate: (updates: Partial<UserProfile>) => void;
}

const IdentityPanel: React.FC<Props> = ({ profile, isEditMode, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(profile);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);

  const handleSave = () => {
    onUpdate(editForm);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditForm(profile);
    setIsEditing(false);
  };
  
  const handleGenerateAvatar = async () => {
      setIsGeneratingAvatar(true);
      const result = await generateAvatar({
          name: editForm.name,
          role: editForm.role,
          bio: editForm.bio
      });
      
      if (result) {
          setEditForm(prev => ({ ...prev, avatar: result }));
      }
      setIsGeneratingAvatar(false);
  };

  return (
    <aside className="w-full md:w-[320px] flex flex-col gap-6 p-6 md:h-[calc(100vh-80px)] md:sticky md:top-20 z-20">
      <div className="relative w-full rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-xl p-8 flex flex-col items-center text-center shadow-sm">
        
        {/* Avatar Section */}
        <div className={`relative ${isEditing ? 'mb-12' : 'mb-6'} group`}>
          <div className="w-28 h-28 rounded-full border border-white/10 p-1 relative overflow-hidden mx-auto bg-black/20">
             {isGeneratingAvatar ? (
                 <div className="w-full h-full rounded-full flex flex-col items-center justify-center bg-black/50 animate-pulse">
                     <Loader2 className="animate-spin text-white/50" />
                 </div>
             ) : (
                <img 
                src={editForm.avatar} 
                alt={profile.name} 
                className="w-full h-full object-cover rounded-full transition-all duration-500" 
                />
             )}
             
             {isEditing && !isGeneratingAvatar && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                    <Camera size={20} className="text-white" />
                </div>
             )}
          </div>

          {isEditing && (
             <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-48 z-20">
                 <button 
                    onClick={handleGenerateAvatar}
                    disabled={isGeneratingAvatar}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white text-black rounded-full text-[10px] font-medium transition-all w-full justify-center shadow-lg"
                 >
                    {isGeneratingAvatar ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {isGeneratingAvatar ? 'Generating...' : 'AI Generate'}
                 </button>
            </div>
          )}
        </div>

        {/* Content Section */}
        <div className="relative z-10 w-full flex flex-col items-center gap-1">
            
            {isEditing ? (
                <div className="w-full flex flex-col gap-2 mb-4">
                    <input 
                        type="text" 
                        value={editForm.name}
                        onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center font-display font-semibold text-lg focus:outline-none focus:bg-white/10"
                        placeholder="Name"
                    />
                     <input 
                        type="text" 
                        value={editForm.role}
                        onChange={(e) => setEditForm({...editForm, role: e.target.value})}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center font-light text-xs focus:outline-none focus:bg-white/10"
                        placeholder="Role"
                    />
                </div>
            ) : (
                <>
                    <h1 className="text-2xl font-display font-semibold tracking-tight text-white mb-1">{profile.name}</h1>
                    <div className="text-sm font-medium text-white/40 mb-4">
                        {profile.role}
                    </div>
                </>
            )}

            {/* Bio & Manifesto */}
             {isEditing ? (
                <div className="w-full flex flex-col gap-2">
                    <textarea 
                        value={editForm.bio}
                        onChange={(e) => setEditForm({...editForm, bio: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center text-sm leading-relaxed h-20 focus:outline-none focus:bg-white/10 resize-none"
                        placeholder="Short bio..."
                    />
                    <textarea 
                        value={editForm.manifesto}
                        onChange={(e) => setEditForm({...editForm, manifesto: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-center text-sm leading-relaxed h-20 focus:outline-none focus:bg-white/10 resize-none font-medium text-white/80"
                        placeholder="Manifesto / Principles..."
                    />
                </div>
            ) : (
                <div className="flex flex-col gap-3 max-w-[260px]">
                    <p className="text-white/60 leading-relaxed text-sm font-light">
                        {profile.bio}
                    </p>
                    {profile.manifesto && (
                        <div className="pt-2 border-t border-white/5">
                            <p className="text-white/90 font-medium text-sm italic">
                                "{profile.manifesto}"
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Meta Info */}
            <div className="flex flex-wrap justify-center gap-4 mt-8 w-full">
                 {isEditing ? (
                     <div className="flex gap-2 w-full">
                        <input 
                            type="text" 
                            value={editForm.location}
                            onChange={(e) => setEditForm({...editForm, location: e.target.value})}
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-center focus:outline-none"
                            placeholder="Location"
                        />
                         <input 
                            type="text" 
                            value={editForm.timezone}
                            onChange={(e) => setEditForm({...editForm, timezone: e.target.value})}
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-center focus:outline-none"
                            placeholder="Timezone"
                        />
                     </div>
                 ) : (
                     <>
                        <div className="flex items-center gap-1.5 text-xs text-white/30 font-medium">
                            <MapPin size={10} /> {profile.location}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-white/30 font-medium">
                            <Globe size={10} /> {profile.timezone}
                        </div>
                     </>
                 )}
            </div>

            {/* Edit Actions */}
            <div className="mt-6 flex gap-2">
                {!isEditing && (
                    <button 
                        onClick={() => setIsEditing(true)}
                        className="p-2 rounded-full text-white/20 hover:text-white hover:bg-white/5 transition-all"
                        title="Edit Profile"
                    >
                        <Edit2 size={14} />
                    </button>
                )}
                
                <AnimatePresence>
                    {isEditing && (
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="flex gap-2"
                        >
                             <button 
                                onClick={handleCancel}
                                disabled={isGeneratingAvatar}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 text-white/60 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors"
                            >
                                <X size={12} /> Cancel
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={isGeneratingAvatar}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black hover:bg-white/90 text-xs font-medium transition-colors"
                            >
                                <Check size={12} /> Save
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
      </div>
    </aside>
  );
};

export default IdentityPanel;