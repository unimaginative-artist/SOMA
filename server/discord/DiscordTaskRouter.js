import os from 'os';
import path from 'path';
import { isDiscordFeedbackOrCritique } from './DiscordTurnPolicy.js';

const clean = value => String(value || '').replace(/^\s*(?:hey\s+)?soma[,\s:]*/i, '').trim();

const WORK_VERB = '(?:build|create|develop|implement|consolidate|compile|combine|merge|synthesi[sz]e|organize|formulate|research|investigate|study|search|find|fix|repair|diagnose|optimi[sz]e|refactor|write|prepare|generate|run|execute|backtest|simulate|test)';

export function isExplicitGoalAuthorization(input = '') {
    const text = clean(input);
    if (!text || isDiscordFeedbackOrCritique(text) || /\b(?:no goal|don'?t que(?:ue)?|do not que(?:ue)?|without (?:setting up |creating )?(?:a )?(?:queued |background )?(?:goal|task|job)|no background|just (?:answer|tell me|chat)|chat only)\b/i.test(text)) {
        return false;
    }

    // Status, explanation, and brainstorming questions are conversation. They
    // may contain words such as "research", "fix", or "goal", but they do not
    // authorize a durable executor job.
    if (/^(?:how(?:'s|s| is| has| have| did| do| would| could| should)?|what(?:'s| is| are| was| were| did| do| would| could| should)?|why|who|where|when|is|are|am|do|does|did|have|has|can we|could we|should we)\b/i.test(text)) {
        return false;
    }

    // Vague conversational questions about "fixing it" or persona restoration
    if (/^(?:yeah|yea|well|ok|okay|so|oh|i see)[, ]+.*can you fix it\??$/i.test(text)) {
        return false;
    }
    if (/\b(?:fix\s+her|shes\s+back\s+to\s+her\s*self|back\s+to\s+her\s*self)\b/i.test(text)) {
        return false;
    }

    return new RegExp(`\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${WORK_VERB}\\b`, 'i').test(text)
        || new RegExp(`^(?:ok(?:ay)?[,! ]+|yeah[,! ]+|please\\s+)?${WORK_VERB}\\b`, 'i').test(text)
        || new RegExp(`^(?:ok(?:ay)?[,! ]+|yeah[,! ]+)?(?:let['’]?s|lets)\\s+${WORK_VERB}\\b`, 'i').test(text)
        || /^(?:\/goal|\/queue|queue\s+(?:a\s+|an\s+)?(?:background\s+|autonomous\s+)*(?:goal|task|job|research|diagnostic)|start\s+(?:a\s+|an\s+)?(?:background\s+|autonomous\s+)*(?:goal|task|job|research|diagnostic|paper\s+trading))\b/i.test(text)
        || /\b(?:go ahead(?: and)?|please do|do it|make it happen)\b/i.test(text);
}

export function extractFileSearchRequest(input = '', workspace = process.cwd()) {
    const text = clean(input);
    // A mention of searching is not an instruction to search. In particular,
    // "I spent all day fixing your ability to search files" is conversation.
    const directedSearch = /^(?:(?:please|can you|could you|would you)\s+)?(?:find|search|locate|look for)\b/i.test(text);
    const isFileSearch = directedSearch
        && /\b(computer|machine|pc|drive|files?|folders?|repo|repository|desktop|documents?|story|called|named)\b/i.test(text)
        && !/\b(research|papers?|literature|web|internet|online|study|studies)\b/i.test(text);
    if (!isFileSearch) return null;

    const quoted = text.match(/[`"']([^`"']+)[`"']/);
    const afterFor = text.match(/\b(?:for|called|named)\s+(.+?)(?:\s+(?:on|in|across)\s+(?:this|my|the)\s+(?:computer|machine|pc|drive|files?|folders?))?[?.!]*$/i);
    let query = (quoted?.[1] || afterFor?.[1] || '').trim();
    query = query.replace(/^(?:a|an|the)\s+/i, '').replace(/[?.!]+$/, '').trim();
    if (!query) return { kind: 'file_search', error: 'Tell me the filename or phrase to search for.' };

    const wholeComputer = /\b(computer|machine|pc|drive|desktop|documents?)\b/i.test(text);
    return {
        kind: 'file_search',
        query: query.slice(0, 160),
        root: wholeComputer ? os.homedir() : path.resolve(workspace),
        scope: wholeComputer ? 'personal computer' : 'SOMA workspace',
    };
}

export function classifyPersistentTask(input = '') {
    const text = clean(input);
    if (text.length < 12 || isDiscordFeedbackOrCritique(text)) return null;
    if (/\b(make|generate|draw|create|render|turn|convert|transform|redraw|edit)\b.{0,80}\b(image|picture|photo|art|illustration|visual|this)\b/i.test(text)
        && !/\b(app|application|website|tool|program|code|api)\b/i.test(text)) return null;

    const synthesis = /\b(consolidate|compile|combine|merge|synthesi[sz]e|organize|turn|formulate)\b/i.test(text);
    const stories = /\b(somasagas?|soma\s+sagas?|stories?|chapters?|reflections?)\b/i.test(text);
    const medical = /\b(medical|clinical|biotech|biology|biological|disease|therapeutic|genom\w*|mitochondri\w*|cell(?:ular)?)\b/i.test(text);
    const tech = /\b(ai|llm|llms|model|models|neural|agent|agents|substrate|substrates|neocortex|cortex|software|code|architecture|computing|vector|vectors|memory)\b/i.test(text);
    const paper = /\b(paper|manuscript|journal|publication|literature review)\b/i.test(text);
    const app = /\b(app|application|website|dashboard|tool|program|interface|ui)\b/i.test(text)
        && /\b(build|create|make|develop|implement|code|design)\b/i.test(text);
    const research = /\b(research|look up|investigate|study|search (?:the )?(?:web|internet|literature)|find (?:papers?|research))\b/i.test(text);
    const trading = /\b(trading|trade(?:s|d|r|rs|ing)?|paper\s+trad(?:e|ing)|p\s*&?\s*l|pnl|profit\s+factor|win\s+rate|market\s+strategy|yield\s+harvester|btc|eth|crypto)\b/i.test(text)
        || /\b(?:fix|improve|diagnose|optimi[sz]e)\s+(?:it|this|the strategy)\b[\s\S]*\b(?:make|making|profit|money)\b/i.test(text)
        || /\b(?:backtest(?:ing)?|simulat(?:e|ion)|trend[ -]following)\b/i.test(text)
        || /\bstart\s+making\s+money\b/i.test(text);

    // Conversational question openers / chit-chat phrasing / question marks are NOT background tasks
    const lowerText = text.toLowerCase();
    const explicitWorkRequest = isExplicitGoalAuthorization(text)
        || /\b(?:build|create|develop|implement)\s+me\b/i.test(text)
        || (trading && /\b(?:fix|repair|diagnose|improve|optimi[sz]e|start making|backtest|simulate)\b/i.test(text)
            && !/^(?:how(?:'s|s| is| has| do| did| should| could| would)?|what|why|is|are|do|does|did|can we|could we|should we|oh so|so)\b/i.test(text));
    const isConversationalQuestion = (
        /\?/.test(text) ||
        /^(yeah|yea|yep|ok|okay|well|so|oh|hey|hi|hello|no|nah)\b/i.test(lowerText) ||
        /\b(can|could|would|will|should|did|do|does|have|has|is|are|am|why|how|hows|what|where|who|tell|show|check|see|read|open)\b/i.test(lowerText)
    ) && !explicitWorkRequest
      && !/\b(queue|background|async|job|daemon|schedule|cron|start an?|build an?|run an?)\b/i.test(lowerText);

    if (trading && explicitWorkRequest && !isConversationalQuestion) return { kind: 'trading_diagnostic', category: 'trading', domain: 'paper_trading', request: text };
    if (explicitWorkRequest && synthesis && (stories || medical || paper || tech || research)) {
        const domain = medical ? 'medical_research'
            : tech ? 'tech_research'
            : stories ? 'story_reflections'
            : paper ? 'tech_research'
            : 'general_research';
        return { kind: 'artifact_synthesis', category: 'knowledge_synthesis', domain, request: text };
    }
    if (explicitWorkRequest && app && !isConversationalQuestion) return { kind: 'app_build', category: 'engineering', domain: 'software', request: text };
    if (explicitWorkRequest && research && !isConversationalQuestion) {
        const domain = medical ? 'medical_research' : tech ? 'tech_research' : 'general_research';
        return { kind: 'research', category: 'research', domain, request: text };
    }
    if (explicitWorkRequest && /\b(build|create|implement|fix|repair|refactor|write|prepare|generate)\b/i.test(text) && !isConversationalQuestion) {
        return { kind: 'engineering', category: 'engineering', domain: tech ? 'software' : 'general', request: text };
    }
    return null;
}

export function taskOutputHint(task, timestamp = Date.now(), home = os.homedir()) {
    const stamp = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
    if (task.kind === 'app_build') return path.join(home, 'Desktop', 'Soma Projects', `discord-${stamp}`);
    if (task.kind === 'trading_diagnostic') return path.join(home, 'Documents', 'Soma', 'Artifacts', `paper-trading-diagnostic-${stamp}.md`);
    return path.join(home, 'Documents', 'Soma', 'Artifacts', `${task.domain}-${stamp}.md`);
}
