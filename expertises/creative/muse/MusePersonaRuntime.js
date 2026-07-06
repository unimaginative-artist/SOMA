import { ExpertiseBase } from '../../../core/ExpertiseBase.js';
import { epistemicLayer, CLAIM_TYPE } from '../../../core/EpistemicLayer.js';

const trim = (value = '', max = 2400) => String(value || '').trim().slice(0, max);

export class MusePersonaRuntime extends ExpertiseBase {
    constructor(config = {}) {
        super({
            ...config,
            name: 'MusePersona',
            category: 'Creative',
            version: '0.1.0'
        });
        this.manifest = config.manifest || config.expertiseManifest || {};
        this.maxContextChars = 5000;
    }

    async getPhases() {
        return ['SPARK', 'VARIANT', 'CRITIQUE', 'CRYSTALLIZE'];
    }

    getStatus() {
        return {
            ...super.getStatus(),
            id: this.manifest.id || 'creative/muse',
            persona: 'AURORA Muse',
            museEngine: !!this.system?.museEngine,
            aurora: !!this._getAuroraBrain(),
            modes: ['spark', 'variant', 'critique', 'crystallize', 'full']
        };
    }

    async runMission(target = {}) {
        const request = typeof target === 'string'
            ? { prompt: target, mode: 'full' }
            : { mode: 'full', ...target };

        const mode = String(request.mode || 'full').toLowerCase();
        const contextText = this._buildContext(request);
        const startedAt = Date.now();

        let result;
        if (mode === 'spark') {
            result = { spark: await this._spark(contextText) };
        } else if (mode === 'variant' || mode === 'variants') {
            result = { variant: await this._variant(contextText) };
        } else if (mode === 'critique' || mode === 'pressure-test') {
            result = { critique: await this._critique(contextText) };
        } else if (mode === 'crystallize') {
            result = { crystallize: await this._crystallize(contextText) };
        } else {
            const [spark, variant, critique, crystallize] = await Promise.all([
                this._spark(contextText),
                this._variant(contextText),
                this._critique(contextText),
                this._crystallize(contextText)
            ]);
            result = { spark, variant, critique, crystallize };
        }

        const response = this._formatResponse(result, mode);
        this._rememberSpark(result, request);
        this.metrics.missionsCompleted++;
        this.metrics.lastRun = Date.now();
        this.metrics.avgConfidence = 0.84;

        return {
            success: true,
            mode,
            persona: 'Muse',
            brain: 'AURORA',
            elapsedMs: Date.now() - startedAt,
            response,
            structured: result
        };
    }

    _buildContext(request) {
        const parts = [
            "You are Muse, SOMA's AURORA-backed creative operator.",
            'Think like a professional story writer, game developer, art director, creative producer, and development editor.',
            'Be vivid and useful. Push toward concrete artifacts. Avoid generic praise.',
            '',
            `USER PROMPT: ${trim(request.prompt || request.query || request.text || '')}`
        ];

        if (request.history) {
            const history = Array.isArray(request.history)
                ? request.history.map(item => `${item.role || 'note'}: ${item.text || item.content || ''}`).join('\n')
                : String(request.history);
            parts.push('', `SESSION CONTEXT:\n${trim(history, 2000)}`);
        }

                if (request.domain) parts.push('', `CREATIVE DOMAIN: ${trim(request.domain, 200)}`);
        if (request.constraints) parts.push('', `CONSTRAINTS: ${trim(request.constraints, 800)}`);

        parts.push('', 'EPISTEMIC CONSTRAINT: When analyzing a document or story, you MUST extract and quote at least two verbatim sentences from the source text to prove you have read it. Format your quotes exactly as: > "the quoted text". Base your critique ONLY on the actual extracted text, not the title.');

        return trim(parts.join('\n'), this.maxContextChars);
    }

    async _spark(contextText) {
        const engine = this.system?.museEngine;
        if (engine && typeof engine._generateSpark === 'function') {
            const res = await engine._generateSpark(contextText);
            return trim(res?.text || res);
        }

        return this._callAurora(`${contextText}\n\nProduce one short, sharp creative SPARK. Max 70 words.`, 'spark');
    }

