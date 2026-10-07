import * as React from 'react';
import { useState, useRef } from 'react';
import { UserProfile, WidgetData } from '../../types';
import { ArrowLeft, Upload, Sparkles, Loader2, Save, Layout, Camera, Palette } from 'lucide-react';
import { motion } from 'framer-motion';
import { generateAvatar, generateCoverImage } from '../../services/geminiService';

interface Props {
    profile: UserProfile;
    widgetData: WidgetData;
    onUpdateProfile: (updates: Partial<UserProfile>) => void;
    onUpdateWidget: (id: string, updates: Partial<WidgetData>) => void;
    onBack: () => void;
}

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

const CHIP_BADGES = ['Builder', 'Operator', 'Creator', 'Researcher', 'Trader', 'SOMA Node'];
const CARD_STYLES = [
    { id: 'glass', label: 'Glass' },
    { id: 'void', label: 'Void' },
    { id: 'signal', label: 'Signal' },
    { id: 'warm', label: 'Warm' },
];

const GET_FILTER_CLASS = (filter: string) => {
    switch(filter) {
        case 'NOIR': return 'grayscale contrast-125 brightness-90';
        case 'SEPIA': return 'sepia contrast-110 brightness-90';
        case 'VINTAGE': return 'sepia-[.3] contrast-125 hue-rotate-[-10deg] saturate-150';
        case 'CYBER': return 'hue-rotate-180 contrast-125 saturate-200';
        case 'MATRIX': return 'grayscale sepia-[.8] hue-rotate-[50deg] contrast-125';
        case 'DREAM': return 'blur-[1px] brightness-110 contrast-90 saturate-150';
        case 'GRAIN': return 'contrast-150 brightness-90 sepia-[.2]';
        case 'NONE':
        default: return '';
    }
};

