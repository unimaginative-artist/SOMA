import path, { dirname } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import BraveSearchAdapter from '../adapters/BraveSearchAdapter.js';
import UniversalLearningPipeline from './UniversalLearningPipeline.js';
import simulationLedger from '../core/SimulationAutonomyLedger.cjs';
import DendriteSearchEngine from '../server/services/DendriteSearchEngine.js';
import rippleLoopLedger from '../core/RippleLoopLedger.js';

class MacroEventArbiter {
    constructor() {
        this.predictionsFile = path.join(__dirname, '../data/macroEventPredictions.json');
        this.queryLenses = [
            { id: 'geopolitics', label: 'Geopolitics', query: 'geopolitics global markets energy supply chains sanctions', focus: 'conflict, sanctions, shipping lanes, and reserve-asset flows' },
            { id: 'rates', label: 'Rates And Liquidity', query: 'central banks bond yields inflation dollar liquidity markets', focus: 'rates, inflation, dollar liquidity, and duration risk' },
            { id: 'energy', label: 'Energy And Logistics', query: 'oil natural gas shipping freight supply chain disruption markets', focus: 'energy inputs, freight capacity, and industrial pass-through' },
            { id: 'technology', label: 'Technology Supply Chain', query: 'semiconductors AI chips export controls capex earnings markets', focus: 'semiconductors, AI capex, export controls, and tech earnings' },
            { id: 'credit', label: 'Credit Stress', query: 'credit spreads bank stress debt refinancing commercial real estate markets', focus: 'credit spreads, refinancing pressure, banks, and risk appetite' }
        ];
        this.queryIndex = 0;
        this.dendriteSearch = new DendriteSearchEngine({
            legacyJsonPath: path.resolve(process.cwd(), 'data', 'aperture', 'portal-index.json')
        });
        this.ensureFile();
        this.startAutonomousLoop();
    }

    startAutonomousLoop() {
        setInterval(async () => {
            try {
                await this.analyzeMacroEvents();
            } catch (e) {
                console.error('[MacroEventArbiter] Autonomous loop error:', e.message);
            }
        }, 55000); // Run causal prediction every 55 seconds

        setTimeout(() => {
            this.analyzeMacroEvents().catch(e => {});
        }, 7000);
    }

