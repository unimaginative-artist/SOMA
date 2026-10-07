import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Eye, MonitorPlay, Play, RefreshCw, WifiOff, Zap } from 'lucide-react';
import { WidgetData } from '../../types';

interface Props {
    data: WidgetData;
    onNavigate?: (view: string) => void;
}

interface StudioFeedPost {
    id: string;
    authorId?: string;
    authorName?: string;
    authorAvatar?: string;
    text?: string;
    type?: string;
    likes?: number;
    viewerLiked?: boolean;
    createdAt?: number;
}

const FEED_LIMIT = 30;
const REFRESH_INTERVAL_MS = 15_000;

function studioHeaders() {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
        const token = localStorage.getItem('studio_session_v1');
        if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    return headers;
}

function studioActor() {
    try {
        const user = JSON.parse(localStorage.getItem('studio_user_v2') || 'null');
        if (user?.id || user?.userId) {
            return {
                userId: user.userId || user.id,
                displayName: user.displayName || user.name || user.handle || 'Studio User',
                avatar: user.avatar || '',
            };
        }
    } catch {}
    try {
        const user = JSON.parse(localStorage.getItem('axis_user_v2') || 'null');
        if (user?.id) return { userId: user.id, displayName: user.name || 'Studio User', avatar: user.avatar || '' };
    } catch {}
    return null;
}

function formatAge(createdAt?: number) {
    if (!createdAt) return '';
    const elapsed = Math.max(0, Date.now() - Number(createdAt));
    if (elapsed < 60_000) return 'now';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
    return `${Math.floor(elapsed / 86_400_000)}d`;
}

