import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, Plus, CheckSquare, Square, Flag, Calendar, User, MessageSquare,
    ChevronDown, Send, Loader, AlertCircle, Clock, CheckCircle2, Circle,
    Briefcase, Bot,
} from 'lucide-react';
import { useAxis } from './AxisContext';

const PRIORITY_CONFIG = {
    urgent: { label: 'Urgent', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
    high:   { label: 'High',   color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
    medium: { label: 'Medium', color: '#eab308', bg: 'rgba(234,179,8,0.12)'  },
    low:    { label: 'Low',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
};

const STATUS_CONFIG = {
    todo:        { label: 'To Do',       icon: Circle,       color: '#71717a' },
    in_progress: { label: 'In Progress', icon: Clock,        color: '#818cf8' },
    review:      { label: 'In Review',   icon: AlertCircle,  color: '#f59e0b' },
    done:        { label: 'Done',        icon: CheckCircle2, color: '#22c55e' },
};

function StatusBadge({ status, onChange }) {
    const [open, setOpen] = useState(false);
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.todo;
    const Icon = cfg.icon;
    return (
        <div style={{ position: 'relative' }}>
            <button onClick={() => setOpen(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)', cursor: 'pointer', color: cfg.color,
            }}>
                <Icon size={12} />
                <span style={{ fontSize: 11, fontWeight: 600 }}>{cfg.label}</span>
                <ChevronDown size={10} />
            </button>
            {open && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
                    background: '#1a1d24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden', minWidth: 130,
                }}>
                    {Object.entries(STATUS_CONFIG).map(([key, s]) => {
                        const SI = s.icon;
                        return (
                            <button key={key} onClick={() => { onChange(key); setOpen(false); }} style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                                color: s.color, textAlign: 'left', transition: 'background 0.1s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                                <SI size={12} />
                                <span style={{ fontSize: 12, fontWeight: 500 }}>{s.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function PriorityBadge({ priority, onChange }) {
    const [open, setOpen] = useState(false);
    const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
    return (
        <div style={{ position: 'relative' }}>
            <button onClick={() => setOpen(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                borderRadius: 6, background: cfg.bg, border: `1px solid ${cfg.color}30`,
                cursor: 'pointer', color: cfg.color,
            }}>
                <Flag size={10} />
                <span style={{ fontSize: 11, fontWeight: 600 }}>{cfg.label}</span>
                <ChevronDown size={10} />
            </button>
            {open && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
                    background: '#1a1d24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden', minWidth: 120,
                }}>
                    {Object.entries(PRIORITY_CONFIG).map(([key, p]) => (
                        <button key={key} onClick={() => { onChange(key); setOpen(false); }} style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                            color: p.color, textAlign: 'left',
                        }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                            <Flag size={10} />
                            <span style={{ fontSize: 12, fontWeight: 500 }}>{p.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Task Detail Panel ─────────────────────────────────────────────────────────
function TaskDetail({ task, projectId, onClose, onUpdate, contacts = [] }) {
    const { addTaskComment, user, updateTask } = useAxis();
    const [comments, setComments]       = useState([]);
    const [newComment, setNewComment]   = useState('');
    const [posting, setPosting]         = useState(false);
    const [somaChat, setSomaChat]       = useState('');
    const [somaReply, setSomaReply]     = useState('');
    const [somaLoading, setSomaLoading] = useState(false);
    const [tab, setTab]                 = useState('comments');
    const [editAssignee, setEditAssignee] = useState(false);
    const commentEndRef                 = useRef(null);

    useEffect(() => {
        if (!task?.id || !projectId) return;
        fetch(`/api/axis/projects/${projectId}/tasks/${task.id}/comments`)
            .then(r => r.json())
            .then(d => { if (d.ok) setComments(d.comments); })
            .catch(() => {});
    }, [task?.id, projectId]);

    useEffect(() => {
        commentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comments]);

    const handleStatusChange = async (status) => {
        const updated = await updateTask(projectId, task.id, { status });
        if (updated?.ok) onUpdate?.({ ...task, status });
    };

    const handlePriorityChange = async (priority) => {
        const updated = await updateTask(projectId, task.id, { priority });
        if (updated?.ok) onUpdate?.({ ...task, priority });
    };

    const postComment = async () => {
        if (!newComment.trim() || posting) return;
        setPosting(true);
        const r = await addTaskComment(projectId, task.id, newComment.trim());
        setPosting(false);
        if (r?.ok) {
            setComments(prev => [...prev, r.comment]);
            setNewComment('');
        }
    };

    const askSoma = async () => {
        if (!somaChat.trim() || somaLoading) return;
        const prompt = somaChat.trim();
        setSomaLoading(true);
        setSomaChat('');
        try {
            const context = `[TASK CONTEXT]\nProject: ${task.project_id || projectId}\nTask: ${task.title}\nDescription: ${task.description || 'None'}\nStatus: ${task.status || 'todo'}\nPriority: ${task.priority || 'medium'}\nAssignee: ${task.assignee_name || 'Unassigned'}\n\nQuestion: ${prompt}`;
            const res = await fetch('/api/soma/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: context, conversationHistory: [], sessionId: `task-${task.id}` }),
            });
            const data = await res.json();
            setSomaReply(data.response || data.message || 'No response');
        } catch {
            setSomaReply('SOMA is not available right now.');
        }
        setSomaLoading(false);
    };

    if (!task) return null;
    const pcfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
    const scfg = STATUS_CONFIG[task.status]     || STATUS_CONFIG.todo;
    const SIcon = scfg.icon;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Task header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <SIcon size={16} color={scfg.color} style={{ marginTop: 3, flexShrink: 0 }} />
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f1f3', lineHeight: 1.3, flex: 1, margin: 0 }}>{task.title}</h2>
                </div>
                {/* Controls row */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <StatusBadge status={task.status || 'todo'} onChange={handleStatusChange} />
                    <PriorityBadge priority={task.priority || 'medium'} onChange={handlePriorityChange} />
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setEditAssignee(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
                            <User size={11} color="#71717a" />
                            <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 500 }}>{task.assignee_name || 'Assign'}</span>
                        </button>
                        {editAssignee && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 60, background: '#1a1d24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden', minWidth: 150 }}>
                                <button onClick={() => { updateTask(projectId, task.id, { assigneeId: '', assigneeName: '' }).then(r => { if (r?.ok) { onUpdate?.({ ...task, assignee_id: '', assignee_name: '' }); setEditAssignee(false); } }); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', textAlign: 'left', fontSize: 12 }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                >Unassigned</button>
                                {contacts.map(c => (
                                    <button key={c.id} onClick={() => { updateTask(projectId, task.id, { assigneeId: c.id, assigneeName: c.user_name || c.name }).then(r => { if (r?.ok) { onUpdate?.({ ...task, assignee_id: c.id, assignee_name: c.user_name || c.name }); setEditAssignee(false); } }); }}
                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#d4d4d8', textAlign: 'left', fontSize: 12 }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                    >{c.user_name || c.name}</button>
                                ))}
                            </div>
                        )}
                    </div>
                    {task.due_date && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <Calendar size={11} color="#71717a" />
                            <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 500 }}>{task.due_date}</span>
                        </div>
                    )}
                </div>
                {task.description && (
                    <p style={{ fontSize: 12, color: '#71717a', lineHeight: 1.5, marginTop: 10, margin: '10px 0 0' }}>{task.description}</p>
                )}
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                {[['comments', 'Comments', MessageSquare], ['soma', 'Ask SOMA', Bot]].map(([key, label, Icon]) => (
                    <button key={key} onClick={() => setTab(key)} style={{
                        padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                        color: tab === key ? '#818cf8' : '#52525b',
                        borderBottom: tab === key ? '2px solid #818cf8' : '2px solid transparent',
                        transition: 'all 0.1s',
                    }}>
                        <Icon size={13} /> {label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {tab === 'comments' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {comments.length === 0 && (
                            <p style={{ fontSize: 12, color: '#3f3f46', textAlign: 'center', paddingTop: 20 }}>No comments yet</p>
                        )}
                        {comments.map(c => (
                            <div key={c.id} style={{ display: 'flex', gap: 8 }}>
                                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#818cf8' }}>
                                    {(c.author_name || c.authorName || '?')[0].toUpperCase()}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa' }}>{c.author_name || c.authorName}</span>
                                        <span style={{ fontSize: 9, color: '#3f3f46' }}>{new Date(c.created_at || c.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <p style={{ fontSize: 12, color: '#d4d4d8', lineHeight: 1.5, margin: 0 }}>{c.content}</p>
                                </div>
                            </div>
                        ))}
                        <div ref={commentEndRef} />
                    </div>
                    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, display: 'flex', gap: 8 }}>
                        <input
                            value={newComment} onChange={e => setNewComment(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && postComment()}
                            placeholder="Add a comment…"
                            style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#e4e4e7', outline: 'none', fontFamily: 'inherit' }}
                        />
                        <button onClick={postComment} disabled={!newComment.trim() || posting} style={{
                            padding: '7px 12px', borderRadius: 8, background: newComment.trim() ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.2)',
                            border: 'none', color: '#fff', cursor: newComment.trim() ? 'pointer' : 'default',
                        }}>
                            {posting ? <Loader size={13} className="animate-spin" /> : <Send size={13} />}
                        </button>
                    </div>
                </div>
            )}

            {tab === 'soma' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                        {!somaReply && !somaLoading && (
                            <div style={{ textAlign: 'center', paddingTop: 24, color: '#3f3f46' }}>
                                <Bot size={28} style={{ margin: '0 auto 10px', display: 'block' }} />
                                <p style={{ fontSize: 12 }}>Ask SOMA anything about this task</p>
                                <p style={{ fontSize: 11, marginTop: 4 }}>Suggest next steps, draft a plan, review requirements…</p>
                            </div>
                        )}
                        {somaLoading && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#52525b' }}>
                                <Loader size={14} className="animate-spin" />
                                <span style={{ fontSize: 12 }}>SOMA is thinking…</span>
                            </div>
                        )}
                        {somaReply && (
                            <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10, padding: '12px 14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                    <Bot size={12} color="#818cf8" />
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>SOMA</span>
                                </div>
                                <p style={{ fontSize: 12, color: '#d4d4d8', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{somaReply}</p>
                            </div>
                        )}
                    </div>
                    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, display: 'flex', gap: 8 }}>
                        <input
                            value={somaChat} onChange={e => setSomaChat(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askSoma()}
                            placeholder="Ask SOMA about this task…"
                            style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#e4e4e7', outline: 'none', fontFamily: 'inherit' }}
                        />
                        <button onClick={askSoma} disabled={!somaChat.trim() || somaLoading} style={{
                            padding: '7px 12px', borderRadius: 8, background: somaChat.trim() ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.2)',
                            border: 'none', color: '#fff', cursor: somaChat.trim() ? 'pointer' : 'default',
                        }}>
                            {somaLoading ? <Loader size={13} /> : <Send size={13} />}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Task Window Modal ─────────────────────────────────────────────────────────
export function TaskWindowModal({ project, onClose }) {
    const { tasks, loadTasks, createTask, updateTask, deleteTask, user, activeProjectId, setActiveProjectId, hdrs } = useAxis();
    const [activeTask, setActiveTask]   = useState(null);
    const [showCreate, setShowCreate]   = useState(false);
    const [newTitle, setNewTitle]       = useState('');
    const [newPriority, setNewPriority] = useState('medium');
    const [newAssignee, setNewAssignee] = useState(null); // { id, name }
    const [contacts, setContacts]       = useState([]);
    const [creating, setCreating]       = useState(false);
    const projId = project?.id || activeProjectId;

    useEffect(() => {
        fetch('/api/axis/contacts', { headers: hdrs?.() || {} })
            .then(r => r.json())
            .then(d => { if (d.ok) setContacts(d.contacts || []); })
            .catch(() => {});
    }, []); // eslint-disable-line

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') { if (activeTask) setActiveTask(null); else onClose(); } };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose, activeTask]);

    useEffect(() => {
        if (projId) {
            if (projId !== activeProjectId) setActiveProjectId(projId);
            loadTasks(projId);
        }
    }, [projId]); // eslint-disable-line

    const handleCreate = async () => {
        if (!newTitle.trim() || creating || !projId) return;
        setCreating(true);
        await createTask(projId, {
            title: newTitle.trim(),
            priority: newPriority,
            assigneeId: newAssignee?.id || '',
            assigneeName: newAssignee?.name || '',
        });
        setCreating(false);
        setNewTitle('');
        setNewAssignee(null);
        setShowCreate(false);
    };

    const handleStatusChange = async (taskId, status) => {
        await updateTask(projId, taskId, { status });
    };

    const grouped = {
        todo:        tasks.filter(t => !t.status || t.status === 'todo'),
        in_progress: tasks.filter(t => t.status === 'in_progress'),
        review:      tasks.filter(t => t.status === 'review'),
        done:        tasks.filter(t => t.status === 'done'),
    };

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 24,
        }}>
            <div style={{
                width: '100%', maxWidth: 920, height: '85vh',
                background: '#0f1014', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 18, boxShadow: '0 48px 120px rgba(0,0,0,0.8)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0d0f13', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{project?.icon || '📁'}</span>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0' }}>{project?.name || 'Tasks'}</div>
                            <div style={{ fontSize: 10, color: '#3f3f46', fontFamily: "'Geist Mono', monospace", marginTop: 1 }}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setShowCreate(v => !v)} style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                            borderRadius: 8, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)',
                            color: '#818cf8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>
                            <Plus size={13} /> New Task
                        </button>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4 }}>
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* New task form */}
                {showCreate && (
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(99,102,241,0.05)', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCreate()}
                            placeholder="Task title…"
                            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '6px 10px', fontSize: 13, color: '#e4e4e7', outline: 'none', fontFamily: 'inherit' }}
                        />
                        <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: '#a1a1aa', cursor: 'pointer' }}>
                            {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <select
                            value={newAssignee?.id || ''}
                            onChange={e => {
                                const c = contacts.find(x => x.id === e.target.value);
                                setNewAssignee(c ? { id: c.id, name: c.user_name || c.name } : null);
                            }}
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: '#a1a1aa', cursor: 'pointer' }}
                        >
                            <option value="">Unassigned</option>
                            {contacts.map(c => <option key={c.id} value={c.id}>{c.user_name || c.name}</option>)}
                        </select>
                        <button onClick={handleCreate} disabled={!newTitle.trim() || creating} style={{ padding: '6px 14px', borderRadius: 7, background: newTitle.trim() ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.2)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: newTitle.trim() ? 'pointer' : 'default' }}>
                            {creating ? '…' : 'Add'}
                        </button>
                        <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X size={14} /></button>
                    </div>
                )}

                {/* Body: task list + detail */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                    {/* Task list */}
                    <div style={{ width: activeTask ? 320 : '100%', minWidth: activeTask ? 280 : 0, borderRight: activeTask ? '1px solid rgba(255,255,255,0.06)' : 'none', overflowY: 'auto', padding: '8px 0' }}>
                        {Object.entries(grouped).map(([status, items]) => {
                            if (items.length === 0) return null;
                            const scfg = STATUS_CONFIG[status];
                            const SIco = scfg.icon;
                            return (
                                <div key={status} style={{ marginBottom: 4 }}>
                                    <div style={{ padding: '6px 16px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <SIco size={11} color={scfg.color} />
                                        <span style={{ fontSize: 10, fontWeight: 600, color: scfg.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{scfg.label}</span>
                                        <span style={{ fontSize: 9, color: '#3f3f46', marginLeft: 4 }}>{items.length}</span>
                                    </div>
                                    {items.map(task => {
                                        const pcfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                                        const isActive = task.id === activeTask?.id;
                                        return (
                                            <div key={task.id} onClick={() => setActiveTask(task)} style={{
                                                margin: '2px 8px', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                                                background: isActive ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                                                border: `1px solid ${isActive ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)'}`,
                                                transition: 'all 0.1s',
                                            }}
                                                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                                                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                                    <div onClick={e => { e.stopPropagation(); handleStatusChange(task.id, status === 'done' ? 'todo' : 'done'); }}
                                                        style={{ marginTop: 1, flexShrink: 0, cursor: 'pointer', color: status === 'done' ? '#22c55e' : '#3f3f46' }}>
                                                        {status === 'done' ? <CheckSquare size={14} /> : <Square size={14} />}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <p style={{ fontSize: 13, color: status === 'done' ? '#52525b' : '#d4d4d8', margin: 0, lineHeight: 1.3, textDecoration: status === 'done' ? 'line-through' : 'none' }}>{task.title}</p>
                                                        {task.assignee_name && <p style={{ fontSize: 10, color: '#52525b', margin: '3px 0 0' }}>{task.assignee_name}</p>}
                                                    </div>
                                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: pcfg.color, flexShrink: 0, marginTop: 4 }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                        {tasks.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '48px 24px', color: '#3f3f46' }}>
                                <CheckSquare size={28} style={{ margin: '0 auto 12px', display: 'block' }} />
                                <p style={{ fontSize: 13, marginBottom: 6 }}>No tasks yet</p>
                                <p style={{ fontSize: 11 }}>Click "New Task" to add one</p>
                            </div>
                        )}
                    </div>

                    {/* Task detail */}
                    {activeTask && (
                        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                            <TaskDetail
                                task={activeTask}
                                projectId={projId}
                                contacts={contacts}
                                onClose={() => setActiveTask(null)}
                                onUpdate={(updated) => setActiveTask(updated)}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
