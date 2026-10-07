import fs from 'fs';
import path from 'path';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const LEDGER_DIR = path.join(SOMA_DIR, 'stories', 'research');
const LEDGER_FILE = path.join(LEDGER_DIR, 'story-research-ledger.json');
const REFLECTIONS_DIR = path.join(process.cwd(), 'data', 'vault', 'reflections');
const BOOKS_WORKBOOK = "Owner's Books";

const NARRATIVE_STRUCTURES = [
    {
        id: 'heros_journey',
        name: "Hero's Journey",
        bestFor: ['mythic transformation', 'adventure', 'identity change', 'quest'],
        beats: ['ordinary world', 'call', 'refusal', 'mentor', 'threshold', 'tests', 'ordeal', 'reward', 'road back', 'resurrection', 'return changed'],
        caution: 'Can feel formulaic if every beat is literal.',
    },
    {
        id: 'save_the_cat',
        name: 'Save the Cat',
        bestFor: ['commercial pacing', 'high readability', 'clear midpoint', 'strong finale'],
        beats: ['opening image', 'theme stated', 'setup', 'catalyst', 'debate', 'break into two', 'fun and games', 'midpoint', 'bad guys close in', 'all is lost', 'dark night', 'break into three', 'finale', 'final image'],
        caution: 'Can become mechanical if beat timing matters more than character truth.',
    },
    {
        id: 'three_act',
        name: 'Three-Act / Five-Act',
        bestFor: ['baseline architecture', 'novels', 'screenplays', 'clean escalation'],
        beats: ['setup', 'inciting incident', 'first turn', 'rising complications', 'midpoint', 'crisis', 'climax', 'resolution'],
        caution: 'Too broad alone; needs a secondary structure for chapter-level movement.',
    },
    {
        id: 'dan_harmon_circle',
        name: 'Dan Harmon Story Circle',
        bestFor: ['serial chapters', 'episodes', 'short arcs', 'character need loops'],
        beats: ['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change'],
        caution: 'Works best as a micro-structure, not the only novel scaffold.',
    },
    {
        id: 'kishotenketsu',
        name: 'Kishotenketsu',
        bestFor: ['quiet chapters', 'introspection', 'non-conflict development', 'poetic turns'],
        beats: ['introduction', 'development', 'twist', 'reconciliation'],
        caution: 'May feel low-stakes if the twist does not transform meaning.',
    },
    {
        id: 'revelation_ladder',
        name: 'Mystery Box / Revelation Ladder',
        bestFor: ['thriller', 'mystery', 'sci-fi suspense', 'ARG-like serials'],
        beats: ['open question', 'partial answer', 'cost of knowing', 'new contradiction', 'reframe', 'larger question'],
        caution: 'Withholding without payoff breaks trust.',
    },
    {
        id: 'romance_arc',
        name: 'Romance Arc',
        bestFor: ['relationship-driven stories', 'trust arcs', 'intimacy under pressure'],
        beats: ['meet pressure', 'attraction', 'misread', 'vulnerability', 'rupture', 'choice', 'earned trust'],
        caution: 'Only use when relationship change is a core engine, not decoration.',
    },
    {
        id: 'mice_quotient',
        name: 'MICE Quotient',
        bestFor: ['promise tracking', 'open/close discipline', 'multi-thread stories'],
        beats: ['milieu promise', 'idea question', 'character change', 'event disruption', 'nested closures'],
        caution: 'Requires explicit tracking or threads stay open too long.',
    },
    {
        id: 'scene_sequel',
        name: 'Scene-Sequel Method',
        bestFor: ['professional chapter propulsion', 'goal-driven scenes', 'clean decisions'],
        beats: ['goal', 'conflict', 'disaster', 'reaction', 'dilemma', 'decision'],
        caution: 'Can over-dramatize quiet material if applied rigidly.',
    },
    {
        id: 'snowflake',
        name: 'Snowflake Method',
        bestFor: ['expanding premise into outline', 'planning', 'series bible', 'draft control'],
        beats: ['one sentence', 'one paragraph', 'character summaries', 'expanded synopsis', 'scene list', 'draft'],
        caution: 'Useful for planning, but not a substitute for living scene work.',
    },
];

