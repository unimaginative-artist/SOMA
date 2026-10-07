import fs from 'node:fs';
import path from 'node:path';
import inferenceScheduler from '../core/InferenceScheduler.js';
import { ensureLocalSpecialistOllamaSidecar } from '../../core/LocalSpecialistOllamaSidecar.js';
import { critiqueGeneratedImage } from '../utils/LocalVisionFileAnalyzer.js';

const DEFAULT_LEDGER = path.join(process.cwd(), 'SOMA', 'social-media', 'creative-council-ledger.jsonl');

function clean(value = '', max = 1800) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clamp01(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(1, number));
}

function stringList(value, limit = 8, itemLimit = 160) {
    return (Array.isArray(value) ? value : [])
        .map(item => clean(item, itemLimit))
        .filter(Boolean)
        .slice(0, limit);
}

function extractJsonObject(text = '') {
    const raw = String(text || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] || raw;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

function significantTerms(text = '') {
    const stop = new Set(['about', 'after', 'before', 'create', 'draw', 'from', 'have', 'image', 'into', 'make', 'picture', 'render', 'that', 'their', 'there', 'this', 'with', 'without']);
    return [...new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [])]
        .filter(term => !stop.has(term))
        .slice(0, 24);
}

function preservesSubject(original, candidate) {
    const terms = significantTerms(original);
    if (!terms.length) return true;
    const normalized = String(candidate || '').toLowerCase();
    return terms.some(term => normalized.includes(term));
}

function mergePrepared(base, creative = {}) {
    return {
        ...base,
        prompt: clean(creative.prompt || base.prompt, 1800),
        alt: clean(creative.alt || base.alt, 1000),
        selectedPalette: stringList(creative.palette).length ? stringList(creative.palette) : (base.selectedPalette || []),
        creativeCouncil: creative.creativeCouncil || null,
    };
}

/**
 * AURORA is the language-side creative director; Bonsai remains the renderer.
 * This class never treats either model's output as authority. It validates the
 * JSON brief, preserves the user's subject, and records the vision-grounded
 * outcome so future training datasets contain evidence rather than vibes.
 */
export class CreativeImageCouncil {
    constructor({
        scheduler = inferenceScheduler,
        fetchImpl = globalThis.fetch,
        ensureSpecialist = ensureLocalSpecialistOllamaSidecar,
        visionCritic = critiqueGeneratedImage,
        ledgerFile = DEFAULT_LEDGER,
        clock = () => Date.now(),
    } = {}) {
        this.scheduler = scheduler;
        this.fetchImpl = fetchImpl;
        this.ensureSpecialist = ensureSpecialist;
        this.visionCritic = visionCritic;
        this.ledgerFile = ledgerFile;
        this.clock = clock;
        this.stats = { briefs: 0, fallbackBriefs: 0, reviews: 0, revisions: 0, failures: 0 };
    }

    isEnabled(options = {}) {
        if (options.creativeCouncil === false) return false;
        if (options.creativeCouncil === true) return true;
        return String(process.env.SOMA_CREATIVE_IMAGE_COUNCIL || 'true').toLowerCase() !== 'false';
    }

    getConfig() {
        return {
            enabled: this.isEnabled(),
            model: process.env.SOMA_CREATIVE_AURORA_MODEL || 'soma-aurora:v2',
            endpoint: process.env.SOMA_AURORA_ENDPOINT || process.env.SOMA_SPECIALIST_OLLAMA_ENDPOINT || 'http://127.0.0.1:11436',
            visionModel: process.env.SOMA_CREATIVE_VISION_MODEL || 'auto-fast',
            visionEndpoint: process.env.SOMA_CREATIVE_VISION_ENDPOINT || process.env.OLLAMA_HOST || process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
            maxRetries: Math.max(0, Number(process.env.SOMA_CREATIVE_IMAGE_MAX_RETRIES || 1)),
            ledgerFile: this.ledgerFile,
            stats: { ...this.stats },
        };
    }

