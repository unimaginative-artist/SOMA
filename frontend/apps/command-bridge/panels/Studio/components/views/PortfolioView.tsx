import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Grid,
  List,
  Plus,
  Search,
  Share2,
  Upload,
  X,
} from 'lucide-react';
import { PortfolioItem, UserProfile } from '../../types';
import { MOCK_PORTFOLIO } from '../../constants';

interface Props {
  currentUser: UserProfile;
  onBack: () => void;
  onPortfolioChange?: (items: PortfolioItem[]) => void;
}

const PortfolioView: React.FC<Props> = ({ currentUser, onBack, onPortfolioChange }) => {
  const [items, setItems] = useState<PortfolioItem[]>(() => {
    const saved = (currentUser as any)?.studio?.portfolio;
    return Array.isArray(saved) && saved.length ? saved : MOCK_PORTFOLIO;
  });
  const [selectedItem, setSelectedItem] = useState<PortfolioItem | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [imageDir, setImageDir] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [queueStatus, setQueueStatus] = useState('');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<'recent' | 'title' | 'category'>('recent');
  const [viewMode, setViewMode] = useState<'gallery' | 'index'>('gallery');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(items.map(item => item.category || 'Uncategorized')))],
    [items],
  );

  const categoryCounts = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      const key = item.category || 'Uncategorized';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(item => {
        const inCategory = activeCategory === 'All' || item.category === activeCategory;
        const searchable = `${item.title} ${item.category} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
        return inCategory && (!q || searchable.includes(q));
      })
      .sort((a, b) => {
        if (sortMode === 'title') return a.title.localeCompare(b.title);
        if (sortMode === 'category') return `${a.category}${a.title}`.localeCompare(`${b.category}${b.title}`);
        return String(b.year || '').localeCompare(String(a.year || ''));
      });
  }, [items, activeCategory, query, sortMode]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/studio/featured')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Featured work unavailable')))
      .then(data => {
        if (cancelled || !data?.ok) return;
        if (Array.isArray(data.items) && data.items.length) {
          setItems(data.items);
          onPortfolioChange?.(data.items);
        }
        if (data.imageDir) setImageDir(data.imageDir);
      })
      .catch(() => {
        if (!cancelled) setUploadStatus('Featured Work is local-only until the backend is online.');
      });
    return () => { cancelled = true; };
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('Importing into SOMA social image library...');
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('title', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
      form.append('category', 'SOMA Social Images');
      form.append('description', `Featured work imported through Studio for SOMA social posting: ${file.name}`);
      form.append('tags', 'studio, featured-work, social-image');

      const response = await fetch('/api/studio/featured/upload', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Upload failed');

      const next = Array.isArray(data.profile?.studio?.portfolio)
        ? data.profile.studio.portfolio
        : [data.item, ...items].filter(Boolean);
      setItems(next);
      onPortfolioChange?.(next);
      if (data.imageDir) setImageDir(data.imageDir);
      if (data.item) setSelectedItem(data.item);
      setUploadStatus('Added to Featured Work and SOMA/social-media/images.');
    } catch (error: any) {
      setUploadStatus(`Backend import failed. Kept a local preview only: ${error?.message || 'unknown error'}`);
      const reader = new FileReader();
      reader.onloadend = () => {
        const newItem: PortfolioItem = {
          id: `new-${Date.now()}`,
          title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
          category: 'Uncategorized',
          description: 'Recently uploaded work.',
          year: new Date().getFullYear().toString(),
          image: reader.result as string,
          tags: ['Upload'],
          stats: { views: 0, likes: 0 },
        };
        const next = [newItem, ...items];
        setItems(next);
        onPortfolioChange?.(next);
        setSelectedItem(newItem);
      };
      reader.readAsDataURL(file);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const queueSocialPost = async (item: PortfolioItem) => {
    const caption = window.prompt('Caption for SOMA social queue', item.description || item.title);
    if (!caption?.trim()) return;
    try {
      const response = await fetch('/api/social/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'bluesky',
          text: caption.trim(),
          type: 'studio_featured_work',
          images: (item as any).socialPath ? [{ path: (item as any).socialPath, alt: item.description || item.title }] : [],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'queue failed');
      setQueueStatus(`${item.title} queued for SOMA social.`);
    } catch (error: any) {
      setQueueStatus(`Queue failed: ${error?.message || 'unknown error'}`);
    }
  };

  const copyCaption = async (item: PortfolioItem) => {
    const caption = `${item.title}${item.year ? `, ${item.year}` : ''}\n\n${item.description || ''}\n\n${(item.tags || [])
      .slice(0, 5)
      .map(tag => `#${String(tag).replace(/^#/, '').replace(/\s+/g, '')}`)
      .join(' ')}`.trim();
    await navigator.clipboard.writeText(caption).catch(() => {});
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId(null), 1400);
  };

  const DetailOverlay = ({ item, onClose }: { item: PortfolioItem; onClose: () => void }) => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <button
        onClick={onClose}
        className="fixed right-5 top-5 z-50 rounded-full bg-black/60 p-2 text-white backdrop-blur-md transition-all hover:bg-white hover:text-black"
        title="Close"
      >
        <X size={20} />
      </button>

      <div className="grid max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#090806] shadow-2xl md:grid-cols-[minmax(0,1.25fr)_340px]">
        <div className="relative flex min-h-[320px] items-center justify-center bg-black md:min-h-[620px]">
          <img src={item.image} className="max-h-[88vh] w-full object-contain" alt={item.title} />
        </div>

        <div className="flex min-h-0 flex-col border-l border-white/10 p-6">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-white/40">
              <span>{item.category}</span>
              <span className="h-1 w-1 rounded-full bg-white/40" />
              <span>{item.year}</span>
            </div>
            <h1 className="font-display text-2xl font-bold leading-tight text-white">{item.title}</h1>
            <p className="mt-4 text-sm leading-6 text-white/62">{item.description}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {(item.tags || []).map(tag => (
                <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-5">
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <span className="text-lg font-bold text-white">{item.stats?.likes ?? 0}</span>
                <span className="text-xs uppercase tracking-wider text-white/40">Likes</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-white">{item.stats?.views ?? 0}</span>
                <span className="text-xs uppercase tracking-wider text-white/40">Views</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => queueSocialPost(item)} className="rounded-full bg-cyan-400/15 p-3 text-cyan-100 transition-all hover:bg-cyan-400/25" title="Queue for SOMA social">
                <Share2 size={18} />
              </button>
              <button onClick={() => copyCaption(item)} className="rounded-full bg-white/5 p-3 text-white transition-all hover:bg-white hover:text-black" title="Copy social caption">
                {copiedId === item.id ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <a href={item.image} target="_blank" rel="noreferrer" className="rounded-full bg-white p-3 text-black shadow-lg shadow-white/10 transition-transform hover:scale-105" title="Open full image">
                <Download size={18} />
              </a>
            </div>
          </div>

          <div className="mt-5 border-t border-white/5 pt-5">
            <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-white/30">Studio Record</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <span className="block text-[10px] uppercase tracking-widest text-white/30">Series</span>
                <span className="mt-1 block text-white/70">{item.category || 'Uncategorized'}</span>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <span className="block text-[10px] uppercase tracking-widest text-white/30">Tags</span>
                <span className="mt-1 block text-white/70">{item.tags?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0f] font-sans text-[#f4f7fb] md:flex-row">
      <AnimatePresence>
        {selectedItem && <DetailOverlay item={selectedItem} onClose={() => setSelectedItem(null)} />}
      </AnimatePresence>

      <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-[#0e0e15]/95 p-6 backdrop-blur-xl md:sticky md:top-0 md:flex">
        <div className="mb-6">
          <button onClick={onBack} className="mb-6 flex items-center gap-2 text-white/50 transition-colors hover:text-white">
            <ArrowLeft size={16} /> Back
          </button>
          <p className="text-[10px] uppercase tracking-[0.34em] text-white/35">Studio Portfolio</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">{currentUser.name}</h1>
          <p className="mt-2 text-xs leading-relaxed text-white/42">Art library and social-ready image source.</p>
          {imageDir && (
            <p className="mt-3 break-words font-mono text-[10px] leading-relaxed text-emerald-300/70">
              Social path: {imageDir}
            </p>
          )}
        </div>

        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.035] p-2">
          <div className="flex items-center gap-2 px-2 py-2">
            <Search size={14} className="text-white/35" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search work..."
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
            />
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto pr-1">
          <p className="mb-2 px-1 text-[10px] uppercase tracking-[0.28em] text-white/30">Series</p>
          <div className="flex flex-col gap-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-all ${
                  activeCategory === cat ? 'bg-gradient-to-r from-cyan-400 to-fuchsia-500 font-bold text-black' : 'text-white/50 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{cat}</span>
                <span className={activeCategory === cat ? 'text-black/45' : 'text-white/25'}>
                  {cat === 'All' ? items.length : categoryCounts[cat] || 0}
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="mt-5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setViewMode('gallery')} className={`rounded-lg border px-3 py-2 text-xs font-bold transition-all ${viewMode === 'gallery' ? 'border-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-black' : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white'}`}>
              <Grid size={14} className="mr-1 inline" /> Gallery
            </button>
            <button onClick={() => setViewMode('index')} className={`rounded-lg border px-3 py-2 text-xs font-bold transition-all ${viewMode === 'index' ? 'border-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-black' : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white'}`}>
              <List size={14} className="mr-1 inline" /> Index
            </button>
          </div>
          <select value={sortMode} onChange={e => setSortMode(e.target.value as any)} className="w-full rounded-lg border border-white/10 bg-[#14141d] px-3 py-2 text-xs font-bold text-white/65 outline-none">
            <option value="recent">Sort by year</option>
            <option value="title">Sort by title</option>
            <option value="category">Sort by series</option>
          </select>
          <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-500 py-2.5 text-sm font-black text-black transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            <Upload size={16} /> {isUploading ? 'Importing...' : 'Add Featured Image'}
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleUpload} />
          {uploadStatus && <p className="text-xs leading-relaxed text-white/40">{uploadStatus}</p>}
          {queueStatus && <p className="text-xs leading-relaxed text-cyan-200/70">{queueStatus}</p>}
        </div>
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-[#0e0e15]/90 px-4 py-4 backdrop-blur-md md:hidden">
        <button onClick={onBack} className="-ml-2 p-2 text-white/70">
          <ArrowLeft size={24} />
        </button>
        <span className="font-display text-lg font-bold">Portfolio</span>
        <button onClick={() => fileInputRef.current?.click()} className="p-2 text-white/70 hover:text-white">
          <Plus size={24} />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 py-4 md:hidden">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-bold transition-colors ${
              activeCategory === cat ? 'border-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-black' : 'border-white/10 bg-transparent text-white/60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <main className="flex-1 p-4 md:h-screen md:overflow-y-auto md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">{activeCategory}</p>
            <h2 className="text-xl font-black">{filteredItems.length} work{filteredItems.length === 1 ? '' : 's'}</h2>
          </div>
          <div className="hidden text-right text-xs text-white/35 md:block">
            SOMA social image source
          </div>
        </div>

        {viewMode === 'index' ? (
          <div className="mb-20 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
            {filteredItems.map((item, index) => (
              <button key={item.id} onClick={() => setSelectedItem(item)} className="grid w-full grid-cols-[42px_minmax(0,1fr)_80px] items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/[0.04] last:border-b-0 md:grid-cols-[56px_minmax(0,1fr)_140px_90px]">
                <span className="font-mono text-xs text-white/25">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white/85">{item.title}</span>
                  <span className="block truncate text-xs text-white/35">{item.description}</span>
                </span>
                <span className="hidden truncate text-xs text-white/45 md:block">{item.category}</span>
                <span className="text-right text-xs text-white/35">{item.year}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="gap-4 pb-20 columns-2 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
              {filteredItems.map((item, index) => {
                // Varied pin heights are what make masonry read as Pinterest.
                // Even uniform source images get cropped to staggered ratios.
                const ratios = ['3 / 4', '1 / 1', '4 / 5', '2 / 3', '3 / 5', '5 / 4', '9 / 16'];
                const ratio = ratios[(item.id ? item.id.length + index : index) % ratios.length];
                return (
                  <div key={item.id} className="group mb-4 break-inside-avoid">
                    <button
                      onClick={() => setSelectedItem(item)}
                      className="relative block w-full overflow-hidden rounded-2xl bg-[#15151c]"
                    >
                      <img src={item.image} style={{ aspectRatio: ratio }} className="w-full object-cover" alt={item.title} />

                      {/* hover dim */}
                      <div className="absolute inset-0 bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                      {/* signature red Save (top-right) */}
                      <span className="absolute right-3 top-3 rounded-full bg-[#e60023] px-4 py-2 text-sm font-bold text-white opacity-0 shadow-lg transition-all duration-200 group-hover:opacity-100">
                        Save
                      </span>

                      {/* quick actions (bottom-right) */}
                      <div className="absolute bottom-3 right-3 flex gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <span onClick={(e) => { e.stopPropagation(); queueSocialPost(item); }} className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80" title="Queue for SOMA social">
                          <Share2 size={15} />
                        </span>
                        <span onClick={(e) => { e.stopPropagation(); copyCaption(item); }} className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80" title="Copy caption">
                          {copiedId === item.id ? <Check size={15} /> : <Copy size={15} />}
                        </span>
                      </div>
                    </button>

                    {/* pin meta (below the image, Pinterest-style) */}
                    <div className="px-1 pt-2">
                      <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-white/90">{item.title}</h3>
                      <p className="mt-0.5 truncate text-[11px] text-white/40">{item.category}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </main>
    </div>
  );
};

export default PortfolioView;
