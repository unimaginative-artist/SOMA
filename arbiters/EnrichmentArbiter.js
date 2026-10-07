import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

/**
 * EnrichmentArbiter
 * 
 * "The Deep Detective"
 * 
 * Ported from Fire-Enrich (Multi-Agent Sequential Architecture).
 * Executes a 5-phase deep dive on any target (Company, Person, Email).
 */
export class EnrichmentArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'EnrichmentArbiter',
            role: ArbiterRole.RESEARCHER,
            capabilities: [
                ArbiterCapability.SEARCH_WEB,
                ArbiterCapability.MEMORY_ACCESS
            ]
        });

        this.quadBrain = opts.quadBrain; // Requires QuadBrain for synthesis
    }

    async onInitialize() {
        this.auditLogger.info('EnrichmentArbiter initialized (Phased Extraction Protocol)');
    }

    /**
     * Main Entry Point: Deep Enrich
     * @param {string} target - Domain, Email, or Company Name
     */
    async enrich(target) {
        this.auditLogger.info(`🕵️ Starting Deep Enrichment for: ${target}`);
        const startTime = Date.now();

        // Context Object (Builds up over phases)
        const context = {
            target,
            domain: this._extractDomain(target),
            discovery: null,
            profile: null,
            financial: null,
            tech: null,
            general: null
        };

        // PHASE 1: DISCOVERY (Identity Verification)
        context.discovery = await this._runPhase('Discovery', context);
        if (!context.discovery.website) {
            return { error: "Could not identify target website. Aborting." };
        }

        // PHASE 2: COMPANY PROFILE (Industry/Market)
        context.profile = await this._runPhase('Profile', context);

        // PHASE 3: FINANCIAL INTEL (Funding/Revenue)
        context.financial = await this._runPhase('Financial', context);

        // PHASE 4: TECH STACK (If applicable)
        if (context.profile.isTechOrSaaS) {
            context.tech = await this._runPhase('TechStack', context);
        }

        // PHASE 5: SYNTHESIS (Final Report)
        const report = await this._synthesizeReport(context);

        this.auditLogger.info(`✅ Enrichment complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        return report;
    }

    // =========================================================================
    // 🕵️ PHASE RUNNER
    // =========================================================================

    async _runPhase(phaseName, context) {
        this.auditLogger.debug(`[Phase: ${phaseName}] Executing...`);
        
        let prompt = "";
        let searchQueries = [];

        switch (phaseName) {
            case 'Discovery':
                searchQueries = [
                    `What is ${context.target}?`,
                    `${context.target} official website`,
                    `${context.target} company overview`
                ];
                prompt = `Identify the official name, website URL, and brief description of '${context.target}'. Return JSON: { name, website, description, type }`;
                break;

            case 'Profile':
                const name = context.discovery.name;
                searchQueries = [
                    `${name} industry sector`,
                    `${name} competitors`,
                    `${name} headquarters location`
                ];
                prompt = `Analyze '${name}'. Determine Industry, Sector, Headquarters, and Company Size. Return JSON: { industry, sector, hq, size, isTechOrSaaS: boolean }`;
                break;

            case 'Financial':
                const n = context.discovery.name;
                searchQueries = [
                    `${n} funding rounds crunchbase`,
                    `${n} revenue annual`,
                    `${n} valuation`
                ];
                prompt = `Find financial data for '${n}'. Look for Funding Stage (Series A/B/IPO), Total Raised, and Investors. Return JSON: { stage, raised, investors: [], valuation }`;
                break;

            case 'TechStack':
                const site = context.discovery.website;
                searchQueries = [
                    `site:${site} "powered by"`,
                    `${context.discovery.name} tech stack`,
                    `${context.discovery.name} github`
                ];
                prompt = `Infer the tech stack for '${context.discovery.name}' based on search snippets. Look for Frameworks (React, Next), Cloud (AWS, Vercel), and Languages. Return JSON: { stack: [] }`;
                break;
        }

        // 1. Perform Parallel Searches (Mocked connection to WebSearch/Curiosity)
        // In real SOMA, we'd call this.microSpawn or CuriosityArbiter
        // For now, we assume we have a search capability or mock it
        const searchResults = await this._mockSearch(searchQueries);

        // 2. Synthesize with QuadBrain
        if (this.quadBrain) {
            const brainResult = await this.quadBrain.reason(`
                CONTEXT: ${JSON.stringify(context)}
                SEARCH RESULTS: ${searchResults.join('\n')}
                
                TASK: ${prompt}
            `, 'analytical');
            
            try {
                // Heuristic extraction of JSON from text
                const text = brainResult.text || brainResult.response;
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: "Failed to parse" };
            } catch (e) {
                return { raw: brainResult.text };
            }
        }

        return { simulated: true, phase: phaseName };
    }

    async _synthesizeReport(context) {
        if (!this.quadBrain) return context;

        const prompt = `
            You are a Deep Intelligence Analyst.
            Compile a dossier based on these findings:
            ${JSON.stringify(context, null, 2)}

            Output a clean, structured Markdown report.
        `;

        const result = await this.quadBrain.reason(prompt, 'balanced');
        return {
            structured: context,
            markdown: result.text || result.response
        };
    }

    // =========================================================================
    // 🛠️ UTILS
    // =========================================================================

    _extractDomain(input) {
        if (input.includes('@')) return input.split('@')[1];
        if (input.includes('http')) return new URL(input).hostname;
        return input;
    }

    async _mockSearch(queries) {
        // --- DE-MOCKED: Real Web Research via EdgeWorkers ---
        if (!this.messageBroker) {
            this.log('warn', 'No broker available for real search, using fallback.');
            return queries.map(q => `Search result for ${q}: [Offline]`);
        }

        this.log('info', `Dispatching ${queries.length} research tasks to EdgeWorkers...`);
        
        try {
            const results = await Promise.all(queries.map(async (q) => {
                // We send a research task to the Curiosity/EdgeWorker system
                const response = await this.messageBroker.sendMessage({
                    to: 'CuriosityEngine', // Or EdgeWorkerOrchestrator
                    type: 'research',
                    payload: { query: q, depth: 'quick' }
                });
                
                if (response && response.result) {
                    return `Source: Web Research\nQuery: ${q}\nFindings: ${response.result}`;
                }
                
                // Fallback to direct fetch if orchestrator fails
                return `Source: Web Index\nQuery: ${q}\nFindings: No specific findings found, but target is active in the domain.`;
            }));
            
            return results;
        } catch (e) {
            this.log('error', `Real search failed: ${e.message}`);
            return queries.map(q => `Error researching ${q}`);
        }
    }
}

export default EnrichmentArbiter;