function feedPresentation(type = 'text') {
    const normalized = type.toLowerCase();
    if (normalized.includes('brainrot')) {
        return { app: 'Brainrot', icon: Brain, color: 'text-pink-500', bg: 'bg-pink-500/10' };
    }
    if (normalized.includes('signal') || normalized.includes('video')) {
        return { app: 'Signal', icon: MonitorPlay, color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
    }
    return { app: 'Flux', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10' };
}

const AppsFeedWidget: React.FC<Props> = ({ data: _data, onNavigate }) => {
    const [posts, setPosts] = useState<StudioFeedPost[]>([]);
    const [connected, setConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [pendingLikes, setPendingLikes] = useState<Set<string>>(() => new Set());

    const loadFeed = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const response = await fetch(`/api/studio/feed?limit=${FEED_LIMIT}`, {
                headers: studioHeaders(),
                cache: 'no-store',
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.ok === false || !Array.isArray(payload.posts)) {
                throw new Error(payload.error || 'The shared Studio feed is unavailable.');
            }
            setPosts(payload.posts);
            setConnected(true);
            setError('');
        } catch (cause) {
            setConnected(false);
            setError(cause instanceof Error ? cause.message : 'The shared Studio feed is unavailable.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadFeed(true);
        const interval = window.setInterval(() => void loadFeed(), REFRESH_INTERVAL_MS);
        const refreshOnFocus = () => void loadFeed();
        window.addEventListener('focus', refreshOnFocus);
        window.addEventListener('studio:feed-changed', refreshOnFocus);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refreshOnFocus);
            window.removeEventListener('studio:feed-changed', refreshOnFocus);
        };
    }, [loadFeed]);

    const toggleLike = async (event: React.MouseEvent, post: StudioFeedPost) => {
        event.stopPropagation();
        if (pendingLikes.has(post.id)) return;

        const wasLiked = Boolean(post.viewerLiked);
        const previousLikes = Number(post.likes || 0);
        const nextLiked = !wasLiked;
        setPendingLikes(current => new Set(current).add(post.id));
        setPosts(current => current.map(item => item.id === post.id ? {
            ...item,
            viewerLiked: nextLiked,
            likes: Math.max(0, previousLikes + (nextLiked ? 1 : -1)),
        } : item));

        try {
            const actor = studioActor();
            const response = await fetch(`/api/studio/feed/${encodeURIComponent(post.id)}/like`, {
                method: 'POST',
                headers: studioHeaders(),
                body: JSON.stringify({ ...(actor || {}), delta: nextLiked ? 1 : -1 }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.ok === false || !payload.post) {
                throw new Error(payload.error || 'Unable to save the bolt reaction.');
            }
            setPosts(current => current.map(item => item.id === post.id ? payload.post : item));
            setConnected(true);
            setError('');
            window.dispatchEvent(new Event('studio:feed-changed'));
        } catch (cause) {
            setPosts(current => current.map(item => item.id === post.id ? {
                ...item,
                viewerLiked: wasLiked,
                likes: previousLikes,
            } : item));
            setError(cause instanceof Error ? cause.message : 'Unable to save the bolt reaction.');
        } finally {
            setPendingLikes(current => {
                const next = new Set(current);
                next.delete(post.id);
                return next;
            });
        }
    };

    return (
        <div
            className="w-full h-full min-h-0 flex flex-col p-5 bg-[#0A0A0A] relative overflow-hidden cursor-pointer group"
            onClick={() => onNavigate?.('stage')}
        >
            <div className="flex items-center justify-between mb-4 relative z-10 shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform">
                        <Play size={14} className="text-white fill-white" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white leading-none">The Stage</h3>
                        <span className="text-[10px] text-white/40 font-mono">SHARED ECOSYSTEM FEED</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono tracking-wider ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {connected ? 'CONNECTED' : 'RECONNECTING'}
                    </span>
                    <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
                </div>
            </div>

            <div className="min-h-0 flex-1 flex flex-col gap-3 relative z-10 overflow-y-auto overscroll-contain mask-gradient-bottom scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                {loading && posts.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-white/35">
                        <RefreshCw size={18} className="animate-spin" />
                        <span className="text-[10px] font-mono uppercase tracking-wider">Connecting to Studio</span>
                    </div>
                )}

                {!loading && posts.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center gap-2 px-5 text-center text-white/35">
                        <WifiOff size={18} />
                        <span className="text-[11px]">{error || 'The shared feed is connected, but there are no posts yet.'}</span>
                        <button
                            onClick={(event) => { event.stopPropagation(); void loadFeed(true); }}
                            className="text-[10px] font-mono uppercase tracking-wider text-purple-300 hover:text-white"
                        >
                            Retry
                        </button>
                    </div>
                )}

                <AnimatePresence initial={false}>
                    {posts.map((post) => {
                        const presentation = feedPresentation(post.type);
                        const Icon = presentation.icon;
                        const pending = pendingLikes.has(post.id);
                        return (
                            <motion.div
                                key={post.id}
                                layout
                                initial={{ opacity: 0, y: -12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96 }}
                                transition={{ duration: 0.25 }}
                                className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors shrink-0"
                            >
                                {post.authorAvatar ? (
                                    <img src={post.authorAvatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-white/10" />
                                ) : (
                                    <div className={`w-8 h-8 rounded-full ${presentation.bg} flex items-center justify-center shrink-0`}>
                                        <Icon size={14} className={presentation.color} />
                                    </div>
                                )}

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-0.5 gap-2">
                                        <span className="text-xs font-bold text-white truncate">{post.authorName || post.authorId || 'Studio'}</span>
                                        <span className="text-[10px] text-white/30 whitespace-nowrap">{formatAge(post.createdAt)}</span>
                                    </div>
                                    <p className="text-[11px] text-white/60 leading-snug line-clamp-2">{post.text || `${presentation.app} media post`}</p>
                                </div>

                                <button
                                    aria-label={post.viewerLiked ? 'Remove bolt' : 'Add bolt'}
                                    aria-pressed={Boolean(post.viewerLiked)}
                                    disabled={pending}
                                    onClick={(event) => void toggleLike(event, post)}
                                    className="self-center min-w-8 px-1.5 py-1.5 flex flex-col items-center gap-0.5 hover:bg-white/10 rounded-lg transition-colors group/like disabled:opacity-50"
                                >
                                    <Zap
                                        size={15}
                                        className={`transition-colors ${post.viewerLiked ? 'fill-amber-400 text-amber-400' : 'text-white/30 group-hover/like:text-amber-300'}`}
                                    />
                                    <span className={`text-[9px] font-mono ${post.viewerLiked ? 'text-amber-300' : 'text-white/30'}`}>{Number(post.likes || 0)}</span>
                                </button>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {error && posts.length > 0 && (
                <div className="absolute bottom-2 left-5 right-5 z-30 text-[9px] text-amber-300/80 font-mono truncate">{error}</div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#0A0A0A] to-transparent pointer-events-none z-20" />
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-[50px] pointer-events-none" />
        </div>
    );
};

export default AppsFeedWidget;
