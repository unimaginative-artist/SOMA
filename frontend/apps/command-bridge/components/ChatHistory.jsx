import React, { useState, useEffect } from 'react';
import { MessageSquare, Plus, Trash2, Clock } from 'lucide-react';

const ChatHistory = ({ onSelectChat, onNewChat, activeConversationId }) => {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    // Load conversations from localStorage
    const stored = localStorage.getItem('soma_conversations');
    if (stored) {
      try {
        setConversations(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load conversations:', e);
      }
    }
  }, []);

  const deleteConversation = (id, e) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      const updated = conversations.filter(c => c.id !== id);
      setConversations(updated);
      localStorage.setItem('soma_conversations', JSON.stringify(updated));
      
      // If deleting active conversation, start new one
      if (id === activeConversationId) {
        onNewChat();
      }
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

  return (
    <div className="flex flex-col h-full">
      {/* New Chat Button */}
      <button
        onClick={onNewChat}
        className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 mb-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-400/40 rounded-lg transition-all duration-200 group"
      >
        <Plus className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-cyan-400">New Chat</span>
      </button>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
        {conversations.length === 0 ? (
          <div className="text-center text-zinc-600 text-xs py-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No conversations yet</p>
          </div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => onSelectChat(conv.id)}
              className={`group relative p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                conv.id === activeConversationId
                  ? 'bg-white/10 border border-white/10 shadow-lg'
                  : 'hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <h4 className={`text-sm font-medium line-clamp-2 pr-6 ${
                  conv.id === activeConversationId ? 'text-white' : 'text-zinc-300'
                }`}>
                  {conv.title || 'Untitled Chat'}
                </h4>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3 text-red-400" />
                </button>
              </div>
              <div className="flex items-center space-x-1 text-[10px] text-zinc-500">
                <Clock className="w-3 h-3" />
                <span>{formatTimestamp(conv.updatedAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatHistory;
