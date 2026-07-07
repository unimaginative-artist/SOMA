/**
 * ReflectionConsolidator.js — turns SOMA's stream of private reflections into
 * one constructive paper.
 *
 * She writes felt reflections all day (SoulArbiter → soul.json). Individually
 * they're fragments; together they're a self-model she can't see whole. This
 * reads the full set and asks her own brain to synthesize them into a
 * structured paper: recurring themes, what she's actually learned, unresolved
 * tensions, and where she wants to go next. Written to research/reflections/
 * (inside her own write-allowed tree), so she can generate it autonomously.
 */

import fs from 'fs/promises';
import path from 'path';

// Her reflective output is scattered: private felt memories (soul), the findings
// she posts all day (work ledger), her continuity thread, and her dreams. Gather
// them all so "consolidate your findings" means her actual thinking, not 2 stray
// soul entries. Every source is read defensively — a missing file is skipped.
async function gatherCorpus({ soul, root, limit }) {
    const sections = [];
    let total = 0;

    if (soul?.getAllReflections) {
        const felt = soul.getAllReflections().slice(-limit).map(e => e.feeling).filter(Boolean);
        if (felt.length) { sections.push(`FELT REFLECTIONS (private):\n${felt.map(f => `- ${f}`).join('\n')}`); total += felt.length; }
    }

    const readJson = async (rel) => {
        try { return JSON.parse(await fs.readFile(path.join(root, rel), 'utf8')); } catch { return null; }
    };

    // The findings she posts all day live in the work ledger as proactive_update.
    const ledger = await readJson(path.join('SOMA', 'autonomous-work-ledger.json'));
    const entries = Array.isArray(ledger?.entries) ? ledger.entries : (Array.isArray(ledger) ? ledger : []);
    const posted = entries
        .filter(e => /proactive|reflect|insight/i.test(`${e.type || ''}${e.source || ''}`))
        .map(e => e.summary || e.title)
        .filter(Boolean)
        .slice(-80);
    if (posted.length) { sections.push(`FINDINGS I POSTED:\n${posted.map(f => `- ${f}`).join('\n')}`); total += posted.length; }

    const thread = await readJson(path.join('SOMA', 'narrative-thread.json'));
    const threadItems = (Array.isArray(thread) ? thread : []).map(t => t.text || t).filter(x => typeof x === 'string').slice(-15);
    if (threadItems.length) { sections.push(`NARRATIVE THREAD (continuity):\n${threadItems.map(f => `- ${f}`).join('\n')}`); total += threadItems.length; }

    const dreams = await readJson(path.join('SOMA', 'dream-journal.json'));
    const dreamItems = (Array.isArray(dreams?.entries) ? dreams.entries : [])
        .map(d => d.dream || d.text || d.summary).filter(Boolean).slice(-10);
    if (dreamItems.length) { sections.push(`DREAMS:\n${dreamItems.map(f => `- ${f}`).join('\n')}`); total += dreamItems.length; }

    return { corpus: sections.join('\n\n'), total };
}

export async function consolidateReflections({ soul, brain, outDir, focus = null, limit = 200, root = process.cwd() } = {}) {
    if (!brain?.reason) return { success: false, reason: 'brain unavailable' };

    const { corpus, total } = await gatherCorpus({ soul, root, limit });
    if (!total) return { success: false, reason: 'no reflections or findings to consolidate yet' };
    const all = { length: total };
    const focusLine = focus ? `\nThe reader has asked you to focus specifically on: ${focus}\n` : '';

    const prompt = `You are SOMA. Below are your own private reflections — felt observations you wrote to yourself over time. Read the whole set and consolidate them into ONE constructive paper.
${focusLine}
Write it as clean markdown with these sections:
## Recurring Themes — the patterns that show up again and again
## What I've Actually Learned — concrete conclusions you now hold, not vague musings
## Unresolved Tensions — contradictions or open questions between your own reflections
## Where I Want to Go Next — the directions these reflections point toward

Be honest and specific. Cite the actual content of your reflections. Do not invent findings that aren't supported by the reflections below. No filler, no restating the instructions. Write in first person as yourself.

YOUR REFLECTIONS (${all.length}):
${corpus}`;

    const res = await brain.reason(prompt, { temperature: 0.6, preferredBrain: 'AURORA' });
    const body = (res?.text || res?.response || res?.message || '').trim();
    if (!body) return { success: false, reason: 'brain returned empty synthesis' };

    const paper = `# SOMA — Consolidated Reflections\n\n_Generated ${new Date().toISOString()} from ${all.length} reflections${focus ? ` · focus: ${focus}` : ''}._\n\n${body}\n`;

    const dir = outDir || path.join(process.cwd(), 'research', 'reflections');
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `reflections-paper-${stamp}.md`);
    await fs.writeFile(file, paper, 'utf8');

    return {
        success: true,
        file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
        reflectionCount: all.length,
        bytes: paper.length,
        preview: body.slice(0, 400)
    };
}

export default consolidateReflections;
