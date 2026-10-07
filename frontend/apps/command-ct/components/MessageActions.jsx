import React, { useState } from 'react';
import { Check, Copy, GitBranch, Pencil, Pin, RefreshCw, X } from 'lucide-react';

export function MessageActions({ item, onEdit, onRetry, onBranch, onPin }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(typeof item.content === 'string' ? item.content : '');
  const [copied, setCopied] = useState(false);
  const editable = item.type === 'command' && typeof item.content === 'string';
  const retryable = ['command', 'response', 'error'].includes(item.type);

  const copy = async () => {
    await navigator.clipboard.writeText(typeof item.content === 'string' ? item.content : '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (editing) {
    return (
      <div className="mt-2 flex items-start gap-2">
        <textarea value={draft} onChange={event => setDraft(event.target.value)} autoFocus className="min-h-20 flex-1 rounded-lg border border-cyan-500/30 bg-black/30 p-2 text-sm text-zinc-100 outline-none" />
        <button aria-label="Save edit" onClick={() => { onEdit?.(draft); setEditing(false); }} className="rounded p-1 text-emerald-300 hover:bg-white/5"><Check className="h-4 w-4" /></button>
        <button aria-label="Cancel edit" onClick={() => setEditing(false)} className="rounded p-1 text-zinc-400 hover:bg-white/5"><X className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" aria-label="Message actions">
      <button aria-label="Copy message" title="Copy" onClick={copy} className="rounded p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-300">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>
      {editable && <button aria-label="Edit message" title="Edit" onClick={() => setEditing(true)} className="rounded p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-300"><Pencil className="h-3.5 w-3.5" /></button>}
      {retryable && <button aria-label="Retry from message" title="Retry" onClick={onRetry} className="rounded p-1 text-zinc-600 hover:bg-white/5 hover:text-cyan-300"><RefreshCw className="h-3.5 w-3.5" /></button>}
      <button aria-label="Branch conversation here" title="Branch here" onClick={onBranch} className="rounded p-1 text-zinc-600 hover:bg-white/5 hover:text-violet-300"><GitBranch className="h-3.5 w-3.5" /></button>
      <button aria-label={item.pinned ? 'Unpin message' : 'Pin message'} title={item.pinned ? 'Unpin' : 'Pin'} onClick={onPin} className={`rounded p-1 hover:bg-white/5 ${item.pinned ? 'text-amber-300' : 'text-zinc-600 hover:text-amber-300'}`}><Pin className="h-3.5 w-3.5" /></button>
    </div>
  );
}

