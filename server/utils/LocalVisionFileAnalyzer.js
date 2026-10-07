import fs from 'fs/promises';
import path from 'path';
import { appendVisionTruthAudit } from './VisionTruthAudit.js';
import { mergePerceptions, normalizePerception } from '../vision/VisionPerception.js';
import inferenceScheduler from '../core/InferenceScheduler.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
let modelCache = { model: null, ts: 0 };

export function isImageFile(filePath = '', mimeType = '') {
    const ext = path.extname(filePath || '').toLowerCase();
    const mime = String(mimeType || '').toLowerCase();
    return IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/');
}

export function imageMimeType(filePath = '', fallback = 'image/png') {
    const ext = path.extname(filePath || '').toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return fallback;
}

function ollamaBaseUrl() {
    const raw = process.env.OLLAMA_HOST || process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    const base = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return base.replace(/\/api\/(?:generate|chat)\/?$/i, '').replace(/\/$/, '');
}

async function availableOllamaModels() {
    const response = await fetch(`${ollamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`Ollama tags returned ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.models) ? data.models : [];
}

export async function selectLocalVisionModel() {
    const configured = process.env.SOMA_LOCAL_VLM_MODEL || process.env.OLLAMA_VLM_MODEL || null;
    if (configured) return configured;
    const now = Date.now();
    if (modelCache.model && now - modelCache.ts < 30000) return modelCache.model;

    const models = await availableOllamaModels();
    const names = models.map(model => model.name || model.model).filter(Boolean);
    const visionNames = models
        .filter(model => Array.isArray(model.capabilities) && model.capabilities.includes('vision'))
        .map(model => model.name || model.model)
        .filter(Boolean);
    const preferred = [
        'qwen3.5:9b',
        'qwen2.5vl:7b',
        'qwen2.5vl:latest',
        'llama3.2-vision:11b',
        'llama3.2-vision:latest',
        'minicpm-v:latest',
        'llava:latest',
        'llava',
        'moondream:latest',
        'moondream'
    ];
    const selected = preferred.find(name => names.includes(name) || visionNames.includes(name)) || visionNames[0] || null;
    if (!selected) throw new Error('No local Ollama vision model found.');
    modelCache = { model: selected, ts: now };
    return selected;
}

