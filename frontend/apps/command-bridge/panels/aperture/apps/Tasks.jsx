import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle, Clock, Plus, Trash2, Search } from 'lucide-react';
import somaBackend from '../../../somaBackend';

const columns = [
  { id: 'todo', label: 'To Do', icon: Clock },
  { id: 'in_progress', label: 'In Progress', icon: AlertCircle },
  { id: 'done', label: 'Complete', icon: CheckCircle }
];

export default function TaskManager({ workspace }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');

  const loadProjects = async () => {
    if (!workspace?.id) return setProjects([]);
    const response = await somaBackend.fetch(`/api/axis/projects?workspaceId=${encodeURIComponent(workspace.id)}`);
    const next = response.projects || [];
    setProjects(next);
    setProjectId(previous => next.some(item => item.id === previous) ? previous : (next[0]?.id || ''));
  };

  const loadTasks = async (activeId = projectId) => {
    if (!activeId) return setTasks([]);
    const response = await somaBackend.fetch(`/api/axis/projects/${activeId}/tasks`);
    setTasks(response.tasks || []);
  };

  useEffect(() => {
    loadProjects().catch(err => setError(err.message));
  }, [workspace?.id]);

  useEffect(() => {
    loadTasks().catch(err => setError(err.message));
  }, [projectId]);

  const createProject = async event => {
    event.preventDefault();
    setError('');
    if (!workspace?.id || !projectName.trim()) return;
    try {
      const response = await somaBackend.fetch('/api/axis/projects', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: workspace.id, name: projectName.trim(), description: 'Created in Aperture Tasks' })
      });
      if (!response || response.error || (response.success !== undefined && !response.success)) {
        return setError(response?.error || 'Unable to create project');
      }
      setProjectName('');
      await loadProjects();
      if (response.project?.id) setProjectId(response.project.id);
    } catch (err) {
      setError(err.message || 'Unable to create project');
    }
  };

  const createTask = async event => {
    event.preventDefault();
    setError('');
    if (!projectId || !title.trim()) return;
    try {
      const response = await somaBackend.fetch(`/api/axis/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description, priority, workspaceId: workspace.id, tags: ['aperture'] })
      });
      if (!response || response.error || (response.success !== undefined && !response.success)) {
        return setError(response?.error || 'Unable to create task');
      }
      setTitle('');
      setDescription('');
      await loadTasks();
    } catch (err) {
      setError(err.message || 'Unable to create task');
    }
  };

  const updateStatus = async (task, status) => {
    await somaBackend.fetch(`/api/axis/projects/${projectId}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await loadTasks();
  };

  const removeTask = async task => {
    await somaBackend.fetch(`/api/axis/projects/${projectId}/tasks/${task.id}`, { method: 'DELETE' });
    await loadTasks();
  };

  useEffect(() => {
    const handleAdvance = () => {
      const firstTodo = tasks.find(t => (t.status || 'todo') === 'todo');
      if (firstTodo) return updateStatus(firstTodo, 'in_progress');
      const firstInProg = tasks.find(t => t.status === 'in_progress');
      if (firstInProg) return updateStatus(firstInProg, 'done');
    };

    const handleCreate = async (e) => {
      const taskTitle = e.detail?.title;
      if (!taskTitle || !projectId) return;
      try {
        await somaBackend.fetch(`/api/axis/projects/${projectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({
            title: taskTitle,
            description: e.detail?.description || 'Autonomous mission task',
            priority: e.detail?.priority || 'medium',
            workspaceId: workspace?.id,
            tags: ['aperture', 'autonomous']
          })
        });
        await loadTasks();
      } catch {}
    };

    window.addEventListener('aperture:task-advance', handleAdvance);
    window.addEventListener('aperture:task-create', handleCreate);
    return () => {
      window.removeEventListener('aperture:task-advance', handleAdvance);
      window.removeEventListener('aperture:task-create', handleCreate);
    };
  }, [tasks, projectId, workspace?.id]);

  if (!workspace) return <div className="ap-empty">Select an Axis workspace to manage tasks.</div>;

  return (
    <div className="ap-task-app">
      <header>
        <div><strong>{workspace.name}</strong><span>Axis task board</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {projects.length > 0 && <select value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
          {tasks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Search size={12} style={{ opacity: 0.6 }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter tasks..."
                style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '11px', width: '110px' }}
              />
            </div>
          )}
        </div>
      </header>
      {error && <p className="ap-inline-error">{error}</p>}
      {!projects.length ? (
        <form className="ap-project-create" onSubmit={createProject}>
          <h3>Create the first project in {workspace.name}</h3>
          <input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Project name" />
          <button><Plus size={14} /> Create Project</button>
        </form>
      ) : (
        <>
          <form className="ap-task-compose" onSubmit={createTask}>
            <input required value={title} onChange={event => setTitle(event.target.value)} placeholder="Add a real Axis task..." />
            <input value={description} onChange={event => setDescription(event.target.value)} placeholder="Description" />
            <select value={priority} onChange={event => setPriority(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
            <button><Plus size={14} /> Add</button>
          </form>
          <div className="ap-kanban">
            {columns.map(column => {
              const query = searchQuery.trim().toLowerCase();
              const entries = tasks.filter(task => (task.status || 'todo') === column.id && (!query || task.title?.toLowerCase().includes(query) || task.description?.toLowerCase().includes(query)));
              return (
                <section key={column.id}>
                  <h3><column.icon size={14} />{column.label}<span>{entries.length}</span></h3>
                  {entries.map(task => (
                    <article key={task.id}>
                      <div><strong>{task.title}</strong><button title="Delete" onClick={() => removeTask(task)}><Trash2 size={12} /></button></div>
                      {task.description && <p>{task.description}</p>}
                      <footer><small>{task.priority || 'medium'}</small>{column.id !== 'done' && <button data-task-advance-btn="true" className="ap-task-advance-btn" title="Advance task status" onClick={() => updateStatus(task, column.id === 'todo' ? 'in_progress' : 'done')}><ArrowRight size={13} /></button>}</footer>
                    </article>
                  ))}
                  {!entries.length && <em>No tasks</em>}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
