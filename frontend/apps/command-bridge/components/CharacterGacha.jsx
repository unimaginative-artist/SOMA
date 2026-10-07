import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Save, Trash2, X, Zap, Star, ChevronLeft, Users } from 'lucide-react';
import PixelAvatar from './PixelAvatar';

const RARITY_COLORS = {
  common:    { bg: 'bg-zinc-800/60',    border: 'border-zinc-600/30',    text: 'text-zinc-400',    glow: '' },
  uncommon:  { bg: 'bg-emerald-900/30', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.15)]' },
  rare:      { bg: 'bg-blue-900/30',    border: 'border-blue-500/30',    text: 'text-blue-400',    glow: 'shadow-[0_0_12px_rgba(59,130,246,0.2)]' },
  epic:      { bg: 'bg-purple-900/30',  border: 'border-purple-500/40',  text: 'text-purple-400',  glow: 'shadow-[0_0_16px_rgba(168,85,247,0.25)]' },
  legendary: { bg: 'bg-amber-900/30',   border: 'border-amber-500/40',   text: 'text-amber-400',   glow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]' },
};

const CharacterCardMini = ({ character, onSave, onRemove, onActivate, saved = false }) => {
  const r = RARITY_COLORS[character.rarity] || RARITY_COLORS.common;

  return (
    <div className={`${r.bg} ${r.glow} border ${r.border} rounded-xl p-4 transition-all hover:scale-[1.02] hover:border-white/20`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg overflow-hidden bg-black/40 p-1 border border-white/5">
          <PixelAvatar
            seed={character.avatarSeed || character.id}
            colors={character.avatarColors}
            creatureType={character.creatureType !== 'humanoid' ? character.creatureType : null}
            size={56}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-zinc-100 text-sm font-semibold truncate">{character.name}</span>
            <span className={`text-[9px] ${r.text} uppercase tracking-widest font-bold`}>{character.rarity}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-zinc-500">{character.domain?.emoji} {character.domain?.label}</span>
            {character.creatureType && character.creatureType !== 'humanoid' && (
              <span className="text-[9px] text-zinc-600 uppercase">{character.creatureType}</span>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 mt-1.5 line-clamp-2 leading-relaxed">{character.backstory}</p>
        </div>
      </div>

      {/* Personality bars */}
      <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-1">
        {Object.entries(character.personality || {}).slice(0, 8).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1">
            <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${val * 100}%`, background: character.colorScheme?.primary || '#3b82f6' }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {!saved && onSave && (
          <button onClick={() => onSave(character)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-500/30 transition-colors">
            <Save className="w-3 h-3" /> Collect
          </button>
        )}
        {saved && onActivate && (
          <button onClick={() => onActivate(character)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold uppercase tracking-wider hover:bg-cyan-500/30 transition-colors">
            <Zap className="w-3 h-3" /> Activate
          </button>
        )}
        {saved && onRemove && (
          <button onClick={() => onRemove(character.id)} className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};

const CharacterGacha = ({ isOpen, onClose }) => {
  const [view, setView] = useState('draw'); // 'draw' | 'collection'
  const [drawn, setDrawn] = useState(null);
  const [collection, setCollection] = useState([]);
  const [stats, setStats] = useState({});
  const [drawing, setDrawing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const showError = (msg) => { setError(msg); setTimeout(() => setError(''), 5000); };

  const fetchCollection = useCallback(async () => {
    try {
      const res = await fetch('/api/characters/collection');
      if (!res.ok) { showError(`Collection fetch failed (${res.status})`); return; }
      const data = await res.json();
      if (data.success) { setCollection(data.collection); setStats(data.stats); }
      else showError(data.error || 'Failed to load collection');
    } catch (e) { showError(`Collection unavailable: ${e.message}`); }
  }, []);

  useEffect(() => { if (isOpen) fetchCollection(); }, [isOpen, fetchCollection]);

  const handleDraw = async () => {
    setDrawing(true);
    setFlash(true);
    setError('');
    setTimeout(() => setFlash(false), 600);
    try {
      const res = await fetch('/api/characters/draw', { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showError(errData.error || `Draw failed (${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.success) setDrawn(data.character);
      else showError(data.error || 'Draw returned no character');
    } catch (e) { showError(`Draw failed: ${e.message}`); } finally { setDrawing(false); }
  };

  const handleSave = async (character) => {
    try {
      const res = await fetch('/api/characters/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character })
      });
      if (!res.ok) { showError(`Save failed (${res.status})`); return; }
      const data = await res.json();
      if (data.success) {
        setMessage(`${character.shortName} added to collection!`);
        setTimeout(() => setMessage(''), 3000);
        fetchCollection();
        setDrawn(null);
      } else {
        setMessage(data.error || 'Failed to save');
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (e) { showError(`Save failed: ${e.message}`); }
  };

  const handleRemove = async (id) => {
    try {
      const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
      if (!res.ok) showError(`Remove failed (${res.status})`);
      fetchCollection();
    } catch (e) { showError(`Remove failed: ${e.message}`); }
  };

  const handleActivate = async (character) => {
    try {
      const res = await fetch('/api/characters/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: character.id })
      });
      if (!res.ok) { showError(`Activate failed (${res.status})`); return; }
      const data = await res.json();
      setMessage(data.message || `Activated ${character.shortName}`);
      setTimeout(() => setMessage(''), 4000);
    } catch (e) { showError(`Activate failed: ${e.message}`); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {/* Flash effect on draw */}
      {flash && <div className="absolute inset-0 bg-white/10 animate-ping pointer-events-none z-[70]" />}

      <div className="relative w-full max-w-3xl max-h-[85vh] bg-[#0a0a0c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-zinc-100 font-bold text-sm tracking-wide">Character Lab</h2>
            <div className="flex gap-1 ml-4">
              <button onClick={() => setView('draw')} className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${view === 'draw' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <Star className="w-3 h-3 inline mr-1" />Draw
              </button>
              <button onClick={() => setView('collection')} className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${view === 'collection' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <Users className="w-3 h-3 inline mr-1" />Collection ({collection.length})
              </button>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message toast */}
        {message && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono animate-bounce">
            {message}
          </div>
        )}
        {error && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-mono">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {view === 'draw' && (
            <div className="flex flex-col items-center gap-6">
              <p className="text-zinc-500 text-[11px] text-center max-w-md">
                Draw a random AI character with unique personality, backstory, and pixel avatar.
                Collect the ones you like and activate them to channel their personality through SOMA.
              </p>

              <button
                onClick={handleDraw}
                disabled={drawing}
                className="group relative px-8 py-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-purple-500/20 border border-amber-500/30 text-amber-300 font-bold text-sm uppercase tracking-widest hover:from-amber-500/30 hover:to-purple-500/30 transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
              >
                <Sparkles className="w-4 h-4 inline mr-2" />
                {drawing ? 'Drawing...' : 'Draw Character'}
              </button>

              {drawn && (
                <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4">
                  <CharacterCardMini character={drawn} onSave={handleSave} />
                </div>
              )}

              {/* Rarity guide */}
              <div className="flex gap-3 mt-4">
                {Object.entries(RARITY_COLORS).map(([name, r]) => (
                  <span key={name} className={`text-[8px] ${r.text} uppercase tracking-widest`}>{name}</span>
                ))}
              </div>
            </div>
          )}

          {view === 'collection' && (
            <div>
              {/* Stats bar */}
              {stats.total > 0 && (
                <div className="flex gap-4 mb-4 text-[10px] text-zinc-500 font-mono">
                  <span>{stats.total} collected</span>
                  <span>{stats.domains} domains</span>
                  {stats.rarities?.legendary > 0 && <span className="text-amber-400">{stats.rarities.legendary} legendary</span>}
                  {stats.rarities?.epic > 0 && <span className="text-purple-400">{stats.rarities.epic} epic</span>}
                  {stats.mostActivated && <span>Favorite: {stats.mostActivated}</span>}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {collection.map(c => (
                  <CharacterCardMini key={c.id} character={c} saved onRemove={handleRemove} onActivate={handleActivate} />
                ))}
                {collection.length === 0 && (
                  <div className="col-span-2 text-center text-zinc-600 text-xs py-12">
                    No characters collected yet. Draw some from the Draw tab!
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CharacterGacha;
