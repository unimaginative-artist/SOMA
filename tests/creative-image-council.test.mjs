import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CreativeImageCouncil } from '../server/social/CreativeImageCouncil.js';
import { critiqueGeneratedImage } from '../server/utils/LocalVisionFileAnalyzer.js';

function immediateScheduler() {
    return {
        schedule(options, handler) {
            return handler({
                signal: new AbortController().signal,
                traceId: options.traceId || 'test-trace',
                requestId: options.requestId || 'test-request',
                resource: options.resource,
                priority: options.priority,
            });
        },
    };
}

function jsonResponse(value, ok = true, status = 200) {
    return {
        ok,
        status,
        async json() { return value; },
    };
}

const deterministicBrief = {
    ok: true,
    originalPrompt: 'a red fox reading beside an old oak tree',
    prompt: 'Create an editorial illustration of a red fox reading beside an old oak tree in morning light.',
    alt: 'A red fox reads beside an old oak tree.',
    selectedPalette: ['rust red', 'forest green'],
    selectedMotifs: ['old book', 'oak bark'],
    visualRecipe: { subject: 'red fox', composition: 'medium shot' },
    warnings: [],
    failures: [],
};

test('AURORA creates a validated structured brief without losing the subject', async () => {
    const council = new CreativeImageCouncil({
        scheduler: immediateScheduler(),
        ensureSpecialist: async () => ({ ok: true }),
        fetchImpl: async () => jsonResponse({
            message: {
                content: JSON.stringify({
                    prompt: 'A red fox sits beneath an old oak tree reading a weathered book, framed at eye level with amber morning light, detailed fur, tactile bark, shallow depth of field, quiet storybook atmosphere, no lettering or watermark.',
                    alt: 'A red fox reading beneath an old oak tree in warm morning light.',
                    palette: ['rust red', 'amber', 'moss green'],
                    composition: 'eye-level medium shot',
                    lighting: 'soft amber morning light',
                    style: 'tactile storybook realism',
                    constraints: ['no readable text'],
                    rationale: 'The scene makes curiosity visible through a concrete action.',
                }),
            },
        }),
        visionCritic: async () => ({}),
    });

    const prepared = await council.prepare({ creativeCouncil: true, purpose: 'discord' }, deterministicBrief);
    assert.equal(prepared.creativeCouncil.status, 'aurora_directed');
    assert.match(prepared.prompt, /red fox/i);
    assert.deepEqual(prepared.selectedPalette, ['rust red', 'amber', 'moss green']);
});

test('invalid or drifting AURORA output fails safely to the deterministic art brief', async () => {
    const council = new CreativeImageCouncil({
        scheduler: immediateScheduler(),
        ensureSpecialist: async () => ({ ok: true }),
        fetchImpl: async () => jsonResponse({ message: { content: '{"prompt":"An unrelated spaceship above Mars with neon engines and distant stars."}' } }),
        visionCritic: async () => ({}),
    });

    const prepared = await council.prepare({ creativeCouncil: true }, deterministicBrief);
    assert.equal(prepared.prompt, deterministicBrief.prompt);
    assert.equal(prepared.creativeCouncil.status, 'deterministic_fallback');
    assert.match(prepared.warnings[0], /subject-preservation/);
});

test('vision-grounded review requests a bounded revision and records its evidence', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-creative-council-'));
    const ledgerFile = path.join(tempDir, 'creative.jsonl');
    let calls = 0;
    const council = new CreativeImageCouncil({
        scheduler: immediateScheduler(),
        ensureSpecialist: async () => ({ ok: true }),
        fetchImpl: async () => {
            calls++;
            return jsonResponse({
                message: {
                    content: JSON.stringify({
                        prompt: 'A red fox clearly reads an open weathered book beneath an old oak tree, both paws holding the pages, eye-level medium framing, warm morning light, detailed fur and bark, quiet natural setting, no readable lettering or watermark.',
                        rationale: 'The revision makes the missing reading action unmistakable.',
                    }),
                },
            });
        },
        visionCritic: async () => ({
            alignmentScore: 0.42,
            technicalScore: 0.8,
            subjectPresent: true,
            summary: 'A fox is under a tree, but the book is closed.',
            violations: ['the fox is not visibly reading'],
            revisionInstructions: 'Show the fox holding an open book and looking at its pages.',
            uncertain: false,
            model: 'qwen2.5vl:7b',
            latencyMs: 50,
        }),
        ledgerFile,
    });

    const review = await council.reviewGenerated({
        options: { creativeCouncil: true, purpose: 'discord' },
        prepared: deterministicBrief,
        provider: 'bonsai-http',
        imagePath: path.join(tempDir, 'fox.png'),
        prompt: deterministicBrief.prompt,
    });
    assert.equal(review.retryRecommended, true);
    assert.equal(review.approved, false);

    const revision = await council.revisePrompt({
        options: { creativeCouncil: true, purpose: 'discord' },
        prepared: deterministicBrief,
        prompt: deterministicBrief.prompt,
        review,
    });
    assert.match(revision, /red fox/i);
    assert.equal(calls, 1);

    council.recordOutcome({
        provider: 'bonsai-http',
        originalPrompt: deterministicBrief.originalPrompt,
        finalPrompt: revision,
        imagePath: path.join(tempDir, 'fox.png'),
        approved: true,
        attempt: 1,
        review,
    });
    const record = JSON.parse(fs.readFileSync(ledgerFile, 'utf8').trim());
    assert.equal(record.type, 'creative_image_outcome');
    assert.equal(record.review.model, 'qwen2.5vl:7b');
    fs.writeFileSync(path.join(tempDir, 'fox.png'), Buffer.from('generated-image'));
    council.recordHumanFeedback({
        imageId: 'fox-1',
        imagePath: path.join(tempDir, 'fox.png'),
        rating: 5,
        approved: true,
        note: 'The subject and atmosphere are right.',
        trainingConsent: true,
    });
    const candidates = council.trainingCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].rating, 5);
    assert.match(candidates[0].caption, /red fox/i);
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('a descriptive-only vision response is marked uncertain instead of receiving an invented score', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-creative-critic-'));
    const imagePath = path.join(tempDir, 'image.png');
    fs.writeFileSync(imagePath, Buffer.from('test-image-bytes'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({
        response: 'A red fox is visibly reading an open book beneath a large tree.',
    });
    try {
        const result = await critiqueGeneratedImage(imagePath, {
            model: 'moondream:latest',
            endpoint: 'http://127.0.0.1:19999',
            requestedPrompt: 'a fox reading beneath a tree',
            renderedPrompt: 'a red fox reading an open book beneath an oak tree',
            priority: 'interactive',
            timeoutMs: 5000,
            keepAlive: 0,
        });
        assert.equal(result.uncertain, true);
        assert.equal(result.alignmentScore, 0.4);
        assert.equal(result.subjectPresent, null);
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
