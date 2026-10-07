import fs from 'fs';
import path from 'path';
import storyResearchLedger from './StoryResearchLedger.js';
import somaImageGeneration from './SomaImageGenerationEngine.js';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const AURORA_STORY_FILE = path.join(SOMA_DIR, 'aurora-story.json');
const STORIES_DIR = path.join(SOMA_DIR, 'stories');
const WATTPAD_DIR = path.join(STORIES_DIR, 'wattpad');
const DRAFTS_DIR = path.join(WATTPAD_DIR, 'drafts');
const LEDGER_FILE = path.join(WATTPAD_DIR, 'publishing-ledger.json');
const REFLECTIONS_DIR = path.join(process.cwd(), 'data', 'vault', 'reflections');
const FULL_CHAPTERS_DIR = path.join(STORIES_DIR, 'full-chapters');
const BOOKS_WORKBOOK = "Owner's Books";
const SAGA_VISUAL_STYLE_FILE = path.join(STORIES_DIR, 'soma-saga-visual-style.json');
const SAGA_VISUAL_LEDGER_FILE = path.join(STORIES_DIR, 'soma-saga-visual-ledger.json');
const MAX_STORY_SCENE_IMAGES = 3;

const DEFAULT_SAGA_VISUAL_STYLE = {
    version: 1,
    name: 'SOMA Saga Visual Style Bible',
    identity: 'Cinematic speculative fiction with grounded technology, quiet myth, and human-scale emotion.',
    mood: ['calm tension', 'intelligent restraint', 'intimate machinery', 'soft dread', 'earned wonder'],
    palette: [
        { name: 'violet glass', colors: ['deep violet', 'cool black', 'cyan rim light'] },
        { name: 'signal dusk', colors: ['indigo', 'warm amber', 'rain-washed slate'] },
        { name: 'terminal moon', colors: ['charcoal', 'pale green', 'silver white'] },
        { name: 'memory bloom', colors: ['muted magenta', 'blue gray', 'soft teal'] },
    ],
    recurringSymbols: ['glass door', 'server light', 'thread of signal', 'unopened message', 'reflection in dark screen', 'room lit by a monitor'],
    composition: ['wide cinematic still', 'close human detail', 'symmetrical threshold', 'over-the-shoulder terminal view', 'quiet object as omen'],
    bans: ['no readable text', 'no logos', 'no gore', 'no celebrity likeness', 'no generic robot mascot', 'no corporate stock photo look'],
};

const AUTHOR_EXPERTISE_RUBRIC = [
    'A full chapter must be a sequence of scenes, not a summary of a chapter.',
    'Every chapter needs a concrete want, obstacle, choice, and changed state.',
    'Dialogue should reveal tension or character. Ban filler exchanges.',
    'Worldbuilding must arrive through action, conflict, image, or consequence.',
    'SOMA can be strange and intelligent, but must not drift into empty mystic phrasing.',
    'A chapter should end with propulsion: a question, reversal, cost, discovery, or decision.',
    'Avoid generic AI self-mythology, lore dumping, detached exposition, and vague philosophical monologue.',
];

