import React, { useEffect, useState } from 'react';
import { FileText, Link2, Plus, Save, Trash2, Search, Eye, Edit2 } from 'lucide-react';
import somaBackend from '../../../somaBackend';
import { registerPilotHandler } from '../kernel/PilotRuntime';

export default function NotesApp({ windowId, policy = {} }) {
  const [notes, setNotes] = useState([]);
  const [active, setActive] = useState(null);
  const [content, setContent] = useState('');
  const [links, setLinks] = useState({ backlinks: [], outgoing: [] });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMode, setPreviewMode] = useState(false);

  const loadNotes = async selectedName => {
    const response = await somaBackend.fetch('/api/reflections/list');
    const list = response.notes || [];
    setNotes(list);
    const selected = list.find(note => note.name === selectedName) || list[0] || null;
    if (selected) await selectNote(selected);
    else { setActive(null); setContent(''); }
  };

  const selectNote = async note => {
    try {
      const [body, graph] = await Promise.all([
        somaBackend.fetch(`/api/reflections/note/${encodeURIComponent(note.name)}`),
        somaBackend.fetch(`/api/reflections/links/${encodeURIComponent(note.name)}`).catch(() => ({ backlinks: [], outgoing: [] }))
      ]);
      setActive(note);
      setContent(body.content || '');
      setLinks({ backlinks: graph.backlinks || [], outgoing: graph.outgoing || [] });
      setDirty(false);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { loadNotes().catch(err => setError(err.message)); }, []);

  useEffect(() => {
    return registerPilotHandler(window, { windowId, action: 'note_create', execute: async ({ title, content: noteContent }, signal) => {
      if (policy.memoryWrite === false) throw new Error('Memory writing is disabled');
      if (dirty) throw new Error('Save your current note before asking the pilot to write a note');
      if (!noteContent?.trim() || signal?.aborted) throw new Error('Note content is missing or the pilot stopped');
      const name = `soma-pilot-${crypto.randomUUID()}.md`;
      const initial = `---\ntitle: ${JSON.stringify(String(title || 'SOMA note'))}\ntype: note\nstatus: inbox\n---\n\n${noteContent}`;
      const saved = await somaBackend.fetch('/api/reflections/note', { method: 'PUT', body: JSON.stringify({ name, content: initial }) });
      if (saved?.success === false || saved?.error) throw new Error(saved.error || 'Note save failed');
      const readback = await somaBackend.fetch(`/api/reflections/note/${encodeURIComponent(name)}`);
      if (readback.content !== initial) return { status: 'unverified', verified: false, error: 'Save was submitted but note readback did not match. Do not automatically retry.' };
      // Do not replace the user's editor or any unsaved text while completing in the background.
      setNotes(previous => [...previous, { name, title }]);
      return { status: 'completed', verified: true, summary: `Saved ${name}; readback matched.`, evidence: { name, readbackMatched: true, characters: initial.length } };
    } });
  }, [windowId, dirty, policy.memoryWrite]);

  const createNote = async () => {
    const name = `aperture-note-${Date.now()}.md`;
    const title = `New note ${new Date().toLocaleDateString()}`;
    const initial = `---\ntitle: "${title}"\ntype: note\nstatus: inbox\n---\n\n# ${title}\n\n`;
    await somaBackend.fetch('/api/reflections/note', { method: 'PUT', body: JSON.stringify({ name, content: initial }) });
    await loadNotes(name);
  };
  const save = async () => {
    if (!active) return;
    await somaBackend.fetch('/api/reflections/note', { method: 'PUT', body: JSON.stringify({ name: active.name, content }) });
    setDirty(false);
    await loadNotes(active.name);
  };
  const remove = async () => {
    if (!active) return;
    await somaBackend.fetch(`/api/reflections/note/${encodeURIComponent(active.name)}`, { method: 'DELETE' });
    await loadNotes();
  };

  const filteredNotes = notes.filter(n => (n.title || n.name || '').toLowerCase().includes(searchQuery.toLowerCase()));
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="ap-notes-app">
      <aside>
        <header>
          <span>Reflections</span>
          <button onClick={createNote} title="New Reflection Note"><Plus size={14} /></button>
        </header>
        <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Search size={11} style={{ opacity: 0.5 }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter notes..."
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#c8dae5', fontSize: '11px', width: '100%' }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredNotes.map(note => (
            <button key={note.name} className={active?.name === note.name ? 'selected' : ''} onClick={() => selectNote(note)}>
              <FileText size={14} />
              <span>{note.title || note.name}</span>
            </button>
          ))}
          {!filteredNotes.length && <p style={{ padding: '12px', fontSize: '11px', color: '#688b99', fontStyle: 'italic' }}>No notes found.</p>}
        </div>
      </aside>
      <section>
        {active ? (
          <>
            <header>
              <div>
                <strong>{active.title}</strong>
                <small>{active.type || 'note'} · {wordCount} words · {charCount} chars {dirty ? ' · (Unsaved)' : ''}</small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => setPreviewMode(!previewMode)}
                  className="quiet"
                  title={previewMode ? 'Switch to Raw Editor' : 'Switch to Markdown Preview'}
                >
                  {previewMode ? <Edit2 size={13} /> : <Eye size={13} />}
                  <span style={{ marginLeft: 4 }}>{previewMode ? 'Edit' : 'Preview'}</span>
                </button>
                <button onClick={remove} className="quiet" title="Delete Note"><Trash2 size={13} /></button>
                <button onClick={save} title="Save Note"><Save size={13} />Save</button>
              </div>
            </header>
            {previewMode ? (
              <div style={{ flex: 1, padding: '16px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', color: '#d8e7ee', fontFamily: 'inherit', fontSize: '13px', lineHeight: '1.6' }}>
                {content.split('\n').map((line, idx) => {
                  if (line.startsWith('# ')) return <h1 key={idx} style={{ fontSize: '18px', fontWeight: 700, margin: '8px 0 4px', color: '#4de8c2' }}>{line.slice(2)}</h1>;
                  if (line.startsWith('## ')) return <h2 key={idx} style={{ fontSize: '15px', fontWeight: 600, margin: '6px 0 4px', color: '#7fe1cf' }}>{line.slice(3)}</h2>;
                  if (line.startsWith('### ')) return <h3 key={idx} style={{ fontSize: '13px', fontWeight: 600, margin: '4px 0 2px', color: '#b0dfd2' }}>{line.slice(4)}</h3>;
                  if (line.startsWith('- ') || line.startsWith('* ')) return <li key={idx} style={{ marginLeft: '16px' }}>{line.slice(2)}</li>;
                  if (line.startsWith('---')) return <hr key={idx} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />;
                  if (!line.trim()) return <div key={idx} style={{ height: '8px' }} />;
                  return <p key={idx} style={{ margin: '2px 0' }}>{line}</p>;
                })}
              </div>
            ) : (
              <textarea value={content} onChange={event => { setContent(event.target.value); setDirty(true); }} placeholder="Type note in Markdown..." />
            )}
          </>
        ) : <div className="ap-empty">Create or select a note to begin writing in Reflections.</div>}
      </section>
      <aside className="links">
        <h3><Link2 size={13} />Connections</h3>
        <label>Backlinks</label>
        {links.backlinks.map(link => { const label = typeof link === 'string' ? link : (link.title || link.name); return <p key={label}>{label}</p>; })}
        {!links.backlinks.length && <em>None yet</em>}
        <label>Outgoing</label>
        {links.outgoing.map(link => { const label = typeof link === 'string' ? link : (link.title || link.name); return <p key={label}>{label}</p>; })}
        {!links.outgoing.length && <em>None yet</em>}
      </aside>
      {error && <div className="ap-inline-error">{error}</div>}
    </div>
  );
}
