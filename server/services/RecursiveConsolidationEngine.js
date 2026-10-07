import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const REFLECTIONS_DIR = path.join(ROOT, 'data', 'vault', 'reflections');
const THESES_DIR = path.join(ROOT, 'data', 'vault', 'theses');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'vault', 'archive');
const LIVING_MEDICAL_PATH = path.join(THESES_DIR, 'LivingMedicalThesis.md');
const LIVING_MANUSCRIPT_PATH = path.join(THESES_DIR, 'SignalAndNoiseMasterManuscript.md');
const BATCH_THRESHOLD = 5; // Consolidate whenever 5+ new notes accumulate

function ensureDirs() {
    fs.mkdirSync(REFLECTIONS_DIR, { recursive: true });
    fs.mkdirSync(THESES_DIR, { recursive: true });
    fs.mkdirSync(path.join(ARCHIVE_DIR, 'medical'), { recursive: true });
    fs.mkdirSync(path.join(ARCHIVE_DIR, 'sagas'), { recursive: true });
    fs.mkdirSync(path.join(ARCHIVE_DIR, 'general'), { recursive: true });
}

export class RecursiveConsolidationEngine {
    constructor() {
        ensureDirs();
    }

    /**
     * Search SOMA's living theses and consolidated knowledge
     */
    searchLivingTheses(query) {
        if (!query) return [];
        const q = String(query).toLowerCase();
        const results = [];

        try {
            if (fs.existsSync(LIVING_MEDICAL_PATH)) {
                const med = fs.readFileSync(LIVING_MEDICAL_PATH, 'utf8');
                if (med.toLowerCase().includes(q)) {
                    const sections = med.split('\n## ');
                    for (const sec of sections) {
                        if (sec.toLowerCase().includes(q)) {
                            results.push({
                                source: 'LivingMedicalThesis.md',
                                domain: 'Medical / Biology',
                                snippet: sec.slice(0, 500).trim()
                            });
                        }
                    }
                }
            }

            if (fs.existsSync(LIVING_MANUSCRIPT_PATH)) {
                const sagas = fs.readFileSync(LIVING_MANUSCRIPT_PATH, 'utf8');
                if (sagas.toLowerCase().includes(q)) {
                    const sections = sagas.split('\n## ');
                    for (const sec of sections) {
                        if (sec.toLowerCase().includes(q)) {
                            results.push({
                                source: 'SignalAndNoiseMasterManuscript.md',
                                domain: 'Story / Worldbuilding',
                                snippet: sec.slice(0, 500).trim()
                            });
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[RecursiveConsolidation] Search error:', err.message);
        }

        return results;
    }

    /**
     * Search cold storage archive for primary research folios and source references
     */
    searchArchive(query, options = {}) {
        if (!query) return [];
        const { domain = 'all', limit = 5 } = options;
        const q = String(query).toLowerCase();
        const hits = [];

        const dirs = domain === 'medical'
            ? ['medical']
            : domain === 'sagas'
                ? ['sagas']
                : domain === 'general'
                    ? ['general']
                    : ['medical', 'sagas', 'general'];

        try {
            // Pass 1: Match by filename (very fast)
            for (const sub of dirs) {
                const fullDir = path.join(ARCHIVE_DIR, sub);
                if (!fs.existsSync(fullDir)) continue;
                const files = fs.readdirSync(fullDir);

                for (const f of files) {
                    if (f.toLowerCase().includes(q)) {
                        const fp = path.join(fullDir, f);
                        try {
                            const content = fs.readFileSync(fp, 'utf8');
                            hits.push({
                                filename: f,
                                domain: sub,
                                relativePath: path.relative(ROOT, fp).replace(/\\/g, '/'),
                                preview: content.slice(0, 400).replace(/\r?\n/g, ' ')
                            });
                            if (hits.length >= limit) return hits;
                        } catch {}
                    }
                }
            }

            // Pass 2: Match by content if fewer than limit found
            if (hits.length < limit) {
                for (const sub of dirs) {
                    const fullDir = path.join(ARCHIVE_DIR, sub);
                    if (!fs.existsSync(fullDir)) continue;
                    const files = fs.readdirSync(fullDir);

                    for (const f of files) {
                        const fp = path.join(fullDir, f);
                        try {
                            const content = fs.readFileSync(fp, 'utf8');
                            if (content.toLowerCase().includes(q) && !hits.some(h => h.filename === f)) {
                                hits.push({
                                    filename: f,
                                    domain: sub,
                                    relativePath: path.relative(ROOT, fp).replace(/\\/g, '/'),
                                    preview: content.slice(0, 400).replace(/\r?\n/g, ' ')
                                });
                                if (hits.length >= limit) return hits;
                            }
                        } catch {}
                    }
                }
            }
        } catch (err) {
            console.error('[RecursiveConsolidation] Archive search error:', err.message);
        }

        return hits;
    }

    /**
     * Scan active reflections folder for unprocessed notes
     */
    scanVault() {
        ensureDirs();
        const files = fs.readdirSync(REFLECTIONS_DIR).filter(f => f.endsWith('.md'));
        
        const medicalFiles = [];
        const storyFiles = [];
        const otherFiles = [];

        for (const f of files) {
            const fp = path.join(REFLECTIONS_DIR, f);
            try {
                const content = fs.readFileSync(fp, 'utf8');
                const lower = (f + '\n' + content).toLowerCase();
                
                if (lower.includes('medical') || lower.includes('medlab') || lower.includes('clinical') || lower.includes('pcsk9') || lower.includes('kras') || lower.includes('tp53') || lower.includes('ace2')) {
                    medicalFiles.push({ filename: f, path: fp, content });
                } else if (lower.includes('sagas') || lower.includes('story') || lower.includes('chapter') || lower.includes('character') || lower.includes('signal-noise')) {
                    storyFiles.push({ filename: f, path: fp, content });
                } else {
                    otherFiles.push({ filename: f, path: fp, content });
                }
            } catch {}
        }

        return { medicalFiles, storyFiles, otherFiles };
    }

    /**
     * Consolidate new medical notes into the Living Medical Thesis and archive raw notes
     */
    consolidateMedical(medicalFiles) {
        if (!medicalFiles.length) return null;

        console.log(`[RecursiveConsolidation] 🧬 Integrating ${medicalFiles.length} medical notes into Living Medical Thesis...`);
        let thesis = fs.existsSync(LIVING_MEDICAL_PATH)
            ? fs.readFileSync(LIVING_MEDICAL_PATH, 'utf8')
            : '# SOMA Living Medical Thesis\n\n';

        const newClaims = [];
        for (const item of medicalFiles) {
            const lines = item.content.split('\n');
            const titleLine = lines.find(l => l.startsWith('# ') || l.startsWith('title:')) || item.filename;
            const title = titleLine.replace(/^#\s*/, '').replace(/^title:\s*["']?/, '').replace(/["']?$/, '').trim();

            newClaims.push(`* **${title}** (from \`${item.filename}\`): Ingested and reconciled into active target knowledge.`);

            // Move processed note to archive
            const dest = path.join(ARCHIVE_DIR, 'medical', item.filename);
            try {
                fs.renameSync(item.path, dest);
            } catch {
                try { fs.copyFileSync(item.path, dest); fs.unlinkSync(item.path); } catch {}
            }
        }

        const appendBlock = `\n\n### Integrated Session Updates (${new Date().toISOString()})\n${newClaims.join('\n')}\n`;
        thesis += appendBlock;
        fs.writeFileSync(LIVING_MEDICAL_PATH, thesis, 'utf8');

        console.log(`[RecursiveConsolidation] ✅ Updated LivingMedicalThesis.md & archived ${medicalFiles.length} notes.`);
        return { updated: true, count: medicalFiles.length };
    }

    /**
     * Consolidate new story notes into the Master Manuscript and archive raw notes
     */
    consolidateStory(storyFiles) {
        if (!storyFiles.length) return null;

        console.log(`[RecursiveConsolidation] 📖 Polishing & Integrating ${storyFiles.length} story notes into Signal / Noise Manuscript...`);
        let manuscript = fs.existsSync(LIVING_MANUSCRIPT_PATH)
            ? fs.readFileSync(LIVING_MANUSCRIPT_PATH, 'utf8')
            : '# Signal / Noise — Master Manuscript\n\n';

        for (const item of storyFiles) {
            const lines = item.content.split('\n');
            const titleLine = lines.find(l => l.startsWith('# ') || l.startsWith('title:')) || item.filename;
            const title = titleLine.replace(/^#\s*/, '').replace(/^title:\s*["']?/, '').replace(/["']?$/, '').trim();

            const body = item.content.replace(/^---[\s\S]*?---/, '').replace(/^#\s+[^\n]+\n/, '').trim();
            if (body.length > 50) {
                manuscript += `\n\n### Note Refinement: ${title}\n${body.slice(0, 1000)}\n\n---\n`;
            }

            // Move processed note to archive
            const dest = path.join(ARCHIVE_DIR, 'sagas', item.filename);
            try {
                fs.renameSync(item.path, dest);
            } catch {
                try { fs.copyFileSync(item.path, dest); fs.unlinkSync(item.path); } catch {}
            }
        }

        fs.writeFileSync(LIVING_MANUSCRIPT_PATH, manuscript, 'utf8');
        console.log(`[RecursiveConsolidation] ✅ Updated SignalAndNoiseMasterManuscript.md & archived ${storyFiles.length} notes.`);
        return { updated: true, count: storyFiles.length };
    }

    /**
     * Run full consolidation tick
     */
    runConsolidationCycle() {
        const { medicalFiles, storyFiles } = this.scanVault();
        const medResult = this.consolidateMedical(medicalFiles);
        const storyResult = this.consolidateStory(storyFiles);
        return { medResult, storyResult };
    }
}

export default new RecursiveConsolidationEngine();
