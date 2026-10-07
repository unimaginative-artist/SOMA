import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useVision - SOMA Perception Hook
 *
 * Primary path: listens to 'vision_update' WebSocket events pushed from
 * the backend when vision.perceived fires (no polling lag).
 * Fallback path: polls /api/perception/vision/last every 10s to sync
 * if a vision_update was missed or on first connect.
 */
export const useVision = (somaBackend, isConnected) => {
    const [visionState, setVisionState] = useState({
        active: false,
        channel: 'desktop',
        lastPerception: null,
        lastFrameUrl: null,
        lastFrameAt: null,
        ghostCursor: null,
        metrics: {},
        health: null,
        events: [],
        sceneMemory: null,
        whatChanged: null,
        deepDescribe: null,
        deepDescribeBusy: false,
        retention: null
    });
    const pollIntervalRef = useRef(null);
    const visionStateRef = useRef(visionState);

    useEffect(() => {
        visionStateRef.current = visionState;
    }, [visionState]);

    const pushEvent = useCallback((event) => {
        setVisionState(prev => ({
            ...prev,
            events: [{
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                ts: Date.now(),
                type: event.type || 'perception',
                title: event.title || 'Perception event',
                detail: event.detail || '',
                status: event.status || 'info'
            }, ...(prev.events || [])].slice(0, 24)
        }));
    }, []);

    // Helper: apply a raw vision_update payload (from WS event or REST poll)
    const applyVisionData = useCallback((data) => {
        setVisionState(prev => {
            // Build frame URL from imagePath — can live in data or inside lastPerception
            const imagePath = data.imagePath || data.lastPerception?.imagePath || prev.lastPerception?.imagePath;
            const frameUrl = imagePath
                ? `/api/perception/vision/frame?path=${encodeURIComponent(imagePath)}`
                : prev.lastFrameUrl;

            // Construct a unified lastPerception object from whatever the source provided
            const newPerception = data.lastPerception || (data.objects ? {
                objects: data.objects,
                ocrText: data.ocrText || null,
                imagePath: data.imagePath || null,
                channel: data.channel || prev.channel,
                timestamp: data.timestamp || Date.now()
            } : prev.lastPerception);
            const ts = data.timestamp || newPerception?.timestamp || Date.now();

            return {
                ...prev,
                active: true,
                channel: data.channel || prev.channel,
                lastPerception: newPerception,
                ghostCursor: data.ghostCursor !== undefined ? data.ghostCursor : prev.ghostCursor,
                lastFrameUrl: frameUrl,
                lastFrameAt: frameUrl ? ts : prev.lastFrameAt,
                metrics: data.metrics || prev.metrics,
                sceneMemory: data.sceneMemory || data.lastPerception?.sceneMemory || prev.sceneMemory
            };
        });
    }, []);

    const fetchHealth = useCallback(async () => {
        if (!isConnected) return;
        try {
            const res = await somaBackend.fetch('/api/perception/health');
            if (res.ok) {
                const data = await res.json();
                setVisionState(prev => ({
                    ...prev,
                    health: data,
                    active: !!data.vision?.active || prev.active,
                    channel: data.vision?.channel || prev.channel,
                    metrics: data.vision?.metrics || prev.metrics,
                    sceneMemory: data.vision?.sceneMemory || prev.sceneMemory,
                    retention: data.vision?.retention || prev.retention
                }));
            }
        } catch (e) {
            pushEvent({ type: 'health', title: 'Health check failed', detail: e.message, status: 'warn' });
        }
    }, [somaBackend, isConnected, pushEvent]);

    // REST poll fallback (slower, keeps state in sync on reconnect)
    const fetchVision = useCallback(async () => {
        if (!isConnected) return;
        try {
            const res = await somaBackend.fetch('/api/perception/vision/last');
            if (res.ok) {
                const data = await res.json();
                if (data.success) applyVisionData(data);
            }
        } catch (e) {
            console.warn('[useVision] Poll failed:', e.message);
        }
    }, [somaBackend, isConnected, applyVisionData]);

    const fetchSceneMemory = useCallback(async () => {
        if (!isConnected) return;
        try {
            const res = await somaBackend.fetch('/api/perception/vision/scenes');
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setVisionState(prev => ({ ...prev, sceneMemory: data.sceneMemory || prev.sceneMemory }));
                }
            }
        } catch (e) {
            pushEvent({ type: 'scene', title: 'Scene memory sync failed', detail: e.message, status: 'warn' });
        }
    }, [somaBackend, isConnected, pushEvent]);

    const askWhatChanged = useCallback(async () => {
        try {
            const res = await somaBackend.fetch('/api/perception/vision/what-changed');
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            setVisionState(prev => ({
                ...prev,
                whatChanged: data,
                sceneMemory: data.sceneMemory || prev.sceneMemory
            }));
            pushEvent({ type: 'scene', title: 'Scene change reviewed', detail: data.summary, status: 'ok' });
            return data;
        } catch (e) {
            pushEvent({ type: 'scene', title: 'Scene review failed', detail: e.message, status: 'warn' });
            throw e;
        }
    }, [somaBackend, pushEvent]);

    const fetchRetention = useCallback(async () => {
        if (!isConnected) return;
        try {
            const res = await somaBackend.fetch('/api/perception/vision/retention');
            if (res.ok) {
                const data = await res.json();
                if (data.success) setVisionState(prev => ({ ...prev, retention: data.retention || prev.retention }));
            }
        } catch (e) {
            pushEvent({ type: 'retention', title: 'Retention status failed', detail: e.message, status: 'warn' });
        }
    }, [somaBackend, isConnected, pushEvent]);

    const cleanupRetention = useCallback(async () => {
        try {
            const res = await somaBackend.fetch('/api/perception/vision/retention/cleanup', {
                method: 'POST',
                body: JSON.stringify({ force: true })
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            setVisionState(prev => ({ ...prev, retention: data.status || prev.retention }));
            pushEvent({
                type: 'retention',
                title: data.deletedCount ? `Cleaned ${data.deletedCount} raw frame${data.deletedCount === 1 ? '' : 's'}` : 'Vision cache already clean',
                detail: data.deletedMb ? `${data.deletedMb} MB removed` : 'No files removed',
                status: 'ok'
            });
            return data;
        } catch (e) {
            pushEvent({ type: 'retention', title: 'Vision cleanup failed', detail: e.message, status: 'warn' });
            throw e;
        }
    }, [somaBackend, pushEvent]);

    const pinLatestFrame = useCallback(async (pinned = true) => {
        const current = visionStateRef.current || {};
        const imagePath = current.sceneMemory?.latest?.imagePath || current.lastPerception?.imagePath;
        if (!imagePath) return null;
        const res = await somaBackend.fetch('/api/perception/vision/pin', {
            method: 'POST',
            body: JSON.stringify({ imagePath, pinned, reason: 'presence-ui' })
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        setVisionState(prev => ({ ...prev, retention: data.retention || prev.retention }));
        pushEvent({ type: 'retention', title: pinned ? 'Latest frame pinned' : 'Latest frame unpinned', status: 'ok' });
        return data;
    }, [somaBackend, pushEvent]);

    const deepDescribeLatest = useCallback(async () => {
        setVisionState(prev => ({ ...prev, deepDescribeBusy: true }));
        try {
            const res = await somaBackend.fetch('/api/perception/vision/deep-describe', {
                method: 'POST',
                body: JSON.stringify({ saveReflection: true })
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            setVisionState(prev => ({
                ...prev,
                deepDescribe: data,
                sceneMemory: data.sceneMemory || prev.sceneMemory,
                deepDescribeBusy: false
            }));
            pushEvent({ type: 'scene', title: 'Deep scene description complete', detail: data.analysis, status: 'ok' });
            return data;
        } catch (e) {
            setVisionState(prev => ({ ...prev, deepDescribeBusy: false }));
            pushEvent({ type: 'scene', title: 'Deep scene description failed', detail: e.message, status: 'warn' });
            throw e;
        }
    }, [somaBackend, pushEvent]);

    // WebSocket event listener — real-time updates from vision.perceived signals
    useEffect(() => {
        if (!isConnected || !somaBackend?.on) return;

        const handleVisionUpdate = (payload) => applyVisionData(payload);
        const handleLocalEvent = (event) => pushEvent(event.detail || {});
        somaBackend.on('vision_update', handleVisionUpdate);
        window.addEventListener('soma:perception-event', handleLocalEvent);

        return () => {
            somaBackend.off?.('vision_update', handleVisionUpdate);
            window.removeEventListener('soma:perception-event', handleLocalEvent);
        };
    }, [isConnected, somaBackend, applyVisionData, pushEvent]);

    // Polling: initial fetch + 10s fallback (slower than WS but ensures sync)
    useEffect(() => {
        if (isConnected) {
            fetchVision();
            fetchHealth();
            fetchSceneMemory();
            fetchRetention();
            pollIntervalRef.current = setInterval(fetchVision, 10000);
            const healthInterval = setInterval(fetchHealth, 15000);
            const sceneInterval = setInterval(fetchSceneMemory, 12000);
            const retentionInterval = setInterval(fetchRetention, 30000);
            return () => {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                clearInterval(healthInterval);
                clearInterval(sceneInterval);
                clearInterval(retentionInterval);
            };
        } else {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, [isConnected, fetchVision, fetchHealth, fetchSceneMemory, fetchRetention]);

    const setChannel = useCallback(async (channel) => {
        try {
            await somaBackend.fetch('/api/perception/vision/channel', {
                method: 'POST',
                body: JSON.stringify({ channel })
            });
            setVisionState(prev => ({ ...prev, channel }));
            pushEvent({ type: 'channel', title: `Vision channel set to ${channel}`, status: 'ok' });
        } catch (e) {
            console.error('[useVision] Failed to set channel:', e);
            pushEvent({ type: 'channel', title: 'Channel change failed', detail: e.message, status: 'warn' });
        }
    }, [somaBackend, pushEvent]);

    const captureDesktop = useCallback(async () => {
        try {
            const res = await somaBackend.fetch('/api/perception/vision/capture', { method: 'POST' });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            if (data.success) {
                applyVisionData(data);
                pushEvent({ type: 'capture', title: 'Desktop snapshot captured', status: 'ok' });
            }
            return data;
        } catch (e) {
            pushEvent({ type: 'capture', title: 'Desktop capture failed', detail: e.message, status: 'warn' });
            throw e;
        }
    }, [somaBackend, applyVisionData, pushEvent]);

    const proposeActions = useCallback(async () => {
        try {
            const res = await somaBackend.fetch('/api/perception/vision/propose-actions', { method: 'POST' });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            pushEvent({ type: 'proposals', title: `Generated ${data.proposals?.length || 0} action proposals`, status: 'ok' });
            return data.proposals || [];
        } catch (e) {
            pushEvent({ type: 'proposals', title: 'Proposal generation failed', detail: e.message, status: 'warn' });
            throw e;
        }
    }, [somaBackend, pushEvent]);

    const executeAction = useCallback(async (type, params) => {
        try {
            const res = await somaBackend.fetch('/api/perception/vision/execute-action', {
                method: 'POST',
                body: JSON.stringify({ type, params })
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            if (data.success) {
                if (data.verificationScene) {
                    applyVisionData(data.verificationScene);
                }
                pushEvent({ type: 'execute', title: `Action ${type} executed successfully`, status: 'ok' });
            }
            return data;
        } catch (e) {
            pushEvent({ type: 'execute', title: `Action ${type} execution failed`, detail: e.message, status: 'warn' });
            throw e;
        }
    }, [somaBackend, applyVisionData, pushEvent]);

    return {
        ...visionState,
        setChannel,
        captureDesktop,
        proposeActions,
        executeAction,
        refresh: fetchVision,
        refreshHealth: fetchHealth,
        refreshSceneMemory: fetchSceneMemory,
        refreshRetention: fetchRetention,
        cleanupRetention,
        pinLatestFrame,
        askWhatChanged,
        deepDescribeLatest,
        pushEvent
    };
};
