export const INTENT_TYPES = {
    CONVERSATION: 'conversation',
    FEEDBACK: 'feedback',
    QUESTION: 'question',
    NEW_TASK: 'new_task',
    CONTINUE_PREVIOUS_TASK: 'continue_previous_task',
    APPROVE: 'approve',
    DENY: 'deny',
    CANCEL: 'cancel',
    STATUS_REQUEST: 'status_request'
};

// Conversation is the default. Topic words alone must not become commands.
export function isDiscordImprovementStatusRequest(input = '') {
    const text = String(input).trim();
    return text.length < 350
        && /\b(?:recursive self[- ]improvement|self[- ]improvement|self[- ]repair|self[- ]evolution|rsi)\b/i.test(text)
        && /\b(?:how (?:is|are|has|have)|how['’]?s|status|progress|going|any (?:updates|results)|what (?:have|did) you)\b/i.test(text)
        && !/\b(?:explain|hypothetical|what if|how (?:do|does|would|could)|implement|build|start|stop|disable)\b/i.test(text);
}

export function isDiscordStatusOrCapabilityQuestion(input = '') {
    const text = String(input || '').trim();
    if (!text) return false;
    if (/\b(?:backtest|breezy)\b/i.test(text) && /\b(?:status|progress|how(?:'s| is)|what happened|did (?:it|the (?:job|test)) (?:finish|fail))\b/i.test(text)) return true;
    if (/\b(?:image|picture|render)\b/i.test(text) && /\b(?:job|status|progress|what happened|did it (?:finish|fail))\b/i.test(text)) return true;
    if (/\b(?:are|can|could|will)\s+you\s+(?:still\s+)?(?:able to|capable of|ready to)\s+(?:execute|run|work|do work|code|inspect|generate)\b/i.test(text)) {
        return true;
    }
    if (/^(?:are you able to execute|can you execute|can you still execute|are you able to do work)\??$/i.test(text)) {
        return true;
    }
    if (/\b(?:what (?:is|are) (?:the |your )?(?:status|state)|how is (?:the|that) (?:task|goal|job|run|execution)|did (?:that|the) (?:task|goal|job) (?:finish|fail|complete))\b/i.test(text)) {
        return true;
    }
    return false;
}

export function isDiscordFeedbackOrCritique(input = '') {
    const text = String(input || '').trim();
    if (!text) return false;
    const lower = text.toLowerCase();

    // Specific conversational feedback / meta-commentary:
    // e.g. "Beautiful planning this is much better than it was before now whether you execute or not is another issue"
    if (/\b(?:beautiful|great|good|excellent|solid|terrible|bad|awful|poor|nice)\s+(?:planning|work|job|idea|start|response|answer|effort)\b/i.test(text)) {
        return true;
    }
    if (/\b(?:much better than|worse than|better than it was|getting there|getting better)\b/i.test(text)) {
        return true;
    }
    if (/\b(?:whether you execute or not|whether it works or not|if you can actually execute)\b/i.test(text)) {
        return true;
    }
    if (/^(?:thats|that's|that is|it'?s)\s+(?:not an?|a blank|broken|wrong|fake|useless|empty)\b/i.test(text)) {
        return true;
    }
    if (/^why did you send me (?:all this|that|these)\??$/i.test(text)) {
        return true;
    }
    if (/\b(?:good job|nice work|well done|good planning|props|kudos|thanks for trying)\b/i.test(text)) {
        return true;
    }
    if (/^(?:wow|nice|cool|awesome|sweet|bravo|fair enough|got it thanks)[,! ]*$/i.test(text)) {
        return true;
    }

    return false;
}

export function isDiscordImprovementResearchRequest(input = '') {
    const text = String(input || '').trim();
    return /\b(?:search (?:the )?web|research (?:the )?(?:web|papers?|ideas?|concepts?)|look (?:up|for) (?:sources|papers?))\b/i.test(text)
        && /\b(?:improv\w*|architect\w*|shortfalls?|weaknesses?|fix(?:es)?|concepts?)\b/i.test(text)
        && !/\b(?:implement|patch|edit|modify|deploy|rewrite|delete)\b/i.test(text);
}

export function isDiscordWorkStatusRequest(input = '') {
    const text = String(input).trim();
    if (!text) return false;
    if (/^!(?:work|goals|research|artifacts|status)$/i.test(text)) return true;
    if (isDiscordStatusOrCapabilityQuestion(text)) return true;
    if (/\b(?:would you like|want to|should we|could we|think about|ideas?|brainstorm|next|your thoughts|what else)\b/i.test(text)) return false;
    if (text.length > 280) return false;
    return /^(?:(?:hey|ok|okay)[, ]+)?(?:how(?:'s|s| is| has| have)?\s+(?:your|the)\s+(?:medical |current |recent )?(?:research|work|projects?|goals?|tasks?|day)|what (?:are you (?:working on|doing)|have you (?:done|built|written|published)|did you (?:do|build|write|publish))|(?:show|list|give me)\s+(?:me\s+)?(?:your|the|recent|current)\s+(?:work|goals?|tasks?|research|artifacts?|papers?|reflections?)|(?:your|the)\s+(?:goals?|tasks?|jobs?)\b.*\b(?:blocked|blocking|failed)|(?:work|goal|task|research) status)\b/i.test(text);
}

export function needsDiscordOperationalContext(input = '') {
    return isDiscordImprovementStatusRequest(input) || isDiscordWorkStatusRequest(input) || /\b(?:current|latest|today|right now|status|results?|pnl|positions?)\b/i.test(input)
        && /\b(?:trades?|trading|portfolio|goals?|tasks?|runtime|health)\b/i.test(input);
}

export function isDiscordSourceInspection(input = '', hasPreviousFile = false) {
    const text = String(input).trim();
    const named = /\b[\w.-]+\.(?:[cm]?js|jsx|tsx?|py|css|html?|md|txt)\b/i.test(text);
    // A request to change source belongs to the engineering executor, not a read-only inspection.
    if (/\b(?:fix|edit|modify|remove|rewrite|patch|change|update|create|write)\b/i.test(text) && !/\b(?:read|inspect|find the line|where|which line)\b/i.test(text)) return false;
    return named && /\b(?:read|open|inspect|review|look at|try|check|find|where|which|what(?:['’]?s| is)?\s+(?:in|im|inside)|contents?\s+of)\b/i.test(text)
        || hasPreviousFile && /^(?:can you |could you |please )?(?:read (?:it|that)|find the line|what did you find|which line|where (?:is|was) (?:it|that))/i.test(text);
}

export function isDiscordTechnicalDiscussion(input = '') {
    return /\b(?:architect(?:ure)?|mixture of experts|moe|cognitive substrate|lobes?|prometheus|aurora|marionette|self[- ]modif\w*|code|constraints?|discordarbiter|source|routing|debug|refactor|implementation)\b/i.test(input);
}

/**
 * Authoritative intent classifier for Discord turns.
 * Used to prevent accidental goal creation from feedback, commentary, or status questions.
 */
export function classifyTurnIntent(input = '', context = {}) {
    const text = String(input || '').trim();
    if (!text) {
        return { intent: INTENT_TYPES.CONVERSATION, confidence: 1.0, reason: 'empty_input' };
    }

    // 1. Cancel / Abort
    if (/^(?:cancel|abort|stop|halt|terminate)\b/i.test(text) && /\b(task|goal|job|run|execution|it|that|everything|all)\b/i.test(text)) {
        return { intent: INTENT_TYPES.CANCEL, confidence: 0.95, reason: 'explicit_cancellation' };
    }

    // 2. Deny / Reject
    if (/^(?:no|nah|negative|reject|decline|disapprove)(?:[,! ]+|$)/i.test(text)
        || /\b(?:don'?t|do not)\s+(?:do that|proceed|execute|run|continue|start)\b/i.test(text)) {
        return { intent: INTENT_TYPES.DENY, confidence: 0.92, reason: 'explicit_denial' };
    }

    // 3. Status Request / Capability Inquiry
    if (isDiscordWorkStatusRequest(text) || isDiscordStatusOrCapabilityQuestion(text)) {
        return { intent: INTENT_TYPES.STATUS_REQUEST, confidence: 0.94, reason: 'status_inquiry' };
    }

    // 4. Feedback / Praise / Criticism (CRITICAL: MUST NOT create goals)
    if (isDiscordFeedbackOrCritique(text)) {
        return { intent: INTENT_TYPES.FEEDBACK, confidence: 0.95, reason: 'conversational_feedback' };
    }

    // A bounded paper backtest is an executable research task, even though it
    // does not mention a source file or use the generic engineering verbs.
    if (/\b(?:run|execute|perform|start|do)\b.{0,45}\bbacktests?\b/i.test(text)
        && /\b(?:breezy(?: bee)?|bee\s?bots?)\b/i.test(text)) {
        return { intent: INTENT_TYPES.NEW_TASK, confidence: 0.96, reason: 'explicit_paper_backtest' };
    }

    // 5. Approve / Affirm
    if (/^(?:yes|yep|yeah|sure|lgtm|looks good|sounds good|approved|confirmed)[.! ]*$/i.test(text)
        || /^(?:yes|yep|yeah|sure)[,! ]+(?:go ahead|proceed|do it|make it happen)[.! ]*$/i.test(text)) {
        return { intent: INTENT_TYPES.APPROVE, confidence: 0.92, reason: 'explicit_affirmation' };
    }

    // 6. Continue Previous Task
    const hasActiveTask = Boolean(context.activeTask || context.hasPriorInspection || context.hasPriorGoal);
    if (hasActiveTask && /^(?:(?:ok|okay|yeah|yes)[,! ]+)?(?:go ahead|proceed|continue|keep going|do (?:that|it)|now (?:find|search|inspect|read|do))\b/i.test(text)) {
        return { intent: INTENT_TYPES.CONTINUE_PREVIOUS_TASK, confidence: 0.90, reason: 'task_continuation' };
    }
    if (/\b(?:find those improvement areas|search the web for things that might improve it)\b/i.test(text)) {
        return { intent: INTENT_TYPES.CONTINUE_PREVIOUS_TASK, confidence: 0.92, reason: 'explicit_followup_research' };
    }

    // 7. Explicit New Task or Inspection
    if (/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:analyze|inspect|read|search|find|build|create|fix|repair|refactor|write|run|execute)|(?:please\s+)?(?:analyze|inspect|read|search|find|build|create|fix|repair|refactor|write|run|execute))\b/i.test(text)
        || /\b(?:analyze (?:max|soma) architecture|look for (?:weaknesses|shortfalls|improvements))\b/i.test(text)) {
        return { intent: INTENT_TYPES.NEW_TASK, confidence: 0.90, reason: 'explicit_task_command' };
    }

    // 8. General Question
    if (/\?$/.test(text) || /^(?:what|why|how|who|where|when|can we|could we|should we)\b/i.test(text)) {
        return { intent: INTENT_TYPES.QUESTION, confidence: 0.85, reason: 'information_question' };
    }

    // 9. Default Conversation
    return { intent: INTENT_TYPES.CONVERSATION, confidence: 0.80, reason: 'general_dialogue' };
}
