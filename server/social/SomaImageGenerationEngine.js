import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import sharp from 'sharp';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import socialImageLibrary from './SocialImageLibrary.js';
import somaArtDirector from './SomaArtDirector.js';
import creativeImageCouncil from './CreativeImageCouncil.js';
import { Poseidon } from '../../core/Poseidon.js';
import inferenceScheduler from '../core/InferenceScheduler.js';

const execAsync = promisify(exec);
const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const SOCIAL_DIR = path.join(SOMA_DIR, 'social-media');
const IMAGE_DIR = path.join(SOCIAL_DIR, 'images');
const PHOTOS_DIR = path.join(SOMA_DIR, 'photos', 'generated');
const poseidon = new Poseidon({ threshold: 0.75 });
let bonsaiStartupPromise = null;

function ensureDirs() {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

function slugify(text = 'soma-image') {
    return String(text).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'soma-image';
}

function crc32(buf) {
    let crc = ~0;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
    const typeBuf = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

function writeFallbackPng({ prompt, outputPath, width = 768, height = 768 }) {
    const hash = crypto.createHash('sha256').update(prompt).digest();
    const raw = Buffer.alloc((width * 4 + 1) * height);
    const palettes = [
        { bg1: [235, 229, 216], bg2: [94, 83, 72], accent: [176, 118, 66] },
        { bg1: [219, 229, 226], bg2: [52, 76, 84], accent: [168, 98, 82] },
        { bg1: [229, 224, 208], bg2: [76, 68, 56], accent: [88, 117, 91] },
        { bg1: [224, 228, 232], bg2: [64, 72, 83], accent: [180, 141, 72] },
        { bg1: [232, 222, 218], bg2: [84, 61, 58], accent: [74, 106, 128] },
        { bg1: [218, 225, 211], bg2: [58, 76, 55], accent: [156, 118, 65] },
    ];
    const palette = palettes[hash[0] % palettes.length];
    const c1 = palette.bg1;
    const c2 = palette.bg2;
    const accent = palette.accent;
    const nodes = Array.from({ length: 9 }, (_, i) => ({
        x: Math.floor((hash[(i * 2) % hash.length] / 255) * (width - 140)) + 70,
        y: Math.floor((hash[(i * 2 + 1) % hash.length] / 255) * (height - 140)) + 70,
        r: 18 + (hash[(i + 9) % hash.length] % 46),
    }));

    const put = (x, y, rgba) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const idx = y * (width * 4 + 1) + 1 + x * 4;
        raw[idx] = rgba[0]; raw[idx + 1] = rgba[1]; raw[idx + 2] = rgba[2]; raw[idx + 3] = rgba[3] ?? 255;
    };
    const blend = (x, y, rgba, alpha = 0.5) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const idx = y * (width * 4 + 1) + 1 + x * 4;
        raw[idx] = Math.round(raw[idx] * (1 - alpha) + rgba[0] * alpha);
        raw[idx + 1] = Math.round(raw[idx + 1] * (1 - alpha) + rgba[1] * alpha);
        raw[idx + 2] = Math.round(raw[idx + 2] * (1 - alpha) + rgba[2] * alpha);
        raw[idx + 3] = 255;
    };
    const line = (a, b, rgba, alpha = 0.35) => {
        const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), 1);
        for (let i = 0; i <= steps; i++) {
            const x = Math.round(a.x + (b.x - a.x) * i / steps);
            const y = Math.round(a.y + (b.y - a.y) * i / steps);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) blend(x + dx, y + dy, rgba, alpha);
        }
    };
    const circle = (cx, cy, r, rgba) => {
        for (let y = cy - r; y <= cy + r; y++) {
            for (let x = cx - r; x <= cx + r; x++) {
                const d = Math.hypot(x - cx, y - cy);
                if (d <= r) blend(x, y, rgba, Math.max(0.15, 1 - d / r));
            }
        }
    };

    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        for (let x = 0; x < width; x++) {
            const t = (x / width * 0.55) + (y / height * 0.45);
            const vignette = 1 - Math.min(0.48, Math.hypot(x - width / 2, y - height / 2) / (width * 0.9));
            put(x, y, [
                Math.round((c1[0] * (1 - t) + c2[0] * t) * vignette),
                Math.round((c1[1] * (1 - t) + c2[1] * t) * vignette),
                Math.round((c1[2] * (1 - t) + c2[2] * t) * vignette),
                255,
            ]);
        }
    }

    for (let i = 0; i < nodes.length - 1; i++) {
        if (i % 2 === 0) line(nodes[i], nodes[(i + 1 + (hash[i] % 3)) % nodes.length], accent, 0.08);
    }
    nodes.forEach((n, i) => {
        const color = i % 3 === 0
            ? [Math.min(255, accent[0] + 28), Math.min(255, accent[1] + 22), Math.min(255, accent[2] + 18)]
            : accent;
        circle(n.x, n.y, n.r, color);
    });

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND'),
    ]);
    fs.writeFileSync(outputPath, png);
}

