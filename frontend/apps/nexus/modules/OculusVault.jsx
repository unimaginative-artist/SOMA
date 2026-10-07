import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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

const ACCEPTED = '.pdf,.txt,.md,.csv,.json,.xlsx,.xls,.png,.jpg,.jpeg,.gif,.docx,.doc';

function formatBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)}KB`;
  return `${(b/1048576).toFixed(1)}MB`;
}

function FileIcon({ type }) {
  const icons = {
    pdf: '📄', txt: '📝', md: '📝', csv: '📊',
    json: '⚙️', xlsx: '📊', xls: '📊',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️',
    docx: '📃', doc: '📃',
  };
  return <span style={{ fontSize: 20 }}>{icons[type] || '📁'}</span>;
}

function FileCard({ file, selected, onSelect, onExtract, onRemove }) {
  const ext = file.name.split('.').pop().toLowerCase();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      onClick={() => onSelect(file)}
      style={{
        background: selected ? `rgba(0,170,255,0.08)` : T.card,
        border: `1px solid ${selected ? T.blue : T.border}`,
        borderRadius: 8,
        padding: 14,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 0.15s',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <FileIcon type={ext} />
        <button
          onClick={e => { e.stopPropagation(); onRemove(file.id); }}
          style={{
            background: 'none', border: 'none', color: T.dimmer,
            cursor: 'pointer', fontSize: 12, padding: 2,
            lineHeight: 1,
          }}
        >✕</button>
      </div>
      <div style={{ fontSize: 11, color: T.text, wordBreak: 'break-word', lineHeight: 1.3 }}>
        {file.name.length > 30 ? file.name.slice(0, 27) + '...' : file.name}
      </div>
      <div style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>
        {formatBytes(file.size)} · {ext.toUpperCase()}
      </div>
      {file.status && (
        <div style={{
          fontSize: 8, letterSpacing: 1,
          color: file.status === 'done' ? T.success : file.status === 'error' ? T.danger : T.warning,
        }}>
          {file.status === 'processing' ? '⟳ PROCESSING' : file.status === 'done' ? '✓ EXTRACTED' : '✗ ERROR'}
        </div>
      )}
      {file.status !== 'done' && (
        <button
          onClick={e => { e.stopPropagation(); onExtract(file); }}
          style={{
            marginTop: 4, padding: '5px 10px',
            background: 'none', border: `1px solid ${T.border2}`,
            borderRadius: 4, color: T.dim, fontSize: 9,
            cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 1,
          }}
        >
          EXTRACT
        </button>
      )}
    </motion.div>
  );
}

function DetailPanel({ file, onClose }) {
  if (!file) return null;
  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0,  opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        width: 380,
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: T.dimmer }}>FILE DETAIL</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 14 }}
        >✕</button>
      </div>

      <div style={{ padding: 20, flex: 1, overflow: 'auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: T.text, wordBreak: 'break-word', marginBottom: 8 }}>
            {file.name}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>
            <span>{formatBytes(file.size)}</span>
            <span>{file.name.split('.').pop().toUpperCase()}</span>
            <span>{new Date(file.addedAt).toLocaleString()}</span>
          </div>
        </div>

        {file.extractedText && (
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: T.dimmer, marginBottom: 8 }}>
              EXTRACTED CONTENT
            </div>
            <div style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: 12,
              fontSize: 10,
              color: T.dim,
              lineHeight: 1.7,
              maxHeight: 300,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {file.extractedText}
            </div>
          </div>
        )}

        {file.somaAnalysis && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: T.blue, marginBottom: 8 }}>
              SOMA ANALYSIS
            </div>
            <div style={{
              background: `rgba(0,170,255,0.05)`,
              border: `1px solid rgba(0,170,255,0.2)`,
              borderRadius: 6,
              padding: 12,
              fontSize: 10,
              color: T.dim,
              lineHeight: 1.7,
            }}>
              {file.somaAnalysis}
            </div>
          </div>
        )}

        {!file.extractedText && (
          <div style={{ fontSize: 10, color: T.dimmer, letterSpacing: 1 }}>
            Click EXTRACT to process this file.
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function OculusVault({ identity }) {
  const [files,    setFiles]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef(null);

  const addFiles = useCallback((fileList) => {
    const newFiles = Array.from(fileList).map(f => ({
      id:        `${Date.now()}-${f.name}`,
      name:      f.name,
      size:      f.size,
      type:      f.type,
      raw:       f,
      addedAt:   Date.now(),
      status:    null,
      extractedText: null,
      somaAnalysis:  null,
    }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const extractFile = async (file) => {
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'processing' } : f));

    try {
      const fd = new FormData();
      fd.append('file', file.raw);

      // Try backend extraction
      const res = await fetch('/api/soma/extract-text', { method: 'POST', body: fd });

      let extractedText = '';
      if (res.ok) {
        const data = await res.json();
        extractedText = data.text || data.content || '';
      } else {
        // Fallback: read as text for txt/md/csv/json
        const ext = file.name.split('.').pop().toLowerCase();
        if (['txt', 'md', 'csv', 'json'].includes(ext)) {
          extractedText = await file.raw.text();
        } else {
          extractedText = `[Binary file — ${formatBytes(file.size)}. Backend extraction unavailable.]`;
        }
      }

      // Request SOMA analysis if we have text
      let somaAnalysis = null;
      if (extractedText && extractedText.length > 20 && !extractedText.startsWith('[Binary')) {
        try {
          const chatRes = await fetch('/api/soma/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `Analyze this document for a forensic audit team. Identify key facts, anomalies, financial figures, dates, entities, and anything that warrants investigation. Be concise and structured.\n\nDocument: ${file.name}\n\n${extractedText.slice(0, 4000)}`,
              sessionId: `nexus-vault-${Date.now()}`,
            }),
          });
          const chatData = await chatRes.json();
          somaAnalysis = chatData.response || chatData.message || chatData.text || null;
        } catch {}
      }

      setFiles(prev => prev.map(f =>
        f.id === file.id
          ? { ...f, status: 'done', extractedText, somaAnalysis }
          : f
      ));
      setSelected(prev => prev?.id === file.id
        ? { ...prev, status: 'done', extractedText, somaAnalysis }
        : prev
      );
    } catch (e) {
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'error' } : f));
    }
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setSelected(prev => prev?.id === id ? null : prev);
  };

  const exportToCSV = async () => {
    const processed = files.filter(f => f.extractedText);
    if (!processed.length) return;
    setExporting(true);

    const rows = [
      ['Filename', 'Size', 'Added At', 'Extracted Text Preview', 'SOMA Analysis'],
      ...processed.map(f => [
        f.name,
        formatBytes(f.size),
        new Date(f.addedAt).toLocaleString(),
        (f.extractedText || '').slice(0, 500).replace(/\n/g, ' '),
        (f.somaAnalysis || '').replace(/\n/g, ' '),
      ])
    ];

    const csv = rows.map(r =>
      r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `nexus-vault-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>
      {/* Toolbar */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: T.surface,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              padding: '6px 14px',
              background: T.blue,
              border: 'none',
              borderRadius: 5,
              color: '#050506',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 2,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            + ADD FILES
          </button>
          {files.length > 0 && (
            <button
              onClick={() => files.forEach(f => !f.status && extractFile(f))}
              style={{
                padding: '6px 14px',
                background: 'none',
                border: `1px solid ${T.border2}`,
                borderRadius: 5,
                color: T.dim,
                fontSize: 9,
                letterSpacing: 2,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              EXTRACT ALL
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>
            {files.length} FILE{files.length !== 1 ? 'S' : ''}
            {files.filter(f => f.status === 'done').length > 0 &&
              ` · ${files.filter(f => f.status === 'done').length} PROCESSED`}
          </span>
          <button
            onClick={exportToCSV}
            disabled={exporting || !files.some(f => f.extractedText)}
            style={{
              padding: '6px 14px',
              background: 'none',
              border: `1px solid ${T.border2}`,
              borderRadius: 5,
              color: files.some(f => f.extractedText) ? T.success : T.dimmer,
              fontSize: 9,
              letterSpacing: 2,
              cursor: 'pointer',
              fontFamily: 'inherit',
              opacity: exporting ? 0.5 : 1,
            }}
          >
            ↓ EXPORT CSV
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={e => addFiles(e.target.files)}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* File grid + drop zone */}
        <div
          style={{ flex: 1, overflow: 'auto', padding: 20 }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {files.length === 0 ? (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `2px dashed ${dragging ? T.blue : T.border2}`,
              borderRadius: 12,
              transition: 'border-color 0.2s',
              background: dragging ? `rgba(0,170,255,0.04)` : 'transparent',
              minHeight: 300,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.4 }}>⬡</div>
                <div style={{ fontSize: 13, color: dragging ? T.blue : T.dimmer, letterSpacing: 2 }}>
                  {dragging ? 'DROP TO INGEST' : 'DROP FILES HERE'}
                </div>
                <div style={{ fontSize: 10, color: T.dimmer, marginTop: 8, letterSpacing: 1 }}>
                  PDF · XLSX · CSV · TXT · JSON · Images
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              position: 'relative',
              ...(dragging && {
                outline: `2px dashed ${T.blue}`,
                outlineOffset: 4,
                borderRadius: 8,
              }),
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12,
              }}>
                <AnimatePresence>
                  {files.map(f => (
                    <FileCard
                      key={f.id}
                      file={f}
                      selected={selected?.id === f.id}
                      onSelect={setSelected}
                      onExtract={extractFile}
                      onRemove={removeFile}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selected && (
            <div style={{ padding: '16px 16px 16px 0', display: 'flex' }}>
              <DetailPanel
                file={selected}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