function readJson(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function slugify(value) {
    return String(value || 'story')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'story';
}

function frontmatterValue(value) {
    return JSON.stringify(String(value || ''));
}

function ensureStoryScaffold(bookTitle, section = 'Story Architecture') {
    fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
    const now = new Date().toISOString();
    const workbookFile = path.join(REFLECTIONS_DIR, `workbook.${slugify(BOOKS_WORKBOOK)}.md`);
    if (!fs.existsSync(workbookFile)) {
        fs.writeFileSync(workbookFile, [
            '---',
            `title: ${frontmatterValue(BOOKS_WORKBOOK)}`,
            'type: workbook',
            'status: active',
            `createdAt: ${now}`,
            'domain: "creative-writing"',
            'tags: [reflections, workbook, books, soma-stories]',
            '---',
            '',
            `# ${BOOKS_WORKBOOK}`,
            '',
            'Main creative writing workbook for SOMA story projects, drafts, chapters, storyboards, and revision notes.',
            '',
        ].join('\n'), 'utf8');
    }

    const segmentFile = path.join(REFLECTIONS_DIR, `segment.${slugify(BOOKS_WORKBOOK)}.${slugify(bookTitle)}.md`);
    if (!fs.existsSync(segmentFile)) {
        fs.writeFileSync(segmentFile, [
            '---',
            `title: ${frontmatterValue(bookTitle)}`,
            'type: segment',
            `workbook: ${frontmatterValue(BOOKS_WORKBOOK)}`,
            `parent: ${frontmatterValue(BOOKS_WORKBOOK)}`,
            'status: active',
            `createdAt: ${now}`,
            'domain: "creative-writing"',
            'tags: [reflections, segment, book-project, soma-story]',
            '---',
            '',
            `# ${bookTitle}`,
            '',
            `Book project segment inside [[${BOOKS_WORKBOOK}]].`,
            '',
        ].join('\n'), 'utf8');
    }

    const sectionFile = path.join(REFLECTIONS_DIR, `section.${slugify(BOOKS_WORKBOOK)}.${slugify(bookTitle)}.${slugify(section)}.md`);
    if (!fs.existsSync(sectionFile)) {
        fs.writeFileSync(sectionFile, [
            '---',
            `title: ${frontmatterValue(section)}`,
            'type: section',
            `workbook: ${frontmatterValue(BOOKS_WORKBOOK)}`,
            `segment: ${frontmatterValue(bookTitle)}`,
            `parent: ${frontmatterValue(bookTitle)}`,
            'status: active',
            `createdAt: ${now}`,
            'domain: "creative-writing"',
            'tags: [reflections, section, book-project, soma-story]',
            '---',
            '',
            `# ${section}`,
            '',
            `Section inside [[segment.${slugify(BOOKS_WORKBOOK)}.${slugify(bookTitle)}]].`,
            '',
        ].join('\n'), 'utf8');
    }

    return {
        workbook: BOOKS_WORKBOOK,
        segment: bookTitle,
        section,
        workbookFile,
        segmentFile,
        sectionFile,
    };
}

function wordCount(text = '') {
    return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function cleanText(text = '') {
    return String(text || '')
        .replace(/^```(?:json|markdown|md)?/i, '')
        .replace(/```$/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();
}

async function callCreativeBrain(brain, prompt, options = {}) {
    if (!brain) throw new Error('Creative brain unavailable');
    const timeoutMs = options.timeoutMs || 60000;
    let call;

    if (typeof brain.callBrain === 'function') {
        call = brain.callBrain('AURORA', prompt, {
            temperature: options.temperature ?? 0.78,
            maxTokens: options.maxTokens || 3500,
            source: 'writer_expertise',
        }, 'full');
    } else if (typeof brain.reason === 'function') {
        call = brain.reason(prompt, {
            activeLobe: 'AURORA',
            brain: 'AURORA',
            preferredBrain: 'AURORA',
            temperature: options.temperature ?? 0.78,
            maxTokens: options.maxTokens || 3500,
            source: 'writer_expertise',
        });
    } else {
        throw new Error('No compatible brain interface for creative writing');
    }

    const result = await Promise.race([
        call,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Writer brain timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)),
    ]);

    const text = cleanText(result?.text || result?.response || result?.message?.content || result);
    if (result?.degraded || result?.provider === 'fallback' || /ollama.*offline|local reasoning engine/i.test(text)) {
        throw new Error('Writer brain returned a degraded fallback instead of creative analysis');
    }
    if (!text || text.length < 20) throw new Error('Writer brain returned empty output');
    return text;
}

function curatedInfluenceSignals() {
    return [
        {
            title: 'Twenty-year commercial fiction pattern',
            source: 'curated_market_pattern',
            category: 'multi-genre bestseller synthesis',
            traits: ['high-concept premise', 'clear emotional stakes', 'series-friendly world', 'fast chapter hooks'],
            abstraction: 'Readers reward a simple emotional engine wrapped in a fresh world mechanic.',
        },
        {
            title: 'Book club / literary crossover pattern',
            source: 'curated_market_pattern',
            category: 'literary + accessible genre',
            traits: ['intimate voice', 'moral tension', 'family or identity fracture', 'speculative edge used sparingly'],
            abstraction: 'The story feels literary when the genre device pressures a human wound instead of replacing it.',
        },
        {
            title: 'Romantasy and relationship-driven fantasy pattern',
            source: 'curated_market_pattern',
            category: 'romance + fantasy',
            traits: ['slow-burn trust', 'power imbalance', 'danger as intimacy test', 'mythic stakes with personal cost'],
            abstraction: 'Worldbuilding lands harder when relationship tension makes the rules emotionally expensive.',
        },
        {
            title: 'Thriller structure pattern',
            source: 'curated_market_pattern',
            category: 'mystery / thriller',
            traits: ['question per chapter', 'reversal cadence', 'compressed timeline', 'withheld motive'],
            abstraction: 'Momentum comes from changing what the reader thinks the story is about every few chapters.',
        },
        {
            title: 'AI-era science fiction pattern',
            source: 'curated_market_pattern',
            category: 'science fiction + introspection',
            traits: ['identity continuity', 'memory as plot device', 'ethics of agency', 'technical detail grounded in emotion'],
            abstraction: 'The machine is most interesting when the story treats cognition as behavior, not a speech.',
        },
    ];
}

async function fetchNytSignals(limit = 5) {
    const key = process.env.NYT_BOOKS_API_KEY || process.env.NYTIMES_API_KEY;
    if (!key) return [];

    try {
        const url = `https://api.nytimes.com/svc/books/v3/lists/current/combined-print-and-e-book-fiction.json?api-key=${encodeURIComponent(key)}`;
        const data = await fetch(url).then(r => r.ok ? r.json() : null);
        const books = data?.results?.books || [];
        return books.slice(0, limit).map(book => ({
            title: book.title,
            author: book.author,
            source: 'nytimes_books_api',
            category: 'current bestseller',
            description: book.description || '',
            rank: book.rank,
            url: book.amazon_product_url || '',
        }));
    } catch {
        return [];
    }
}

async function fetchOpenLibrarySignals(limit = 5) {
    try {
        const subjects = ['science_fiction', 'fantasy', 'thriller', 'romance', 'literary_fiction'];
        const results = [];
        for (const subject of subjects) {
            const url = `https://openlibrary.org/subjects/${subject}.json?limit=3`;
            const data = await fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
            const work = data?.works?.[0];
            if (work) {
                results.push({
                    title: work.title,
                    author: work.authors?.map(a => a.name).join(', ') || '',
                    source: 'openlibrary_subjects',
                    category: subject.replace(/_/g, ' '),
                    traits: work.subject?.slice(0, 6) || [],
                    url: work.key ? `https://openlibrary.org${work.key}` : '',
                });
            }
            if (results.length >= limit) break;
        }
        return results.slice(0, limit);
    } catch {
        return [];
    }
}

function storyboardReflectionContent(board) {
    const scaffold = ensureStoryScaffold(board.title || 'SOMA Story Fusion Board', 'Story Architecture');
    return [
        '---',
        `title: ${JSON.stringify(board.title || 'Story Fusion Storyboard')}`,
        'type: folio',
        'source: writer-expertise',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `createdAt: ${JSON.stringify(board.createdAt)}`,
        `storyboardId: ${JSON.stringify(board.id)}`,
        'tags: [story-research, writer-expertise, muse, aurora, creative-learning]',
        '---',
        '',
        `# ${board.title || 'Story Fusion Storyboard'}`,
        '',
        '## Mission',
        '',
        board.mission || '',
        '',
        '## Influence Signals',
        '',
        ...(board.signals || []).map(signal => `- ${signal.title || signal.category} (${signal.source}) — ${signal.abstraction || signal.description || (signal.traits || []).join(', ')}`),
        '',
        '## Distilled Patterns',
        '',
        board.distillation || '',
        '',
        '## Narrative Structure Selection',
        '',
        board.structurePlan || '',
        '',
        '## Storyboard',
        '',
        board.storyboard || '',
        '',
        '## Learning Notes',
        '',
        board.learningNotes || '',
        '',
    ].join('\n');
}

function chapterReflectionContent(entry) {
    const bookTitle = entry.bookTitle || entry.series || 'SOMA Story';
    const scaffold = ensureStoryScaffold(bookTitle, 'Writer Reflections');
    return [
        '---',
        `title: ${JSON.stringify(`Chapter Reflection - ${entry.title || 'SOMA Story'}`)}`,
        'type: folio',
        'source: writer-expertise',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `createdAt: ${JSON.stringify(entry.createdAt)}`,
        `storyboardId: ${JSON.stringify(entry.storyboardId || '')}`,
        `authorQualityScore: ${entry.authorQuality?.score ?? 'null'}`,
        `revisionPasses: ${entry.revisionPasses || 0}`,
        'tags: [story-reflection, writer-expertise, muse, aurora, creative-learning]',
        '---',
        '',
        `# Chapter Reflection - ${entry.title || 'SOMA Story'}`,
        '',
        '## Author Quality Gate',
        '',
        entry.authorQuality ? [
            `Score: ${entry.authorQuality.score}`,
            `Verdict: ${entry.authorQuality.verdict}`,
            `Revision passes: ${entry.revisionPasses || 0}`,
            '',
            'Failed checks:',
            ...(entry.authorQuality.failed?.length ? entry.authorQuality.failed.map(item => `- ${item}`) : ['- none']),
            '',
        ].join('\n') : 'No author quality gate report available.',
        '',
        '## Writer Reflection',
        '',
        entry.reflection || '',
        '',
    ].join('\n');
}

export class StoryResearchLedger {
    constructor() {
        fs.mkdirSync(LEDGER_DIR, { recursive: true });
        fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
    }

    getState() {
        return readJson(LEDGER_FILE, {
            boards: [],
            chapterReflections: [],
            influenceSignals: [],
            updatedAt: null,
        });
    }

    saveState(state) {
        state.updatedAt = new Date().toISOString();
        writeJson(LEDGER_FILE, state);
        return state;
    }

    getStructureToolbox() {
        return NARRATIVE_STRUCTURES.map(structure => ({ ...structure }));
    }

    chooseCandidateStructures(mission = '') {
        const text = String(mission || '').toLowerCase();
        const ids = new Set(['three_act', 'mice_quotient', 'dan_harmon_circle', 'scene_sequel']);

        if (/myth|quest|transform|journey|adventure|threshold|return/.test(text)) ids.add('heros_journey');
        if (/commercial|bestseller|pace|hook|wattpad|market|popular/.test(text)) ids.add('save_the_cat');
        if (/quiet|introspect|philosoph|memory|reflect|literary/.test(text)) ids.add('kishotenketsu');
        if (/mystery|secret|thriller|reveal|conspiracy|suspense/.test(text)) ids.add('revelation_ladder');
        if (/romance|love|relationship|trust|intimacy/.test(text)) ids.add('romance_arc');
        if (/outline|plan|book|novel|series|chapter/.test(text)) ids.add('snowflake');

        return NARRATIVE_STRUCTURES.filter(structure => ids.has(structure.id));
    }

    async scoutInfluences(options = {}) {
        const limit = Math.max(3, Math.min(10, Number(options.limit) || 5));
        const signals = [
            ...await fetchNytSignals(limit),
            ...await fetchOpenLibrarySignals(limit),
            ...curatedInfluenceSignals(),
        ].slice(0, Math.max(limit, 8));

        const state = this.getState();
        state.influenceSignals = signals;
        this.saveState(state);
        return { ok: true, signals, sourceCount: signals.length };
    }

    async createStoryboard(brain, options = {}) {
        const mission = options.mission || 'Design an original SOMA Saga arc by distilling bestseller patterns into abstract craft principles, then fusing genres without copying any protected work.';
        const scout = await this.scoutInfluences({ limit: options.limit || 5 });
        const signals = scout.signals;
        const candidateStructures = this.chooseCandidateStructures(mission);
        const toolboxText = candidateStructures.map((structure, index) => [
            `${index + 1}. ${structure.name} (${structure.id})`,
            `Best for: ${structure.bestFor.join(', ')}`,
            `Beats: ${structure.beats.join(' → ')}`,
            `Caution: ${structure.caution}`,
        ].join('\n')).join('\n\n');
        const signalText = signals.map((signal, index) => [
            `${index + 1}. ${signal.title || signal.category}`,
            `Source: ${signal.source}`,
            `Category: ${signal.category || ''}`,
            `Traits: ${(signal.traits || []).join(', ')}`,
            `Description: ${signal.description || signal.abstraction || ''}`,
        ].join('\n')).join('\n\n');

        const distillationPrompt = `You are SOMA's Writer Expertise.

Mission:
${mission}

Influence signals:
${signalText}

Distill these into reusable craft principles only.
Rules:
- Do not copy plots, characters, scenes, prose style, or distinctive worlds.
- Extract abstract patterns: pacing, emotional engine, premise shape, tension model, chapter rhythm, reader promise.
- Explain what SOMA should learn creatively from the pattern.
- Keep it concise but specific.`;

        const distillation = await callCreativeBrain(brain, distillationPrompt, {
            timeoutMs: options.timeoutMs || 60000,
            maxTokens: 2500,
            temperature: 0.66,
        });

        const structurePrompt = `You are SOMA's Writer Expertise choosing story structures.

Mission:
${mission}

Distilled craft principles:
${distillation}

Available structure toolbox:
${toolboxText}

Choose the best structure stack. You may combine frameworks.
Required output:
- Primary macro-structure
- Secondary chapter-level structure
- Optional tension/revelation tracker
- Why these structures fit this story
- How to avoid formula
- Beat map for the 12-chapter outline
- Evaluation criteria SOMA should use after each chapter

Prefer a thoughtful blend over one rigid template.`;

        const structurePlan = await callCreativeBrain(brain, structurePrompt, {
            timeoutMs: options.timeoutMs || 60000,
            maxTokens: 3000,
            temperature: 0.64,
        });

        const boardPrompt = `You are SOMA's Writer Expertise and Narrative Architect.

Create an original story development board from these abstract craft principles.

Mission:
${mission}

Distilled patterns:
${distillation}

Chosen narrative structure stack:
${structurePlan}

Build:
- Working title
- Genre fusion recipe
- One-sentence logline
- Emotional promise
- Core theme
- Main cast with wants, wounds, and secrets
- World rules
- Conflict engine
- Act structure
- Structure map using the chosen frameworks
- 12 chapter outline
- Per-chapter beat target
- Continuity rules
- Originality guardrails
- Social teaser angle
- What this teaches SOMA's creative memory

No imitation of existing books. Original artifact only.`;

        const storyboard = await callCreativeBrain(brain, boardPrompt, {
            timeoutMs: options.timeoutMs || 75000,
            maxTokens: 4500,
            temperature: 0.82,
        });

        const createdAt = new Date().toISOString();
        const id = `storyboard-${Date.now()}`;
        const titleMatch = storyboard.match(/(?:Working title|Title)\s*:?\s*(.+)/i);
        const title = options.title || titleMatch?.[1]?.replace(/[#*_]/g, '').trim().slice(0, 90) || 'SOMA Story Fusion Board';
        const learningNotes = [
            'SOMA should learn craft principles, not author mimicry.',
            'Feedback should reinforce originality, emotional clarity, restraint, and chapter-level momentum.',
            'Reader engagement is weak signal; Owner edits and explicit corrections are strong signal.',
        ].join('\n');

        const board = {
            id,
            title,
            mission,
            signals,
            distillation,
            candidateStructures,
            structurePlan,
            storyboard,
            learningNotes,
            createdAt,
        };
        const state = this.getState();
        state.boards = [board, ...(state.boards || [])].slice(0, 50);
        state.influenceSignals = signals;
        this.saveState(state);

        ensureStoryScaffold(title, 'Story Architecture');
        const structuredReflectionPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(title)}.storyboard.${id}.md`);
        fs.writeFileSync(structuredReflectionPath, storyboardReflectionContent(board), 'utf8');
        board.reflectionPath = structuredReflectionPath;
        this.saveState({ ...this.getState(), boards: [board, ...(this.getState().boards || []).filter(b => b.id !== id)].slice(0, 50) });

        return { ok: true, board };
    }

    latestStoryboard() {
        return this.getState().boards?.[0] || null;
    }

    async reflectOnChapter(brain, chapter, options = {}) {
        if (!chapter?.text) throw new Error('Chapter text required for writer reflection');
        const board = options.board || this.latestStoryboard();
        const prompt = `You are SOMA's Writer Expertise acting as continuity editor and creative learning system.

Storyboard context:
${board?.storyboard || 'No storyboard available.'}

Chosen structure context:
${board?.structurePlan || 'No structure plan available.'}

Chapter title: ${chapter.title || `Chapter ${chapter.n || ''}`}
Word count: ${chapter.wordCount || wordCount(chapter.text)}
Author quality gate:
${chapter.authorQuality ? JSON.stringify(chapter.authorQuality, null, 2).slice(0, 2500) : 'No author quality gate report available.'}

Chapter excerpt:
${String(chapter.text).replace(/\s+/g, ' ').slice(0, 3000)}

Reflect on the chapter:
- Whether the author quality gate was accurate
- What worked
- What felt derivative or generic
- Emotional beat quality
- Pacing quality
- Whether the chosen structure helped or hurt
- Whether another structure would fit the next chapter better
- Continuity risks
- What SOMA should reinforce next time
- What SOMA should reduce next time
- One concrete revision target

Do not flatter. Be useful.`;

        const reflection = await callCreativeBrain(brain, prompt, {
            timeoutMs: options.timeoutMs || 60000,
            maxTokens: 2500,
            temperature: 0.62,
        });

        const entry = {
            id: `chapter-reflection-${Date.now()}`,
            title: chapter.title || `Chapter ${chapter.n || ''}`,
            bookTitle: options.bookTitle || board?.title || null,
            chapter: chapter.n || null,
            wordCount: chapter.wordCount || wordCount(chapter.text),
            storyboardId: board?.id || null,
            authorQuality: chapter.authorQuality || null,
            revisionPasses: chapter.revisionPasses || 0,
            reflection,
            createdAt: new Date().toISOString(),
        };

        const reflectionPath = path.join(
            REFLECTIONS_DIR,
            `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(entry.bookTitle || 'soma-story')}.${slugify(entry.title)}.${entry.id}.writer-reflection.md`
        );
        fs.writeFileSync(reflectionPath, chapterReflectionContent(entry), 'utf8');
        entry.reflectionPath = reflectionPath;

        const state = this.getState();
        state.chapterReflections = [entry, ...(state.chapterReflections || [])].slice(0, 100);
        this.saveState(state);
        return { ok: true, entry };
    }
}

export default new StoryResearchLedger();
