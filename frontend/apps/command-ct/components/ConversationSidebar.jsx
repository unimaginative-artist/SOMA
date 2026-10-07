import React from 'react';
import { ChevronLeft, ChevronRight, Download, Edit3, MessageSquare, Plus, Trash2 } from 'lucide-react';

export function ConversationSidebar({ collapsed, onToggle, conversations, activeId, historyCount, search, onSearch, onNew, onSelect, onDelete, onEditIcon, onExport, getIcon }) {
  const visible = conversations
    .filter(conversation => !search.trim() || `${conversation.title || ''} ${(conversation.messages || []).map(message => typeof message.content === 'string' ? message.content : '').join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.pinned || 0) - Number(a.pinned || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} flex flex-col overflow-hidden border-r border-white/5 bg-[#151518]/80 backdrop-blur-xl transition-all duration-300`} aria-label="Conversations">
      <div className="flex items-center justify-between border-b border-white/5 p-4">
        {!collapsed && <h2 className="text-sm font-bold uppercase tracking-wider text-white">Chats</h2>}
        <button onClick={onToggle} aria-label={collapsed ? 'Expand conversations' : 'Collapse conversations'} className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden p-2">
        <button onClick={onNew} className="btn mb-4 w-full" title="New Chat">{collapsed ? <Plus className="h-5 w-5" /> : 'New Chat'}</button>
        {historyCount > 0 && (
          <div className={`mb-3 flex gap-2 ${collapsed ? 'justify-center' : ''}`}>
            <button onClick={() => onExport('json')} className="flex items-center justify-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20" title="Export JSON"><Download className="h-3 w-3" />{!collapsed && 'JSON'}</button>
            {!collapsed && <button onClick={() => onExport('markdown')} className="flex items-center justify-center gap-1 rounded-lg border border-purple-500/20 bg-purple-500/10 px-2 py-1.5 text-[10px] font-semibold text-purple-400 hover:bg-purple-500/20" title="Export Markdown"><Download className="h-3 w-3" />MD</button>}
          </div>
        )}
        {!collapsed && <input value={search} onChange={event => onSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="mb-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-500/40" />}
        <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto">
          {visible.length === 0 ? <div className="py-8 text-center text-xs text-zinc-600"><MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-30" />{!collapsed && <p>No conversations found</p>}</div> : visible.map(conversation => (
            <div key={conversation.id} role="button" tabIndex={0} onClick={() => onSelect(conversation.id)} onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && onSelect(conversation.id)} className={`group relative cursor-pointer rounded-lg border transition-all ${collapsed ? 'flex justify-center p-2' : 'p-3'} ${conversation.id === activeId ? 'border-white/10 bg-white/10 shadow-lg' : 'border-transparent hover:bg-white/5'}`} title={conversation.title}>
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="group/icon relative shrink-0">
                  <img src={getIcon(conversation)} alt="" className={`${collapsed ? 'h-10 w-10' : 'h-8 w-8'} object-contain ${conversation.id === activeId ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]' : 'opacity-90'}`} />
                  <button onClick={event => { event.stopPropagation(); onEditIcon(conversation.id); }} aria-label="Change conversation icon" className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 opacity-0 transition-opacity group-hover/icon:opacity-100"><Edit3 className="h-3 w-3 text-white" /></button>
                </div>
                {!collapsed && <h4 className={`line-clamp-1 flex-1 text-sm font-medium ${conversation.id === activeId ? 'text-white' : 'text-zinc-300'}`}>{conversation.title || 'Untitled Chat'}</h4>}
                {!collapsed && <button onClick={event => onDelete(conversation.id, event)} aria-label={`Delete ${conversation.title || 'conversation'}`} className="rounded p-1 text-zinc-600 opacity-0 hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

