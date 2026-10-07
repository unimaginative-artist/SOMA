import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WidgetData, ChatSession, UserProfile } from '../../types';
import { Camera, ChevronDown, MoreHorizontal, PenSquare, Search, Plus, MessageCircle, UserPlus, Ghost, Settings, CheckCheck, Archive, BellOff, Trash2, Lock, EyeOff, RefreshCw, X, Unlock } from 'lucide-react';
import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from 'framer-motion';
import { axisHeaders, getDirects, startDirect as startAxisDirect } from '../../services/directsService';
import { stableAvatar } from '../../services/avatarService';
// @ts-ignore
import somaBackend from '../../../../somaBackend';
import IdentityChip from '../identity/IdentityChip';
import ContactDrawer, { DrawerContact } from '../ui/ContactDrawer';

interface Props {
    data?: WidgetData;
    onChatSelect?: (chat: ChatSession) => void;
    currentUser?: UserProfile;
    isWidget?: boolean;
}

// Fallback data mirrors AxisProfileStore DEFAULT_CHATS — used only if API is unreachable
const INITIAL_CHATS: ChatSession[] = [
    { id: 'axis-marcus',  title: 'Marcus Chen',   image: 'https://randomuser.me/api/portraits/men/32.jpg',   members: '', messagesCount: 'Typing...',            online: true  },
    { id: 'axis-ava',     title: 'Ava Williams',  image: 'https://randomuser.me/api/portraits/women/44.jpg', members: '', messagesCount: '2 new messages · 1h',  online: true  },
    { id: 'axis-jordan',  title: 'Jordan Blake',  image: 'https://randomuser.me/api/portraits/men/71.jpg',   members: '', messagesCount: 'Seen · 3h',            online: false },
    { id: 'axis-priya',   title: 'Priya Sharma',  image: 'https://randomuser.me/api/portraits/women/26.jpg', members: '', messagesCount: '4 new messages · 30m', online: true  },
    { id: 'axis-tyler',   title: 'Tyler Reed',    image: 'https://randomuser.me/api/portraits/men/55.jpg',   members: '', messagesCount: 'Sent · 2d',            online: false },
    { id: 'axis-zoe',     title: 'Zoe Martinez',  image: 'https://randomuser.me/api/portraits/women/15.jpg', members: '', messagesCount: 'Sent · 5m',            online: true  },
    { id: 'axis-dex',     title: 'Dex Hammond',   image: 'https://randomuser.me/api/portraits/men/9.jpg',    members: '', messagesCount: 'Seen · 1d',            online: false },
    { id: 'axis-nadia',   title: 'Nadia Okafor',  image: 'https://randomuser.me/api/portraits/women/62.jpg', members: '', messagesCount: 'New · 10m',            online: true  },
    { id: 'axis-sam',     title: 'Sam Kowalski',  image: 'https://randomuser.me/api/portraits/men/47.jpg',   members: '', messagesCount: 'Seen · 4h',            online: false },
    { id: 'axis-riley',   title: 'Riley Park',    image: 'https://randomuser.me/api/portraits/women/33.jpg', members: '', messagesCount: '3 new messages · 45m', online: true  },
    { id: 'axis-finn',    title: "Finn O'Brien",  image: 'https://randomuser.me/api/portraits/men/22.jpg',   members: '', messagesCount: 'Sent · 3d',            online: false },
    { id: 'axis-layla',   title: 'Layla Hassan',  image: 'https://randomuser.me/api/portraits/women/50.jpg', members: '', messagesCount: 'Seen · 2h',            online: false },
    { id: 'axis-cole',    title: 'Cole Nakamura', image: 'https://randomuser.me/api/portraits/men/38.jpg',   members: '', messagesCount: 'Typing...',            online: true  },
    { id: 'axis-eva',     title: 'Eva Reyes',     image: 'https://randomuser.me/api/portraits/women/7.jpg',  members: '', messagesCount: 'Sent · 1w',            online: false },
    { id: 'axis-ben',     title: 'Ben Osei',      image: 'https://randomuser.me/api/portraits/men/64.jpg',   members: '', messagesCount: '1 new message · 15m',  online: true  },
    { id: 'axis-mia',     title: 'Mia Thornton',  image: 'https://randomuser.me/api/portraits/women/88.jpg', members: '', messagesCount: 'Seen · 5h',            online: false },
    { id: 'axis-kai',     title: 'Kai Patel',     image: 'https://randomuser.me/api/portraits/men/17.jpg',   members: '', messagesCount: 'Sent · 20m',           online: true  },
    { id: 'axis-jade',    title: 'Jade Moreau',   image: 'https://randomuser.me/api/portraits/women/41.jpg', members: '', messagesCount: 'Seen · 2d',            online: false },
    { id: 'axis-aaron',   title: 'Aaron Cruz',    image: 'https://randomuser.me/api/portraits/men/83.jpg',   members: '', messagesCount: '2 new messages · 2h',  online: true  },
    { id: 'axis-luna',    title: 'Luna Vance',    image: 'https://randomuser.me/api/portraits/women/19.jpg', members: '', messagesCount: 'Sent · 6h',            online: false },
];

