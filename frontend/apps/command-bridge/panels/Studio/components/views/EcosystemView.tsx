import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowLeft, Bell, Bookmark, Brain, Check, Eye, Globe,
    LayoutDashboard, Loader2, LogOut, MessageSquare, MonitorPlay, Play,
    Radio, RefreshCw, Smartphone, Users, WifiOff, Zap,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { studioActor, studioMutationBody, studioRequest } from '../../services/studioApi';

interface Props {
    currentUser: UserProfile;
    onBack: () => void;
}

interface StudioSignal {
    id: string;
    title: string;
    description?: string;
    category?: string;
    duration?: string;
    authorId?: string;
    authorName?: string;
    authorAvatar?: string;
    media?: any[];
    views?: number;
    likes?: number;
    bookmarks?: number;
    viewerLiked?: boolean;
    viewerBookmarked?: boolean;
    createdAt?: number;
}

interface StudioPost {
    id: string;
    type?: string;
    text?: string;
    authorId?: string;
    authorName?: string;
    authorAvatar?: string;
    media?: any[];
    likes?: number;
    bookmarks?: number;
    comments_count?: number;
    viewerLiked?: boolean;
    viewerBookmarked?: boolean;
    createdAt?: number;
}

type TabName = 'Overview' | 'Signals' | 'Brainrot' | 'Flux' | 'Directs' | 'Communities' | 'Saved' | 'Activity';

const REFRESH_INTERVAL_MS = 12_000;

function dispatchStudioNavigation(view: string, context: Record<string, unknown> = {}) {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view, context } }));
}

function formatCount(value?: number) {
    const count = Number(value || 0);
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
    return String(count);
}

function formatAge(createdAt?: number) {
    if (!createdAt) return 'recently';
    const elapsed = Math.max(0, Date.now() - Number(createdAt));
    if (elapsed < 60_000) return 'now';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
    return `${Math.floor(elapsed / 86_400_000)}d`;
}

function mediaAsset(item?: any) {
    if (!item) return { url: '', thumbnail: '', video: false };
    const media = Array.isArray(item.media) ? item.media[0] : item.media;
    if (!media) return { url: '', thumbnail: '', video: false };
    if (typeof media === 'string') {
        return { url: media, thumbnail: media, video: /\.(mp4|webm|m3u8)(\?|$)/i.test(media) };
    }
    const url = media.hlsUrl || media.url || media.sourceUrl || '';
    return {
        url,
        thumbnail: media.thumbnailUrl || media.poster || (media.kind === 'image' ? url : ''),
        video: media.kind === 'video' || /^video\//.test(media.mimeType || '') || /\.(mp4|webm|m3u8)(\?|$)/i.test(url),
    };
}

const EmptyState = ({ icon: Icon, title, detail, action }: {
    icon: React.ComponentType<any>;
    title: string;
    detail: string;
    action?: () => void;
}) => (
    <div className="min-h-64 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-14 text-center">
        <Icon size={26} className="mx-auto mb-4 text-white/25" />
        <h3 className="text-base font-bold text-white">{title}</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-white/40">{detail}</p>
        {action && (
            <button onClick={action} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-black transition hover:scale-105">
                Open the Stage
            </button>
        )}
    </div>
);

