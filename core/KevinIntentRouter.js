const EMAIL_PATTERN = /([^\s<>()]+@[^\s<>()]+)/i;
const URL_PATTERN = /(https?:\/\/[^\s<>()]+)/i;
const DOMAIN_PATTERN = /\b(?:domain\s+)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})\b/;

const APPROVAL_REQUIRED = new Set([
    'calendar',
    'email_draft',
    'block_sender',
    'safe_sender'
]);

export class KevinIntentRouter {
    constructor(options = {}) {
        this.lowConfidenceThreshold = options.lowConfidenceThreshold || 0.65;
    }

    route(message = '', context = {}) {
        const text = String(message || '');
        const lower = text.toLowerCase();

        if (context.mode === 'debate' || context.symbol) {
            return this._intent('delegated_think', 1.0, {
                source: 'context',
                evidence: ['context requested debate/symbol reasoning'],
                entities: { symbol: context.symbol || null }
            });
        }

        const rules = [
            () => this._calendar(text, lower),
            () => this._emailCheck(text, lower),
            () => this._emailDraft(text, lower),
            () => this._investigate(text, lower),
            () => this._blockSender(text, lower),
            () => this._safeSender(text, lower),
            () => this._status(text, lower),
            () => this._help(text, lower),
            () => this._actionItems(text, lower)
        ];

        for (const rule of rules) {
            const intent = rule();
            if (intent) return this._finalize(intent);
        }

        return this._finalize(this._intent('general', 0.5, {
            source: 'fallback',
            evidence: ['no security/productivity intent matched']
        }));
    }

    _intent(type, confidence, details = {}) {
        return {
            type,
            confidence,
            source: details.source || 'rule',
            evidence: details.evidence || [],
            entities: details.entities || {},
            requiresApproval: details.requiresApproval ?? APPROVAL_REQUIRED.has(type),
            action: details.action,
            target: details.target,
            targetEmail: details.targetEmail,
            subtype: details.subtype,
            reason: details.reason || null
        };
    }

    _finalize(intent) {
        return {
            ...intent,
            lowConfidence: intent.confidence < this.lowConfidenceThreshold
        };
    }

    _calendar(text, lower) {
        const calendarKeywords = ['schedule', 'meeting', 'calendar', 'appointment', 'set up', 'setup', 'book', 'event', 'block time'];
        const timeKeywords = ['at', 'on', 'tomorrow', 'today', 'next', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'am', 'pm'];
        const hasCalendarKeyword = calendarKeywords.some(k => lower.includes(k));
        const hasTimeKeyword = timeKeywords.some(k => lower.includes(k));
        const hasDatePattern = /\d{1,2}[/-]\d{1,2}/.test(text);
        const hasTimePattern = /\d{1,2}:\d{2}|\d{1,2}\s*(am|pm|a|p)/i.test(text);

        if (!hasCalendarKeyword || !(hasTimeKeyword || hasDatePattern || hasTimePattern)) return null;
        return this._intent('calendar', 0.9, {
            evidence: ['calendar keyword', 'time/date signal'],
            requiresApproval: true
        });
    }

    _emailCheck(_text, lower) {
        if (lower.includes('check') && (lower.includes('email') || lower.includes('mail') || lower.includes('inbox'))) {
            return this._intent('email_check', 0.9, { evidence: ['check + email/mail/inbox'] });
        }
        if (/(?:what|any|show|get|read).*(?:email|mail|inbox)/.test(lower)) {
            return this._intent('email_check', 0.85, { evidence: ['email retrieval phrasing'] });
        }
        if (/(?:email|mail).*(?:have|got|received)/.test(lower)) {
            return this._intent('email_check', 0.85, { evidence: ['received mail phrasing'] });
        }
        return null;
    }

    _emailDraft(text, lower) {
        if (!/(?:draft|write|compose|reply|respond).*(?:email|mail|reply)/.test(lower)) return null;
        const email = text.match(EMAIL_PATTERN)?.[1] || null;
        return this._intent('email_draft', 0.9, {
            evidence: ['draft/reply phrasing'],
            entities: { email },
            targetEmail: email,
            requiresApproval: true
        });
    }

    _investigate(text, lower) {
        if (!/(?:investigate|research|check|look up|analyze|scan).*(?:sender|domain|url|link|email|address)/.test(lower)) return null;
        const email = text.match(EMAIL_PATTERN)?.[1] || null;
        const url = text.match(URL_PATTERN)?.[1] || null;
        const domain = text.match(DOMAIN_PATTERN)?.[1] || null;
        const target = email || url || domain;
        const subtype = email ? 'sender' : url ? 'url' : 'domain';

        return this._intent('investigate', target ? 0.9 : 0.72, {
            evidence: ['investigation verb + target class'],
            entities: { email, url, domain },
            target,
            subtype
        });
    }

    _blockSender(text, lower) {
        if (!/(?:block|blacklist|ban)\s+(?:sender|email|address)?/.test(lower)) return null;
        const email = text.match(EMAIL_PATTERN)?.[1] || null;
        return this._intent('block_sender', email ? 0.92 : 0.72, {
            evidence: ['block/blacklist verb'],
            entities: { email },
            target: email,
            requiresApproval: true
        });
    }

    _safeSender(text, lower) {
        if (!/(?:safe|whitelist|trust|approve|trusted)/.test(lower)) return null;
        const email = text.match(EMAIL_PATTERN)?.[1] || null;
        if (!email && !/(?:sender|email|address)/.test(lower)) return null;
        return this._intent('safe_sender', email ? 0.9 : 0.7, {
            evidence: ['safe/whitelist/trust verb'],
            entities: { email },
            target: email,
            requiresApproval: true
        });
    }

    _actionItems(_text, lower) {
        if (!/(?:action|task|todo|to-do|pending\s+items|items\s+pending|action\s+items)/.test(lower)) return null;
        const completeMatch = /(?:complete|done|finish|mark)/.test(lower);
        return this._intent('action_items', 0.85, {
            evidence: ['task/action item phrasing'],
            action: completeMatch ? 'complete' : 'list'
        });
    }

    _status(_text, lower) {
        if (!/(?:status|how are you|stats|statistics|health|report)/.test(lower)) return null;
        return this._intent('status', 0.8, { evidence: ['status/health phrasing'] });
    }

    _help(_text, lower) {
        if (!/(?:help|what can you|commands|abilities|features)/.test(lower)) return null;
        return this._intent('help', 0.9, { evidence: ['help/capability phrasing'] });
    }
}

export default KevinIntentRouter;
