const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const messageBroker = require('../core/MessageBroker.cjs');

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const LEDGER_FILE = path.join(SOMA_DIR, 'cross-domain-synthesis-ledger.json');
const DEFAULT_PORT = process.env.PORT || process.env.SOMA_PORT || 3001;
const DEFAULT_ENDPOINT = `http://127.0.0.1:${DEFAULT_PORT}`;
const MAX_LEDGER_ITEMS = 250;

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {}
    return fallback;
}

function writeJson(filePath, data) {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function stableId(prefix, value) {
    return `${prefix}_${crypto.createHash('sha1').update(String(value || Date.now())).digest('hex').slice(0, 12)}`;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function truncate(value, max = 1200) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function tokenize(text = '') {
    return truncate(text, 6000).toLowerCase()
        .split(/[^a-z0-9$.-]+/i)
        .map(token => token.trim())
        .filter(token => token.length >= 4 && !COMMON_WORDS.has(token));
}

const COMMON_WORDS = new Set([
    'about', 'active', 'after', 'against', 'also', 'because', 'before', 'between', 'challenge',
    'could', 'current', 'description', 'domain', 'event', 'from', 'have', 'into', 'more',
    'prediction', 'should', 'specific', 'state', 'strategy', 'their', 'there', 'these', 'this',
    'through', 'with', 'would', 'totalmatches', 'totalsomascore', 'somawins', 'updatedat',
    'confidence', 'usagecount', 'average', 'payoff', 'trials', 'wins', 'likes', 'replies',
    'interactions', 'topics', 'score', 'matches',
]);

const PIVOT_STOPWORDS = new Set([
    'average', 'payoff', 'trials', 'wins', 'likes', 'replies', 'interactions', 'topics',
    'score', 'matches', 'updated', 'confidence',
]);

function overlapRatio(a = [], b = []) {
    const left = new Set(a);
    const right = new Set(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const item of left) if (right.has(item)) overlap += 1;
    return overlap / Math.min(left.size, right.size);
}

function topTerms(text, limit = 10) {
    const counts = new Map();
    for (const token of tokenize(text)) counts.set(token, (counts.get(token) || 0) + 1);
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
        .map(([term]) => term)
        .slice(0, limit);
}

function bridgeTerms(domain) {
    return (domain.terms || []).filter(term => !PIVOT_STOPWORDS.has(term) && !/^\d/.test(term));
}

function summarizeObject(value, max = 1000) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return truncate(value, max);
    return truncate(JSON.stringify(value), max);
}

function informative(summary = '') {
    const text = truncate(summary, 2000);
    if (!text || text === '[]' || text === '{}') return false;
    return tokenize(text).length >= 3;
}

function summarizeGameStats(stats = {}) {
    const efficacy = stats.strategyEfficacy || stats.efficacy || {};
    const entries = Object.entries(efficacy)
        .map(([name, value]) => {
            const matches = Number(value.totalMatches || value.matches || 0);
            const score = Number(value.totalSomaScore || value.score || 0);
            const wins = Number(value.somaWins || value.wins || 0);
            const avg = matches ? score / matches : 0;
            return { name, matches, wins, avg };
        })
        .filter(item => item.matches > 0)
        .sort((a, b) => b.avg - a.avg || b.wins - a.wins);
    if (!entries.length) return '';
    return entries.slice(0, 4)
        .map(item => `${item.name} has ${item.matches} trials, ${item.wins} wins, and average payoff ${item.avg.toFixed(2)}`)
        .join('; ');
}

function summarizeSocialMemory(memory = {}) {
    const profiles = memory.profiles && typeof memory.profiles === 'object' ? memory.profiles : {};
    const profileEntries = Object.values(profiles)
        .map(profile => ({
            handle: profile.handle,
            interactions: Number(profile.interactions || 0),
            replies: Number(profile.replies || 0),
            likes: Number(profile.likes || 0),
            topics: Object.keys(profile.topics || {}).slice(0, 5),
        }))
        .filter(profile => profile.handle && profile.interactions > 0)
        .sort((a, b) => b.interactions - a.interactions)
        .slice(0, 4);
    if (!profileEntries.length) return '';
    return profileEntries
        .map(profile => `${profile.handle}: ${profile.interactions} interactions, ${profile.replies} replies, ${profile.likes} likes, topics ${profile.topics.join('/') || 'unknown'}`)
        .join('; ');
}

function summarizeCyberKnowledge(knowledge = {}) {
    const text = summarizeObject(knowledge.cyber || knowledge.security || knowledge.threats || knowledge.vulnerabilities || '', 1200);
    return informative(text) ? text : '';
}

class CrossDomainSynthesisArbiter {
    constructor(options = {}) {
        this.name = options.name || 'CrossDomainSynthesisArbiter';
        this.loopInterval = Number(options.loopInterval || process.env.CROSS_DOMAIN_SYNTHESIS_INTERVAL_MS || 300000);
        this.initialDelay = Number(options.initialDelay || process.env.CROSS_DOMAIN_SYNTHESIS_INITIAL_DELAY_MS || 15000);
        this.endpoint = process.env.OLLAMA_ENDPOINT || options.ollamaEndpoint || 'http://127.0.0.1:11434';
        this.model = process.env.OLLAMA_MODEL || options.model || 'qwen2.5:7b';
        this.apiBase = options.apiBase || process.env.SOMA_LOCAL_API || DEFAULT_ENDPOINT;
        this.minDomains = Number(options.minDomains || 2);
        this.fetchTimeoutMs = Number(options.fetchTimeoutMs || 3500);
        this.autoStart = options.autoStart !== false && process.env.CROSS_DOMAIN_SYNTHESIS_AUTOSTART !== '0';
        this.timer = null;
        this.initialTimer = null;
        this.running = false;
        this.lastRun = null;
        this.stats = {
            cycles: 0,
            published: 0,
            duplicates: 0,
            llmSuccess: 0,
            heuristicFallbacks: 0,
            failedFetches: 0,
            lastError: null,
        };
        this.domains = options.domains || this.defaultDomains();
    }

    defaultDomains() {
        return [
            {
                id: 'macro',
                label: 'Macro Events',
                endpoint: `${this.apiBase}/api/macro-events/predictions`,
                fallback: () => {
                    const transitions = readJson(path.join(SOMA_DIR, 'world-model', 'transitions.json'), {});
                    const summary = summarizeObject(transitions.recent || transitions.transitions || transitions, 1200);
                    return {
                        summary: informative(summary) ? summary : '',
                        confidence: 0.45,
                        source: 'world-model/transitions.json',
                    };
                },
                normalize: data => {
                    const first = data?.predictions?.[0] || data?.data?.predictions?.[0] || data?.[0] || data;
                    return summarizeObject(first?.prediction || first?.summary || first, 1200);
                },
            },
            {
                id: 'cyber',
                label: 'Cyber Security',
                endpoint: `${this.apiBase}/api/cyber-sec/challenge`,
                fallback: () => {
                    const knowledge = readJson(path.join(SOMA_DIR, 'soma-knowledge.json'), {});
                    const summary = summarizeCyberKnowledge(knowledge);
                    return { summary, confidence: summary ? 0.35 : 0, source: 'soma-knowledge.json' };
                },
                normalize: data => summarizeObject(data?.challenge?.description || data?.data?.challenge || data?.description || data, 1200),
            },
            {
                id: 'gameTheory',
                label: 'Game Theory',
                endpoint: `${this.apiBase}/api/game-theory/stats`,
                fallback: () => {
                    const stats = readJson(path.join(process.cwd(), 'data', 'gameTheoryStats.json'), {});
                    const summary = summarizeGameStats(stats);
                    return {
                        summary,
                        confidence: 0.55,
                        source: 'data/gameTheoryStats.json',
                    };
                },
                normalize: data => summarizeObject(data?.data?.strategyEfficacy || data?.strategyEfficacy || data?.efficacy || data, 1200),
            },
            {
                id: 'social',
                label: 'Social Memory',
                fallback: () => {
                    const memory = readJson(path.join(SOMA_DIR, 'social-media', 'social-memory.json'), {});
                    const recent = summarizeSocialMemory(memory) || summarizeObject(memory.recent || memory.patterns || memory.topics || '', 1200);
                    return {
                        summary: summarizeObject(recent, 1200),
                        confidence: 0.35,
                        source: 'SOMA/social-media/social-memory.json',
                    };
                },
                normalize: data => summarizeObject(data, 1200),
            },
        ];
    }

    async initialize() {
        console.log(`[${this.name}] Initializing...`);

        messageBroker.registerArbiter(this.name, {
            instance: this,
            type: 'synthesis',
            lobe: 'cognitive',
            tier: 'strategic',
            status: 'active',
            capabilities: [
                'cross_domain_synthesis',
                'insight_generation',
                'evidence_scoring',
                'novelty_detection',
            ],
        });

        if (typeof messageBroker.subscribe === 'function') {
            messageBroker.subscribe('cross_domain:synthesize', async payload => {
                await this.runSynthesisCycle({ reason: payload?.reason || 'broker_request' });
            });
        }

        if (this.autoStart) this.startAutonomousLoop();
        console.log(`[${this.name}] Ready${this.autoStart ? `; loop ${this.loopInterval}ms` : '; autostart disabled'}.`);
        return true;
    }

    startAutonomousLoop() {
        if (this.timer || this.initialTimer) return false;
        this.initialTimer = setTimeout(() => {
            this.initialTimer = null;
            this.runSynthesisCycle({ reason: 'initial_delay' }).catch(e => {
                console.error(`[${this.name}] Initial cycle error:`, e.message);
            });
        }, this.initialDelay);

        this.timer = setInterval(() => {
            this.runSynthesisCycle({ reason: 'interval' }).catch(e => {
                console.error(`[${this.name}] Autonomous loop error:`, e.message);
            });
        }, this.loopInterval);
        return true;
    }

    stopAutonomousLoop() {
        if (this.initialTimer) clearTimeout(this.initialTimer);
        if (this.timer) clearInterval(this.timer);
        this.initialTimer = null;
        this.timer = null;
        return true;
    }

    async collectDomain(domain) {
        let apiError = null;
        if (domain.endpoint) {
            try {
                const data = await this.fetchJson(domain.endpoint);
                const summary = domain.normalize ? domain.normalize(data) : summarizeObject(data);
                if (informative(summary)) {
                    return {
                        id: domain.id,
                        label: domain.label,
                        ok: true,
                        source: domain.endpoint,
                        confidence: 0.75,
                        summary,
                        terms: topTerms(summary),
                    };
                }
            } catch (error) {
                apiError = error.message;
                this.stats.failedFetches++;
            }
        }

        if (typeof domain.fallback === 'function') {
            try {
                const fallback = domain.fallback() || {};
                if (informative(fallback.summary)) {
                    return {
                        id: domain.id,
                        label: domain.label,
                        ok: true,
                        source: fallback.source || 'local-fallback',
                        confidence: clamp01(fallback.confidence || 0.35),
                        summary: fallback.summary,
                        terms: topTerms(fallback.summary),
                        apiError,
                    };
                }
            } catch (error) {
                apiError = apiError || error.message;
            }
        }

        return {
            id: domain.id,
            label: domain.label,
            ok: false,
            source: domain.endpoint || 'local-fallback',
            confidence: 0,
            summary: '',
            terms: [],
            error: apiError || 'no data',
        };
    }

    async gatherContext() {
        const domains = await Promise.all(this.domains.map(domain => this.collectDomain(domain)));
        const active = domains.filter(domain => domain.ok && domain.summary);
        return { domains, active };
    }

    buildPrompt(activeDomains) {
        const evidence = activeDomains.map(domain => [
            `${domain.label.toUpperCase()} (${domain.source}, confidence ${domain.confidence.toFixed(2)})`,
            domain.summary,
            `Terms: ${domain.terms.join(', ')}`,
        ].join('\n')).join('\n\n');

        return `You are SOMA's cross-domain synthesis arbiter. Create one grounded transfer insight from the evidence below.

Rules:
- Do not claim ASI, certainty, or hidden knowledge.
- Use only the evidence provided.
- Name the actual domains being connected.
- Provide one testable implication.
- Return strict JSON with keys: synthesis, actionable, hypothesis, domains, confidence, failure_mode.

Evidence:
${evidence}`;
    }

    async callLLM(activeDomains) {
        const prompt = this.buildPrompt(activeDomains);
        const response = await this.fetchJson(`${this.endpoint}/api/chat`, 12000, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: 'You produce terse, evidence-grounded JSON. No markdown.' },
                    { role: 'user', content: prompt },
                ],
                stream: false,
            }),
        });
        return response?.message?.content || response?.response || '';
    }

    async fetchJson(url, timeoutMs = this.fetchTimeoutMs, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    parseLLMResult(text, activeDomains) {
        const raw = String(text || '').trim().replace(/^```json\s*|\s*```$/g, '');
        try {
            const parsed = JSON.parse(raw);
            return this.normalizeInsight(parsed, activeDomains, 'llm');
        } catch {}

        const synthesis = raw.match(/SYNTHESIS:\s*([\s\S]+?)(?=\nACTIONABLE:|\nHYPOTHESIS:|$)/i)?.[1]?.trim() || raw.slice(0, 400);
        const actionable = raw.match(/ACTIONABLE:\s*([\s\S]+?)(?=\nHYPOTHESIS:|$)/i)?.[1]?.trim() || 'Log observation and watch for confirmation.';
        const hypothesis = raw.match(/HYPOTHESIS:\s*([\s\S]+?)$/i)?.[1]?.trim() || actionable;
        return this.normalizeInsight({ synthesis, actionable, hypothesis }, activeDomains, 'llm_unstructured');
    }

    heuristicSynthesis(activeDomains) {
        const [primary, secondary, tertiary] = [...activeDomains]
            .sort((a, b) => b.confidence - a.confidence || b.terms.length - a.terms.length);
        const sharedTerms = [];
        for (const left of activeDomains) {
            for (const right of activeDomains) {
                if (left.id >= right.id) continue;
                const rightTerms = new Set(bridgeTerms(right));
                const overlap = bridgeTerms(left).filter(term => rightTerms.has(term));
                sharedTerms.push(...overlap);
            }
        }
        const pivot = [...new Set(sharedTerms)][0] || bridgeTerms(primary)[0] || bridgeTerms(secondary)[0] || 'pressure';
        const synthesis = `${primary.label} and ${secondary.label} appear connected through ${pivot}: pressure in one domain can change incentives, timing, or defensive posture in the other.`;
        const actionable = tertiary
            ? `Watch ${tertiary.label} for confirmation that ${pivot} is becoming a cross-domain driver rather than a local signal.`
            : `Track whether ${pivot} appears again before treating it as a durable transfer pattern.`;
        const hypothesis = `If ${pivot} is a real bridge variable, updates in ${primary.label} should precede measurable changes in ${secondary.label}'s next local cycle.`;
        return this.normalizeInsight({ synthesis, actionable, hypothesis, confidence: 0.62, failure_mode: 'No predictive transfer appears on the next domain update.' }, activeDomains, 'heuristic');
    }

    normalizeInsight(input, activeDomains, source) {
        const domains = Array.isArray(input.domains) && input.domains.length
            ? input.domains.map(String)
            : activeDomains.map(domain => domain.id);
        const synthesis = truncate(input.synthesis || input.insight || '', 1200);
        const actionable = truncate(input.actionable || input.action || '', 800);
        const hypothesis = truncate(input.hypothesis || actionable, 800);
        const failureMode = truncate(input.failure_mode || input.failureMode || 'The predicted cross-domain signal fails to recur.', 500);
        const evidence = activeDomains.map(domain => ({
            id: domain.id,
            label: domain.label,
            source: domain.source,
            confidence: domain.confidence,
            terms: domain.terms.slice(0, 8),
            summary: domain.summary.slice(0, 500),
        }));
        return {
            id: stableId('cds', `${synthesis}|${actionable}|${Date.now()}`),
            source,
            synthesis,
            actionable,
            hypothesis,
            failureMode,
            domains,
            evidence,
            confidence: clamp01(input.confidence || this.estimateConfidence({ synthesis, actionable, hypothesis, evidence })),
            createdAt: Date.now(),
        };
    }

    estimateConfidence({ synthesis, actionable, hypothesis, evidence }) {
        const evidenceScore = Math.min(0.35, evidence.length * 0.11);
        const actionScore = /\b(watch|test|track|compare|measure|route|delay|prioritize|avoid|confirm)\b/i.test(actionable) ? 0.2 : 0.08;
        const hypothesisScore = hypothesis && hypothesis !== actionable ? 0.18 : 0.08;
        const specificityScore = topTerms(`${synthesis} ${actionable}`, 8).length >= 5 ? 0.18 : 0.08;
        return clamp01(Math.min(0.86, 0.15 + evidenceScore + actionScore + hypothesisScore + specificityScore));
    }

    scoreNovelty(insight, recent) {
        const currentTerms = tokenize(`${insight.synthesis} ${insight.actionable} ${insight.hypothesis}`);
        const overlaps = recent.map(item => overlapRatio(currentTerms, tokenize(`${item.synthesis} ${item.actionable} ${item.hypothesis}`)));
        const maxOverlap = Math.max(0, ...overlaps);
        return Number(clamp01(1 - maxOverlap).toFixed(2));
    }

    loadLedger() {
        return readJson(LEDGER_FILE, { insights: [], updatedAt: null });
    }

    saveInsight(insight) {
        const ledger = this.loadLedger();
        ledger.insights = Array.isArray(ledger.insights) ? ledger.insights : [];
        const novelty = this.scoreNovelty(insight, ledger.insights.slice(0, 50));
        const finalInsight = {
            ...insight,
            novelty,
            status: novelty < 0.28 ? 'duplicate_observed' : 'published',
        };
        ledger.insights.unshift(finalInsight);
        ledger.insights = ledger.insights.slice(0, MAX_LEDGER_ITEMS);
        ledger.updatedAt = Date.now();
        writeJson(LEDGER_FILE, ledger);
        return finalInsight;
    }

    publishInsight(insight) {
        messageBroker.publish('soma.activity', {
            type: 'cross_domain_synthesis',
            title: insight.status === 'published' ? 'Cross-Domain Synthesis Generated' : 'Cross-Domain Duplicate Observed',
            summary: insight.actionable,
            details: insight.synthesis,
            confidence: insight.confidence,
            novelty: insight.novelty,
            domains: insight.domains,
            evidence: insight.evidence,
        });

        if (insight.status === 'published') {
            messageBroker.publish('knowledge:add', {
                concept: insight.hypothesis || insight.actionable,
                domain: 'cross_domain',
                confidence: insight.confidence,
                metadata: {
                    synthesis: insight.synthesis,
                    actionable: insight.actionable,
                    domains: insight.domains,
                    novelty: insight.novelty,
                    evidence: insight.evidence.map(item => item.source),
                },
            });
            this.routeInsightActions(insight);
        }
    }

    routeInsightActions(insight) {
        const text = `${insight.synthesis} ${insight.actionable} ${insight.hypothesis}`.toLowerCase();
        const parents = insight.domains || [];

        messageBroker.publish('insight.generated', {
            insight: insight.hypothesis || insight.synthesis,
            source: 'CrossDomainSynthesisArbiter',
            rationale: insight.actionable,
            parents,
            confidence: insight.confidence,
            evidence: insight.evidence,
        }).catch(() => {});

        messageBroker.publish('curiosity:stimulate', {
            topic: insight.hypothesis || insight.synthesis,
            source: 'CrossDomainSynthesisArbiter',
            strength: Math.max(0.35, insight.confidence || 0.5),
            evidence: insight.evidence,
        }).catch(() => {});

        const selfImprovementSignal = /\b(arbiter|loader|memory|redis|sqlite|vector|latency|deadlock|loop|verification|self-mod|self modification|capability|routing|test|sandbox|code)\b/i.test(text);
        if (selfImprovementSignal && insight.confidence >= 0.55) {
            const opportunity = {
                type: 'cross_domain_self_improvement_opportunity',
                source: 'CrossDomainSynthesisArbiter',
                title: `Investigate synthesis: ${(insight.hypothesis || insight.synthesis).slice(0, 90)}`,
                description: [
                    insight.synthesis,
                    `Actionable: ${insight.actionable}`,
                    `Failure mode: ${insight.failureMode}`,
                ].join('\n'),
                confidence: insight.confidence,
                novelty: insight.novelty,
                evidence: insight.evidence,
            };
            messageBroker.publish('self_modification.opportunity', opportunity).catch(() => {});
            messageBroker.sendMessage({
                from: this.name,
                to: 'GoalPlannerArbiter',
                type: 'create_goal',
                payload: {
                    title: opportunity.title,
                    description: opportunity.description,
                    category: 'self_improvement',
                    priority: Math.round(55 + Math.min(35, insight.confidence * 35)),
                    confidence: insight.confidence,
                    evidence: insight.evidence,
                    successCriteria: [
                        'Identify the concrete code path or operational loop implicated by the synthesis.',
                        'Run a bounded test or inspection that can falsify the hypothesis.',
                        'Only propose code changes through the self-modification sandbox and review path.',
                    ],
                    metadata: {
                        source: 'cross_domain_synthesis',
                        insightId: insight.id,
                        novelty: insight.novelty,
                    },
                },
            }).catch(() => {});
        }
    }

    async runSynthesisCycle(options = {}) {
        if (this.running) return { ok: false, skipped: true, reason: 'already_running' };
        this.running = true;
        this.stats.cycles++;
        const startedAt = Date.now();

        try {
            console.log(`[${this.name}] Gathering cross-domain state...`);
            const context = await this.gatherContext();

            if (context.active.length < this.minDomains) {
                const result = {
                    ok: false,
                    reason: 'insufficient_domains',
                    activeDomains: context.active.map(domain => domain.id),
                    failedDomains: context.domains.filter(domain => !domain.ok).map(domain => ({ id: domain.id, error: domain.error })),
                };
                this.lastRun = { ...result, durationMs: Date.now() - startedAt, at: Date.now() };
                console.log(`[${this.name}] Not enough domain context for synthesis. Active=${context.active.length}.`);
                return result;
            }

            let insight;
            try {
                const llmText = await this.callLLM(context.active);
                insight = this.parseLLMResult(llmText, context.active);
                this.stats.llmSuccess++;
            } catch (error) {
                this.stats.heuristicFallbacks++;
                insight = this.heuristicSynthesis(context.active);
                insight.llmError = error.message;
            }

            insight.reason = options.reason || 'cycle';
            const saved = this.saveInsight(insight);
            if (saved.status === 'published') this.stats.published++;
            else this.stats.duplicates++;

            this.publishInsight(saved);
            this.lastRun = {
                ok: true,
                id: saved.id,
                status: saved.status,
                confidence: saved.confidence,
                novelty: saved.novelty,
                domains: saved.domains,
                source: saved.source,
                durationMs: Date.now() - startedAt,
                at: Date.now(),
            };

            console.log(`[${this.name}] ${saved.status}: ${saved.synthesis.slice(0, 120)}...`);
            return { ok: true, insight: saved, context };
        } catch (error) {
            this.stats.lastError = error.message;
            this.lastRun = { ok: false, error: error.message, durationMs: Date.now() - startedAt, at: Date.now() };
            console.error(`[${this.name}] Synthesis failed:`, error.message);
            return this.lastRun;
        } finally {
            this.running = false;
        }
    }

    async synthesizeNow(options = {}) {
        return await this.runSynthesisCycle({ ...options, reason: options.reason || 'manual' });
    }

    getLedger(limit = 25) {
        const ledger = this.loadLedger();
        return {
            ok: true,
            ledgerFile: LEDGER_FILE,
            insights: (ledger.insights || []).slice(0, limit),
            updatedAt: ledger.updatedAt || null,
        };
    }

    getStatus() {
        const ledger = this.loadLedger();
        return {
            ok: true,
            name: this.name,
            running: this.running,
            autoStart: this.autoStart,
            loopInterval: this.loopInterval,
            model: this.model,
            apiBase: this.apiBase,
            domains: this.domains.map(domain => ({ id: domain.id, label: domain.label, endpoint: domain.endpoint || null })),
            stats: this.stats,
            lastRun: this.lastRun,
            ledgerFile: LEDGER_FILE,
            insights: Array.isArray(ledger.insights) ? ledger.insights.length : 0,
            recent: (ledger.insights || []).slice(0, 5),
        };
    }
}

module.exports = CrossDomainSynthesisArbiter;
