/**
 * AI Debate Arena Component
 * Real-time AI trading debates with multiple personalities
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    MessageSquare,
    Play,
    Square,
    Users,
    TrendingUp,
    TrendingDown,
    Minus,
    Vote,
    Trophy,
    Loader2,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

// Personality configurations
const PERSONALITIES = {
    bull: { name: 'Bull', emoji: '🐂', color: '#22C55E', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/30' },
    bear: { name: 'Bear', emoji: '🐻', color: '#EF4444', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
    analyst: { name: 'Analyst', emoji: '📊', color: '#3B82F6', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30' },
    contrarian: { name: 'Contrarian', emoji: '🔄', color: '#F59E0B', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
    risk_manager: { name: 'Risk Mgr', emoji: '🛡️', color: '#8B5CF6', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/30' }
};

// Action icons
const getActionIcon = (action) => {
    if (action?.includes('long') || action === 'open_long') return <TrendingUp className="w-3 h-3 text-green-400" />;
    if (action?.includes('short') || action === 'open_short') return <TrendingDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-zinc-400" />;
};

export const DebateArena = ({ symbol, marketData, onDecision, compact = false }) => {
    const [isExpanded, setIsExpanded] = useState(!compact);
    const [sessionId, setSessionId] = useState(null);
    const [status, setStatus] = useState('idle'); // idle, creating, running, voting, completed
    const [messages, setMessages] = useState([]);
    const [votes, setVotes] = useState([]);
    const [finalDecision, setFinalDecision] = useState(null);
    const [currentRound, setCurrentRound] = useState(0);
    const [maxRounds, setMaxRounds] = useState(3);
    const [error, setError] = useState(null);
    const [selectedParticipants, setSelectedParticipants] = useState(['bull', 'bear', 'analyst']);

    const messagesEndRef = useRef(null);
    const eventSourceRef = useRef(null);

    // Auto-scroll to latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Cleanup SSE on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    // Start a new debate
    const startDebate = useCallback(async () => {
        if (!symbol) {
            setError('No symbol selected');
            return;
        }

        setError(null);
        setStatus('creating');
        setMessages([]);
        setVotes([]);
        setFinalDecision(null);
        setCurrentRound(0);

        try {
            // Create session
            const createRes = await fetch('/api/debate/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol,
                    participants: selectedParticipants,
                    maxRounds
                })
            });

            const createData = await createRes.json();
            if (!createData.success) {
                throw new Error(createData.error || 'Failed to create debate');
            }

            const newSessionId = createData.session.id;
            setSessionId(newSessionId);

            // Connect to SSE stream
            const eventSource = new EventSource(`/api/debate/${newSessionId}/stream`);
            eventSourceRef.current = eventSource;

            eventSource.addEventListener('connected', () => {
                console.log('[Debate] SSE Connected');
            });

            eventSource.addEventListener('debateStart', (e) => {
                setStatus('running');
            });

            eventSource.addEventListener('roundStart', (e) => {
                const data = JSON.parse(e.data);
                setCurrentRound(data.round);
            });

            eventSource.addEventListener('message', (e) => {
                const data = JSON.parse(e.data);
                setMessages(prev => [...prev, data.message]);
            });

            eventSource.addEventListener('votingStart', () => {
                setStatus('voting');
            });

            eventSource.addEventListener('vote', (e) => {
                const data = JSON.parse(e.data);
                setVotes(prev => [...prev, data.vote]);
            });

            eventSource.addEventListener('debateComplete', (e) => {
                const data = JSON.parse(e.data);
                setFinalDecision(data.decision);
                setStatus('completed');
                eventSource.close();

                // Notify parent of decision
                if (onDecision) {
                    onDecision(data.decision);
                }
            });

            eventSource.addEventListener('error', (e) => {
                const data = e.data ? JSON.parse(e.data) : {};
                setError(data.error || 'Debate error occurred');
                setStatus('idle');
                eventSource.close();
            });

            eventSource.onerror = () => {
                setError('Connection lost');
                setStatus('idle');
            };

            // Start the debate
            const startRes = await fetch(`/api/debate/${newSessionId}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marketData })
            });

            if (!startRes.ok) {
                throw new Error('Failed to start debate');
            }

        } catch (err) {
            setError(err.message);
            setStatus('idle');
        }
    }, [symbol, selectedParticipants, maxRounds, marketData, onDecision]);

    // Stop debate
    const stopDebate = useCallback(async () => {
        if (sessionId) {
            try {
                await fetch(`/api/debate/${sessionId}/cancel`, { method: 'POST' });
            } catch (e) {
                console.error('Failed to cancel debate:', e);
            }
        }
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }
        setStatus('idle');
    }, [sessionId]);

    // Toggle participant
    const toggleParticipant = (id) => {
        setSelectedParticipants(prev => {
            if (prev.includes(id)) {
                if (prev.length <= 2) return prev; // Minimum 2 participants
                return prev.filter(p => p !== id);
            }
            return [...prev, id];
        });
    };

    // Render compact header
    if (compact && !isExpanded) {
        return (
            <div
                onClick={() => setIsExpanded(true)}
                className="p-2 bg-black/40 border border-white/5 rounded cursor-pointer hover:bg-black/60 transition-colors"
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-bold text-zinc-300">AI DEBATE</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {status === 'running' && (
                            <span className="text-[9px] text-cyan-400 animate-pulse">LIVE</span>
                        )}
                        {finalDecision && (
                            <span className={`text-[9px] font-bold ${
                                finalDecision.action?.includes('long') ? 'text-green-400' :
                                finalDecision.action?.includes('short') ? 'text-red-400' : 'text-zinc-400'
                            }`}>
                                {finalDecision.action?.toUpperCase()}
                            </span>
                        )}
                        <ChevronDown className="w-3 h-3 text-zinc-500" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-black/40 border border-white/5 rounded-lg overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-3 border-b border-white/5 flex items-center justify-between bg-black/20">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">AI Debate Arena</h3>
                    {symbol && <span className="text-[10px] text-cyan-400 font-mono">{symbol}</span>}
                </div>
                <div className="flex items-center gap-2">
                    {status === 'running' && (
                        <span className="text-[9px] px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded border border-cyan-500/30 animate-pulse">
                            Round {currentRound}/{maxRounds}
                        </span>
                    )}
                    {compact && (
                        <button onClick={() => setIsExpanded(false)} className="p-1 hover:bg-white/10 rounded">
                            <ChevronUp className="w-3 h-3 text-zinc-500" />
                        </button>
                    )}
                </div>
            </div>

            {/* Participant Selector */}
            {status === 'idle' && (
                <div className="p-3 border-b border-white/5 bg-black/10">
                    <div className="flex items-center gap-1 mb-2">
                        <Users className="w-3 h-3 text-zinc-500" />
                        <span className="text-[9px] text-zinc-500 uppercase">Participants</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {Object.entries(PERSONALITIES).map(([id, p]) => (
                            <button
                                key={id}
                                onClick={() => toggleParticipant(id)}
                                className={`px-2 py-1 text-[10px] font-bold rounded border transition-all ${
                                    selectedParticipants.includes(id)
                                        ? `${p.bgColor} ${p.borderColor} text-white`
                                        : 'bg-black/20 border-white/10 text-zinc-500 hover:border-white/20'
                                }`}
                            >
                                {p.emoji} {p.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto max-h-64 p-2 space-y-2 custom-scrollbar">
                {messages.length === 0 && status === 'idle' && (
                    <div className="text-center py-8 text-zinc-500 text-xs">
                        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>Select participants and start a debate</p>
                        <p className="text-[9px] mt-1">AI models will debate trading decisions</p>
                    </div>
                )}

                {messages.map((msg, idx) => {
                    const personality = PERSONALITIES[msg.participant] || {};
                    return (
                        <div
                            key={msg.id || idx}
                            className={`p-2 rounded border ${personality.bgColor || 'bg-black/20'} ${personality.borderColor || 'border-white/10'}`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1">
                                    <span>{personality.emoji}</span>
                                    <span className="text-[10px] font-bold" style={{ color: personality.color }}>
                                        {personality.name || msg.participant}
                                    </span>
                                    <span className="text-[8px] text-zinc-600">R{msg.round}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {getActionIcon(msg.decision?.action)}
                                    <span className={`text-[9px] font-mono ${
                                        msg.decision?.action?.includes('long') ? 'text-green-400' :
                                        msg.decision?.action?.includes('short') ? 'text-red-400' : 'text-zinc-400'
                                    }`}>
                                        {msg.decision?.action?.replace('_', ' ').toUpperCase() || 'HOLD'}
                                    </span>
                                    <span className="text-[8px] text-zinc-500">
                                        {msg.confidence}%
                                    </span>
                                </div>
                            </div>
                            <p className="text-[10px] text-zinc-300 line-clamp-2">
                                {msg.reasoning || msg.content?.slice(0, 150)}
                            </p>
                        </div>
                    );
                })}

                {status === 'running' && (
                    <div className="flex items-center gap-2 p-2 text-zinc-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-[10px]">Debating...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Votes Summary */}
            {votes.length > 0 && (
                <div className="p-2 border-t border-white/5 bg-black/20">
                    <div className="flex items-center gap-1 mb-2">
                        <Vote className="w-3 h-3 text-zinc-500" />
                        <span className="text-[9px] text-zinc-500 uppercase">Final Votes</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {votes.map((vote, idx) => {
                            const personality = PERSONALITIES[vote.participant] || {};
                            return (
                                <div
                                    key={idx}
                                    className={`px-2 py-1 rounded text-[9px] ${personality.bgColor || 'bg-black/20'} border ${personality.borderColor || 'border-white/10'}`}
                                >
                                    <span>{personality.emoji}</span>
                                    <span className="ml-1 font-mono">
                                        {vote.action?.replace('_', ' ').toUpperCase()}
                                    </span>
                                    <span className="ml-1 text-zinc-500">({vote.confidence}%)</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Final Decision */}
            {finalDecision && (
                <div className={`p-3 border-t-2 ${
                    finalDecision.action?.includes('long') ? 'border-green-500 bg-green-500/10' :
                    finalDecision.action?.includes('short') ? 'border-red-500 bg-red-500/10' :
                    'border-zinc-500 bg-zinc-500/10'
                }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Trophy className="w-4 h-4 text-amber-400" />
                            <span className="text-xs font-bold text-white uppercase">
                                Consensus: {finalDecision.action?.replace('_', ' ')}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${
                                finalDecision.confidence > 70 ? 'text-green-400' :
                                finalDecision.confidence > 50 ? 'text-amber-400' : 'text-red-400'
                            }`}>
                                {finalDecision.confidence}%
                            </span>
                            <span className="text-[9px] text-zinc-500">
                                ({finalDecision.supportingVotes}/{finalDecision.totalVotes} votes)
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="p-2 bg-red-500/10 border-t border-red-500/30 text-red-400 text-[10px]">
                    {error}
                </div>
            )}

            {/* Controls */}
            <div className="p-2 border-t border-white/5 flex items-center justify-between bg-black/30">
                <div className="text-[9px] text-zinc-500">
                    {status === 'idle' ? 'Ready' :
                     status === 'creating' ? 'Creating...' :
                     status === 'running' ? `Round ${currentRound}` :
                     status === 'voting' ? 'Voting...' : 'Complete'}
                </div>
                <div className="flex gap-2">
                    {(status === 'idle' || status === 'completed') && (
                        <button
                            onClick={startDebate}
                            disabled={!symbol || selectedParticipants.length < 2}
                            className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Play className="w-3 h-3" />
                            {status === 'completed' ? 'RETRY' : 'START'}
                        </button>
                    )}
                    {(status === 'running' || status === 'voting' || status === 'creating') && (
                        <button
                            onClick={stopDebate}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-[10px] font-bold rounded transition-colors"
                        >
                            <Square className="w-3 h-3" />
                            STOP
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DebateArena;