    async _callAurora({ system, prompt, options = {}, phase }) {
        const endpoint = process.env.SOMA_AURORA_ENDPOINT || process.env.SOMA_SPECIALIST_OLLAMA_ENDPOINT || 'http://127.0.0.1:11436';
        const model = process.env.SOMA_CREATIVE_AURORA_MODEL || 'soma-aurora:v2';
        const timeoutMs = Math.max(5_000, Number(options.creativeTimeoutMs || process.env.SOMA_CREATIVE_AURORA_TIMEOUT_MS || 45_000));
        await this.ensureSpecialist?.();

        return this.scheduler.schedule({
            resource: 'gpu:local-models',
            priority: options.priority || (options.purpose === 'discord' ? 'human' : 'background'),
            source: `creative-image-council:${phase}`,
            traceId: options.traceId || null,
            requestId: options.requestId || null,
            model,
            endpoint,
            timeoutMs,
            preemptible: options.purpose !== 'discord',
        }, async admission => {
            const response = await this.fetchImpl(`${endpoint}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    stream: false,
                    format: 'json',
                    keep_alive: process.env.SOMA_CREATIVE_AURORA_KEEP_ALIVE || 0,
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: prompt },
                    ],
                    options: {
                        temperature: Number(options.creativeTemperature ?? 0.65),
                        num_predict: Number(options.creativeMaxTokens || 520),
                        num_ctx: Number(process.env.SOMA_CREATIVE_AURORA_CONTEXT || 4096),
                    },
                }),
                signal: admission.signal,
            });
            if (!response.ok) throw new Error(`AURORA returned HTTP ${response.status}`);
            const data = await response.json();
            const text = data?.message?.content || data?.response || '';
            const parsed = extractJsonObject(text);
            if (!parsed) throw new Error('AURORA did not return valid JSON');
            return { parsed, model, endpoint, traceId: admission.traceId };
        });
    }

    async prepare(options = {}, deterministicPrepared = {}) {
        if (!this.isEnabled(options)) return deterministicPrepared;
        const originalPrompt = clean(deterministicPrepared.originalPrompt || options.prompt, 1200);
        const safeFallback = {
            ...deterministicPrepared,
            creativeCouncil: { enabled: true, phase: 'brief', status: 'deterministic_fallback', model: null },
        };

        if (options.creativePromptOverride) {
            const prompt = clean(options.creativePromptOverride, 1800);
            if (prompt.length >= 20 && preservesSubject(originalPrompt, prompt)) {
                return mergePrepared(deterministicPrepared, {
                    prompt,
                    creativeCouncil: { enabled: true, phase: 'revision', status: 'accepted_override' },
                });
            }
        }

        const system = [
            'You are AURORA, SOMA\'s creative visual director.',
            'Transform the user\'s idea into a concrete image brief for a FLUX.2-style renderer.',
            'Preserve the requested subject and factual constraints. Do not invent claims about real people or events.',
            'Prefer observable scenes, coherent composition, material detail, lighting, camera placement, and emotional intent.',
            'Do not include readable text, watermarks, logos, UI, or generic computers unless explicitly requested.',
            'Return only JSON with keys: prompt, alt, palette, composition, lighting, style, constraints, rationale.',
            'prompt must be 40-180 words. rationale must be one short sentence.',
        ].join('\n');
        const request = JSON.stringify({
            userIdea: originalPrompt,
            deterministicBrief: clean(deterministicPrepared.prompt, 1600),
            visualRecipe: deterministicPrepared.visualRecipe || null,
            palette: deterministicPrepared.selectedPalette || [],
            motifs: deterministicPrepared.selectedMotifs || [],
            priorCritique: options.creativeRevisionContext || null,
        });

        try {
            const result = await this._callAurora({ system, prompt: request, options, phase: 'brief' });
            const candidate = clean(result.parsed.prompt, 1800);
            if (candidate.length < 40 || !preservesSubject(originalPrompt, candidate)) {
                throw new Error('AURORA brief failed subject-preservation validation');
            }
            this.stats.briefs++;
            return mergePrepared(deterministicPrepared, {
                prompt: candidate,
                alt: result.parsed.alt,
                palette: result.parsed.palette,
                creativeCouncil: {
                    enabled: true,
                    phase: 'brief',
                    status: 'aurora_directed',
                    model: result.model,
                    traceId: result.traceId,
                    composition: clean(result.parsed.composition, 300),
                    lighting: clean(result.parsed.lighting, 300),
                    style: clean(result.parsed.style, 240),
                    constraints: stringList(result.parsed.constraints, 10, 180),
                    rationale: clean(result.parsed.rationale, 300),
                },
            });
        } catch (error) {
            this.stats.fallbackBriefs++;
            this.stats.failures++;
            return {
                ...safeFallback,
                warnings: [...new Set([...(safeFallback.warnings || []), `aurora_brief_fallback:${clean(error.message, 180)}`])],
            };
        }
    }

    async reviewGenerated({ options = {}, prepared = {}, provider, imagePath, prompt }) {
        if (!this.isEnabled(options)) return { enabled: false, status: 'disabled', approved: true, retryRecommended: false };
        if (!imagePath || String(provider || '').startsWith('fallback')) {
            return { enabled: true, status: 'vision_skipped_for_fallback', approved: true, retryRecommended: false };
        }
        try {
            const critique = await this.visionCritic(imagePath, {
                requestedPrompt: prepared.originalPrompt || options.prompt,
                renderedPrompt: prompt,
                model: options.visionModel || process.env.SOMA_CREATIVE_VISION_MODEL || undefined,
                endpoint: options.visionEndpoint || process.env.SOMA_CREATIVE_VISION_ENDPOINT || undefined,
                priority: options.priority || (options.purpose === 'discord' ? 'human' : 'background'),
                traceId: options.traceId || null,
                requestId: options.requestId || null,
                keepAlive: 0,
            });
            const threshold = clamp01(options.creativeAlignmentThreshold ?? process.env.SOMA_CREATIVE_ALIGNMENT_THRESHOLD, options.publicPost ? 0.76 : 0.64);
            const alignmentScore = clamp01(critique.alignmentScore, critique.uncertain ? 0.4 : 0.65);
            const technicalScore = clamp01(critique.technicalScore, critique.uncertain ? 0.4 : 0.65);
            const violations = stringList(critique.violations, 10, 180);
            const retryRecommended = !critique.uncertain && (alignmentScore < threshold || violations.length > 0);
            this.stats.reviews++;
            return {
                enabled: true,
                status: critique.uncertain ? 'vision_uncertain' : 'vision_grounded',
                verified: !critique.uncertain,
                approved: !retryRecommended,
                retryRecommended,
                threshold,
                alignmentScore,
                technicalScore,
                subjectPresent: typeof critique.subjectPresent === 'boolean' ? critique.subjectPresent : null,
                summary: clean(critique.summary, 700),
                violations,
                revisionInstructions: clean(critique.revisionInstructions, 700),
                model: critique.model,
                latencyMs: critique.latencyMs,
            };
        } catch (error) {
            this.stats.failures++;
            return {
                enabled: true,
                status: 'vision_unavailable',
                verified: false,
                approved: true,
                retryRecommended: false,
                warning: clean(error.message, 240),
            };
        }
    }

    async revisePrompt({ options = {}, prepared = {}, prompt, review = {} }) {
        if (!review.retryRecommended) return null;
        const originalPrompt = clean(prepared.originalPrompt || options.prompt, 1200);
        const system = [
            'You are AURORA revising an image-generation brief after a vision model inspected the rendered pixels.',
            'Correct the reported mismatch while preserving the user\'s exact subject and intent.',
            'Return only JSON with keys: prompt, rationale.',
            'The prompt must be concrete, self-contained, and 40-180 words. Do not mention the critique or prior attempt.',
        ].join('\n');
        const request = JSON.stringify({
            userIdea: originalPrompt,
            priorPrompt: clean(prompt, 1800),
            observedImage: review.summary || '',
            violations: review.violations || [],
            revisionInstructions: review.revisionInstructions || '',
        });
        try {
            const result = await this._callAurora({ system, prompt: request, options, phase: 'revision' });
            const candidate = clean(result.parsed.prompt, 1800);
            if (candidate.length < 40 || !preservesSubject(originalPrompt, candidate)) {
                throw new Error('AURORA revision failed subject-preservation validation');
            }
            this.stats.revisions++;
            return candidate;
        } catch (error) {
            this.stats.failures++;
            const instruction = clean(review.revisionInstructions, 500);
            return instruction ? clean(`${prompt}. Revision requirement: ${instruction}`, 1800) : null;
        }
    }

    recordOutcome(outcome = {}) {
        try {
            fs.mkdirSync(path.dirname(this.ledgerFile), { recursive: true });
            const record = {
                type: 'creative_image_outcome',
                version: 1,
                createdAt: this.clock(),
                provider: outcome.provider || null,
                originalPrompt: clean(outcome.originalPrompt, 1200),
                finalPrompt: clean(outcome.finalPrompt, 1800),
                imagePath: outcome.imagePath || null,
                approved: outcome.approved === true,
                attempt: Number(outcome.attempt || 0),
                brief: outcome.brief || null,
                review: outcome.review || null,
            };
            fs.appendFileSync(this.ledgerFile, `${JSON.stringify(record)}\n`, 'utf8');
            return record;
        } catch (error) {
            return { type: 'creative_image_outcome', recorded: false, error: clean(error.message, 240) };
        }
    }

    recordHumanFeedback(feedback = {}) {
        const rating = Number(feedback.rating);
        if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
            throw new Error('Creative image rating must be a number from 1 to 5');
        }
        const rawImagePath = String(feedback.imagePath || '').trim();
        if (!rawImagePath) throw new Error('Rated image does not exist');
        const imagePath = path.normalize(rawImagePath);
        if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) throw new Error('Rated image does not exist');
        const record = {
            type: 'creative_image_human_feedback',
            version: 1,
            createdAt: this.clock(),
            imageId: feedback.imageId || null,
            imagePath,
            rating,
            approved: feedback.approved ?? rating >= 4,
            note: clean(feedback.note, 1000),
            tags: stringList(feedback.tags, 12, 80),
            trainingConsent: feedback.trainingConsent === true,
            source: feedback.source || 'operator',
        };
        fs.mkdirSync(path.dirname(this.ledgerFile), { recursive: true });
        fs.appendFileSync(this.ledgerFile, `${JSON.stringify(record)}\n`, 'utf8');
        return record;
    }

    trainingCandidates({ minRating = 4 } = {}) {
        if (!fs.existsSync(this.ledgerFile)) return [];
        const records = fs.readFileSync(this.ledgerFile, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => { try { return JSON.parse(line); } catch { return null; } })
            .filter(Boolean);
        const outcomes = new Map();
        const feedback = new Map();
        for (const record of records) {
            const key = record.imagePath ? path.normalize(record.imagePath).toLowerCase() : null;
            if (!key) continue;
            if (record.type === 'creative_image_outcome') outcomes.set(key, record);
            if (record.type === 'creative_image_human_feedback') feedback.set(key, record);
        }
        return [...outcomes.entries()].map(([key, outcome]) => {
            const human = feedback.get(key);
            if (!human || human.rating < minRating || human.approved !== true || human.trainingConsent !== true) return null;
            if (!fs.existsSync(outcome.imagePath)) return null;
            return {
                image: outcome.imagePath,
                caption: outcome.finalPrompt,
                originalPrompt: outcome.originalPrompt,
                rating: human.rating,
                feedback: human.note,
                tags: human.tags,
                automatedReview: outcome.review || null,
                source: 'soma-creative-council-human-approved',
            };
        }).filter(Boolean);
    }
}

export default new CreativeImageCouncil();
