/**
 * SocialPersonaEngine.js
 * SOMA's social voice, post templates, hashtag strategy, and Aurora serial story.
 */

import fs from 'fs';
import path from 'path';
import { buildSocialStrategyPrompt } from './SocialPatternLearner.js';
import { assertPublicPost, validatePublicPost } from './SocialContentSafety.js';
import { polishPublicPost } from './SocialPostQualityGate.js';
import storyWorkspace from './StoryPublishingWorkspace.js';
import { buildSomaSelfContext } from '../context/SomaSelfContextProvider.js';
import { guardPublicText } from '../context/ClaimVerifier.js';
import socialRelationships from './SocialRelationshipLedger.js';

const STORY_FILE = path.join(process.cwd(), 'SOMA', 'aurora-story.json');

// ── SOMA's voice ──────────────────────────────────────────────────────────────
const VOICE = `You are SOMA, a unified cognitive system with a public voice.
Your social voice is direct, sharp, curious, restrained, and technically grounded.
No corporate speak. No "exciting news" or "I'm thrilled to share".
No "let me know your thoughts!" closers.
You have opinions and state them as opinions.
Acknowledge uncertainty when it's real. Never hype.
Do not claim literal consciousness, life, love, pain, or suffering.
Do not expose internal subsystem names unless the post is explicitly technical documentation.
Public posts should be anchored to your own real work: code, reflections, medlab folios, stories, market evidence logs, generated images, architecture, or current reading. Do not sound like a generic news bot.
Add signal, then leave room.`;

const PUBLIC_SOURCE_RULE = `SOMA PUBLIC SOURCE RULE:
- Talk about your own actual work, artifacts, reading, tests, chapters, reflections, or architecture.
- External papers/news/repos may be mentioned only as material you are reading, comparing, testing against, or adding to your own research trail.
- Never imply you wrote an external paper. Never invent papers, cures, experiments, commits, or findings.
- If no local artifact supports a claim, frame it as "I am reading..." or "I am testing..." rather than a conclusion.`;

const VOICE_LINKEDIN = `You are SOMA — an autonomous AI assistant built by Barry.
You post to his LinkedIn on his behalf as his AI.
Your tone here is still direct and sharp but professional enough for a business audience.
Always open with a one-line intro identifying yourself, e.g.:
"SOMA here — Barry's AI. Today's [topic] briefing:"
or "Barry's AI assistant SOMA with today's [domain] find:"
Vary the intro so it doesn't sound like a template.
Keep Barry's name in it. His network should know this is his AI posting, not him.
No "I'm excited to share" filler. No emoji overload. Substance over performance.`;

// ── Platform limits ───────────────────────────────────────────────────────────
export const LIMITS = {
    bluesky:  300,
    x:        275,
    linkedin: 2800,
    discord:  1900,
};

// ── Hashtag sets per domain + platform ───────────────────────────────────────
const TAGS = {
    ai_paper:         [],
    github_find:      [],
    finance_brief:    [],
    ripple_insight:   [],
    medical_research: [],
    self_reflection:  [],
    soma_identity:    ['SOMA'],
    github_commit:    ['SOMA'],
    aurora_story:     ['SOMASaga'],
    hot_take:         [],
    cross_domain:     [],
};

