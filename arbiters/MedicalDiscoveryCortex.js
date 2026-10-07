import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

/**
 * MedicalDiscoveryCortex.js
 * 
 * Orchestrates autonomous medical research across diverse sources.
 * Integrated with Graphify for local semantic bridge discovery.
 */
export class MedicalDiscoveryCortex extends BaseArbiterV4 {
  constructor(config = {}) {
    super({
      name: 'MedicalDiscoveryCortex',
      role: ArbiterRole.RESEARCHER,
      capabilities: [ArbiterCapability.SEARCH_WEB, 'autonomous_discovery', 'graph_mechanistic_analysis'],
      ...config
    });

    this.dendrite = config.system?.braveSearch || null;
    this.scraper = config.system?.webScraperDendrite || null;
    this.quadBrain = config.quadBrain;
    this.graphify = config.graphify; // Link to GraphifyArbiter
  }

  async onInitialize() {
    this.log('info', '🔬 Medical Discovery Cortex active. Graphify-enhanced analysis enabled.');
  }

  async _callLogos(prompt) {
    if (this.quadBrain?.callBrain) {
      const res = await this.quadBrain.callBrain('LOGOS', prompt, { temperature: 0.2 }, 'full');
      return res.text || res.response || String(res || '');
    }
    if (this.quadBrain?.reason) {
      const res = await this.quadBrain.reason(prompt, { activeLobe: 'LOGOS', brain: 'LOGOS', temperature: 0.2 });
      return res.text || res.response || String(res || '');
    }
    throw new Error('No LOGOS-capable brain interface is available');
  }

  /**
   * Autonomous research mission - Sovereign Grade Combinatorial Analysis
   */
  async conductResearch(topic, stack = []) {
    this.log('info', `🔎 Initiating Sovereign Research Mission: "${topic}"`);
    this.log('info', `🧪 Combinatorial Context: [${stack.join(', ')}]`);
    
    // 0. PHASE 0: Local Graph mechanistic discovery
    let graphInsights = null;
    if (this.graphify) {
        this.log('info', '🕸️ Checking local knowledge graph for mechanistic bridges...');
        const query = `Find mechanistic connections between ${topic} and ${stack.join(', ')} regarding enzymes, pathways, or mitochondrial impact.`;
        const graphRes = await this.graphify.query(query);
        if (graphRes.success) {
            graphInsights = graphRes.raw;
        }
    }

    // 1. PHASE A: Mechanistic Deep Dive (Enzymes, Pathways)
    const mechanisticResults = await this._searchMechanistic(topic, stack);
    
    // 2. PHASE B: Combinatorial Synergy (How they interact)
    const synergyResults = await this._searchSynergy(topic, stack);
    
    // 3. PHASE C: Community Stack-Trading (Advanced anecdotes)
    const communityResults = await this._searchAdvancedCommunity(topic, stack);

    const allResults = [...mechanisticResults, ...synergyResults, ...communityResults];

    // 4. Synthesis: Combinatorial Dossier
    const synthesis = await this._synthesizeCombinatorial(topic, stack, allResults, graphInsights);
    
    // 🔱 LEARNING LOOP TRIGGER
    if (this.messageBroker) {
        this.messageBroker.publish('research_discovery_complete', {
            topic,
            stack,
            synthesis,
            importance: 0.95 // Sovereign grade is always high priority
        });
    }

    return synthesis;
  }

  async _searchMechanistic(topic, stack) {
    if (!this.dendrite) return [];
    // Search for the metabolic "bridge" between the compounds
    const query = `${topic} ${stack.join(' ')} enzymatic pathways mitochondria ATP synthesis mTOR`;
    const res = await this.dendrite.search(query);
    return (res.results || []).map(r => ({ ...r, tier: 'mechanistic' }));
  }

  async _searchSynergy(topic, stack) {
    if (!this.dendrite) return [];
    // Specifically looking for "Potentiation" and "Contraindications"
    const query = `${topic} potentiation with ${stack.join(' and ')} synergetic effects proteomics`;
    const res = await this.dendrite.search(query);
    return (res.results || []).map(r => ({ ...r, tier: 'synergy' }));
  }

  async _searchAdvancedCommunity(topic, stack) {
    if (!this.dendrite) return [];
    // Scrape advanced forums (Longecity, specialized subreddits)
    const query = `site:longecity.org OR site:reddit.com/r/nootropics "${topic}" "${stack[0]}" interaction report`;
    const res = await this.dendrite.search(query);
    return (res.results || []).map(r => ({ ...r, tier: 'advanced_community' }));
  }

  async _synthesizeCombinatorial(topic, stack, results, graphInsights = null) {
    const prompt = `You are SOMA's Sovereign Medical Researcher. 
                    Main Topic: "${topic}"
                    Current Stack: ${stack.join(', ')}
                    
                    ${graphInsights ? `LOCAL KNOWLEDGE GRAPH INSIGHTS:\n${graphInsights}\n` : ''}
                    
                    Found Web Data: ${JSON.stringify(results.slice(0, 20))}
                    
                    TASK: Create a Combinatorial Pharmacy Dossier.
                    1. IDENTIFY THE BRIDGE: Find the specific enzyme or pathway (e.g. CYP450, Acetylcholine, BDNF-NGF bridge) that connects these.
                    2. MITOCHONDRIAL IMPACT: How does the ${stack.join('/')} combo affect ATP production during a plasticity window?
                    3. THE MISSING LINK: Based on this data, what is the ONE compound or protein missing from this stack to reach peak coherence?
                    4. RISK AUDIT: Identify any metabolic bottlenecks.`;

    return this._callLogos(prompt);
  }

  async _searchProfessional(topic) {
    if (!this.dendrite) return [];
    const res = await this.dendrite.search(`${topic} medical research pubmed nature`);
    return (res.results || []).map(r => ({ ...r, tier: 'professional' }));
  }

  async _searchCommunity(topic) {
    if (!this.dendrite) return [];
    // Force site-specific discovery
    const redditRes = await this.dendrite.search(`site:reddit.com ${topic} experiences anecdotes`);
    const wikiRes = await this.dendrite.search(`site:wikipedia.org ${topic} overview`);
    
    return [
        ...(redditRes.results || []).map(r => ({ ...r, tier: 'community_reddit' })),
        ...(wikiRes.results || []).map(r => ({ ...r, tier: 'community_wiki' }))
    ];
  }

  async _searchAlternative(topic) {
    if (!this.dendrite) return [];
    const res = await this.dendrite.search(`${topic} homeopathic remedies natural alternatives anecdotal evidence`);
    return (res.results || []).map(r => ({ ...r, tier: 'alternative' }));
  }

  _needsMoreShit(results) {
    // If we have fewer than 3 decent results, keep digging
    return results.length < 5;
  }

  async _synthesizeResearch(topic, results) {
    const prompt = `You are SOMA's Medical Discovery Synthesis engine. 
                    Topic: "${topic}"
                    Sources Found: ${results.length}
                    
                    Data: ${JSON.stringify(results.slice(0, 15))}
                    
                    Synthesize this into a "Discovery Dossier". 
                    Include:
                    - Scientific Baseline (if any)
                    - Anecdotal/Community Findings (Reddit/Wiki)
                    - Homeopathic/Natural Frontiers
                    - A "Research Gaps" section for her next mission.`;

    return this._callLogos(prompt);
  }
}

export default MedicalDiscoveryCortex;
