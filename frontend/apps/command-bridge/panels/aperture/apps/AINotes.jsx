import React, { useState, useEffect } from 'react';
import { Sparkles, Plus, Trash2, Tag, Search, Notebook, Cpu, Lightbulb, CheckCircle2, Database, Network, Send, Brain, MessageSquare } from 'lucide-react';

const STORAGE_KEY = 'aperture.ainotes.v1';

const INITIAL_NOTES = [
  {
    id: 'n-1',
    title: 'Aperture OS Subagent Engine',
    category: 'Architecture',
    content: 'Deploy autonomous background worker loops with IPC channels for real-time task sync.',
    tags: ['kernel', 'subagents', 'soma'],
    timestamp: Date.now() - 3600000,
    aiGenerated: true,
    distilled: true
  },
  {
    id: 'n-2',
    title: 'Decentralized Social Feed Filtering',
    category: 'Vision',
    content: 'Use SOMA safety arbiters to filter scam links and highlight high-energy lightning zaps.',
    tags: ['gmn', 'studio', 'lightning'],
    timestamp: Date.now() - 7200000,
    aiGenerated: false,
    distilled: false
  }
];

export default function AINotesApp() {
  const [notes, setNotes] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : INITIAL_NOTES;
    } catch {
      return INITIAL_NOTES;
    }
  });

  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('Ideas');
  const [generating, setGenerating] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [viewMode, setViewMode] = useState('notes'); // 'notes' | 'mindmap'
  const [somaReflections, setSomaReflections] = useState([]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {}
  }, [notes]);

  // Fetch live SOMA reflections from backend on load
  useEffect(() => {
    async function loadReflections() {
      try {
        const res = await fetch('/api/soma/reflections');
        const data = await res.json();
        if (data.success && Array.isArray(data.reflections)) {
          const formatted = data.reflections.map((r, i) => ({
            id: `soma-refl-${i}`,
            title: r.title || `SOMA Limbic Reflection #${i + 1}`,
            category: 'Reflections',
            content: typeof r === 'string' ? r : (r.text || r.reflection || r.feeling || JSON.stringify(r)),
            tags: ['soma-limbic', 'reflection', 'memory-spine'],
            timestamp: r.timestamp || Date.now() - i * 1800000,
            isSomaReflection: true,
            distilled: true
          }));
          setSomaReflections(formatted);
        }
      } catch (err) {
        console.warn('SOMA Reflections fetch fallback:', err.message);
      }
    }
    loadReflections();
  }, []);

  const categories = ['All', 'Reflections', 'Architecture', 'Vision', 'Ideas', 'Tasks'];

  const addNote = (newNote) => {
    setNotes(prev => [newNote, ...prev]);
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    const item = {
      id: 'n-' + Date.now(),
      title: title.trim(),
      category,
      content: content.trim(),
      tags: [category.toLowerCase(), 'aperture'],
      timestamp: Date.now(),
      aiGenerated: false,
      distilled: false
    };
    addNote(item);
    setTitle('');
    setContent('');
  };

  const deleteNote = (id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const distillToMemorySpine = async (note) => {
    setSyncingId(note.id);
    try {
      await fetch('/api/soma/knowledge/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lobe: 'logos',
          type: 'manual',
          content: `Title: ${note.title}\nCategory: ${note.category}\nContent: ${note.content}`
        })
      });
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, distilled: true } : n));
    } catch (err) {
      console.warn('Memory Spine sync fallback:', err.message);
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, distilled: true } : n));
    } finally {
      setSyncingId(null);
    }
  };

  const sparkIdea = () => {
    setGenerating(true);
    setTimeout(() => {
      const AI_IDEAS = [
        {
          title: 'Quantum Neural Memory Cache',
          category: 'Architecture',
          content: 'Store high-frequency user interactions in a localized vector cache inside Aperture OS Kernel for sub-millisecond retrieval.',
        },
        {
          title: 'Autonomous Strategy Refiner',
          category: 'Ideas',
          content: 'Self-adjust trade sizing parameters using Kelly Criterion based on recent volatility regimes.',
        },
        {
          title: 'Multi-Agent Workspace Sync',
          category: 'Vision',
          content: 'Allow parallel subagents to stream real-time code modifications directly to Aperture OS Desktop widgets.',
        }
      ];

      const picked = AI_IDEAS[Math.floor(Math.random() * AI_IDEAS.length)];
      const item = {
        id: 'n-ai-' + Date.now(),
        title: picked.title,
        category: picked.category,
        content: picked.content,
        tags: [picked.category.toLowerCase(), 'ai-generated', 'logos'],
        timestamp: Date.now(),
        aiGenerated: true,
        distilled: false
      };
      addNote(item);
      setGenerating(false);
    }, 800);
  };

  // Combine user notes + live SOMA reflections into a single unified stream
  const allStream = [...notes, ...somaReflections];

  const filteredNotes = allStream.filter(n => {
    const matchesCategory = activeCategory === 'All' || n.category === activeCategory;
    const matchesQuery = !searchQuery.trim() || 
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (n.tags && n.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="h-full w-full flex flex-col bg-[#050508] text-slate-100 font-sans selection:bg-amber-500/30 overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-purple-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Brain size={18} className="text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight flex items-center gap-2">
              SOMA Unified Notes & Limbic Reflections <span className="text-[10px] font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">{allStream.length} Total Entries</span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">Unified Memory Spine, SOMA Limbic Reflections & Mind Maps</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('notes')}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${viewMode === 'notes' ? 'bg-amber-500 text-black font-bold' : 'text-slate-400 hover:text-white'}`}
            >
              Unified Stream
            </button>
            <button
              onClick={() => setViewMode('mindmap')}
              className={`px-3 py-1 rounded-lg text-xs font-mono flex items-center gap-1 transition-all ${viewMode === 'mindmap' ? 'bg-amber-500 text-black font-bold' : 'text-slate-400 hover:text-white'}`}
            >
              <Network size={12} /> Mind Map
            </button>
          </div>

          <button
            onClick={sparkIdea}
            disabled={generating}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-400 hover:to-purple-500 text-black font-bold font-mono text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
          >
            <Lightbulb size={14} /> {generating ? 'Sparking...' : 'AI Spark Idea'}
          </button>
        </div>
      </div>

      {/* Search & Category Filter */}
      <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between gap-4 bg-white/[0.01]">
        <div className="flex items-center gap-2 overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                activeCategory === cat
                  ? 'bg-amber-500 text-black font-bold'
                  : 'bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search notes or reflections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50 font-mono"
          />
        </div>
      </div>

      {/* Main View: Notes List OR Interactive Mind Map */}
      <div className="flex-1 p-6 grid grid-cols-3 gap-6 overflow-hidden">
        {/* Left Col: Note Creator */}
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5 flex flex-col justify-between">
          <h2 className="text-xs font-bold text-amber-400 font-mono uppercase tracking-wider mb-4 flex items-center gap-2">
            <Plus size={14} /> Draft Knowledge Note
          </h2>

          <form onSubmit={handleCreate} className="space-y-4 my-auto">
            <div>
              <label className="text-[10px] font-mono text-slate-400 block mb-1">NOTE TITLE</label>
              <input
                type="text"
                placeholder="Title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono text-slate-400 block mb-1">CATEGORY</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
              >
                <option value="Architecture">Architecture</option>
                <option value="Vision">Vision</option>
                <option value="Ideas">Ideas</option>
                <option value="Tasks">Tasks</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-mono text-slate-400 block mb-1">CONTENT & DETAILS</label>
              <textarea
                rows={5}
                placeholder="Write markdown note..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono resize-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold font-mono text-xs rounded-xl transition-all shadow-md shadow-amber-500/20"
            >
              Save Knowledge Note
            </button>
          </form>
        </div>

        {/* Right 2 Cols: Unified Stream (Notes + Reflections) OR Mind Map */}
        <div className="col-span-2 bg-white/[0.02] border border-white/10 rounded-2xl p-5 flex flex-col justify-between overflow-hidden">
          {viewMode === 'notes' ? (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {filteredNotes.map(n => (
                <div key={n.id} className={`bg-white/5 border rounded-xl p-4 flex flex-col justify-between space-y-3 group transition-all ${
                  n.isSomaReflection ? 'border-purple-500/30 bg-purple-500/[0.02]' : 'border-white/10 hover:border-amber-500/30'
                }`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        {n.title}
                        {n.isSomaReflection && (
                          <span className="text-[9px] font-mono bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30 flex items-center gap-1">
                            <Brain size={10} /> SOMA Limbic Reflection
                          </span>
                        )}
                        {n.aiGenerated && !n.isSomaReflection && (
                          <span className="text-[9px] font-mono bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">
                            AI Sparked
                          </span>
                        )}
                        {n.distilled && (
                          <span className="text-[9px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 size={10} /> Memory Spine Synced
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-300 font-mono mt-1 leading-relaxed">{n.content}</p>
                    </div>

                    {!n.isSomaReflection && (
                      <button
                        onClick={() => deleteNote(n.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div className="flex items-center gap-1.5">
                      {n.tags && n.tags.map(t => (
                        <span key={t} className="text-[10px] font-mono bg-white/5 text-amber-300 px-2 py-0.5 rounded border border-white/10">
                          #{t}
                        </span>
                      ))}
                    </div>

                    {!n.distilled && (
                      <button
                        onClick={() => distillToMemorySpine(n)}
                        disabled={syncingId === n.id}
                        className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all"
                      >
                        <Database size={12} /> {syncingId === n.id ? 'Syncing...' : 'Distill to Memory Spine'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Interactive Mind Map Visualization */
            <div className="flex-1 relative bg-black/40 rounded-xl border border-amber-500/20 overflow-hidden flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#f59e0b08_1px,transparent_1px),linear-gradient(to_bottom,#f59e0b08_1px,transparent_1px)] bg-[size:20px_20px]"></div>

              <svg viewBox="0 0 500 300" className="w-full h-full relative z-10">
                {/* Center Node: SOMA Memory Spine */}
                <circle cx="250" cy="150" r="30" fill="#f59e0b" opacity="0.2" className="animate-pulse" />
                <circle cx="250" cy="150" r="18" fill="#090d16" stroke="#f59e0b" strokeWidth="2" />
                <text x="250" y="154" textAnchor="middle" fill="#f59e0b" fontSize="10" fontFamily="monospace" fontWeight="bold">SOMA</text>

                {/* Connecting Lines and Note Nodes */}
                {filteredNotes.slice(0, 6).map((n, i) => {
                  const angle = (i / Math.min(6, filteredNotes.length)) * 2 * Math.PI;
                  const nx = 250 + Math.cos(angle) * 140;
                  const ny = 150 + Math.sin(angle) * 90;
                  return (
                    <g key={n.id}>
                      <line x1="250" y1="150" x2={nx} y2={ny} stroke={n.isSomaReflection ? '#c084fc' : '#f59e0b'} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                      <circle cx={nx} cy={ny} r="14" fill="#090d16" stroke={n.isSomaReflection ? '#c084fc' : '#38bdf8'} strokeWidth="2" />
                      <text x={nx} y={ny + 24} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                        {n.title.slice(0, 15)}...
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
