import { conversationActorFromRequest, conversationModel } from '../../core/ConversationVoice.js';
import { getLocalChatOllamaConfig } from '../../core/LocalChatOllamaSidecar.js';

export function humanConversationChannel(body = {}) {
    if (body.voiceMode) return 'voice';
    const source = body.context?.source || body.source;
    if (source === 'mission-control') return 'mission_control';
    if (source === 'aperture_kernel') return 'aperture';
    return source === 'floating-chat' ? 'floating_chat' : 'web_chat';
}

export function createVoiceConversationHandler(system) {
    return async (req, res) => {
        const message = String(req.body?.message || '').trim();
        if (!message) return res.status(400).json({ error: 'Message is required' });
        if (!system.chatRuntime?.handle) return res.status(503).json({ error: 'Conversation runtime is loading' });
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        const send = data => { if (!res.writableEnded && !controller.signal.aborted) res.write(`data: ${JSON.stringify(data)}\n\n`); };
        try {
            const result = await system.chatRuntime.handle({
                channel: 'voice', message, sessionId: req.body.sessionId || 'voice', quickResponse: true, trustedActionAuthority: false,
                options: { conversationActor: conversationActorFromRequest(req), history: req.body.history,
                    localFirst: true, localModel: conversationModel(), localEndpoint: getLocalChatOllamaConfig().endpoint,
                    maxTokens: 256, localTimeoutMs: 45000, temperature: 0.65, skipGraphRetrieval: true,
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50000)]) }
            });
            const fullText = String(result.text || result.response || '');
            // Buffer until the reply guard has checked the answer; never speak an unvalidated draft.
            if (fullText) send({ sentence: fullText });
            send({ done: true, fullText, degraded: result.degraded === true, conversation: result.adapter?.conversation });
        } catch { send({ error: 'The conversation model could not finish that turn. Please try again.' }); }
        finally { res.end(); }
    };
}
