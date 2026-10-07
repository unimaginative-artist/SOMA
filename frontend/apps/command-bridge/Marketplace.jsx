import React, { useState } from 'react';
import {
  Search, Download, CheckCircle, Box, Cpu,
  Globe, MessageCircle, Github, Terminal, Shield,
  Brain, TrendingUp, BookOpen, Filter, Star, X,
  DollarSign, Trash2, AlertTriangle, HardDrive, Package
} from 'lucide-react';
import { MARKETPLACE_DATA } from './data/marketplaceData';
import { toast } from 'react-toastify';
import AutoScrollText from './components/ui/AutoScrollText';

const IconMap = {
  'cpu': Cpu,
  'brain-circuit': Brain,
  'search': Globe,
  'github': Github,
  'message-circle': MessageCircle,
  'book-open': BookOpen,
  'trending-up': TrendingUp,
  'box': Box,
  'terminal': Terminal,
  'shield': Shield,
  'hard-drive': HardDrive
};

const Marketplace = () => {
  const [searchTerm, setSearchInput] = useState('');
  const [filter, setFilter] = useState('all');
  const [installing, setInstalling] = useState(null);
  const [uninstalling, setUninstalling] = useState(null);
  const [items, setItems] = useState(MARKETPLACE_DATA);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const handleCardClick = (item) => {
    setSelectedItem(item);
    setShowModal(true);
  };

  const handleInstall = (item) => {
    setInstalling(item.id);

    // Simulate install process
    setTimeout(() => {
        setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, installed: true } : i
        ));
        setInstalling(null);
        toast.success(`${item.name} installed successfully to ${item.installPath}`);
        setShowModal(false);
    }, 2000);
  };

  const handleUninstall = (item) => {
    if (!item.canUninstall) {
      toast.error('This module cannot be uninstalled as it is essential to SOMA');
      return;
    }

    setUninstalling(item.id);

    setTimeout(() => {
        setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, installed: false } : i
        ));
        setUninstalling(null);
        toast.info(`${item.name} has been uninstalled`);
        setShowModal(false);
    }, 1500);
  };

  const filteredItems = items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            item.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filter === 'all' || item.type === filter;
      return matchesSearch && matchesFilter;
  });

  const categories = ['all', 'agent', 'tool', 'bundle', 'environment'];

  return (
    <div className="h-full flex flex-col bg-[#09090b] text-zinc-200 font-sans p-6">
      {/* Header */}
      <div className="flex flex-col mb-8">
        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
            Neural Exchange
        </h2>
        <p className="text-zinc-500 text-sm max-w-2xl">
            Expand the cognitive swarm. Install new agents, capability tools, and environment sandboxes.
            All modules are vetted by the SOMA core.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
                type="text"
                placeholder="Search modules..."
                value={searchTerm}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full bg-[#151518] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all"
            />
        </div>

        <div className="flex bg-[#151518] p-1 rounded-lg border border-white/5">
            {categories.map(cat => (
                <button
                    key={cat}
                    onClick={() => setFilter(cat)}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                        filter === cat
                        ? 'bg-emerald-500/20 text-emerald-400 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                    }`}
                >
                    {cat}
                </button>
            ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto custom-scrollbar pr-2 pb-10">
        {filteredItems.map(item => {
            const Icon = IconMap[item.icon] || Package;

            return (
                <div
                    key={item.id}
                    onClick={() => handleCardClick(item)}
                    className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 hover:border-emerald-500/30 hover:bg-[#151518] transition-all group flex flex-col h-full relative overflow-hidden cursor-pointer"
                    title={item.description}
                >
                    {/* Background Glow */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/10 transition-all" />

                    <div className="flex justify-between items-start mb-4 relative z-10">
                        <div className={`p-3 rounded-xl ${item.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'} border border-white/5`}>
                            <Icon className="w-6 h-6" />
                        </div>
                        {item.installed ? (
                            <span className="flex items-center text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                                <CheckCircle className="w-3 h-3 mr-1" /> INSTALLED
                            </span>
                        ) : (
                            <span className="flex items-center text-[10px] font-bold text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full border border-white/5">
                                v{item.version}
                            </span>
                        )}
                    </div>

                    <div className="flex-1 relative z-10">
                        <h3 className="text-zinc-100 font-bold mb-1 group-hover:text-emerald-400 transition-colors">{item.name}</h3>

                        {/* Auto-format: clamp to two lines; slow-scroll on hover */}
                        <AutoScrollText text={item.description} lines={2} durationSec={12} />
                    </div>

                    <div className="mt-auto relative z-10 pt-4 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">{item.category}</span>

                        <div className="text-[10px] font-bold text-emerald-400/50">
                            {item.size}
                        </div>
                    </div>
                </div>
            );
        })}
      </div>

      {/* Modal */}
      {showModal && selectedItem && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200"
             onClick={() => setShowModal(false)}>
          <div className="bg-[#0d0d0e] border border-emerald-500/20 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar"
               onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="p-6 border-b border-white/10 flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <div className={`p-4 rounded-xl ${selectedItem.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-400'} border border-white/10`}>
                  {React.createElement(IconMap[selectedItem.icon] || Package, { className: "w-8 h-8" })}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">{selectedItem.name}</h2>
                  <div className="flex items-center space-x-3 text-xs text-zinc-500">
                    <span>v{selectedItem.version}</span>
                    <span>•</span>
                    <span>by {selectedItem.author}</span>
                    <span>•</span>
                    <span className="text-emerald-400">{selectedItem.size}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Status Badge */}
              {selectedItem.installed && (
                <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-400">Currently Installed</span>
                </div>
              )}

              {/* Description */}
              <div>
                <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-2">Description</h3>
                <p className="text-zinc-300 text-sm leading-relaxed">
                  {selectedItem.fullDescription || selectedItem.description}
                </p>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#151518] border border-white/5 rounded-lg p-4">
                  <div className="text-xs text-zinc-500 mb-1">Type</div>
                  <div className="text-sm font-bold text-white uppercase">{selectedItem.type}</div>
                </div>
                <div className="bg-[#151518] border border-white/5 rounded-lg p-4">
                  <div className="text-xs text-zinc-500 mb-1">Category</div>
                  <div className="text-sm font-bold text-white">{selectedItem.category}</div>
                </div>
              </div>

              {/* Installation Path */}
              <div className="bg-[#151518] border border-white/5 rounded-lg p-4">
                <div className="text-xs text-zinc-500 mb-2">Installation Path</div>
                <code className="text-sm text-emerald-400 font-mono">
                  SOMA/{selectedItem.installPath}
                </code>
              </div>

              {/* Dependencies */}
              {selectedItem.dependencies && selectedItem.dependencies.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-2">Dependencies</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedItem.dependencies.map(dep => (
                      <span key={dep} className="px-3 py-1 bg-zinc-800 border border-white/10 rounded-full text-xs text-zinc-300">
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Warning for system modules */}
              {!selectedItem.canUninstall && selectedItem.installed && (
                <div className="flex items-start space-x-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-bold text-yellow-400 mb-1">System Module</div>
                    <div className="text-xs text-yellow-400/80">
                      This is a core module and cannot be uninstalled.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-white/10 flex items-center justify-between">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Close
              </button>

              <div className="flex space-x-3">
                {selectedItem.installed ? (
                  selectedItem.canUninstall && (
                    <button
                      onClick={() => handleUninstall(selectedItem)}
                      disabled={uninstalling === selectedItem.id}
                      className="flex items-center px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 hover:border-red-500/50 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
                    >
                      {uninstalling === selectedItem.id ? (
                        <span className="animate-pulse">Uninstalling...</span>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" /> Uninstall
                        </>
                      )}
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleInstall(selectedItem)}
                    disabled={installing === selectedItem.id}
                    className="flex items-center px-6 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
                  >
                    {installing === selectedItem.id ? (
                      <span className="animate-pulse">Installing...</span>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" /> Install Module
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Marketplace;
