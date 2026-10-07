const DEFAULT_ENDPOINT = process.env.SOMA_LARGE_MODEL_ENDPOINT || 'http://127.0.0.1:8084';
const DEFAULT_MODEL = process.env.SOMA_LARGE_MODEL_NAME || 'Qwen3.8-27B-Uncensored-noMTP-IQ4_XS';

function linkedSignal(signal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeout])
        : timeout;
}

export class LocalLargeReasoningClient {
    constructor({ endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch, timeoutMs = 120_000, resourceGovernor = null } = {}) {
        this.endpoint = String(endpoint).replace(/\/$/, '');
        this.model = model;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.resourceGovernor = resourceGovernor;
    }

    async health({ timeoutMs = 2_000 } = {}) {
        try {
            const response = await this.fetchImpl(`${this.endpoint}/health`, { signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) return { available: false, status: response.status };
            const detail = await response.json().catch(() => ({}));
            return { available: detail?.status === 'ok' || detail?.status === 'ready', detail };
        } catch (error) {
            return { available: false, error: error.message };
        }
    }

    async complete({ prompt, systemPrompt, maxTokens = 700, temperature = 0.25, signal = null, resourceLeaseActive = false } = {}) {
        if (!String(prompt || '').trim()) throw new TypeError('Large-model prompt is required');
        const invoke = async () => {
            const response = await this.fetchImpl(`${this.endpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: prompt }
                    ],
                    temperature,
                    max_tokens: maxTokens,
                    stream: false,
                    chat_template_kwargs: { enable_thinking: false },
                    preserve_thinking: false
                }),
                signal: linkedSignal(signal, this.timeoutMs)
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                throw new Error(`Large reasoning model HTTP ${response.status}: ${detail.slice(0, 240)}`);
            }
            const payload = await response.json();
            const text = String(payload?.choices?.[0]?.message?.content || '').trim();
            if (!text) throw new Error('Large reasoning model returned no visible answer');
            return {
                text,
                provider: 'local-llama-server',
                model: payload?.model || this.model,
                endpoint: this.endpoint,
                usage: payload?.usage || null
            };
        };
        return this.resourceGovernor?.withLargeModel && !resourceLeaseActive
            ? this.resourceGovernor.withLargeModel(invoke)
            : invoke();
    }
}

export default LocalLargeReasoningClient;