const ProfileEditorView: React.FC<Props> = ({ profile, widgetData, onUpdateProfile, onUpdateWidget, onBack }) => {
    const [localProfile, setLocalProfile] = useState<UserProfile>(profile);
    const [localSettings, setLocalSettings] = useState(widgetData.settings || {});
    
    const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
    const [isGeneratingCover, setIsGeneratingCover] = useState(false);
    const [activeTab, setActiveTab] = useState<'identity' | 'public' | 'interface'>('identity');

    const avatarInputRef = useRef<HTMLInputElement>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        onUpdateProfile(localProfile);
        onUpdateWidget(widgetData.id, { settings: localSettings });
        onBack();
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'avatar' | 'coverImage') => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setLocalProfile(prev => ({ ...prev, [field]: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAiGen = async (type: 'avatar' | 'cover') => {
        const context = {
            role: localProfile.role,
            bio: localProfile.bio
        };

        if (type === 'avatar') {
            setIsGeneratingAvatar(true);
            const result = await generateAvatar(context);
            if (result) setLocalProfile(prev => ({ ...prev, avatar: result }));
            setIsGeneratingAvatar(false);
        } else {
            setIsGeneratingCover(true);
            const result = await generateCoverImage(context);
            if (result) setLocalProfile(prev => ({ ...prev, coverImage: result }));
            setIsGeneratingCover(false);
        }
    };

    const updateSetting = (key: string, value: any) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    const updateAxis = (updates: any) => {
        setLocalProfile(prev => ({
            ...prev,
            axis: { ...((prev as any).axis || {}), ...updates },
        } as UserProfile));
    };

    const updatePublicIdentity = (updates: any) => {
        setLocalProfile(prev => ({
            ...prev,
            publicIdentity: { ...((prev as any).publicIdentity || {}), ...updates },
        } as UserProfile));
    };

    const updateIdentityChip = (updates: any) => {
        setLocalProfile(prev => ({
            ...prev,
            studio: {
                ...((prev as any).studio || {}),
                identityChip: {
                    ...((prev as any).studio?.identityChip || {}),
                    ...updates,
                },
            },
        } as UserProfile));
    };

    const updateIdentityFieldVisibility = (field: string, value: boolean) => {
        const current = (localProfile as any).studio?.identityChip?.visibleFields || {};
        updateIdentityChip({ visibleFields: { ...current, [field]: value } });
    };

    const chipPrefs = (localProfile as any).studio?.identityChip || {};
    const visibleFields = chipPrefs.visibleFields || { handle: true, role: true, location: true, activity: true, spaces: true };

    return (
        <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-[#050505]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="p-2 -ml-2 text-white/50 hover:text-white rounded-full hover:bg-white/10 transition-colors">
                        <ArrowLeft size={24} />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold font-display tracking-tight">Edit Profile System</h1>
                        <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">User Configuration</p>
                    </div>
                </div>
                <button 
                    onClick={handleSave}
                    className="flex items-center gap-2 px-6 py-2 bg-white text-black rounded-full font-bold text-sm hover:scale-105 transition-transform shadow-lg shadow-white/10"
                >
                    <Save size={16} /> Save Changes
                </button>
            </header>

            <main className="flex-1 max-w-6xl mx-auto w-full p-6 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
                
                {/* Left Sidebar / Tabs */}
                <div className="lg:col-span-3 space-y-2">
                    <button 
                        onClick={() => setActiveTab('identity')}
                        className={`w-full text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${activeTab === 'identity' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                    >
                        <Layout size={18} /> Identity & Assets
                    </button>
                    <button 
                        onClick={() => setActiveTab('public')}
                        className={`w-full text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${activeTab === 'public' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                    >
                        <Sparkles size={18} /> Axis & Public Voice
                    </button>
                    <button 
                        onClick={() => setActiveTab('interface')}
                        className={`w-full text-left px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${activeTab === 'interface' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                    >
                        <Palette size={18} /> Interface & Style
                    </button>
                </div>

                {/* Main Content Area */}
                <div className="lg:col-span-9 bg-[#0A0A0A] border border-white/5 rounded-3xl p-8 min-h-[600px]">
                    
                    {activeTab === 'identity' && (
                        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Cover Image Section */}
                            <section className="space-y-4">
                                <div className="flex justify-between items-end">
                                    <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Cover Image</label>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => handleAiGen('cover')}
                                            disabled={isGeneratingCover}
                                            className="px-3 py-1.5 bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded-full text-xs font-bold flex items-center gap-2 hover:bg-purple-500/20 transition-colors"
                                        >
                                            {isGeneratingCover ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                            AI Generate
                                        </button>
                                        <button 
                                            onClick={() => coverInputRef.current?.click()}
                                            className="px-3 py-1.5 bg-white/5 text-white border border-white/10 rounded-full text-xs font-bold flex items-center gap-2 hover:bg-white/10 transition-colors"
                                        >
                                            <Upload size={12} /> Upload
                                        </button>
                                        <input type="file" ref={coverInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'coverImage')} />
                                    </div>
                                </div>
                                <div className="w-full h-48 rounded-2xl overflow-hidden border border-white/10 relative group">
                                    <img 
                                        src={localProfile.coverImage} 
                                        className={`w-full h-full object-cover ${GET_FILTER_CLASS(localSettings.profileFilter || 'NONE')}`} 
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                </div>
                            </section>

                            {/* Avatar Section */}
                            <section className="flex flex-col md:flex-row items-start gap-8">
                                <div className="relative group shrink-0 mx-auto md:mx-0">
                                    <div className="w-32 h-32 rounded-full border-2 border-white/10 overflow-hidden relative bg-black">
                                        {isGeneratingAvatar ? (
                                            <div className="w-full h-full flex items-center justify-center bg-white/5"><Loader2 size={32} className="animate-spin text-white/20"/></div>
                                        ) : (
                                            <img src={localProfile.avatar} className={`w-full h-full object-cover ${GET_FILTER_CLASS(localSettings.profileFilter || 'NONE')}`} />
                                        )}
                                    </div>
                                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                         <button 
                                            onClick={() => handleAiGen('avatar')}
                                            className="p-2 bg-purple-500 text-white rounded-full shadow-lg hover:scale-110 transition-transform"
                                            title="AI Generate Avatar"
                                        >
                                            <Sparkles size={14} />
                                        </button>
                                        <button 
                                            onClick={() => avatarInputRef.current?.click()}
                                            className="p-2 bg-white text-black rounded-full shadow-lg hover:scale-110 transition-transform"
                                            title="Upload Avatar"
                                        >
                                            <Upload size={14} />
                                        </button>
                                    </div>
                                    <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, 'avatar')} />
                                </div>

                                <div className="flex-1 space-y-6 w-full">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Display Name</label>
                                            <input 
                                                value={localProfile.name}
                                                onChange={(e) => setLocalProfile({...localProfile, name: e.target.value})}
                                                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Role / Title</label>
                                            <input 
                                                value={localProfile.role}
                                                onChange={(e) => setLocalProfile({...localProfile, role: e.target.value})}
                                                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Bio</label>
                                        <textarea 
                                            value={localProfile.bio}
                                            onChange={(e) => setLocalProfile({...localProfile, bio: e.target.value})}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors h-24 resize-none"
                                        />
                                    </div>
                                </div>
                            </section>

                            <section className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-white/5">
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Manifesto / Quote</label>
                                    <textarea 
                                        value={localProfile.manifesto}
                                        onChange={(e) => setLocalProfile({...localProfile, manifesto: e.target.value})}
                                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors h-24 resize-none font-medium italic text-white/80"
                                    />
                                </div>
                                <div className="space-y-4">
                                     <div className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Location</label>
                                        <input 
                                            value={localProfile.location}
                                            onChange={(e) => setLocalProfile({...localProfile, location: e.target.value})}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                        />
                                     </div>
                                     <div className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Timezone</label>
                                        <input 
                                            value={localProfile.timezone}
                                            onChange={(e) => setLocalProfile({...localProfile, timezone: e.target.value})}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                        />
                                     </div>
                                </div>
                            </section>

                            <section className="space-y-6 pt-6 border-t border-white/5">
                                <div>
                                    <h3 className="text-sm font-bold text-white">Identity Chip</h3>
                                    <p className="mt-1 text-xs text-white/40">This reuses your Studio profile and controls how your portable chip appears across Studio, Axis, Directs, and social spaces.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Accent Color</label>
                                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                                            <input
                                                type="color"
                                                value={chipPrefs.accentColor || (localProfile as any).axis?.color || '#8b5cf6'}
                                                onChange={(e) => updateIdentityChip({ accentColor: e.target.value })}
                                                className="h-8 w-10 rounded bg-transparent"
                                            />
                                            <span className="text-xs font-mono text-white/50">{chipPrefs.accentColor || '#8b5cf6'}</span>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Badge</label>
                                        <select
                                            value={chipPrefs.badge || 'Builder'}
                                            onChange={(e) => updateIdentityChip({ badge: e.target.value })}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                        >
                                            {CHIP_BADGES.map(badge => <option key={badge} value={badge}>{badge}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Mini Card Style</label>
                                        <select
                                            value={chipPrefs.cardStyle || 'glass'}
                                            onChange={(e) => updateIdentityChip({ cardStyle: e.target.value })}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                        >
                                            {CARD_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    {[
                                        ['handle', 'Handle'],
                                        ['role', 'Role'],
                                        ['location', 'Location'],
                                        ['activity', 'Activity'],
                                        ['spaces', 'Spaces'],
                                    ].map(([key, label]) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => updateIdentityFieldVisibility(key, visibleFields[key] === false)}
                                            className={`rounded-xl border px-3 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${
                                                visibleFields[key] !== false
                                                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                                    : 'border-white/8 bg-white/[0.03] text-white/35'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'public' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Axis Handle</label>
                                    <input
                                        value={(localProfile as any).axis?.handle || ''}
                                        onChange={(e) => updateAxis({ handle: e.target.value })}
                                        placeholder="owner"
                                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Presence</label>
                                    <select
                                        value={(localProfile as any).axis?.status || 'online'}
                                        onChange={(e) => updateAxis({ status: e.target.value })}
                                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                    >
                                        <option value="online">Online</option>
                                        <option value="building">Building</option>
                                        <option value="focused">Focused</option>
                                        <option value="autonomous">Autonomous</option>
                                        <option value="away">Away</option>
                                    </select>
                                </div>
                            </section>

                            <section className="space-y-2">
                                <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Presence Text</label>
                                <input
                                    value={(localProfile as any).axis?.presenceText || ''}
                                    onChange={(e) => updateAxis({ presenceText: e.target.value })}
                                    placeholder="Focused on building SOMA."
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                />
                            </section>

                            <section className="space-y-2">
                                <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Public Tagline</label>
                                <input
                                    value={(localProfile as any).publicIdentity?.tagline || ''}
                                    onChange={(e) => updatePublicIdentity({ tagline: e.target.value })}
                                    placeholder="Building SOMA in public."
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors"
                                />
                            </section>

                            <section className="space-y-2">
                                <label className="text-xs font-mono text-white/40 uppercase tracking-widest">Public Topics</label>
                                <textarea
                                    value={Array.isArray((localProfile as any).publicIdentity?.topics) ? (localProfile as any).publicIdentity.topics.join(', ') : ''}
                                    onChange={(e) => updatePublicIdentity({ topics: e.target.value.split(',').map(item => item.trim()).filter(Boolean) })}
                                    placeholder="AI systems, trading simulation, creative tools"
                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-white/30 outline-none transition-colors h-24 resize-none"
                                />
                            </section>
                        </div>
                    )}

                     {activeTab === 'interface' && (
                        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                             {/* Filters */}
                             <div className="space-y-4">
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Camera size={16} className="text-blue-400" /> Visual Filter
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                                    {IMG_FILTERS.map(filter => (
                                        <button
                                            key={filter.id}
                                            onClick={() => updateSetting('profileFilter', filter.id)}
                                            className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                                                localSettings.profileFilter === filter.id 
                                                ? 'bg-white/10 border-white text-white' 
                                                : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'
                                            }`}
                                        >
                                            <div className={`w-full h-10 rounded-md overflow-hidden border border-white/10`}>
                                                <img 
                                                    src={localProfile.coverImage || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop"} 
                                                    className={`w-full h-full object-cover ${GET_FILTER_CLASS(filter.id)}`}
                                                />
                                            </div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider">{filter.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                        </div>
                    )}

                </div>
            </main>
        </div>
    );
};

export default ProfileEditorView;