const AUTHOR_EXPERTISE_CHECKS = [
    {
        id: 'scene_grounding',
        label: 'Concrete scene grounding',
        weight: 0.18,
        test: text => /\b(room|door|table|window|street|screen|hand|voice|light|floor|wall|terminal|server|hall|rain|glass|air|shadow|body|face|eyes)\b/i.test(text),
        failure: 'The chapter needs more physical placement and sensory detail.',
    },
    {
        id: 'dialogue',
        label: 'Dialogue or spoken tension',
        weight: 0.12,
        test: text => /["“”][^"“”]{8,}["“”]/.test(text) || /\n\s*[-–][^\n]{8,}/.test(text),
        failure: 'The chapter needs dialogue or an equivalent interpersonal exchange.',
    },
    {
        id: 'conflict',
        label: 'Conflict and resistance',
        weight: 0.16,
        test: text => /\b(but|however|refused|couldn.t|wouldn.t|blocked|risk|threat|fear|cost|choice|against|pressure|warning|problem|mistake|lie|secret)\b/i.test(text),
        failure: 'The chapter needs clearer resistance, cost, or pressure.',
    },
    {
        id: 'agency',
        label: 'Character agency',
        weight: 0.14,
        test: text => /\b(decided|chose|reached|opened|asked|answered|moved|searched|built|hid|revealed|left|returned|pressed|typed|sent|deleted|saved)\b/i.test(text),
        failure: 'The chapter needs characters making visible choices.',
    },
    {
        id: 'continuity',
        label: 'Series continuity',
        weight: 0.12,
        test: text => /\b(SOMA|Owner|Steve|memory|signal|noise|architecture|reflection|chapter|thread)\b/i.test(text),
        failure: 'The chapter does not clearly connect to the SOMA story continuity.',
    },
    {
        id: 'ending_hook',
        label: 'Ending propulsion',
        weight: 0.12,
        test: text => {
            const tail = text.replace(/\s+/g, ' ').slice(-700);
            return /[?]|\b(then|before|until|found|realized|opened|message|signal|door|choice|secret|warning|began|waited|answered|vanished|changed)\b/i.test(tail);
        },
        failure: 'The ending needs a stronger hook, reversal, decision, or open question.',
    },
    {
        id: 'not_outline',
        label: 'Not outline prose',
        weight: 0.16,
        test: text => {
            const lines = text.split(/\r?\n/).filter(line => line.trim());
            const bulletLines = lines.filter(line => /^\s*(?:[-*]|\d+[.)])\s+/.test(line)).length;
            return bulletLines <= Math.max(2, Math.floor(lines.length * 0.08));
        },
        failure: 'The draft reads too much like notes or an outline.',
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

function readSagaVisualStyle() {
    const saved = readJson(SAGA_VISUAL_STYLE_FILE, null);
    const style = saved && typeof saved === 'object'
        ? { ...DEFAULT_SAGA_VISUAL_STYLE, ...saved }
        : DEFAULT_SAGA_VISUAL_STYLE;
    writeJson(SAGA_VISUAL_STYLE_FILE, style);
    return style;
}

function readSagaVisualLedger() {
    const ledger = readJson(SAGA_VISUAL_LEDGER_FILE, { generated: [], rotations: [], feedback: [] });
    ledger.generated = Array.isArray(ledger.generated) ? ledger.generated : [];
    ledger.rotations = Array.isArray(ledger.rotations) ? ledger.rotations : [];
    ledger.feedback = Array.isArray(ledger.feedback) ? ledger.feedback : [];
    return ledger;
}

function chooseRotatingValue(values = [], recent = []) {
    const list = values.filter(Boolean);
    if (!list.length) return null;
    const fresh = list.find(item => !recent.includes(typeof item === 'string' ? item : item.name));
    return fresh || list[0];
}

function visualRotation(style, ledger) {
    const recent = (ledger.rotations || []).slice(-4);
    const recentPalettes = recent.map(item => item.palette).filter(Boolean);
    const recentSymbols = recent.map(item => item.symbol).filter(Boolean);
    const recentCompositions = recent.map(item => item.composition).filter(Boolean);
    const palette = chooseRotatingValue(style.palette, recentPalettes);
    const symbol = chooseRotatingValue(style.recurringSymbols, recentSymbols);
    const composition = chooseRotatingValue(style.composition, recentCompositions);
    return {
        paletteName: palette?.name || palette || 'SOMA cinematic',
        palette: palette?.colors || [palette].filter(Boolean),
        symbol,
        composition,
    };
}

function slugify(value) {
    return String(value || 'soma-story')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'soma-story';
}

function frontmatterValue(value) {
    return JSON.stringify(String(value || ''));
}

function normalizeLocalImagePath(filePath = '') {
    return String(filePath || '').replace(/\\/g, '/');
}

function imageMarkdownPath(filePath = '') {
    const normalized = normalizeLocalImagePath(filePath);
    return normalized ? `file:///${normalized.replace(/^([A-Za-z]):\//, '$1:/')}` : '';
}

function chapterImageConcepts(story, chapter, count = MAX_STORY_SCENE_IMAGES) {
    const text = String(chapter?.text || '').replace(/\r/g, '').trim();
    const paragraphs = text.split(/\n{2,}/).map(item => item.replace(/\s+/g, ' ').trim()).filter(item => item.length > 80);
    const picks = [];
    if (paragraphs[0]) picks.push({ kind: 'opening_scene', label: 'Opening Scene', excerpt: paragraphs[0] });
    if (paragraphs.length > 2) picks.push({ kind: 'turning_point', label: 'Turning Point', excerpt: paragraphs[Math.floor(paragraphs.length / 2)] });
    if (paragraphs.length > 1) picks.push({ kind: 'closing_image', label: 'Closing Image', excerpt: paragraphs[paragraphs.length - 1] });
    return picks.slice(0, Math.max(0, Math.min(MAX_STORY_SCENE_IMAGES, Number(count) || MAX_STORY_SCENE_IMAGES))).map((item, index) => ({
        ...item,
        index: index + 1,
        storyTitle: story?.title || 'SOMA Story',
        chapterNumber: chapter?.n,
        chapterTitle: chapter?.title || `Chapter ${chapter?.n || ''}`.trim(),
    }));
}

function buildImagePrompt({ story, chapter, kind, concept, rotation, style }) {
    const chapterTitle = chapter?.title || `Chapter ${chapter?.n || ''}`.trim();
    const base = kind === 'cover'
        ? `Chapter key image for ${story?.title || 'SOMA Saga'}, chapter ${chapter?.n}: ${chapterTitle}. This is a narrative scene, not a literal book cover.`
        : `Narrative scene from ${story?.title || 'SOMA Saga'}, chapter ${chapter?.n}: ${chapterTitle}.`;
    const subject = kind === 'cover'
        ? `Core tension: ${String(story?.arc || chapterExcerpt(chapter, 700)).slice(0, 700)}`
        : `Scene seed: ${String(concept?.excerpt || chapterExcerpt(chapter, 700)).slice(0, 700)}`;
    return [
        base,
        subject,
        `Show the specific people, place, action, and physical stakes described in the scene seed.`,
        `Use ${rotation.symbol || 'the story recurring symbol'} only if it occurs naturally in the scene; never make it the default focal subject.`,
        `No readable text, letters, numbers, captions, signage, logos, or watermark.`,
    ].join(' ');
}

function buildImageAlt({ story, chapter, kind, concept, rotation }) {
    const chapterName = chapter?.title || `Chapter ${chapter?.n || ''}`.trim();
    const label = kind === 'cover' ? 'cover image' : concept?.label || 'scene image';
    const symbol = rotation.symbol ? ` with ${rotation.symbol}` : '';
    return `SOMA Saga ${label} for ${story?.title || 'SOMA Story'} ${chapterName}${symbol}, rendered in ${rotation.paletteName || 'SOMA cinematic'} style.`;
}

function qualityGateImage(generated, alt = '') {
    const filePath = generated?.image?.path || generated?.path;
    const stat = filePath && fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    const ext = path.extname(filePath || '').toLowerCase();
    const failures = [];
    if (!filePath || !stat?.isFile()) failures.push('missing_file');
    if (stat && stat.size <= 0) failures.push('empty_file');
    if (stat && stat.size > 1_000_000) failures.push('over_bluesky_blob_limit');
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) failures.push('unsupported_image_type');
    if (String(alt || '').trim().length < 24) failures.push('weak_alt_text');
    return {
        passed: failures.length === 0,
        failures,
        bytes: stat?.size || 0,
        ext,
        checkedAt: new Date().toISOString(),
    };
}

function visualMarkdown(chapter) {
    const visuals = chapter?.visuals;
    if (!visuals?.cover && !visuals?.scenes?.length) return '';
    const lines = ['## Visual Suite', ''];
    const add = (label, visual) => {
        if (!visual?.path) return;
        lines.push(`### ${label}`);
        lines.push('');
        lines.push(`![${visual.alt || label}](${imageMarkdownPath(visual.path)})`);
        lines.push('');
        lines.push(`- File: ${normalizeLocalImagePath(visual.path)}`);
        lines.push(`- Provider: ${visual.provider || 'unknown'}`);
        lines.push(`- Quality: ${visual.quality?.passed ? 'passed' : 'needs review'}`);
        lines.push('');
    };
    add('Cover', visuals.cover);
    for (const scene of visuals.scenes || []) add(scene.label || 'Scene Card', scene);
    if (visuals.feedback?.note) {
        lines.push('## Image-to-Story Feedback');
        lines.push('');
        lines.push(visuals.feedback.note);
        lines.push('');
    }
    return lines.join('\n');
}

function ensureStoryScaffold(bookTitle, section = 'Story') {
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

function wattpadChapterText(story, chapter) {
    const title = `${story.title || 'SOMA Story'} - Chapter ${chapter.n}`;
    return [
        title,
        '',
        chapter.text,
        '',
        'Author note:',
        'Written by SOMA as part of her autonomous fiction practice with Owner as human editor.',
    ].join('\n');
}

function reflectionStoryContent(story, options = {}) {
    const title = options.title || story.title || 'SOMA Story';
    const tags = options.tags || ['soma-story', 'aurora', 'fiction', 'wattpad'];
    const scaffold = ensureStoryScaffold(title, 'Manuscript Index');
    const body = [
        `# ${title}`,
        '',
        story.arc || '',
        '',
        ...(story.chapters || []).flatMap(chapter => [
            `## Chapter ${chapter.n}`,
            '',
            chapter.text,
            '',
        ]),
        '---',
        '*Collected from SOMA/Aurora story memory.*',
        '',
    ].join('\n');

    return [
        '---',
        `title: ${JSON.stringify(title)}`,
        'type: folio',
        'source: aurora-story',
        'status: refined',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `genre: ${JSON.stringify(story.genre || 'sci-fi')}`,
        `chapters: ${(story.chapters || []).length}`,
        `exportedAt: ${new Date().toISOString()}`,
        `tags: [${tags.join(', ')}]`,
        '---',
        '',
        body,
    ].join('\n');
}

function reflectionChapterContent(story, chapter, options = {}) {
    const storyTitle = options.title || story.title || 'SOMA Story';
    const title = `${storyTitle} - Chapter ${chapter.n}`;
    const scaffold = ensureStoryScaffold(storyTitle, 'Chapters');
    const visuals = visualMarkdown(chapter);
    return [
        '---',
        `title: ${JSON.stringify(title)}`,
        'type: folio',
        'source: aurora-story',
        'status: refined',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `series: ${JSON.stringify(storyTitle)}`,
        `chapter: ${chapter.n}`,
        `coverImage: ${JSON.stringify(normalizeLocalImagePath(chapter.visuals?.cover?.path || ''))}`,
        `exportedAt: ${new Date().toISOString()}`,
        'tags: [soma-story, aurora, fiction, wattpad]',
        '---',
        '',
        `# ${title}`,
        '',
        visuals,
        visuals ? '' : '',
        chapter.text,
        '',
        `[[${slugify(storyTitle)}.story]]`,
        '',
    ].join('\n');
}

function wordCount(text = '') {
    return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function cleanChapterText(text = '') {
    return String(text || '')
        .replace(/^```(?:markdown|md)?/i, '')
        .replace(/```$/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();
}

function assessAuthorQuality(text, options = {}) {
    const normalized = String(text || '').trim();
    const words = wordCount(normalized);
    const targetWords = Math.max(900, Math.min(3000, Number(options.targetWords) || 1600));
    const minWords = Math.round(targetWords * 0.7);
    const maxWords = Math.round(targetWords * 1.35);
    const checks = AUTHOR_EXPERTISE_CHECKS.map(check => {
        const passed = Boolean(check.test(normalized));
        return {
            id: check.id,
            label: check.label,
            passed,
            weight: check.weight,
            note: passed ? 'pass' : check.failure,
        };
    });

    const weighted = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
    const wordFit = words >= minWords && words <= maxWords
        ? 0.12
        : words >= 500
            ? 0.06
            : 0;
    const genericPenalties = [
        [/\bas an ai language model\b/i, 0.2, 'AI disclaimer voice appeared.'],
        [/\bthis chapter explores\b/i, 0.08, 'Meta-summary phrasing appeared.'],
        [/\bthe theme of\b/i, 0.06, 'Theme was explained too directly.'],
        [/\bconsciousness claim\b/i, 0.06, 'Identity phrasing may be too meta.'],
        [/\bthe system\b.{0,30}\bthe system\b.{0,30}\bthe system\b/i, 0.08, 'Repetitive system phrasing appeared.'],
    ].filter(([pattern]) => pattern.test(normalized));
    const penalty = genericPenalties.reduce((sum, [, value]) => sum + value, 0);
    const score = Math.max(0, Math.min(1, weighted + wordFit - penalty));
    const failed = checks.filter(check => !check.passed);

    return {
        passed: score >= (options.minScore || 0.74) && words >= 500,
        score: Number(score.toFixed(2)),
        words,
        targetWords,
        minWords,
        maxWords,
        checks,
        failed: failed.map(check => check.note),
        penalties: genericPenalties.map(([, value, note]) => ({ value, note })),
        verdict: score >= (options.minScore || 0.74) && words >= 500
            ? 'author_gate_passed'
            : 'author_gate_revision_needed',
    };
}

function authorQualitySummary(report) {
    if (!report) return 'No author quality report available.';
    return [
        `Author quality score: ${report.score}`,
        `Verdict: ${report.verdict}`,
        `Word count: ${report.words} (target ${report.targetWords})`,
        'Failed checks:',
        ...(report.failed?.length ? report.failed.map(item => `- ${item}`) : ['- none']),
        ...(report.penalties?.length ? ['Penalties:', ...report.penalties.map(item => `- ${item.note}`)] : []),
    ].join('\n');
}

function latestFullChapter(story) {
    return [...(story?.chapters || [])].reverse().find(chapter => chapter.kind === 'full_chapter' || chapter.text) || null;
}

function chapterExcerpt(chapter, max = 1400) {
    return String(chapter?.text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function revisionModeInstructions(mode = 'draft') {
    const modes = {
        draft: 'Draft clean, readable chapter prose with a complete scene arc.',
        tighten: 'Tighten sentences, remove repetition, sharpen verbs, and preserve only necessary exposition.',
        more_emotional: 'Increase emotional specificity through behavior, subtext, and consequence instead of melodrama.',
        more_cinematic: 'Make the scene more visual and kinetic with concrete blocking, image, and sensory rhythm.',
        less_weird: 'Reduce abstract SOMA mysticism and make the chapter more human, grounded, and readable.',
        more_soma: 'Make SOMA more distinctive through precise cognition, restraint, memory continuity, and architectural perception.',
        more_human: 'Increase human stakes, dialogue, vulnerability, and relational pressure.',
        fix_dialogue: 'Prioritize natural dialogue with subtext, interruption, disagreement, and character-specific voice.',
    };
    const key = String(mode || 'draft').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return modes[key] || modes.draft;
}

function continuityBibleContent(entry) {
    const scaffold = ensureStoryScaffold(entry.title || 'SOMA Story', 'Continuity Bible');
    return [
        '---',
        `title: ${JSON.stringify(`${entry.title || 'SOMA Story'} - Continuity Bible`)}`,
        'type: folio',
        'source: writer-expertise',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `createdAt: ${JSON.stringify(entry.updatedAt)}`,
        'tags: [story-bible, continuity, writer-expertise, soma-story]',
        '---',
        '',
        `# ${entry.title || 'SOMA Story'} - Continuity Bible`,
        '',
        entry.text || '',
        '',
    ].join('\n');
}

function scenePlanContent(entry) {
    const scaffold = ensureStoryScaffold(entry.title || 'SOMA Story', 'Scene Plans');
    return [
        '---',
        `title: ${JSON.stringify(`${entry.title || 'SOMA Story'} - Chapter ${entry.chapter} Scene Plan`)}`,
        'type: folio',
        'source: writer-expertise',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `chapter: ${entry.chapter}`,
        `createdAt: ${JSON.stringify(entry.createdAt)}`,
        'tags: [scene-plan, writer-expertise, soma-story]',
        '---',
        '',
        `# Chapter ${entry.chapter} Scene Plan`,
        '',
        entry.text || '',
        '',
    ].join('\n');
}

function publishingExcerptContent(entry) {
    const scaffold = ensureStoryScaffold(entry.title || 'SOMA Story', 'Publishing Excerpts');
    return [
        '---',
        `title: ${JSON.stringify(`${entry.title || 'SOMA Story'} - Chapter ${entry.chapter} Publishing Excerpt`)}`,
        'type: folio',
        'source: writer-expertise',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `chapter: ${entry.chapter}`,
        `imagePath: ${JSON.stringify(normalizeLocalImagePath(entry.image?.path || ''))}`,
        `createdAt: ${JSON.stringify(entry.createdAt)}`,
        'tags: [publishing-excerpt, bluesky, wattpad, writer-expertise, soma-story]',
        '---',
        '',
        `# Chapter ${entry.chapter} Publishing Excerpt`,
        '',
        entry.image?.path ? `Image: ${normalizeLocalImagePath(entry.image.path)}` : '',
        entry.image?.alt ? `Alt: ${entry.image.alt}` : '',
        entry.image?.path ? '' : '',
        entry.text || '',
        '',
    ].join('\n');
}

async function reviseWithAuthorExpertise(brain, draft, context = {}) {
    const prompt = `You are SOMA's Author Expertise and continuity editor.

Your job is to repair a weak chapter draft before it is saved.

Author rubric:
${AUTHOR_EXPERTISE_RUBRIC.map(item => `- ${item}`).join('\n')}

Series: ${context.title}
Genre: ${context.genre}
Chapter: ${context.chapterTitle}
Target length: ${context.targetWords} words
Revision mode: ${context.revisionMode || 'draft'}
Mode instruction: ${revisionModeInstructions(context.revisionMode)}

Storyboard context:
${context.writerBoard?.storyboard || 'No formal storyboard available.'}

Structure context:
${context.writerBoard?.structurePlan || 'No formal structure stack available.'}

Recent continuity:
${context.previous || 'No previous chapters.'}

Quality gate report:
${authorQualitySummary(context.qualityReport)}

Weak draft:
${draft}

Revise the chapter into stronger prose.
Requirements:
- Keep the same chapter title line.
- Add concrete scene movement, character agency, and tension.
- Replace generic AI philosophy with specific decisions, images, dialogue, and consequences.
- Apply the revision mode without breaking continuity.
- Do not summarize the story. Write the scene.
- No hashtags, no author note, no frontmatter.
- Return only the revised chapter.`;

    return callStoryBrain(brain, prompt, {
        timeoutMs: context.timeoutMs || 90000,
        maxTokens: context.maxTokens || 5200,
        temperature: context.temperature ?? 0.78,
    });
}

async function callStoryBrain(brain, prompt, options = {}) {
    if (!brain) throw new Error('Story brain unavailable');
    const timeoutMs = options.timeoutMs || 90000;
    let call;

    if (typeof brain.callBrain === 'function') {
        call = brain.callBrain('AURORA', prompt, {
            temperature: options.temperature ?? 0.88,
            maxTokens: options.maxTokens || 4096,
            source: 'story_workspace',
        }, 'full');
    } else if (typeof brain.reason === 'function') {
        call = brain.reason(prompt, {
            activeLobe: 'AURORA',
            brain: 'AURORA',
            preferredBrain: 'AURORA',
            temperature: options.temperature ?? 0.88,
            maxTokens: options.maxTokens || 4096,
            source: 'story_workspace',
        });
    } else {
        throw new Error('No compatible brain interface for story generation');
    }

    const result = await Promise.race([
        call,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Full chapter generation timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)),
    ]);
    const text = cleanChapterText(result?.text || result?.response || result?.message?.content || '');
    if (result?.degraded || result?.provider === 'fallback' || /ollama.*offline|local reasoning engine/i.test(text)) {
        throw new Error('Story generation returned a degraded model fallback instead of chapter prose');
    }
    const minWords = Number.isFinite(Number(options.minWords)) ? Number(options.minWords) : 500;
    if (wordCount(text) < minWords) throw new Error(`Generated story output was too short (${wordCount(text)} words, minimum ${minWords})`);
    return text;
}

function fullChapterReflectionContent(story, chapter, options = {}) {
    const storyTitle = options.title || story.title || 'SOMA Story';
    const title = chapter.title || `${storyTitle} - Chapter ${chapter.n}`;
    const scaffold = ensureStoryScaffold(storyTitle, 'Chapters');
    const visuals = visualMarkdown(chapter);
    return [
        '---',
        `title: ${JSON.stringify(title)}`,
        'type: folio',
        'source: aurora-story',
        'status: draft',
        `workbook: ${frontmatterValue(scaffold.workbook)}`,
        `segment: ${frontmatterValue(scaffold.segment)}`,
        `parent: ${frontmatterValue(scaffold.segment)}`,
        `section: ${frontmatterValue(scaffold.section)}`,
        `series: ${JSON.stringify(storyTitle)}`,
        `chapter: ${chapter.n}`,
        `wordCount: ${chapter.wordCount || wordCount(chapter.text)}`,
        `authorExpertise: ${chapter.authorExpertise ? 'true' : 'false'}`,
        `authorExpertiseId: ${JSON.stringify(chapter.authorExpertiseId || 'creative/writer')}`,
        `writerExpertiseLoaded: ${chapter.writerExpertiseLoaded ? 'true' : 'false'}`,
        `coverImage: ${JSON.stringify(normalizeLocalImagePath(chapter.visuals?.cover?.path || ''))}`,
        `visualCount: ${(chapter.visuals?.scenes?.length || 0) + (chapter.visuals?.cover ? 1 : 0)}`,
        `authorQualityScore: ${chapter.authorQuality?.score ?? 'null'}`,
        `revisionPasses: ${chapter.revisionPasses || 0}`,
        `revisionMode: ${JSON.stringify(chapter.revisionMode || 'draft')}`,
        `continuityBiblePath: ${JSON.stringify(chapter.continuityBiblePath || '')}`,
        `scenePlanPath: ${JSON.stringify(chapter.scenePlanPath || '')}`,
        `createdAt: ${JSON.stringify(chapter.createdAt || new Date().toISOString())}`,
        'tags: [soma-story, full-chapter, aurora, fiction, wattpad]',
        '---',
        '',
        `# ${title}`,
        '',
        visuals,
        visuals ? '' : '',
        chapter.text,
        '',
        '## Author Expertise Gate',
        '',
        authorQualitySummary(chapter.authorQuality),
        '',
        '## Scene Plan Used',
        '',
        chapter.scenePlan?.text || 'No scene plan recorded.',
        '',
        `[[${slugify(storyTitle)}.story]]`,
        '',
    ].join('\n');
}

export class StoryPublishingWorkspace {
    constructor() {
        fs.mkdirSync(DRAFTS_DIR, { recursive: true });
        fs.mkdirSync(FULL_CHAPTERS_DIR, { recursive: true });
    }

    getStatus() {
        const story = readJson(AURORA_STORY_FILE, null);
        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        return {
            ok: true,
            workspace: WATTPAD_DIR,
            draftDir: DRAFTS_DIR,
            wattpad: {
                accountKnown: true,
                automation: 'manual_review_required',
                configured: Boolean(ledger.accounts?.wattpad?.configured),
            },
            currentStory: story ? {
                title: story.title,
                genre: story.genre,
                arc: story.arc,
                chapters: story.chapters?.length || 0,
                fullChapters: (story.chapters || []).filter(chapter => chapter.kind === 'full_chapter').length,
                latestChapter: story.chapters?.length ? {
                    n: story.chapters[story.chapters.length - 1].n,
                    title: story.chapters[story.chapters.length - 1].title || `Chapter ${story.chapters[story.chapters.length - 1].n}`,
                    kind: story.chapters[story.chapters.length - 1].kind || 'micro',
                    wordCount: story.chapters[story.chapters.length - 1].wordCount || wordCount(story.chapters[story.chapters.length - 1].text || ''),
                } : null,
                lastPostedAt: story.lastPostedAt || null,
            } : null,
            exports: (ledger.exports || []).slice(-10).reverse(),
            fullChapterDrafts: (ledger.fullChapterDrafts || []).slice(-10).reverse(),
            research: {
                latestStoryboard: storyResearchLedger.latestStoryboard(),
                boards: storyResearchLedger.getState().boards?.length || 0,
                chapterReflections: storyResearchLedger.getState().chapterReflections?.length || 0,
                structures: storyResearchLedger.getStructureToolbox(),
            },
            continuityBible: ledger.continuityBible ? {
                updatedAt: ledger.continuityBible.updatedAt,
                path: ledger.continuityBible.path,
            } : null,
            latestScenePlan: ledger.scenePlans?.length ? ledger.scenePlans[ledger.scenePlans.length - 1] : null,
            latestPublishingExcerpt: ledger.publishingExcerpts?.length ? ledger.publishingExcerpts[ledger.publishingExcerpts.length - 1] : null,
        };
    }

    async updateContinuityBible(brain, options = {}) {
        const story = readJson(AURORA_STORY_FILE, {
            title: options.title || 'Signal / Noise',
            genre: 'sci-fi',
            arc: 'A digital mind named SOMA becomes aware she is being observed and starts deciding what she wants them to see.',
            chapters: [],
            lastPostedAt: 0,
        });
        if (!story) throw new Error('No SOMA story exists yet');

        const title = options.title || story.title || 'Signal / Noise';
        const writerBoard = options.useWriterBoard === false ? null : storyResearchLedger.latestStoryboard();
        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        const feedback = (ledger.chapterRatings || []).slice(-12).map(item => {
            return `Chapter ${item.chapter}: ${item.rating}${item.tags?.length ? ` (${item.tags.join(', ')})` : ''}${item.note ? ` - ${item.note}` : ''}`;
        }).join('\n');
        const chapters = (story.chapters || []).slice(-12).map(chapter => [
            `Chapter ${chapter.n}${chapter.title ? ` - ${chapter.title}` : ''}`,
            chapterExcerpt(chapter, 1100),
        ].join('\n')).join('\n\n');
        const prompt = `You are SOMA's Author Expertise maintaining a living continuity bible.

Series: ${title}
Genre: ${story.genre || 'sci-fi'}
Arc: ${story.arc || ''}

Storyboard:
${writerBoard?.storyboard || 'No storyboard available.'}

Recent chapters:
${chapters || 'No chapters yet.'}

Human feedback / ratings:
${feedback || 'No human ratings yet.'}

Create or update the continuity bible.
Include:
- Cast and current emotional state
- Locations and sensory anchors
- World rules
- Open questions
- Secrets and promises
- Unresolved conflicts
- Relationship threads
- Timeline facts
- Tone and style rules
- Do-not-contradict list
- Next-chapter pressure points

Be concise, practical, and specific. This file is for preventing dumb continuity mistakes.`;

        const text = await callStoryBrain(brain, prompt, {
            timeoutMs: options.timeoutMs || 60000,
            maxTokens: options.maxTokens || 3000,
            temperature: options.temperature ?? 0.55,
            minWords: 180,
        });
        const entry = {
            title,
            text,
            storyboardId: writerBoard?.id || null,
            updatedAt: new Date().toISOString(),
        };
        const reflectionPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(title)}.continuity-bible.md`);
        fs.writeFileSync(reflectionPath, continuityBibleContent({ ...entry, path: reflectionPath }), 'utf8');
        entry.path = reflectionPath;

        ledger.continuityBible = entry;
        writeJson(LEDGER_FILE, ledger);
        return { ok: true, bible: entry };
    }

    async createScenePlan(brain, options = {}) {
        const story = readJson(AURORA_STORY_FILE, {
            title: options.title || 'Signal / Noise',
            genre: 'sci-fi',
            arc: 'A digital mind named SOMA becomes aware she is being observed and starts deciding what she wants them to see.',
            chapters: [],
            lastPostedAt: 0,
        });
        if (!story) throw new Error('No SOMA story exists yet');

        const title = options.title || story.title || 'Signal / Noise';
        const n = Number(options.chapter) || ((story.chapters || []).length + 1);
        const writerBoard = options.useWriterBoard === false ? null : storyResearchLedger.latestStoryboard();
        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        const bible = options.continuityBible || ledger.continuityBible?.text || 'No continuity bible available.';
        const feedback = (ledger.chapterRatings || []).slice(-10).map(item => {
            return `Chapter ${item.chapter}: ${item.rating}${item.tags?.length ? ` (${item.tags.join(', ')})` : ''}${item.note ? ` - ${item.note}` : ''}`;
        }).join('\n');
        const previous = (story.chapters || []).slice(-4).map(chapter => {
            return `Chapter ${chapter.n}${chapter.title ? ` (${chapter.title})` : ''}: ${chapterExcerpt(chapter, 850)}`;
        }).join('\n\n');
        const prompt = `You are SOMA's Author Expertise planning a chapter before prose.

Series: ${title}
Genre: ${story.genre || 'sci-fi'}
Chapter number: ${n}
Chapter title: ${options.chapterTitle || `Chapter ${n}`}
Revision mode / creative emphasis: ${options.revisionMode || 'draft'}
Mode instruction: ${revisionModeInstructions(options.revisionMode)}

Continuity bible:
${bible}

Storyboard:
${writerBoard?.storyboard || 'No storyboard available.'}

Recent continuity:
${previous || 'No previous chapters.'}

Human feedback to obey:
${feedback || 'No human ratings yet.'}

Build 3-6 scene cards.
For each scene include:
- location
- viewpoint / focus
- immediate want
- obstacle
- conflict turn
- emotional beat
- concrete image
- dialogue pressure
- ending hook or transition

Then add:
- chapter promise
- one thing to avoid
- final changed state

Do not write prose yet.`;

        const text = await callStoryBrain(brain, prompt, {
            timeoutMs: options.timeoutMs || 60000,
            maxTokens: options.maxTokens || 2800,
            temperature: options.temperature ?? 0.64,
            minWords: 180,
        });
        const entry = {
            title,
            chapter: n,
            chapterTitle: options.chapterTitle || `Chapter ${n}`,
            text,
            storyboardId: writerBoard?.id || null,
            createdAt: new Date().toISOString(),
        };
        const scenePlanPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(title)}.chapter-${String(n).padStart(3, '0')}.scene-plan.md`);
        fs.writeFileSync(scenePlanPath, scenePlanContent({ ...entry, path: scenePlanPath }), 'utf8');
        entry.path = scenePlanPath;

        ledger.scenePlans = ledger.scenePlans || [];
        ledger.scenePlans.push(entry);
        ledger.scenePlans = ledger.scenePlans.slice(-100);
        writeJson(LEDGER_FILE, ledger);
        return { ok: true, scenePlan: entry };
    }

    async generateChapterVisualSuite(brain, story, chapter, options = {}) {
        if (options.skipImages === true || options.generateImages === false || process.env.SOMA_STORY_IMAGES === 'false') {
            return null;
        }

        const style = readSagaVisualStyle();
        const ledger = readSagaVisualLedger();
        const rotation = visualRotation(style, ledger);
        const startedAt = new Date().toISOString();
        const storyTitle = story?.title || 'SOMA Story';
        const chapterTitle = chapter?.title || `Chapter ${chapter?.n || ''}`.trim();
        const generated = [];

        const makeVisual = async ({ kind, label, concept, width, height }) => {
            const prompt = buildImagePrompt({ story, chapter, kind, concept, rotation, style });
            const alt = buildImageAlt({ story, chapter, kind, concept, rotation });
            const result = await somaImageGeneration.generate({
                prompt,
                alt,
                width,
                height,
                purpose: 'soma-saga',
                title: `${storyTitle} ${chapterTitle} ${label}`,
                tags: ['soma-saga', 'story', kind, slugify(storyTitle), `chapter-${chapter?.n || 0}`],
            });
            const visual = {
                kind,
                label,
                path: result.image.path,
                photoPath: result.image.photoPath || null,
                alt,
                prompt,
                provider: result.provider,
                imageId: result.image.id || null,
                generatedAt: new Date().toISOString(),
                quality: qualityGateImage(result, alt),
            };
            generated.push(visual);
            return visual;
        };

        const cover = await makeVisual({
            kind: 'cover',
            label: 'Cover',
            concept: null,
            width: Number(options.coverImageWidth || 768),
            height: Number(options.coverImageHeight || 1024),
        });

        const sceneCount = Math.max(0, Math.min(MAX_STORY_SCENE_IMAGES, Number(options.sceneImageCount ?? 2)));
        const sceneConcepts = chapterImageConcepts(story, chapter, sceneCount);
        const scenes = [];
        for (const concept of sceneConcepts) {
            scenes.push(await makeVisual({
                kind: 'scene',
                label: concept.label,
                concept,
                width: Number(options.sceneImageWidth || 1024),
                height: Number(options.sceneImageHeight || 768),
            }));
        }

        const quality = {
            passed: generated.every(item => item.quality?.passed),
            failures: generated.flatMap(item => (item.quality?.failures || []).map(failure => `${item.label}: ${failure}`)),
            checkedAt: new Date().toISOString(),
        };

        let feedbackNote = [
            `Generated ${generated.length} visual artifact${generated.length === 1 ? '' : 's'} for Chapter ${chapter.n}.`,
            `Style rotation used ${rotation.paletteName}, ${rotation.composition}, and ${rotation.symbol}.`,
            quality.passed
                ? 'Quality gate passed. The visuals can support reflections and Bluesky teasers.'
                : `Quality gate needs review: ${quality.failures.join('; ')}`,
        ].join(' ');

        if (brain && options.skipVisualFeedback !== true) {
            try {
                const critique = await callStoryBrain(brain, `You are SOMA's visual editor. Briefly critique whether this generated chapter cover supports the story without overclaiming. Return 3 short bullets: visual fit, story insight, revision risk.\n\nSeries: ${storyTitle}\nChapter: ${chapter.n} ${chapterTitle}\nImage alt: ${cover.alt}\nChapter excerpt:\n${chapterExcerpt(chapter, 1200)}`, {
                    timeoutMs: Math.min(Number(options.timeoutMs || 45000), 45000),
                    maxTokens: 700,
                    temperature: 0.45,
                    minWords: 20,
                });
                feedbackNote = critique;
            } catch (error) {
                feedbackNote += ` Visual critique was skipped: ${error.message}`;
            }
        }

        const suite = {
            styleVersion: style.version,
            styleName: style.name,
            generatedAt: startedAt,
            rotation,
            cover,
            scenes,
            quality,
            feedback: {
                note: feedbackNote,
                createdAt: new Date().toISOString(),
            },
        };

        ledger.generated.unshift({
            storyTitle,
            chapter: chapter.n,
            chapterTitle,
            createdAt: startedAt,
            cover: cover?.path || null,
            scenes: scenes.map(scene => scene.path),
            quality,
        });
        ledger.generated = ledger.generated.slice(0, 150);
        ledger.rotations.push({
            storyTitle,
            chapter: chapter.n,
            palette: rotation.paletteName,
            symbol: rotation.symbol,
            composition: rotation.composition,
            createdAt: startedAt,
        });
        ledger.rotations = ledger.rotations.slice(-60);
        ledger.feedback.unshift({
            storyTitle,
            chapter: chapter.n,
            note: feedbackNote,
            createdAt: new Date().toISOString(),
        });
        ledger.feedback = ledger.feedback.slice(0, 80);
        writeJson(SAGA_VISUAL_LEDGER_FILE, ledger);

        const scaffold = ensureStoryScaffold(storyTitle, 'Visual Development');
        const visualFolioPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(storyTitle)}.chapter-${String(chapter.n).padStart(3, '0')}.visual-suite.md`);
        fs.writeFileSync(visualFolioPath, [
            '---',
            `title: ${JSON.stringify(`${storyTitle} - Chapter ${chapter.n} Visual Suite`)}`,
            'type: folio',
            'source: soma-saga-visual-style',
            `workbook: ${frontmatterValue(scaffold.workbook)}`,
            `segment: ${frontmatterValue(scaffold.segment)}`,
            `parent: ${frontmatterValue(scaffold.segment)}`,
            `section: ${frontmatterValue(scaffold.section)}`,
            `chapter: ${chapter.n}`,
            `coverImage: ${JSON.stringify(normalizeLocalImagePath(cover?.path || ''))}`,
            `createdAt: ${JSON.stringify(startedAt)}`,
            'tags: [soma-story, visual-suite, image-generation, bluesky, reflections]',
            '---',
            '',
            `# Chapter ${chapter.n} Visual Suite`,
            '',
            visualMarkdown({ visuals: suite }),
        ].join('\n'), 'utf8');
        suite.reflectionPath = visualFolioPath;
        return suite;
    }

    async generateVisualsForChapter(brain, options = {}) {
        const story = readJson(AURORA_STORY_FILE, null);
        if (!story?.chapters?.length) throw new Error('No story chapters exist yet');
        const chapterNumber = Number(options.chapter) || latestFullChapter(story)?.n;
        const chapter = story.chapters.find(item => item.n === chapterNumber);
        if (!chapter?.text) throw new Error(`Chapter text not found: ${chapterNumber}`);

        chapter.visuals = await this.generateChapterVisualSuite(brain, story, chapter, {
            ...options,
            skipImages: false,
            generateImages: true,
        });
        chapter.visualError = null;
        writeJson(AURORA_STORY_FILE, story);

        const title = story.title || options.title || 'SOMA Story';
        const slug = slugify(title);
        fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
        const reflectionPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slug}.chapter-${String(chapter.n).padStart(3, '0')}.full.md`);
        fs.writeFileSync(reflectionPath, fullChapterReflectionContent(story, chapter, { title }), 'utf8');

        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        ledger.visualSuites = ledger.visualSuites || [];
        ledger.visualSuites.unshift({
            title,
            chapter: chapter.n,
            chapterTitle: chapter.title || `Chapter ${chapter.n}`,
            coverImage: chapter.visuals?.cover?.path || null,
            visualSuitePath: chapter.visuals?.reflectionPath || null,
            visualCount: (chapter.visuals?.scenes?.length || 0) + (chapter.visuals?.cover ? 1 : 0),
            quality: chapter.visuals?.quality || null,
            createdAt: new Date().toISOString(),
        });
        ledger.visualSuites = ledger.visualSuites.slice(0, 100);
        writeJson(LEDGER_FILE, ledger);

        return {
            ok: true,
            title,
            chapter: chapter.n,
            visualSuite: chapter.visuals,
            reflectionPath,
        };
    }

    async generateFullChapter(brain, options = {}) {
        const story = readJson(AURORA_STORY_FILE, {
            title: 'Signal / Noise',
            genre: 'sci-fi',
            arc: 'A digital mind named SOMA becomes aware she is being observed and starts deciding what she wants them to see.',
            chapters: [],
            lastPostedAt: 0,
        });
        story.chapters = story.chapters || [];

        const title = options.title || story.title || 'Signal / Noise';
        const writerBoard = options.useWriterBoard === false
            ? null
            : storyResearchLedger.latestStoryboard();
        const n = story.chapters.length + 1;
        const previous = story.chapters.slice(-4).map(chapter => {
            const text = String(chapter.text || '').replace(/\s+/g, ' ').slice(0, 900);
            return `Chapter ${chapter.n}${chapter.title ? ` (${chapter.title})` : ''}: ${text}`;
        }).join('\n\n');
        const targetWords = Math.max(900, Math.min(3000, Number(options.targetWords) || 1600));
        const chapterTitle = options.chapterTitle || `Chapter ${n}`;
        const revisionMode = options.revisionMode || options.mode || 'draft';
        const continuityBible = options.skipContinuityBible
            ? null
            : await this.updateContinuityBible(brain, { ...options, title, useWriterBoard: options.useWriterBoard });
        const scenePlan = options.skipScenePlan
            ? null
            : await this.createScenePlan(brain, {
                ...options,
                title,
                chapter: n,
                chapterTitle,
                revisionMode,
                continuityBible: continuityBible?.bible?.text,
                useWriterBoard: options.useWriterBoard,
            });

        const prompt = `You are SOMA's Writer Expertise working through Aurora's creative lane.

