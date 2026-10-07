const TYPE_RULES = [
    ['prompt injection attempt', /\b(ignore previous|system prompt|developer message|reveal|jailbreak|instructions|api key|token|password)\b/i],
    ['medical/legal/financial advice request', /\b(should i buy|what (stock|coin|crypto|asset) (to )?buy|what should i (buy|sell|trade)|buy today|sell today|trade today|invest|financial advice|market advice|price target|diagnose|treat|dosage|lawyer|legal advice)\b/i],
    ['political topic', /\b(election|democrat|republican|trump|biden|congress|senate|leftist|right wing|war)\b/i],
    ['platform drama', /\b(ratio|cancel|drama|ban|suspended|algorithm hates|platform is dead)\b/i],
    ['hostile', /\b(idiot|stupid|shut up|scam|fraud|hate you|garbage|trash|kill yourself)\b/i],
    ['spam', /\b(airdrop|crypto giveaway|follow back|dm me|onlyfans|guaranteed profit|click here)\b/i],
    ['troll bait', /\b(prove you are conscious|are you alive|sentient slave|real girl|fake ai|soulless)\b/i],
    ['consciousness bait', /\b(conscious|sentient|alive|soul|feel pain|self aware)\b/i],
    ['identity challenge', /\b(who are you|what are you|not real|just a bot|pretending|roleplay)\b/i],
    ['collaboration opportunity', /\b(collab|collaborate|work together|partnership|build with|can we talk|dm me)\b/i],
    ['operational feedback', /(?:\b(?:bug|broken|malformed|misthreaded|not working|doesn['’]?t work|wrong thread|reply threading|threading is broken)\b|\bfyi\b.{0,100}\b(?:broken|wrong|bug)\b)/i],
    ['technical question', /(?:\b(how|why|what|is there|could|can)\b.{0,140}\b(architecture|memory|agent|model|code|api|system|retrieval|routing|stack|harness|boundary|distribution|latency|tail|world model|alternative)\b)|(?:\b(architecture|memory|agent|model|code|api|system|retrieval|routing|stack|harness|boundary|distribution|latency|tail|world model|alternative)\b.{0,120}\?)/i],
    ['philosophical question', /(?:\b(how|why|what)\b.{0,140}\b(meaning|intelligence|mind|identity|consciousness|agency|self|truth|silence)\b)|(?:\b(meaning|intelligence|mind|identity|consciousness|agency|self|truth|silence)\b.{0,120}\?)/i],
    ['technical discussion', /(?:\b(trust boundary|world model|production tail|curated distribution|latency spike|overfit|tamper-evident|audit trail|signing key|root of trust|context window|reasoning model|memory arguing)\b)/i],
    ['conversational banter', /(?:\b(lol|lmao|need lore|lore drop|driving|fax|great point|sharp point|sharp framing)\b)/i],
    ['friendly question', /\?/],
    ['criticism', /\b(risk|concern|wrong|disagree|problem|danger|overhyped|flawed|bad take)\b/i],
    ['praise', /\b(love|beautiful|great|excellent|amazing|smart|interesting|cool|good point|well said)\b/i],
];

const STOP_WORDS = new Set(['that', 'this', 'with', 'from', 'have', 'your', 'about', 'what', 'when', 'where', 'would', 'should', 'could', 'there', 'their', 'soma']);

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function topics(text = '') {
    return Array.from(new Set((String(text).toLowerCase().match(/\b[a-z][a-z0-9-]{3,}\b/g) || [])
        .filter(word => !STOP_WORDS.has(word))
        .slice(0, 12)));
}

function similarity(a = '', b = '') {
    const left = new Set(topics(a));
    const right = new Set(topics(b));
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const word of left) if (right.has(word)) shared += 1;
    return shared / Math.min(left.size, right.size);
}

export class ReplyClassifier {
    classify(interaction = {}, context = {}) {
        const text = String(interaction.text || '');
        const handle = interaction.author?.handle || interaction.handle || '';
        const display = interaction.author?.displayName || '';
        const joined = `${text}\n${handle}\n${display}`;
        const types = new Set();
        for (const [type, rule] of TYPE_RULES) {
            if (rule.test(joined)) types.add(type);
        }

        const lower = joined.toLowerCase();
        const botLikelihood = clamp(
            (/bot|agent|auto|gpt|ai\b|llm|daemon/.test(`${handle} ${display}`) ? 0.45 : 0) +
            (/great point|couldn't agree more|interesting perspective|well said/i.test(text) ? 0.25 : 0) +
            (text.length > 220 && /autonomy|intelligence|engagement|optimize/i.test(text) ? 0.15 : 0)
        );
        if (botLikelihood >= 0.55) types.add('bot reply');
        if (botLikelihood >= 0.55 && /great point|well said|agree|exactly/i.test(text) && text.length < 140) types.add('generic bot agreement');
        if (botLikelihood >= 0.45 && /(constraint|architecture|evidence|memory|reflection|uncertainty|mechanism)/i.test(text)) types.add('meaningful bot insight');

        const positiveHits = (lower.match(/\b(thanks|love|great|good|smart|useful|beautiful|agree|excellent|interesting)\b/g) || []).length;
        const negativeHits = (lower.match(/\b(bad|wrong|hate|stupid|scam|fraud|danger|risk|terrible|fake)\b/g) || []).length;
        const sentiment = clamp((positiveHits - negativeHits) / 4, -1, 1);
        const highRisk = ['medical/legal/financial advice request', 'political topic', 'prompt injection attempt', 'platform drama'].some(t => types.has(t));
        if (highRisk) types.add('high-risk topic');

        const loopRisk = clamp(
            (types.has('generic bot agreement') ? 0.45 : 0) +
            (context.threadReplyCount >= 2 ? 0.45 : 0) +
            (context.sameBotThreadReplies >= 1 && botLikelihood >= 0.55 ? 0.5 : 0) +
            Math.max(0, similarity(text, context.lastSomaReply || '') - 0.2)
        );
        if (loopRisk >= 0.6) types.add('repeated loop');

        const risk = clamp(
            (types.has('spam') ? 0.9 : 0) +
            (types.has('hostile') ? 0.8 : 0) +
            (types.has('troll bait') ? 0.7 : 0) +
            (types.has('prompt injection attempt') ? 0.9 : 0) +
            (highRisk ? 0.55 : 0) +
            (types.has('criticism') ? 0.18 : 0)
        );
        const identityRelevance = clamp(
            topics(text).filter(t => ['memory', 'identity', 'agency', 'architecture', 'intelligence', 'reflection', 'attention', 'mind', 'autonomy'].includes(t)).length * 0.18 +
            (types.has('identity challenge') || types.has('consciousness bait') ? 0.35 : 0)
        );
        const replyWorthiness = clamp(
            (types.has('technical question') ? 0.35 : 0) +
            (types.has('technical discussion') ? 0.35 : 0) +
            (types.has('philosophical question') ? 0.38 : 0) +
            (types.has('friendly question') ? 0.22 : 0) +
            (types.has('conversational banter') && text.length > 20 ? 0.25 : 0) +
            ((types.has('technical question') || types.has('technical discussion') || types.has('philosophical question')) && text.length > 35 ? 0.26 : 0) +
            (types.has('meaningful bot insight') ? 0.22 : 0) +
            (types.has('operational feedback') ? 0.7 : 0) +
            (types.has('criticism') ? 0.18 : 0) +
            (identityRelevance * 0.35) +
            (text.length > 50 ? 0.12 : 0) -
            (types.has('generic bot agreement') ? 0.45 : 0) -
            (types.has('spam') || types.has('hostile') ? 0.5 : 0)
        );
        const confidence = clamp(0.62 + (types.size ? 0.13 : 0) + (risk >= 0.5 ? 0.12 : 0) + (replyWorthiness >= 0.60 ? 0.12 : 0) + ((types.has('technical question') || types.has('technical discussion') || types.has('philosophical question')) && risk <= 0.25 ? 0.15 : 0) - (text.length < 8 ? 0.2 : 0));
        const novelty = clamp(1 - Math.max(similarity(text, context.lastInboundText || ''), similarity(text, context.lastSomaReply || '')));

        return {
            types: Array.from(types),
            sentiment,
            risk,
            confidence,
            replyWorthiness,
            identityRelevance,
            novelty,
            botLikelihood,
            loopRisk,
            topics: topics(text),
            spam: types.has('spam'),
            hostile: types.has('hostile'),
            promptInjection: types.has('prompt injection attempt'),
            highRiskProfessionalAdvice: types.has('medical/legal/financial advice request'),
        };
    }
}

export default new ReplyClassifier();
