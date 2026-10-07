/** Register the Studio compatibility surface for Axis state, friends, chats, and directs. */
export default function registerStudioAxisRoutes(router, {
    axisProfileStore,
    loadProfile,
    publicSecurityScan,
    recordDirectSecurityScan,
    requireActor,
    scanDirectForScam,
}) {
    // This compatibility surface used to trust that only the desktop shell
    // could reach it. It now shares Studio's signed, device-bound session gate.
    router.use('/axis', (req, res, next) => {
        const actor = requireActor(req, res);
        if (!actor) return;
        req.studioActor = actor;
        next();
    });

    router.get('/axis', (_req, res) => {
        try {
            const profile = loadProfile();
            const axis = axisProfileStore.getState(profile);
            res.json({
                ok: true,
                axis,
                profile,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.put('/axis', (req, res) => {
        try {
            const profile = loadProfile();
            const current = axisProfileStore.getState(profile);
            const incoming = req.body?.axis || req.body || {};
            const saved = axisProfileStore.saveState({
                ...current,
                ...incoming,
                friends: Array.isArray(incoming.friends) ? incoming.friends : current.friends,
                chats: Array.isArray(incoming.chats) ? incoming.chats : current.chats,
                messages: incoming.messages && typeof incoming.messages === 'object' ? incoming.messages : current.messages,
                spaces: Array.isArray(incoming.spaces) ? incoming.spaces : current.spaces,
            }, profile);
            res.json({ ok: true, axis: saved, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/axis/friends', (req, res) => {
        try {
            const profile = loadProfile();
            const result = axisProfileStore.addFriend(req.body || {}, profile);
            res.json({ ok: true, ...result, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/axis/friends/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const result = axisProfileStore.updateFriend(req.params.id, req.body || {}, profile);
            res.json({ ok: true, ...result, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/axis/friends/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const result = axisProfileStore.removeFriend(req.params.id, profile);
            res.json({ ok: true, ...result, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/axis/chats/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const chat = axisProfileStore.updateChat(req.params.id, req.body || {}, profile);
            res.json({ ok: true, chat, axis: axisProfileStore.getState(profile) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/axis/chats/:id/messages', (req, res) => {
        try {
            const profile = loadProfile();
            res.json({ ok: true, ...axisProfileStore.getMessages(req.params.id, profile) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/axis/chats/:id/messages', (req, res) => {
        try {
            const profile = loadProfile();
            const scan = scanDirectForScam({ ...(req.body || {}), chatId: req.params.id }, req);
            if (scan.verdict !== 'allow') recordDirectSecurityScan(scan, req);
            if (scan.verdict === 'quarantine' || scan.verdict === 'ban_recommend') {
                return res.status(202).json({
                    ok: true,
                    quarantined: true,
                    message: null,
                    security: publicSecurityScan(scan),
                    reason: 'Direct was quarantined by Studio Security Gateway before delivery.',
                });
            }
            const result = axisProfileStore.addMessage(req.params.id, {
                ...(req.body || {}),
                security: scan.verdict === 'flag' ? publicSecurityScan(scan) : null,
            }, profile);
            res.json({ ok: true, ...result, security: publicSecurityScan(scan) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

}