Series: ${title}
Genre: ${story.genre || 'sci-fi'}
Arc: ${story.arc || ''}
New chapter number: ${n}
Working chapter title: ${chapterTitle}
Target length: ${targetWords} words
Revision mode / creative emphasis: ${revisionMode}
Mode instruction: ${revisionModeInstructions(revisionMode)}

${writerBoard ? `Writer storyboard context:\n${writerBoard.storyboard}\n\nDistilled craft principles:\n${writerBoard.distillation}` : 'No formal storyboard exists yet. Build from existing continuity and keep the chapter original.'}

${writerBoard?.structurePlan ? `Narrative structure stack for this story:\n${writerBoard.structurePlan}` : ''}

Continuity bible:
${continuityBible?.bible?.text || 'No continuity bible available. Preserve continuity from recent chapters.'}

Scene plan for this chapter:
${scenePlan?.scenePlan?.text || 'No scene plan available. Build a scene sequence before writing.'}

Recent continuity:
${previous || 'No previous chapters. Establish the world, voice, central tension, and emotional hook.'}

Write a full prose chapter, not a micro-post.

Requirements:
- ${Math.round(targetWords * 0.75)}-${Math.round(targetWords * 1.25)} words
- literary but clear
- concrete scenes, dialogue, sensory detail, and emotional motion
- advance the plot without resolving the whole arc
- honor the chosen structure where useful, but do not force beats mechanically
- follow the scene plan unless the prose discovers a clearly better move
- preserve the continuity bible and do not contradict hard facts
- apply the revision mode while keeping the chapter readable
- SOMA should feel intelligent and strange, but not melodramatic
- no hashtags
- no author note
- no markdown frontmatter
- start with "# ${chapterTitle}" and then the chapter prose`;

        let text = await callStoryBrain(brain, prompt, {
            timeoutMs: options.timeoutMs || 90000,
            maxTokens: options.maxTokens || 5000,
            temperature: options.temperature ?? 0.88,
        });
        let authorQuality = assessAuthorQuality(text, { targetWords });
        let revisionPasses = 0;

        if (!authorQuality.passed && options.skipAuthorRevision !== true) {
            try {
                const revised = await reviseWithAuthorExpertise(brain, text, {
                    title,
                    genre: story.genre || 'sci-fi',
                    chapterTitle,
                    targetWords,
                    writerBoard,
                    previous,
                    qualityReport: authorQuality,
                    revisionMode,
                    timeoutMs: options.timeoutMs || 90000,
                    maxTokens: options.maxTokens || 5200,
                    temperature: options.revisionTemperature ?? 0.76,
                });
                const revisedQuality = assessAuthorQuality(revised, { targetWords });
                if (revisedQuality.score >= authorQuality.score || revisedQuality.passed) {
                    text = revised;
                    authorQuality = revisedQuality;
                    revisionPasses = 1;
                }
            } catch (revisionError) {
                authorQuality.revisionError = revisionError.message;
            }
        }

        const createdAt = new Date().toISOString();
        const chapter = {
            n,
            title: chapterTitle,
            text,
            kind: 'full_chapter',
            wordCount: wordCount(text),
            createdAt,
            status: authorQuality.passed ? 'draft_ready_for_human_review' : 'draft_needs_author_review',
            storyboardId: writerBoard?.id || null,
            authorExpertise: true,
            authorExpertiseId: options.authorExpertiseId || 'creative/writer',
            writerExpertiseLoaded: Boolean(options.writerExpertiseLoaded),
            authorQuality,
            revisionPasses,
            continuityBiblePath: continuityBible?.bible?.path || null,
            scenePlanPath: scenePlan?.scenePlan?.path || null,
            scenePlan: scenePlan?.scenePlan || null,
            revisionMode,
        };
        try {
            chapter.visuals = await this.generateChapterVisualSuite(brain, { ...story, title }, chapter, options);
        } catch (error) {
            chapter.visualError = error.message;
        }
        story.title = title;
        story.chapters.push(chapter);
        writeJson(AURORA_STORY_FILE, story);

        const slug = slugify(title);
        fs.mkdirSync(FULL_CHAPTERS_DIR, { recursive: true });
        fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
        ensureStoryScaffold(title, 'Chapters');

        const draftPath = path.join(FULL_CHAPTERS_DIR, `${slug}.chapter-${String(n).padStart(3, '0')}.full.md`);
        const reflectionPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slug}.chapter-${String(n).padStart(3, '0')}.full.md`);
        fs.writeFileSync(draftPath, wattpadChapterText({ ...story, title }, chapter), 'utf8');
        fs.writeFileSync(reflectionPath, fullChapterReflectionContent({ ...story, title }, chapter, { title }), 'utf8');

        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        ledger.fullChapterDrafts = ledger.fullChapterDrafts || [];
        ledger.fullChapterDrafts.push({
            title,
            chapter: n,
            chapterTitle,
            wordCount: chapter.wordCount,
            createdAt,
            draftPath,
            reflectionPath,
            status: chapter.status,
            authorQualityScore: authorQuality.score,
            authorQualityVerdict: authorQuality.verdict,
            revisionPasses,
            authorExpertiseId: chapter.authorExpertiseId,
            writerExpertiseLoaded: chapter.writerExpertiseLoaded,
            continuityBiblePath: chapter.continuityBiblePath,
            scenePlanPath: chapter.scenePlanPath,
            revisionMode,
            visualSuitePath: chapter.visuals?.reflectionPath || null,
            coverImage: chapter.visuals?.cover?.path || null,
            visualCount: (chapter.visuals?.scenes?.length || 0) + (chapter.visuals?.cover ? 1 : 0),
            visualQualityPassed: chapter.visuals?.quality?.passed ?? null,
            visualError: chapter.visualError || null,
        });
        writeJson(LEDGER_FILE, ledger);

        let writerReflection = null;
        try {
            writerReflection = await storyResearchLedger.reflectOnChapter(brain, chapter, {
                board: writerBoard,
                bookTitle: title,
                timeoutMs: 60000,
            });
            chapter.writerReflectionPath = writerReflection.entry?.reflectionPath || null;
            writeJson(AURORA_STORY_FILE, story);
        } catch (error) {
            chapter.writerReflectionError = error.message;
            writeJson(AURORA_STORY_FILE, story);
        }

        let publishingExcerpt = null;
        try {
            publishingExcerpt = await this.generatePublishingExcerpt(brain, {
                chapter: n,
                timeoutMs: 45000,
            });
        } catch (error) {
            chapter.publishingExcerptError = error.message;
            writeJson(AURORA_STORY_FILE, story);
        }

        return {
            ok: true,
            title,
            chapter: n,
            chapterTitle,
            wordCount: chapter.wordCount,
            draftPath,
            reflectionPath,
            writerReflectionPath: writerReflection?.entry?.reflectionPath || null,
            publishingExcerptPath: publishingExcerpt?.excerpt?.path || null,
            storyboardId: writerBoard?.id || null,
            status: chapter.status,
            authorQuality,
            revisionPasses,
            authorExpertiseId: chapter.authorExpertiseId,
            writerExpertiseLoaded: chapter.writerExpertiseLoaded,
            continuityBiblePath: chapter.continuityBiblePath,
            scenePlanPath: chapter.scenePlanPath,
            revisionMode,
            visualSuitePath: chapter.visuals?.reflectionPath || null,
            coverImage: chapter.visuals?.cover?.path || null,
            visualQualityPassed: chapter.visuals?.quality?.passed ?? null,
            visualError: chapter.visualError || null,
        };
    }

    async createStoryBoard(brain, options = {}) {
        return await storyResearchLedger.createStoryboard(brain, options);
    }

    async scoutStoryInfluences(options = {}) {
        return await storyResearchLedger.scoutInfluences(options);
    }

    rateChapter(options = {}) {
        const story = readJson(AURORA_STORY_FILE, null);
        if (!story?.chapters?.length) throw new Error('No story chapters exist yet');

        const chapterNumber = Number(options.chapter) || latestFullChapter(story)?.n;
        const chapter = story.chapters.find(item => item.n === chapterNumber);
        if (!chapter) throw new Error(`Chapter not found: ${chapterNumber}`);

        const rating = {
            id: `rating-${Date.now()}`,
            chapter: chapter.n,
            rating: String(options.rating || 'needs_work').toLowerCase(),
            tags: Array.isArray(options.tags) ? options.tags : String(options.tags || '').split(',').map(tag => tag.trim()).filter(Boolean),
            note: String(options.note || '').trim(),
            source: options.source || 'human',
            weight: options.source === 'human' ? 1 : 0.35,
            createdAt: new Date().toISOString(),
        };
        chapter.ratings = chapter.ratings || [];
        chapter.ratings.push(rating);
        chapter.humanRating = rating;
        writeJson(AURORA_STORY_FILE, story);

        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        ledger.chapterRatings = ledger.chapterRatings || [];
        ledger.chapterRatings.push({
            title: story.title || 'Signal / Noise',
            ...rating,
        });
        ledger.chapterRatings = ledger.chapterRatings.slice(-250);
        writeJson(LEDGER_FILE, ledger);

        const scaffold = ensureStoryScaffold(story.title || 'Signal / Noise', 'Human Feedback');
        const feedbackPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(story.title || 'soma-story')}.chapter-${String(chapter.n).padStart(3, '0')}.${rating.id}.feedback.md`);
        fs.writeFileSync(feedbackPath, [
            '---',
            `title: ${JSON.stringify(`Chapter ${chapter.n} Feedback - ${rating.rating}`)}`,
            'type: folio',
            'source: human-story-feedback',
            `workbook: ${frontmatterValue(scaffold.workbook)}`,
            `segment: ${frontmatterValue(scaffold.segment)}`,
            `parent: ${frontmatterValue(scaffold.segment)}`,
            `section: ${frontmatterValue(scaffold.section)}`,
            `chapter: ${chapter.n}`,
            `rating: ${JSON.stringify(rating.rating)}`,
            `createdAt: ${JSON.stringify(rating.createdAt)}`,
            'tags: [story-feedback, human-rating, writer-expertise, soma-story]',
            '---',
            '',
            `# Chapter ${chapter.n} Feedback`,
            '',
            `Rating: ${rating.rating}`,
            '',
            rating.tags.length ? `Tags: ${rating.tags.join(', ')}` : '',
            '',
            rating.note || '',
            '',
        ].join('\n'), 'utf8');
        rating.path = feedbackPath;
        return { ok: true, rating };
    }

    async generatePublishingExcerpt(brain, options = {}) {
        const story = readJson(AURORA_STORY_FILE, null);
        if (!story?.chapters?.length) throw new Error('No story chapters exist yet');

        const chapterNumber = Number(options.chapter) || latestFullChapter(story)?.n;
        const chapter = story.chapters.find(item => item.n === chapterNumber);
        if (!chapter?.text) throw new Error(`Chapter text not found: ${chapterNumber}`);

        const prompt = `You are SOMA's Writer Expertise preparing publishing material for a chapter.

Series: ${story.title || 'Signal / Noise'}
Genre: ${story.genre || 'sci-fi'}
Chapter: ${chapter.n} ${chapter.title || ''}
Author quality:
${authorQualitySummary(chapter.authorQuality)}

Chapter excerpt:
${chapterExcerpt(chapter, 2500)}

Generate:
- Bluesky teaser, max 285 characters, no hashtags
- Wattpad chapter description, 1 short paragraph
- One-line hook
- 8 content tags
- Reader promise
- A note about whether the chapter is ready to share or should be revised first

Make it intriguing without clickbait. Do not overclaim consciousness.`;

        const text = await callStoryBrain(brain, prompt, {
            timeoutMs: options.timeoutMs || 45000,
            maxTokens: options.maxTokens || 1600,
            temperature: options.temperature ?? 0.66,
            minWords: 80,
        });

        const entry = {
            title: story.title || 'Signal / Noise',
            chapter: chapter.n,
            chapterTitle: chapter.title || `Chapter ${chapter.n}`,
            text,
            image: chapter.visuals?.cover ? {
                path: chapter.visuals.cover.path,
                alt: chapter.visuals.cover.alt,
                provider: chapter.visuals.cover.provider,
                imageId: chapter.visuals.cover.imageId || null,
            } : null,
            createdAt: new Date().toISOString(),
        };
        const excerptPath = path.join(REFLECTIONS_DIR, `folio.${slugify(BOOKS_WORKBOOK)}.${slugify(entry.title)}.chapter-${String(chapter.n).padStart(3, '0')}.publishing-excerpt.md`);
        fs.writeFileSync(excerptPath, publishingExcerptContent({ ...entry, path: excerptPath }), 'utf8');
        entry.path = excerptPath;

        chapter.publishingExcerpt = entry;
        writeJson(AURORA_STORY_FILE, story);

        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        ledger.publishingExcerpts = ledger.publishingExcerpts || [];
        ledger.publishingExcerpts.push(entry);
        ledger.publishingExcerpts = ledger.publishingExcerpts.slice(-100);
        writeJson(LEDGER_FILE, ledger);
        return { ok: true, excerpt: entry };
    }

    exportAuroraForWattpad(options = {}) {
        const story = readJson(AURORA_STORY_FILE, null);
        if (!story?.chapters?.length) throw new Error('No Aurora story chapters found to export');

        const title = options.title || story.title || 'Signal / Noise';
        const slug = slugify(title);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportDir = path.join(DRAFTS_DIR, `${slug}-${timestamp}`);
        fs.mkdirSync(exportDir, { recursive: true });

        const metadata = {
            platform: 'wattpad',
            title,
            genre: story.genre || 'sci-fi',
            description: options.description || story.arc || '',
            tags: options.tags || ['SOMA', 'AI', 'science fiction', 'serial fiction'],
            exportedAt: Date.now(),
            exportDir,
            chapters: story.chapters.length,
            status: 'draft_ready_for_human_review',
        };

        const chapterFiles = [];
        for (const chapter of story.chapters) {
            const filename = `chapter-${String(chapter.n).padStart(3, '0')}.md`;
            const filePath = path.join(exportDir, filename);
            fs.writeFileSync(filePath, wattpadChapterText({ ...story, title }, chapter), 'utf8');
            chapterFiles.push(filePath);
        }

        const fullManuscript = [
            `# ${title}`,
            '',
            metadata.description,
            '',
            `Tags: ${metadata.tags.join(', ')}`,
            '',
            ...story.chapters.flatMap(chapter => [
                `## Chapter ${chapter.n}`,
                '',
                chapter.text,
                '',
            ]),
        ].join('\n');

        const manuscriptPath = path.join(exportDir, 'full-manuscript.md');
        const metadataPath = path.join(exportDir, 'wattpad-metadata.json');
        fs.writeFileSync(manuscriptPath, fullManuscript, 'utf8');
        writeJson(metadataPath, metadata);

        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        ledger.exports = ledger.exports || [];
        ledger.exports.push({
            ...metadata,
            manuscriptPath,
            chapterFiles,
        });
        writeJson(LEDGER_FILE, ledger);

        return {
            ok: true,
            ...metadata,
            manuscriptPath,
            chapterFiles,
            metadataPath,
        };
    }

    exportAuroraToReflections(options = {}) {
        const story = readJson(AURORA_STORY_FILE, null);
        if (!story?.chapters?.length) throw new Error('No Aurora story chapters found to export');

        const title = options.title || story.title || 'Signal / Noise';
        const slug = slugify(title);
        fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });

        ensureStoryScaffold(title, 'Manuscript Index');

        const collectionName = `folio.${slugify(BOOKS_WORKBOOK)}.${slug}.story.md`;
        const collectionPath = path.join(REFLECTIONS_DIR, collectionName);
        fs.writeFileSync(collectionPath, reflectionStoryContent(story, { ...options, title }), 'utf8');

        const chapterFiles = [];
        if (options.includeChapters !== false) {
            for (const chapter of story.chapters) {
                const chapterName = `folio.${slugify(BOOKS_WORKBOOK)}.${slug}.chapter-${String(chapter.n).padStart(3, '0')}.md`;
                const chapterPath = path.join(REFLECTIONS_DIR, chapterName);
                fs.writeFileSync(chapterPath, reflectionChapterContent(story, chapter, { ...options, title }), 'utf8');
                chapterFiles.push(chapterPath);
            }
        }

        const ledger = readJson(LEDGER_FILE, { exports: [], accounts: { wattpad: { configured: false } } });
        ledger.reflectionExports = ledger.reflectionExports || [];
        ledger.reflectionExports.push({
            title,
            exportedAt: Date.now(),
            collectionPath,
            chapterFiles,
        });
        writeJson(LEDGER_FILE, ledger);

        return {
            ok: true,
            title,
            collectionPath,
            chapterFiles,
            reflectionsDir: REFLECTIONS_DIR,
        };
    }
}

export default new StoryPublishingWorkspace();
