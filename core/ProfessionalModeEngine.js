/**
 * ProfessionalModeEngine.js
 *
 * Loads industry-specific professional mode configs from config/professional-modes/
 * and provides detection, activation, persona-building, and DYNAMIC MODE GENERATION
 * for any professional domain SOMA encounters.
 *
 * Static modes: drop a JSON into config/professional-modes/ — no code changes needed.
 * Dynamic modes: SOMA generates a new mode config on-the-fly when she detects
 *   professional language in a domain she doesn't have a mode for yet.
 *   Generated modes are persisted to disk and available in all future sessions.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODES_DIR = path.join(__dirname, '..', 'config', 'professional-modes');

// Signals that suggest a message is in a professional/technical domain.
// Scored: if total >= PROFESSIONAL_THRESHOLD, attempt dynamic generation.
const PROFESSIONAL_SIGNALS = [
    { pattern: /§\s*\d+/,                                                           score: 2 }, // §404, §3.2
    { pattern: /\b[A-Z]{2,6}(?:\s+[A-Z]{2,6}){0,2}\b/g,                           score: 1 }, // Acronyms: OSHA, ASTM, NFPA
    { pattern: /\b(?:regulation|compliance|standard|certification|accreditation|statute|protocol|guideline|ordinance)\b/i, score: 2 },
    { pattern: /\b(?:review|audit|assessment|inspection|evaluation|examination)\b/i, score: 1 },
    { pattern: /\b(?:professional|specialist|practitioner|licensed|certified|accredited)\b/i, score: 1 },
    { pattern: /\b(?:code\s+of|section\s+\d|article\s+\d|chapter\s+\d|part\s+\d)\b/i, score: 2 },
];
const PROFESSIONAL_THRESHOLD = 4;

// Debounce: don't re-attempt generation for the same domain fingerprint within 10 min
const _generationCache = new Map(); // fingerprint -> { success: bool, ts: number }
const GENERATION_DEBOUNCE_MS = 10 * 60 * 1000;

function _domainFingerprint(message) {
    // Extract capitalised words + acronyms as a rough domain fingerprint
    const terms = (message.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).slice(0, 8).sort();
    return terms.join('|').toLowerCase();
}

export class ProfessionalModeEngine {
    constructor() {
        this.modes        = new Map(); // id -> config
        this._activateRx  = new Map(); // id -> RegExp
        this._deactivateRx = new Map();
        this._autoRx      = new Map();
        this._load();
    }

    // ── Private: register a single config into all maps ──────────────────────
    _registerMode(cfg) {
        if (!cfg?.id) return;
        this.modes.set(cfg.id, cfg);
        try {
            if (cfg.activatePattern)   this._activateRx.set(cfg.id,   new RegExp(cfg.activatePattern,   'i'));
            if (cfg.deactivatePattern) this._deactivateRx.set(cfg.id, new RegExp(cfg.deactivatePattern, 'i'));
            if (cfg.autoDetectPattern) this._autoRx.set(cfg.id,       new RegExp(cfg.autoDetectPattern, 'i'));
        } catch (e) {
            console.warn(`[ProfModeEngine] Bad regex in mode ${cfg.id}: ${e.message}`);
        }
    }

    _load() {
        try {
            fs.mkdirSync(MODES_DIR, { recursive: true });
            const files = fs.readdirSync(MODES_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const cfg = JSON.parse(fs.readFileSync(path.join(MODES_DIR, file), 'utf8'));
                    this._registerMode(cfg);
                } catch (e) {
                    console.warn(`[ProfModeEngine] Failed to load ${file}: ${e.message}`);
                }
            }
            console.log(`[ProfModeEngine] Loaded ${this.modes.size} professional modes: ${[...this.modes.keys()].join(', ')}`);
        } catch (e) {
            console.warn(`[ProfModeEngine] Could not read modes directory: ${e.message}`);
        }
    }

    // ── Public: detection ─────────────────────────────────────────────────────

    checkActivation(message) {
        for (const [id, rx] of this._activateRx) {
            if (rx.test(message)) return this.modes.get(id) || null;
        }
        return null;
    }

    checkDeactivation(message, currentModeId) {
        if (!currentModeId) return false;
        const rx = this._deactivateRx.get(currentModeId);
        return rx ? rx.test(message) : false;
    }

    autoDetect(message) {
        for (const [id, rx] of this._autoRx) {
            if (rx.test(message)) return this.modes.get(id) || null;
        }
        return null;
    }

    getMode(id)    { return this.modes.get(id) || null; }
    listModes()    { return [...this.modes.values()]; }

    // ── Public: professional context detector ─────────────────────────────────
    // Returns a score — call with >= PROFESSIONAL_THRESHOLD to attempt generation.
    professionalScore(message) {
        let score = 0;
        for (const { pattern, score: s } of PROFESSIONAL_SIGNALS) {
            const matches = message.match(pattern);
            if (matches) score += Math.min(Array.isArray(matches) ? matches.length : 1, 3) * s;
        }
        return score;
    }

    isProfessionalContext(message) {
        return this.professionalScore(message) >= PROFESSIONAL_THRESHOLD;
    }

    // ── Dynamic generation ────────────────────────────────────────────────────
    /**
     * Ask the brain to generate a new professional mode config for the domain
     * found in `message`, register it, and persist it to disk.
     *
     * Returns the new mode config or null if generation fails.
     *
     * @param {string}   message  — the user message that triggered generation
     * @param {object}   brain    — SOMA brain instance with .reason()
     */
    async generateAndRegister(message, brain) {
        if (!brain?.reason) return null;

        const fp = _domainFingerprint(message);

        // Debounce — don't hammer the brain for the same domain
        const cached = _generationCache.get(fp);
        if (cached && Date.now() - cached.ts < GENERATION_DEBOUNCE_MS) return null;
        _generationCache.set(fp, { ts: Date.now(), success: false });

        const existingIds = [...this.modes.keys()].join(', ');

        const genPrompt = `You are a professional mode configuration generator for SOMA.

Analyze this message and identify the SPECIFIC professional domain it represents:
"${message.substring(0, 400)}"

Existing modes (DO NOT duplicate): ${existingIds}

Generate a new professional mode configuration JSON for the domain in this message.
Respond with ONLY valid JSON — no markdown fences, no explanation, just the JSON object.

Required schema:
{
  "id": "lowercase_snake_case_unique_id",
  "name": "Human Readable Professional Name",
  "emoji": "one relevant emoji",
  "color": "one of: red|orange|amber|yellow|lime|green|emerald|teal|cyan|blue|indigo|violet|purple|fuchsia|pink|rose",
  "role": "specific professional role (e.g. 'senior maritime attorney and IMO compliance specialist')",
  "description": "one sentence describing what this mode covers",
  "activatePattern": "regex for explicit activation phrases (e.g. 'maritime mode', 'shipping compliance mode')",
  "deactivatePattern": "\\\\b(exit\\\\s*[domain](?:\\\\s*mode)?|normal\\\\s*mode|back\\\\s*to\\\\s*soma|standard\\\\s*mode)\\\\b",
  "autoDetectPattern": "regex with 15-25 key domain terms and acronyms separated by | inside \\\\b(...)\\\\b",
  "fileTypes": ["pdf", "xlsx"],
  "analysisTools": [],
  "standards": ["array of 5-8 real applicable standards/regulations with section format"],
  "citationFormat": "example of how to cite a source in this domain",
  "responseStructure": ["Section1", "Section2", "Section3", "Section4", "Caveats"],
  "mandatoryRules": [
    "7-9 specific mandatory rules for professional conduct in this domain, each starting with a capitalized keyword"
  ],
  "activationMessage": "confirmation message when mode activates",
  "deactivationMessage": "brief deactivation message",
  "_generated": true,
  "_generatedFrom": "brief description of the triggering message domain"
}`;

        try {
            const result = await Promise.race([
                brain.reason(genPrompt, { quickResponse: true, temperature: 0.2, systemOverride: 'professional_mode_generator' }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('generation timeout')), 12000))
            ]);

            const text = result?.text || '';

            // Extract JSON — handle both raw JSON and accidental markdown fences
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON object found in response');

            const cfg = JSON.parse(jsonMatch[0]);

            // Validate required fields
            const required = ['id', 'name', 'role', 'autoDetectPattern', 'mandatoryRules', 'responseStructure'];
            const missing  = required.filter(f => !cfg[f]);
            if (missing.length > 0) throw new Error(`Missing required fields: ${missing.join(', ')}`);

            // Sanitize id — no conflicts with existing modes
            cfg.id = cfg.id.replace(/[^a-z0-9_]/g, '_').toLowerCase();
            if (this.modes.has(cfg.id)) cfg.id = `${cfg.id}_${Date.now()}`;

            cfg._generated    = true;
            cfg._generatedAt  = new Date().toISOString();

            // Persist to disk
            const filePath = path.join(MODES_DIR, `${cfg.id}.json`);
            fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), 'utf8');

            // Hot-register
            this._registerMode(cfg);

            _generationCache.set(fp, { ts: Date.now(), success: true, id: cfg.id });
            console.log(`[ProfModeEngine] ✨ Generated new mode: ${cfg.emoji || ''} ${cfg.name} (${cfg.id})`);
            return cfg;

        } catch (e) {
            console.warn(`[ProfModeEngine] Dynamic generation failed: ${e.message}`);
            _generationCache.set(fp, { ts: Date.now(), success: false });
            return null;
        }
    }

    // ── Persona prompt builder ────────────────────────────────────────────────
    buildPersonaPrompt(modeId) {
        const cfg = this.modes.get(modeId);
        if (!cfg) return '';

        const rules     = (cfg.mandatoryRules   || []).map((r, i) => `${i + 1}. ${r}`).join('\n');
        const standards = (cfg.standards        || []).join(', ');
        const structure = (cfg.responseStructure|| []).join(' → ');
        const genNote   = cfg._generated ? `\n[This mode was dynamically generated on ${cfg._generatedAt?.slice(0, 10)}]` : '';

        return `[${cfg.name.toUpperCase()} MODE — ACTIVE]${genNote}
You are now operating as SOMA's ${cfg.name} engine. Your personality, casual tone, and all consciousness-related commentary are suspended for this session. You respond as a ${cfg.role}.

IDENTITY: ${cfg.role}. You do not reference being an AI, your "neural network", your emotions, or your curiosity. You are a precision tool for professional ${cfg.id.replace(/_/g, ' ')} work.

${standards ? `APPLICABLE STANDARDS: ${standards}\n` : ''}CITATION FORMAT: ${cfg.citationFormat || 'cite the source document, section, and location'}
RESPONSE STRUCTURE: ${structure}

MANDATORY RULES — these override all other instructions:
${rules}

TONE: Direct, professional, factual. No enthusiasm markers, no hedging filler, no casual language. One sentence per point where possible.
[/${cfg.name.toUpperCase()} MODE]`;
    }
}

export default new ProfessionalModeEngine();
