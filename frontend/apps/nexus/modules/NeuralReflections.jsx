import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchReflections, fetchNote, saveNote, deleteNote, quickNote } from '../nexusBackend.js';

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
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function NoteCard({ note, selected, onSelect, onDelete }) {
  const preview = (note.content || '').replace(/^#+\s*/gm, '').trim().slice(0, 140);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={() => onSelect(note)}
      style={{
        background: selected ? `rgba(0,170,255,0.06)` : T.card,
        border: `1px solid ${selected ? T.blue : T.border}`,
        borderRadius: 8,
        padding: 16,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 11, color: T.text, fontWeight: 600, lineHeight: 1.3 }}>
        {note.name?.replace(/\.md$/, '') || 'Untitled'}
      </div>
      {preview && (
        <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.6 }}>
          {preview}{preview.length >= 140 ? '...' : ''}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: T.dimmer, letterSpacing: 1 }}>
          {timeAgo(note.modifiedAt || note.createdAt)}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(note.name); }}
          style={{
            background: 'none', border: 'none', color: T.dimmer,
            cursor: 'pointer', fontSize: 11, padding: '2px 4px',
            opacity: 0.6,
          }}
          title="Delete note"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
}

function NoteEditor({ note, onSave, onDistill, onClose }) {
  const [title,   setTitle]   = useState('');
  const [content, setContent] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [distillResult, setDistillResult] = useState(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!note) return;
    setTitle(note.name?.replace(/\.md$/, '') || '');
    setContent(note.content || '');
    setDistillResult(null);
    dirty.current = false;
  }, [note?.name]);

  const save = async () => {
    const trimTitle = title.trim() || 'untitled';
    const safeName  = trimTitle.replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() + '.md';
    setSaving(true);
    try {
      await saveNote(safeName, content);
      dirty.current = false;
      onSave(safeName, content);
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const distill = async () => {
    if (!content.trim()) return;
    setDistilling(true);
    try {
      const res = await fetch('/api/soma/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Distill and synthesize this note for a forensic audit team. Extract key insights, findings, and action items. Format as a structured brief.\n\n---\n${content}`,
          sessionId: `nexus-distill-${Date.now()}`,
        }),
      });
      const data = await res.json();
      setDistillResult(data.response || data.message || data.text || 'No response');
    } catch {
      setDistillResult('Distillation unavailable — brain offline.');
    } finally {
      setDistilling(false);
    }
  };

  if (!note) return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, color: T.dimmer, letterSpacing: 1,
    }}>
      SELECT A NOTE TO EDIT
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Editor toolbar */}
      <div style={{
        padding: '10px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: T.surface,
        flexShrink: 0,
      }}>
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); dirty.current = true; }}
          placeholder="Note title..."
          style={{
            flex: 1,
            background: 'none', border: 'none',
            color: T.text, fontSize: 13, fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={distill}
          disabled={distilling || !content.trim()}
          style={{
            padding: '5px 12px',
            background: 'none',
            border: `1px solid ${T.purple}`,
            borderRadius: 5,
            color: T.purple,
            fontSize: 9,
            cursor: distilling ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 1,
            opacity: distilling ? 0.5 : 1,
          }}
        >
          {distilling ? '◇ DISTILLING...' : '◇ DISTILL'}
        </button>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '5px 12px',
            background: T.blue,
            border: 'none',
            borderRadius: 5,
            color: '#050506',
            fontSize: 9,
            fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 1,
          }}
        >
          {saving ? 'SAVING...' : 'SAVE'}
        </button>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: T.dim,
            cursor: 'pointer', fontSize: 14, padding: '2px 6px',
          }}
        >✕</button>
      </div>

      {/* Editor + distill result */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <textarea
          value={content}
          onChange={e => { setContent(e.target.value); dirty.current = true; }}
          placeholder="Write in Markdown..."
          style={{
            flex: 1,
            background: T.bg,
            border: 'none',
            color: T.text,
            fontSize: 12,
            fontFamily: 'inherit',
            padding: '20px 24px',
            resize: 'none',
            outline: 'none',
            lineHeight: 1.8,
          }}
        />

        {distillResult && (
          <div style={{
            width: 320,
            background: T.card,
            borderLeft: `1px solid ${T.border}`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: `1px solid ${T.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 9, letterSpacing: 2, color: T.purple }}>SOMA DISTILLATION</span>
              <button
                onClick={() => setDistillResult(null)}
                style={{ background: 'none', border: 'none', color: T.dimmer, cursor: 'pointer', fontSize: 12 }}
              >✕</button>
            </div>
            <div style={{
              flex: 1, overflow: 'auto', padding: '16px',
              fontSize: 11, color: T.dim, lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}>
              {distillResult}
            </div>
            <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.border}` }}>
              <button
                onClick={async () => {
                  const appendContent = `\n\n---\n## SOMA Distillation — ${new Date().toLocaleString()}\n\n${distillResult}`;
                  setContent(c => c + appendContent);
                  dirty.current = true;
                  setDistillResult(null);
                }}
                style={{
                  width: '100%', padding: '6px',
                  background: 'none', border: `1px solid ${T.purple}`,
                  borderRadius: 5, color: T.purple, fontSize: 9,
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 1,
                }}
              >
                APPEND TO NOTE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NeuralReflections({ identity }) {
  const [notes,    setNotes]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchReflections();
      const noteList = data?.notes || data?.files || [];
      // Load content for each note (limited to first 20 for performance)
      const withContent = await Promise.all(
        noteList.slice(0, 30).map(async (n) => {
          try {
            const detail = await fetchNote(n.name);
            return { ...n, content: detail?.content || detail?.text || '', modifiedAt: detail?.modifiedAt };
          } catch {
            return n;
          }
        })
      );
      setNotes(withContent);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const createNote = async () => {
    const title = newTitle.trim() || `Note ${Date.now()}`;
    const safeName = title.replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() + '.md';
    try {
      await saveNote(safeName, `# ${title}\n\n`);
      setCreating(false);
      setNewTitle('');
      await loadNotes();
      setSelected({ name: safeName, content: `# ${title}\n\n` });
    } catch (e) {
      console.error('Create failed:', e);
    }
  };

  const handleDelete = async (name) => {
    if (!confirm(`Delete "${name.replace('.md', '')}"?`)) return;
    try {
      await deleteNote(name);
      if (selected?.name === name) setSelected(null);
      setNotes(prev => prev.filter(n => n.name !== name));
    } catch {}
  };

  const handleSave = (name, content) => {
    setNotes(prev => prev.map(n => n.name === name ? { ...n, content, modifiedAt: new Date().toISOString() } : n));
  };

  const filtered = notes.filter(n =>
    !search ||
    n.name?.toLowerCase().includes(search.toLowerCase()) ||
    n.content?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ height: '100%', display: 'flex', background: T.bg }}>
      {/* ── Notes sidebar ───────────────────────────────────────────────── */}
      <div style={{
        width: 300,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Toolbar */}
        <div style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, letterSpacing: 3, color: T.dimmer }}>
              VAULT · {notes.length}
            </span>
            <button
              onClick={() => setCreating(true)}
              style={{
                padding: '4px 10px',
                background: T.blue,
                border: 'none',
                borderRadius: 4,
                color: '#050506',
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: 1,
              }}
            >
              + NEW
            </button>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            style={{
              width: '100%',
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 5,
              color: T.text,
              fontSize: 11,
              padding: '6px 10px',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>

        {/* New note input */}
        <AnimatePresence>
          {creating && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              style={{
                overflow: 'hidden',
                borderBottom: `1px solid ${T.border}`,
                background: `rgba(0,170,255,0.05)`,
              }}
            >
              <div style={{ padding: 12, display: 'flex', gap: 6 }}>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createNote(); if (e.key === 'Escape') { setCreating(false); setNewTitle(''); } }}
                  placeholder="Note title..."
                  style={{
                    flex: 1, background: T.card, border: `1px solid ${T.blue}`,
                    borderRadius: 4, color: T.text, fontSize: 11,
                    padding: '5px 8px', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <button onClick={createNote} style={{
                  background: T.blue, border: 'none', borderRadius: 4,
                  color: '#050506', fontSize: 9, fontWeight: 700,
                  padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
                }}>✓</button>
                <button onClick={() => { setCreating(false); setNewTitle(''); }} style={{
                  background: 'none', border: `1px solid ${T.border2}`, borderRadius: 4,
                  color: T.dim, fontSize: 9, padding: '5px 8px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>✕</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Notes list */}
        <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 10, color: T.dimmer }}>
              LOADING VAULT...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 10, color: T.dimmer, letterSpacing: 1 }}>
              {search ? 'NO MATCHES' : 'VAULT EMPTY'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <AnimatePresence>
                {filtered.map(n => (
                  <NoteCard
                    key={n.name}
                    note={n}
                    selected={selected?.name === n.name}
                    onSelect={setSelected}
                    onDelete={handleDelete}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* ── Editor pane ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <NoteEditor
          note={selected}
          onSave={handleSave}
          onClose={() => setSelected(null)}
        />
      </div>
    </div>
  );
}
