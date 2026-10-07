import EventEmitter from 'events';
import { createRequire } from 'module';
import UniversalLearningPipeline from './UniversalLearningPipeline.js';
import simulationLedger from '../core/SimulationAutonomyLedger.cjs';
import rippleLoopLedger from '../core/RippleLoopLedger.js';
import messageBroker from '../core/MessageBroker.cjs';

const require = createRequire(import.meta.url);
const { BraveSearchAdapter } = require('../cognitive/BraveSearchAdapter.cjs');

export class CyberSecArbiter extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name = 'CyberSecArbiter';
        try {
            this.searchAdapter = new BraveSearchAdapter();
        } catch (error) {
            console.warn(`[${this.name}] Brave search unavailable: ${error.message}`);
            this.searchAdapter = null;
        }
        this.learningPipeline = config.learningPipeline || new UniversalLearningPipeline();
        this.currentChallenge = null;
        this.startAutonomousLoop();
    }

    startAutonomousLoop() {
        setInterval(async () => {
            try {
                await this.generateChallenge();
            } catch (e) {
                console.error(`[${this.name}] Autonomous loop error:`, e.message);
            }
        }, 60000); // Poll for a new CVE every 60 seconds
        
        setTimeout(() => this.generateChallenge().catch(e => {}), 10000);
    }

    async generateChallenge() {
        try {
            console.log(`[${this.name}] Fetching recent CVEs or advisories...`);
            const searchResults = this.searchAdapter
                ? await this.searchAdapter.searchWeb('recent CVEs GitHub advisories attack vector exploit', { maxResults: 10 })
                : { success: false, results: [] };
            const results = Array.isArray(searchResults?.results) ? searchResults.results : [];
            
            const selectedCve = results.length
                ? results[Math.floor(Math.random() * results.length)]
                : this.buildFallbackChallengeSource();
            
            const analysis = await this.analyzeVulnerability(selectedCve);

            const cveId = this.extractCveId(`${selectedCve.title || ''} ${selectedCve.snippet || ''}`)
                || `LOCAL-CVE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-5)}`;
            this.currentChallenge = {
                id: Date.now().toString(),
                cveId,
                title: selectedCve.title || 'Unknown CVE',
                description: selectedCve.snippet || 'No description available.',
                url: selectedCve.url || '#',
                attackVector: analysis.attackVector,
                confidence: analysis.confidence,
                cwe: this.inferCwe(analysis.attackVector),
                mitigation: this.inferMitigation(analysis.attackVector),
                source: results.length ? 'brave-search' : 'local-fallback',
                status: 'active'
            };
            this.recordChallengeEvidence(this.currentChallenge);
            rippleLoopLedger.recordCyberRipple(this.currentChallenge);

            // Log the generation to the UniversalLearningPipeline
            if (this.learningPipeline && typeof this.learningPipeline.logInteraction === 'function') {
                await this.learningPipeline.logInteraction({
                    type: 'cybersec_challenge_generation',
                    agent: this.name,
                    input: selectedCve.snippet,
                    output: analysis,
                    metadata: {
                        success: true,
                        cveUrl: selectedCve.url
                    }
                });
            }

            // Emit to MessageBroker so RedTeam / AdversarialSelfCorrectionArbiter can intercept it
            if (messageBroker) {
                messageBroker.publish('cybersec_challenge_generation', this.currentChallenge);
            }

            return this.currentChallenge;
        } catch (error) {
            console.error(`[${this.name}] Error generating challenge:`, error.message);
            const fallback = this.buildFallbackChallengeSource();
            const analysis = await this.analyzeVulnerability(fallback);
            this.currentChallenge = {
                id: Date.now().toString(),
                cveId: `LOCAL-CVE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-5)}`,
                title: fallback.title,
                description: fallback.snippet,
                url: fallback.url,
                attackVector: analysis.attackVector,
                confidence: analysis.confidence,
                cwe: this.inferCwe(analysis.attackVector),
                mitigation: this.inferMitigation(analysis.attackVector),
                source: 'local-error-fallback',
                status: 'active',
                error: error.message
            };
            this.recordChallengeEvidence(this.currentChallenge);
            rippleLoopLedger.recordCyberRipple(this.currentChallenge);
            return this.currentChallenge;
        }
    }

    recordChallengeEvidence(challenge) {
        simulationLedger.appendEvidence({
            module: 'netrunner',
            kind: 'security_challenge',
            status: 'active',
            primaryBrain: 'LOGOS',
            brainLanes: ['LOGOS', 'THALAMUS', 'PROMETHEUS', 'MNEMOSYNE'],
            learningTargets: ['threat_modeling', 'risk_detection', 'defensive_reasoning'],
            fallbackUsed: String(challenge.source || '').includes('fallback'),
            externalFailure: Boolean(challenge.error),
            summary: `${challenge.cveId}: ${challenge.attackVector} (${challenge.cwe || 'CWE unknown'})`,
            evidence: [
                challenge.title,
                challenge.description,
                `Mitigation: ${challenge.mitigation}`
            ],
            metrics: {
                confidence: challenge.confidence,
                score: challenge.confidence || 0.3
            },
            riskSignals: {
                attackVector: challenge.attackVector,
                cwe: challenge.cwe,
                mitigation: challenge.mitigation,
                source: challenge.source
            },
            rawRef: 'runtime:CyberSecArbiter.currentChallenge'
        });
    }

    extractCveId(text = '') {
        const match = String(text).match(/\bCVE-\d{4}-\d{4,}\b/i);
        return match ? match[0].toUpperCase() : null;
    }

    buildFallbackChallengeSource() {
        const samples = [
            {
                title: 'CVE-style advisory: unauthenticated request reaches admin export path',
                snippet: 'A web service exposes an admin export endpoint without checking session authority. A remote attacker can request sensitive records by guessing predictable export identifiers.',
                url: '#local-netrunner-auth-bypass'
            },
            {
                title: 'CVE-style advisory: template field is rendered without escaping',
                snippet: 'User-controlled profile text is inserted into a server-side template and rendered into the browser without output encoding, allowing script execution in another user session.',
                url: '#local-netrunner-xss'
            },
            {
                title: 'CVE-style advisory: archive extraction trusts relative paths',
                snippet: 'A package import feature extracts uploaded archives without validating path traversal sequences, allowing files to be written outside the intended workspace.',
                url: '#local-netrunner-path-traversal'
            }
        ];
        return samples[Math.floor(Math.random() * samples.length)];
    }

    async analyzeVulnerability(cve) {
        const text = ((cve.title || "") + " " + (cve.snippet || ""));
        
        const endpoint = process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434";
        const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";

        try {
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
                        { role: "system", content: "You are a senior cybersecurity analyst identifying attack vectors from CVE descriptions. Respond with ONLY the exact name of the primary attack vector (e.g. 'SQL Injection', 'Remote Code Execution', 'Buffer Overflow', 'Cross-Site Scripting'). No conversational text." },
                        { role: "user", content: `Analyze this CVE: ${text}` }
                    ],
                    stream: false,
                    keep_alive: process.env.SOMA_BACKGROUND_OLLAMA_KEEP_ALIVE || "15s"
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);
            
            const vector = data.message.content.trim();
            return {
                attackVector: vector,
                confidence: 0.85
            };
        } catch (error) {
            console.error("[CyberSecArbiter] LLM analysis failed:", error.message);
            return this.inferAttackVector(text);
        }
    }

    inferAttackVector(text = '') {
        const lower = String(text).toLowerCase();
        if (lower.includes('template') || lower.includes('script') || lower.includes('browser') || lower.includes('xss')) {
            return { attackVector: "Cross-Site Scripting", confidence: 0.65 };
        }
        if (lower.includes('archive') || lower.includes('path traversal') || lower.includes('relative path') || lower.includes('outside the intended workspace')) {
            return { attackVector: "Path Traversal", confidence: 0.65 };
        }
        if (lower.includes('unauthenticated') || lower.includes('authority') || lower.includes('admin') || lower.includes('access control')) {
            return { attackVector: "Broken Access Control", confidence: 0.65 };
        }
        if (lower.includes('sql') || lower.includes('database query')) {
            return { attackVector: "SQL Injection", confidence: 0.65 };
        }
        if (lower.includes('buffer') || lower.includes('memory corruption')) {
            return { attackVector: "Buffer Overflow", confidence: 0.6 };
        }
        if (lower.includes('remote code') || lower.includes('command execution') || lower.includes('rce')) {
            return { attackVector: "Remote Code Execution", confidence: 0.65 };
        }
        return { attackVector: "Unknown", confidence: 0.3 };
    }

    inferCwe(attackVector = '') {
        const vector = String(attackVector).toLowerCase();
        if (vector.includes('cross-site scripting')) return 'CWE-79';
        if (vector.includes('path traversal')) return 'CWE-22';
        if (vector.includes('access control')) return 'CWE-284';
        if (vector.includes('sql injection')) return 'CWE-89';
        if (vector.includes('buffer overflow')) return 'CWE-120';
        if (vector.includes('remote code execution')) return 'CWE-94';
        return 'CWE-Other';
    }

    inferMitigation(attackVector = '') {
        const vector = String(attackVector).toLowerCase();
        if (vector.includes('cross-site scripting')) return 'Apply contextual output encoding, sanitize rich text, and enforce CSP.';
        if (vector.includes('path traversal')) return 'Canonicalize paths, reject traversal sequences, and confine extraction to an allowlisted root.';
        if (vector.includes('access control')) return 'Require server-side authorization checks on every privileged object and endpoint.';
        if (vector.includes('sql injection')) return 'Use parameterized queries, typed query builders, and least-privilege database credentials.';
        if (vector.includes('buffer overflow')) return 'Patch bounds checks, enable memory-safe compiler flags, and prefer memory-safe components.';
        if (vector.includes('remote code execution')) return 'Disable unsafe evaluation paths, patch vulnerable parsers, and sandbox execution.';
        return 'Collect more evidence, identify the vulnerable trust boundary, and apply least-privilege containment.';
    }

    async submitAnswer(challengeId, userAnswer) {
        if (!this.currentChallenge || this.currentChallenge.id !== challengeId.toString()) {
            throw new Error("Invalid or inactive challenge ID");
        }

        const isCorrect = userAnswer.toLowerCase() === this.currentChallenge.attackVector.toLowerCase();
        
        if (this.learningPipeline && typeof this.learningPipeline.logInteraction === 'function') {
            await this.learningPipeline.logInteraction({
                type: 'cybersec_challenge_answer',
                agent: this.name,
                input: userAnswer,
                output: { correct: isCorrect, expected: this.currentChallenge.attackVector },
                metadata: {
                    success: isCorrect,
                    userSatisfaction: isCorrect ? 1.0 : -0.5
                }
            });
        }

        return { correct: isCorrect, expected: this.currentChallenge.attackVector };
    }
}

export default CyberSecArbiter;
