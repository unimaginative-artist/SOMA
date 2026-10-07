import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { axisGet, axisPost } from '../nexusBackend.js';

const T = {
  bg:      '#050506',
  surface: '#0a0a0c',
  card:    '#0d0d10',
  border:  '#1a1a20',
  border2: '#252530',
  text:    '#f5f0e8',
  dim:     '#8888a0',
  dimmer:  '#4a4a60',
  blue:    '#00aaff',
  purple:  '#7755ff',
  success: '#33ffaa',
  warning: '#ffaa33',
  danger:  '#ff4455',
  violet:  '#aa77ff',
};

const DEFAULT_WORKSPACE = 'nexus-main';
const DEFAULT_CHANNELS  = [
  { id: 'general',    name: 'general',    icon: '#' },
  { id: 'findings',   name: 'findings',   icon: '⚑' },
  { id: 'soma',       name: 'soma',       icon: '◈' },
];

function Avatar({ name, color, size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color || T.blue,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, color: '#fff', fontWeight: 700,
      flexShrink: 0,
    }}>
      {name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  );
}

function Message({ msg, isOwn }) {
  const isWhisper = msg.mode === 'whisper';
  const isSoma    = msg.is_soma || msg.isSoma || msg.sender_id === 'soma';
  const ts = new Date(msg.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        display: 'flex',
        gap: 10,
        padding: '6px 16px',
        background: isWhisper ? 'rgba(255,170,51,0.05)' : 'transparent',
        borderLeft: isWhisper ? `2px solid ${T.warning}` : isSoma ? `2px solid ${T.violet}` : 'none',
        marginLeft: isWhisper || isSoma ? 0 : 0,
      }}
    >
      <Avatar name={msg.sender_name} color={isSoma ? T.violet : msg.sender_color} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
          <span style={{
            fontSize: 11,
            color: isSoma ? T.violet : isOwn ? T.blue : T.text,
            fontWeight: 600,
          }}>
            {msg.sender_name || 'Unknown'}
          </span>
          <span style={{ fontSize: 9, color: T.dimmer }}>{ts}</span>
          {isWhisper && (
            <span style={{ fontSize: 8, color: T.warning, letterSpacing: 1 }}>WHISPER</span>
          )}
        </div>
        <div style={{
          fontSize: 12, color: isWhisper ? T.warning : T.dim,
          lineHeight: 1.6, wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      </div>
    </motion.div>
  );
}

function ChannelButton({ ch, active, unread, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        background: active ? `rgba(0,170,255,0.08)` : 'none',
        border: `1px solid ${active ? T.blue : 'transparent'}`,
        borderRadius: 5,
        padding: '7px 10px',
        color: active ? T.blue : unread ? T.text : T.dim,
        cursor: 'pointer',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'inherit',
      }}
    >
      <span style={{ color: T.dimmer }}>{ch.icon || '#'}</span>
      <span style={{ flex: 1 }}>{ch.name}</span>
      {unread > 0 && (
        <span style={{
          background: T.blue, color: '#050506',
          fontSize: 8, fontWeight: 700,
          padding: '1px 5px', borderRadius: 8,
        }}>{unread}</span>
      )}
    </button>
  );
}

