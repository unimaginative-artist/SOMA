import express from 'express';
import ctConversationStore from '../services/CtConversationStore.js';

export default function createCtRoutes({ requireSession }) {
    const router = express.Router();
    router.use(requireSession);
    const owner = req => req.studioActor?.userId || req.axisUser?.userId || 'local-owner';

    router.get('/conversations', (req, res) => {
        res.json({ success: true, conversations: ctConversationStore.list(owner(req), req.query.search) });
    });
    router.get('/conversations/:id', (req, res) => {
        const conversation = ctConversationStore.get(owner(req), req.params.id);
        if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
        res.json({ success: true, conversation });
    });
    router.put('/conversations/:id', (req, res) => {
        const conversation = ctConversationStore.upsert(owner(req), { ...req.body, id: req.params.id });
        res.json({ success: true, conversation });
    });
    router.post('/conversations/:id/branch', (req, res) => {
        const source = ctConversationStore.get(owner(req), req.params.id);
        if (!source) return res.status(404).json({ success: false, error: 'Conversation not found' });
        const through = Math.max(0, Number(req.body?.throughIndex ?? source.messages.length - 1));
        const conversation = ctConversationStore.upsert(owner(req), {
            id: req.body?.id,
            parentId: source.id,
            title: req.body?.title || `${source.title} — branch`,
            icon: source.icon,
            messages: source.messages.slice(0, through + 1)
        });
        res.status(201).json({ success: true, conversation });
    });
    router.delete('/conversations/:id', (req, res) => {
        const deleted = ctConversationStore.delete(owner(req), req.params.id);
        res.status(deleted ? 200 : 404).json({ success: deleted });
    });
    return router;
}