    async _variant(contextText) {
        const engine = this.system?.museEngine;
        if (engine && typeof engine._generateVariant === 'function') {
            const res = await engine._generateVariant(contextText);
            return trim(res?.text || res);
        }

        return this._callAurora(`${contextText}\n\nProduce three concrete creative VARIANTS and pick the strongest.`, 'variant');
    }

    async _critique(contextText) {
        const engine = this.system?.museEngine;
        if (engine && typeof engine._generateCritique === 'function') {
            const res = await engine._generateCritique(contextText);
            return trim(res?.text || res);
        }

        return this._callAurora(`${contextText}\n\nGive the top three failure modes with mitigations.`, 'critique');
    }

    async _crystallize(contextText) {
        return this._callAurora(`${contextText}

Crystallize this into an artifact-ready creative note:
- Title
- One-sentence premise
- Emotional promise
- Core components
- Open questions
- Next concrete action`, 'crystallize');
    }

        async _callAurora(prompt, style) {
        const brain = this._getAuroraBrain();
        if (!brain) return `[${style} unavailable: AURORA brain is offline]`;

        try {
            let finalResponseText = '';
            if (typeof brain.callBrain === 'function') {
                const response = await brain.callBrain('AURORA', prompt, {
                    mode: 'creative',
                    style,
                    persona: 'muse'
                }, 'full');
                finalResponseText = trim(response?.text || response?.response || response);
            } else {
                const response = await brain.reason(prompt, {
                    quickResponse: true,
                    temperature: 0.8,
                    brain: 'AURORA',
                    mode: 'creative'
                });
                finalResponseText = trim(response?.text || response?.response || response);
            }

            // Epistemic verification for quotes
            const quotes = [];
            const quoteRegex = />\s*["']([^"']+)["']/g;
            let match;
            while ((match = quoteRegex.exec(finalResponseText)) !== null) {
                quotes.push(match[1]);
            }

            if (quotes.length > 0) {
                for (const quote of quotes) {
                    const claim = await epistemicLayer.processClaim(quote, {
                        type: CLAIM_TYPE.CITATION,
                        evidence: [prompt] // the prompt contains the context text
                    });
                    if (claim.status === 'REJECTED') {
                        return `[EPISTEMIC FAILURE: Hallucination detected. Failed to verify quote: "${quote}"]`;
                    }
                }
            } else if (prompt.includes('USER PROMPT: ') && prompt.length > 1000 && style === 'critique') {
                // Force rejection if they didn't quote on a large critique
                return `[EPISTEMIC FAILURE: Hallucination detected. Failed to cite actual source text.]`;
            }

            return finalResponseText;
        } catch (error) {
            return `[${style} unavailable: ${error.message}]`;
        }
    }

    _getAuroraBrain() {
        return this.system?.museEngine?.quadBrain || this.system?.quadBrain || null;
    }

    _formatResponse(result, mode) {
        if (mode === 'spark') return result.spark || '';
        if (mode === 'variant' || mode === 'variants') return result.variant || '';
        if (mode === 'critique' || mode === 'pressure-test') return result.critique || '';
        if (mode === 'crystallize') return result.crystallize || '';

        return [
            result.spark ? `Spark\n${result.spark}` : '',
            result.variant ? `\nVariant\n${result.variant}` : '',
            result.critique ? `\nCritique\n${result.critique}` : '',
            result.crystallize ? `\nCrystallize\n${result.crystallize}` : ''
        ].filter(Boolean).join('\n');
    }

    _rememberSpark(result, request) {
        const spark = result?.spark;
        const store = this.system?.museEngine?.sparks;
        if (!spark || !Array.isArray(store)) return;

        store.unshift({
            id: `persona-spark-${Date.now()}`,
            nodeId: 'muse-persona',
            creative_spark: spark,
            principle: trim(request.prompt || request.query || request.text || 'Muse session', 140),
            variant: result.variant || '',
            critique: result.critique || '',
            timestamp: new Date().toISOString(),
            confidence: 0.84,
            source: 'creative/muse'
        });

        const max = this.system.museEngine.maxSparks || 50;
        if (store.length > max) store.length = max;
    }
}

export default MusePersonaRuntime;
