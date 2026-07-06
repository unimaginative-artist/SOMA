import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, UserPlus, X, MapPin, Zap, ArrowLeft, ArrowUpRight, Star, MessageCircle } from 'lucide-react';
import { IdentityProfile, UserProfile } from '../../types';
import IdentityChip from '../identity/IdentityChip';
import { stableAvatar } from '../../services/avatarService';

interface Props {
    currentUser: UserProfile;
    onBack?: () => void;
    onOpenChat?: (chat: any) => void;
}

type TabType = 'friends' | 'followers' | 'following';
type FriendListFilter = 'all' | 'online' | 'favorites' | 'creative' | 'work' | 'soma';

interface SocialUser {
    id: string;
    username: string;
    handle: string;
    avatar: string;
    isVerified?: boolean;
    status?: string;
    location?: string;
    interests?: string[];
    favorite?: boolean;
    chatId?: string;
    group?: string;
}

const CommunityView: React.FC<Props> = ({ currentUser, onBack }) => {
    const [activeTab, setActiveTab] = useState<TabType>('friends');
    const [friendListFilter, setFriendListFilter] = useState<FriendListFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [axisFriends, setAxisFriends] = useState<SocialUser[]>([]);
    const [axisChats, setAxisChats] = useState<any[]>([]);
    const [busyFriendId, setBusyFriendId] = useState<string | null>(null);
    // Real follow graph (shared with mobile + web Stage) — replaces the old mock counts.
    const [social, setSocial] = useState<{ followers: SocialUser[]; following: SocialUser[]; friends: SocialUser[] } | null>(null);

    // Mock Data
    const DATA: Record<TabType, SocialUser[]> = {
        friends: [
            { id: '1', username: 'unimaginative_artist', handle: 'unimaginative_artist', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100' },
            { id: '2', username: 'esperanzagallery', handle: 'esperanza_art', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100' },
        ],
        followers: [
            { id: '3', username: 'shaad__ansari___100k', handle: 'shad_Ansari_009', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100' },
            { id: '4', username: 'swooshidden', handle: 'jay +', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100' },
            { id: '5', username: 'animalpower3008', handle: 'Myna Meis Noname', avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100' },
            { id: '6', username: 'pleinairbigbear', handle: 'Big Bear Plein Air', avatar: 'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?w=100' },
            { id: '7', username: 'joshmcf888', handle: 'Joshua P. McFall', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100' },
            { id: '8', username: 'montelyons', handle: 'Monte Lyons', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100' },
        ],
        following: [
            { id: '9', username: 'goldmom_art', handle: 'goldmom_art', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100' },
        ]
    };

    // Algorithm Recommendations
    // Filters based on shared location (from UserProfile) or random 'interests' match
    const SUGGESTIONS: SocialUser[] = [
        { id: 's1', username: 'neon_tokyo_design', handle: 'design_lab', avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=100', location: 'Tokyo, JP', interests: ['Design', 'WebGL'] },
        { id: 's2', username: 'cyber_kafka', handle: 'franz_digital', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100', location: 'Berlin, DE', interests: ['Philosophy', 'AI'] },
        { id: 's3', username: 'local_glitch', handle: 'glitch_artist', avatar: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=100', location: 'Tokyo, JP', interests: ['Glitch', 'Art'] },
    ];

    useEffect(() => {
        let cancelled = false;
        fetch('/api/studio/axis')
            .then(response => response.ok ? response.json() : Promise.reject(new Error('Axis unavailable')))
            .then(data => {
                if (cancelled) return;
                if (Array.isArray(data?.axis?.friends)) {
                    setAxisFriends(data.axis.friends.map((friend: any) => ({
                        id: friend.id,
                        username: friend.username || friend.name || friend.handle,
                        handle: friend.handle || friend.username || friend.id,
                        avatar: stableAvatar({ id: friend.id, name: friend.username || friend.name || friend.handle, avatar: friend.avatar, image: friend.image }),
                        status: friend.online ? 'online' : 'offline',
                        favorite: Boolean(friend.favorite),
                        chatId: friend.chatId || friend.id,
                        group: friend.group || 'creative',
                    })));
                }
                if (Array.isArray(data?.axis?.chats)) setAxisChats(data.axis.chats);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Pull the real follow graph + people registry → resolve to display users.
    useEffect(() => {
        let cancelled = false;
        const myId = (currentUser as any)?.axis?.userId
            || (() => { try { return JSON.parse(localStorage.getItem('axis_user_v2') || '{}').id; } catch { return ''; } })();
        if (!myId) return;
        Promise.all([
            fetch(`/api/studio/follows/${encodeURIComponent(myId)}?viewer=${encodeURIComponent(myId)}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/api/studio/users').then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([g, u]: any[]) => {
            if (cancelled || !g) return;
            const reg: Record<string, any> = {};
            for (const usr of (u?.users || [])) reg[usr.id] = usr;
            const resolve = (id: string): SocialUser => {
                const p = reg[id] || {};
                return { id, username: p.name || p.handle || id, handle: p.handle || id, avatar: stableAvatar({ id, name: p.name, avatar: p.avatar }), isVerified: !!p.verified };
            };
            setSocial({
                followers: (g.followers || []).map(resolve),
                following: (g.following || []).map(resolve),
                friends: (g.friends || []).map(resolve),
            });
        });
        return () => { cancelled = true; };
    }, [currentUser]);

    const mergedData = useMemo<Record<TabType, SocialUser[]>>(() => ({
        friends: social ? social.friends : (axisFriends.length ? axisFriends : DATA.friends),
        followers: social ? social.followers : DATA.followers,
        following: social ? social.following : DATA.following,
    }), [axisFriends, social]);

    const matchedSuggestions = SUGGESTIONS.sort((a, b) => {
        if (a.location === currentUser.location) return -1;
        if (b.location === currentUser.location) return 1;
        return 0;
    });

    const openChat = async (user: SocialUser) => {
        setBusyFriendId(user.id);
        let chat = axisChats.find(item => item.id === user.chatId || item.id === user.id || item.title === user.username) || null;
        try {
            const axisUser = (() => { try { return JSON.parse(localStorage.getItem('axis_user_v2') || 'null'); } catch { return null; } })();
            const response = await fetch('/api/axis/directs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-axis-user-id': axisUser?.id || 'studio-user',
                    'x-axis-user-name': axisUser?.name || currentUser.name || 'Studio User',
                    'x-axis-user-color': axisUser?.color || 'violet',
                },
                body: JSON.stringify({
                    targetUserId: user.id,
                    targetUserName: user.username,
                    image: user.avatar,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.direct) chat = { ...data.direct, image: user.avatar, axisSource: 'axis' };
        } catch {}
        if (!chat) {
            chat = {
                id: user.chatId || user.id,
                title: user.username,
                image: user.avatar,
                members: '',
                messagesCount: 'Direct contact',
                status: 'active',
                axisSource: 'studio',
            };
        }
        setBusyFriendId(null);
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'chats', context: { chat } } }));
    };

    const addFriend = async (user: SocialUser) => {
        try {
            const response = await fetch('/api/studio/axis/friends', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id, username: user.username, handle: user.handle, avatar: user.avatar }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok === false) throw new Error(data.error || 'friend add failed');
            if (Array.isArray(data.axis?.friends)) {
                setAxisFriends(data.axis.friends.map((friend: any) => ({
                    id: friend.id,
                    username: friend.username || friend.name || friend.handle,
                    handle: friend.handle || friend.username || friend.id,
                    avatar: stableAvatar({ id: friend.id, name: friend.username || friend.name || friend.handle, avatar: friend.avatar, image: friend.image }),
                    status: friend.online ? 'online' : 'offline',
                    favorite: Boolean(friend.favorite),
                    chatId: friend.chatId || friend.id,
                    group: friend.group || 'creative',
                })));
            }
            if (Array.isArray(data.axis?.chats)) setAxisChats(data.axis.chats);
            setActiveTab('friends');
        } catch {}
    };

    const updateFriend = async (user: SocialUser, updates: Partial<SocialUser>) => {
        const nextFriend = { ...user, ...updates };
        setAxisFriends(prev => prev.map(friend => friend.id === user.id ? nextFriend : friend));
        try {
            const response = await fetch(`/api/studio/axis/friends/${user.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await response.json().catch(() => ({}));
            if (Array.isArray(data.axis?.friends)) {
                setAxisFriends(data.axis.friends.map((friend: any) => ({
                    id: friend.id,
                    username: friend.username || friend.name || friend.handle,
                    handle: friend.handle || friend.username || friend.id,
                    avatar: stableAvatar({ id: friend.id, name: friend.username || friend.name || friend.handle, avatar: friend.avatar, image: friend.image }),
                    status: friend.online ? 'online' : 'offline',
                    favorite: Boolean(friend.favorite),
                    chatId: friend.chatId || friend.id,
                    group: friend.group || 'creative',
                })));
            }
        } catch {}
    };

    const removeFriend = async (user: SocialUser) => {
        setAxisFriends(prev => prev.filter(friend => friend.id !== user.id));
        try {
            const response = await fetch(`/api/studio/axis/friends/${user.id}`, { method: 'DELETE' });
            const data = await response.json().catch(() => ({}));
            if (Array.isArray(data.axis?.friends)) {
                setAxisFriends(data.axis.friends.map((friend: any) => ({
                    id: friend.id,
                    username: friend.username || friend.name || friend.handle,
                    handle: friend.handle || friend.username || friend.id,
                    avatar: stableAvatar({ id: friend.id, name: friend.username || friend.name || friend.handle, avatar: friend.avatar, image: friend.image }),
                    status: friend.online ? 'online' : 'offline',
                    favorite: Boolean(friend.favorite),
                    chatId: friend.chatId || friend.id,
                    group: friend.group || 'creative',
                })));
            }
            if (Array.isArray(data.axis?.chats)) setAxisChats(data.axis.chats);
        } catch {}
    };

    const toIdentity = (user: SocialUser): IdentityProfile => ({
        id: user.id,
        name: user.username,
        handle: user.handle,
        avatar: user.avatar,
        role: user.group ? `${user.group} contact` : 'Studio contact',
        tagline: user.interests?.join(', ') || user.handle,
        status: user.status === 'online' ? 'online' : 'offline',
        group: user.group || 'creative',
        favorite: Boolean(user.favorite),
        source: 'community',
        recentActivity: user.status === 'online' ? 'Available in Studio' : 'Known Studio contact',
        mutualSpaces: ['Studio', 'Axis', user.group || 'Creative'],
    });

    const openStudioSpace = (identity: IdentityProfile) => {
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'studio-space', context: { identity } } }));
    };

    const visibleUsers = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return mergedData[activeTab].filter(user => {
            const matchesSearch = !q || `${user.username} ${user.handle} ${(user.interests || []).join(' ')}`.toLowerCase().includes(q);
            if (!matchesSearch) return false;
            if (activeTab !== 'friends') return true;
            if (friendListFilter === 'online') return user.status === 'online';
            if (friendListFilter === 'favorites') return Boolean(user.favorite);
            if (['creative', 'work', 'soma'].includes(friendListFilter)) return (user.group || 'creative') === friendListFilter;
            return true;
        });
    }, [activeTab, friendListFilter, mergedData, searchQuery]);

    const categories = [
        { id: 'c1', title: "People you don't follow back", subtitle: "esperanzagalleryrb and 112 others", avatar: DATA.friends[1].avatar },
        { id: 'c2', title: "Deactivated accounts", subtitle: "goldmom_art", avatar: null },
    ];

    return (
        <div className="min-h-screen bg-black text-white flex flex-col font-sans pb-24">
            
            {/* Header */}
            <div className="sticky top-0 bg-black/90 backdrop-blur-md z-50 pt-12 pb-2 px-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-4">
                     {onBack && (
                        <button onClick={onBack} className="p-2 -ml-2 text-white/70 hover:text-white">
                            <ArrowLeft />
                        </button>
                    )}
                    <h1 className="text-lg font-bold mx-auto">{currentUser.name.toLowerCase().replace(' ', '_')}</h1>
                    <button className="p-2 text-white/70 hover:text-white">
                        <UserPlus size={22} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center justify-center gap-8 text-sm font-medium border-b border-white/10">
                    {(['friends', 'followers', 'following'] as TabType[]).map((tab) => {
                        const count =
                            tab === 'friends' ? mergedData.friends.length :
                            tab === 'followers' ? mergedData.followers.length :
                            tab === 'following' ? mergedData.following.length : 0;
                            
                        return (
                            <button 
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`pb-3 px-1 relative capitalize ${activeTab === tab ? 'text-white' : 'text-white/40'}`}
                            >
                                {count > 0 && <span className="mr-1">{count}</span>}
                                {tab}
                                {activeTab === tab && (
                                    <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Search */}
            <div className="px-4 py-3">
                <div className="relative bg-[#262626] rounded-xl overflow-hidden">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                    <input 
                        type="text" 
                        placeholder="Search" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none placeholder:text-white/40"
                    />
                </div>
            </div>

            {activeTab === 'friends' && (
                <div className="px-4 pb-4">
                    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-1 md:grid-cols-6">
                        {([
                            ['all', 'All', mergedData.friends.length],
                            ['online', 'Online', mergedData.friends.filter(user => user.status === 'online').length],
                            ['favorites', 'Favorites', mergedData.friends.filter(user => user.favorite).length],
                            ['creative', 'Creative', mergedData.friends.filter(user => (user.group || 'creative') === 'creative').length],
                            ['work', 'Work', mergedData.friends.filter(user => user.group === 'work').length],
                            ['soma', 'SOMA', mergedData.friends.filter(user => user.group === 'soma').length],
                        ] as [FriendListFilter, string, number][]).map(([id, label, count]) => (
                            <button
                                key={id}
                                onClick={() => setFriendListFilter(id)}
                                className={`rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                                    friendListFilter === id ? 'bg-white text-black' : 'text-white/45 hover:bg-white/5 hover:text-white'
                                }`}
                            >
                                {label} <span className="opacity-60">{count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Categories (Only on Followers/Following) */}
            {activeTab === 'followers' && !searchQuery && (
                <div className="px-4 mb-6">
                    <h3 className="text-sm font-bold mb-3">Categories</h3>
                    <div className="space-y-4">
                        {categories.map(cat => (
                             <div key={cat.id} className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-white/5">
                                    {cat.avatar ? (
                                        <div className="grid grid-cols-2 w-full h-full">
                                            <img src={cat.avatar} className="w-full h-full object-cover" />
                                            <div className="bg-white/5 w-full h-full"></div>
                                        </div>
                                    ) : (
                                        <div className="w-full h-full bg-[#1A1A1A]"></div>
                                    )}
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">{cat.title}</span>
                                <span className="text-xs text-white/50">{cat.subtitle}</span>
                                </div>
                             </div>
                        ))}
                    </div>
                </div>
            )}

            {/* List */}
            <div className="flex-1 px-4 space-y-4">
                <h3 className="text-sm font-bold mb-2">All {activeTab}</h3>
                {visibleUsers.map((user) => (
                    <div key={user.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <IdentityChip
                                identity={toIdentity(user)}
                                compact
                                showName={false}
                                onDirect={(identity) => openChat({ ...user, id: identity.id })}
                                onOpenStudio={openStudioSpace}
                                onFavorite={() => updateFriend(user, { favorite: !user.favorite })}
                            />
                            <div className="flex flex-col">
                                <span className="text-sm font-semibold">{user.username}</span>
                                <span className="text-xs text-white/50">{user.handle}{user.favorite ? ' · favorite' : ''}{user.group ? ` · ${user.group}` : ''}</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                            {activeTab === 'friends' && (
                                <button
                                    onClick={() => updateFriend(user, { favorite: !user.favorite })}
                                    className={`p-2 rounded-full transition-colors ${user.favorite ? 'text-yellow-300 bg-yellow-300/10' : 'text-white/35 hover:text-yellow-300 hover:bg-white/5'}`}
                                    title={user.favorite ? 'Remove from favorites' : 'Add to favorites'}
                                >
                                    <Star size={17} fill={user.favorite ? 'currentColor' : 'none'} />
                                </button>
                            )}
                            <button 
                                onClick={() => activeTab === 'friends' || activeTab === 'following' ? openChat(user) : addFriend(user)}
                                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors
                                    ${activeTab === 'friends' || activeTab === 'following' 
                                        ? 'bg-[#262626] text-white' 
                                        : 'bg-blue-600 text-white'}
                                `}
                            >
                                {busyFriendId === user.id ? 'Opening...' : activeTab === 'friends' || activeTab === 'following' ? (
                                    <span className="inline-flex items-center gap-1.5"><MessageCircle size={14} /> Direct</span>
                                ) : 'Follow back'}
                            </button>
                            <button
                                onClick={() => activeTab === 'friends' ? removeFriend(user) : undefined}
                                className="text-white/40 hover:text-white"
                                title={activeTab === 'friends' ? 'Remove friend' : 'Dismiss'}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                ))}
                {visibleUsers.length === 0 && (
                    <div className="py-8 text-center text-white/40 text-sm">
                        No {activeTab} found.
                    </div>
                )}
            </div>

            {/* Find People Algorithm Section */}
            <div className="mt-8 px-4 border-t border-white/10 pt-6">
                 <div className="flex items-center gap-2 mb-4">
                    <Zap className="text-yellow-400" size={16} />
                    <h3 className="text-sm font-bold">Find people to follow</h3>
                 </div>
                 <p className="text-xs text-white/50 mb-4">
                    Based on your location ({currentUser.location}) and interests.
                 </p>
                 
                 <div className="space-y-4 pb-8">
                     {matchedSuggestions.map(user => (
                         <div key={user.id} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                            <div className="flex items-center gap-3">
                                <img src={user.avatar} className="w-10 h-10 rounded-full object-cover" />
                                <div className="flex flex-col">
                                    <span className="text-sm font-semibold">{user.username}</span>
                                    <div className="flex items-center gap-2">
                                         {user.location === currentUser.location && (
                                            <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">
                                                <MapPin size={8} /> Nearby
                                            </span>
                                         )}
                                         <span className="text-[10px] text-white/40">{user.interests?.join(', ')}</span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => addFriend(user)} className="p-2 bg-white text-black rounded-full hover:scale-110 transition-transform">
                                <ArrowUpRight size={16} />
                            </button>
                         </div>
                     ))}
                 </div>
                 
                 <button className="w-full py-3 bg-[#262626] text-white text-sm font-semibold rounded-xl">
                     See all suggestions
                 </button>
            </div>
        </div>
    );
};

export default CommunityView;
