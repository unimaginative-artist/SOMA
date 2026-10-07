/**
 * Transport-neutral ingress for human conversation. Web chat, Discord, voice,
 * and future robot interfaces may enrich context, but none may bypass the
 * authoritative CognitiveRuntime when deciding whether to speak or act.
 */
import { getConversationContext } from './ConversationContext.js';
import { conversationModel } from './ConversationVoice.js';
import { getLocalChatOllamaConfig } from './LocalChatOllamaSidecar.js';
import { guardConversationReply, privateConversationBoundary } from './ConversationReplyGuard.js';

export class ChatRuntimeAdapter {
    constructor({ system, logger = console } = {}) {
        this.system = system;
        this.logger = logger;
    }

    async handle({ channel = 'chat', message, prompt, sessionId, quickResponse = false, forceAgentic = false, trustedActionAuthority = false, options = {} } = {}) {
        const content = String(message || '').trim();
        if (!content) throw new TypeError('Chat message is required');
        if (!this.system?.cognitiveRuntime?.run) throw new Error('CognitiveRuntime is unavailable');

        const conversation = getConversationContext(this.system);
        const original = String(options.rawMessage || content);
        const privacyReply = privateConversationBoundary(original, options.conversationActor);
        if (privacyReply) return { text: privacyReply, response: privacyReply,
            conversationQuality: { acceptable: true, issues: [] },
            adapter: { channel, transactionId: null, lane: 'conversation_privacy', conversation: { version: 'soma-conversation-v1', memoryStatus: 'private_context_excluded', memoryCount: 0, continuityTurns: 0, landmarks: 0, scoped: Boolean(options.conversationActor) } } };
        const prepared = await conversation.prepare({ channel, message: original, actor: options.conversationActor, history: options.history, skipRecall: options.conversationRecallManaged === true });
        const inferenceOptions = {
            ...options, sourceChannel: channel, quickResponse: quickResponse || options.quickResponse === true,
            conversationVoice: prepared.health.version,
            history: prepared.history,
            // Provider paths consume different fields; both must carry the same identity/context.
            localPersona: [options.localPersona, prepared.context].filter(Boolean).join('\n\n'),
            systemPrompt: [options.systemPrompt, prepared.context].filter(Boolean).join('\n\n'),
            systemContext: [options.systemContext, prepared.context].filter(Boolean).join('\n\n'),
        };
        if (quickResponse && options.localFirst !== false && !options.largeCouncil) {
            inferenceOptions.localFirst = true;
            inferenceOptions.localModel ||= conversationModel();
            inferenceOptions.localEndpoint ||= getLocalChatOllamaConfig().endpoint;
        }
        const runtimeInput = {
            message: content,
            prompt: prompt || content,
            sessionId: sessionId || `${channel}:anonymous`,
            quickResponse,
            forceAgentic,
            trustedActionAuthority,
            options: inferenceOptions
        };
        let result = await this.system.cognitiveRuntime.run(runtimeInput);
        if (options.conversationQualityManaged !== true) {
            result = await guardConversationReply({ message: original, result, retry: issues => this.system.cognitiveRuntime.run({
                ...runtimeInput, quickResponse: true, forceAgentic: false, trustedActionAuthority: false,
                prompt: `Respond to this message: ${JSON.stringify(original)}. The previous draft failed checks: ${issues.join(', ')}. Stay with the topic. Ideas and opinions are welcome; do not invent work, source contents or memories. Return only the reply.`,
                options: { ...inferenceOptions, temperature: 0.3, maxTokens: 384 }
            }) });
        }
        if (options.conversationRecordManaged !== true) {
            await conversation.record({ actor: options.conversationActor, channel, message: original,
                reply: result?.text || result?.response, accepted: result?.degraded !== true && !result?.error });
        }
        return {
            ...result,
            adapter: {
                channel,
                conversation: prepared.health,
                transactionId: result?.cognitiveTransaction?.id || null,
                lane: result?.cognitiveTransaction?.lane || null
            }
        };
    }
}

export default ChatRuntimeAdapter;
