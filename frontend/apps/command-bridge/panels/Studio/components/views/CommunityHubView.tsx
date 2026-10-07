import * as React from 'react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, Users, Hash, ArrowLeft, Heart, MessageSquare, Share2, MoreHorizontal, X, Check, Image as ImageIcon, LayoutGrid, Settings } from 'lucide-react';
import { UserProfile, Community, CommunityPost } from '../../types';

interface Props {
    currentUser: UserProfile;
    onBack: () => void;
    initialCommunityId?: string;
    initialMode?: 'explore' | 'detail' | 'create';
}

const communityReach = (community: Community) => {
    const c = community as any;
    return Number(c.subscribersCount ?? c.subscriberCount ?? c.followersCount ?? c.followers ?? c.membersCount ?? 0) || 0;
};

const communityMeritScore = (community: Community, query = '') => {
    const c = community as any;
    const members = Math.max(0, Number(community.membersCount || 0));
    const subscribers = Math.max(0, communityReach(community));
    const posts = Math.max(0, Number(c.postsCount ?? c.posts ?? 0));
    const tags = Array.isArray(community.tags) ? community.tags : [];
    const completeness = [
        community.name,
        community.description,
        community.category,
        community.image,
        tags.length ? 'tags' : '',
    ].filter(Boolean).length / 5;
    const searchText = `${community.name} ${community.description} ${community.category} ${tags.join(' ')}`.toLowerCase();
    const relevance = query.trim() && searchText.includes(query.trim().toLowerCase()) ? 1 : 0.45;

    return (
        Math.log10(members + 10) * 24 +
        Math.log10(subscribers + 10) * 18 +
        Math.log10(posts + 2) * 12 +
        completeness * 20 +
        tags.length * 2.5 +
        relevance * 10
    );
};

const FALLBACK_COMMUNITY_IMAGE = 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?q=80&w=1200&auto=format&fit=crop';

const axisHeaders = (currentUser: UserProfile) => {
    const axisUser = (() => { try { return JSON.parse(localStorage.getItem('axis_user_v2') || 'null'); } catch { return null; } })();
    return {
        'Content-Type': 'application/json',
        'x-axis-user-id': axisUser?.id || 'studio-user',
        'x-axis-user-name': axisUser?.name || currentUser.name || 'Studio User',
        'x-axis-user-color': axisUser?.color || 'violet',
    };
};

const mapAxisCommunity = (raw: any): Community => ({
    id: raw.id,
    name: raw.name || 'Untitled Community',
    description: raw.description || '',
    membersCount: Number(raw.member_count || raw.membersCount || 0),
    image: raw.cover_image || raw.coverImage || FALLBACK_COMMUNITY_IMAGE,
    isJoined: Boolean(raw.my_role),
    category: raw.category || (raw.is_public === 0 ? 'Private' : 'Public'),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    icon: raw.icon || '🌐',
    rules: raw.rules || '',
    links: Array.isArray(raw.links) ? raw.links : [],
    moderationTone: raw.moderation_tone || raw.moderationTone || 'thoughtful',
    role: raw.my_role || raw.role || '',
    postsCount: Number(raw.post_count || raw.postsCount || 0),
    latestPostAt: Number(raw.latest_post_at || raw.latestPostAt || 0),
    meritScore: Number(raw.merit_score || raw.meritScore || 0),
    workspaceId: raw.workspace?.id || raw.workspace_id || raw.workspaceId,
} as Community);