const FAVORITES = [
    { id: 'axis-marcus', name: 'Marcus',  image: 'https://randomuser.me/api/portraits/men/32.jpg'   },
    { id: 'axis-ava',    name: 'Ava',     image: 'https://randomuser.me/api/portraits/women/44.jpg' },
    { id: 'axis-priya',  name: 'Priya',   image: 'https://randomuser.me/api/portraits/women/26.jpg' },
    { id: 'axis-nadia',  name: 'Nadia',   image: 'https://randomuser.me/api/portraits/women/62.jpg' },
    { id: 'axis-cole',   name: 'Cole',    image: 'https://randomuser.me/api/portraits/men/38.jpg'   },
];

type TabType = 'Primary' | 'General' | 'Requests';
type ViewMode = 'inbox' | 'hidden' | 'deleted';

const hydrateDirectImages = (directs: ChatSession[], fallback: ChatSession[] = []) => {
    const imageByName = new Map<string, string>();
    [...fallback, ...INITIAL_CHATS].forEach(chat => imageByName.set(String(chat.title).toLowerCase(), chat.image));
    return directs.map(chat => ({
        ...chat,
        image: stableAvatar({
            id: chat.id,
            title: chat.title,
            image: chat.image || imageByName.get(String(chat.title).toLowerCase()),
        }),
        axisSource: chat.axisSource || 'axis',
    }));
};

// --- Swipeable Row Component ---
interface SwipeableChatRowProps {
    chat: ChatSession;
    onSelect?: (c: ChatSession) => void;
    onHide?: (id: string) => void;
    onDelete?: (id: string) => void;
    onRestore?: (id: string) => void;
    onOpenProfile?: (contact: DrawerContact) => void;
    viewMode: ViewMode;
}

