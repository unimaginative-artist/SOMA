import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Smile, Paperclip } from 'lucide-react';
import { ChatSession, ChatMessage, UserProfile } from '../../types';
import { getDirectMessages, sendDirectMessage } from '../../services/directsService';

interface Props {
    chat: ChatSession | null;
    currentUser: UserProfile;
    onClose: () => void;
}

const QuickChatModal: React.FC<Props> = ({ chat, currentUser, onClose }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (chat) {
            let cancelled = false;
            getDirectMessages(chat)
                .then(msgs => {
                    if (!cancelled && Array.isArray(msgs)) setMessages(msgs);
                })
                .catch(() => {
                    if (!cancelled) setMessages([]);
                });
            return () => { cancelled = true; };
        }
    }, [chat?.id]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!inputValue.trim()) return;
        
        const newMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: 'user',
            text: inputValue,
            timestamp: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            avatar: currentUser.avatar
        };
        
        setMessages(prev => [...prev, newMsg]);
        setInputValue('');
        try {
            if (chat) {
                const msgs = await sendDirectMessage(chat, newMsg.text, currentUser.avatar);
                if (Array.isArray(msgs)) setMessages(msgs);
            }
        } catch {}
    };

    if (!chat) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[600px]"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <img src={chat.image} className="w-10 h-10 rounded-full object-cover" alt={chat.title} />
                            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#111] rounded-full"></div>
                        </div>
                        <div className="flex flex-col">
                            <h3 className="text-sm font-bold text-white leading-none">{chat.title}</h3>
                            <span className="text-xs text-white/40 mt-1">{chat.online ? 'Active Now' : 'Direct contact'}</span>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Directs */}
                <div 
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-4 space-y-0.5 scrollbar-thin scrollbar-thumb-white/10"
                >
                    <div className="text-center text-[10px] text-white/30 uppercase tracking-widest my-4">Today</div>
                    
                    {messages.map((msg) => (
                        <div 
                            key={msg.id} 
                            className={`flex items-end gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                            {msg.sender === 'other' && (
                                <img src={msg.avatar} className="w-6 h-6 rounded-full object-cover mb-1" />
                            )}
                            
                            <div className={`
                                max-w-[80%] px-4 py-2 text-sm font-light leading-relaxed rounded-2xl
                                ${msg.sender === 'user' 
                                    ? 'bg-blue-600 text-white rounded-br-sm' 
                                    : 'bg-[#222] text-white/90 rounded-bl-sm'}
                            `}>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="p-3 bg-[#111] border-t border-white/5">
                    <div className="flex items-center gap-2 bg-[#1A1A1A] rounded-full px-4 py-2 border border-white/5 focus-within:border-white/20 transition-colors">
                        <button className="text-white/40 hover:text-white transition-colors">
                            <Paperclip size={18} />
                        </button>
                        <input 
                            type="text" 
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder={`Direct ${chat.title}...`}
                            className="flex-1 bg-transparent border-none focus:outline-none text-sm text-white placeholder:text-white/30"
                            autoFocus
                        />
                        <button className="text-white/40 hover:text-white transition-colors mr-1">
                            <Smile size={18} />
                        </button>
                        {inputValue && (
                             <button 
                                onClick={handleSend}
                                className="text-blue-500 hover:text-blue-400 font-semibold text-sm transition-colors"
                             >
                                Send
                             </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default QuickChatModal;