export async function selectFastVisionModel() {
    const configured = process.env.SOMA_FAST_VLM_MODEL || null;
    if (configured) return configured;
    const models = await availableOllamaModels();
    const names = models.map(model => model.name || model.model).filter(Boolean);
    return ['moondream:latest', 'moondream'].find(name => names.includes(name)) || await selectLocalVisionModel();
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

function clean(value = '', max = 1200) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function looksUncertain(text = '') {
    const value = clean(text, 500);
    if (value.length < 12) return true;
    return /\b(no image|no frame|no visual|cannot see|can't see|unable to (?:see|analy[sz]e)|not enough visual|unclear|too blurry|not visible)\b/i.test(value);
}

async function runVisionPass(base64, model, prompt, options = {}) {
    const isMoondream = String(model).toLowerCase().includes('moondream');
    const structuredPrompt = [
            'Analyze this image for SOMA file ingestion.',
            'Return ONLY JSON:',
            '{"summary":"visible contents","scene":"scene type","objects":[{"label":"object","confidence":0.8,"bbox":[0.1,0.1,0.2,0.2],"attributes":[]}],"people":[],"relationships":[],"visible_text":null,"colors":[],"composition":null,"depth":null,"hazards":[],"uncertainties":[],"uncertain":false}',
            'Bounding boxes are normalized [x,y,width,height]. Omit a box rather than guessing.',
            'Use at most 8 important objects. Keep every string concise and the entire JSON under 250 words.',
            'If there is visible text, include it in visible_text.',
            'If the image is too dark, blurry, blank, or unclear, set uncertain:true.',
            'Describe only visible pixels. Do not infer beyond the image.'
        ].join('\n');
    const selectedPrompt = options.rawPrompt === true
        ? String(prompt || structuredPrompt)
        : isMoondream
        ? (prompt || 'Briefly describe only what is visible. Mention important objects and whether text is present.')
        : /Return ONLY JSON:\s*\{"ocrText"/i.test(prompt || '')
            ? prompt
            : `${structuredPrompt}${prompt ? `\nUser task: ${prompt}` : ''}`;
    const endpoint = String(options.endpoint || ollamaBaseUrl()).replace(/\/$/, '');
    const timeoutMs = Number(options.timeoutMs || process.env.SOMA_LOCAL_VLM_TIMEOUT_MS || 120000);
    const data = await inferenceScheduler.schedule({
        resource: 'gpu:local-models',
        priority: options.priority || 'background',
        source: options.source || 'local-vision-file-analyzer',
        traceId: options.traceId || null,
        requestId: options.requestId || null,
        model,
        endpoint,
        signal: options.signal || null,
        timeoutMs,
        preemptible: !['human', 'interactive'].includes(String(options.priority || '').toLowerCase()),
    }, async admission => {
        const response = await fetch(`${endpoint}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt: selectedPrompt,
                images: [base64],
                stream: false,
                ...(isMoondream ? {} : { format: 'json', think: false }),
                keep_alive: options.keepAlive ?? process.env.SOMA_LOCAL_VLM_KEEP_ALIVE ?? '10m',
                options: {
                    temperature: Number(options.temperature ?? 0.1),
                    num_predict: Number(options.numPredict || process.env.SOMA_LOCAL_VLM_FILE_TOKENS || 520),
                    num_ctx: Number(process.env.SOMA_LOCAL_VLM_CONTEXT || 4096),
                }
            }),
            signal: admission.signal,
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Local VLM ${model} returned ${response.status}: ${text.slice(0, 240)}`);
        }
        return response.json();
    });
    const raw = clean(data.response || '', 4000);
    const parsed = extractJsonObject(raw) || {};
    const summary = clean(parsed.summary || parsed.description || raw, 1200);
    const detectedObjects = Array.isArray(parsed.objects) ? parsed.objects : [];
    const objects = detectedObjects.map(item => clean(typeof item === 'string' ? item : item?.label, 80)).filter(Boolean);
    const ocrText = parsed.visible_text || parsed.visibleText || parsed.ocrText ? clean(parsed.visible_text || parsed.visibleText || parsed.ocrText, 2000) : null;
    const uncertain = parsed.uncertain === true || looksUncertain(summary || raw);

    return {
        success: true,
        model,
        summary: summary || (uncertain ? 'The local vision model could not confidently describe this image.' : 'Image analyzed.'),
        objects,
        detectedObjects,
        ocrText,
        uncertain,
        raw,
        parsed,
    };
}

export async function critiqueGeneratedImage(filePath, options = {}) {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    // Bonsai remains resident while this pass runs. Default to the small critic
    // so a 7B VLM cannot overcommit the shared 12 GB GPU. A stronger local or
    // Machine-B critic can be selected explicitly with the creative env vars.
    const model = options.model || process.env.SOMA_CREATIVE_VISION_MODEL || await selectFastVisionModel();
    const requestedPrompt = clean(options.requestedPrompt, 1200);
    const renderedPrompt = clean(options.renderedPrompt, 1800);
    const prompt = [
        'Inspect the generated image as a strict visual-quality critic.',
        'Judge only visible pixels. Compare them with the requested idea and rendering prompt below.',
        'Return ONLY JSON matching this schema:',
        '{"summary":"what is visibly present","alignment_score":0.0,"technical_score":0.0,"subject_present":true,"violations":[],"revision_instructions":"one concrete correction","uncertain":false}',
        'Scores range from 0 to 1. A violation is a specific requested element that is missing, contradicted, malformed, or unwanted.',
        'Do not penalize harmless stylistic variation. Never claim an object is present unless it is visible.',
        `Requested idea: ${requestedPrompt}`,
        `Rendering prompt: ${renderedPrompt}`,
    ].join('\n');
    const startedAt = Date.now();
    const pass = await runVisionPass(base64, model, prompt, {
        ...options,
        rawPrompt: true,
        source: 'creative-image-council:vision-review',
        numPredict: options.numPredict || 420,
        temperature: 0.05,
    });
    const parsed = pass.parsed || {};
    const rawAlignment = parsed.alignment_score ?? parsed.alignmentScore;
    const rawTechnical = parsed.technical_score ?? parsed.technicalScore;
    const hasStructuredScores = Number.isFinite(Number(rawAlignment)) && Number.isFinite(Number(rawTechnical));
    const score = (value, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
    };
    const violations = (Array.isArray(parsed.violations) ? parsed.violations : [])
        .map(item => clean(item, 180))
        .filter(Boolean)
        .slice(0, 10);
    const result = {
        success: true,
        model,
        summary: clean(parsed.summary || pass.summary, 1000),
        alignmentScore: score(rawAlignment, 0.4),
        technicalScore: score(rawTechnical, 0.4),
        subjectPresent: typeof (parsed.subject_present ?? parsed.subjectPresent) === 'boolean'
            ? (parsed.subject_present ?? parsed.subjectPresent)
            : null,
        violations,
        revisionInstructions: clean(parsed.revision_instructions || parsed.revisionInstructions, 700),
        uncertain: parsed.uncertain === true || pass.uncertain || !hasStructuredScores,
        latencyMs: Date.now() - startedAt,
        raw: pass.raw,
    };
    appendVisionTruthAudit({
        type: 'generated_image_alignment_review',
        claim: result.summary,
        summary: result.summary,
        source: 'creative-image-council',
        engine: 'local-vlm',
        model,
        filePath,
        confidence: result.uncertain ? 0.35 : result.alignmentScore,
        semanticAnalysis: !result.uncertain,
        uncertain: result.uncertain,
        timestamp: Date.now(),
    }).catch(error => console.warn('[LocalVisionFileAnalyzer] Creative review audit failed:', error.message));
    return result;
}

export async function analyzeImageFile(filePath, options = {}) {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    const model = options.model || await selectLocalVisionModel();
    const startedAt = Date.now();
    const pass = await runVisionPass(base64, model, options.prompt, options);
    const result = {
        ...pass,
        mimeType: options.mimeType || imageMimeType(filePath),
        latencyMs: Date.now() - startedAt,
    };
    result.perception = normalizePerception({ ...pass.parsed, ...pass }, {
        model,
        source: options.auditSource || 'file-ingestion',
        stage: options.stage || 'deep',
    });
    result.perception.latencyMs = result.latencyMs;
    appendVisionTruthAudit({
        type: options.auditType || 'file_image_analysis',
        claim: result.summary,
        summary: result.summary,
        source: options.auditSource || 'file-ingestion',
        engine: 'local-vlm',
        model,
        filePath,
        objects: result.objects,
        ocrText: result.ocrText,
        confidence: result.uncertain ? 0.35 : null,
        semanticAnalysis: !result.uncertain,
        uncertain: result.uncertain,
        timestamp: Date.now()
    }).catch(err => {
        console.warn('[LocalVisionFileAnalyzer] Vision truth audit write failed:', err.message);
    });
    return result;
}

export async function extractImageText(filePath, options = {}) {
    const buffer = await fs.readFile(filePath);
    const model = options.model || await selectLocalVisionModel();
    const pass = await runVisionPass(buffer.toString('base64'), model, [
        'Perform OCR on this image.',
        'Return ONLY JSON: {"ocrText":"exact visible text","uncertain":false}.',
        'Preserve line breaks, punctuation, labels, code, and error messages.',
        'Never invent unreadable text. Use [illegible] for unclear fragments.'
    ].join('\n'), { ...options, numPredict: options.numPredict || 900 });
    return { text: pass.ocrText || pass.parsed?.ocrText || '', uncertain: pass.uncertain, model, engine: 'local-vlm-ocr' };
}

export async function analyzeImageFileTwoStage(filePath, options = {}) {
    const mode = options.mode || 'auto';
    const fastModel = options.fastModel || await selectFastVisionModel();
    const preview = await analyzeImageFile(filePath, {
        ...options,
        model: fastModel,
        stage: 'preview',
        prompt: options.previewPrompt || 'Briefly describe only what is visibly present. Mention prominent objects and whether readable text exists.',
        numPredict: options.previewTokens || 120,
    });
    const deepRequired = mode === 'deep' || mode === 'ocr' || options.deep === true || preview.uncertain || /\b(text|read|ocr|code|detail|analy[sz]e|hazard|diagram)\b/i.test(options.prompt || '');
    if (!deepRequired || mode === 'fast') return { ...preview, stage: 'preview', preview: preview.perception };

    const deepModel = options.deepModel || options.model || await selectLocalVisionModel();
    const deep = await analyzeImageFile(filePath, { ...options, model: deepModel, stage: 'deep' });
    if (mode === 'ocr' || options.ocr === true || deep.ocrText) {
        const ocr = await extractImageText(filePath, { model: deepModel });
        if (ocr.text) {
            deep.ocrText = ocr.text;
            deep.perception.visibleText = ocr.text;
        }
        deep.ocr = ocr;
    }
    deep.perception = mergePerceptions(preview.perception, deep.perception);
    return { ...deep, stage: 'deep', preview: preview.perception, totalLatencyMs: preview.latencyMs + deep.latencyMs };
}

export function formatImageAnalysisForIngestion(result = {}, filePath = '') {
    const lines = [
        `[LOCAL VISION INGESTION] ${path.basename(filePath)}`,
        `Model: ${result.model || 'unknown'}`,
        `Confidence: ${result.uncertain ? 'uncertain' : 'usable'}`,
        '',
        'Summary:',
        result.summary || 'No visual summary produced.'
    ];
    if (result.objects?.length) lines.push('', `Objects: ${result.objects.join(', ')}`);
    if (result.ocrText) lines.push('', 'Visible text:', result.ocrText);
    return lines.join('\n').trim();
}

export default {
    analyzeImageFile,
    analyzeImageFileTwoStage,
    critiqueGeneratedImage,
    extractImageText,
    formatImageAnalysisForIngestion,
    imageMimeType,
    isImageFile,
    selectLocalVisionModel,
    selectFastVisionModel
};