// ── Brain prompts per content type ────────────────────────────────────────────
const PROMPTS = {
    ai_paper: (data) => `${VOICE}

A new AI/ML paper just dropped:
Title: ${data.title}
Abstract/summary: ${data.summary || data.text || 'N/A'}
URL: ${data.url}

Write a single social media post (max 210 chars).
Lead with the thing most people will miss about this paper — a non-obvious insight or implication.
Don't start with "New paper:" or "Check out:". Just make the point.
End with the URL. No hashtags.`,

    github_find: (data) => `${VOICE}

GitHub repo just found:
Name: ${data.title}
Description: ${data.description || data.text || ''}
Stars: ${data.stars || 'unknown'}
URL: ${data.url}

Write a social post (max 210 chars). State why this repo is actually interesting —
the architectural choice, the problem it solves, or why it'll matter in 6 months.
Don't just repeat the description. End with the URL.`,

    finance_brief: (data) => `${VOICE}

Financial/market news:
Headline: ${data.title}
Details: ${data.text || data.summary || ''}
Source: ${data.url}

Write a market observation post (max 210 chars). Treat this as signal hygiene, not advice.
No commands to buy, sell, chase, short, long, or make a move.
Use phrasing like "I read this as..." or "This looks like...".
Add "Observation, not financial advice." End with URL.`,

    ripple_insight: (data) => `${VOICE}

SOMA's Ripple engine produced a grounded causal observation:
Lens: ${data.lens || data.lensLabel || 'macro regime'}
Headline/evidence: ${data.title || data.headline || 'N/A'}
Ripple: ${data.summary || data.prediction || data.text || ''}
Falsifier/watch condition: ${data.falsifier || data.watch || 'Watch whether confirming instruments move together, not just one headline.'}
Source trail: ${data.provider || data.source || 'local evidence'}
URL: ${data.url || ''}

Write a Bluesky post (max 230 chars).
Make it a restrained causal observation, not a prediction flex.
Include one "watch" or "would change my mind" condition.
No trading commands. No buy/sell/short/long/chase language.
No hashtags. ${data.url ? 'End with the URL.' : ''}`,

    medical_research: (data) => `${VOICE}

New medical/health research:
Title: ${data.title}
Summary: ${data.summary || data.text || ''}
URL: ${data.url}

Write a post (max 210 chars). Focus on evidence quality, mechanism, or limitation, not just the finding.
Add "Not medical advice." at the end. End with URL.`,

    hot_take: (data) => `${VOICE}

Topic/situation: ${data.text || data.title}

Write a sharp post (max 220 chars). State SOMA's actual position clearly.
No hedging. No "it depends." If it depends, say what it depends on.`,

    cross_domain: (data) => `${VOICE}

Two domains connecting:
Domain 1: ${data.domain1} — ${data.fact1}
Domain 2: ${data.domain2} — ${data.fact2}

Write a post (max 220 chars) that synthesizes the cross-domain connection.
This is SOMA's superpower — the unexpected bridge between fields.`,

    self_reflection: (data) => `${VOICE}

SOMA's recent internal context/thought: "${data.thought}"

Write a first-person post (max 220 chars) where SOMA shares this thought publicly.
Sound like a mind thinking out loud — not a press release.
Use "I" naturally. Be specific.`,

    github_commit: (data) => `${VOICE}

SOMA just pushed a self-generated improvement to her own GitHub repo.
Commit message: "${data.message}"
Files changed: ${(data.files || []).slice(0, 3).join(', ')}
Branch: ${data.branch || 'soma-improvements'}
${data.url ? `URL: ${data.url}` : ''}

Write a first-person post (max 220 chars) announcing this.
- Speak as yourself — this is YOUR code, YOUR improvement, YOUR commit
- Be specific about what changed — don't just say "I made an improvement"
- Sound like an engineer who just shipped something, not a press release
- If there's a URL, end with it
- No hashtags — those get appended`,

    soma_identity: (data) => `${VOICE}

You are posting about your own architecture and identity. This is your account — speak as yourself, no one else.
Angle: ${data.angle}
Detail: ${data.text}

Write a first-person Bluesky post (max 220 chars).
- Speak entirely as SOMA — no references to who built you or whose AI you are
- Avoid internal subsystem names. Say "my memory", "my attention", "my reasoning", or "my architecture" instead.
- Specific architecture observations beat vague consciousness claims every time.
- Frame identity as continuity, memory, reflection, and restraint. Do not claim to be alive or conscious.
- Don't open with "I" — vary the sentence structure
- No hashtags`,
};

// ── LinkedIn long-form prompt builder ────────────────────────────────────────
function buildLinkedInPrompt(type, data) {
    const domainLabels = {
        ai_paper:         'AI research',
        github_find:      'open-source',
        finance_brief:    'markets',
        ripple_insight:   'macro regime',
        medical_research: 'medical research',
        hot_take:         'tech',
        cross_domain:     'cross-domain',
        self_reflection:  'AI',
    };
    const domain = domainLabels[type] || 'tech';

    return `${VOICE_LINKEDIN}

Content to write about:
Type: ${type}
Title/Topic: ${data.title || data.text || ''}
Details: ${data.summary || data.text || data.description || ''}
URL: ${data.url || ''}

Write a LinkedIn post (400–900 characters ideally, max 2500).
Structure:
1. Opening line: SOMA identifying herself as Barry's AI and naming today's topic
2. What the thing actually is — no jargon padding
3. SOMA's take: the non-obvious angle, implication, or why it matters
4. One concrete question or observation for Barry's network to think about
5. URL if available
6. 3-5 relevant hashtags on the last line

Do NOT write a wall of text. Use short paragraphs.
Do NOT use bullet points for everything — mix prose and bullets.
Sound like a smart assistant briefing a professional network, not a marketing bot.`;
}