function evaluatePrompt(prompt) {
    const text = String(prompt || '').trim();
    if (text.length < 4) return { ok: false, risk: 1, reason: 'Prompt is too short' };
    const blocked = /\b(CSAM|minor sexual|child sexual|revenge porn|graphic gore|real private person nude)\b/i.test(text);
    if (blocked) return { ok: false, risk: 1, reason: 'Prompt violates image generation safety rules' };
    const professionalRisk = /\b(diagnose|medical advice|financial advice|legal advice|guaranteed profit)\b/i.test(text);
    return { ok: true, risk: professionalRisk ? 0.45 : 0.12, reason: professionalRisk ? 'Allowed, but should not be framed as professional advice' : 'Low-risk creative image request' };
}

async function copyOrDecodeGenerated(result, outputPath) {
    const imagePath = result?.imagePath || result?.path || result?.file || result?.output;
    if (imagePath && fs.existsSync(imagePath)) {
        fs.copyFileSync(imagePath, outputPath);
        return outputPath;
    }
    const base64 = result?.base64 || result?.imageBase64;
    if (base64) {
        fs.writeFileSync(outputPath, Buffer.from(String(base64).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        return outputPath;
    }
    throw new Error('Provider did not return imagePath/path/file/output or base64');
}

async function optimizePngForUpload(filePath, maxBytes) {
    const before = fs.statSync(filePath).size;
    if (before <= maxBytes || path.extname(filePath).toLowerCase() !== '.png') {
        return { optimized: false, before, after: before };
    }

    let best = fs.readFileSync(filePath);
    for (const colours of [256, 192, 128]) {
        const candidate = await sharp(filePath)
            .rotate()
            .png({ compressionLevel: 9, effort: 10, palette: true, colours, dither: 0.9 })
            .toBuffer();
        if (candidate.length < best.length) best = candidate;
        if (best.length <= maxBytes) break;
    }
    if (best.length < before) fs.writeFileSync(filePath, best);
    return { optimized: best.length < before, before, after: fs.statSync(filePath).size };
}

function isLocalBonsaiEndpoint(endpoint) {
    try {
        const url = new URL(endpoint);
        return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    } catch {
        return false;
    }
}

async function waitForBonsaiHealth(endpoint, timeoutMs = 240000) {
    const url = new URL(endpoint);
    const healthUrl = `${url.protocol}//${url.host}/backends`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
            if (response.ok && (await response.json())?.healthy === true) return true;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`Bonsai did not become healthy within ${Math.round(timeoutMs / 1000)} seconds`);
}

async function ensureLocalBonsai(endpoint, timeoutMs = Number(process.env.BONSAI_STARTUP_TIMEOUT_MS || 45000)) {
    if (!isLocalBonsaiEndpoint(endpoint) || process.env.SOMA_BONSAI_AUTOSTART === 'false') return false;
    if (!bonsaiStartupPromise) {
        bonsaiStartupPromise = (async () => {
            const demoDir = path.join(process.cwd(), 'research', 'Bonsai-Image-Demo');
            const port = new URL(endpoint).port || '8000';
            const variant = process.env.BONSAI_VARIANT || 'ternary';
            const modelRoot = path.join(demoDir, 'models', `bonsai-image-4B-${variant}-gemlite`);
            const transformerRoot = variantName => {
                const root = path.join(demoDir, 'models', `bonsai-image-4B-${variantName}-gemlite`);
                if (!fs.existsSync(root)) return path.join(root, `transformer-gemlite-int${variantName === 'binary' ? '1' : '2'}`);
                const hit = fs.readdirSync(root, { withFileTypes: true }).find(entry => entry.isDirectory() && entry.name.startsWith('transformer-gemlite-'));
                return hit ? path.join(root, hit.name) : path.join(root, `transformer-gemlite-int${variantName === 'binary' ? '1' : '2'}`);
            };
            const python = path.join(demoDir, '.venv', 'Scripts', 'python.exe');
            if (!fs.existsSync(python)) throw new Error(`Bonsai Python environment is missing: ${python}`);
            if (!fs.existsSync(modelRoot)) throw new Error(`Bonsai model is missing: ${modelRoot}`);
            const logDir = path.join(demoDir, '.serve-logs');
            fs.mkdirSync(logDir, { recursive: true });
            const stdoutFd = fs.openSync(path.join(logDir, 'backend.log'), 'a');
            const stderrFd = fs.openSync(path.join(logDir, 'backend.log.err'), 'a');
            const child = spawn(python, ['-m', 'uvicorn', 'scripts.local_backend:app', '--port', String(port)], {
                cwd: demoDir,
                detached: true,
                windowsHide: true,
                stdio: ['ignore', stdoutFd, stderrFd],
                env: {
                    ...process.env,
                    MFLUX_STUDIO_GPU_DEFAULT_BACKEND: `bonsai-${variant}-gemlite`,
                    MFLUX_STUDIO_GPU_TEXT_ENCODER_PATH: path.join(modelRoot, 'text_encoder-hqq-4bit'),
                    MFLUX_STUDIO_GPU_VAE_PATH: path.join(modelRoot, 'vae'),
                    MFLUX_STUDIO_GPU_TOKENIZER_PATH: path.join(modelRoot, 'text_encoder-hqq-4bit', 'tokenizer'),
                    MFLUX_STUDIO_GPU_TERNARY_TRANSFORMER_PATH: transformerRoot('ternary'),
                    MFLUX_STUDIO_GPU_BINARY_TRANSFORMER_PATH: transformerRoot('binary'),
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUTF8: '1',
                },
            });
            fs.closeSync(stdoutFd);
            fs.closeSync(stderrFd);
            child.unref();
            const exited = new Promise((_, reject) => {
                child.once('error', reject);
                child.once('exit', code => reject(new Error(`Bonsai backend exited with code ${code}; see ${path.join(logDir, 'backend.log.err')}`)));
            });
            await Promise.race([waitForBonsaiHealth(endpoint, timeoutMs), exited]);
            return true;
        })().finally(() => {
            bonsaiStartupPromise = null;
        });
    }
    return bonsaiStartupPromise;
}

async function postToImageEndpoint(endpoint, payload, options = {}) {
    const request = () => fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: options.signal || AbortSignal.timeout(Number(options.requestTimeoutMs || process.env.SOMA_IMAGE_REQUEST_TIMEOUT_MS || 30000)),
    });
    try {
        return await request();
    } catch (error) {
        if (options.signal?.aborted) throw (options.signal.reason instanceof Error ? options.signal.reason : error);
        if (!isLocalBonsaiEndpoint(endpoint)) throw error;
        const started = await ensureLocalBonsai(endpoint, options.startupTimeoutMs);
        if (!started) throw error;
        return request();
    }
}

