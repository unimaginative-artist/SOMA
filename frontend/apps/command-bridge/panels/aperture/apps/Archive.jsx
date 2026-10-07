import React, { useEffect, useState } from 'react';
import { Archive, Clock, Search, FileText, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';
import somaBackend from '../../../somaBackend';

export default function ArchiveApp() {
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const loadList = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await somaBackend.fetch('/api/aperture/archive/list');
      const items = response.entries || (response.files || []).map(f => ({ name: f }));
      setEntries(items);
      if (items.length > 0) {
        selectEntry(items[0]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load archive');
    } finally {
      setLoading(false);
    }
  };

  const selectEntry = async (entry) => {
    const filename = typeof entry === 'string' ? entry : entry.name;
    setSelected(entry);
    setPreview(null);
    try {
      const res = await somaBackend.fetch(`/api/aperture/archive/view/${encodeURIComponent(filename)}`);
      if (res.success) {
        setPreview(res);
      } else {
        setError(res.error || 'Failed to view archive file');
      }
    } catch (err) {
      setError(err.message || 'Error loading archive content');
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  const filtered = entries.filter(e => {
    const name = typeof e === 'string' ? e : e.name;
    return name.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="ap-archive-app">
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Archive size={17} />
          <strong>Stored Vault Archive</strong>
          <button onClick={loadList} className="quiet" title="Refresh Archives" style={{ background: 'none', border: 'none', color: '#c8dae5', cursor: 'pointer' }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <label>
          <Search size={14} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter archived files..." />
        </label>
      </header>
      <div>
        <aside>
          {filtered.map(item => {
            const name = typeof item === 'string' ? item : item.name;
            const isSel = (typeof selected === 'string' ? selected : selected?.name) === name;
            return (
              <button key={name} className={isSel ? 'selected' : ''} onClick={() => selectEntry(item)}>
                <Clock size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              </button>
            );
          })}
          {!filtered.length && !loading && <p>No stored archive entries found.</p>}
          {loading && !entries.length && <p>Loading archive catalog...</p>}
        </aside>
        <section>
          {selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>{typeof selected === 'string' ? selected : selected.name}</h2>
                  <small style={{ color: '#8caab8', fontSize: '11px', display: 'flex', gap: '8px', marginTop: '2px' }}>
                    {preview?.size != null && <span>{(preview.size / 1024).toFixed(1)} KB</span>}
                    {preview?.modifiedAt && <span>Modified: {new Date(preview.modifiedAt).toLocaleString()}</span>}
                    {preview?.truncated && <span style={{ color: '#ffc85c' }}>[Preview truncated to 64KB]</span>}
                  </small>
                </div>
                {preview?.content && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(preview.content);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#c8dae5', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                  >
                    {copied ? <Check size={12} style={{ color: '#46d99f' }} /> : <Copy size={12} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <div style={{ flex: 1, marginTop: '12px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '11px', color: '#c8dae5', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {preview?.content ? preview.content : (loading ? 'Loading content...' : '[No preview content available]')}
              </div>
            </div>
          ) : <div className="ap-empty">Select an archive entry to inspect.</div>}
          {error && <p className="ap-inline-error">{error}</p>}
        </section>
      </div>
    </div>
  );
}
