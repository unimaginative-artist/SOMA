import React, { useState, useEffect } from 'react';
import { 
  Book, Search, Plus, Send, FileText, ChevronRight, 
  Hash, Tag, Filter, Download, Trash2, Edit3, X, FolderPlus, Loader
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * MnemosyneTab — PROJECT MNEMOSYNE + ALEXANDRIA
 * v0.2 — Research Library with Folder Linking
 */
const MnemosyneTab = () => {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isQuickNoteOpen, setIsQuickNoteOpen] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState('');
  const [isIndexing, setIsIndexing] = useState(false);

  // Fetch vault entries
  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await fetch('/api/archive/list');
        const data = await res.json();
        if (data.success) {
            // Mapping names to notes structure
            setNotes(data.files.map(f => ({ name: f })));
        }
      } catch (e) { console.error('Failed to fetch notes', e); }
    };
    fetchNotes();
  }, []);

  const handleLinkFolder = async () => {
    const path = prompt("Enter the absolute path to the research folder:");
    if (!path) return;

    setIsIndexing(true);
    try {
      const res = await fetch('/api/archive/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Alexandria is now indexing: ${path}`);
      }
    } catch (e) { console.error('Linking failed', e); }
    setIsIndexing(false);
  };

  const handleSaveQuickNote = async () => {
    if (!quickNoteText.trim()) return;
    try {
      const res = await fetch('/api/reflections/quick-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: quickNoteText })
      });
      if (res.ok) {
        setQuickNoteText('');
        setIsQuickNoteOpen(false);
      }
    } catch (e) { console.error('Failed to save quick note', e); }
  };

  return (
    <div className="flex h-full w-full bg-[#0a0a0c] text-zinc-300 font-sans overflow-hidden rounded-xl border border-white/5">
      {/* Sidebar: Vault Explorer */}
      <div className="w-80 border-r border-white/5 bg-[#0d0d0f] flex flex-col">
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center">
              <Book className="w-5 h-5 mr-2 text-purple-400" /> Research
            </h2>
            <div className="flex gap-2">
                <button 
                  onClick={handleLinkFolder}
                  title="Link Local Folder"
                  className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-all border border-cyan-500/20"
                >
                  {isIndexing ? <Loader className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                </button>
                <button 
                  onClick={() => setIsQuickNoteOpen(true)}
                  className="p-2 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-all"
                >
                  <Plus className="w-4 h-4" />
                </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2 pl-10 pr-4 text-xs focus:ring-1 focus:ring-purple-500/50 outline-none transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {notes.filter(n => n.name.toLowerCase().includes(searchQuery.toLowerCase())).map(note => (
            <div
              key={note.name}
              onClick={() => setSelectedNote(note)}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                selectedNote?.name === note.name
                ? 'bg-purple-500/10 border-purple-500/30 text-white'
                : 'border-transparent hover:bg-white/5 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4" />
                <span className="text-xs font-medium truncate">{note.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Area: Preview & Chat */}
      <div className="flex-1 flex flex-col relative">
        {selectedNote ? (
          <div className="flex-1 p-10 overflow-y-auto prose prose-invert prose-purple max-w-none">
             <h1 className="text-3xl font-bold text-white mb-6 tracking-tighter">{selectedNote.name}</h1>
             <p className="text-zinc-500 italic text-sm mb-10">Archived Node: {selectedNote.name}</p>
             <div className="bg-white/5 p-8 rounded-2xl border border-white/5 backdrop-blur-md">
                <p className="text-zinc-400 font-mono text-xs mb-4 uppercase tracking-widest">DECRYPTING RESEARCH STREAM...</p>
                <div className="h-40 flex items-center justify-center">
                   <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
             </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
            <div className="relative mb-6">
               <Book className="w-16 h-12 opacity-10" />
               <motion.div
                 animate={{ opacity: [0.1, 0.3, 0.1] }}
                 transition={{ duration: 4, repeat: Infinity }}
                 className="absolute inset-0 bg-purple-500 blur-3xl rounded-full -z-10"
               />
            </div>
            <p className="text-sm font-mono tracking-widest uppercase opacity-40">Library Hub Active</p>
          </div>
        )}

        {/* Vault Chat Area */}
        <div className="h-72 border-t border-white/5 p-8 bg-black/60 backdrop-blur-3xl">
           <div className="max-w-4xl mx-auto h-full flex flex-col">
              <div className="flex-1 overflow-y-auto mb-6">
                 <div className="flex items-center gap-3 mb-2">
                    <div className="w-1 h-1 bg-purple-500 rounded-full animate-pulse" />
                    <p className="text-[10px] text-purple-400 font-bold uppercase tracking-[0.3em]">Research Oracle</p>
                 </div>
                 <p className="text-sm text-zinc-400 leading-relaxed">
                    I am ready to reason across your research. Any linked folders are semantically indexed into my memory.
                 </p>
              </div>
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-1000"></div>
                <div className="relative bg-[#151518] border border-white/10 rounded-2xl flex items-center pr-2">
                  <input
                    type="text"
                    placeholder="Query the indexed research..."
                    className="w-full bg-transparent py-4 px-6 text-sm text-white outline-none placeholder:text-zinc-600"
                  />
                  <button className="p-3 bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 rounded-xl transition-all">
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
           </div>
        </div>
      </div>

      {/* Quick Note Popout (Integrated) */}
      <AnimatePresence>
        {isQuickNoteOpen && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed top-0 right-0 h-full w-96 bg-[#0d0d0f]/95 backdrop-blur-3xl border-l border-white/10 shadow-2xl z-[100] flex flex-col" 
          >
            <div className="p-8 flex items-center justify-between border-b border-white/5">
              <h3 className="text-lg font-bold text-white flex items-center tracking-tight">
                <Edit3 className="w-5 h-5 mr-3 text-purple-400" /> New Entry
              </h3>
              <button
                onClick={() => setIsQuickNoteOpen(false)}
                className="p-2 hover:bg-white/5 rounded-full text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-8 flex flex-col">
              <p className="text-xs text-zinc-500 mb-4 font-mono uppercase tracking-widest">Append to Research Archive</p>
              <textarea 
                autoFocus
                value={quickNoteText}
                onChange={(e) => setQuickNoteText(e.target.value)}
                placeholder="Type something important..."
                className="flex-1 bg-white/5 border border-white/5 rounded-2xl p-6 text-sm text-white outline-none focus:border-purple-500/50 transition-all resize-none leading-relaxed"
              />
              <button
                onClick={handleSaveQuickNote}
                className="w-full mt-6 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl font-bold text-sm transition-all shadow-xl shadow-purple-500/20 active:scale-[0.98]"
              >
                Sync to Archive
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MnemosyneTab;
