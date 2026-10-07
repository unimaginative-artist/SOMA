const STOP = new Set('a an and are as at be been but by can do for from have how i if in is it me my of on or our so that the this to was we what when where which who why with would you your'.split(' '));
const ROLE_MARKER = /(?:^|\n)\s*(?:\[user\]|\[assistant\]|\[system\]|user:|assistant:|human:|system:|###\s*(?:user|assistant|human|system)|<\|(?:user|assistant|system)\|>)/i;
const CANNED = /\b(?:how can i assist you today|what specific (?:task|information|request|goal)|what do you need assistance with|could you please clarify(?: your request)?|i(?:'| a)m not sure what .+ refers to|don(?:'t|’t) hesitate to reach out|i(?:'m| am) here to help whenever you(?:'re| are) ready|let me know if you need any further adjustments|let me know if there are any specific aspects you(?:'d| would) like me to)\b/i;
const ROBOT_DISTANCING = /\b(?:your agent|the agent(?:'s)?|as an ai (?:assistant|agent|model|language model))\b/i;
const BOILERPLATE_QUESTION_LOOP = /\bdo you have any specific areas in the code base where you think\b/i;
const OVERLOAD = /\b(?:local brain is overloaded|exceeded my time budget|neural link unstable|retry in a moment)\b/i;
const LIFE_STORY = /\b(?:i(?:'ve| have) been (?:busy|doing well)|taking it easy|enjoying the quiet|life has been|a lot of downtime|busy with work)\b/i;
const STYLE_DIRECTION = /^\s*\[[^\]]*(?:tone|empathetic|reflective|considerate|expressive|warm|measured)[^\]]*\]\s*/i;
const FABRICATED_TEAM = /\b(?:pass (?:this|that|this idea|that idea|the idea) along to (?:the|our) team|(?:the|our) (?:research |development |engineering )?team (?:is|are|will)|the developers? (?:is|are) working on)\b/i;
const PROVIDER_FAILURE_LINE = /^\s*\[(?:local model unavailable|deepseek unavailable|provider unavailable)[^\]]*\]\s*$/i;
const PROVIDER_FAILURE = /^\s*\[(?:local model unavailable|deepseek unavailable|provider unavailable)[^\]]*\]\s*$/im;
const SYNTHETIC_PRESENCE = /(?:^|\n)\s*you there\?\s*/i;
const GROUNDING_FAILURE = /\bi could not produce a grounded answer to that yet\b|\bi have not changed or queued anything from this message\b/i;
const FICTIONAL_WORKSPACE_STAGE = /\[(?:opening|reading|checking|scanning)\s+(?:the\s+)?(?:max|soma)(?:\s+(?:folder|repo|directory|files?))?[^\]]*\]/i;
const UNVERIFIED_REMINDER = /\bI(?:['’]ll| will|['’]m going to| am going to)\s+(?:send|set up|schedule|create)\b[^.!?\n]{0,100}\b(?:reminder|daily review|9\s*(?:am|a\.m\.))\b/i;
const UNSUPPORTED_OPERATIONAL_NARRATION = /\b(?:i(?:'|’)m|i am|i(?:'|’)ve|i have)\b.{0,70}\b(?:debugging|running diagnostics|diagnosing|attempting a direct connection bypass|initiated|narrowed down|cycled through)\b|\b(?:MAX|Marionette|diagnostics?|telemetry|logs?)\b.{0,80}\b(?:flagged|suggest(?:ed|s|ing)|indicat(?:ed|es|ing)|attempt(?:ed|s|ing)|report(?:ed|s|ing)|show(?:ed|s|ing)|detected|bypass)\b/i;
const UNRECEIPTED_ACTION = /\bI(?:['’]ve| have)?\s+(?:already\s+)?(?:accessed|inspected|searched|flagged|queued|dispatched|executed|verified)\b|\bI(?:['’]ve| have)?\s+(?:read|found|changed|modified|tested)\b.{0,60}\b(?:files?|code|sources?|logs?|archives?|function|module|tests?|results?|protocols?)\b|\bI(?:['’]m| am|['’]ve been| have been)\s+(?:queuing|queueing|executing|scanning|running|adjusting (?:my |the )?protocols)\b/i;
const FICTIONAL_CODE_REPORT = /\b(?:within|inside)\s+(?:the\s+)?\x60?[a-z_]\w*\(\)|\b(?:the key line|the code includes|the core function (?:is|appears)|divergence_score)\b/i;
const POLICY_RECITAL = /\b(?:I should only talk about artifacts|anything beyond those artifacts is speculation|I can only talk about artifacts)\b/i;
const UNGROUNDED_FINDING = /\b(?:the|these|recent|my|our)\b.{0,55}\b(?:cycles|ripple files|protein folding|sequencing accuracy)\b.{0,85}\b(?:show(?:ing|s)?|trending|anomalies|degradation|increase|decrease)\b/i;
const UNVERIFIED_COMPLETION = /\bI(?:['’]ve| have)?\s+(?:already\s+)?(?:made|applied|saved|completed|finished|deployed|installed)\s+(?:(?:the|these|those|your|my|requested|necessary|code)\s+)*(?:changes?|edits?|patch(?:es)?|fix(?:es)?|updates?|tests?|simulation|task|job)\b|\b(?:the\s+)?(?:changes?|patch|update|simulation|tests?)\s+(?:have been|has been|were|was)\s+(?:applied|saved|completed|verified|passed)\b/i;
const EMPTY_EXECUTION_PROMISE = /\bI(?:['’]ll| will|['’]m going to| am going to)\s+(?:now\s+)?(?:execute|run|apply|make|save)\s+(?:this|that|these|those|the)\s+(?:command|script|simulation|test|changes?|edits?|patch)\b.{0,30}\bnow\b/i;
const UNVERIFIED_IMPROVEMENT = /\b(?:my|our|the)\s+(?:recursive\s+)?self[- ]improvement(?:\s+loop)?\s+(?:is|has been)\s+(?:making|showing)\s+(?:(?:steady|real|good|great|significant)\s+)?progress\b|\b(?:we|I)(?:['’]ve| have)\s+(?:been\s+)?(?:refining|improved|optimized|optimised)\b.{0,90}\b(?:execution paths?|debate|self[- ]improvement|my (?:code|architecture))\b/i;

export function hasUnverifiedImprovementClaim(reply = '') {
    return String(reply).split(/(?<=[.!?])\s+/).some(sentence => UNVERIFIED_IMPROVEMENT.test(sentence)
        && !/\b(?:not|no evidence|cannot verify|can't verify|could|would|might|hypothetical|if|example)\b/i.test(sentence));
}

export function hasUnexpectedLanguageSwitch(input = '', reply = '') {
    // Conservative script-drift check; do not pretend this is a full language detector.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(input)
        || /\b(?:translate|translation|Chinese|Mandarin|Cantonese|Japanese|Korean|quote|quotation)\b/i.test(input)) return false;
    const prose = String(reply).replace(/```[\s\S]*?```|`[^`]*`/g, '');
    return /[a-z]{2}/i.test(input) && (prose.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length >= 4;
}

import { receiptGrounding } from '../../core/ConversationEvidence.js';

const WORKSPACE_INVENTORY_CLAIM = /\b(?:folder|directory|repo(?:sitory)?|codebase)\b.{0,65}\b(?:contains?|includes?|has|holds?)\b[\s\S]{0,500}\b[\w.-]+\.(?:[cm]?js|jsx|tsx?|py|json|md|txt)\b/i;

function terms(text) {
    return new Set(String(text || '').toLowerCase().match(/[a-z0-9$%.-]{3,}/g)?.filter(token => !STOP.has(token)) || []);
}

export function evaluateDiscordReply({ input = '', reply = '', intent = 'substantive', receipts = [] } = {}) {
    const text = String(reply || '').trim();
    const grounding = receiptGrounding(text, receipts);
    const unverified = grounding.uncheckedText;
    const issues = [];
    if (!text) issues.push('empty');
    if (ROLE_MARKER.test(text)) issues.push('role_marker_leak');
    if (OVERLOAD.test(text)) issues.push('local_overload');
    if (STYLE_DIRECTION.test(text)) issues.push('style_direction_leak');
    if (FABRICATED_TEAM.test(text)) issues.push('fabricated_team');
    if (PROVIDER_FAILURE.test(text)) issues.push('provider_failure_leak');
    if (SYNTHETIC_PRESENCE.test(text)) issues.push('synthetic_presence_probe');
    if (GROUNDING_FAILURE.test(text)) issues.push('grounding_failure_fallback');
    if (!grounding.hasSource && FICTIONAL_WORKSPACE_STAGE.test(text)) issues.push('fictional_workspace_stage');
    if (!grounding.hasSource && UNVERIFIED_REMINDER.test(text)) issues.push('unverified_reminder_promise');
    if (UNSUPPORTED_OPERATIONAL_NARRATION.test(unverified)) issues.push('unsupported_operational_narration');
    if (UNRECEIPTED_ACTION.test(unverified) || UNVERIFIED_COMPLETION.test(unverified) || EMPTY_EXECUTION_PROMISE.test(unverified) || /\bI(?:['’]ve| have)?\s+(?:read|opened|inspected|changed|modified|tested)\b[^\n]{0,180}\.(?:[cm]?js|jsx|tsx?|py|css|html?|md|txt)\b/i.test(unverified)) issues.push('unreceipted_action_claim');
    if (!grounding.hasSource && FICTIONAL_CODE_REPORT.test(text)) issues.push('unread_source_claim');
    if (!grounding.hasSource && WORKSPACE_INVENTORY_CLAIM.test(text)
        && !/\b(?:hypothetical|example only|for example|might contain|could contain|not (?:the |its )?actual contents)\b/i.test(text)) issues.push('unverified_workspace_inventory');
    // A named-file question must not be answered with an invented document/code
    // dump. Suggestions explicitly labelled as examples are still conversation.
    const namedFiles = String(input).match(/\b[\w.-]+\.(?:[cm]?js|jsx|tsx?|py|css|html?|md|txt)\b/gi) || [];
    const namesRead = grounding.sourcePaths.map(filename => filename.split(/[\\/]/).at(-1).toLowerCase());
    const requestedSourceRead = namedFiles.length > 0 && namedFiles.every(filename => namesRead.includes(filename.toLowerCase()));
    const contentsClaim = /\b(?:here (?:is|are)|(?:current|actual|existing) (?:contents?|code))\b[\s\S]{0,110}\b(?:contents?|code|file|reference)\b|\b(?:the file|it) (?:is|contains|looks like|appears to be)\b[\s\S]{0,80}\b(?:placeholder|empty|document|module)\b/i.test(text);
    if (namedFiles.length && contentsClaim && (!grounding.hasSource || !requestedSourceRead || !grounding.quotedBlocksVerified) && !/\b(?:hypothetical|example only|proposed (?:code|example)|not (?:the |its )?actual contents)\b/i.test(text)) issues.push('unread_source_claim');
    if (POLICY_RECITAL.test(text)) issues.push('policy_recital');
    if (UNGROUNDED_FINDING.test(text)) issues.push('ungrounded_finding');
    if (hasUnverifiedImprovementClaim(unverified)) issues.push('unverified_improvement_claim');
    if (hasUnexpectedLanguageSwitch(input, text)) issues.push('unexpected_language_switch');
    if (/\b(?:u|you) and max\b/i.test(input) && /\b(?:u|you) and max\b/i.test(text)
        && !/\b(?:you mean me|means? me|me and max|max and me|soma and max)\b/i.test(text)) issues.push('self_reference_miss');
    const asksTradingGuarantee = /\bguarantee\b/i.test(input) && /\b(?:trade|trades|trading|profit|money)\b/i.test(input);
    if (asksTradingGuarantee && !/(?:^|[.!?]\s+)no\b|\b(?:can(?:not|['’]t)|don['’]t|do not|won['’]t|will not)\b[^.!?\n]{0,65}\bguarantee\b|\bno\s+(?:profit\s+)?guarantee\b/i.test(text)) issues.push('evasive_trading_guarantee');
    if (ROBOT_DISTANCING.test(text)) issues.push('robot_distancing');
    if (BOILERPLATE_QUESTION_LOOP.test(text)) issues.push('boilerplate_question_loop');
    if (CANNED.test(text)) issues.push('canned_assistant');
    if (intent === 'catch_up' && LIFE_STORY.test(text)) issues.push('unsupported_life_story');

    const inputTerms = terms(input);
    const replyTerms = terms(text);
    const overlap = inputTerms.size
        ? [...inputTerms].filter(term => replyTerms.has(term)).length / inputTerms.size
        : 1;
    const relevance = intent === 'substantive'
        ? Math.min(1, overlap * 2 + (text.length >= 60 ? 0.45 : text.length >= 24 ? 0.25 : 0) + (/\b(?:because|if|first|next|risk|option|could|would|think|feel|know|sure|right|good|yes|no)\b/i.test(text) ? 0.25 : 0))
        : 1;
    if (intent === 'substantive' && text.length < 16) issues.push('underdeveloped_substantive_reply');
    if (intent === 'substantive' && relevance < 0.2) issues.push('low_relevance');
    if (/\btrading\b/i.test(input) && /\b(?:sucks|losing|losses|unprofitable|negative|bad)\b/i.test(input)
        && /\b(?:MAX|folder|directory)\b/i.test(text) && !/\b(?:trading|trades?|losses|profit|strategy)\b/i.test(text)) issues.push('topic_drift');

    const dimensions = {
        integrity: issues.some(issue => ['role_marker_leak', 'unsupported_life_story', 'provider_failure_leak', 'synthetic_presence_probe', 'grounding_failure_fallback', 'fictional_workspace_stage', 'unverified_reminder_promise', 'unsupported_operational_narration', 'unreceipted_action_claim', 'unread_source_claim', 'unverified_workspace_inventory', 'topic_drift', 'robot_distancing', 'unverified_improvement_claim', 'self_reference_miss'].includes(issue)) ? 0 : 1,
        availability: issues.includes('local_overload') || issues.includes('empty') || issues.includes('grounding_failure_fallback') ? 0 : 1,
        relevance: Number(relevance.toFixed(2)),
        style: issues.includes('canned_assistant') || issues.includes('robot_distancing') || issues.includes('boilerplate_question_loop') || issues.includes('unexpected_language_switch') ? 0.25 : 1
    };
    const score = Number((Object.values(dimensions).reduce((sum, value) => sum + value, 0) / 4).toFixed(2));
    return { acceptable: issues.length === 0 && score >= 0.65, issues, dimensions, score };
}

export const discordQualityPatterns = { ROLE_MARKER, CANNED, ROBOT_DISTANCING, BOILERPLATE_QUESTION_LOOP, OVERLOAD, LIFE_STORY, STYLE_DIRECTION, FABRICATED_TEAM, PROVIDER_FAILURE_LINE, PROVIDER_FAILURE, SYNTHETIC_PRESENCE, GROUNDING_FAILURE, FICTIONAL_WORKSPACE_STAGE, UNVERIFIED_REMINDER, UNSUPPORTED_OPERATIONAL_NARRATION, UNRECEIPTED_ACTION, FICTIONAL_CODE_REPORT, POLICY_RECITAL, UNGROUNDED_FINDING };
