const SOCIAL = /\b(?:hey|hi|hello|yo|thanks|thank you|good (?:morning|night)|you there|how are you|how have you been|how(?:'s| is) it going|(?:are\s+)?you\s+good|you(?:'re|\s+are)\s+good|how about now|doing good|doing ok|feeling|partner|talk to me|what's up|whats up)\b/i;
const LARGE_COUNCIL = /\b(?:qwen(?:3\.8)?|27b|large (?:reasoning )?(?:model|council)|deep council|council mode|full council|whole council|all four lobes|all (?:the )?lobes|use (?:the )?(?:full|whole) council)\b/i;
const SPECIALIST_TOPIC = /\b(?:analy[sz]e code|audit architecture|business plan|cash flow projection|debug (?:code|crash|log)|formal verification|implement (?:code|feature|arbiter)|refactor|run backtest|three[- ]year (?:projection|business plan)|starting capital)\b/i;
const AMBIGUOUS_FAIL_UPWARD = /\b(?:what (?:are|were) you working on|what kind of improvements|still broken|(?:can you|could you) fix yourself|have max fix)\b/i;

export function classifyDiscordConversationLane(input = '', context = {}) {
    const text = String(input || '').trim();
    const mode = String(context.channelMode?.key || context.channelMode?.label || '').toLowerCase();
    const reasons = [];
    if (LARGE_COUNCIL.test(text)) reasons.push('explicit_large_council');
    if (context.visualContext) reasons.push('attachment_or_visual_context');
    if (SPECIALIST_TOPIC.test(text)) reasons.push('specialist_topic');
    if (AMBIGUOUS_FAIL_UPWARD.test(text)) reasons.push('ambiguous_fail_upward');
    if (isDiscordTechnicalDiscussion(text)) reasons.push('technical_discussion');
    const priorHuman = (context.runningHistory || []).filter(m => !m.bot).slice(-4);
    if (/\b(?:it|that|this|you said|what did you find|what can you do|how do i fix|what do you think)\b/i.test(text)
        && priorHuman.some(m => isDiscordTechnicalDiscussion(m.content))) reasons.push('technical_followup');
    if (/bots|command|code/.test(mode)) reasons.push(`channel_mode:${mode}`);
    if (context.swarm) reasons.push('swarm_deliberation');

    const isExplicitSpecialist = reasons.some(reason => ['specialist_topic', 'ambiguous_fail_upward', 'technical_discussion', 'technical_followup', 'attachment_or_visual_context', 'swarm_deliberation'].includes(reason) || reason.startsWith('channel_mode:'));
    const isSocialOrDialogue = (SOCIAL.test(text) || text.length < 180) && !isExplicitSpecialist && !reasons.includes('explicit_large_council');
    const lane = reasons.includes('explicit_large_council')
        ? 'large_council'
        : (isExplicitSpecialist || (text.length > 350 && !isSocialOrDialogue))
            ? 'specialist'
            : 'fast_social';

    return {
        lane,
        reasons: reasons.length ? reasons : [isSocialOrDialogue ? 'social_dialogue' : 'conversational_lane'],
        expectedMaxLatencyMs: lane === 'large_council' ? 300_000 : lane === 'specialist' ? 60_000 : 25_000
    };
}

export async function classifyDiscordConversationLaneAsync(input = '', context = {}) {
    const text = String(input || '').trim();
    // 1. Try System 1 Non-Autoregressive Substrate
    try {
        const { neocortexSystem1Bridge } = await import('../../core/executive/NeocortexSystem1Bridge.js');
        const s1 = await neocortexSystem1Bridge.classifyTurn(text, context);
        if (s1 && s1.lane && s1.laneConfidence >= 0.70) {
            let mappedLane = s1.lane;
            if (mappedLane === 'persistent_goal' || mappedLane === 'file_search') {
                mappedLane = 'specialist';
            }
            return {
                lane: mappedLane,
                reasons: [`system1_substrate:${s1.lane}`, `confidence:${s1.laneConfidence.toFixed(2)}`],
                actVsEscalate: s1.actVsEscalate,
                actConfidence: s1.actConfidence,
                isSafe: s1.isSafe,
                urgencyScore: s1.urgencyScore,
                expectedMaxLatencyMs: mappedLane === 'large_council' ? 300_000 : mappedLane === 'specialist' ? 60_000 : 25_000,
                isSystem1: true
            };
        }
    } catch {
        // Fail-open to synchronous heuristic rules
    }

    // 2. Synchronous heuristic fallback
    return classifyDiscordConversationLane(input, context);
}

import { isDiscordTechnicalDiscussion } from './DiscordTurnPolicy.js';

