'use strict';
// ════════════════════════════════════════════════════════════════════════════
// AgendaSystem.cjs
// ════════════════════════════════════════════════════════════════════════════
// SOMA's personal learning agenda — the curriculum toward AGI.
//
// Each item is studied ONCE using Gemini (not the local model) to produce
// training-quality synthesis. The output is:
//   1. Written to data/training/soma_knowledge.jsonl (alpaca format)
//      → fed to train-soma-llama.py to fine-tune the local model
//   2. Stored in MnemonicArbiter as a [Learned] memory for prompt injection
//   3. Checked off in SOMA_AGENDA.md with a brief reflection note
//
// This is the actual path to reducing Gemini dependency:
//   Gemini teaches once → local model learns from weights → local model answers
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DEFAULT_AGENDA_PATH  = path.join(__dirname, '..', 'SOMA_AGENDA.md');
const TRAINING_FILE        = path.join(__dirname, '..', 'data', 'training', 'soma_knowledge.jsonl');

class AgendaSystem {
    constructor(agendaPath = DEFAULT_AGENDA_PATH) {
        this.agendaPath      = agendaPath;
        this.trainingFile    = TRAINING_FILE;
        this._catIndex       = 0;   // Round-robin category pointer
        this._callCount      = 0;   // Rate limiting: only study every N heartbeat ticks
        this._studyInterval  = 5;   // Study 1 item per 5 ticks (~10 min at 2-min interval)
        this._ensureTrainingDir();
    }

    _ensureTrainingDir() {
        try { fs.mkdirSync(path.dirname(this.trainingFile), { recursive: true }); } catch {}
    }