export default function AxisChat({ identity, events }) {
  const [channels,      setChannels]      = useState(DEFAULT_CHANNELS);
  const [activeChannel, setActiveChannel] = useState(DEFAULT_CHANNELS[0]);
  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState('');
  const [whisper,       setWhisper]       = useState(false);
  const [sending,       setSending]       = useState(false);
  const [loading,       setLoading]       = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Ensure default workspace + channels exist ──────────────────────────────
  useEffect(() => {
    const ensureWorkspace = async () => {
      try {
        const data = await axisGet('/api/axis/workspaces', identity);
        let ws = (data.workspaces || []).find(w => w.name === 'Nexus');
        if (!ws) {
          const created = await axisPost('/api/axis/workspaces', { name: 'Nexus', icon: '◈', color: '#00aaff' }, identity);
          ws = created.workspace;
        }
        if (!ws?.id) return;

        // Ensure default channels
        const chData = await axisGet(`/api/axis/channels?workspaceId=${ws.id}`, identity);
        const existing = (chData.channels || []).map(c => c.name);

        for (const def of DEFAULT_CHANNELS) {
          if (!existing.includes(def.name)) {
            await axisPost('/api/axis/channels', {
              workspaceId: ws.id, name: def.name, type: 'text',
            }, identity);
          }
        }

        const refreshed = await axisGet(`/api/axis/channels?workspaceId=${ws.id}`, identity);
        const chs = (refreshed.channels || []).map(c => ({
          id:   c.id,
          name: c.name,
          icon: DEFAULT_CHANNELS.find(d => d.name === c.name)?.icon || '#',
          wsId: c.workspace_id,
        }));
        if (chs.length) {
          setChannels(chs);
          setActiveChannel(chs[0]);
        }
      } catch (e) {
        // Backend offline — use local default channels for display
      }
    };
    ensureWorkspace();
  }, [identity]);

  // ── Load messages when channel changes ────────────────────────────────────
  useEffect(() => {
    if (!activeChannel?.id || activeChannel.id.length < 10) return; // skip default IDs
    setLoading(true);
    axisGet(`/api/axis/messages?channelId=${activeChannel.id}&limit=80`, identity)
      .then(data => setMessages((data.messages || []).reverse()))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [activeChannel?.id]);

  // ── Ingest live messages from WebSocket ───────────────────────────────────
  useEffect(() => {
    const latest = events[0];
    if (!latest) return;
    if (latest.type === 'axis.message' && latest.channel_id === activeChannel?.id) {
      setMessages(prev => {
        if (prev.some(m => m.id === latest.id)) return prev;
        return [...prev, latest];
      });
    }
  }, [events, activeChannel?.id]);

  // ── Scroll to bottom on new messages ──────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!activeChannel?.id || activeChannel.id.length < 10) {
      // Optimistic display only when backend unavailable
      setMessages(prev => [...prev, {
        id:          `local-${Date.now()}`,
        channel_id:  activeChannel.id,
        sender_id:   identity.id,
        sender_name: identity.name,
        sender_color: identity.color,
        content:     text,
        mode:        whisper ? 'whisper' : 'archive',
        created_at:  Date.now(),
      }]);
      setInput('');
      return;
    }

    setSending(true);
    setInput('');
    try {
      await axisPost('/api/axis/messages', {
        channelId: activeChannel.id,
        content:   text,
        mode:      whisper ? 'whisper' : 'archive',
      }, identity);
    } catch {
      // Message may still have gone through via broadcast
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', background: T.bg }}>
      {/* ── Channel list ────────────────────────────────────────────────── */}
      <div style={{
        width: 200,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${T.border}`,
          fontSize: 9,
          letterSpacing: 3,
          color: T.dimmer,
        }}>
          CHANNELS
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {channels.map(ch => (
            <ChannelButton
              key={ch.id}
              ch={ch}
              active={activeChannel?.id === ch.id}
              unread={0}
              onClick={() => setActiveChannel(ch)}
            />
          ))}
        </div>
      </div>

      {/* ── Message pane ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Channel header */}
        <div style={{
          padding: '10px 20px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: T.surface,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, color: T.dimmer }}>{activeChannel?.icon || '#'}</span>
          <span style={{ fontSize: 13, color: T.text }}>{activeChannel?.name}</span>
          {activeChannel?.name === 'soma' && (
            <span style={{ fontSize: 9, color: T.violet, letterSpacing: 1 }}>
              · @soma always listening
            </span>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', paddingTop: 8, paddingBottom: 8 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 10, color: T.dimmer }}>
              LOADING...
            </div>
          ) : messages.length === 0 ? (
            <div style={{
              padding: 32, textAlign: 'center', fontSize: 10,
              color: T.dimmer, letterSpacing: 1,
            }}>
              NO MESSAGES — START THE CONVERSATION
            </div>
          ) : (
            messages.map((m, i) => (
              <Message key={m.id || i} msg={m} isOwn={m.sender_id === identity.id} />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose */}
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${T.border}`,
          background: T.surface,
          flexShrink: 0,
        }}>
          {/* Whisper toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => setWhisper(w => !w)}
              style={{
                padding: '3px 10px',
                background: whisper ? `rgba(255,170,51,0.1)` : 'none',
                border: `1px solid ${whisper ? T.warning : T.border2}`,
                borderRadius: 10,
                color: whisper ? T.warning : T.dimmer,
                fontSize: 9,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: 1,
                transition: 'all 0.15s',
              }}
            >
              {whisper ? '⟩ WHISPER ON' : '⟩ WHISPER'}
            </button>
            {whisper && (
              <span style={{ fontSize: 9, color: T.warning, letterSpacing: 1 }}>
                Ephemeral — not stored
              </span>
            )}
            {!whisper && activeChannel?.name !== 'soma' && (
              <span style={{ fontSize: 9, color: T.dimmer }}>
                Use @soma to invoke the AI
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message #${activeChannel?.name || 'channel'}...`}
              rows={2}
              style={{
                flex: 1,
                background: T.card,
                border: `1px solid ${whisper ? T.warning : T.border}`,
                borderRadius: 6,
                color: T.text,
                fontSize: 12,
                padding: '8px 12px',
                fontFamily: 'inherit',
                resize: 'none',
                outline: 'none',
                lineHeight: 1.5,
                transition: 'border-color 0.15s',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              style={{
                padding: '0 16px',
                background: whisper ? T.warning : T.blue,
                border: 'none',
                borderRadius: 6,
                color: '#050506',
                fontSize: 11,
                fontWeight: 700,
                cursor: sending || !input.trim() ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: sending || !input.trim() ? 0.4 : 1,
                transition: 'opacity 0.15s',
                alignSelf: 'stretch',
              }}
            >
              {sending ? '...' : '→'}
            </button>
          </div>
          <div style={{ marginTop: 4, fontSize: 8, color: T.dimmer }}>
            Enter to send · Shift+Enter for newline
          </div>
        </div>
      </div>
    </div>
  );
}
