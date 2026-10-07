import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const T = {
  bg:      '#09090b',
  surface: '#111113',
  card:    '#18181b',
  border:  'rgba(255,255,255,0.07)',
  border2: 'rgba(255,255,255,0.12)',
  text:    '#fafafa',
  dim:     '#a1a1aa',
  dimmer:  '#52525b',
  blue:    '#00aaff',
  purple:  '#7755ff',
  success: '#33ffaa',
  warning: '#ffaa33',
  danger:  '#ff4455',
};

const STATUS_COLORS = { active: T.blue, completed: T.success, on_hold: T.warning, archived: T.dimmer };
const PRIORITY_COLORS = { high: T.danger, medium: T.warning, low: T.success };
const PROJECT_COLORS = ['#00aaff','#7755ff','#33ffaa','#ffaa33','#ff4488','#44ddff'];

function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then(r => r.json());
}
function formatBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)}KB`;
  return `${(b/1048576).toFixed(1)}MB`;
}
function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Project card ──────────────────────────────────────────────────────────────
function ProjectCard({ project, onClick, onDelete }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={onClick}
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${project.color || T.blue}`,
        borderRadius: 8,
        padding: 18,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      whileHover={{ borderColor: project.color || T.blue }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>{project.icon || '◈'}</span>
          <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{project.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 8, letterSpacing: 1, padding: '2px 6px',
            borderRadius: 8, background: T.border2,
            color: STATUS_COLORS[project.status] || T.dim,
          }}>
            {(project.status || 'active').toUpperCase()}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(project.id); }}
            style={{
              background: 'none', border: 'none', color: T.dimmer,
              cursor: 'pointer', fontSize: 12, padding: '0 4px',
            }}
          >✕</button>
        </div>
      </div>
      {project.description && (
        <div style={{ fontSize: 10, color: T.dim, lineHeight: 1.5 }}>
          {project.description.slice(0, 100)}{project.description.length > 100 ? '...' : ''}
        </div>
      )}
      <div style={{ fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>
        CREATED {timeAgo(project.createdAt)}
      </div>
    </motion.div>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task, onToggle, onDelete }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', borderBottom: `1px solid ${T.border}`,
    }}>
      <button
        onClick={() => onToggle(task)}
        style={{
          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
          background: task.done ? T.success : 'none',
          border: `1px solid ${task.done ? T.success : T.border2}`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#050506', fontSize: 10,
        }}
      >
        {task.done ? '✓' : ''}
      </button>
      <span style={{
        flex: 1, fontSize: 11,
        color: task.done ? T.dimmer : T.text,
        textDecoration: task.done ? 'line-through' : 'none',
      }}>
        {task.title}
      </span>
      {task.assignee && (
        <span style={{ fontSize: 9, color: T.dimmer }}>{task.assignee}</span>
      )}
      <span style={{
        fontSize: 8, letterSpacing: 1,
        color: PRIORITY_COLORS[task.priority] || T.dim,
      }}>
        {task.priority?.toUpperCase()}
      </span>
      <button
        onClick={() => onDelete(task.id)}
        style={{
          background: 'none', border: 'none', color: T.dimmer,
          cursor: 'pointer', fontSize: 11, padding: '0 2px',
        }}
      >✕</button>
    </div>
  );
}