    // ─── Parse the markdown into sections + items ────────────────────────────
    _parse() {
        try {
            const raw = fs.readFileSync(this.agendaPath, 'utf-8');
            const sections = [];
            let current = null;

            for (const line of raw.split('\n')) {
                if (line.startsWith('## ')) {
                    if (current) sections.push(current);
                    current = { title: line.slice(3).trim(), items: [] };
                } else if (current && /^- \[[ x]\]/.test(line)) {
                    current.items.push({
                        checked: line.startsWith('- [x]'),
                        text: line
                            .replace(/^- \[[ x]\]\s*/, '')
                            .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '')
                            .replace(/\s*—\s*.+$/, '')
                            .trim(),
                        raw: line
                    });
                }
            }
            if (current) sections.push(current);
            return sections;
        } catch {
            return [];
        }
    }

    // ─── Overall completion stats ────────────────────────────────────────────
    getProgress() {
        const sections = this._parse();
        let total = 0, completed = 0;
        const byCategory = {};

        for (const s of sections) {
            const done = s.items.filter(i => i.checked).length;
            total     += s.items.length;
            completed += done;
            byCategory[s.title] = { total: s.items.length, completed: done };
        }

        return {
            total,
            completed,
            remaining: total - completed,
            percent:   total > 0 ? Math.round((completed / total) * 100) : 0,
            byCategory
        };
    }

    // ─── Training data stats ─────────────────────────────────────────────────
    getTrainingStats() {
        try {
            if (!fs.existsSync(this.trainingFile)) return { entries: 0, sizeKb: 0 };
            const content = fs.readFileSync(this.trainingFile, 'utf-8');
            const entries = content.split('\n').filter(l => l.trim()).length;
            const sizeKb  = Math.round(fs.statSync(this.trainingFile).size / 1024);
            return { entries, sizeKb, path: this.trainingFile };
        } catch {
            return { entries: 0, sizeKb: 0 };
        }
    }

    // ─── Pick next unchecked item — round-robin across categories ────────────
    getNextItem() {
        const sections = this._parse();
        const withWork = sections
            .map(s => ({ ...s, items: s.items.filter(i => !i.checked) }))
            .filter(s => s.items.length > 0);

        if (withWork.length === 0) return null;

        this._catIndex = this._catIndex % withWork.length;
        const section  = withWork[this._catIndex];
        this._catIndex = (this._catIndex + 1) % withWork.length;

        return { category: section.title, ...section.items[0] };
    }

    // ─── Mark an item complete with a reflection note ────────────────────────
    markComplete(rawLine, reflection = '') {
        try {
            const content = fs.readFileSync(this.agendaPath, 'utf-8');
            if (!content.includes(rawLine)) return;

            const date        = new Date().toISOString().slice(0, 10);
            const cleanText   = rawLine.replace(/^- \[[ x]\]\s*/, '').trim();
            const shortNote   = reflection.substring(0, 160).replace(/\n/g, ' ').trim();
            const replacement = shortNote
                ? `- [x] [${date}] ${cleanText} — ${shortNote}`
                : `- [x] [${date}] ${cleanText}`;

            fs.writeFileSync(this.agendaPath, content.replace(rawLine, replacement), 'utf-8');
        } catch {}
    }

    // ─── SOMA adds a new item to a category ─────────────────────────────────
    addItem(category, itemText) {
        try {
            const content = fs.readFileSync(this.agendaPath, 'utf-8');
            const sectionHeader = `## ${category}`;
            const idx = content.indexOf(sectionHeader);

            if (idx === -1) {
                const footerIdx = content.lastIndexOf('---\n<!--');
                const newSection = `\n## ${category}\n\n- [ ] ${itemText}\n`;
                const updated = footerIdx !== -1
                    ? content.slice(0, footerIdx) + newSection + content.slice(footerIdx)
                    : content + newSection;
                fs.writeFileSync(this.agendaPath, updated, 'utf-8');
            } else {
                const afterHeader = content.indexOf('\n', idx + sectionHeader.length) + 1;
                const nextSection = content.indexOf('\n---', afterHeader);
                const insertAt    = nextSection !== -1 ? nextSection : content.length;
                const updated     = content.slice(0, insertAt) + `\n- [ ] ${itemText}` + content.slice(insertAt);
                fs.writeFileSync(this.agendaPath, updated, 'utf-8');
            }
            console.log(`[AgendaSystem] ✏️  Added: "${itemText.substring(0, 60)}" → ${category}`);
        } catch (e) {
            console.warn(`[AgendaSystem] Could not add item: ${e.message}`);
        }
    }

    // ─── Write one alpaca-format training pair to the JSONL file ────────────
    // This is what train-soma-llama.py reads to fine-tune the local model.
    _writeTrainingPair(instruction, output) {
        try {
            if (!instruction || instruction.length < 20) return false;
            if (!output      || output.length < 100)      return false;

            const entry = JSON.stringify({
                instruction: instruction.trim(),
                input:       '',
                output:      output.trim()
            });
            fs.appendFileSync(this.trainingFile, entry + '\n', 'utf-8');
            return true;
        } catch {
            return false;
        }
    }

    // ─── Return a task for AutonomousHeartbeat (rate-limited) ───────────────
    getNextTask() {
        // Rate limit: only fire every _studyInterval calls so other priorities still run
        this._callCount++;
        if (this._callCount % this._studyInterval !== 1) return null;

        const item = this.getNextItem();
        if (!item) return null;

        const progress    = this.getProgress();
        const catProgress = progress.byCategory[item.category] || {};

        return {
            source:   'LearningAgenda',
            gemini:   true,   // ← tells heartbeat: use full provider (DeepSeek), not local model
            description:
`You are generating training data for SOMA's local language model as part of its curriculum toward AGI.

TOPIC: "${item.text}"
CATEGORY: ${item.category}
CATEGORY PROGRESS: ${catProgress.completed || 0}/${catProgress.total || 0} complete
OVERALL AGENDA: ${progress.completed}/${progress.total} (${progress.percent}%)

Generate a comprehensive, accurate synthesis that will train SOMA to answer questions about this topic without needing Gemini. Be specific — vague generalities produce useless training data.

Cover all of these:
1. Core concept: what it is and how it works (2-3 sentences)
2. Key mechanisms, components, or subcategories (2-3 sentences)
3. Why it matters for artificial general intelligence (1-2 sentences)
4. Current state in 2025-2026 — latest developments or open problems (1-2 sentences)
5. One counterintuitive or non-obvious insight (1 sentence)
6. Direct connection to SOMA's architecture, goals, or capabilities (1 sentence)

Respond in EXACTLY this format:
SYNTHESIS: <8-12 sentence synthesis — specific, accurate, training-data quality>
INSIGHT: <single most important insight about this topic, max 150 chars>
TRAINING_Q: <natural question that would prompt this synthesis, e.g. "What is X and why does it matter for AI?">
NEW_ITEM: <one closely related topic worth adding to the curriculum, or "none">`,

            context: {
                type:          'agenda_item',
                category:      item.category,
                itemText:      item.text,
                rawLine:       item.raw,
                agendaProgress: { completed: progress.completed, total: progress.total }
            },

            onComplete: async (res) => {
                const text = res?.text || '';

                // Parse all four fields
                const synthesis  = (text.match(/SYNTHESIS:\s*([\s\S]+?)(?=\nINSIGHT:|\nTRAINING_Q:|$)/i)?.[1] || '').trim();
                const insight    = (text.match(/INSIGHT:\s*([\s\S]+?)(?=\nTRAINING_Q:\n|TRAINING_Q:|$)/i)?.[1] || '').trim().substring(0, 200);
                const trainingQ  = (text.match(/TRAINING_Q:\s*(.+)/i)?.[1] || '').trim();
                const newItem    = (text.match(/NEW_ITEM:\s*(.+)/i)?.[1] || '').trim();

                // 1. Write training pair — the core purpose of this whole system
                const written = this._writeTrainingPair(trainingQ || `What is ${item.text}?`, synthesis);

                // 2. Check off in agenda with insight as a human-readable note
                this.markComplete(item.raw, insight);

                // 3. Add SOMA-suggested follow-on topic if substantive
                if (newItem && newItem.toLowerCase() !== 'none' && newItem.length > 10) {
                    this.addItem(item.category, newItem);
                }

                const stats = this.getTrainingStats();
                console.log(
                    `[AgendaSystem] ✅ "${item.text.substring(0, 50)}..."` +
                    ` | Training: ${written ? '✓ written' : '✗ skipped'} (${stats.entries} pairs, ${stats.sizeKb}KB)` +
                    ` | Agenda: ${progress.completed + 1}/${progress.total}`
                );
            }
        };
    }
}

module.exports = { AgendaSystem };