const EcosystemView: React.FC<Props> = ({ currentUser, onBack }) => {
    const [activeTab, setActiveTab] = useState<TabName>('Overview');
    const [signals, setSignals] = useState<StudioSignal[]>([]);
    const [posts, setPosts] = useState<StudioPost[]>([]);
    const [saved, setSaved] = useState<any[]>([]);
    const [axis, setAxis] = useState<any>(null);
    const [communities, setCommunities] = useState<any[]>([]);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unread, setUnread] = useState(0);
    const [selectedSignalId, setSelectedSignalId] = useState('');
    const [loading, setLoading] = useState(true);
    const [connectedSources, setConnectedSources] = useState(0);
    const [error, setError] = useState('');
    const [pending, setPending] = useState<Set<string>>(() => new Set());

    const actor = studioActor();
    const actorId = actor?.userId || currentUser.axis?.userId || currentUser.publicIdentity?.userId || '';

    const loadEcosystem = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        const requests: Promise<any>[] = [
            studioRequest('/api/studio/signals?limit=40'),
            studioRequest('/api/studio/feed?limit=80'),
            studioRequest('/api/axis/directs'),
            studioRequest('/api/axis/communities'),
        ];
        if (actorId) {
            requests.push(studioRequest('/api/studio/saved?limit=100'));
            requests.push(studioRequest(`/api/studio/notifications/${encodeURIComponent(actorId)}`));
        }

        const results = await Promise.allSettled(requests);
        const value = (index: number) => results[index]?.status === 'fulfilled' ? (results[index] as PromiseFulfilledResult<any>).value : null;
        const signalData = value(0);
        const feedData = value(1);
        const axisData = value(2);
        const communityData = value(3);
        const savedData = actorId ? value(4) : null;
        const notificationData = actorId ? value(5) : null;

        if (signalData) setSignals(Array.isArray(signalData.signals) ? signalData.signals : []);
        if (feedData) setPosts(Array.isArray(feedData.posts) ? feedData.posts : []);
        if (axisData) setAxis({ chats: Array.isArray(axisData.directs) ? axisData.directs : [] });
        if (communityData) setCommunities(Array.isArray(communityData.communities) ? communityData.communities : []);
        if (savedData) setSaved(Array.isArray(savedData.items) ? savedData.items : []);
        if (notificationData) {
            setNotifications(Array.isArray(notificationData.notifications) ? notificationData.notifications : []);
            setUnread(Number(notificationData.unread || 0));
        }

        const fulfilled = results.filter(result => result.status === 'fulfilled').length;
        setConnectedSources(fulfilled);
        setError(fulfilled >= 2 ? '' : 'Most Studio services are currently unreachable.');
        setLoading(false);
    }, [actorId]);

    useEffect(() => {
        void loadEcosystem(true);
        const interval = window.setInterval(() => void loadEcosystem(), REFRESH_INTERVAL_MS);
        const refresh = () => void loadEcosystem();
        window.addEventListener('focus', refresh);
        window.addEventListener('studio:feed-changed', refresh);
        window.addEventListener('studio:ecosystem-changed', refresh);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('studio:feed-changed', refresh);
            window.removeEventListener('studio:ecosystem-changed', refresh);
        };
    }, [loadEcosystem]);

    useEffect(() => {
        if (!selectedSignalId && signals[0]?.id) setSelectedSignalId(signals[0].id);
        if (selectedSignalId && !signals.some(signal => signal.id === selectedSignalId)) {
            setSelectedSignalId(signals[0]?.id || '');
        }
    }, [signals, selectedSignalId]);

    const brainrot = useMemo(
        () => posts.filter(post => String(post.type || '').toLowerCase().includes('brainrot')),
        [posts],
    );
    const flux = useMemo(
        () => posts.filter(post => !String(post.type || '').toLowerCase().includes('brainrot')),
        [posts],
    );
    const selectedSignal = signals.find(signal => signal.id === selectedSignalId) || signals[0] || null;
    const chats = Array.isArray(axis?.chats) ? axis.chats : [];
    const totalSources = actorId ? 6 : 4;
    const fullyConnected = connectedSources === totalSources;

    const mutate = async (
        key: string,
        optimistic: () => void,
        rollback: () => void,
        request: () => Promise<any>,
        reconcile: (payload: any) => void,
    ) => {
        if (pending.has(key)) return;
        setPending(current => new Set(current).add(key));
        optimistic();
        try {
            const payload = await request();
            reconcile(payload);
            setError('');
            window.dispatchEvent(new Event('studio:ecosystem-changed'));
            window.dispatchEvent(new Event('studio:feed-changed'));
        } catch (cause) {
            rollback();
            setError(cause instanceof Error ? cause.message : 'Studio could not save that action.');
        } finally {
            setPending(current => {
                const next = new Set(current);
                next.delete(key);
                return next;
            });
        }
    };

    const toggleSignalLike = (signal: StudioSignal) => {
        const enabled = !signal.viewerLiked;
        const before = { liked: Boolean(signal.viewerLiked), likes: Number(signal.likes || 0) };
        void mutate(
            `signal-like:${signal.id}`,
            () => setSignals(current => current.map(item => item.id === signal.id ? { ...item, viewerLiked: enabled, likes: Math.max(0, before.likes + (enabled ? 1 : -1)) } : item)),
            () => setSignals(current => current.map(item => item.id === signal.id ? { ...item, viewerLiked: before.liked, likes: before.likes } : item)),
            () => studioRequest(`/api/studio/signals/${encodeURIComponent(signal.id)}/like`, {
                method: 'POST',
                body: studioMutationBody({ delta: enabled ? 1 : -1 }),
            }),
            payload => setSignals(current => current.map(item => item.id === signal.id ? payload.signal : item)),
        );
    };

    const toggleSignalBookmark = (signal: StudioSignal) => {
        const enabled = !signal.viewerBookmarked;
        const before = { bookmarked: Boolean(signal.viewerBookmarked), bookmarks: Number(signal.bookmarks || 0) };
        void mutate(
            `signal-save:${signal.id}`,
            () => setSignals(current => current.map(item => item.id === signal.id ? { ...item, viewerBookmarked: enabled, bookmarks: Math.max(0, before.bookmarks + (enabled ? 1 : -1)) } : item)),
            () => setSignals(current => current.map(item => item.id === signal.id ? { ...item, viewerBookmarked: before.bookmarked, bookmarks: before.bookmarks } : item)),
            () => studioRequest(`/api/studio/signals/${encodeURIComponent(signal.id)}/bookmark`, {
                method: 'POST',
                body: studioMutationBody({ enabled }),
            }),
            payload => setSignals(current => current.map(item => item.id === signal.id ? payload.signal : item)),
        );
    };

    const togglePost = (post: StudioPost, action: 'like' | 'bookmark') => {
        const stateKey = action === 'like' ? 'viewerLiked' : 'viewerBookmarked';
        const countKey = action === 'like' ? 'likes' : 'bookmarks';
        const enabled = !Boolean((post as any)[stateKey]);
        const beforeEnabled = Boolean((post as any)[stateKey]);
        const beforeCount = Number((post as any)[countKey] || 0);
        void mutate(
            `post-${action}:${post.id}`,
            () => setPosts(current => current.map(item => item.id === post.id ? { ...item, [stateKey]: enabled, [countKey]: Math.max(0, beforeCount + (enabled ? 1 : -1)) } : item)),
            () => setPosts(current => current.map(item => item.id === post.id ? { ...item, [stateKey]: beforeEnabled, [countKey]: beforeCount } : item)),
            () => studioRequest(`/api/studio/feed/${encodeURIComponent(post.id)}/${action}`, {
                method: 'POST',
                body: studioMutationBody(action === 'like' ? { delta: enabled ? 1 : -1 } : { enabled }),
            }),
            payload => setPosts(current => current.map(item => item.id === post.id ? payload.post : item)),
        );
    };

    const markNotificationsRead = async () => {
        if (!actorId || unread === 0) return;
        try {
            await studioRequest(`/api/studio/notifications/${encodeURIComponent(actorId)}/read`, {
                method: 'POST',
                body: studioMutationBody(),
            });
            setNotifications(current => current.map(item => ({ ...item, read: true })));
            setUnread(0);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Unable to mark notifications read.');
        }
    };

    const openChat = (chat: any) => dispatchStudioNavigation('chats', {
        chat: { ...chat, axisSource: chat.axisSource || 'studio' },
    });
    const openCommunity = (community: any) => dispatchStudioNavigation('community-hub', {
        communityId: community.id,
        mode: 'detail',
    });
    const openStage = () => dispatchStudioNavigation('stage');

    const tabs: Array<{ id: TabName; icon: React.ComponentType<any>; color: string; count?: number }> = [
        { id: 'Overview', icon: LayoutDashboard, color: 'text-white' },
        { id: 'Signals', icon: MonitorPlay, color: 'text-emerald-400', count: signals.length },
        { id: 'Brainrot', icon: Brain, color: 'text-pink-400', count: brainrot.length },
        { id: 'Flux', icon: Eye, color: 'text-blue-400', count: flux.length },
        { id: 'Directs', icon: MessageSquare, color: 'text-cyan-400', count: chats.length },
        { id: 'Communities', icon: Users, color: 'text-purple-400', count: communities.length },
        { id: 'Saved', icon: Bookmark, color: 'text-amber-300', count: saved.length },
    ];

    const stats = [
        { label: 'Signals', value: formatCount(signals.length), icon: MonitorPlay, color: 'text-emerald-400' },
        { label: 'Feed posts', value: formatCount(posts.length), icon: Radio, color: 'text-blue-400' },
        { label: 'Axis Directs', value: formatCount(chats.length), icon: MessageSquare, color: 'text-cyan-400' },
        { label: 'Saved', value: formatCount(saved.length), icon: Bookmark, color: 'text-amber-300' },
    ];

    const renderSignalCard = (signal: StudioSignal) => {
        const asset = mediaAsset(signal);
        return (
            <button
                key={signal.id}
                onClick={() => setSelectedSignalId(signal.id)}
                className={`overflow-hidden rounded-2xl border text-left transition ${selectedSignal?.id === signal.id ? 'border-emerald-400/60 bg-emerald-400/[0.06]' : 'border-white/5 bg-[#0A0A0A] hover:border-white/15'}`}
            >
                <div className="relative aspect-video bg-gradient-to-br from-emerald-500/20 via-cyan-500/5 to-black">
                    {asset.thumbnail && <img src={asset.thumbnail} alt="" className="h-full w-full object-cover opacity-75" />}
                    <div className="absolute inset-0 flex items-center justify-center"><Play size={22} className="text-white drop-shadow-lg" fill="currentColor" /></div>
                    <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[9px] font-mono">{signal.duration || '0:00'}</span>
                </div>
                <div className="p-4">
                    <h4 className="line-clamp-2 text-sm font-bold text-white">{signal.title}</h4>
                    <p className="mt-2 text-[11px] text-white/40">{signal.authorName || signal.authorId || 'Studio'} · {formatAge(signal.createdAt)}</p>
                    <div className="mt-3 flex gap-4 text-[10px] font-mono text-white/35">
                        <span>{formatCount(signal.views)} views</span>
                        <span>{formatCount(signal.likes)} bolts</span>
                    </div>
                </div>
            </button>
        );
    };

    const renderPostCard = (post: StudioPost, kind: 'brainrot' | 'flux') => {
        const asset = mediaAsset(post);
        return (
            <article key={post.id} className={`overflow-hidden rounded-2xl border border-white/5 bg-[#0A0A0A] ${kind === 'brainrot' ? 'min-h-72' : ''}`}>
                {asset.thumbnail && (
                    <div className={kind === 'brainrot' ? 'aspect-[9/13]' : 'aspect-video'}>
                        <img src={asset.thumbnail} alt="" className="h-full w-full object-cover" />
                    </div>
                )}
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        {post.authorAvatar ? <img src={post.authorAvatar} alt="" className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-xs font-bold">{(post.authorName || 'S')[0]}</div>}
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold">{post.authorName || post.authorId || 'Studio'}</p>
                            <p className="text-[10px] text-white/30">{formatAge(post.createdAt)}</p>
                        </div>
                    </div>
                    <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-white/65">{post.text || 'Media post'}</p>
                    <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
                        <button
                            aria-label={post.viewerLiked ? 'Remove bolt' : 'Add bolt'}
                            onClick={() => togglePost(post, 'like')}
                            disabled={pending.has(`post-like:${post.id}`)}
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-mono transition hover:bg-white/5 ${post.viewerLiked ? 'text-amber-300' : 'text-white/35'}`}
                        >
                            <Zap size={14} className={post.viewerLiked ? 'fill-amber-300' : ''} /> {formatCount(post.likes)}
                        </button>
                        <button
                            aria-label={post.viewerBookmarked ? 'Remove saved item' : 'Save item'}
                            onClick={() => togglePost(post, 'bookmark')}
                            disabled={pending.has(`post-bookmark:${post.id}`)}
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-mono transition hover:bg-white/5 ${post.viewerBookmarked ? 'text-purple-300' : 'text-white/35'}`}
                        >
                            <Bookmark size={14} className={post.viewerBookmarked ? 'fill-purple-300' : ''} /> {formatCount(post.bookmarks)}
                        </button>
                        <span className="ml-auto text-[10px] text-white/30">{formatCount(post.comments_count)} comments</span>
                    </div>
                </div>
            </article>
        );
    };

    return (
        <div className="flex h-full w-full overflow-hidden bg-[#030303] font-sans text-white selection:bg-purple-500/30">
            <aside className="group fixed left-0 top-0 z-50 hidden h-full w-20 flex-col border-r border-white/5 bg-[#080808] transition-all duration-300 hover:w-64 lg:flex">
                <div className="flex items-center gap-4 overflow-hidden p-6">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 shadow-lg shadow-cyan-500/20">
                        <Globe size={16} />
                    </div>
                    <h1 className="whitespace-nowrap text-lg font-bold opacity-0 transition group-hover:opacity-100">THE STAGE</h1>
                </div>
                <nav className="mt-4 flex-1 space-y-2 overflow-y-auto px-3">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative flex w-full items-center gap-4 overflow-hidden rounded-xl px-3 py-3 transition ${activeTab === tab.id ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
                        >
                            <tab.icon size={20} className={`shrink-0 ${activeTab === tab.id ? tab.color : ''}`} />
                            <span className="whitespace-nowrap text-sm font-medium opacity-0 transition group-hover:opacity-100">{tab.id}</span>
                            {tab.count !== undefined && <span className="ml-auto whitespace-nowrap text-[10px] font-mono text-white/30 opacity-0 group-hover:opacity-100">{tab.count}</span>}
                            {activeTab === tab.id && <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-white" />}
                        </button>
                    ))}
                </nav>
                <div className="border-t border-white/5 p-4">
                    <button onClick={onBack} className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-white/40 transition hover:bg-red-500/10 hover:text-red-400">
                        <LogOut size={20} className="shrink-0" />
                        <span className="whitespace-nowrap text-sm font-medium opacity-0 transition group-hover:opacity-100">Exit Cockpit</span>
                    </button>
                </div>
            </aside>

            <main className="relative flex h-full flex-1 flex-col overflow-y-auto bg-[#030303] scrollbar-thin scrollbar-thumb-white/10 lg:ml-20">
                <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/5 bg-[#030303]/85 px-5 py-4 backdrop-blur-xl lg:px-8">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 text-white/50 hover:text-white lg:hidden"><ArrowLeft size={22} /></button>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">{activeTab}</h2>
                            <p className="text-xs font-mono text-white/35">One ledger across Command Bridge, mobile Studio, and Stage</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => void loadEcosystem(true)} className="rounded-full p-2 text-white/35 transition hover:bg-white/5 hover:text-white" aria-label="Refresh ecosystem">
                            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <div className={`hidden items-center gap-2 rounded-full border px-3 py-2 md:flex ${fullyConnected ? 'border-emerald-400/20 bg-emerald-400/5' : 'border-amber-400/20 bg-amber-400/5'}`}>
                            <Smartphone size={13} className={fullyConnected ? 'text-emerald-400' : 'text-amber-300'} />
                            <span className="text-[10px] font-mono text-white/60">{connectedSources}/{totalSources} SOURCES</span>
                        </div>
                        <button
                            onClick={() => { setActiveTab('Activity'); void markNotificationsRead(); }}
                            className="relative rounded-full p-2 text-white/50 transition hover:bg-white/5 hover:text-white"
                            aria-label="Open Axis activity"
                        >
                            <Bell size={19} />
                            {unread > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-500 px-1 text-[8px] font-bold">{Math.min(unread, 99)}</span>}
                        </button>
                        <img src={currentUser.avatar} alt="" className="h-9 w-9 rounded-full border border-white/10 object-cover" />
                    </div>
                </header>

                <nav className="sticky top-[73px] z-30 flex gap-2 overflow-x-auto border-b border-white/5 bg-[#030303]/92 px-5 py-3 backdrop-blur-xl lg:hidden">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold ${activeTab === tab.id ? 'border-white/20 bg-white/10 text-white' : 'border-white/5 text-white/40'}`}
                        >
                            <tab.icon size={13} className={activeTab === tab.id ? tab.color : ''} />
                            {tab.id}
                            {tab.count !== undefined && <span className="font-mono text-white/25">{tab.count}</span>}
                        </button>
                    ))}
                </nav>

                <div className="mx-auto w-full max-w-[1700px] space-y-8 p-5 pb-20 lg:p-10">
                    {error && (
                        <div className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-200">
                            <WifiOff size={15} /> {error}
                        </div>
                    )}

                    {activeTab === 'Overview' && (
                        <>
                            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                                {stats.map(stat => (
                                    <button key={stat.label} onClick={() => setActiveTab(stat.label === 'Feed posts' ? 'Flux' : stat.label === 'Axis Directs' ? 'Directs' : stat.label as TabName)} className="rounded-2xl border border-white/5 bg-[#0A0A0A] p-5 text-left transition hover:border-white/15">
                                        <stat.icon size={19} className={stat.color} />
                                        <h3 className="mt-5 text-3xl font-bold">{stat.value}</h3>
                                        <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-white/35">{stat.label}</p>
                                    </button>
                                ))}
                            </div>

                            <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
                                <section className="rounded-3xl border border-white/5 bg-[#080808] p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div><h3 className="font-bold">Recent shared content</h3><p className="mt-1 text-xs text-white/35">Canonical Studio feed, newest first</p></div>
                                        <button onClick={() => setActiveTab('Flux')} className="text-xs text-purple-300 hover:text-white">View feed</button>
                                    </div>
                                    {posts.length ? (
                                        <div className="space-y-3">
                                            {posts.slice(0, 6).map(post => (
                                                <button key={post.id} onClick={() => setActiveTab(String(post.type).includes('brainrot') ? 'Brainrot' : 'Flux')} className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left transition hover:bg-white/[0.05]">
                                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10"><Eye size={15} className="text-blue-400" /></div>
                                                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{post.authorName || post.authorId || 'Studio'}</p><p className="truncate text-xs text-white/45">{post.text || 'Media post'}</p></div>
                                                    <span className="text-[10px] text-white/25">{formatAge(post.createdAt)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : <EmptyState icon={Radio} title="The real feed is empty" detail="Posts made in mobile Studio or the Stage will appear here automatically." action={openStage} />}
                                </section>

                                <section className="rounded-3xl border border-white/5 bg-[#080808] p-6">
                                    <div className="mb-5 flex items-center justify-between">
                                        <div><h3 className="font-bold">Axis activity</h3><p className="mt-1 text-xs text-white/35">{unread} unread notification{unread === 1 ? '' : 's'}</p></div>
                                        <button onClick={() => setActiveTab('Activity')} className="text-xs text-cyan-300 hover:text-white">Open inbox</button>
                                    </div>
                                    {notifications.length ? notifications.slice(0, 6).map(item => (
                                        <div key={item.id} className={`mb-3 rounded-xl border p-3 ${item.read ? 'border-white/5 bg-white/[0.02]' : 'border-purple-400/20 bg-purple-400/[0.06]'}`}>
                                            <p className="text-xs font-bold">{item.actorName || item.actorId || 'Studio'}</p>
                                            <p className="mt-1 text-xs text-white/45">{item.text}</p>
                                        </div>
                                    )) : <EmptyState icon={Bell} title="No activity yet" detail="Likes, comments, follows, and replies from Studio will appear here." />}
                                </section>
                            </div>

                            <div className="rounded-2xl border border-white/5 bg-[#080808] p-5">
                                <div className="flex flex-wrap items-center gap-5 text-xs text-white/40">
                                    <span className="flex items-center gap-2"><Check size={14} className="text-emerald-400" /> Durable feed</span>
                                    <span className="flex items-center gap-2"><Check size={14} className="text-emerald-400" /> Shared saves</span>
                                    <span className="flex items-center gap-2"><Check size={14} className="text-emerald-400" /> Axis identity</span>
                                    <span className="ml-auto font-mono">{connectedSources}/{totalSources} AUTHORITATIVE SOURCES ONLINE</span>
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === 'Signals' && (
                        signals.length ? (
                            <>
                                {selectedSignal && (
                                    <section className="relative min-h-[380px] overflow-hidden rounded-3xl border border-white/5 bg-[#090b0b]">
                                        {mediaAsset(selectedSignal).thumbnail && <img src={mediaAsset(selectedSignal).thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />}
                                        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/20" />
                                        <div className="relative z-10 flex min-h-[380px] max-w-3xl flex-col justify-end p-8 lg:p-12">
                                            <span className="mb-4 w-fit rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">{selectedSignal.category || 'Signal'}</span>
                                            <h3 className="text-3xl font-black leading-tight lg:text-5xl">{selectedSignal.title}</h3>
                                            <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-white/55">{selectedSignal.description || 'No description supplied.'}</p>
                                            <div className="mt-6 flex flex-wrap items-center gap-3">
                                                <button onClick={openStage} className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-black"><Play size={15} fill="currentColor" /> Watch in Stage</button>
                                                <button onClick={() => toggleSignalLike(selectedSignal)} className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold ${selectedSignal.viewerLiked ? 'border-amber-300/30 bg-amber-300/10 text-amber-300' : 'border-white/10 bg-white/5 text-white/60'}`}><Zap size={15} className={selectedSignal.viewerLiked ? 'fill-amber-300' : ''} /> {formatCount(selectedSignal.likes)}</button>
                                                <button onClick={() => toggleSignalBookmark(selectedSignal)} className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold ${selectedSignal.viewerBookmarked ? 'border-purple-300/30 bg-purple-300/10 text-purple-300' : 'border-white/10 bg-white/5 text-white/60'}`}><Bookmark size={15} className={selectedSignal.viewerBookmarked ? 'fill-purple-300' : ''} /> {selectedSignal.viewerBookmarked ? 'Saved' : 'Save'}</button>
                                            </div>
                                        </div>
                                    </section>
                                )}
                                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{signals.map(renderSignalCard)}</div>
                            </>
                        ) : <EmptyState icon={MonitorPlay} title="No Signals have been published" detail="This is the real Signals ledger. Publish a long-form video in the Stage and it will appear here, mobile Studio, and every connected surface." action={openStage} />
                    )}

                    {activeTab === 'Brainrot' && (
                        brainrot.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{brainrot.map(post => renderPostCard(post, 'brainrot'))}</div>
                            : <EmptyState icon={Brain} title="No Brainrot clips in the ledger" detail="The old viral placeholders are gone. Real typed Brainrot posts will appear here with durable bolts, saves, and comments." action={openStage} />
                    )}

                    {activeTab === 'Flux' && (
                        flux.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{flux.map(post => renderPostCard(post, 'flux'))}</div>
                            : <EmptyState icon={Eye} title="No Flux posts yet" detail="Publish from any Studio surface and the shared entry will appear here." action={openStage} />
                    )}

                    {activeTab === 'Directs' && (
                        chats.length ? (
                            <div className="grid gap-3 lg:grid-cols-2">
                                {chats.map((chat: any) => (
                                    <button key={chat.id} onClick={() => openChat(chat)} className="flex items-center gap-4 rounded-2xl border border-white/5 bg-[#0A0A0A] p-4 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.03]">
                                        <div className="relative"><img src={chat.image} alt="" className="h-12 w-12 rounded-full object-cover" />{chat.online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0A0A0A] bg-emerald-400" />}</div>
                                        <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-bold">{chat.title}</h4><p className="mt-1 truncate text-xs text-white/40">{chat.lastMessage || chat.messagesCount || 'Open Direct'}</p></div>
                                        {chat.unread > 0 && <span className="rounded-full bg-cyan-500 px-2 py-1 text-[9px] font-bold text-black">{chat.unread}</span>}
                                    </button>
                                ))}
                            </div>
                        ) : <EmptyState icon={MessageSquare} title="No Axis Directs" detail="New conversations created through Axis will appear here." />
                    )}

                    {activeTab === 'Communities' && (
                        communities.length ? (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {communities.map((community: any) => (
                                    <button key={community.id} onClick={() => openCommunity(community)} className="rounded-2xl border border-white/5 bg-[#0A0A0A] p-5 text-left transition hover:border-purple-400/35">
                                        <div className="flex items-start gap-4">
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-2xl">{community.icon || '💬'}</div>
                                            <div className="min-w-0 flex-1"><h4 className="truncate font-bold">{community.name}</h4><p className="mt-1 line-clamp-2 text-xs text-white/40">{community.description || 'Axis community'}</p></div>
                                        </div>
                                        <div className="mt-5 flex gap-4 border-t border-white/5 pt-4 text-[10px] font-mono text-white/35">
                                            <span>{formatCount(community.member_count ?? community.membersCount)} members</span>
                                            <span>{formatCount(community.post_count ?? community.postsCount)} posts</span>
                                            {community.my_role && <span className="ml-auto text-purple-300">{community.my_role}</span>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : <EmptyState icon={Users} title="No Axis communities available" detail="Communities created in Axis will appear here as soon as the messaging nexus reconnects." />
                    )}

                    {activeTab === 'Saved' && (
                        saved.length ? (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {saved.map((item: any) => (
                                    <button key={`${item.itemType}:${item.itemId}`} onClick={openStage} className="flex gap-4 rounded-2xl border border-white/5 bg-[#0A0A0A] p-4 text-left transition hover:border-amber-300/25">
                                        {item.mediaUrl ? <img src={item.mediaUrl} alt="" className="h-20 w-24 rounded-xl object-cover" /> : <div className="flex h-20 w-24 items-center justify-center rounded-xl bg-amber-300/5"><Bookmark size={20} className="text-amber-300/50" /></div>}
                                        <div className="min-w-0 flex-1"><span className="text-[9px] font-bold uppercase tracking-wider text-amber-300/70">{item.itemType}</span><h4 className="mt-1 line-clamp-2 text-sm font-bold">{item.title}</h4><p className="mt-2 text-[10px] text-white/30">Saved {formatAge(item.savedAt)}</p></div>
                                    </button>
                                ))}
                            </div>
                        ) : <EmptyState icon={Bookmark} title="Your shared library is empty" detail="Save a Signal, Brainrot clip, or Flux post and it will be available from every Studio surface." action={openStage} />
                    )}

                    {activeTab === 'Activity' && (
                        notifications.length ? (
                            <div className="mx-auto max-w-4xl space-y-3">
                                {notifications.map(item => (
                                    <article key={item.id} className={`flex gap-4 rounded-2xl border p-4 ${item.read ? 'border-white/5 bg-[#0A0A0A]' : 'border-purple-400/25 bg-purple-400/[0.05]'}`}>
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500/10"><Bell size={16} className="text-purple-300" /></div>
                                        <div className="min-w-0 flex-1"><h4 className="text-sm font-bold">{item.actorName || item.actorId || 'Studio activity'}</h4><p className="mt-1 text-sm text-white/50">{item.text}</p><p className="mt-2 text-[10px] text-white/25">{formatAge(item.createdAt)}</p></div>
                                    </article>
                                ))}
                            </div>
                        ) : <EmptyState icon={Bell} title="Axis activity is quiet" detail="New comments, replies, follows, bolts, and Signal engagement will arrive here." />
                    )}
                </div>
            </main>

            <AnimatePresence>
                {loading && connectedSources === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-black/65 backdrop-blur-sm">
                        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0A0A0A] px-5 py-4 text-xs text-white/60"><Loader2 size={17} className="animate-spin text-purple-300" /> Connecting the Stage ecosystem</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default EcosystemView;
