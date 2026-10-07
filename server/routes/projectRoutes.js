import express from 'express';
import axisStore from '../axis/AxisStore.js';

export default function createProjectRoutes(system) {
    const router = express.Router();
    const bcast  = (event, data) => system?.wss?.clients?.forEach(c => c.readyState === 1 && c.send(JSON.stringify({ type: event, ...data })));

    const getUser = (req) => ({
        userId:    req.headers['x-axis-user-id']    || 'anon',
        userName:  req.headers['x-axis-user-name']  || 'Anonymous',
        userColor: req.headers['x-axis-user-color'] || 'blue',
        userAvatar: req.headers['x-axis-user-avatar'] || '',
    });
    const canManage = (projectId, userId, allowed = ['owner', 'contributor', 'reviewer']) => {
        const project = axisStore.getProject(projectId);
        if (!project) return { ok: false, status: 404, error: 'Project not found' };
        if (project.created_by === userId) return { ok: true, project, role: 'owner' };
        const member = axisStore.getProjectMember(projectId, userId);
        const role = member?.role || '';
        if (!allowed.includes(role)) return { ok: false, status: 403, error: 'Project permission denied' };
        return { ok: true, project, role };
    };
    const logActivity = (projectId, req, action, targetType, targetId, summary, metadata = {}) => {
        try {
            const u = getUser(req);
            return axisStore.addProjectActivity({ projectId, actorId: u.userId, actorName: u.userName, action, targetType, targetId, summary, metadata });
        } catch { return null; }
    };

    // ── Projects ──────────────────────────────────────────────────────────────
    router.get('/', (req, res) => {
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId required' });
        res.json({ ok: true, projects: axisStore.getProjects(workspaceId) });
    });

    router.post('/', (req, res) => {
        try {
            const u = getUser(req);
            const { workspaceId, name, description, icon, color } = req.body || {};
            if (!workspaceId || !name?.trim()) return res.status(400).json({ ok: false, error: 'workspaceId and name required' });
            const project = axisStore.createProject({ workspaceId, name: name.trim(), description, icon, color, createdBy: u.userId, createdByName: u.userName });
            axisStore.addProjectActivity({ projectId: project.id, actorId: u.userId, actorName: u.userName, action: 'project.created', targetType: 'project', targetId: project.id, summary: `Project created: ${project.name}` });
            bcast('axis.project_created', { project });
            res.json({ ok: true, project });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/:id', (req, res) => {
        const project = axisStore.getProject(req.params.id);
        if (!project) return res.status(404).json({ ok: false, error: 'Not found' });
        const members  = axisStore.getProjectMembers(req.params.id);
        const channels = axisStore.getProjectChannels(req.params.id);
        const activity = axisStore.getProjectActivity(req.params.id);
        res.json({ ok: true, project, members, channels, activity });
    });

    router.patch('/:id', (req, res) => {
        try {
            const project = axisStore.updateProject(req.params.id, req.body || {});
            if (!project) return res.status(404).json({ ok: false, error: 'Not found' });
            bcast('axis.project_updated', { project });
            res.json({ ok: true, project });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.delete('/:id', (req, res) => {
        axisStore.deleteProject(req.params.id);
        bcast('axis.project_deleted', { id: req.params.id });
        res.json({ ok: true });
    });

    // ── Project Members ───────────────────────────────────────────────────────
    router.get('/:id/members', (req, res) => {
        res.json({ ok: true, members: axisStore.getProjectMembers(req.params.id) });
    });

    router.post('/:id/members', (req, res) => {
        try {
            const access = canManage(req.params.id, getUser(req).userId, ['owner', 'contributor']);
            if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
            const { userId, userName, userAvatar, userColor, role } = req.body || {};
            if (!userId || !userName) return res.status(400).json({ ok: false, error: 'userId and userName required' });
            axisStore.addProjectMember(req.params.id, { userId, userName, userAvatar, userColor, role });
            logActivity(req.params.id, req, 'project.member_added', 'member', userId, `${userName} added as ${role || 'contributor'}`, { role });
            bcast('axis.project_member_added', { projectId: req.params.id, userId, userName, role });
            res.json({ ok: true, members: axisStore.getProjectMembers(req.params.id) });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.delete('/:id/members/:userId', (req, res) => {
        const access = canManage(req.params.id, getUser(req).userId, ['owner']);
        if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
        axisStore.removeProjectMember(req.params.id, req.params.userId);
        logActivity(req.params.id, req, 'project.member_removed', 'member', req.params.userId, `Member removed`);
        bcast('axis.project_member_removed', { projectId: req.params.id, userId: req.params.userId });
        res.json({ ok: true });
    });

    router.patch('/:id/members/:userId/role', (req, res) => {
        const { role } = req.body || {};
        if (!role) return res.status(400).json({ ok: false, error: 'role required' });
        const access = canManage(req.params.id, getUser(req).userId, ['owner']);
        if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
        axisStore.updateProjectMemberRole(req.params.id, req.params.userId, role);
        logActivity(req.params.id, req, 'project.member_role_updated', 'member', req.params.userId, `Member role changed to ${role}`, { role });
        res.json({ ok: true });
    });

    // ── Project Channels ──────────────────────────────────────────────────────
    router.get('/:id/channels', (req, res) => {
        res.json({ ok: true, channels: axisStore.getProjectChannels(req.params.id) });
    });

    router.post('/:id/channels', (req, res) => {
        try {
            const u = getUser(req);
            const access = canManage(req.params.id, u.userId, ['owner', 'contributor']);
            if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
            const project = access.project;
            const { name, type, description, isPrivate } = req.body || {};
            if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
            const channel = axisStore.createProjectChannel({ projectId: req.params.id, workspaceId: project.workspace_id, name: name.trim(), type, description, isPrivate, createdBy: u.userId });
            logActivity(req.params.id, req, 'project.channel_created', 'channel', channel.id, `Channel #${channel.name} created`, { type: channel.type });
            bcast('axis.channel_created', channel);
            res.json({ ok: true, channel });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ── Tasks ─────────────────────────────────────────────────────────────────
    router.get('/:id/tasks', (req, res) => {
        const tasks = axisStore.getTasks(req.params.id, { status: req.query.status });
        res.json({ ok: true, tasks: tasks.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]') })) });
    });

    router.post('/:id/tasks', (req, res) => {
        try {
            const u = getUser(req);
            const access = canManage(req.params.id, u.userId, ['owner', 'contributor', 'reviewer']);
            if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
            const project = access.project;
            const { title, description, priority, assigneeId, assigneeName, dueDate, tags } = req.body || {};
            if (!title?.trim()) return res.status(400).json({ ok: false, error: 'title required' });
            const task = axisStore.createTask({ projectId: req.params.id, workspaceId: project.workspace_id, title: title.trim(), description, priority, assigneeId, assigneeName, createdBy: u.userId, createdByName: u.userName, dueDate, tags });
            logActivity(req.params.id, req, 'project.task_created', 'task', task.id, `Task created: ${task.title}`, { priority: task.priority });
            bcast('axis.task_created', { projectId: req.params.id, task: { ...task, tags: JSON.parse(task.tags || '[]') } });
            res.json({ ok: true, task: { ...task, tags: JSON.parse(task.tags || '[]') } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/:id/tasks/:taskId', (req, res) => {
        const task = axisStore.getTask(req.params.taskId);
        if (!task || task.project_id !== req.params.id) return res.status(404).json({ ok: false, error: 'Not found' });
        const comments = axisStore.getTaskComments(req.params.taskId);
        res.json({ ok: true, task: { ...task, tags: JSON.parse(task.tags || '[]') }, comments });
    });

    router.patch('/:id/tasks/:taskId', (req, res) => {
        try {
            const access = canManage(req.params.id, getUser(req).userId, ['owner', 'contributor', 'reviewer']);
            if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
            const task = axisStore.updateTask(req.params.taskId, req.body || {});
            if (!task) return res.status(404).json({ ok: false, error: 'Not found' });
            logActivity(req.params.id, req, 'project.task_updated', 'task', task.id, `Task updated: ${task.title}`, req.body || {});
            bcast('axis.task_updated', { projectId: req.params.id, task: { ...task, tags: JSON.parse(task.tags || '[]') } });
            res.json({ ok: true, task: { ...task, tags: JSON.parse(task.tags || '[]') } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.delete('/:id/tasks/:taskId', (req, res) => {
        const access = canManage(req.params.id, getUser(req).userId, ['owner', 'contributor']);
        if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
        axisStore.deleteTask(req.params.taskId);
        logActivity(req.params.id, req, 'project.task_deleted', 'task', req.params.taskId, 'Task deleted');
        bcast('axis.task_deleted', { projectId: req.params.id, taskId: req.params.taskId });
        res.json({ ok: true });
    });

    // ── Task Comments ─────────────────────────────────────────────────────────
    router.get('/:id/tasks/:taskId/comments', (req, res) => {
        res.json({ ok: true, comments: axisStore.getTaskComments(req.params.taskId) });
    });

    router.post('/:id/tasks/:taskId/comments', (req, res) => {
        try {
            const access = canManage(req.params.id, getUser(req).userId, ['owner', 'contributor', 'reviewer', 'observer']);
            if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
            const u = getUser(req);
            const { content } = req.body || {};
            if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
            const comment = axisStore.addTaskComment({ taskId: req.params.taskId, authorId: u.userId, authorName: u.userName, content: content.trim() });
            logActivity(req.params.id, req, 'project.task_commented', 'task', req.params.taskId, 'Task comment added');
            bcast('axis.task_comment_added', { projectId: req.params.id, taskId: req.params.taskId, comment });
            res.json({ ok: true, comment });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/:id/activity', (req, res) => {
        res.json({ ok: true, activity: axisStore.getProjectActivity(req.params.id, Number(req.query.limit) || 50) });
    });

    router.get('/:id/decisions', (req, res) => {
        const activity = axisStore.getProjectActivity(req.params.id, Number(req.query.limit) || 100)
            .filter(row => row.action === 'project.decision_pinned');
        res.json({ ok: true, decisions: activity });
    });

    router.post('/:id/decisions', (req, res) => {
        try {
            const u = getUser(req);
            const access = canManage(req.params.id, u.userId, ['owner', 'contributor', 'reviewer']);
            if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
            const { summary, sourceMessageId, sourceChannelId, sourceText } = req.body || {};
            const cleanSummary = String(summary || sourceText || '').trim();
            if (!cleanSummary) return res.status(400).json({ ok: false, error: 'summary required' });
            const decision = logActivity(
                req.params.id,
                req,
                'project.decision_pinned',
                'decision',
                sourceMessageId || `decision-${Date.now()}`,
                cleanSummary.slice(0, 500),
                {
                    sourceMessageId: sourceMessageId || null,
                    sourceChannelId: sourceChannelId || null,
                    sourceText: String(sourceText || '').slice(0, 1200),
                }
            );
            bcast('axis.project_decision_pinned', { projectId: req.params.id, decision });
            res.json({ ok: true, decision });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    router.get('/:id/search', (req, res) => {
        try {
            const project = axisStore.getProject(req.params.id);
            if (!project) return res.status(404).json({ ok: false, error: 'Project not found' });
            const q = String(req.query.q || '').trim();
            if (!q) return res.json({ ok: true, query: q, results: [] });
            const needle = q.toLowerCase();
            const channels = axisStore.getProjectChannels(req.params.id);
            const tasks = axisStore.getTasks(req.params.id, {}).map(t => ({ ...t, tags: JSON.parse(t.tags || '[]') }));
            const activity = axisStore.getProjectActivity(req.params.id, 200);
            const results = [];

            for (const task of tasks) {
                const hay = [task.title, task.description, task.assignee_name, task.status, task.priority, ...(task.tags || [])].join(' ').toLowerCase();
                if (hay.includes(needle)) {
                    results.push({
                        type: 'task',
                        id: task.id,
                        title: task.title,
                        excerpt: task.description || `${task.status || 'todo'} · ${task.assignee_name || 'Unassigned'}`,
                        taskId: task.id,
                        score: 0.82,
                    });
                }
            }

            for (const row of activity) {
                const meta = row.metadata || {};
                const hay = [row.action, row.summary, row.actor_name, row.target_id, meta.sourceText, meta.question].join(' ').toLowerCase();
                if (hay.includes(needle)) {
                    results.push({
                        type: row.action === 'project.decision_pinned' ? 'decision' : 'activity',
                        id: row.id,
                        title: row.action === 'project.decision_pinned' ? 'Pinned decision' : String(row.action || '').replace(/^project\./, '').replace(/_/g, ' '),
                        excerpt: row.summary || meta.sourceText || row.target_id || '',
                        messageId: meta.sourceMessageId || null,
                        channelId: meta.sourceChannelId || null,
                        score: row.action === 'project.decision_pinned' ? 0.78 : 0.58,
                    });
                }
            }

            for (const channel of channels) {
                const messages = axisStore.getMessages(channel.id, { limit: 250 });
                for (const msg of messages) {
                    const hay = [msg.content, msg.sender_name].join(' ').toLowerCase();
                    if (hay.includes(needle)) {
                        results.push({
                            type: 'message',
                            id: msg.id,
                            title: `${msg.sender_name || 'Member'} in #${channel.name}`,
                            excerpt: msg.content,
                            messageId: msg.id,
                            channelId: channel.id,
                            score: 0.7,
                        });
                    }
                }
            }

            results.sort((a, b) => b.score - a.score);
            res.json({ ok: true, query: q, results: results.slice(0, Number(req.query.limit) || 40) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    return router;
}
