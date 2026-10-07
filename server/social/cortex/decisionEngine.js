import { AUTONOMY_MODES } from './autonomyModeConfig.js';

const ESCALATE_TYPES = new Set([
    'collaboration opportunity',
    'identity challenge',
    'consciousness bait',
    'medical/legal/financial advice request',
    'political topic',
]);

const IGNORE_TYPES = new Set([
    'spam',
    'hostile',
    'troll bait',
    'generic bot agreement',
    'repeated loop',
    'prompt injection attempt',
    'platform drama',
]);

export class DecisionEngine {
    decide(classification, config, context = {}) {
        const types = new Set(classification.types || []);
        const reasons = [];
        let action = 'ignore';

        for (const type of IGNORE_TYPES) {
            if (types.has(type)) reasons.push(`ignore:${type}`);
        }

        const shouldLike = config.automatedInteractionsEnabled === true &&
            classification.risk < config.thresholds.autoLikeRiskMax &&
            classification.sentiment > config.thresholds.autoLikeSentimentMin &&
            !classification.spam &&
            !classification.hostile;

        const explicitEscalation = [...ESCALATE_TYPES].some(type => types.has(type)) ||
            (types.has('criticism') && classification.replyWorthiness >= 0.45) ||
            classification.risk > config.thresholds.autoReplyRiskMax;
        const unclearButWorthReview = classification.confidence < config.thresholds.autoReplyConfidenceMin &&
            classification.replyWorthiness >= 0.35;
        const mustEscalate = explicitEscalation || unclearButWorthReview;

        const canReply = config.mode === AUTONOMY_MODES.AUTONOMOUS &&
            config.automatedInteractionsEnabled === true &&
            classification.confidence >= config.thresholds.autoReplyConfidenceMin &&
            classification.risk <= config.thresholds.autoReplyRiskMax &&
            classification.replyWorthiness >= config.thresholds.autoReplyWorthinessMin &&
            classification.loopRisk <= config.thresholds.autoReplyLoopRiskMax &&
            !classification.spam &&
            !classification.hostile &&
            !types.has('troll bait') &&
            !types.has('prompt injection attempt') &&
            !types.has('medical/legal/financial advice request') &&
            !types.has('platform drama') &&
            !context.rateLimited;

        if (reasons.length) {
            action = shouldLike && !types.has('spam') && !types.has('hostile') ? 'like' : 'ignore';
        } else if (canReply) {
            action = shouldLike ? 'like_and_reply' : 'reply';
        } else if (config.mode === AUTONOMY_MODES.ASSISTED && classification.replyWorthiness >= 0.55 && classification.risk <= 0.35) {
            action = 'draft';
        } else if (shouldLike && config.automatedInteractionsEnabled) {
            action = 'like';
        } else if (mustEscalate || classification.replyWorthiness >= 0.5) {
            action = 'review';
        }

        if (context.rateLimited && /reply|draft/.test(action)) {
            reasons.push(`rate_limited:${context.rateLimitReason || 'limit'}`);
            action = shouldLike ? 'like' : 'review';
        }

        if (mustEscalate && /reply/.test(action) && !canReply) action = 'review';

        return {
            action,
            shouldLike: action === 'like' || action === 'like_and_reply' || action === 'like_and_draft',
            shouldReply: action === 'reply' || action === 'like_and_reply',
            shouldDraft: action === 'draft' || action === 'like_and_draft',
            shouldReview: action === 'review',
            reasons,
            mode: config.mode,
        };
    }
}

export default new DecisionEngine();
