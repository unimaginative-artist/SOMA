import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Plus, Trash2, Clock, ChevronLeft, ChevronRight, Zap, Activity, Code, Cpu, Globe, Server, Shield, Ghost, Bot, Download, Edit3, X, CheckCircle } from 'lucide-react';
import Terminal from './components/Terminal';
import { SomaServiceBridge } from './services/SomaServiceBridge';
import { ApprovalQueue } from './components/ApprovalQueue';
import { AnimatedBrain } from './components/AnimatedBrain';
import { GoalJobCards } from './components/GoalJobCards';
import { useGoalJobs } from './hooks/useGoalJobs';
import { useSomaCtConnection } from './hooks/useSomaCtConnection';
import { ctConversations } from './services/CtConversationClient';
import { ConversationSidebar } from './components/ConversationSidebar';
import './styles/terminal.css';

const ConnectionPill = ({ label, state }) => {
  const online = state === 'online';
  const checking = state === 'checking' || state === 'connecting';
  return (
    <div className={`flex items-center space-x-1.5 rounded-full border px-2 py-1 ${online ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : checking ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'}`} title={`${label}: ${state}`}>
      <div className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : checking ? 'bg-amber-300 animate-pulse' : 'bg-rose-400'}`} />
      <span className="text-[9px] font-medium uppercase tracking-wide">{label}</span>
    </div>
  );
};

const Header = ({ isProcessing, connection }) => (
  <header className="w-full p-6 flex items-center justify-between relative z-10 select-none">
    <div className="flex items-center space-x-3">
      <AnimatedBrain isActive={isProcessing} showText={true} />
    </div>

    <div className="flex items-center space-x-3">
      <ConnectionPill label="Chat" state={connection.http} />
      <ConnectionPill label="Live" state={connection.realtime} />
      <ConnectionPill label="Approval" state={connection.approvals} />
    </div>
  </header>
);

const SOMA_EMOJIS = [
  '/emoji/111624-sappypleading.gif',
  '/emoji/1728-chickclap.gif',
  '/emoji/20177-ghost-cry.gif',
  '/emoji/2266-pepetwirl.gif',
  '/emoji/408583-dancing-penguin-goomy.gif',
  '/emoji/41920-catlick.gif',
  '/emoji/44406-mochabunnies.gif',
  '/emoji/49632-frogdance.gif',
  '/emoji/60811-foxnomapples.gif',
  '/emoji/713213-milk-mad.gif',
  '/emoji/767230-peach-dance.gif',
  '/emoji/84304-milklaughing.gif'
];

const getChatIcon = (conv) => {
  let icon = conv?.icon;
  // Migration: Convert old absolute URLs to relative paths
  if (icon && typeof icon === 'string' && icon.includes('localhost:3001/emoji/')) {
    icon = '/emoji/' + icon.split('/emoji/')[1];
  }
  if (icon) return icon;
  
  const id = conv?.id || 'default';
  const index = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % SOMA_EMOJIS.length;
  return SOMA_EMOJIS[index];
};

const IconPickerModal = ({ isOpen, onClose, onSelect, currentIcon }) => {
  const [customUrl, setCustomUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const searchEmojiGG = async () => {
    if (!searchQuery) return;
    try {
      // emoji.gg API search
      const res = await fetch(`https://emoji.gg/api/`);
      const allEmojis = await res.json();
      const filtered = allEmojis.filter(e => e.title.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 20);
      setSearchResults(filtered);
    } catch (e) {
      console.error("Search failed", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="ct-avatar-dialog-title" className="bg-[#151518] border border-white/10 rounded-3xl p-6 max-w-2xl w-full shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between mb-6">
          <h3 id="ct-avatar-dialog-title" className="text-xl font-bold text-white flex items-center gap-2">
            <Bot className="w-6 h-6 text-cyan-400" />
            Customize Chat Avatar
          </h3>
          <button onClick={onClose} aria-label="Close avatar picker" className="p-2 hover:bg-white/5 rounded-full text-zinc-500 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {/* Default SOMA Emojis */}
          <section className="mb-8">
            <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-4">SOMA Originals</h4>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-4">
              {SOMA_EMOJIS.map((emoji, i) => (
                <button
                  key={i}
                  onClick={() => onSelect(emoji)}
                  aria-label={`Use SOMA avatar ${i + 1}`}
                  className={`relative p-2 rounded-2xl border-2 transition-all duration-300 ${currentIcon === emoji ? 'border-cyan-500 bg-cyan-500/10' : 'border-transparent bg-white/5 hover:bg-white/10 hover:scale-105'}`}
                >
                  <img src={emoji} alt="emoji" className="w-full h-auto aspect-square object-contain" />
                  {currentIcon === emoji && <div className="absolute -top-1 -right-1 bg-cyan-500 rounded-full p-0.5"><CheckCircle className="w-3 h-3 text-white" /></div>}
                </button>
              ))}
            </div>
          </section>

          {/* emoji.gg Integration */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">Emoji.gg Library</h4>
              <a href="https://emoji.gg" target="_blank" rel="noreferrer" className="text-[10px] text-cyan-500 hover:underline flex items-center gap-1">
                Browse Website <Globe className="w-3 h-3" />
              </a>
            </div>
            
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                aria-label="Search Emoji.gg"
                placeholder="Search emoji.gg (e.g. 'coding', 'cat')..." 
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchEmojiGG()}
              />
              <button 
                onClick={searchEmojiGG}
                className="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-xl text-sm font-bold hover:bg-cyan-500/30 transition-colors border border-cyan-500/30"
              >
                Search
              </button>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 gap-4">
              {searchResults.map((emoji) => (
                <button
                  key={emoji.id}
                  onClick={() => onSelect(emoji.url)}
                  className="p-2 rounded-2xl border-2 border-transparent bg-white/5 hover:bg-white/10 hover:scale-105 transition-all"
                >
                  <img src={emoji.url} alt={emoji.title} className="w-full h-auto aspect-square object-contain" />
                </button>
              ))}
            </div>
          </section>

          {/* Custom URL */}
          <section>
            <h4 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-4">Custom URL</h4>
            <div className="flex gap-2">
              <input 
                type="text" 
                aria-label="Custom avatar URL"
                placeholder="Paste image/gif URL here..." 
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
              <button 
                onClick={() => onSelect(customUrl)}
                className="px-4 py-2 bg-white/10 text-white rounded-xl text-sm font-bold hover:bg-white/20 transition-colors"
              >
                Apply
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const SomaCT = () => {
  const somaService = useRef(null);

  // Conversation Management
  const [conversations, setConversations] = useState(() => {
    try {
      const stored = localStorage.getItem('soma_conversations');
      return stored ? JSON.parse(stored) : [];
    } catch {
      localStorage.removeItem('soma_conversations');
      return [];
    }
  });
  
  const [activeConversationId, setActiveConversationId] = useState(() => {
    return localStorage.getItem('soma_active_conversation');
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [isIconModalOpen, setIsIconModalOpen] = useState(false);
  const [iconTargetId, setIconTargetId] = useState(null);

  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState('~');
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const [inputValue, setInputValue] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [somaResponseText, setSomaResponseText] = useState('');
  const { jobs, ingestGoalEvent, cancel: cancelGoal, retry: retryGoal } = useGoalJobs();
  const handleTrace = useCallback((payload) => {
    if (!payload) return;
    const phase = payload.phase || 'trace';
    const tool = payload.tool ? ` ${payload.tool}` : '';
    const count = payload.count != null ? ` (${payload.count})` : '';
    const message = payload.preview ? ` — ${payload.preview}` : '';
    setHistory(previous => [...previous, { id: Date.now() + Math.random(), type: 'search', content: `[${phase}]${tool}${count}${message}` }]);
  }, []);
  const { socket, connection } = useSomaCtConnection({ onTrace: handleTrace, onGoalEvent: ingestGoalEvent });
  const isAgentConnected = connection.http === 'online';

  // Save conversation when history changes
  useEffect(() => {
    if (activeConversationId && history.length > 0) {
      saveCurrentConversation();
    }
  }, [history]);

  const saveCurrentConversation = () => {
    if (!activeConversationId) return;

    const updatedConversations = conversations.map(conv => {
      if (conv.id === activeConversationId) {
        return {
          ...conv,
          messages: history,
          updatedAt: Date.now(),
          title: conv.title || (history.length > 0 ? (typeof history[0].content === 'string' ? history[0].content.substring(0, 50) + '...' : 'New Chat') : 'New Chat')
        };
      }
      return conv;
    });

    // If conversation doesn't exist, create it
    if (!conversations.find(c => c.id === activeConversationId)) {
      const newConv = {
        id: activeConversationId,
        title: history.length > 0 ? (typeof history[0].content === 'string' ? history[0].content.substring(0, 50) + '...' : 'New Chat') : 'New Chat',
        messages: history,
        icon: SOMA_EMOJIS[Math.floor(Math.random() * SOMA_EMOJIS.length)],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      updatedConversations.push(newConv);
    }

    setConversations(updatedConversations);
    localStorage.setItem('soma_conversations', JSON.stringify(updatedConversations));
    const saved = updatedConversations.find(conv => conv.id === activeConversationId);
    if (saved) ctConversations.save(saved).catch(() => {});
  };

  const handleNewChat = (shouldSave = true) => {
    if (conversations.length >= 25) { // Increased limit
      alert('Conversation limit reached (Max 25). Please delete an old chat first.');
      return;
    }
    if (shouldSave && activeConversationId) {
      saveCurrentConversation();
    }
    const newId = 'conv_' + Date.now();
    setActiveConversationId(newId);
    setHistory([]);
    localStorage.setItem('soma_active_conversation', newId);
    if (somaService.current) {
      somaService.current.setConversationId(newId);
    }
    ctConversations.save({ id: newId, title: 'New Chat', messages: [] }).catch(() => {});
  };

  const handleSelectChat = (id) => {
    if (history.length > 0) {
      saveCurrentConversation();
    }

    const conv = conversations.find(c => c.id === id);
    if (conv) {
      setActiveConversationId(id);
      setHistory(conv.messages || []);
      localStorage.setItem('soma_active_conversation', id);
      if (somaService.current) {
        somaService.current.setConversationId(id);
        ctConversations.get(id)
          .then(serverConversation => setHistory(serverConversation.messages || []))
          .catch(() => somaService.current.loadBackendHistory(50).then(setHistory).catch(() => {}));
      }
    }
  };

  const handleUpdateIcon = (iconUrl) => {
    if (!iconTargetId) return;
    const updated = conversations.map(c => c.id === iconTargetId ? { ...c, icon: iconUrl } : c);
    setConversations(updated);
    localStorage.setItem('soma_conversations', JSON.stringify(updated));
    const saved = updated.find(conversation => conversation.id === iconTargetId);
    if (saved) ctConversations.save(saved).catch(() => {});
    setIsIconModalOpen(false);
    setIconTargetId(null);
  };

  // Export conversation as JSON or Markdown
  const handleExportChat = (format = 'json') => {
    if (!activeConversationId || history.length === 0) {
      alert('No conversation to export');
      return;
    }

    const conv = conversations.find(c => c.id === activeConversationId);
    const title = conv?.title || 'SOMA Conversation';
    const timestamp = new Date().toISOString().split('T')[0];
    
    let content, filename, mimeType;
    
    if (format === 'markdown') {
      // Convert to Markdown
      const lines = [
        `# ${title}`,
        `*Exported: ${new Date().toLocaleString()}*`,
        '',
        '---',
        ''
      ];
      
      history.forEach(item => {
        if (item.type === 'command') {
          lines.push(`**You:** ${typeof item.content === 'string' ? item.content : '[Complex input]'}`);
          lines.push('');
        } else if (item.type === 'response') {
          lines.push(`**SOMA:** ${item.content}`);
          lines.push('');
        } else if (item.type === 'error') {
          lines.push(`> ⚠️ Error: ${item.content}`);
          lines.push('');
        }
      });
      
      content = lines.join('\n');
      filename = `soma-chat-${timestamp}.md`;
      mimeType = 'text/markdown';
    } else {
      // JSON format
      const exportData = {
        title,
        exportedAt: new Date().toISOString(),
        conversationId: activeConversationId,
        messageCount: history.length,
        messages: history.map(item => ({
          type: item.type,
          content: typeof item.content === 'string' ? item.content : '[Complex content]',
          timestamp: item.timestamp || null
        }))
      };
      
      content = JSON.stringify(exportData, null, 2);
      filename = `soma-chat-${timestamp}.json`;
      mimeType = 'application/json';
    }
    
    // Download file
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteChat = (id, e) => {
    e.stopPropagation();
    // Removed confirmation as requested
    const updated = conversations.filter(c => c.id !== id);
    setConversations(updated);
    localStorage.setItem('soma_conversations', JSON.stringify(updated));
    ctConversations.delete(id).catch(() => {});

    if (id === activeConversationId) {
      handleNewChat(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  useEffect(() => {
    try {
      const service = new SomaServiceBridge((path) => setCurrentPath(path));
      somaService.current = service;
      service.initialize();

      // On load: find which conversation to open
      // Prefer stored activeConversationId, fall back to most recently updated, else start blank
      const sortedByRecent = [...conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      let targetConv = conversations.find(c => c.id === activeConversationId);
      if (!targetConv && sortedByRecent.length > 0) {
        targetConv = sortedByRecent[0];
      }

      if (targetConv) {
        setActiveConversationId(targetConv.id);
        localStorage.setItem('soma_active_conversation', targetConv.id);
        const msgs = targetConv.messages || [];
        setHistory(msgs);
        service.setConversationId(targetConv.id);
        // Local storage paints immediately, then the server replaces it as source of truth.
        service.loadBackendHistory(50).then(backendMessages => {
          setHistory(backendMessages);
          const synced = conversations.map(conv =>
            conv.id === targetConv.id
              ? { ...conv, messages: backendMessages, updatedAt: Date.now(), title: conv.title || 'SOMA Continuity' }
              : conv
          );
          setConversations(synced);
          localStorage.setItem('soma_conversations', JSON.stringify(synced));
        }).catch(() => {});
      } else {
        const newId = 'conv_' + Date.now();
        setActiveConversationId(newId);
        localStorage.setItem('soma_active_conversation', newId);
        service.setConversationId(newId);
        service.loadBackendHistory(30).then(backendMessages => {
          const newConv = {
            id: newId,
            title: backendMessages.length > 0 ? 'SOMA Continuity' : 'New Chat',
            messages: backendMessages,
            icon: SOMA_EMOJIS[0],
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          setHistory(backendMessages);
          setConversations([newConv]);
          localStorage.setItem('soma_conversations', JSON.stringify([newConv]));
        }).catch(() => setHistory([]));
      }

      setIsInitialized(true);

      // SQLite is authoritative across devices; localStorage remains an instant
      // paint cache and migration source for pre-modernization conversations.
      ctConversations.list().then(async serverConversations => {
        if (serverConversations.length === 0 && conversations.length > 0) {
          await Promise.allSettled(conversations.map(conversation => ctConversations.save(conversation)));
          return;
        }
        if (serverConversations.length > 0) {
          const localById = new Map(conversations.map(conversation => [conversation.id, conversation]));
          const merged = serverConversations.map(conversation => ({
            ...localById.get(conversation.id),
            ...conversation,
            messages: localById.get(conversation.id)?.messages || []
          }));
          setConversations(merged);
          localStorage.setItem('soma_conversations', JSON.stringify(merged));
        }
      }).catch(() => {});
    } catch (error) {
      console.error("Initialization Error:", error);
      setHistory(prev => [...prev, { id: Date.now(), type: 'error', content: `Initialization Failed: ${error.message || 'Unknown error'}` }]);
      setIsInitialized(true);
    }
  }, []);

  // Dispatch-like helpers
  const addHistory = (items) => setHistory(prev => [...prev, ...items]);
  const updateHistory = (id, content) => {
    setHistory(prev => prev.map(item => item.id === id ? { ...item, content } : item));
  };

  const [directive, setDirective] = useState(null);

  const executeCommand = useCallback(async (commandOrPayload) => {
    // Check if it's a simple string or an object payload
    const isString = typeof commandOrPayload === 'string';
    const commandText = isString ? commandOrPayload : commandOrPayload.query;

    if (!commandText?.trim() && !commandOrPayload.file) return; // Allow empty text if file exists

    if (isString && commandText.trim().toLowerCase() === 'clear') {
      setHistory([]);
      setInputValue('');
      return;
    }

    if (isString && (commandText.trim().toLowerCase() === 'pulse' || commandText.trim().toLowerCase() === 'ide')) {
      window.dispatchEvent(new CustomEvent('soma:navigate', { detail: { module: 'pulse' } }));
      setInputValue('');
      return;
    }

    setIsLoading(true);
    setSuggestions([]);
    setDirective(null); // Clear previous directives

    // Confirmation Logic
    if (awaitingConfirmation) {
      const confirmationCommand = commandText.toLowerCase() === 'y' || commandText.toLowerCase() === 'yes' ? 'y' : 'n';
      addHistory([{ id: Date.now(), type: 'command', content: confirmationCommand }]);
      setAwaitingConfirmation(null);
    } else {
      // Display in history
      if (!isString && commandOrPayload.file) {
        addHistory([{
          id: Date.now(),
          type: 'command',
          content: (
            <div className="flex flex-col">
              <span>{commandText}</span>
              <span className="text-xs text-zinc-500 mt-1 flex items-center">
                <span className="mr-2">📎</span> {commandOrPayload.file.name}
              </span>
            </div>
          )
        }]);
      } else {
        addHistory([{ id: Date.now(), type: 'command', content: commandText }]);
      }
    }

    setInputValue('');

    try {
      const commandStream = somaService.current.processCommand(commandOrPayload);
      let finalSuggestion = '';

      for await (const output of commandStream) {
        if (output.directive) {
          // Found a directive (e.g. camera request)
          setDirective(output.directive);
        }
        
        // Handle replaceId - removes old item and adds new one
        if (output.replaceId) {
          setHistory(prev => {
            const filtered = prev.filter(item => item.id !== output.replaceId);
            if (output.historyItems && output.historyItems.length > 0) {
              return [...filtered, ...output.historyItems];
            }
            return filtered;
          });
          // Update response text if applicable
          if (output.historyItems?.[0]?.type === 'response' || output.historyItems?.[0]?.type === 'thinking') {
            const content = output.historyItems[0].streamedText || output.historyItems[0].content;
            if (content) setSomaResponseText(content);
          }
        } else if (output.updateId && output.historyItems.length > 0) {
          // Update existing item by ID
          setHistory(prev => prev.map(item => 
            item.id === output.updateId ? output.historyItems[0] : item
          ));
          if (output.historyItems[0].type === 'response') {
            setSomaResponseText(output.historyItems[0].content);
          }
        } else if (output.historyItems && output.historyItems.length > 0) {
          // Smart Replace Logic: If we are adding a response and the last item was a 'think', replace it
          const newItem = output.historyItems[0];
          if (newItem.type === 'response') {
            setHistory(prev => {
              const last = prev[prev.length - 1];
              if (last && last.type === 'think') {
                // Text-based replacement for "fading" effect logic could go here, 
                // but React state replacement is cleaner. 
                // We replace the last 'think' with this 'response'
                return [...prev.slice(0, -1), newItem];
              }
              return [...prev, newItem];
            });
            setSomaResponseText(newItem.content);
          } else {
            addHistory(output.historyItems);
          }
        }
        if (output.suggestion) { finalSuggestion = output.suggestion; }
        if (output.suggestions) { setSuggestions(output.suggestions); }
        if (output.requiresConfirmation) { setAwaitingConfirmation(output.requiresConfirmation); }
      }

      setInputValue(finalSuggestion);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      addHistory([{ id: Date.now() + 1, type: 'error', content: `Error: ${errorMessage}` }]);
    }

    setIsLoading(false);
  }, [awaitingConfirmation]);

  const handleEditMessage = useCallback((id, content) => {
    setHistory(previous => previous.map(item => item.id === id
      ? { ...item, content, editedAt: Date.now() }
      : item));
  }, []);

  const handlePinMessage = useCallback(id => {
    setHistory(previous => previous.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item));
  }, []);

  const handleRetryMessage = useCallback(index => {
    const source = [...history.slice(0, index + 1)].reverse().find(item => item.type === 'command' && typeof item.content === 'string');
    if (source?.content) executeCommand(source.content);
  }, [history, executeCommand]);

  const handleBranchMessage = useCallback(async index => {
    if (!activeConversationId) return;
    saveCurrentConversation();
    try {
      const branch = await ctConversations.branch(activeConversationId, {
        id: `conv_${Date.now()}`,
        throughIndex: index
      });
      const updated = [branch, ...conversations.filter(conversation => conversation.id !== branch.id)];
      setConversations(updated);
      localStorage.setItem('soma_conversations', JSON.stringify(updated));
      setActiveConversationId(branch.id);
      setHistory(branch.messages || history.slice(0, index + 1));
      localStorage.setItem('soma_active_conversation', branch.id);
      somaService.current?.setConversationId(branch.id);
    } catch (error) {
      addHistory([{ id: Date.now(), type: 'error', content: `Could not branch conversation: ${error.message}` }]);
    }
  }, [activeConversationId, conversations, history]);

  const onSuggestionClick = useCallback((suggestion) => {
    setInputValue(suggestion);
    setTimeout(() => executeCommand(suggestion), 0);
  }, [executeCommand]);

  const handleAutocompleteResult = useCallback((completions) => {
    if (completions.length > 10) {
      const content = `> Too many possibilities (${completions.length}). Please be more specific.`;
      addHistory([{ id: Date.now(), type: 'info', content }]);
      return;
    }
    const content = `${completions.join('\t')}`;
    addHistory([{ id: Date.now(), type: 'info', content }]);
  }, []);

  return (
    <div className="h-screen ct-background text-zinc-200 flex flex-col items-center relative overflow-hidden font-sans selection:bg-white/20">
      {/* Approval Queue (floats on top) */}
      <ApprovalQueue
        socket={socket}
      />

      {/* Icon Picker Modal */}
      <IconPickerModal 
        isOpen={isIconModalOpen} 
        onClose={() => setIsIconModalOpen(false)} 
        onSelect={handleUpdateIcon}
        currentIcon={conversations.find(c => c.id === iconTargetId)?.icon}
      />

      <div className="w-full mx-auto flex flex-col h-full relative z-10">
        <Header isProcessing={isLoading} connection={connection} />
        {isInitialized && (
          <div className="flex flex-1 overflow-hidden h-full">
            <ConversationSidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(value => !value)}
              conversations={conversations}
              activeId={activeConversationId}
              historyCount={history.length}
              search={conversationSearch}
              onSearch={setConversationSearch}
              onNew={() => handleNewChat(true)}
              onSelect={handleSelectChat}
              onDelete={handleDeleteChat}
              onEditIcon={id => { setIconTargetId(id); setIsIconModalOpen(true); }}
              onExport={handleExportChat}
              getIcon={getChatIcon}
            />

            {/* Terminal Content */}
            <div className="flex min-w-0 flex-1 flex-col">
              <GoalJobCards jobs={jobs} onCancel={cancelGoal} onRetry={retryGoal} />
              <Terminal
                history={history}
                isLoading={isLoading}
                onCommand={executeCommand}
                onCancel={() => somaService.current?.cancelActiveRequest()}
                inputValue={inputValue}
                onInputChange={setInputValue}
                currentPath={currentPath}
                isAgentConnected={isAgentConnected}
                awaitingConfirmation={awaitingConfirmation}
                suggestions={suggestions}
                onSuggestionClick={onSuggestionClick}
                somaService={somaService.current}
                onAutocompleteResult={handleAutocompleteResult}
                somaResponseText={somaResponseText}
                activeDirective={directive}
                onPulseClick={undefined}
                onEditMessage={handleEditMessage}
                onRetryMessage={handleRetryMessage}
                onBranchMessage={handleBranchMessage}
                onPinMessage={handlePinMessage}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SomaCT;
