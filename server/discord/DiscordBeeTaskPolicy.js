// Only explicit, owner-directed Bee paper research is executable here.
// General trading discussion and performance questions stay conversational.
export function isDirectedBacktestRequest(input = '') {
    const text = String(input || '').trim();
    if (!text || /\b(?:live trading|deploy|change the running|modify active)\b/i.test(text)) return false;
    return /\b(?:run|execute|perform|start|do|try)\b.{0,45}\bbacktests?\b/i.test(text)
        || /\bbacktests?\b.{0,45}\b(?:run|execute|perform|start)\b/i.test(text);
}

export function isBreezyBacktestRequest(input = '') {
    const text = String(input || '').trim();
    const directed = isDirectedBacktestRequest(text);
    const bee = /\b(?:breezy(?: bee)?|bee\s?bots?)\b/i.test(text);
    return directed && bee;
}

export function isBreezyBacktestApproval(input = '') {
    return /^(?:yes|yeah|yep|sure|okay|ok)[,! ]+(?:please\s+)?(?:stop asking(?: (?:me|for permission))?.{0,35})?(?:just\s+)?(?:run|execute|do it|proceed|go ahead)\b/i.test(String(input || '').trim());
}