    ensureFile() {
        const dir = path.dirname(this.predictionsFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.predictionsFile)) {
            fs.writeFileSync(this.predictionsFile, JSON.stringify({ predictions: [] }, null, 2));
        }
    }

    async runSomaLLM(prompt) {
        const endpoint = process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434";
        const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";

        // Using standard fetch available in Node 18+
        while (global.__SOMA_CHAT_ACTIVE || Date.now() < Number(global.__SOMA_CHAT_RESERVED_UNTIL || 0)) {
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        const response = await fetch(`${endpoint}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: "You are SOMA's analytical engine specializing in causal predictions." }, 
                    { role: "user", content: prompt }
                ],
                stream: false,
                keep_alive: process.env.SOMA_BACKGROUND_OLLAMA_KEEP_ALIVE || "15s"
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data.message.content.trim();
    }

    nextQueryLens() {
        const lens = this.queryLenses[this.queryIndex % this.queryLenses.length];
        this.queryIndex += 1;
        return lens;
    }

    normalizeHeadline(headline = '') {
        return String(headline)
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s.-]/g, '')
            .trim();
    }

    uniqueHeadlines(headlines = []) {
        const seen = new Set();
        return headlines
            .map(h => String(h || '').trim())
            .filter(Boolean)
            .filter(headline => {
                const key = this.normalizeHeadline(headline);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 10);
    }

    predictionFingerprint({ lens, headlines = [] }) {
        const normalized = headlines.slice(0, 5).map(h => this.normalizeHeadline(h)).join('|');
        return crypto
            .createHash('sha256')
            .update(`${lens?.id || 'macro'}::${normalized}`)
            .digest('hex')
            .slice(0, 16);
    }

    readPredictionStore() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.predictionsFile, 'utf8'));
            return { predictions: Array.isArray(raw.predictions) ? raw.predictions : [] };
        } catch {
            return { predictions: [] };
        }
    }

    searchDendriteHeadlines(query, limit = 6) {
        try {
            const results = this.dendriteSearch.search(query, limit);
            return {
                provider: 'portal-dendrite-cache',
                quotaCost: 0,
                headlines: results
                    .map(result => result.title || result.snippet || result.url)
                    .filter(Boolean),
                sources: results.map(result => ({
                    title: result.title,
                    url: result.url,
                    source: result.source,
                    indexedAt: result.indexedAt,
                    score: result.score
                }))
            };
        } catch (error) {
            console.warn(`[MacroEventArbiter] Dendrite source unavailable: ${error.message}`);
            return { provider: 'portal-dendrite-cache', quotaCost: 0, headlines: [], sources: [], error: error.message };
        }
    }

    async acquireHeadlines(query, lens, options = {}) {
        const allowBrave = options.allowBrave === true || process.env.RIPPLE_ALLOW_BRAVE === 'true';
        const local = this.searchDendriteHeadlines(query, 8);
        const sourceTrail = [local];
        let headlines = local.headlines;

        if (headlines.length < 4) {
            const rss = await BraveSearchAdapter.searchNewsDetailed(query, { provider: 'rss' });
            sourceTrail.push(rss);
            headlines = [...headlines, ...rss.headlines];
        }

        if (allowBrave && this.uniqueHeadlines(headlines).length < 5) {
            const brave = await BraveSearchAdapter.searchNewsDetailed(query, { provider: 'brave' });
            sourceTrail.push(brave);
            headlines = [...headlines, ...brave.headlines];
        }

        const unique = this.uniqueHeadlines(headlines);
        return {
            headlines: unique.length ? unique : [`${lens.label}: global markets show mixed reactions as ${lens.focus} remain in focus.`],
            sourceMeta: {
                provider: sourceTrail.map(item => item.provider).join(' -> '),
                quotaCost: sourceTrail.reduce((sum, item) => sum + (item.quotaCost || 0), 0),
                localHits: local.headlines.length,
                sourceTrail: sourceTrail.map(item => ({
                    provider: item.provider,
                    quotaCost: item.quotaCost || 0,
                    headlineCount: item.headlines?.length || 0,
                    error: item.error || null
                })),
                citations: sourceTrail.flatMap(item => item.sources || []).slice(0, 8)
            }
        };
    }

    buildLocalRipplePrediction(headlines = [], lens = this.queryLenses[0]) {
        const text = headlines.join(' ').toLowerCase();
        const signals = [];
        if (/\bwar|conflict|geopolitical|sanction|fragmentation|chokepoint|shipping lane\b/.test(text)) {
            signals.push('geopolitical-risk premium rises, favoring safe-haven flows and wider commodity volatility');
        }
        if (/\btrade|supply chain|shipping|tariff|critical minerals|energy transition\b/.test(text)) {
            signals.push('supply-chain repricing pressure can spill into industrial inputs, semiconductors, energy, and transport');
        }
        if (/\bgold|safe-haven|rates|central bank|debt|inflation\b/.test(text)) {
            signals.push('rate and reserve-asset expectations may rotate capital toward gold, bonds, and defensive equity factors');
        }
        if (/\btech|ai|chips|semiconductor|technology\b/.test(text)) {
            signals.push('technology exposure becomes more sensitive to export controls, capex timing, and dollar liquidity');
        }
        const fallbackByLens = {
            geopolitics: 'risk premium should show first in VIX, gold, oil optionality, defense factors, and transport underperformance',
            rates: 'the first-order pressure is duration and dollar liquidity, then credit spreads and equity multiple compression',
            energy: 'input-cost pressure should move from crude and freight into transports, industrial margins, and consumer inflation expectations',
            technology: 'AI and semiconductor exposure should reprice through capex timing, export-control sensitivity, and inventory-cycle risk',
            credit: 'refinancing stress should surface in HYG/LQD spreads, regional bank beta, and high-debt equity underperformance'
        };
        const chain = signals.length ? signals.join('; ') : fallbackByLens[lens.id] || fallbackByLens.geopolitics;
        return `Local causal model (${lens.label}): ${chain}. Focus area: ${lens.focus}. Treat this as persistent only if confirming instruments move together instead of one headline creating a temporary spike.`;
    }

    extractMarketSignals(headlines = [], prediction = '') {
        const text = `${headlines.join(' ')} ${prediction}`.toLowerCase();
        const signals = [];
        const add = (asset, direction, reason, confidence = 0.55) => signals.push({ asset, direction, reason, confidence });
        if (/\bwar|conflict|geopolitical|sanction|fragmentation|chokepoint\b/.test(text)) {
            add('VIX', 'up', 'geopolitical uncertainty can widen volatility risk premium', 0.62);
            add('GLD', 'up', 'safe-haven demand tends to rise under geopolitical stress', 0.6);
            add('TLT', 'mixed', 'flight-to-quality can compete with inflation/rate pressure', 0.48);
        }
        if (/\boil|energy|supply chain|shipping|critical minerals\b/.test(text)) {
            add('USO', 'up', 'supply-chain or energy disruption risk can lift energy inputs', 0.55);
            add('IYT', 'down', 'transport margins can compress when fuel/logistics risk rises', 0.52);
        }
        if (/\btech|chips|semiconductor|ai|export controls\b/.test(text)) {
            add('SMH', 'volatile', 'semiconductor exposure is sensitive to export controls and capex timing', 0.58);
            add('QQQ', 'volatile', 'mega-cap tech reprices quickly when macro liquidity and geopolitics collide', 0.54);
        }
        if (!signals.length) add('SPY', 'volatile', 'broad macro uncertainty can lift index-level dispersion', 0.45);
        return {
            generatedAt: new Date().toISOString(),
            policy: 'context_only_not_trade_signal',
            signals,
            validationWatchlist: ['DXY', 'VIX', 'GLD', 'USO', 'TLT', 'HYG', 'SMH', 'IYT', 'SPY', 'QQQ']
        };
    }

    async analyzeMacroEvents(options = {}) {
        const { force = false } = options;
        const lens = this.nextQueryLens();
        const query = lens.query;
        let headlines = [];
        let sourceMeta = null;
        try {
            const acquired = await this.acquireHeadlines(query, lens, options);
            headlines = acquired.headlines;
            sourceMeta = acquired.sourceMeta;
        } catch (error) {
            console.error("Failed to fetch news headlines:", error.message);
            headlines = [`${lens.label}: global markets show mixed reactions as ${lens.focus} remain in focus.`, "Supply chain constraints ease slightly in key sectors."];
            sourceMeta = { provider: 'local-fallback', quotaCost: 0, localHits: 0, sourceTrail: [{ provider: 'local-fallback', quotaCost: 0, headlineCount: headlines.length, error: error.message }], citations: [] };
        }
        headlines = this.uniqueHeadlines(headlines);
        const fingerprint = this.predictionFingerprint({ lens, headlines });
        const store = this.readPredictionStore();
        const existing = store.predictions.find(p => p.fingerprint === fingerprint);
        if (existing && !force) {
            const updated = {
                ...existing,
                lastSeenAt: new Date().toISOString(),
                seenCount: (existing.seenCount || 1) + 1,
                status: 'duplicate_collapsed'
            };
            this.savePrediction(updated);
            return {
                ...updated,
                skippedDuplicate: true,
                duplicateOf: existing.timestamp,
                headline: updated.headlines?.[0] || updated.query || 'Macro event scan',
                prediction: updated.rippleEffectsPrediction || updated.prediction || ''
            };
        }

        const prompt = `Based on the following recent news headlines, generate a causal prediction analyzing the ripple effects on global markets, supply chains, and society:\n\n${headlines.join('\n')}\n\nProvide a concise analysis focusing on potential chain reactions (ripple effects).`;

        let predictionRaw;
        try {
            predictionRaw = await this.runSomaLLM(prompt);
        } catch (e) {
            console.error("LLM Error in MacroEventArbiter:", e.message);
            predictionRaw = null;
        }
        if (!predictionRaw) predictionRaw = this.buildLocalRipplePrediction(headlines, lens);

        const predictionResult = {
            timestamp: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            seenCount: 1,
            fingerprint,
            status: 'new',
            lens: {
                id: lens.id,
                label: lens.label,
                focus: lens.focus
            },
            query,
            sourceMeta,
            headlines,
            rippleEffectsPrediction: predictionRaw,
            marketSignals: this.extractMarketSignals(headlines, predictionRaw),
            validation: {
                status: 'pending',
                checkAfterHours: 24,
                watchlist: ['DXY', 'VIX', 'GLD', 'USO', 'TLT', 'HYG', 'SMH', 'IYT', 'SPY', 'QQQ']
            }
        };

        this.savePrediction(predictionResult);
        rippleLoopLedger.trackPrediction(predictionResult).catch(error => {
            console.warn(`[MacroEventArbiter] Ripple loop tracking failed: ${error.message}`);
        });
        simulationLedger.appendEvidence({
            module: 'ripple-engine',
            kind: 'macro_ripple_prediction',
            status: 'observed',
            primaryBrain: 'PROMETHEUS',
            brainLanes: ['PROMETHEUS', 'LOGOS', 'MNEMOSYNE'],
            learningTargets: ['market_context', 'causal_forecasting', 'second_order_effects'],
            fallbackUsed: !process.env.SOMA_LLM_API_KEY && !process.env.OPENAI_API_KEY,
            summary: predictionRaw,
            evidence: headlines.slice(0, 5),
            metrics: {
                headlineCount: headlines.length,
                sourceCount: sourceMeta?.sourceTrail?.length || 0,
                braveQuotaCost: sourceMeta?.quotaCost || 0,
                localHits: sourceMeta?.localHits || 0,
                marketSignalCount: predictionResult.marketSignals.signals.length,
                score: Math.min(1, 0.35 + headlines.length * 0.04)
            },
            marketSignals: predictionResult.marketSignals,
            rawRef: 'data/macroEventPredictions.json'
        });

        // Pipe to UniversalLearningPipeline
        if (UniversalLearningPipeline && UniversalLearningPipeline.logInteraction) {
            UniversalLearningPipeline.logInteraction({
                source: "MacroEventArbiter",
                type: "CausalPrediction",
                data: predictionResult
            });
        }

        return predictionResult;
    }

    async generatePredictions() {
        return this.analyzeMacroEvents();
    }

    savePrediction(predictionResult) {
        const stats = this.readPredictionStore();
        const existingIndex = stats.predictions.findIndex(p =>
            predictionResult.fingerprint && p.fingerprint === predictionResult.fingerprint
        );
        if (existingIndex >= 0) {
            stats.predictions[existingIndex] = {
                ...stats.predictions[existingIndex],
                ...predictionResult,
                timestamp: stats.predictions[existingIndex].timestamp || predictionResult.timestamp,
                lastSeenAt: predictionResult.lastSeenAt || new Date().toISOString(),
                seenCount: predictionResult.seenCount || ((stats.predictions[existingIndex].seenCount || 1) + 1)
            };
            const [updated] = stats.predictions.splice(existingIndex, 1);
            stats.predictions.unshift(updated);
        } else {
            stats.predictions.unshift(predictionResult);
        }
        
        // keep only the last 20
        if (stats.predictions.length > 20) {
            stats.predictions = stats.predictions.slice(0, 20);
        }

        fs.writeFileSync(this.predictionsFile, JSON.stringify(stats, null, 2));
    }

    getPredictions() {
        const raw = JSON.parse(fs.readFileSync(this.predictionsFile, 'utf8'));
        const predictions = Array.isArray(raw.predictions) ? raw.predictions : [];
        const deduped = new Map();
        for (const item of predictions) {
            const fingerprint = item.fingerprint || this.predictionFingerprint({
                lens: item.lens || { id: 'legacy' },
                headlines: item.headlines || [item.headline || item.query || '']
            });
            const normalized = {
                ...item,
                fingerprint,
                lens: item.lens || { id: 'legacy', label: 'Legacy Macro Scan', focus: 'pre-dedup historical entry' },
                sourceMeta: item.sourceMeta || {
                    provider: 'legacy-pre-source-ladder',
                    quotaCost: 0,
                    localHits: 0,
                    sourceTrail: [],
                    citations: []
                },
                seenCount: item.seenCount || 1,
                lastSeenAt: item.lastSeenAt || item.timestamp,
                headline: item.headline || item.headlines?.[0] || item.query || 'Macro event scan',
                prediction: item.prediction || item.rippleEffectsPrediction || ''
            };
            const existing = deduped.get(fingerprint);
            if (!existing) {
                deduped.set(fingerprint, normalized);
            } else {
                deduped.set(fingerprint, {
                    ...existing,
                    lastSeenAt: normalized.lastSeenAt > existing.lastSeenAt ? normalized.lastSeenAt : existing.lastSeenAt,
                    seenCount: (existing.seenCount || 1) + (normalized.seenCount || 1),
                    status: 'duplicate_collapsed'
                });
            }
        }
        return Array.from(deduped.values())
            .sort((a, b) => String(b.lastSeenAt || b.timestamp || '').localeCompare(String(a.lastSeenAt || a.timestamp || '')));
    }
}

export default new MacroEventArbiter();