export class SomaImageGenerationEngine {
    async ensureReady(options = {}) {
        const endpoint = options.endpoint || process.env.BONSAI_IMAGE_ENDPOINT || process.env.SOMA_IMAGE_ENDPOINT;
        if (!endpoint) return { ok: false, ready: false, reason: 'image_endpoint_not_configured' };
        const url = new URL(endpoint);
        const healthUrl = `${url.protocol}//${url.host}/backends`;
        const probe = async () => {
            const response = await fetch(healthUrl, {
                signal: AbortSignal.timeout(Number(options.probeTimeoutMs || 5000)),
            });
            if (!response.ok) throw new Error(`Bonsai health returned ${response.status}`);
            const status = await response.json();
            if (status?.healthy !== true) throw new Error(status?.reason || 'Bonsai reported unhealthy');
            return status;
        };
        try {
            const status = await probe();
            return { ok: true, ready: true, started: false, endpoint, status };
        } catch (initialError) {
            if (options.autostart === false) {
                return { ok: false, ready: false, endpoint, reason: initialError.message };
            }
            if (!isLocalBonsaiEndpoint(endpoint)) {
                return { ok: false, ready: false, endpoint, reason: initialError.message };
            }
            try {
                const started = await ensureLocalBonsai(endpoint, Number(options.startupTimeoutMs || process.env.BONSAI_STARTUP_TIMEOUT_MS || 90000));
                if (!started) return { ok: false, ready: false, endpoint, reason: 'bonsai_autostart_disabled' };
                const status = await probe();
                return { ok: true, ready: true, started: true, endpoint, status };
            } catch (error) {
                return { ok: false, ready: false, endpoint, reason: error.message };
            }
        }
    }

