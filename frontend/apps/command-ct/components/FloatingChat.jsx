import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Minimize2, Maximize2 } from 'lucide-react';

/**
 * FloatingChat - A small persistent chat window like the assistant's chat interface
 * Features:
 * - Draggable positioning
 * - Minimizable
 * - Conversation history
 * - Doesn't interfere with terminal commands
 */
const FloatingChat = ({ somaService }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('floatingChatPosition');
    if (saved) return JSON.parse(saved);
    return { x: window.innerWidth - 420, y: window.innerHeight - 520 };
  });
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const chatRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  // Save position to localStorage
  useEffect(() => {
    localStorage.setItem('floatingChatPosition', JSON.stringify(position));
  }, [position]);
  
  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  // Drag handlers
  const handleMouseDown = (e) => {
    if (e.target.closest('.chat-content') || e.target.closest('button')) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };
  
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    
    // Keep within bounds
    const maxX = window.innerWidth - (isMinimized ? 320 : 400);
    const maxY = window.innerHeight - (isMinimized ? 60 : 500);
    
    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    });
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);
  
  // Send message
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    
    try {
      // Use SOMA service to send message
      const response = await somaService.sendQuery(userMessage);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response.text || response.response || 'No response',
        mode: response.mode
      }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Error: ${error.message}`,
        error: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  if (!isOpen) {
    // Floating button to open chat
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-purple-600 hover:bg-purple-700 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 z-50 border-2 border-purple-400/30"
        style={{ backdropFilter: 'blur(10px)' }}
      >
        <MessageCircle className="w-6 h-6 text-white" />
      </button>
    );
  }
  
  return (
    <div
      ref={chatRef}
      className="fixed bg-[#0a0a0f]/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50"
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? '320px' : '400px',
        height: isMinimized ? '56px' : '500px',
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div className="bg-purple-600/20 border-b border-purple-500/30 px-4 py-3 flex items-center justify-between cursor-grab active:cursor-grabbing">
        <div className="flex items-center space-x-2">
          <MessageCircle className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-zinc-200">SOMA Chat</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(!isMinimized);
            }}
            className="p-1.5 hover:bg-white/10 rounded transition-colors"
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4 text-zinc-400" />
            ) : (
              <Minimize2 className="w-4 h-4 text-zinc-400" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            className="p-1.5 hover:bg-white/10 rounded transition-colors"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="chat-content flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar h-[380px]">
            {messages.length === 0 ? (
              <div className="text-center text-zinc-500 text-sm mt-8">
                <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Start a conversation with SOMA</p>
                <p className="text-xs mt-2 text-zinc-600">Ask anything without interrupting your terminal!</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 ${
                      msg.role === 'user'
                        ? 'bg-blue-600/20 border border-blue-500/30 rounded-tr-none'
                        : msg.error
                        ? 'bg-red-600/20 border border-red-500/30 rounded-tl-none'
                        : 'bg-purple-600/20 border border-purple-500/30 rounded-tl-none'
                    }`}
                  >
                    {msg.role === 'assistant' && msg.mode && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 mb-1 inline-block">
                        {msg.mode}
                      </span>
                    )}
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-purple-600/20 border border-purple-500/30 rounded-lg rounded-tl-none px-3 py-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          {/* Input */}
          <div className="border-t border-white/10 p-3 bg-[#12121a]/50">
            <div className="flex space-x-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask SOMA..."
                disabled={isLoading}
                className="flex-1 bg-zinc-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="w-full mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Clear conversation
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default FloatingChat;
