import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { WidgetData } from '../../types';
import { Send, Loader2 } from 'lucide-react';

interface Props {
    data: WidgetData;
}

type ChatMessage = { role: 'user' | 'ai'; text: string };

const SomaLogo: React.FC<{ className?: string }> = ({ className = '' }) => (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
        <path
            d="M16 4.25c-1.75 0-3.35.62-4.58 1.65A6.17 6.17 0 0 0 7.5 4.72c-2.6 0-4.75 1.78-4.75 4.45 0 1.72.75 3.25 1.94 4.29a6.12 6.12 0 0 0-1.94 4.46c0 2.29 1.42 4.18 3.43 4.91-.2 1.23.13 2.46.98 3.4 1.14 1.28 2.97 1.52 4.68 1.52h8.32c1.71 0 3.54-.24 4.68-1.52.85-.94 1.18-2.17.98-3.4 2.01-.73 3.43-2.62 3.43-4.91a6.12 6.12 0 0 0-1.94-4.46 6.07 6.07 0 0 0 1.94-4.29c0-2.67-2.15-4.45-4.75-4.45-1.45 0-2.82.42-3.92 1.18A7.05 7.05 0 0 0 16 4.25Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

async function askSoma(message: string, history: ChatMessage[]): Promise<string> {
    const response = await fetch('/api/studio/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            history: history.slice(-8),
        }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Studio assistant failed with ${response.status}`);
    }

    return data.reply || data.response || data.message || 'SOMA received that, but did not return text.';
}

const AssistantWidget: React.FC<Props> = ({ data }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
      { role: 'ai', text: 'I am here in Studio. I can help shape your profile, Axis identity, projects, and public voice.' }
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
      if (!input.trim() || isThinking) return;
      
      const userMsg = input;
      setInput('');
      const nextMessages: ChatMessage[] = [...messages, { role: 'user', text: userMsg }];
      setMessages(nextMessages);
      setIsThinking(true);

      try {
        const response = await askSoma(userMsg, nextMessages);
        setMessages(prev => [...prev, { role: 'ai', text: response }]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown connection issue';
        setMessages(prev => [...prev, { role: 'ai', text: `Studio is connected to SOMA, but the assistant call failed: ${detail}` }]);
      } finally {
        setIsThinking(false);
      }
  };

  return (
    <div className="w-full h-full flex flex-col bg-gradient-to-b from-white/[0.02] to-transparent relative">
        {/* Header */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/75 shadow-[0_0_18px_rgba(255,255,255,0.08)]">
                    <SomaLogo className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <div className="text-sm font-medium text-white/90">SOMA</div>
                    <div className="truncate text-[10px] uppercase tracking-[0.18em] text-white/35">{data.title || 'Studio assistant'}</div>
                </div>
            </div>
        </div>

        {/* Chat Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-0.5 scrollbar-none">
            {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                        msg.role === 'user' 
                        ? 'bg-white text-black' 
                        : 'bg-white/5 text-white/80 border border-white/5'
                    }`}>
                        {msg.text}
                    </div>
                </div>
            ))}
            {isThinking && (
                 <div className="flex justify-start">
                    <div className="bg-white/5 rounded-2xl px-3 py-2">
                        <Loader2 size={12} className="animate-spin text-white/40" />
                    </div>
                </div>
            )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-white/5 flex gap-2">
            <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask SOMA..."
                className="flex-1 bg-white/5 border border-white/5 rounded-full px-4 py-2 text-xs text-white focus:outline-none focus:bg-white/10 transition-colors placeholder:text-white/20"
            />
            <button 
                onClick={handleSend}
                disabled={isThinking || !input.trim()}
                title="Send to SOMA"
                className="p-2 rounded-full bg-white text-black hover:bg-white/90 disabled:opacity-50 transition-colors"
            >
                <Send size={12} />
            </button>
        </div>
    </div>
  );
};

export default AssistantWidget;