const timeAgo = (ts?: number) => {
    if (!ts) return 'now';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

const mapAxisPost = (raw: any): CommunityPost => {
    const images = Array.isArray(raw.images) ? raw.images : [];
    return {
        id: raw.id,
        author: { name: raw.author_name || 'Member', avatar: raw.author_avatar || '' },
        content: raw.content || '',
        image: images[0],
        likes: Number(raw.likes_count || 0),
        comments: Number(raw.comments_count || 0),
        timestamp: timeAgo(raw.created_at),
        ...(raw as any),
    } as any;
};

const CommunityHubView: React.FC<Props> = ({ currentUser, onBack, initialCommunityId, initialMode = 'explore' }) => {
    const [viewMode, setViewMode] = useState<'explore' | 'detail' | 'create'>(initialCommunityId ? 'detail' : initialMode);
    const [activeCommunity, setActiveCommunity] = useState<Community | null>(null);
    const [communities, setCommunities] = useState<Community[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [posts, setPosts] = useState<CommunityPost[]>([]);
    const [postDraft, setPostDraft] = useState('');
    const [postImage, setPostImage] = useState('');
    const [posting, setPosting] = useState(false);
    const [showJoinToast, setShowJoinToast] = useState(false);

    const [newCommunityName, setNewCommunityName] = useState('');
    const [newCommunityDesc, setNewCommunityDesc] = useState('');
    const [newCommunityIcon, setNewCommunityIcon] = useState('🌐');
    const [newCommunityCover, setNewCommunityCover] = useState('');
    const [newCommunityCategory, setNewCommunityCategory] = useState('General');
    const [newCommunityTags, setNewCommunityTags] = useState('');
    const [newCommunityRules, setNewCommunityRules] = useState('Be useful. Stay on topic. No spam, harassment, or low-effort bait.');
    const [newCommunityTone, setNewCommunityTone] = useState('thoughtful');
    const [newCommunityIsPublic, setNewCommunityIsPublic] = useState(true);
    const [creating, setCreating] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const refreshCommunities = React.useCallback(async () => {
        const data = await fetch('/api/axis/communities', { headers: axisHeaders(currentUser) }).then(r => r.json());
        if (data.ok) {
            const mapped = (data.communities || []).map(mapAxisCommunity);
            setCommunities(mapped);
            if (initialCommunityId) {
                const found = mapped.find((c: Community) => c.id === initialCommunityId);
                if (found) setActiveCommunity(found);
            }
        }
    }, [currentUser, initialCommunityId]);

    useEffect(() => {
        refreshCommunities()
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [refreshCommunities]);

    useEffect(() => {
        if (viewMode === 'detail' && activeCommunity?.id) loadPosts(activeCommunity.id).catch(() => {});
    }, [viewMode, activeCommunity?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleOpenCommunity = (community: Community) => {
        setActiveCommunity(community);
        loadPosts(community.id);
        setViewMode('detail');
    };

    const loadPosts = async (communityId: string) => {
        const data = await fetch(`/api/axis/communities/${communityId}/posts`, { headers: axisHeaders(currentUser) }).then(r => r.json()).catch(() => null);
        if (data?.ok) setPosts((data.posts || []).map(mapAxisPost));
    };

    const handleNavigateToAxis = (community: Community) => {
        localStorage.setItem('axis:pending-navigate', community.name);
        window.dispatchEvent(new CustomEvent('soma:nav', { detail: { module: 'axis' } }));
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('axis:navigate-workspace', { detail: { name: community.name } }));
        }, 150);
    };

    const handleCreateCommunity = async () => {
        if (!newCommunityName || creating) return;
        setCreating(true);
        try {
            const headers = axisHeaders(currentUser);
            const res = await fetch('/api/axis/communities', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name: newCommunityName,
                    description: newCommunityDesc,
                    icon: newCommunityIcon,
                    coverImage: newCommunityCover,
                    isPublic: newCommunityIsPublic,
                    category: newCommunityCategory,
                    tags: newCommunityTags.split(',').map(t => t.trim()).filter(Boolean),
                    rules: newCommunityRules,
                    moderationTone: newCommunityTone,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                const community = mapAxisCommunity({ ...data.community, my_role: 'admin' });
                await fetch('/api/axis/workspaces', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        name: community.name,
                        icon: community.icon || '🌐',
                        color: 'violet',
                        type: 'community',
                        description: community.description || '',
                        community_id: community.id,
                        roomTemplate: 'community',
                    }),
                }).catch(() => {});
                await refreshCommunities();
                setActiveCommunity(community);
                setViewMode('detail');
                setNewCommunityName('');
                setNewCommunityDesc('');
                setNewCommunityIcon('🌐');
                setNewCommunityCover('');
                setNewCommunityCategory('General');
                setNewCommunityTags('');
                setNewCommunityRules('Be useful. Stay on topic. No spam, harassment, or low-effort bait.');
                setNewCommunityTone('thoughtful');
                setNewCommunityIsPublic(true);
            }
        } catch {} finally {
            setCreating(false);
        }
    };

    const createCommunityPost = async () => {
        if (!activeCommunity || !postDraft.trim() || posting) return;
        setPosting(true);
        try {
            const data = await fetch(`/api/axis/communities/${activeCommunity.id}/posts`, {
                method: 'POST',
                headers: axisHeaders(currentUser),
                body: JSON.stringify({ content: postDraft.trim(), images: postImage.trim() ? [postImage.trim()] : [] }),
            }).then(r => r.json());
            if (data.ok) {
                setPosts(prev => [mapAxisPost(data.post), ...prev]);
                setPostDraft('');
                setPostImage('');
            }
        } catch {} finally {
            setPosting(false);
        }
    };

    const saveSettings = async () => {
        if (!activeCommunity) return;
        const data = await fetch(`/api/axis/communities/${activeCommunity.id}`, {
            method: 'PATCH',
            headers: axisHeaders(currentUser),
            body: JSON.stringify({
                name: activeCommunity.name,
                description: activeCommunity.description,
                icon: activeCommunity.icon,
                coverImage: activeCommunity.image,
                category: activeCommunity.category,
                tags: activeCommunity.tags,
                rules: activeCommunity.rules,
                moderationTone: activeCommunity.moderationTone,
            }),
        }).then(r => r.json()).catch(() => null);
        if (data?.ok) {
            const next = mapAxisCommunity({ ...data.community, my_role: activeCommunity.role || 'admin' });
            setActiveCommunity(next);
            setCommunities(prev => prev.map(c => c.id === next.id ? next : c));
            setSettingsOpen(false);
        }
    };

    const toggleJoin = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const community = communities.find(c => c.id === id);
        if (!community) return;
        const newIsJoined = !community.isJoined;
        const newCount = community.membersCount + (newIsJoined ? 1 : -1);

        setCommunities(prev => prev.map(c => c.id === id
            ? { ...c, isJoined: newIsJoined, membersCount: newCount }
            : c
        ));
        if (activeCommunity?.id === id) {
            setActiveCommunity(prev => prev ? { ...prev, isJoined: newIsJoined, membersCount: newCount } : null);
        }
        if (newIsJoined) {
            setShowJoinToast(true);
            setTimeout(() => setShowJoinToast(false), 2000);
            const headers = axisHeaders(currentUser);
            await fetch(`/api/axis/communities/${id}/join`, { method: 'POST', headers }).catch(() => {});
            fetch('/api/axis/workspaces', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: community.name, icon: community.icon || '🌐', color: 'violet', type: 'community', description: community.description || '', community_id: community.id, roomTemplate: 'community' }),
            }).catch(() => {});
        } else {
            await fetch(`/api/axis/communities/${id}/leave`, { method: 'DELETE', headers: axisHeaders(currentUser) }).catch(() => {});
        }
    };

    const ExploreView = () => {
        const filtered = search
            ? communities.filter(c =>
                c.name.toLowerCase().includes(search.toLowerCase()) ||
                c.category.toLowerCase().includes(search.toLowerCase()) ||
                c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
              )
            : communities;
        const joined   = filtered.filter(c => c.isJoined);
        const discover = filtered
            .filter(c => !c.isJoined)
            .sort((a, b) => communityMeritScore(b, search) - communityMeritScore(a, search));
        return (
        <div className="flex flex-col min-h-screen pb-20">
            <div className="sticky top-0 z-40 bg-black/90 backdrop-blur-md pt-8 pb-4 px-6 border-b border-white/5">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white">
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className="text-xl font-bold font-display tracking-wide">Hub</h1>
                    <div className="w-10" />
                </div>

                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search communities..."
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all placeholder:text-white/30"
                    />
                </div>
                <button
                    onClick={() => setViewMode('create')}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white text-black py-3 text-sm font-black transition-all hover:scale-[1.01] hover:bg-white/90"
                >
                    <Plus size={16} /> Create Community
                </button>
            </div>

            <div className="p-6 space-y-8">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-white/30 text-sm">Loading communities…</div>
                ) : (
                    <>
                        <section>
                            <h2 className="text-sm font-bold text-white/50 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Check size={14} className="text-emerald-400" /> Your Nodes
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {joined.map(c => (
                                    <div
                                        key={c.id}
                                        onClick={() => handleNavigateToAxis(c)}
                                        className="group flex items-center gap-4 p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
                                    >
                                        {c.icon ? (
                                            <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl flex-shrink-0">{c.icon}</div>
                                        ) : (
                                            <img src={c.image} className="w-16 h-16 rounded-xl object-cover bg-black flex-shrink-0" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-white group-hover:text-emerald-300 transition-colors">{c.name}</h3>
                                            <span className="text-xs text-white/40">{c.membersCount} members · {c.postsCount || 0} posts</span>
                                        </div>
                                        <span className="text-xs text-white/20 group-hover:text-emerald-400 transition-colors shrink-0">Open in Axis →</span>
                                    </div>
                                ))}
                                {joined.length === 0 && (
                                    <p className="text-sm text-white/30 col-span-2">{search ? 'No results.' : 'No joined communities yet. Explore below.'}</p>
                                )}
                            </div>
                        </section>

                        <section>
                            <div className="mb-4 flex items-end justify-between gap-4">
                                <h2 className="text-sm font-bold text-white/50 uppercase tracking-widest flex items-center gap-2">
                                    <LayoutGrid size={14} className="text-purple-400" /> Discover
                                </h2>
                                <span className="text-[10px] font-mono uppercase tracking-widest text-white/25">Merit ranked</span>
                            </div>
                            <div className="space-y-4">
                                {discover.map((c, index) => (
                                    <div
                                        key={c.id}
                                        onClick={() => handleOpenCommunity(c)}
                                        className="relative overflow-hidden rounded-3xl bg-[#0A0A0A] border border-white/5 group cursor-pointer"
                                    >
                                        <div className="absolute inset-0 z-0">
                                            <img src={c.image} className="w-full h-full object-cover opacity-30 group-hover:opacity-40 group-hover:scale-105 transition-all duration-700" />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                                        </div>

                                        <div className="relative z-10 p-6 flex flex-col items-start gap-4">
                                            <div className="flex justify-between w-full items-start">
                                                <div className="flex items-center gap-2">
                                                    <div className="bg-white/10 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[10px] font-mono uppercase tracking-wider text-white/80">
                                                        {c.category}
                                                    </div>
                                                    <div className="bg-purple-400/10 backdrop-blur-md px-3 py-1 rounded-full border border-purple-300/15 text-[10px] font-mono uppercase tracking-wider text-purple-200">
                                                        #{index + 1} score {Math.round(c.meritScore || communityMeritScore(c, search))}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => toggleJoin(e, c.id)}
                                                    className="px-4 py-1.5 bg-white text-black text-xs font-bold rounded-full hover:bg-white/90 transition-colors"
                                                >
                                                    Join
                                                </button>
                                            </div>

                                            <div className="mt-8">
                                                <h3 className="text-2xl font-display font-bold text-white mb-1 group-hover:text-purple-300 transition-colors">
                                                    {c.icon && <span className="mr-2">{c.icon}</span>}{c.name}
                                                </h3>
                                                <p className="text-sm text-white/60 line-clamp-2 max-w-md">{c.description}</p>
                                            </div>

                                            <div className="flex items-center gap-4 text-xs text-white/40 font-mono pt-2">
                                                <span className="flex items-center gap-1"><Users size={12} /> {c.membersCount} members</span>
                                                <span>{c.postsCount || 0} posts</span>
                                                {communityReach(c) !== c.membersCount && (
                                                    <span>{communityReach(c).toLocaleString()} subscribers</span>
                                                )}
                                                {c.tags.map(t => <span key={t}>#{t}</span>)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
        );
    };

    const DetailView = () => {
        if (!activeCommunity) return null;

        return (
            <div className="flex flex-col min-h-screen bg-black relative">
                <div className="relative h-64 w-full overflow-hidden">
                    <img src={activeCommunity.image} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />

                    <button
                        onClick={() => setViewMode('explore')}
                        className="absolute top-8 left-6 p-2 bg-black/50 backdrop-blur-md rounded-full text-white hover:bg-black/70 transition-colors z-20"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    {(activeCommunity.role === 'admin' || activeCommunity.role === 'mod') && (
                        <button
                            onClick={() => setSettingsOpen(true)}
                            className="absolute top-8 right-6 p-2 bg-black/50 backdrop-blur-md rounded-full text-white hover:bg-black/70 transition-colors z-20"
                        >
                            <Settings size={22} />
                        </button>
                    )}
                </div>

                <div className="px-6 -mt-12 relative z-10 mb-8">
                    <div className="flex justify-between items-end mb-4">
                        <h1 className="text-3xl md:text-5xl font-display font-bold text-white drop-shadow-xl">
                            {activeCommunity.icon && <span className="mr-2">{activeCommunity.icon}</span>}{activeCommunity.name}
                        </h1>
                        <button
                            onClick={(e) => toggleJoin(e, activeCommunity.id)}
                            className={`px-6 py-2.5 rounded-full font-bold text-sm transition-all shadow-lg
                                ${activeCommunity.isJoined
                                    ? 'bg-white/10 text-white border border-white/10 hover:bg-white/20'
                                    : 'bg-white text-black hover:scale-105'}
                            `}
                        >
                            {activeCommunity.isJoined ? 'Joined' : 'Join Community'}
                        </button>
                    </div>

                    <p className="text-white/70 text-sm leading-relaxed max-w-2xl mb-4">
                        {activeCommunity.description}
                    </p>

                    <div className="flex items-center gap-4 text-xs font-mono text-white/40">
                        <span className="flex items-center gap-1.5"><Users size={14} /> {activeCommunity.membersCount} Members</span>
                        <span className="w-1 h-1 bg-white/20 rounded-full"></span>
                        <span className="flex items-center gap-1.5"><Hash size={14} /> {activeCommunity.category}</span>
                        <span className="w-1 h-1 bg-white/20 rounded-full"></span>
                        <span>{activeCommunity.postsCount || posts.length} Posts</span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {(activeCommunity.tags || []).map(tag => (
                            <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-mono text-white/45">#{tag}</span>
                        ))}
                    </div>
                </div>

                <div className="flex-1 bg-[#050505] rounded-t-[40px] border-t border-white/5 p-6 min-h-[500px]">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                    <div>
                    {activeCommunity.isJoined && (
                        <div className="flex gap-4 mb-8 bg-white/5 p-4 rounded-2xl border border-white/5">
                            {currentUser.avatar ? <img src={currentUser.avatar} className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-300/20" />}
                            <div className="flex-1">
                                <textarea
                                    value={postDraft}
                                    onChange={e => setPostDraft(e.target.value)}
                                    placeholder="Start a discussion..."
                                    className="w-full bg-transparent border-none text-white focus:outline-none text-sm min-h-20 resize-none"
                                />
                                <input
                                    value={postImage}
                                    onChange={e => setPostImage(e.target.value)}
                                    placeholder="Optional image URL"
                                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 outline-none"
                                />
                                <div className="flex gap-4 mt-2 border-t border-white/5 pt-2">
                                    <button className="flex items-center gap-2 text-white/40 hover:text-white text-xs transition-colors"><ImageIcon size={14}/> Photo</button>
                                    <button className="flex items-center gap-2 text-white/40 hover:text-white text-xs transition-colors"><Hash size={14}/> Tag</button>
                                    <button onClick={createCommunityPost} disabled={!postDraft.trim() || posting} className="ml-auto rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black disabled:opacity-40">
                                        {posting ? 'Posting...' : 'Post'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-6 pb-20">
                        {posts.length === 0 && (
                            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-8 text-center text-sm text-white/35">
                                No posts yet. The first good post defines the room.
                            </div>
                        )}
                        {posts.map(post => (
                            <div key={post.id} className="bg-[#0A0A0A] border border-white/5 rounded-2xl p-4 md:p-6 hover:border-white/10 transition-colors">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        {post.author.avatar ? <img src={post.author.avatar} className="w-10 h-10 rounded-full object-cover border border-white/10" /> : <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold">{post.author.name[0]}</div>}
                                        <div>
                                            <h4 className="font-bold text-sm text-white">{post.author.name}</h4>
                                            <span className="text-xs text-white/40">{post.timestamp}</span>
                                        </div>
                                    </div>
                                    <button className="text-white/30 hover:text-white"><MoreHorizontal size={18}/></button>
                                </div>

                                <p className="text-sm text-white/90 leading-relaxed mb-4">
                                    {post.content}
                                </p>

                                {post.image && (
                                    <div className="mb-4 rounded-xl overflow-hidden border border-white/5">
                                        <img src={post.image} className="w-full h-auto object-cover max-h-[400px]" />
                                    </div>
                                )}

                                <div className="flex items-center gap-6 pt-3 border-t border-white/5">
                                    <button className="flex items-center gap-2 text-white/40 hover:text-pink-400 transition-colors text-xs group">
                                        <Heart size={16} className="group-hover:fill-pink-400" /> {post.likes}
                                    </button>
                                    <button className="flex items-center gap-2 text-white/40 hover:text-blue-400 transition-colors text-xs">
                                        <MessageSquare size={16} /> {post.comments}
                                    </button>
                                    <button className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-xs ml-auto">
                                        <Share2 size={16} /> Share
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    </div>
                    <aside className="space-y-4">
                        <div className="rounded-3xl border border-white/5 bg-white/[0.035] p-5">
                            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/45">About</h3>
                            <p className="text-sm leading-relaxed text-white/60">{activeCommunity.description || 'No description yet.'}</p>
                        </div>
                        <div className="rounded-3xl border border-white/5 bg-white/[0.035] p-5">
                            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/45">Rules</h3>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/55">{activeCommunity.rules || 'Be useful. Stay on topic. No spam.'}</p>
                        </div>
                        <button onClick={() => handleNavigateToAxis(activeCommunity)} className="w-full rounded-2xl border border-purple-300/20 bg-purple-400/10 px-4 py-3 text-sm font-bold text-purple-100 hover:bg-purple-400/15">
                            Open Live Room in Axis
                        </button>
                    </aside>
                    </div>
                </div>
                {settingsOpen && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6" onClick={e => e.currentTarget === e.target && setSettingsOpen(false)}>
                        <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#090909] p-6 shadow-2xl">
                            <div className="mb-5 flex items-center justify-between">
                                <h2 className="text-lg font-bold">Community Settings</h2>
                                <button onClick={() => setSettingsOpen(false)} className="text-white/50 hover:text-white"><X size={20} /></button>
                            </div>
                            <div className="grid gap-3">
                                <input value={activeCommunity.name} onChange={e => setActiveCommunity({ ...activeCommunity, name: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" />
                                <input value={activeCommunity.icon || ''} onChange={e => setActiveCommunity({ ...activeCommunity, icon: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" placeholder="Icon" />
                                <input value={activeCommunity.image || ''} onChange={e => setActiveCommunity({ ...activeCommunity, image: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" placeholder="Cover URL" />
                                <input value={activeCommunity.category || ''} onChange={e => setActiveCommunity({ ...activeCommunity, category: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" placeholder="Category" />
                                <input value={(activeCommunity.tags || []).join(', ')} onChange={e => setActiveCommunity({ ...activeCommunity, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" placeholder="Tags, comma separated" />
                                <textarea value={activeCommunity.description || ''} onChange={e => setActiveCommunity({ ...activeCommunity, description: e.target.value })} className="min-h-24 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" placeholder="Description" />
                                <textarea value={activeCommunity.rules || ''} onChange={e => setActiveCommunity({ ...activeCommunity, rules: e.target.value })} className="min-h-24 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none" placeholder="Rules" />
                            </div>
                            <button onClick={saveSettings} className="mt-5 w-full rounded-xl bg-white py-3 text-sm font-black text-black">Save Settings</button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const CreateView = () => (
        <div className="fixed inset-0 bg-[#050505] z-50 flex flex-col p-6">
            <div className="flex items-center justify-between mb-8">
                <button onClick={() => setViewMode('explore')} className="p-2 -ml-2 text-white/60 hover:text-white">
                    <X size={24} />
                </button>
                <h2 className="font-bold text-lg">Create Community</h2>
                <div className="w-8" />
            </div>

            <div className="flex-1 flex flex-col gap-6 max-w-lg mx-auto w-full">
                <div className="w-full aspect-video bg-white/5 rounded-2xl border-2 border-dashed border-white/10 overflow-hidden flex flex-col items-center justify-center text-white/30">
                    {newCommunityCover ? (
                        <img src={newCommunityCover} className="h-full w-full object-cover" />
                    ) : (
                        <>
                            <ImageIcon size={32} />
                            <span className="text-xs mt-2 uppercase tracking-widest">Cover Image URL optional</span>
                        </>
                    )}
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-[72px_1fr] gap-3">
                        <div>
                            <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Icon</label>
                            <input
                                value={newCommunityIcon}
                                onChange={(e) => setNewCommunityIcon(e.target.value.slice(0, 4))}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-center text-xl text-white focus:outline-none focus:bg-white/10 transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Cover URL</label>
                            <input
                                value={newCommunityCover}
                                onChange={(e) => setNewCommunityCover(e.target.value)}
                                type="text"
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors"
                                placeholder="https://..."
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Community Name</label>
                        <input
                            value={newCommunityName}
                            onChange={(e) => setNewCommunityName(e.target.value)}
                            type="text"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors"
                            placeholder="e.g. Cyberpunk Architects"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Description</label>
                        <textarea
                            value={newCommunityDesc}
                            onChange={(e) => setNewCommunityDesc(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors h-32 resize-none"
                            placeholder="What is this community about?"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Category</label>
                            <input value={newCommunityCategory} onChange={(e) => setNewCommunityCategory(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors" />
                        </div>
                        <div>
                            <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Tone</label>
                            <input value={newCommunityTone} onChange={(e) => setNewCommunityTone(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Tags</label>
                        <input value={newCommunityTags} onChange={(e) => setNewCommunityTags(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors" placeholder="AI, design, research" />
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Rules</label>
                        <textarea value={newCommunityRules} onChange={(e) => setNewCommunityRules(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:bg-white/10 transition-colors h-24 resize-none" />
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-white/50 uppercase tracking-widest mb-2">Privacy</label>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setNewCommunityIsPublic(true)}
                                className={`flex-1 py-3 rounded-xl font-bold text-sm ${newCommunityIsPublic ? 'bg-white text-black' : 'bg-white/5 text-white/50 border border-white/10'}`}
                            >
                                Public
                            </button>
                            <button
                                onClick={() => setNewCommunityIsPublic(false)}
                                className={`flex-1 py-3 rounded-xl font-bold text-sm ${!newCommunityIsPublic ? 'bg-white text-black' : 'bg-white/5 text-white/50 border border-white/10'}`}
                            >
                                Private
                            </button>
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleCreateCommunity}
                    disabled={!newCommunityName || creating}
                    className="mt-auto w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl font-bold text-white shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {creating ? 'Creating…' : 'Create Community'}
                </button>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-black text-white">
            <AnimatePresence>
                {showJoinToast && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-emerald-500 text-black font-bold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2"
                    >
                        <Check size={18} /> Joined Community
                    </motion.div>
                )}
            </AnimatePresence>

            {viewMode === 'explore' && <ExploreView />}
            {viewMode === 'detail' && <DetailView />}
            {viewMode === 'create' && <CreateView />}
        </div>
    );
};

export default CommunityHubView;
