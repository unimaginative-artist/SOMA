import fs from 'fs';
import express from 'express';
import studioSignals from '../../studio/StudioSignalsStore.js';
import studioMedia from '../../studio/StudioMediaPipeline.js';
import studioSaved from '../../studio/StudioSavedStore.js';

export default function registerStudioSignalRoutes(router, dependencies = {}) {
    const { signalVideoUpload, resolveActor, requireActor, rankStudioSignalsForViewer, publicSignal, canViewSignal, notify, notifyFollowers, emitStudioAction } = dependencies;
    // ── Signals — long-form video metadata and watch feedback ────────────────
    router.get('/media/usage', (req, res) => {
        const actor = requireActor(req, res, { allowRestricted: true });
        if (!actor) return;
        res.json({ ok: true, usage: studioMedia.usage(actor.userId), jobs: studioMedia.list(actor.userId, { limit: req.query.limit }) });
    });

    router.get('/media/jobs/:id', (req, res) => {
        const actor = requireActor(req, res, { allowRestricted: true });
        if (!actor) return;
        const job = studioMedia.get(req.params.id);
        if (!job || job.userId !== actor.userId) return res.status(404).json({ ok: false, error: 'Media job not found' });
        res.json({ ok: true, job });
    });

    router.post('/media/jobs/:id/retry', async (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const job = await studioMedia.retry(req.params.id, actor.userId);
            if (!job) return res.status(404).json({ ok: false, error: 'Media job not found' });
            res.json({ ok: true, job });
        } catch (e) {
            res.status(409).json({ ok: false, error: e.message });
        }
    });

    // Resumable uploads use explicit offsets. A client can reconnect, GET the
    // durable offset, and continue without re-sending an accepted prefix.
    router.post('/media/uploads', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const upload = studioMedia.beginUpload({
                userId: actor.userId,
                kind: req.body?.kind,
                originalName: req.body?.originalName,
                mimeType: req.body?.mimeType,
                bytes: req.body?.bytes,
            });
            res.status(201)
                .set('Location', `/api/studio/media/uploads/${encodeURIComponent(upload.id)}`)
                .set('Upload-Offset', String(upload.offset))
                .json({ ok: true, upload });
        } catch (e) {
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'UPLOAD_SESSION_FAILED' });
        }
    });

    router.get('/media/uploads/:id', (req, res) => {
        const actor = requireActor(req, res, { allowRestricted: true });
        if (!actor) return;
        const upload = studioMedia.uploadStatus(req.params.id, actor.userId);
        if (!upload) return res.status(404).json({ ok: false, error: 'Upload session not found' });
        res.set('Upload-Offset', String(upload.offset)).json({ ok: true, upload });
    });

    router.patch('/media/uploads/:id', express.raw({
        type: ['application/offset+octet-stream', 'application/octet-stream'],
        limit: process.env.STUDIO_MEDIA_CHUNK_LIMIT || '64mb',
    }), (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const upload = studioMedia.appendUpload(
                req.params.id,
                actor.userId,
                req.get('Upload-Offset'),
                req.body,
            );
            if (!upload) return res.status(404).json({ ok: false, error: 'Upload session not found' });
            res.set('Upload-Offset', String(upload.offset)).json({ ok: true, upload });
        } catch (e) {
            if (Number.isFinite(e.offset)) res.set('Upload-Offset', String(e.offset));
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'UPLOAD_CHUNK_FAILED' });
        }
    });

    router.post('/media/uploads/:id/complete', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const result = studioMedia.completeUpload(req.params.id, actor.userId);
            if (!result) return res.status(404).json({ ok: false, error: 'Upload session not found' });
            res.status(202).json({ ok: true, ...result });
        } catch (e) {
            if (Number.isFinite(e.offset)) res.set('Upload-Offset', String(e.offset));
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'UPLOAD_COMPLETE_FAILED' });
        }
    });

    router.get('/media/source/:name', (req, res) => {
        const file = studioMedia.resolveAsset('source', req.params.name);
        if (!file || !fs.existsSync(file)) return res.status(404).end();
        res.sendFile(file);
    });

    router.get('/media/thumbnail/:name', (req, res) => {
        const file = studioMedia.resolveAsset('thumbnail', req.params.name);
        if (!file || !fs.existsSync(file)) return res.status(404).end();
        res.sendFile(file);
    });

    router.get('/media/hls/:jobId/:name', (req, res) => {
        const file = studioMedia.resolveAsset('hls', req.params.jobId, req.params.name);
        if (!file || !fs.existsSync(file)) return res.status(404).end();
        if (file.endsWith('.m3u8')) res.type('application/vnd.apple.mpegurl');
        else if (file.endsWith('.ts')) res.type('video/mp2t');
        res.sendFile(file);
    });

    router.post('/media/upload', signalVideoUpload.single('media'), (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            if (!req.file) return res.status(400).json({ ok: false, error: 'No media file uploaded' });
            const job = studioMedia.ingest(req.file, { userId: actor.userId, kind: req.body?.kind || 'brainrot' });
            res.status(202).json({ ok: true, job, media: { id: job.id, kind: 'video', url: job.sourceUrl, ...job } });
        } catch (e) {
            if (req.file?.path) try { fs.rmSync(req.file.path, { force: true }); } catch {}
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'MEDIA_UPLOAD_FAILED' });
        }
    });

    router.get('/signals', (req, res) => {
        try {
            const actor = resolveActor(req);
            const { limit, before, author } = req.query;
            const signals = rankStudioSignalsForViewer(actor, studioSignals.list({ limit: 200, before, author }))
                .slice(0, Math.min(Number(limit) || 50, 200))
                .map(signal => publicSignal(signal, actor));
            res.json({ ok: true, signals });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/upload', signalVideoUpload.single('video'), (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            if (!req.file) return res.status(400).json({ ok: false, error: 'No video file uploaded' });
            const job = studioMedia.ingest(req.file, { userId: actor.userId, kind: 'signal' });
            res.status(202).json({
                ok: true,
                job,
                media: {
                    id: job.id,
                    jobId: job.id,
                    kind: 'video',
                    originalName: job.originalName,
                    mimeType: job.mimeType,
                    size: job.bytes,
                    url: job.sourceUrl,
                    thumbnailUrl: job.thumbnailUrl,
                    hlsUrl: job.hlsUrl,
                    processingStatus: job.status,
                    uploadedBy: actor.userId,
                    uploadedAt: job.createdAt,
                },
            });
        } catch (e) {
            if (req.file?.path) try { fs.rmSync(req.file.path, { force: true }); } catch {}
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'MEDIA_UPLOAD_FAILED' });
        }
    });

    router.post('/signals', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const signal = studioSignals.add({
                ...(req.body || {}),
                authorId: actor.userId,
                authorName: actor.displayName || actor.name || actor.handle,
                authorAvatar: actor.avatar || '',
                authorTrustTier: actor.trustTier,
                authorAgeBand: actor.ageBand,
            });
            notifyFollowers(actor, 'signal_published', `published a Signal: ${signal.title}`, signal.id, {
                targetType: 'signal',
                targetTitle: signal.title,
                deepLink: `/studio/signal/${encodeURIComponent(signal.id)}`,
            });
            emitStudioAction('signal.created', actor, signal.id, { signal: publicSignal(signal, actor) });
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/view', (req, res) => {
        try {
            const actor = resolveActor(req);
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks viewing this Signal.' });
            const signal = studioSignals.view(req.params.id, actor?.userId || actor?.id || '');
            res.json({ ok: true, signal: publicSignal(signal, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/like', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks liking this Signal.' });
            const delta = req.body && req.body.delta != null ? req.body.delta : 1;
            const signal = studioSignals.like(req.params.id, actor.userId, delta);
            if (signal && Number(delta) > 0) notify(signal.authorId, 'signal_like', actor.userId, 'liked your Signal', signal.id);
            emitStudioAction('signal.like', actor, req.params.id, { enabled: Number(delta) > 0 });
            res.json({ ok: true, signal: publicSignal(signal, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/dislike', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks disliking this Signal.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const signal = studioSignals.dislike(req.params.id, actor.userId, enabled);
            emitStudioAction('signal.dislike', actor, req.params.id, { enabled });
            res.json({ ok: true, signal: publicSignal(signal, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/bookmark', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks bookmarking this Signal.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const signal = studioSignals.bookmark(req.params.id, actor.userId, enabled);
            if (signal) {
                studioSaved.set(actor.userId, {
                    itemType: 'signal',
                    itemId: signal.id,
                    title: signal.title,
                    description: signal.description,
                    authorId: signal.authorId,
                    mediaUrl: signal.media?.[0]?.thumbnailUrl || signal.media?.[0]?.url || signal.media?.[0] || '',
                    payload: publicSignal(signal, actor),
                }, enabled);
            }
            emitStudioAction('signal.bookmark', actor, req.params.id, { enabled, saved: enabled }, [actor.userId]);
            res.json({ ok: true, signal: publicSignal(signal, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/subscribe', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks subscribing to this Signal.' });
            const enabled = req.body?.enabled !== false;
            const alerts = req.body?.alerts !== false;
            const signal = studioSignals.subscribe(req.params.id, actor.userId, enabled, alerts);
            emitStudioAction('signal.subscribe', actor, req.params.id, { enabled, alerts });
            res.json({ ok: true, signal: publicSignal(signal, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/report', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks reporting this Signal.' });
            const signal = studioSignals.report(req.params.id, {
                userId: actor.userId,
                reason: req.body?.reason || 'other',
                note: req.body?.note || '',
            });
            emitStudioAction('moderation.report', actor, req.params.id, { targetType: 'signal', reason: req.body?.reason || 'other' }, [actor.userId]);
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/signals/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && existing.authorId !== actor.userId) return res.status(403).json({ ok: false, error: 'Only the author can edit this Signal.' });
            const signal = studioSignals.update(req.params.id, actor.userId, req.body || {});
            if (!signal) return res.status(404).json({ ok: false, error: 'Signal not found' });
            emitStudioAction('signal.updated', actor, signal.id, { signal: publicSignal(signal, actor) });
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(e.status || 400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/signals/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            studioSignals.delete(req.params.id, actor.userId);
            emitStudioAction('signal.deleted', actor, req.params.id);
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });
}
