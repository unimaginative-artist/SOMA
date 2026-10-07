import { classifyTurnIntent, INTENT_TYPES } from './DiscordTurnPolicy.js';

export function guardUnverifiedExecutionReply(reply, { request = '', executorAvailable = false, hasDurableJob = false } = {}) {
    const text = String(reply || '').trim();
    if (!text || hasDurableJob) return text;
    if (executorAvailable && /\bI\s+(?:don'?t|do not)\s+have\s+direct\s+execution\s+capabilit(?:y|ies)\b/i.test(text)) {
        return 'I do have an execution system, but I did not start a verified job on this turn. I should identify the supported task and return a job ID and evidence before claiming work began.';
    }
    const intent = classifyTurnIntent(request).intent;
    if (![INTENT_TYPES.NEW_TASK, INTENT_TYPES.CONTINUE_PREVIOUS_TASK, INTENT_TYPES.APPROVE].includes(intent)) return text;
    if (/\b(?:I(?:'ll| will)|let me|let'?s)\s+(?:run|execute|start|set up|begin|perform)\b|\b(?:I'm|I am)\s+(?:running|executing|starting)\b/i.test(text)
        && !/\b(?:job|goal)\s*[:#]?\s*`?[a-z0-9_-]{8,}/i.test(text)) {
        return 'I have not started a verified job for that request. No tool receipt or result exists yet, so I cannot honestly say I am running it.';
    }
    return text;
}
