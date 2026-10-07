export function imageEditingCapability(env = process.env) {
    const endpoint = String(env.SOMA_IMAGE_EDIT_ENDPOINT || '').trim();
    return {
        available: Boolean(endpoint),
        provider: endpoint ? 'configured-reference-editor' : null,
        modes: endpoint ? ['img2img', 'inpaint', 'reference-style', 'control'] : [],
        semanticReconstruction: true,
        explanation: endpoint
            ? 'A reference-aware image editing endpoint is configured.'
            : 'Bonsai can generate a new image from a description, but pixel-faithful editing is unavailable until SOMA_IMAGE_EDIT_ENDPOINT is configured.',
    };
}

export async function editImage({ imageData, maskData = null, prompt, mode = 'img2img', strength = 0.55 } = {}, { env = process.env, fetchImpl = fetch } = {}) {
    const capability = imageEditingCapability(env);
    if (!capability.available) {
        const error = new Error(capability.explanation);
        error.code = 'IMAGE_EDIT_PROVIDER_UNAVAILABLE';
        throw error;
    }
    if (!capability.modes.includes(mode)) throw new Error(`Unsupported image edit mode: ${mode}`);
    if (!imageData || !String(prompt || '').trim()) throw new Error('imageData and prompt are required');
    const response = await fetchImpl(env.SOMA_IMAGE_EDIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, mask: maskData, prompt, mode, strength: Math.max(0, Math.min(1, Number(strength))) }),
        signal: AbortSignal.timeout(Number(env.SOMA_IMAGE_EDIT_TIMEOUT_MS || 180000)),
    });
    if (!response.ok) throw new Error(`Image edit provider returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
    return response.json();
}

export default { imageEditingCapability, editImage };
