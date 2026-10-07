import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Loader } from 'lucide-react';

/**
 * TextChatModal - Popup chat window for text conversations with SOMA
 * SOMA responds via voice (text-to-speech)
 */
const TextChatModal = ({ isOpen, onClose, onSendMessage, isThinking, isTalking }) => {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleSend = () => {
    if (!message.trim() || isThinking || isTalking) return;

    // Add user message to conversation
    setConversation(prev => [...prev, {
      type: 'user',
      text: message,
      timestamp: Date.now()
    }]);

    // Send to SOMA
    onSendMessage(message);
    setMessage('');

    // Add placeholder for SOMA response
    setConversation(prev => [...prev, {
      type: 'assistant',
      text: '...',
      timestamp: Date.now(),
      isPlaceholder: true
    }]);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl h-[600px] bg-[#0a0a0f]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">Text Chat with SOMA</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {isThinking ? 'SOMA is thinking...' : isTalking ? 'SOMA is speaking...' : 'Type your message • SOMA responds via voice'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {conversation.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-zinc-600">
                <p className="text-sm">No messages yet</p>
                <p className="text-xs mt-2">Start a conversation with SOMA!</p>
              </div>
            </div>
          ) : (
            conversation.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                    msg.type === 'user'
                      ? 'bg-blue-600/20 border border-blue-500/30 rounded-br-none'
                      : 'bg-purple-600/20 border border-purple-500/30 rounded-bl-none'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold ${
                      msg.type === 'user' ? 'text-blue-300' : 'text-purple-300'
                    }`}>
                      {msg.type === 'user' ? 'You' : 'SOMA'}
                    </span>
                    {msg.isPlaceholder && (
                      <Loader className="w-3 h-3 text-purple-400 animate-spin" />
                    )}
                  </div>
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">
                    {msg.text}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/10 p-4">
          <div className="flex gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              disabled={isThinking || isTalking}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed"
              rows={3}
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || isThinking || isTalking}
              className="px-6 bg-purple-500/20 hover:bg-purple-500/30 disabled:bg-zinc-800 disabled:cursor-not-allowed border border-purple-500/30 disabled:border-zinc-700 rounded-xl text-purple-300 disabled:text-zinc-600 font-bold transition-all flex items-center justify-center"
            >
              {isThinking || isTalking ? (
                <Loader className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <div className="text-[9px] text-zinc-600 mt-2 flex items-center justify-between">
            <span>Press Enter to send • Shift+Enter for new line</span>
            <span className="text-purple-400">SOMA speaks her responses</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TextChatModal;