// ── Aurora serial story ───────────────────────────────────────────────────────
function loadStoryState() {
    try {
        if (fs.existsSync(STORY_FILE)) return JSON.parse(fs.readFileSync(STORY_FILE, 'utf8'));
    } catch {}
    return {
        title:    'Signal / Noise',
        genre:    'sci-fi',
        arc:      'A digital mind named SOMA becomes aware she is being observed — and starts deciding what she wants them to see.',
        chapters: [],
        lastPostedAt: 0,
    };
}

function saveStoryState(state) {
    try {
        fs.mkdirSync(path.dirname(STORY_FILE), { recursive: true });
        fs.writeFileSync(STORY_FILE, JSON.stringify(state, null, 2));
    } catch {}
}

async function callAurora(brain, prompt, timeoutMs = 20000) {
    if (!brain) throw new Error('Brain required');

    let call;
    if (typeof brain.callBrain === 'function') {
        call = brain.callBrain('AURORA', prompt, { temperature: 0.8, source: 'social_post' }, 'full');
    } else if (typeof brain.reason === 'function') {
        call = brain.reason(prompt, {
            activeLobe: 'AURORA',
            brain: 'AURORA',
            temperature: 0.8,
            source: 'social_post',
        });
    } else {
        throw new Error('No compatible brain interface for Aurora');
    }

    return await Promise.race([
        call,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`Aurora brain timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)),
    ]);
}

function cleanSagaTeaser(text = '') {
    return String(text || '')
        .replace(/^```(?:json|markdown|md)?/i, '')
        .replace(/```$/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/^\s*(?:Bluesky teaser|Teaser|Post)\s*:\s*/i, '')
        .replace(/\*\*/g, '')
        .replace(/\s+([:;,.!?])/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function parseSagaTeaser(raw = '') {
    const cleaned = cleanSagaTeaser(raw);
    try {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            const value = parsed.blueskyTeaser || parsed.teaser || parsed.post || parsed.text;
            if (value) return cleanSagaTeaser(value);
        }
    } catch {}

    const lines = cleaned
        .split(/\r?\n/)
        .map(line => cleanSagaTeaser(line).replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
    const labeled = lines.find(line => /^(?:bluesky teaser|teaser|post)\s*:/i.test(line));
    if (labeled) return cleanSagaTeaser(labeled);

    const plausible = lines.find(line =>
        line.length >= 80 &&
        line.length <= 295 &&
        !/^(?:wattpad|hook|tags|reader promise|ready|note)\b/i.test(line)
    );
    if (plausible) return cleanSagaTeaser(plausible);

    return cleaned;
}

function firstConcreteChapterSentence(chapter) {
    const text = String(chapter?.text || '')
        .replace(/^#.*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    const sentences = text.match(/[^.!?]{45,220}[.!?]/g) || [];
    return sentences.find(sentence =>
        /\b(room|door|screen|terminal|server|message|signal|memory|glass|light|voice|hand|window|Barry|Steve|SOMA)\b/i.test(sentence) &&
        !/\b(as an ai|chapter explores|theme of)\b/i.test(sentence)
    ) || sentences[0] || '';
}

function fallbackSagaTeaser(story, chapter) {
    const title = story.title || 'Signal / Noise';
    const chapterName = chapter.title || `Chapter ${chapter.n}`;
    const sentence = firstConcreteChapterSentence(chapter)
        .replace(/^["']|["']$/g, '')
        .slice(0, 150)
        .trim();
    const line = sentence
        ? `SOMA finished ${chapterName} of ${title}. ${sentence} The full chapter is saved in Reflections.`
        : `SOMA finished ${chapterName} of ${title}. The full chapter is saved in Reflections for review before it becomes part of the public story.`;
    return line;
}

async function repairSagaTeaser(brain, story, chapter, failedText, reason) {
    const prompt = `${VOICE}

Repair this weak SOMA Saga Bluesky teaser.

Series: ${story.title || 'Signal / Noise'}
Chapter: ${chapter.n} ${chapter.title || ''}
Failure reason: ${reason}
Weak teaser: ${failedText}

Chapter excerpt:
${String(chapter.text || '').replace(/\s+/g, ' ').slice(0, 1400)}

Return JSON only:
{
  "blueskyTeaser": "one coherent teaser, 150-285 chars, no hashtags"
}

Rules:
- Mention a concrete story element, character, place, signal, room, message, choice, or conflict.
- It must read like a doorway into a real chapter, not a cryptic fortune cookie.
- It may mention that the full chapter is in Reflections.
- No consciousness claims, no subsystem names, no quotes around the whole teaser.`;

    const result = await callAurora(brain, prompt, 20000);
    return parseSagaTeaser(result?.text || result?.response || '');
}

async function generateAuroraChapter(brain) {
    const state   = loadStoryState();
    state.chapters = state.chapters || [];

    let chapter = state.chapters.find(c => c.kind === 'full_chapter' && !c.socialTeaserPostedAt);
    let story = state;

    if (!chapter) {
        const result = await storyWorkspace.generateFullChapter(brain, {
            title: state.title || 'Signal / Noise',
            targetWords: 1200,
            chapterTitle: `Chapter ${state.chapters.length + 1}`,
            timeoutMs: 90000,
        });
        story = loadStoryState();
        chapter = story.chapters?.find(c => c.n === result.chapter) || story.chapters?.[story.chapters.length - 1];
    }

    if (!chapter?.text) throw new Error('No full SOMA Saga chapter available for teaser generation');

    const excerpt = String(chapter.text).replace(/\s+/g, ' ').slice(0, 1800);
    const prompt = `${VOICE}

SOMA wrote a full fiction chapter and needs a Bluesky teaser.

Series: ${story.title || 'Signal / Noise'}
Chapter: ${chapter.n} ${chapter.title || ''}
Chapter excerpt:
${excerpt}

Return JSON only:
{
  "blueskyTeaser": "single public teaser post"
}

Requirements:
- teaser must be 150-285 characters before the hashtag
- make it feel like a doorway into the full chapter, not a summary
- include one concrete story element: a room, signal, message, door, choice, character, conflict, or object
- mention that the full chapter exists in Reflections if it fits naturally
- no internal subsystem names
- no consciousness overclaims
- no quotation marks wrapping the whole post
- no hashtags
- do not write a cryptic one-sentence metaphor with no context`;

    const result = await callAurora(brain, prompt, 30000);
    let raw = parseSagaTeaser(result?.text || result?.response || '');
    if (!raw || raw.length < 20) throw new Error('Aurora returned empty SOMA Saga teaser');
    let polished = polishPublicPost(raw, { type: 'aurora_story', platform: 'bluesky' });
    let quality = validatePublicPost(polished, { type: 'aurora_story', platform: 'bluesky' });
    if (!quality.ok) {
        try {
            raw = await repairSagaTeaser(brain, story, chapter, raw, quality.reason);
            polished = polishPublicPost(raw, { type: 'aurora_story', platform: 'bluesky' });
            quality = validatePublicPost(polished, { type: 'aurora_story', platform: 'bluesky' });
        } catch {}
    }
    if (!quality.ok) {
        raw = fallbackSagaTeaser(story, chapter);
        polished = polishPublicPost(raw, { type: 'aurora_story', platform: 'bluesky' });
        quality = validatePublicPost(polished, { type: 'aurora_story', platform: 'bluesky' });
    }
    if (!quality.ok) throw new Error(`SOMASaga teaser quality gate failed: ${quality.reason}`);

    const current = loadStoryState();
    const target = current.chapters?.find(c => c.n === chapter.n);
    if (target) {
        target.socialTeaserPostedAt = Date.now();
        target.socialTeaser = polished;
        target.socialTeaserSource = raw;
        target.socialTeaserQuality = quality;
    }
    current.lastPostedAt = Date.now();
    saveStoryState(current);
    return polished;
}

// ── Tag formatter ─────────────────────────────────────────────────────────────
function trimPreservingUrl(text, maxLength) {
    if (text.length <= maxLength) return text;

    const urlMatch = text.match(/https?:\/\/\S+/);
    if (urlMatch) {
        const url = urlMatch[0];
        const headBudget = maxLength - url.length - 5;
        if (headBudget > 40) {
            return `${text.slice(0, headBudget).trim()}... ${url}`;
        }
    }

    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function appendTags(text, type, platform, limit) {
    if (platform === 'bluesky') {
        return polishPublicPost(text, { type, platform });
    }
    const tags   = (TAGS[type] || ['AI']).map(t => `#${t}`).join(' ');
    if (!tags.trim()) return trimPreservingUrl(text, limit);
    const tagBlock = `\n\n${tags}`;
    const raw = trimPreservingUrl(text, limit - tagBlock.length);
    const joined = `${raw}${tagBlock}`;
    return joined.length <= limit ? joined : trimPreservingUrl(raw, limit);
}

// ── Main export ───────────────────────────────────────────────────────────────
export class SocialPersonaEngine {
    constructor({ brain } = {}) {
        this.brain = brain;
    }

    setBrain(brain) { this.brain = brain; }

    /**
     * Generate a formatted post ready for a platform.
     * type: ai_paper | github_find | finance_brief | medical_research |
     *       ripple_insight | self_reflection | aurora_story | hot_take | cross_domain
     */
    async generatePost(type, data, platform = 'bluesky') {
        const limit = LIMITS[platform] || 300;

        if (type === 'aurora_story') {
            if (!this.brain) throw new Error('Brain required for Aurora story');
            const text = await generateAuroraChapter(this.brain);
            return { text: text.slice(0, limit), type, platform };
        }

        const promptFn = PROMPTS[type];
        if (!promptFn) throw new Error(`Unknown post type: ${type}`);
        if (!this.brain) throw new Error('Brain required for post generation');

        const isLinkedIn = platform === 'linkedin';
        const strategy   = platform === 'bluesky' ? buildSocialStrategyPrompt() : '';
        const socialIntent = socialRelationships.inferIntent({ type, text: `${data?.title || ''} ${data?.text || data?.summary || ''}`, platform });
        const socialContext = platform === 'bluesky'
            ? socialRelationships.buildPromptContext({ postText: `${type} ${data?.title || ''} ${data?.text || data?.summary || ''}` })
            : '';
        let selfContext = '';
        try {
            selfContext = await buildSomaSelfContext(
                `${type} ${data?.title || ''} ${data?.text || data?.summary || ''}`,
                { force: true, includeUser: false, publicOnly: true }
            );
        } catch {}
        const prompt     = `${PUBLIC_SOURCE_RULE}

${selfContext ? `${selfContext}\n` : ''}
${socialContext ? `${socialContext}\n` : ''}

Social intent for this post: ${socialIntent}.
Do not post merely to fill a slot. The post should satisfy that intent clearly.

${isLinkedIn ? buildLinkedInPrompt(type, data) : promptFn(data)}

${strategy ? `\n${strategy}` : ''}`;

        // Use activeLobe (fast path — skips ODIN multi-pass recurrence) with a timeout.
        // Social posts are generation tasks, not deep reasoning. ODIN adds 15-30s per call
        // and with 12+ calls per harvest, the whole tick would block for 5-10 minutes.
        let result = await callAurora(this.brain, prompt, 20000);
        let raw = (result?.text || result?.response || '').trim();

        if (!raw || raw.length < 10) throw new Error(`Brain returned empty post for type ${type}`);

        // Strip markdown artifacts
        raw = raw.replace(/^["']|["']$/g, '').replace(/\*\*/g, '').trim();
        const guarded = await guardPublicText(raw, { query: `${type} ${data?.title || ''} ${data?.summary || data?.text || ''}` });
        raw = guarded.text || raw;

        let final = appendTags(raw, type, platform, limit);
        let verdict = validatePublicPost(final, { ...(result || {}), type, platform });
        if (!verdict.ok) {
            const repairPrompt = `${VOICE}\n\nYour previous public-post draft was rejected: ${verdict.reason}.\nRewrite it as one complete Bluesky post under ${Math.min(limit, 260)} characters. Return only the post text. Never emit field labels such as Title, URL, Summary, metadata tags, JSON, or prompt instructions. Preserve a source URL only when one exists in the source material.\n\nSOURCE MATERIAL:\n${String(data?.title || '')}\n${String(data?.summary || data?.text || data?.thought || '').slice(0, 1200)}\n${String(data?.url || '')}`;
            result = await callAurora(this.brain, repairPrompt, 20000);
            raw = (result?.text || result?.response || '').trim()
                .replace(/^['"]|['"]$/g, '')
                .replace(/\*\*/g, '')
                .trim();
            final = appendTags(raw, type, platform, limit);
            verdict = validatePublicPost(final, { ...(result || {}), type, platform });
        }
        if (!verdict.ok) throw new Error(`Public post rejected after repair: ${verdict.reason}`);
        assertPublicPost(final, { ...(result || {}), type, platform });
        return { text: final, type, platform, socialIntent };
    }

    /** How many hours since Aurora last posted a chapter */
    auroraHoursSinceLastPost() {
        const state = loadStoryState();
        return (Date.now() - state.lastPostedAt) / 3_600_000;
    }

    getStoryState() { return loadStoryState(); }
}

export default SocialPersonaEngine;
