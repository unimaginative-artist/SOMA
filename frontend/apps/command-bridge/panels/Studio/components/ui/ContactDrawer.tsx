import * as React from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown, MessageCircle, Star, UserMinus, UserPlus, Wifi, X } from 'lucide-react';
import { startDirect } from '../../services/directsService';

export interface DrawerContact {
    id: string;
    name: string;
    image: string;
    online: boolean;
    chatId?: string;
    handle?: string;
}

interface Props {
    contact: DrawerContact | null;
    onClose: () => void;
    onOpenChat?: (chatId: string, chat: any) => void;
}

const ContactDrawer: React.FC<Props> = ({ contact, onClose, onOpenChat }) => {
    const [isFriend, setIsFriend]     = useState(false);
    const [isInTop8, setIsInTop8]     = useState(false);
    const [top8Ids, setTop8Ids]       = useState<string[]>([]);
    const [recentMsg, setRecentMsg]   = useState('');
    const [loaded, setLoaded]         = useState(false);
    const [actioning, setActioning]   = useState<string | null>(null);

    useEffect(() => {
        if (!contact) return;
        setLoaded(false);
        Promise.all([
            fetch('/api/studio/axis').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/api/studio/top8').then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([axisData, top8Data]) => {
            const friends  = axisData?.axis?.friends  || [];
            const messages = axisData?.axis?.messages || {};

            setIsFriend(friends.some((f: any) => f.id === contact.id));

            const ids: string[] = top8Data?.top8Ids || [];
            setTop8Ids(ids);
            setIsInTop8(ids.includes(contact.id));

            const chatMsgs = messages[contact.id] || messages[contact.chatId || ''] || [];
            setRecentMsg(chatMsgs[chatMsgs.length - 1]?.text || '');
            setLoaded(true);
        });
    }, [contact?.id]);

    const handleMessage = async () => {
        if (!contact) return;
        try {
            const direct = await startDirect({ id: contact.id, name: contact.name, image: contact.image });
            if (onOpenChat) onOpenChat(direct.id, direct);
            else window.dispatchEvent(new CustomEvent('studio:open-direct', { detail: { chat: direct } }));
        } catch {
            const chat = { id: contact.chatId || contact.id, title: contact.name, image: contact.image, online: contact.online, members: '', messagesCount: '' };
            if (onOpenChat) onOpenChat(contact.chatId || contact.id, chat);
            else window.dispatchEvent(new CustomEvent('studio:open-direct', { detail: { chat } }));
        }
        onClose();
    };

    const toggleTop8 = async () => {
        if (!contact) return;
        setActioning('top8');
        const newIds = isInTop8
            ? top8Ids.filter(id => id !== contact.id)
            : [...top8Ids, contact.id].slice(0, 8);
        try {
            const res = await fetch('/api/studio/top8', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: newIds }),
            });
            if (res.ok) { setTop8Ids(newIds); setIsInTop8(!isInTop8); }
        } catch {}
        setActioning(null);
    };

    const toggleFriend = async () => {
        if (!contact) return;
        setActioning('friend');
        if (isFriend) {
            try {
                await fetch(`/api/studio/axis/friends/${contact.id}`, { method: 'DELETE' });
                setIsFriend(false);
            } catch {}
        } else {
            try {
                await fetch('/api/studio/axis/friends', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: contact.id, username: contact.name, avatar: contact.image, online: contact.online }),
                });
                setIsFriend(true);
            } catch {}
        }
        setActioning(null);
    };

    const handle = contact
        ? (contact.handle || `@${contact.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)
        : '';

    return createPortal(
        <AnimatePresence>
            {contact && (
                <div className="fixed inset-0 z-[300] flex justify-end">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                        className="relative w-72 bg-[#0c0c0e] border-l border-white/8 flex flex-col overflow-hidden shadow-2xl"
                    >
                        {/* Cover / avatar hero */}
                        <div className="relative h-36 shrink-0 overflow-hidden">
                            <img
                                src={contact.image}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-30"
                            />
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0c0c0e]" />
                            <button
                                onClick={onClose}
                                className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors z-10"
                            >
                                <X size={13} />
                            </button>
                        </div>

                        {/* Avatar */}
                        <div className="relative px-5 -mt-10 shrink-0 flex items-end gap-3">
                            <div className="relative shrink-0">
                                <div className="w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-[#0c0c0e] shadow-xl">
                                    <img src={contact.image} alt={contact.name} className="w-full h-full object-cover" />
                                </div>
                                {contact.online && (
                                    <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#0c0c0e] shadow" />
                                )}
                            </div>
                            <div className="pb-1 min-w-0">
                                <div className="text-base font-bold text-white truncate leading-tight">{contact.name}</div>
                                <div className="text-[11px] font-mono text-white/30 truncate">{handle}</div>
                            </div>
                        </div>

                        {/* Status pills */}
                        <div className="px-5 mt-3 flex flex-wrap gap-1.5 shrink-0">
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${contact.online ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
                                <Wifi size={9} /> {contact.online ? 'Online' : 'Offline'}
                            </span>
                            {loaded && isInTop8 && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-400">
                                    <Crown size={9} /> Top 8
                                </span>
                            )}
                            {loaded && isFriend && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/15 text-indigo-400">
                                    <Star size={9} /> Friend
                                </span>
                            )}
                        </div>

                        {/* Recent message */}
                        {recentMsg && (
                            <div className="mx-5 mt-4 shrink-0">
                                <div className="text-[9px] font-bold uppercase tracking-widest text-white/20 mb-1.5">Last message</div>
                                <div className="bg-white/[0.04] border border-white/5 rounded-xl px-3 py-2.5">
                                    <p className="text-[12px] text-white/60 leading-relaxed line-clamp-3">"{recentMsg}"</p>
                                </div>
                            </div>
                        )}

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Actions */}
                        <div className="px-5 py-5 flex flex-col gap-2.5 border-t border-white/5 shrink-0">
                            {/* Message — always primary */}
                            <button
                                onClick={handleMessage}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-bold transition-colors"
                            >
                                <MessageCircle size={15} /> Message
                            </button>

                            {/* Top 8 toggle */}
                            <button
                                onClick={toggleTop8}
                                disabled={actioning === 'top8' || !loaded}
                                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${
                                    isInTop8
                                        ? 'bg-orange-500/15 border border-orange-500/30 text-orange-400 hover:bg-orange-500/25'
                                        : 'border border-white/10 text-white/50 hover:text-white hover:border-white/20'
                                }`}
                            >
                                <Crown size={14} />
                                {actioning === 'top8' ? 'Saving…' : isInTop8 ? 'Remove from Top 8' : 'Add to Top 8'}
                            </button>

                            {/* Friend toggle */}
                            <button
                                onClick={toggleFriend}
                                disabled={actioning === 'friend' || !loaded}
                                className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-50 ${
                                    isFriend
                                        ? 'text-red-400/70 hover:text-red-400 hover:bg-red-500/10'
                                        : 'text-indigo-400 hover:bg-indigo-500/10'
                                }`}
                            >
                                {isFriend
                                    ? <><UserMinus size={13} />{actioning === 'friend' ? 'Removing…' : 'Remove friend'}</>
                                    : <><UserPlus size={13} />{actioning === 'friend' ? 'Adding…' : 'Add as friend'}</>
                                }
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
};

export default ContactDrawer;