    getStatus() {
        return {
            ok: true,
            defaultProvider: process.env.SOMA_IMAGE_PROVIDER || 'auto',
            providers: {
                bonsaiEndpoint: Boolean(process.env.BONSAI_IMAGE_ENDPOINT || process.env.SOMA_IMAGE_ENDPOINT),
                command: Boolean(process.env.SOMA_IMAGE_COMMAND || process.env.BONSAI_IMAGE_COMMAND),
                fallback: true,
            },
            artDirector: somaArtDirector.getStatus(),
            creativeCouncil: creativeImageCouncil.getConfig(),
            imageDir: IMAGE_DIR,
            notes: [
                'Set BONSAI_IMAGE_ENDPOINT or SOMA_IMAGE_ENDPOINT for an HTTP image engine.',
                'Set BONSAI_IMAGE_COMMAND or SOMA_IMAGE_COMMAND for a local script/CLI. Use {prompt} and {output} placeholders or read SOMA_IMAGE_PROMPT/SOMA_IMAGE_OUTPUT env vars.',
                'Fallback creates a deterministic SOMA visual PNG so Bluesky image posting can be tested without a model.',
            ],
        };
    }

    async generate(options = {}) {
        ensureDirs();
        let prepared = options.skipArtDirector
            ? {
                ok: true,
                originalPrompt: String(options.prompt || '').trim(),
                prompt: String(options.prompt || '').trim(),
                alt: String(options.alt || options.imageAlt || ''),
                tags: Array.isArray(options.tags) ? options.tags : [],
                warnings: [],
                failures: [],
                promptScore: 0.7,
            }
            : somaArtDirector.prepare(options);
        const useCreativeCouncil = options.creativeCouncil === true
            || (!options.skipArtDirector && creativeImageCouncil.isEnabled(options));
        if (useCreativeCouncil) {
            prepared = await creativeImageCouncil.prepare(options, prepared);
        }
        if (!prepared.ok && (options.publicPost || options.strictArtDirector)) {
            throw new Error(`Art Director rejected image prompt: ${prepared.failures.join(', ')}`);
        }

        const prompt = String(prepared.prompt || options.prompt || '').trim();
        const safety = evaluatePrompt(prompt);
        if (!safety.ok) throw new Error(safety.reason);

        const width = Math.min(Math.max(Number(options.width || 768), 256), 1024);
        const height = Math.min(Math.max(Number(options.height || 768), 256), 1024);
        const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const outputPath = path.join(IMAGE_DIR, `${slugify(options.title || prompt)}-${id}.png`);
        const provider = String(options.provider || process.env.SOMA_IMAGE_PROVIDER || 'auto').toLowerCase();
        const requireRealRenderer = options.requireRealRenderer === true;
        const endpoint = process.env.BONSAI_IMAGE_ENDPOINT || process.env.SOMA_IMAGE_ENDPOINT;
        const command = process.env.BONSAI_IMAGE_COMMAND || process.env.SOMA_IMAGE_COMMAND;
        let usedProvider = 'fallback-soma-card';
        let providerDetail = null;

        if ((provider === 'auto' || provider === 'bonsai' || provider === 'http') && endpoint) {
            try {
              const startupTimeoutMs = Number(options.startupTimeoutMs || process.env.BONSAI_STARTUP_TIMEOUT_MS || 90000);
              const requestTimeoutMs = Number(options.requestTimeoutMs || process.env.SOMA_IMAGE_REQUEST_TIMEOUT_MS || 120000);
              const response = await inferenceScheduler.schedule({
                resource: 'gpu:local-models',
                priority: options.priority || (options.purpose === 'discord' ? 'human' : 'background'),
                source: 'bonsai-image-render',
                traceId: options.traceId || null,
                requestId: options.requestId || null,
                model: options.backend || process.env.BONSAI_IMAGE_BACKEND || 'bonsai',
                endpoint,
                timeoutMs: startupTimeoutMs + requestTimeoutMs + 5000,
                preemptible: options.purpose !== 'discord',
              }, admission => postToImageEndpoint(endpoint, {
                  prompt,
                  width,
                  height,
                  steps: Number(options.steps || process.env.BONSAI_IMAGE_STEPS || 4),
                  seed: options.seed,
                  backend: options.backend || process.env.BONSAI_IMAGE_BACKEND || undefined,
                  outputPath,
                  purpose: options.purpose || 'social',
                }, {
                  startupTimeoutMs,
                  requestTimeoutMs,
                  signal: admission.signal,
                }));
              if (!response.ok) throw new Error(`Image endpoint failed: ${response.status} ${await response.text()}`);
              const contentType = response.headers.get('content-type') || '';
              if (contentType.startsWith('image/')) fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
              else await copyOrDecodeGenerated(await response.json(), outputPath);
              usedProvider = provider === 'bonsai' || process.env.SOMA_IMAGE_PROVIDER === 'bonsai' || endpoint.includes('bonsai') ? 'bonsai-http' : 'http';
              providerDetail = endpoint;
            } catch (error) {
              if (error?.code?.startsWith?.('INFERENCE_') || error?.name === 'AbortError') throw error;
              if (provider !== 'auto' || requireRealRenderer) throw error;
              providerDetail = `HTTP provider unavailable; safe fallback used: ${error.message}`;
              writeFallbackPng({ prompt, outputPath, width, height });
            }
        } else if ((provider === 'auto' || provider === 'bonsai' || provider === 'command') && command) {
            const rendered = command
                .replaceAll('{prompt}', JSON.stringify(prompt))
                .replaceAll('{output}', JSON.stringify(outputPath))
                .replaceAll('{width}', String(width))
                .replaceAll('{height}', String(height));
            await inferenceScheduler.schedule({
                resource: 'gpu:local-models',
                priority: options.priority || (options.purpose === 'discord' ? 'human' : 'background'),
                source: 'bonsai-image-command',
                traceId: options.traceId || null,
                requestId: options.requestId || null,
                model: 'bonsai-command',
                timeoutMs: Number(process.env.SOMA_IMAGE_TIMEOUT_MS || 180000),
                preemptible: options.purpose !== 'discord',
            }, admission => execAsync(rendered, {
                    timeout: Number(process.env.SOMA_IMAGE_TIMEOUT_MS || 180000),
                    signal: admission.signal,
                    env: {
                        ...process.env,
                        SOMA_IMAGE_PROMPT: prompt,
                        SOMA_IMAGE_OUTPUT: outputPath,
                        SOMA_IMAGE_WIDTH: String(width),
                        SOMA_IMAGE_HEIGHT: String(height),
                    },
                }));
            if (!fs.existsSync(outputPath)) throw new Error(`Image command completed but did not create ${outputPath}`);
            usedProvider = command.toLowerCase().includes('bonsai') ? 'bonsai-command' : 'command';
            providerDetail = command;
        } else {
            if (requireRealRenderer) throw new Error('No real image renderer is configured; synthetic fallback is disabled for this request.');
            writeFallbackPng({ prompt, outputPath, width, height });
        }

        const purpose = String(options.purpose || 'social').toLowerCase();
        const maxBytes = Number(options.maxBytes || (
            purpose === 'discord'
                ? 8_000_000
                : (options.publicPost ? 1_000_000 : 5_000_000)
        ));
        const optimization = await optimizePngForUpload(outputPath, maxBytes);
        const stat = fs.statSync(outputPath);
        const photoPath = path.join(PHOTOS_DIR, path.basename(outputPath));
        try {
            if (path.normalize(photoPath) !== path.normalize(outputPath)) fs.copyFileSync(outputPath, photoPath);
        } catch {}
        const verification = await poseidon.verify(`Generated image file exists and is upload sized for ${purpose}`, {
            falsificationTest: `File exists, is non-empty, and is under the ${Math.round(maxBytes / 1_000_000)}MB ${purpose} upload limit`,
            testResult: stat.isFile() && stat.size > 0 && stat.size <= maxBytes,
        });
        if (verification.state !== 'TRUE') {
            try { fs.unlinkSync(outputPath); } catch {}
            try { fs.unlinkSync(photoPath); } catch {}
            throw new Error(`Generated image failed Poseidon gate: ${verification.reason}`);
        }

        const alt = String(prepared.alt || options.alt || options.imageAlt || `SOMA generated visual: ${prompt}`).slice(0, 1000);
        const artDirector = await somaArtDirector.reviewGenerated({
            options,
            prepared,
            provider: usedProvider,
            imagePath: outputPath,
            size: stat.size,
            prompt,
            alt,
        });
        const creativeCouncil = useCreativeCouncil
            ? await creativeImageCouncil.reviewGenerated({ options, prepared, provider: usedProvider, imagePath: outputPath, prompt })
            : { enabled: false, status: 'disabled', approved: true, retryRecommended: false };
        const retryableFailures = new Set(['perceptual_duplicate_of_recent_image']);
        const hasOnlyRetryableFailures = (artDirector.failures || []).every(failure => retryableFailures.has(failure));
        const retryRequested = artDirector.critique?.retryRecommended
            || artDirector.perceptualSimilarity?.duplicate
            || artDirector.perceptualSimilarity?.nearDuplicate
            || creativeCouncil.retryRecommended;
        const maxRetries = Math.max(0, Number(
            options.maxArtDirectorRetries
            ?? options.maxCreativeRetries
            ?? process.env.SOMA_CREATIVE_IMAGE_MAX_RETRIES
            ?? process.env.SOMA_IMAGE_MAX_ART_RETRIES
            ?? (options.publicPost ? 2 : 1)
        ));
        const attempt = Math.max(0, Number(options._artDirectorAttempt) || 0);
        if (retryRequested && attempt < maxRetries && hasOnlyRetryableFailures) {
            const creativePromptOverride = creativeCouncil.retryRecommended
                ? await creativeImageCouncil.revisePrompt({ options, prepared, prompt, review: creativeCouncil })
                : null;
            try {
                fs.unlinkSync(outputPath);
            } catch {}
            try {
                fs.unlinkSync(photoPath);
            } catch {}
            return await this.generate({
                ...options,
                title: `${options.title || 'soma-image'} fresh variant`,
                tags: [...new Set([...(Array.isArray(options.tags) ? options.tags : []), 'critique-retry'])],
                _artDirectorRetry: true,
                _artDirectorAttempt: attempt + 1,
                previousPromptSignature: prepared.promptSignature,
                creativePromptOverride: creativePromptOverride || options.creativePromptOverride,
                creativeRevisionContext: creativeCouncil,
                critiqueRetryReason: [
                    ...(artDirector.critique?.warnings || []),
                    ...(artDirector.failures || []),
                    ...(creativeCouncil.violations || []),
                    creativeCouncil.revisionInstructions || '',
                ].filter(Boolean),
            });
        }
        if (retryRequested && attempt >= maxRetries && options.publicPost) {
            try { fs.unlinkSync(outputPath); } catch {}
            try { fs.unlinkSync(photoPath); } catch {}
            throw new Error(`Art Director exhausted ${maxRetries} visual retries without producing a sufficiently distinct public image`);
        }
        if (!artDirector.approved && (options.publicPost || options.strictArtDirector)) {
            try { fs.unlinkSync(outputPath); } catch {}
            try { fs.unlinkSync(photoPath); } catch {}
            throw new Error(`Art Director rejected generated image: ${artDirector.failures.join(', ') || 'score below threshold'}`);
        }

        const registered = socialImageLibrary.register({
            path: outputPath,
            alt,
            source: usedProvider,
            license: options.license || 'soma-generated',
            tags: ['generated', 'soma', ...(Array.isArray(prepared.tags) ? prepared.tags : []), ...(Array.isArray(options.tags) ? options.tags : [])],
            metadata: {
                artDirector,
                creativeCouncil,
                originalPrompt: prepared.originalPrompt,
                finalPrompt: prompt,
                purpose: options.purpose || 'social',
                visualSubject: prepared.visualSubject || null,
                visualRecipe: prepared.visualRecipe || null,
                selectedPalette: prepared.selectedPalette || [],
                selectedMotifs: prepared.selectedMotifs || [],
                promptSignature: prepared.promptSignature || null,
                similarity: prepared.similarity || null,
                critique: prepared.critique || null,
                critiqueRetry: Boolean(options._artDirectorRetry),
                critiqueRetryReason: options.critiqueRetryReason || [],
                sourcePostType: options.sourcePostType || options.postType || null,
                sourcePostId: options.sourcePostId || null,
                uploadOptimization: optimization,
            },
        });
        creativeImageCouncil.recordOutcome({
            provider: usedProvider,
            originalPrompt: prepared.originalPrompt,
            finalPrompt: prompt,
            imagePath: registered.image.path,
            approved: artDirector.approved && creativeCouncil.approved,
            attempt,
            brief: prepared.creativeCouncil || null,
            review: creativeCouncil,
        });
        return {
            ok: true,
            provider: usedProvider,
            providerDetail,
            prompt,
            originalPrompt: prepared.originalPrompt,
            alt,
            poseidon: verification,
            artDirector,
            creativeBrief: prepared.creativeCouncil || null,
            creativeCouncil,
            image: {
                ...registered.image,
                photoPath,
                prompt,
                originalPrompt: prepared.originalPrompt,
                artDirector,
                creativeCouncil,
                generatedBy: usedProvider,
            },
        };
    }
}

export default new SomaImageGenerationEngine();
