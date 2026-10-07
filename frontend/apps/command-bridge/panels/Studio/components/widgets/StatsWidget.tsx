import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { WidgetData } from '../../types';
import { Crown, GripVertical, Plus, Save, Wifi, WifiOff, X } from 'lucide-react';
import ContactDrawer, { DrawerContact } from '../ui/ContactDrawer';

interface Friend {
    id: string;
    name: string;
    img: string;
    online: boolean;
}

interface Props {
    data: WidgetData;
}

const RANK_COLORS = [
    'bg-orange-500 text-black',   // #1
    'bg-zinc-300 text-black',     // #2
    'bg-amber-700 text-white',    // #3
    'bg-white/10 text-white/60',  // #4–8
];

const StatsWidget: React.FC<Props> = ({ data }) => {
    const gridRef = useRef<HTMLDivElement>(null);
    const [gridSize, setGridSize] = useState({ width: 240, height: 320 });
    const [allFriends, setAllFriends] = useState<Friend[]>([]);
    const [top8, setTop8] = useState<Friend[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [pendingTop8, setPendingTop8] = useState<Friend[]>([]);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [drawerContact, setDrawerContact] = useState<DrawerContact | null>(null);

    useEffect(() => {
        if (!gridRef.current) return;
        const node = gridRef.current;
        const update = () => {
            const r = node.getBoundingClientRect();
            setGridSize({ width: Math.max(0, r.width), height: Math.max(0, r.height) });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const normalize = (f: any, i: number): Friend => ({
        id: String(f.id ?? i),
        name: f.username || f.handle || f.name || `Contact ${i + 1}`,
        img: f.avatar || f.image || `https://picsum.photos/seed/${f.id ?? i}/200/200`,
        online: Boolean(f.online),
    });

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            fetch('/api/studio/axis').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/api/studio/top8').then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([axisData, top8Data]) => {
            if (cancelled) return;
            const friends: Friend[] = Array.isArray(axisData?.axis?.friends)
                ? axisData.axis.friends.map(normalize)
                : [];
            setAllFriends(friends);

            const ids: string[] = Array.isArray(top8Data?.top8Ids) && top8Data.top8Ids.length
                ? top8Data.top8Ids
                : friends.slice(0, 8).map((f: Friend) => f.id);

            const byId = new Map(friends.map((f: Friend) => [f.id, f]));
            const ordered = ids.map(id => byId.get(id)).filter(Boolean) as Friend[];
            if (ordered.length < 8) {
                const used = new Set(ids);
                for (const f of friends) {
                    if (ordered.length >= 8) break;
                    if (!used.has(f.id)) { ordered.push(f); used.add(f.id); }
                }
            }
            setTop8(ordered.slice(0, 8));
            setLoaded(true);
        });
        return () => { cancelled = true; };
    }, []);

    const tile = useMemo(() => {
        const cols = 4;
        const rows = 2;
        const gap = 8;
        const labelH = 14;
        const w = Math.floor((gridSize.width - gap * (cols - 1)) / cols);
        const h = Math.floor((gridSize.height - gap * (rows - 1)) / rows) - labelH - 4;
        return { cols, rows, gap, labelH, w: Math.max(40, w), h: Math.max(52, h) };
    }, [gridSize]);

    const openModal = () => {
        setPendingTop8([...top8]);
        setShowModal(true);
    };

    const poolFriends = useMemo(() => {
        const usedIds = new Set(pendingTop8.map(f => f.id));
        return allFriends.filter(f => !usedIds.has(f.id));
    }, [allFriends, pendingTop8]);

    const addToTop8 = (friend: Friend) => {
        if (pendingTop8.length >= 8) return;
        setPendingTop8(prev => [...prev, friend]);
    };

    const removeFromTop8 = (id: string) => {
        setPendingTop8(prev => prev.filter(f => f.id !== id));
    };

    const saveTop8 = useCallback(async () => {
        setSaving(true);
        setSaveError(false);
        try {
            const res = await fetch('/api/studio/top8', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: pendingTop8.map(f => f.id) }),
            });
            if (res.ok) {
                setTop8([...pendingTop8]);
                setShowModal(false);
            } else {
                setSaveError(true);
            }
        } catch {
            setSaveError(true);
        }
        setSaving(false);
    }, [pendingTop8]);

    const rankClass = (i: number) => RANK_COLORS[Math.min(i, 3)];

    return (
        <div className="w-full h-full flex flex-col p-3 bg-[#0A0A0A] relative overflow-hidden">
            {/* Grid texture */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between mb-3 shrink-0 z-10">
                <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                    <Crown size={12} className="text-orange-500 fill-orange-500" /> Elite 8
                </h3>
                <button
                    onClick={openModal}
                    className="text-[9px] font-mono text-white/25 hover:text-orange-400 uppercase tracking-widest transition-colors flex items-center gap-1"
                >
                    Edit
                </button>
            </div>

            {/* Friends grid */}
            <div
                ref={gridRef}
                className="z-10 flex-1 grid min-h-0 overflow-hidden"
                style={{
                    gridTemplateColumns: `repeat(${tile.cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${tile.rows}, minmax(0, 1fr))`,
                    gap: `${tile.gap}px`,
                    alignContent: 'stretch',
                }}
            >
                {loaded ? (
                    top8.map((friend, i) => (
                        <div
                            key={friend.id}
                            className="flex min-h-0 min-w-0 flex-col items-center group/card cursor-pointer"
                            style={{ gap: 4 }}
                            onClick={() => setDrawerContact({ id: friend.id, name: friend.name, image: friend.img, online: friend.online, chatId: friend.id })}
                        >
                            <div
                                className="relative w-full min-h-0 flex-1 rounded-xl overflow-hidden border border-white/8 group-hover/card:border-orange-500/40 transition-all duration-300"
                                style={{ maxHeight: tile.h }}
                            >
                                <img
                                    src={friend.img}
                                    alt={friend.name}
                                    className="w-full h-full object-cover grayscale opacity-75 group-hover/card:grayscale-0 group-hover/card:opacity-100 group-hover/card:scale-105 transition-all duration-500"
                                />
                                {/* Rank badge */}
                                <div className={`absolute top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-md flex items-center justify-center text-[9px] font-black ${rankClass(i)}`}>
                                    {i + 1}
                                </div>
                                {/* Online dot */}
                                {friend.online && (
                                    <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-400 border border-black shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                                )}
                            </div>
                            <span
                                className="text-[9px] font-medium text-white/40 group-hover/card:text-white/80 truncate block w-full text-center transition-colors"
                                style={{ minHeight: tile.labelH, lineHeight: `${tile.labelH}px` }}
                            >
                                {friend.name}
                            </span>
                        </div>
                    ))
                ) : (
                    Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex min-h-0 min-w-0 flex-col items-center" style={{ gap: 4 }}>
                            <div
                                className="w-full min-h-0 flex-1 rounded-xl bg-white/[0.04] border border-dashed border-white/8 animate-pulse"
                                style={{ maxHeight: tile.h }}
                            />
                            <div className="h-3 w-10 rounded bg-white/5 animate-pulse" />
                        </div>
                    ))
                )}
            </div>

            {/* Edit Modal — portalled to body so it escapes widget stacking contexts */}
            <ContactDrawer contact={drawerContact} onClose={() => setDrawerContact(null)} />

            {createPortal(
                <AnimatePresence>
                {showModal && <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                            onClick={() => setShowModal(false)}
                        />
                        <motion.div
                            initial={{ scale: 0.96, opacity: 0, y: 12 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.96, opacity: 0, y: 12 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            className="relative w-full max-w-xl bg-[#0d0d0f] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                            style={{ maxHeight: '80vh' }}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
                                <div>
                                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                                        <Crown size={14} className="text-orange-500 fill-orange-500" /> Edit Elite 8
                                    </h2>
                                    <p className="text-[11px] text-white/30 mt-0.5">
                                        {pendingTop8.length}/8 selected · drag to reorder
                                    </p>
                                </div>
                                <button onClick={() => setShowModal(false)} className="text-white/30 hover:text-white transition-colors p-1">
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Two-column body */}
                            <div className="flex flex-1 min-h-0 divide-x divide-white/5">

                                {/* Left — current Elite 8 (draggable) */}
                                <div className="flex flex-col w-1/2 min-h-0">
                                    <div className="px-4 py-2.5 shrink-0">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Your Elite 8</span>
                                    </div>
                                    <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-3" style={{ scrollbarWidth: 'none' }}>
                                        {pendingTop8.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-24 gap-2 text-white/20">
                                                <Plus size={20} />
                                                <span className="text-xs">Add from contacts →</span>
                                            </div>
                                        ) : (
                                            <Reorder.Group
                                                axis="y"
                                                values={pendingTop8}
                                                onReorder={setPendingTop8}
                                                className="flex flex-col gap-1"
                                            >
                                                {pendingTop8.map((friend, i) => (
                                                    <Reorder.Item
                                                        key={friend.id}
                                                        value={friend}
                                                        className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 cursor-grab active:cursor-grabbing group/item select-none"
                                                        whileDrag={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.06)', zIndex: 50 }}
                                                    >
                                                        <GripVertical size={14} className="text-white/20 group-hover/item:text-white/40 shrink-0 transition-colors" />
                                                        <div className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black ${rankClass(i)}`}>
                                                            {i + 1}
                                                        </div>
                                                        <img src={friend.img} alt={friend.name} className="w-7 h-7 rounded-lg object-cover shrink-0" />
                                                        <span className="flex-1 text-[13px] font-medium text-white/80 truncate">{friend.name}</span>
                                                        {friend.online && <Wifi size={10} className="text-emerald-400 shrink-0" />}
                                                        <button
                                                            onClick={() => removeFromTop8(friend.id)}
                                                            className="shrink-0 text-white/20 hover:text-red-400 transition-colors p-0.5"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </Reorder.Item>
                                                ))}
                                            </Reorder.Group>
                                        )}
                                    </div>
                                </div>

                                {/* Right — contact pool */}
                                <div className="flex flex-col w-1/2 min-h-0">
                                    <div className="px-4 py-2.5 shrink-0">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">
                                            Contacts {poolFriends.length > 0 ? `· ${poolFriends.length}` : ''}
                                        </span>
                                    </div>
                                    <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-3" style={{ scrollbarWidth: 'none' }}>
                                        {poolFriends.length === 0 ? (
                                            <div className="flex items-center justify-center h-24 text-white/20 text-xs">
                                                {allFriends.length === 0 ? 'No contacts yet' : 'All contacts selected'}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-1">
                                                {poolFriends.map(friend => (
                                                    <button
                                                        key={friend.id}
                                                        onClick={() => addToTop8(friend)}
                                                        disabled={pendingTop8.length >= 8}
                                                        className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/[0.05] transition-colors text-left group/pool disabled:opacity-40 disabled:pointer-events-none w-full"
                                                    >
                                                        <img src={friend.img} alt={friend.name} className="w-7 h-7 rounded-lg object-cover shrink-0" />
                                                        <span className="flex-1 text-[13px] font-medium text-white/60 group-hover/pool:text-white truncate transition-colors">
                                                            {friend.name}
                                                        </span>
                                                        {friend.online && <WifiOff size={10} className="text-emerald-400 opacity-0 group-hover/pool:opacity-100 transition-opacity shrink-0" />}
                                                        <Plus size={12} className="text-white/20 group-hover/pool:text-orange-400 transition-colors shrink-0" />
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-5 py-4 border-t border-white/5 shrink-0 flex gap-3">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 py-2.5 rounded-xl border border-white/8 text-sm text-white/40 hover:text-white hover:border-white/15 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={saveTop8}
                                    disabled={saving}
                                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${saveError ? 'bg-red-500 hover:bg-red-400 text-white' : 'bg-orange-500 hover:bg-orange-400 text-black'}`}
                                >
                                    <Save size={14} />
                                    {saving ? 'Saving…' : saveError ? 'Failed — restart server' : 'Save Elite 8'}
                                </button>
                            </div>
                        </motion.div>
                    </div>}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
};

export default StatsWidget;
