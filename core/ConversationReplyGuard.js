import { evaluateDiscordReply } from '../server/discord/DiscordReplyQuality.js';

// The user explicitly asked for a short answer, or asked a plain yes/no question. Judging
// those as "substantive" rejected correct one-word replies as "underdeveloped" and replaced
// them with "I lost the thread on that reply."
const BRIEF_REQUEST = /\b(?:one|single|1)[-\s]word\b|\b(?:reply|respond|answer)\s+(?:with\s+)?(?:only|just)\b|\bjust\s+(?:say|reply|answer)\b|\byes\s+or\s+no\b|\b(?:short|brief|quick)\s+answer\b|\bin\s+(?:one|a\s+few|two|three)\s+words?\b/i;
const YES_NO_QUESTION = /^\s*(?:is|are|am|was|were|do|does|did|can|could|should|would|will|has|have|had)\b[^?\n]{0,200}\?\s*$/i;

export function assessConversationReply(message, reply) {
    const text = String(message);
    const social = /^(?:hey|hi|hello|yo|thanks|thank you|you there|how.?s it going|how are you)[.!? ]*$/i.test(text);
    const brief = BRIEF_REQUEST.test(text) || YES_NO_QUESTION.test(text);
    return evaluateDiscordReply({ input: message, reply, intent: social ? 'social' : brief ? 'brief' : 'substantive' });
}

export function polishConversationReply(message, reply) {
    let text = String(reply || '').trim();
    // Drop only stock closing questions and canned assistant sign-offs, not genuine clarifying questions or substantive content.
    text = text.replace(/\s+How does (?:that|it) sound(?: to you| for the project)?\?\s*$/i, '').trim();
    text = text.replace(/\s*(?:(?:And\s+)?don['’]t hesitate to reach out[^\n]*|I['’]m here to help whenever you['’]re ready[^\n]*|Let me know if you need any further adjustments[^\n]*|Let me know if there are any specific aspects you['’]d like me to[^\n]*)\s*$/i, '').trim();
    if (/^(?:actually|correction|i meant|use .+ from now on)/i.test(String(message).trim())) {
        text = text.replace(/\s+How['’]s the project coming along\?[\s\S]*$/i, '').trim();
    }
    return text;
}

export function privateConversationBoundary(message, actor) {
    if (actor?.private === true) return null;
    const value = String(message);
    const privateHistory = /\b(?:private (?:chat|conversation|message)|direct messages?|DMs?)\b/i.test(value);
    const asksForContent = /\b(?:what .{0,80}(?:said|say|settle|decid|name|discuss)|tell me what|quote|recall|remember what)\b/i.test(value);
    return privateHistory && asksForContent ? 'I don’t have access to that private conversation in this channel. If you share the relevant part here, we can talk about it.' : null;
}

export async function guardConversationReply({ message, result, retry }) {
    const raw = value => String(value?.text || value?.response || '');
    const polished = value => { const text = polishConversationReply(message, raw(value)); return { ...value, text, response: text }; };
    // Executor/specialist receipts have their own authoritative rendering, not a chat rewrite.
    if (result?.cognitiveTransaction?.lane === 'agentic' || result?.cognitiveTransaction?.toolsUsed?.length) return result;
    let assessment = assessConversationReply(message, raw(result));
    if (assessment.acceptable && result?.degraded !== true) return { ...polished(result), conversationQuality: assessment };
    let revised;
    try { revised = await retry(assessment.issues); } catch { /* Keep an explicit, truthful failure. */ }
    if (revised) {
        assessment = assessConversationReply(message, raw(revised));
        if (assessment.acceptable && revised.degraded !== true) return { ...polished(revised), conversationQuality: assessment, conversationRepaired: true };
    }
    const text = 'I lost the thread on that reply. I don’t have a reliable answer yet; please try that once more.';
    return { ...result, text, response: text, degraded: true, conversationRepaired: true, conversationQuality: { ...assessment, acceptable: false } };
}