const SwipeableChatRow: React.FC<SwipeableChatRowProps> = ({
    chat,
    onSelect,
    onHide,
    onDelete,
    onRestore,
    onOpenProfile,
    viewMode
}) => {
    const x = useMotionValue(0);
    const backgroundOpacity = useTransform(x, [-100, 0, 100], [1, 0, 1]);
    const deleteOpacity = useTransform(x, [-150, -50], [1, 0]);
    const hideOpacity = useTransform(x, [50, 150], [0, 1]);

    const handleDragEnd = (event: any, info: PanInfo) => {
        if (viewMode !== 'inbox') {
             x.set(0);
             return;
        }

        if (info.offset.x < -100 && onDelete) {
            onDelete(chat.id as string);
        } else if (info.offset.x > 100 && onHide) {
            onHide(chat.id as string);
        } else {
            // Reset position
            x.set(0);
        }
    };

    const identity = {
        id: String(chat.id),
        name: chat.title,
        handle: chat.members || chat.title,
        avatar: chat.image,
        role: chat.axisSource === 'axis' ? 'Axis Direct' : 'Studio Direct',
        status: chat.online ? 'online' as const : 'offline' as const,
        source: 'direct' as const,
        recentActivity: chat.lastMessage || chat.messagesCount,
        mutualSpaces: ['Studio', 'Axis', 'Directs'],
    };

    const openStudio = (_profile: any) => {
        if (onOpenProfile) {
            onOpenProfile({ id: String(chat.id), name: chat.title, image: chat.image, online: Boolean(chat.online), chatId: String(chat.id) });
        }
    };

    return (
        <motion.div 
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="relative overflow-hidden mb-1"
        >
            {/* Background Actions Layer */}
            {viewMode === 'inbox' && (
                <motion.div 
                    style={{ opacity: backgroundOpacity }}
                    className="absolute inset-0 flex items-center justify-between px-6 pointer-events-none z-0"
                >
                    {/* Left Side (Swipe Right) -> Hide */}
                    <motion.div style={{ opacity: hideOpacity }} className="flex items-center gap-2 text-emerald-400 font-bold">
                        <EyeOff size={24} />
                        <span className="text-sm">HIDE</span>
                    </motion.div>

                    {/* Right Side (Swipe Left) -> Delete */}
                    <motion.div style={{ opacity: deleteOpacity }} className="flex items-center gap-2 text-red-500 font-bold">
                        <span className="text-sm">DELETE</span>
                        <Trash2 size={24} />
                    </motion.div>
                </motion.div>
            )}

            {/* Foreground Chat Item */}
            <motion.div
                style={{ x }}
                drag={viewMode === 'inbox' ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={handleDragEnd}
                onClick={() => onSelect && onSelect(chat)}
                whileDrag={{ scale: 1.02, cursor: 'grabbing' }}
                className="relative z-10 bg-black flex items-center justify-between px-6 py-4 active:bg-white/5 transition-colors cursor-pointer group border-b border-white/5"
            >
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <IdentityChip identity={identity} compact showName={false} onOpenStudio={openStudio} />
                        {viewMode === 'deleted' && (
                            <div className="absolute inset-0 bg-red-500/20 rounded-[20px] flex items-center justify-center">
                                <Trash2 size={20} className="text-white" />
                            </div>
                        )}
                        {viewMode === 'hidden' && (
                            <div className="absolute inset-0 bg-emerald-500/20 rounded-[20px] flex items-center justify-center">
                                <Lock size={20} className="text-white" />
                            </div>
                        )}
                        {viewMode === 'inbox' && Boolean(chat.unread) && (
                            <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-black text-white ring-2 ring-black">
                                {chat.unread}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col gap-1 pointer-events-none">
                        <span className="text-white text-[16px] font-medium leading-tight">{chat.title}</span>
                        {viewMode === 'deleted' ? (
                            <span className="text-red-400 text-[12px] font-normal">30 days remaining</span>
                        ) : (
                            <span className={`text-[14px] font-normal ${chat.unread ? 'text-blue-300' : 'text-white/50'}`}>{chat.messagesCount}</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Actions for Hidden/Deleted views */}
                    {(viewMode === 'hidden' || viewMode === 'deleted') && onRestore ? (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onRestore(chat.id as string); }}
                            className="p-2 bg-white/10 rounded-full hover:bg-white/20 text-white transition-colors"
                        >
                            <RefreshCw size={18} />
                        </button>
                    ) : (
                        <button 
                            className="text-white/40 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Camera size={24} strokeWidth={1.5} />
                        </button>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
};


const GalleryWidget: React.FC<Props> = ({ data, onChatSelect, currentUser, isWidget = false }) => {
  const widgetGridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState({ width: 456, height: 300 });
  // Data State
  const [activeChats, setActiveChats] = useState<ChatSession[]>([]);
  const [hiddenChats, setHiddenChats] = useState<ChatSession[]>([]);
  const [deletedChats, setDeletedChats] = useState<ChatSession[]>([]);
  const [axisStatus, setAxisStatus] = useState<'loading' | 'live' | 'local'>('loading');
  const [directSearch, setDirectSearch] = useState('');

  // Compose modal state
  const [showCompose, setShowCompose] = useState(false);
  const [composeQuery, setComposeQuery] = useState('');
  const [composeContacts, setComposeContacts] = useState<any[]>([]);
  const [composeBusy, setComposeBusy] = useState<string | null>(null);
  const [composeLoading, setComposeLoading] = useState(false);

  // UI State
  const [activeTab, setActiveTab] = useState<TabType>('Primary');
  const [showOptions, setShowOptions] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('inbox');
  
  // Contact drawer
  const [drawerContact, setDrawerContact] = useState<DrawerContact | null>(null);

  // Security State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authError, setAuthError] = useState(false);
  const hiddenPasscode = String((currentUser as any)?.studio?.axis?.hiddenPasscode || localStorage.getItem('soma_axis_hidden_passcode') || '1234');

  const splitChatsByStatus = (chats: ChatSession[]) => {
      setActiveChats(chats.filter(chat => !chat.status || chat.status === 'active'));
      setHiddenChats(chats.filter(chat => chat.status === 'hidden'));
      setDeletedChats(chats.filter(chat => chat.status === 'deleted'));
  };

  const syncChatStatus = async (id: string | number, status: 'active' | 'hidden' | 'deleted') => {
      const updateLocalOnly = () => {
          const key = 'studio_axis_direct_status';
          let statuses: Record<string, string> = {};
          try { statuses = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
          statuses[String(id)] = status;
          localStorage.setItem(key, JSON.stringify(statuses));
      };
      if ([...activeChats, ...hiddenChats, ...deletedChats].some(chat => chat.id === id && chat.axisSource === 'axis')) {
          updateLocalOnly();
          return;
      }
      try {
          await fetch(`/api/studio/axis/chats/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status }),
          });
      } catch {
          setAxisStatus('local');
      }
  };

  useEffect(() => {
      const handler = (e: Event) => {
          const chat = (e as CustomEvent).detail?.chat;
          if (chat) openChat(chat);
      };
      window.addEventListener('studio:open-direct', handler);
      return () => window.removeEventListener('studio:open-direct', handler);
  }, []);

  useEffect(() => {
      let cancelled = false;
      getDirects()
          .then(data => {
              if (cancelled || !Array.isArray(data?.directs)) return;
              if (data.directs.length === 0) throw new Error('No Axis directs seeded yet');
              let statuses: Record<string, string> = {};
              try { statuses = JSON.parse(localStorage.getItem('studio_axis_direct_status') || '{}'); } catch {}
              splitChatsByStatus(hydrateDirectImages(data.directs, INITIAL_CHATS).map(chat => ({
                  ...chat,
                  status: (statuses[String(chat.id)] as any) || chat.status || 'active',
              })));
              setAxisStatus('live');
          })
          .catch(() => {
              fetch('/api/studio/axis')
                  .then(response => response.ok ? response.json() : Promise.reject(new Error('Axis unavailable')))
                  .then(data => {
                      if (cancelled || !Array.isArray(data?.axis?.chats)) return;
                      splitChatsByStatus(data.axis.chats.map((chat: ChatSession) => ({ ...chat, axisSource: 'studio' })));
                      setAxisStatus('live');
                  })
                  .catch(() => setAxisStatus('local'));
          });
      return () => { cancelled = true; };
  }, []);

  // Refresh unread counts when messages arrive via WebSocket
  useEffect(() => {
      const refresh = () => {
          getDirects()
              .then(data => {
                  if (!Array.isArray(data?.directs)) return;
                  setActiveChats(prev => prev.map(c => {
                      const fresh = data.directs.find((d: any) => d.id === c.id);
                      return fresh ? { ...c, unread: fresh.unread ?? c.unread, messagesCount: fresh.messagesCount || c.messagesCount, lastMessage: fresh.lastMessage || c.lastMessage } : c;
                  }));
              })
              .catch(() => {});
      };
      somaBackend.on('axis.message', refresh);
      return () => somaBackend.off('axis.message', refresh);
  }, []);

  const openCompose = async () => {
      setShowCompose(true);
      setComposeQuery('');
      setComposeLoading(true);
      const contacts: any[] = [];
      const seen = new Set<string>();
      try {
          const d = await fetch('/api/axis/contacts', { headers: axisHeaders() }).then(r => r.json());
          for (const c of (d?.contacts || [])) {
              if (!seen.has(c.id)) { seen.add(c.id); contacts.push({ id: c.id, name: c.name, color: c.color }); }
          }
      } catch {}
      try {
          const d = await fetch('/api/studio/axis').then(r => r.json());
          for (const f of (d?.axis?.friends || d?.friends || [])) {
              const id = f.id || f.title;
              if (id && !seen.has(id)) { seen.add(id); contacts.push(f); }
          }
      } catch {}
      setComposeContacts(contacts);
      setComposeLoading(false);
  };

  const startDirect = async (target: any) => {
      const targetId = target.id || `direct-${String(target.name || target.title || composeQuery).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const targetName = target.name || target.title || composeQuery.trim();
      if (!targetName || composeBusy) return;
      setComposeBusy(targetId);
      try {
          const direct = await startAxisDirect({ ...target, id: targetId, name: targetName });
          splitChatsByStatus(hydrateDirectImages([direct, ...activeChats]));
          setAxisStatus('live');
      } catch {
              const chat: ChatSession = {
              id: `local-${Date.now()}`,
              title: targetName,
              image: stableAvatar({ id: targetId, title: targetName }),
              members: '',
              messagesCount: 'Direct draft',
              status: 'active',
          };
          setActiveChats(prev => [chat, ...prev]);
          setAxisStatus('local');
      }
      setComposeBusy(null);
      setShowCompose(false);
  };

  const handleNoteClick = (user: string) => {
      const chat = activeChats.find(item => item.title.toLowerCase().includes(user.toLowerCase()));
      if (chat) openChat(chat);
  };

  const openChat = async (chat: ChatSession) => {
      let target = chat;
      if (chat.axisSource !== 'axis') {
          try {
              const real = await startAxisDirect({ id: String(chat.id), name: chat.title, image: chat.image });
              // Replace the studio/local entry with the real SQLite-backed channel
              setActiveChats(prev => {
                  const filtered = prev.filter(c => c.id !== chat.id && c.id !== real.id);
                  return [real, ...filtered];
              });
              target = real;
          } catch {}
      }
      const readChat = { ...target, unread: 0, messagesCount: target.lastMessage ? `Seen · ${new Date(target.updatedAt || Date.now()).toLocaleDateString()}` : 'Read' };
      if (target.status === 'hidden') setHiddenChats(prev => prev.map(item => item.id === target.id ? readChat : item));
      else if (target.status === 'deleted') setDeletedChats(prev => prev.map(item => item.id === target.id ? readChat : item));
      else setActiveChats(prev => prev.map(item => item.id === target.id ? readChat : item));
      onChatSelect?.(readChat);
  };

  // --- Actions ---

  const hideChat = (id: string) => {
      const chatToHide = activeChats.find(c => c.id === id);
      if (chatToHide) {
          const next = { ...chatToHide, status: 'hidden' as const };
          setActiveChats(prev => prev.filter(c => c.id !== id));
          setHiddenChats(prev => [next, ...prev.filter(c => c.id !== id)]);
          syncChatStatus(id, 'hidden');
      }
  };

  const deleteChat = (id: string) => {
      const chatToDelete = activeChats.find(c => c.id === id);
      if (chatToDelete) {
          const next = { ...chatToDelete, status: 'deleted' as const };
          setActiveChats(prev => prev.filter(c => c.id !== id));
          setDeletedChats(prev => [next, ...prev.filter(c => c.id !== id)]);
          syncChatStatus(id, 'deleted');
      }
  };

  const restoreChat = (id: string) => {
      // Find where it is
      const fromHidden = hiddenChats.find(c => c.id === id);
      const fromDeleted = deletedChats.find(c => c.id === id);

      if (fromHidden) {
          setHiddenChats(prev => prev.filter(c => c.id !== id));
          setActiveChats(prev => [{ ...fromHidden, status: 'active' }, ...prev]);
          syncChatStatus(id, 'active');
      } else if (fromDeleted) {
          setDeletedChats(prev => prev.filter(c => c.id !== id));
          setActiveChats(prev => [{ ...fromDeleted, status: 'active' }, ...prev]);
          syncChatStatus(id, 'active');
      }
  };

  const handleAccessHidden = () => {
      if (isUnlocked) {
          setViewMode('hidden');
          setShowOptions(false);
      } else {
          setShowPasswordModal(true);
          setShowOptions(false);
      }
  };

  const verifyPassword = () => {
      if (passwordInput === hiddenPasscode) {
          setIsUnlocked(true);
          setShowPasswordModal(false);
          setPasswordInput('');
          setAuthError(false);
          setViewMode('hidden');
      } else {
          setAuthError(true);
          // Shake effect could go here
      }
  };

  useEffect(() => {
      if (!isWidget || !widgetGridRef.current) return;
      const node = widgetGridRef.current;
      const update = () => {
          const rect = node.getBoundingClientRect();
          setGridSize({
              width: Math.max(0, rect.width),
              height: Math.max(0, rect.height),
          });
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
  }, [isWidget]);

  const displayFavorites = useMemo(() => {
      return activeChats.slice(0, 5).map(c => ({
          id: String(c.id),
          name: String(c.title || '').split(/\s+/)[0],
          image: c.image || '',
      }));
  }, [activeChats]);

  const previewTile = useMemo(() => {
      const columns = 6;
      const rows = 2;
      const gap = 2;
      const labelHeight = 13;
      const widthFromContainer = (gridSize.width - gap * (columns - 1)) / columns;
      const heightFromContainer = ((gridSize.height - gap * (rows - 1)) / rows) - labelHeight - gap;
      const width = Math.max(34, Math.floor(widthFromContainer));
      const height = Math.max(44, Math.floor(heightFromContainer));
      return { columns, gap, labelHeight, width, height };
  }, [gridSize]);

  // --- WIDGET MODE (HOME SCREEN) ---
  if (isWidget) {
      return (
        <div className="w-full h-full min-h-0 flex flex-col px-4 pb-6 pt-3 overflow-hidden">
            {/* Widget Header */}
            <div className="flex shrink-0 items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                    <MessageCircle size={20} className="text-white" />
                    <h3 className="text-xl font-bold text-white tracking-tight font-display">Directs</h3>
                </div>
                <span className="text-xs font-medium text-white/40 bg-white/5 px-2 py-1 rounded-full">
                    {axisStatus === 'live' ? 'Axis DB' : axisStatus === 'loading' ? 'Checking' : 'Local'} · {activeChats.length}
                </span>
            </div>

            {/* Quick Grid Display */}
            <div
                ref={widgetGridRef}
                className="grid min-h-0 flex-1 grid-rows-2 justify-start overflow-hidden pb-1"
                style={{
                    gridTemplateColumns: `repeat(${previewTile.columns}, ${previewTile.width}px)`,
                    gap: `${previewTile.gap}px`,
                }}
            >
                {activeChats.slice(0, 12).map((chat) => (
                    <div 
                        key={chat.id} 
                        className="group flex min-h-0 cursor-pointer flex-col items-center"
                        style={{ gap: `${previewTile.gap}px` }}
                        onClick={() => onChatSelect && onChatSelect(chat)}
                    >
                        <div
                            className="relative shrink-0"
                            style={{ width: previewTile.width, height: previewTile.height }}
                        >
                            <div className="absolute inset-0 rounded-[14px] border border-white/5 bg-white/5 overflow-hidden shadow-sm transition-all duration-300 group-hover:border-white/30 group-hover:bg-white/10">
                                <img 
                                    src={chat.image} 
                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500" 
                                    alt={chat.title} 
                                />
                            </div>
                            {chat.online && <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-blue-500 border-2 border-[#111] rounded-full"></div>}
                        </div>
                        <span
                            className="w-full shrink-0 truncate text-center text-[9px] font-medium leading-none text-white/50 transition-colors group-hover:text-white"
                            style={{ minHeight: previewTile.labelHeight }}
                        >
                            {chat.title}
                        </span>
                    </div>
                ))}
            </div>
        </div>
      );
  }

  // --- FULL VIEW MODE (INBOX) ---

  const getDisplayChats = () => {
      let source = viewMode === 'hidden' ? hiddenChats : viewMode === 'deleted' ? deletedChats : activeChats;
      if (viewMode === 'inbox') {
          if (activeTab === 'Primary') {
              source = source.slice(0, Math.max(5, Math.ceil(source.length / 2)));
          } else if (activeTab === 'General') {
              source = source.slice(Math.max(5, Math.ceil(source.length / 2)));
          } else if (activeTab === 'Requests') {
              source = [];
          }
      }
      const q = directSearch.trim().toLowerCase();
      if (!q) return source;
      return source.filter(chat =>
          `${chat.title || ''} ${chat.members || ''} ${chat.messagesCount || ''} ${chat.lastMessage || ''}`
              .toLowerCase()
              .includes(q)
      );
  };

  const getHeaderTitle = () => {
      if (viewMode === 'hidden') return 'Hidden';
      if (viewMode === 'deleted') return 'Deleted';
      return 'Directs';
  };

  return (
    <div className="w-full h-full flex flex-col bg-black text-white pt-12 pb-24 font-sans overflow-y-auto no-scrollbar relative">
      
      {/* Compose / New Direct Modal */}
      <AnimatePresence>
        {showCompose && (
            <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center">
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/70 backdrop-blur-md"
                    onClick={() => setShowCompose(false)}
                />
                <motion.div
                    initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 bg-[#0f0f11] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
                    style={{ maxHeight: '72vh' }}
                >
                    {/* Handle */}
                    <div className="flex justify-center pt-3 pb-1 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-white/15" />
                    </div>

                    {/* Header */}
                    <div className="flex items-center justify-between px-5 pb-4 shrink-0">
                        <div>
                            <h2 className="text-[17px] font-bold text-white tracking-tight">New Message</h2>
                            <p className="text-[12px] text-white/30 mt-0.5">Start a private Direct thread</p>
                        </div>
                        <button
                            onClick={() => setShowCompose(false)}
                            className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/15 transition-all"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {/* Search bar */}
                    <div className="px-4 pb-3 shrink-0">
                        <div className="flex items-center gap-2.5 bg-white/6 border border-white/8 rounded-2xl px-4 py-3">
                            <Search size={15} className="text-white/30 shrink-0" />
                            <input
                                value={composeQuery}
                                onChange={e => setComposeQuery(e.target.value)}
                                placeholder="Search or enter a name…"
                                autoFocus
                                className="flex-1 bg-transparent border-none outline-none text-[14px] text-white placeholder:text-white/25"
                            />
                            {composeQuery && (
                                <button onClick={() => setComposeQuery('')} className="text-white/30 hover:text-white transition-colors">
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Section label */}
                    {!composeQuery && composeContacts.length > 0 && (
                        <div className="px-5 pb-2 shrink-0">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Suggested</span>
                        </div>
                    )}

                    {/* Contacts list */}
                    <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0" style={{ scrollbarWidth: 'none' }}>
                        {composeLoading ? (
                            <div className="flex flex-col gap-1 px-2">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-3 p-3 rounded-2xl">
                                        <div className="w-11 h-11 rounded-[14px] bg-white/6 animate-pulse shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="h-3 w-28 rounded bg-white/6 animate-pulse" />
                                            <div className="h-2.5 w-16 rounded bg-white/4 animate-pulse" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (() => {
                            const q = composeQuery.trim().toLowerCase();
                            const filtered = composeContacts.filter(c => {
                                const text = `${c.name || c.title || ''} ${c.id || ''}`.toLowerCase();
                                return !q || text.includes(q);
                            });

                            const COLORS: Record<string, string> = {
                                blue: '#6366f1', violet: '#a78bfa', emerald: '#34d399',
                                amber: '#fbbf24', rose: '#fb7185', cyan: '#22d3ee',
                            };

                            return (
                                <>
                                    {filtered.map(contact => {
                                        const id = contact.id || contact.title;
                                        const name = contact.name || contact.title || id;
                                        const color = COLORS[contact.color] || '#a78bfa';
                                        const isBusy = composeBusy === id;
                                        return (
                                            <button
                                                key={id}
                                                onClick={() => startDirect(contact)}
                                                disabled={!!composeBusy}
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-white/5 active:bg-white/8 transition-colors text-left group"
                                            >
                                                <div
                                                    className="w-11 h-11 rounded-[14px] shrink-0 overflow-hidden flex items-center justify-center text-base font-bold text-white"
                                                    style={{ background: contact.image || contact.avatar ? 'transparent' : `${color}22`, border: `1.5px solid ${color}33` }}
                                                >
                                                    {contact.image || contact.avatar
                                                        ? <img src={contact.image || contact.avatar} className="w-full h-full object-cover" alt="" />
                                                        : <span style={{ color }}>{(name[0] || '?').toUpperCase()}</span>
                                                    }
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[14px] font-semibold text-white truncate">{name}</div>
                                                    <div className="text-[11px] text-white/30 truncate">{contact.online ? '● Online' : 'Axis contact'}</div>
                                                </div>
                                                <span className="text-[10px] font-bold tracking-widest shrink-0 transition-colors"
                                                    style={{ color: isBusy ? color : 'rgba(255,255,255,0.18)' }}>
                                                    {isBusy ? 'OPENING…' : 'MESSAGE'}
                                                </span>
                                            </button>
                                        );
                                    })}

                                    {/* Type-to-create row */}
                                    {composeQuery.trim() && filtered.length === 0 && (
                                        <button
                                            onClick={() => startDirect({ id: composeQuery.trim(), name: composeQuery.trim() })}
                                            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-indigo-500/8 border border-indigo-500/15 hover:bg-indigo-500/12 transition-colors mt-1"
                                        >
                                            <div className="w-11 h-11 rounded-[14px] bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
                                                <Plus size={20} className="text-indigo-400" />
                                            </div>
                                            <div>
                                                <div className="text-[14px] font-semibold text-indigo-300">Start Direct with "{composeQuery.trim()}"</div>
                                                <div className="text-[11px] text-white/25 mt-0.5">Create a new thread</div>
                                            </div>
                                        </button>
                                    )}

                                    {!composeQuery && filtered.length === 0 && (
                                        <div className="text-center py-10 text-white/20 text-sm">
                                            No contacts yet — join channels to find people
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </motion.div>
            </div>
        )}
      </AnimatePresence>

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-md"
                    onClick={() => setShowPasswordModal(false)}
                />
                <motion.div 
                    initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                    className="relative bg-[#111] border border-white/10 rounded-3xl p-8 w-full max-w-sm flex flex-col items-center text-center shadow-2xl"
                >
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-6">
                        <Lock size={32} className="text-white/50" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Secure Directs</h3>
                    <p className="text-white/40 text-sm mb-6">Enter access code to view hidden Directs.</p>
                    
                    <div className="flex gap-4 mb-6 w-full">
                        <input 
                            type="password" 
                            autoFocus
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            className={`w-full bg-white/5 border ${authError ? 'border-red-500/50 text-red-200' : 'border-white/10 text-white'} rounded-xl px-4 py-3 text-center tracking-[0.5em] text-xl focus:outline-none focus:bg-white/10 transition-colors placeholder:tracking-normal`}
                            placeholder="...."
                            maxLength={4}
                        />
                    </div>
                    
                    <button 
                        onClick={verifyPassword}
                        className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-white/90 transition-colors"
                    >
                        Access
                    </button>
                    {authError && <p className="text-red-500 text-xs mt-4">Incorrect code.</p>}
                </motion.div>
            </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between px-6 mb-4 relative z-50">
          <div className="flex items-center gap-2">
            {viewMode !== 'inbox' && (
                <button onClick={() => setViewMode('inbox')} className="p-1 hover:bg-white/10 rounded-full mr-1">
                    <X size={24} />
                </button>
            )}
            <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-2">
                {getHeaderTitle()}
                {viewMode === 'hidden' && <Lock size={20} className="text-white/30" />}
                {viewMode === 'deleted' && <Trash2 size={20} className="text-white/30" />}
            </h1>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
                axisStatus === 'live'
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                    : axisStatus === 'loading'
                        ? 'border-white/10 bg-white/5 text-white/35'
                        : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
            }`}>
                {axisStatus === 'live' ? 'Axis DB' : axisStatus === 'loading' ? 'Syncing' : 'Local fallback'}
            </span>
          </div>

          <div className="flex items-center gap-6 relative">
              <div className="relative">
                  <button 
                    onClick={() => setShowOptions(!showOptions)} 
                    className={`hover:opacity-70 transition-all p-2 rounded-full ${showOptions ? 'bg-white/10 text-white' : 'text-white/80'}`}
                  >
                    <MoreHorizontal size={28} />
                  </button>
                  
                  <AnimatePresence>
                    {showOptions && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowOptions(false)} />
                            <motion.div 
                                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                className="absolute right-0 top-12 w-60 bg-[#1A1A1A] border border-white/10 rounded-xl shadow-2xl z-50 flex flex-col py-1 overflow-hidden"
                            >
                                <button
                                    onClick={() => {
                                        setActiveChats(prev => prev.map(chat => ({ ...chat, unread: 0, messagesCount: 'Read' })));
                                        setShowOptions(false);
                                    }}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm text-white/80 hover:text-white transition-colors text-left w-full"
                                >
                                    <CheckCheck size={16} /> Mark all as read
                                </button>
                                
                                <button 
                                    onClick={handleAccessHidden}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm text-white/80 hover:text-white transition-colors text-left w-full border-t border-white/5"
                                >
                                    <EyeOff size={16} /> Hidden Directs
                                    {isUnlocked && <Unlock size={12} className="ml-auto text-emerald-500" />}
                                </button>
                                
                                <button 
                                    onClick={() => { setViewMode('deleted'); setShowOptions(false); }}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm text-white/80 hover:text-white transition-colors text-left w-full"
                                >
                                    <Trash2 size={16} /> Recently Deleted
                                </button>
                                
                                <div className="h-px bg-white/5 my-1" />
                                <button className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-sm text-white/80 hover:text-white transition-colors text-left w-full">
                                    <Settings size={16} /> Direct settings
                                </button>
                            </motion.div>
                        </>
                    )}
                  </AnimatePresence>
              </div>

              {viewMode === 'inbox' && (
                <button onClick={openCompose} className="hover:opacity-70 transition-opacity p-1">
                    <PenSquare size={26} />
                </button>
              )}
          </div>
      </div>

      {/* Favorites / Quick Access Row — only rendered when there are real contacts */}
      {viewMode === 'inbox' && (displayFavorites.length > 0 || axisStatus === 'loading') && (
          <div className="flex gap-5 overflow-x-auto px-6 pb-6 scrollbar-hide mb-2 shrink-0">
              {axisStatus === 'loading' ? (
                  /* skeleton while loading */
                  Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-2 shrink-0">
                          <div className="w-[76px] h-[76px] rounded-[24px] bg-white/5 animate-pulse" />
                          <div className="w-10 h-2.5 rounded bg-white/5 animate-pulse" />
                      </div>
                  ))
              ) : (
                  displayFavorites.map((fav) => (
                      <button
                          key={fav.id}
                          onClick={() => handleNoteClick(fav.name)}
                          className="flex flex-col items-center gap-2 shrink-0 group"
                      >
                          <div className="relative w-[76px] h-[76px]">
                              <div className="w-full h-full rounded-[24px] overflow-hidden border border-white/10 group-active:scale-95 transition-transform bg-white/5">
                                  {fav.image
                                      ? <img src={fav.image} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" alt={fav.name} />
                                      : <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-white/40">{(fav.name[0] || '?').toUpperCase()}</div>
                                  }
                              </div>
                              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-[3px] border-black" />
                          </div>
                          <span className="text-xs text-white/60 font-medium group-hover:text-white transition-colors">{fav.name}</span>
                      </button>
                  ))
              )}

              <button
                  onClick={openCompose}
                  className="flex flex-col items-center gap-2 shrink-0 group"
              >
                  <div className="w-[76px] h-[76px] rounded-[24px] border border-white/10 flex items-center justify-center bg-white/5 group-hover:bg-white/10 group-active:scale-95 transition-all">
                      <Plus size={32} className="text-white/30 group-hover:text-white transition-colors" />
                  </div>
                  <span className="text-xs text-white/30 font-medium group-hover:text-white transition-colors">New</span>
              </button>
          </div>
      )}

      {/* Tabs (Only in Inbox) */}
      {viewMode === 'inbox' && (
        <div className="px-6 mb-4 shrink-0 border-b border-white/5">
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" size={16} />
                <input
                    value={directSearch}
                    onChange={e => setDirectSearch(e.target.value)}
                    placeholder="Search Directs..."
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.06] py-2.5 pl-10 pr-9 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.09]"
                />
                {directSearch && (
                    <button
                        onClick={() => setDirectSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setActiveTab('Primary')}
                    className={`flex-1 pb-3 text-sm font-semibold transition-colors relative ${activeTab === 'Primary' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                >
                    Primary
                    {activeTab === 'Primary' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full mx-8"></div>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('General')}
                    className={`flex-1 pb-3 text-sm font-semibold transition-colors relative ${activeTab === 'General' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                >
                    General
                    {activeTab === 'General' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full mx-8"></div>
                    )}
                </button>
                <button 
                    onClick={() => setActiveTab('Requests')}
                    className={`flex-1 pb-3 text-sm font-semibold transition-colors relative ${activeTab === 'Requests' ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                >
                    Requests
                    {activeTab === 'Requests' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full mx-8"></div>
                    )}
                </button>
            </div>
        </div>
      )}

      {/* Info Banner for Deleted View */}
      {viewMode === 'deleted' && (
          <div className="px-6 mb-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-3">
                  <InfoIcon />
                  <p className="text-xs text-red-200/80 leading-relaxed">
                      Directs are permanently deleted after 30 days. Swipe left on an item in Inbox to delete.
                  </p>
              </div>
          </div>
      )}
      
      {/* Info Banner for Hidden View */}
      {viewMode === 'hidden' && (
          <div className="px-6 mb-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-start gap-3">
                  <Lock size={16} className="text-emerald-400 mt-0.5" />
                  <p className="text-xs text-emerald-200/80 leading-relaxed">
                      Hidden Directs are secured. They will not appear in search or notifications.
                  </p>
              </div>
          </div>
      )}

      {/* Direct List */}
      <div className="flex flex-col flex-1 min-h-[300px]">
          <AnimatePresence mode="popLayout">
              {getDisplayChats().length > 0 ? (
                  getDisplayChats().map((chat) => (
                    <SwipeableChatRow
                        key={chat.id}
                        chat={chat}
                        onSelect={openChat}
                        onHide={hideChat}
                        onDelete={deleteChat}
                        onRestore={restoreChat}
                        onOpenProfile={setDrawerContact}
                        viewMode={viewMode}
                    />
                ))
              ) : (
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-48 text-white/30 gap-3"
                >
                    {viewMode === 'inbox' && <Ghost size={32} />}
                    {viewMode === 'hidden' && <Lock size={32} />}
                    {viewMode === 'deleted' && <Trash2 size={32} />}
                    <span className="text-sm">
                        {viewMode === 'inbox' && activeTab === 'Requests' && 'No message requests'}
                        {viewMode === 'inbox' && activeTab === 'General' && 'No other Directs'}
                        {viewMode === 'inbox' && activeTab === 'Primary' && 'No active Directs'}
                        {viewMode === 'hidden' && 'No hidden Directs'}
                        {viewMode === 'deleted' && 'No recently deleted Directs'}
                    </span>
                </motion.div>
              )}
          </AnimatePresence>
      </div>

      <ContactDrawer
          contact={drawerContact}
          onClose={() => setDrawerContact(null)}
          onOpenChat={(_chatId, chat) => { openChat(chat); setDrawerContact(null); }}
      />
    </div>
  );
};

// Helper for banner
const InfoIcon = () => (
    <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

export default GalleryWidget;
