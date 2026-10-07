// RobustLLMAdapters.mjs
// Real LLM adapter implementations with fallback chain:
// Gemini API → DeepSeek API → Local Ollama (soma-1t-v1)

import https from 'https';
import http from 'http';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';

// ============= OLLAMA ADAPTER (LOCAL FALLBACK) =============
async function callOllama(prompt, opts = {}) {
    const payload = JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false
    });

    return new Promise((resolve, reject) => {
        const url = new URL(OLLAMA_ENDPOINT);
        const options = {
            hostname: url.hostname,
            port: url.port || 11434,
            path: '/api/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    const text = result.response || '';
                    resolve({
                        text,
                        confidence: 0.65,
                        meta: { role: 'ollama', model: OLLAMA_MODEL }
                    });
                } catch (e) {
                    reject(new Error(`Ollama parse error: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Ollama timeout')));
        req.write(payload);
        req.end();
    });
}

// ============= GEMINI ADAPTER (PRIORITY 1) =============
async function callGemini(prompt, opts = {}) {
    if (!GEMINI_KEY) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const payload = JSON.stringify({
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            temperature: opts.temperature || 0.7,
            maxOutputTokens: opts.maxTokens || 1024,
            topP: 0.9
        }
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_KEY}`,
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.candidates && result.candidates[0]) {
                        const text = result.candidates[0].content.parts[0].text;
                        resolve({
                            text,
                            confidence: 0.80,
                            meta: { role: 'gemini', model: 'gemini-2.0-flash-exp' }
                        });
                    } else if (result.error) {
                        reject(new Error(`Gemini API error: ${result.error.message}`));
                    } else {
                        reject(new Error('No Gemini response'));
                    }
                } catch (e) {
                    reject(new Error(`Gemini parse error: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Gemini timeout')));
        req.write(payload);
        req.end();
    });
}

// ============= DEEPSEEK ADAPTER (PRIORITY 2) =============
async function callDeepSeek(prompt, opts = {}) {
    if (!DEEPSEEK_KEY) {
        throw new Error('DEEPSEEK_API_KEY not configured');
    }

    const payload = JSON.stringify({
        model: 'deepseek-chat',
        messages: [
            { role: 'user', content: prompt }
        ],
        temperature: opts.temperature || 0.8,
        max_tokens: opts.maxTokens || 1024,
        top_p: 0.95
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.deepseek.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_KEY}`,
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.choices && result.choices[0]) {
                        const text = result.choices[0].message.content;
                        resolve({
                            text,
                            confidence: 0.75,
                            meta: { role: 'deepseek', model: 'deepseek-chat' }
                        });
                    } else if (result.error) {
                        reject(new Error(`DeepSeek API error: ${result.error.message}`));
                    } else {
                        reject(new Error('No DeepSeek response'));
                    }
                } catch (e) {
                    reject(new Error(`DeepSeek parse error: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('DeepSeek timeout')));
        req.write(payload);
        req.end();
    });
}

// ============= ROBUST ADAPTERS WITH FALLBACK =============
// Each adapter tries its primary provider, then falls back to Ollama

export async function gemaAdapter(query, opts = {}) {
    console.log('[GEMA Adapter] Using GEMMA-3 (Local) as primary common sense engine...');
    try {
        // Primary: Local Ollama (soma-1t-v1)
        const result = await callOllama(query, opts);
        console.log('[GEMA Adapter] ✓ GEMMA-3 (Ollama) succeeded');
        return { ...result, meta: { ...result.meta, adapter: 'gema-soma1t-local' } };
    } catch (ollamaError) {
        console.log(`[GEMA Adapter] ✗ GEMMA-3 failed: ${ollamaError.message}. Falling back to Gemini...`);
        try {
            // Fallback: Gemini
            const result = await callGemini(query, opts);
            console.log('[GEMA Adapter] ✓ Gemini fallback succeeded');
            return { ...result, meta: { ...result.meta, adapter: 'gema-gemini-fallback' } };
        } catch (geminiError) {
            console.error(`[GEMA Adapter] ✗ All common sense engines failed.`);
            return {
                text: '',
                confidence: 0.0,
                meta: { role: 'gema', adapter: 'failed', error: geminiError.message }
            };
        }
    }
}

export async function deepseekAdapter(query, opts = {}) {
    console.log('[DeepSeek Adapter] Processing query...');
    try {
        const result = await callDeepSeek(query, opts);
        console.log('[DeepSeek Adapter] ✓ DeepSeek succeeded');
        return { ...result, meta: { ...result.meta, adapter: 'deepseek-api' } };
    } catch (deepseekError) {
        console.log(`[DeepSeek Adapter] ✗ DeepSeek failed: ${deepseekError.message}`);
        try {
            const result = await callOllama(query, opts);
            console.log('[DeepSeek Adapter] ✓ Ollama fallback succeeded');
            return { ...result, meta: { ...result.meta, adapter: 'deepseek-ollama-fallback' } };
        } catch (ollamaError) {
            console.error(`[DeepSeek Adapter] ✗ Ollama fallback also failed: ${ollamaError.message}`);
            return {
                text: '',
                confidence: 0.0,
                meta: { role: 'deepseek', adapter: 'failed', error: ollamaError.message }
            };
        }
    }
}

export async function geminiAdapter(query, opts = {}) {
    console.log('[Gemini Adapter] Processing query...');
    try {
        const result = await callGemini(query, opts);
        console.log('[Gemini Adapter] ✓ Gemini succeeded');
        return { ...result, meta: { ...result.meta, adapter: 'gemini-api' } };
    } catch (geminiError) {
        console.log(`[Gemini Adapter] ✗ Gemini failed: ${geminiError.message}`);
        try {
            const result = await callOllama(query, opts);
            console.log('[Gemini Adapter] ✓ Ollama fallback succeeded');
            return { ...result, meta: { ...result.meta, adapter: 'gemini-ollama-fallback' } };
        } catch (ollamaError) {
            console.error(`[Gemini Adapter] ✗ Ollama fallback also failed: ${ollamaError.message}`);
            return {
                text: '',
                confidence: 0.0,
                meta: { role: 'gemini', adapter: 'failed', error: ollamaError.message }
            };
        }
    }
}

// Default export: adapter object for MerovingianHybrid
export const RobustAdapters = {
    gema: gemaAdapter,
    deepseek: deepseekAdapter,
    gemini: geminiAdapter,
    retriever: async (q, opts = {}) => ({ sources: [], snippets: [] }),
    calibrator: async (samples = []) => (c) => Math.max(0, Math.min(0.995, c))
};