// ── Project view ──────────────────────────────────────────────────────────────
function ProjectView({ project, onBack, identity }) {
  const [tab,       setTab]       = useState('tasks');
  const [tasks,     setTasks]     = useState([]);
  const [files,     setFiles]     = useState([]);
  const [newTask,   setNewTask]   = useState('');
  const [assignee,  setAssignee]  = useState('');
  const [priority,  setPriority]  = useState('medium');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const loadTasks = useCallback(() =>
    api('GET', `/api/workspace/projects/${project.id}/tasks`)
      .then(d => setTasks(d.tasks || [])).catch(() => {}), [project.id]);

  const loadFiles = useCallback(() =>
    api('GET', `/api/workspace/projects/${project.id}/files`)
      .then(d => setFiles(d.files || [])).catch(() => {}), [project.id]);

  useEffect(() => { loadTasks(); loadFiles(); }, [loadTasks, loadFiles]);

  const addTask = async () => {
    if (!newTask.trim()) return;
    await api('POST', `/api/workspace/projects/${project.id}/tasks`, {
      title: newTask.trim(), assignee, priority,
    });
    setNewTask(''); setAssignee('');
    loadTasks();
  };

  const toggleTask = async (task) => {
    await api('PUT', `/api/workspace/tasks/${task.id}`, { done: !task.done });
    loadTasks();
  };

  const deleteTask = async (id) => {
    await api('DELETE', `/api/workspace/tasks/${id}`);
    loadTasks();
  };

  const uploadFile = async (fileList) => {
    setUploading(true);
    for (const f of Array.from(fileList)) {
      const fd = new FormData();
      fd.append('file', f);
      await fetch(`/api/workspace/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'x-tie-user-name': identity?.name || 'Unknown' },
        body: fd,
      });
    }
    setUploading(false);
    loadFiles();
  };

  const deleteFile = async (id) => {
    await api('DELETE', `/api/workspace/files/${id}`);
    loadFiles();
  };

  const doneTasks  = tasks.filter(t => t.done).length;
  const totalTasks = tasks.length;

  const TABS = ['tasks', 'files', 'overview'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: `1px solid ${T.border2}`,
            borderRadius: 4, color: T.dim, cursor: 'pointer',
            padding: '4px 10px', fontSize: 10, fontFamily: 'inherit',
            letterSpacing: 1,
          }}
        >
          ← BACK
        </button>
        <span style={{ fontSize: 18 }}>{project.icon}</span>
        <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{project.name}</span>
        <div style={{
          marginLeft: 'auto', display: 'flex',
          borderLeft: `1px solid ${T.border}`, paddingLeft: 12,
          gap: 6,
        }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 12px',
                background: tab === t ? `rgba(0,170,255,0.1)` : 'none',
                border: `1px solid ${tab === t ? T.blue : 'transparent'}`,
                borderRadius: 4, color: tab === t ? T.blue : T.dim,
                fontSize: 9, letterSpacing: 2, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {/* TASKS */}
        {tab === 'tasks' && (
          <div style={{ maxWidth: 700 }}>
            {/* Progress */}
            {totalTasks > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 9, letterSpacing: 2, color: T.dimmer }}>PROGRESS</span>
                  <span style={{ fontSize: 9, color: T.dim }}>{doneTasks}/{totalTasks}</span>
                </div>
                <div style={{ height: 3, background: T.border2, borderRadius: 2 }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: `${totalTasks ? (doneTasks/totalTasks)*100 : 0}%`,
                    background: T.success, transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            )}

            {/* Add task */}
            <div style={{
              background: T.card, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: 14, marginBottom: 16,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <input
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTask()}
                placeholder="New task..."
                style={{
                  background: 'none', border: 'none', color: T.text,
                  fontSize: 12, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={assignee}
                  onChange={e => setAssignee(e.target.value)}
                  placeholder="Assignee (optional)"
                  style={{
                    flex: 1, background: T.surface, border: `1px solid ${T.border}`,
                    borderRadius: 4, color: T.dim, fontSize: 10,
                    padding: '4px 8px', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  style={{
                    background: T.surface, border: `1px solid ${T.border}`,
                    borderRadius: 4, color: T.dim, fontSize: 10,
                    padding: '4px 8px', fontFamily: 'inherit', outline: 'none',
                  }}
                >
                  <option value="low">LOW</option>
                  <option value="medium">MEDIUM</option>
                  <option value="high">HIGH</option>
                </select>
                <button
                  onClick={addTask}
                  disabled={!newTask.trim()}
                  style={{
                    padding: '4px 14px', background: T.blue, border: 'none',
                    borderRadius: 4, color: '#050506', fontSize: 9, fontWeight: 700,
                    cursor: newTask.trim() ? 'pointer' : 'default',
                    fontFamily: 'inherit', letterSpacing: 1,
                    opacity: newTask.trim() ? 1 : 0.4,
                  }}
                >
                  ADD
                </button>
              </div>
            </div>

            {/* Task list */}
            {tasks.length === 0 ? (
              <div style={{ textAlign: 'center', fontSize: 10, color: T.dimmer, padding: 24, letterSpacing: 1 }}>
                NO TASKS YET
              </div>
            ) : (
              tasks.map(t => (
                <TaskRow key={t.id} task={t} onToggle={toggleTask} onDelete={deleteTask} />
              ))
            )}
          </div>
        )}

        {/* FILES */}
        {tab === 'files' && (
          <div style={{ maxWidth: 700 }}>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); uploadFile(e.dataTransfer.files); }}
              style={{
                border: `2px dashed ${T.border2}`,
                borderRadius: 8, padding: 32, textAlign: 'center',
                marginBottom: 16, cursor: 'pointer',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ fontSize: 10, color: T.dimmer, letterSpacing: 1 }}>
                {uploading ? 'UPLOADING...' : 'DROP FILES OR CLICK TO UPLOAD'}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => uploadFile(e.target.files)}
              />
            </div>

            {files.length === 0 ? (
              <div style={{ textAlign: 'center', fontSize: 10, color: T.dimmer, padding: 16, letterSpacing: 1 }}>
                NO FILES
              </div>
            ) : (
              files.map(f => (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderBottom: `1px solid ${T.border}`,
                }}>
                  <span style={{ fontSize: 14 }}>
                    {f.mimetype?.includes('pdf') ? '📄' : f.mimetype?.includes('image') ? '🖼️' :
                     f.mimetype?.includes('spreadsheet') || f.originalName?.endsWith('.xlsx') ? '📊' : '📁'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: T.text }}>{f.originalName}</div>
                    <div style={{ fontSize: 9, color: T.dimmer, marginTop: 2 }}>
                      {formatBytes(f.size)} · {f.uploadedBy} · {timeAgo(f.uploadedAt)}
                    </div>
                  </div>
                  <a
                    href={`/api/workspace/files/${f.id}/download`}
                    download={f.originalName}
                    style={{
                      padding: '4px 10px', background: 'none',
                      border: `1px solid ${T.border2}`, borderRadius: 4,
                      color: T.dim, fontSize: 9, textDecoration: 'none',
                      fontFamily: 'inherit', letterSpacing: 1,
                    }}
                  >
                    ↓
                  </a>
                  <button
                    onClick={() => deleteFile(f.id)}
                    style={{
                      background: 'none', border: 'none', color: T.dimmer,
                      cursor: 'pointer', fontSize: 12,
                    }}
                  >✕</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ maxWidth: 500 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'STATUS',   value: (project.status || 'active').toUpperCase(), color: STATUS_COLORS[project.status] || T.blue },
                { label: 'TASKS',    value: `${doneTasks}/${totalTasks}`, color: T.text },
                { label: 'FILES',    value: files.length, color: T.text },
                { label: 'CREATED',  value: timeAgo(project.createdAt), color: T.dim },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 8, padding: 14,
                }}>
                  <div style={{ fontSize: 8, letterSpacing: 2, color: T.dimmer, marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 16, color }}>{value}</div>
                </div>
              ))}
            </div>
            {project.description && (
              <div style={{
                background: T.card, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: 16,
              }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: T.dimmer, marginBottom: 8 }}>DESCRIPTION</div>
                <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.7 }}>{project.description}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main WorkspaceModule ───────────────────────────────────────────────────────
export default function WorkspaceModule({ identity }) {
  const [projects,  setProjects]  = useState([]);
  const [active,    setActive]    = useState(null);
  const [creating,  setCreating]  = useState(false);
  const [form,      setForm]      = useState({ name: '', description: '', color: PROJECT_COLORS[0], icon: '◈', status: 'active' });
  const ICONS = ['◈', '⬡', '◇', '⚑', '⬢', '◉', '★', '⊕', '🔬', '📊', '🛡️', '🔐'];

  const loadProjects = useCallback(() =>
    api('GET', '/api/workspace/projects')
      .then(d => setProjects(d.projects || [])).catch(() => {}), []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const createProject = async () => {
    if (!form.name.trim()) return;
    await api('POST', '/api/workspace/projects', form);
    setCreating(false);
    setForm({ name: '', description: '', color: PROJECT_COLORS[0], icon: '◈', status: 'active' });
    loadProjects();
  };

  const deleteProject = async (id) => {
    if (!confirm('Delete this project and all its data?')) return;
    await api('DELETE', `/api/workspace/projects/${id}`);
    loadProjects();
  };

  if (active) {
    return (
      <ProjectView
        project={active}
        onBack={() => { setActive(null); loadProjects(); }}
        identity={identity}
      />
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>
      {/* Toolbar */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: T.dimmer }}>
          WORKSPACES · {projects.length}
        </span>
        <button
          onClick={() => setCreating(true)}
          style={{
            padding: '6px 14px', background: T.blue, border: 'none',
            borderRadius: 5, color: '#050506', fontSize: 9, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 2,
          }}
        >
          + NEW PROJECT
        </button>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(5,5,6,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setCreating(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: 420, background: T.card, border: `1px solid ${T.border}`,
                borderRadius: 12, padding: 28,
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: 3, color: T.dimmer, marginBottom: 20 }}>
                NEW PROJECT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && createProject()}
                  placeholder="Project name"
                  style={{
                    background: T.surface, border: `1px solid ${T.border}`,
                    borderRadius: 6, color: T.text, fontSize: 12,
                    padding: '10px 12px', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Description (optional)"
                  rows={2}
                  style={{
                    background: T.surface, border: `1px solid ${T.border}`,
                    borderRadius: 6, color: T.dim, fontSize: 11,
                    padding: '8px 12px', fontFamily: 'inherit', outline: 'none', resize: 'none',
                  }}
                />
                {/* Icon */}
                <div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: T.dimmer, marginBottom: 6 }}>ICON</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ICONS.map(ic => (
                      <button
                        key={ic}
                        onClick={() => setForm(f => ({ ...f, icon: ic }))}
                        style={{
                          width: 32, height: 32, borderRadius: 6, fontSize: 14,
                          background: form.icon === ic ? `rgba(0,170,255,0.15)` : T.surface,
                          border: `1px solid ${form.icon === ic ? T.blue : T.border}`,
                          cursor: 'pointer',
                        }}
                      >{ic}</button>
                    ))}
                  </div>
                </div>
                {/* Color */}
                <div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: T.dimmer, marginBottom: 6 }}>COLOR</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {PROJECT_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        style={{
                          width: 24, height: 24, borderRadius: '50%', background: c,
                          border: `2px solid ${form.color === c ? T.text : 'transparent'}`,
                          cursor: 'pointer',
                          boxShadow: form.color === c ? `0 0 8px ${c}` : 'none',
                          transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
                          transition: 'all 0.1s',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={createProject}
                    disabled={!form.name.trim()}
                    style={{
                      flex: 1, padding: '10px', background: T.blue, border: 'none',
                      borderRadius: 6, color: '#050506', fontSize: 10, fontWeight: 700,
                      cursor: form.name.trim() ? 'pointer' : 'default',
                      fontFamily: 'inherit', letterSpacing: 2,
                      opacity: form.name.trim() ? 1 : 0.4,
                    }}
                  >
                    CREATE
                  </button>
                  <button
                    onClick={() => setCreating(false)}
                    style={{
                      padding: '10px 16px', background: 'none',
                      border: `1px solid ${T.border2}`, borderRadius: 6,
                      color: T.dim, fontSize: 10, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {projects.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ fontSize: 32, opacity: 0.2 }}>◈</div>
            <div style={{ fontSize: 10, color: T.dimmer, letterSpacing: 2 }}>NO PROJECTS</div>
            <button
              onClick={() => setCreating(true)}
              style={{
                padding: '8px 20px', background: T.blue, border: 'none',
                borderRadius: 6, color: '#050506', fontSize: 10, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 2,
              }}
            >
              CREATE YOUR FIRST PROJECT
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}>
            <AnimatePresence>
              {projects.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onClick={() => setActive(p)}
                  onDelete={deleteProject}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
