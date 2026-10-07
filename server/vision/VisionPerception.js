import crypto from 'node:crypto';

const clean = (value = '', max = 2000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const confidence = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0.5));

function normalizeBox(value) {
    if (!Array.isArray(value) || value.length < 4) return null;
    const box = value.slice(0, 4).map(Number);
    if (box.some(v => !Number.isFinite(v))) return null;
    return box.map(v => Math.max(0, Math.min(1, v)));
}

export function normalizeDetectedObjects(value = []) {
    return list(value).map((item, index) => {
        const source = typeof item === 'string' ? { label: item } : (item || {});
        const label = clean(source.label || source.name || source.object, 80).toLowerCase();
        if (!label) return null;
        return {
            id: clean(source.id, 80) || `detection-${index + 1}`,
            label,
            confidence: confidence(source.confidence ?? source.score),
            bbox: normalizeBox(source.bbox || source.box),
            attributes: list(source.attributes).map(v => clean(v, 80)).filter(Boolean),
            depth: clean(source.depth || source.distance, 80) || null,
        };
    }).filter(Boolean);
}

export function buildGroundedClaims({ summary = '', ocrText = '', uncertain = false, inferences = [], remembered = [] } = {}) {
    const claims = [];
    if (clean(summary)) claims.push({ claim: clean(summary, 1200), grounding: 'visible', confidence: uncertain ? 0.35 : 0.75 });
    if (clean(ocrText)) claims.push({ claim: `Visible text: ${clean(ocrText, 1600)}`, grounding: 'visible_text', confidence: uncertain ? 0.4 : 0.82 });
    for (const claim of list(inferences)) {
        const text = clean(typeof claim === 'string' ? claim : claim?.claim, 500);
        if (text) claims.push({ claim: text, grounding: 'inference', confidence: confidence(claim?.confidence ?? 0.45) });
    }
    for (const claim of list(remembered)) {
        const text = clean(typeof claim === 'string' ? claim : claim?.claim, 500);
        if (text) claims.push({ claim: text, grounding: 'remembered', confidence: confidence(claim?.confidence ?? 0.5) });
    }
    return claims;
}

export function normalizePerception(raw = {}, metadata = {}) {
    const summary = clean(raw.summary || raw.description || raw.result || raw.analysis, 1600);
    const detectedObjects = normalizeDetectedObjects(raw.detectedObjects || raw.objects);
    const uncertain = raw.uncertain === true || !summary;
    const visibleText = clean(raw.visible_text || raw.visibleText || raw.ocrText, 2400) || null;
    const scene = {
        schemaVersion: 'soma.perception.v1',
        perceptionId: metadata.perceptionId || `vision-${crypto.randomUUID()}`,
        capturedAt: Number(metadata.capturedAt || Date.now()),
        source: clean(metadata.source || raw.source || 'image-upload', 80),
        model: clean(metadata.model || raw.model || 'unknown', 120),
        stage: clean(metadata.stage || raw.stage || 'deep', 40),
        summary: summary || 'No confident visual description was produced.',
        scene: clean(raw.scene, 300) || summary || null,
        objects: detectedObjects,
        people: list(raw.people).map(person => ({
            label: clean(person?.label || 'person', 80),
            confidence: confidence(person?.confidence),
            bbox: normalizeBox(person?.bbox),
            identity: null,
        })),
        relationships: list(raw.relationships).map(v => clean(typeof v === 'string' ? v : v?.description, 240)).filter(Boolean),
        visibleText,
        colors: list(raw.colors).map(v => clean(v, 40)).filter(Boolean),
        composition: clean(raw.composition, 400) || null,
        depth: clean(raw.depth, 400) || null,
        hazards: list(raw.hazards).map(v => clean(typeof v === 'string' ? v : v?.description, 240)).filter(Boolean),
        uncertainties: list(raw.uncertainties).map(v => clean(v, 240)).filter(Boolean),
        uncertain,
    };
    for (const person of scene.people) {
        if (!scene.objects.some(object => object.label === 'person' && JSON.stringify(object.bbox) === JSON.stringify(person.bbox))) {
            scene.objects.push({
                id: `person-${scene.objects.length + 1}`,
                label: 'person',
                confidence: person.confidence,
                bbox: person.bbox,
                attributes: person.label && person.label !== 'person' ? [person.label] : [],
                depth: null,
            });
        }
    }
    if (uncertain && scene.uncertainties.length === 0) scene.uncertainties.push('The vision model did not produce a confident interpretation.');
    scene.claims = buildGroundedClaims({
        summary: scene.summary,
        ocrText: visibleText,
        uncertain,
        inferences: raw.inferences,
        remembered: metadata.remembered,
    });
    return scene;
}

export function mergePerceptions(preview, deep) {
    if (!deep) return preview;
    const objects = new Map();
    for (const item of [...(preview?.objects || []), ...(deep.objects || [])]) {
        const prior = objects.get(item.label);
        if (!prior || item.confidence > prior.confidence || item.bbox) objects.set(item.label, item);
    }
    return {
        ...preview,
        ...deep,
        perceptionId: preview?.perceptionId || deep.perceptionId,
        stage: 'deep',
        objects: [...objects.values()],
        // Preview text is provisional and may be wrong. Preserve it for diagnostics,
        // but only the deep model's claims are authoritative after refinement.
        claims: [...(deep.claims || [])],
        preview: preview ? { summary: preview.summary, model: preview.model, latencyMs: preview.latencyMs } : null,
    };
}

export default { normalizeDetectedObjects, buildGroundedClaims, normalizePerception, mergePerceptions };
