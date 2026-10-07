import React, { useState, Suspense, lazy } from 'react';
import { Sparkles, Book, HardDrive, Layout, ChevronRight, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Lazy-loaded sub-modules
const ReflectionsTab = lazy(() => import('./ReflectionsTab'));
const MnemosyneTab = lazy(() => import('./MnemosyneTab'));
const FileIntelligenceApp = lazy(() => import('./FileIntelligence/FileIntelligenceApp'));

const LazyFallback = () => (
  <div className="flex-1 h-full flex flex-col items-center justify-center text-zinc-700 text-xs uppercase tracking-[0.3em] animate-pulse">
    <div className="w-12 h-12 border-2 border-fuchsia-500/20 border-t-fuchsia-500 rounded-full animate-spin mb-4" />
    Synchronizing Neural Data...
  </div>
);

/**
 * KnowledgeHub — THE FORGE (v4.5)
 * Central Command for Reflections, Research, and Raw Storage
 */
const KnowledgeHub = () => {
  const [hubTab, setHubTab] = useState('reflections');

  const tabs = [
    { id: 'reflections', label: 'Reflections', icon: Sparkles, desc: 'Fluid Brainstorming Laboratory', color: 'purple' },
    { id: 'vault', label: 'Research Vault', icon: Book, desc: 'Static Medical Research Archive', color: 'cyan' },
    { id: 'raw', label: 'Raw Storage', icon: HardDrive, desc: 'Deep File Intelligence & Indexing', color: 'blue' },
  ];

  return (
    <div className="flex h-full w-full bg-[#050506] overflow-hidden rounded-2xl border border-white/5 shadow-2xl">
      {/* Internal Sidebar */}
      <div className="w-72 border-r border-white/5 bg-[#09090b]/50 backdrop-blur-xl flex flex-col p-6">
        <div className="mb-8">
          <h2 className="text-xl font-black text-white tracking-tighter italic flex items-center">
            <Zap className="w-5 h-5 mr-2 text-fuchsia-500 animate-pulse" /> THE FORGE
          </h2>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Omega Intelligence Hub</p>
        </div>

        <nav className="flex-1 space-y-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setHubTab(tab.id)}
              className={`w-full flex flex-col items-start p-4 rounded-xl transition-all border group ${
                hubTab === tab.id 
                ? 'bg-white/5 border-white/10 shadow-lg' 
                : 'border-transparent hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3 mb-1">
                <tab.icon className={`w-4 h-4 ${hubTab === tab.id ? `text-${tab.color}-400` : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                <span className={`text-sm font-bold tracking-tight ${hubTab === tab.id ? 'text-white' : 'text-zinc-400'}`}>{tab.label}</span>
              </div>
              <p className="text-[10px] text-zinc-600 font-medium leading-tight">{tab.desc}</p>
            </button>
          ))}
        </nav>

        <div className="mt-auto p-4 bg-fuchsia-500/5 border border-fuchsia-500/10 rounded-xl">
           <p className="text-[9px] text-fuchsia-400/60 font-bold uppercase tracking-widest leading-relaxed">
             "Knowledge is the currency of Sovereignty."
           </p>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative flex flex-col overflow-hidden">
        <Suspense fallback={<LazyFallback />}>
          <AnimatePresence mode="wait">
            <motion.div
              key={hubTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="flex-1 h-full"
            >
              {hubTab === 'reflections' && <ReflectionsTab />}
              {hubTab === 'vault' && <MnemosyneTab />}
              {hubTab === 'raw' && <FileIntelligenceApp />}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </div>
    </div>
  );
};

export default KnowledgeHub;
