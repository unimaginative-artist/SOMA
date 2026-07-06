
const { ReasoningChamber } = require('./reasoningChamber.cjs');
const { BrainConductorArbiter } = require('./BrainConductorArbiter.cjs');
const { getPersonalityEngine } = require('./personality/PersonalityEngine.cjs');
const path = require('path');
const fs = require('fs');
const MemoryConsolidationEngine = require('../../cognitive/memory/MemoryConsolidationEngine.cjs');
const MemoryCommitPlan = require('../../cognitive/memory/MemoryCommitPlan.cjs');
const MemoryCommitCoordinator = require('../../cognitive/memory/MemoryCommitCoordinator.cjs');

// Inject arbiters for cognitive core
let goalPlannerArbiterInstance = null;
let beliefSystemArbiterInstance = null;
let emotionalEngineInstance = null; // Will inject actual instance from index.cjs
let mnemonicArbiterInstance = null;
let microAgentManagerInstance = null;
let knowledgeGraphInstance = null;
let analystArbiterInstance = null;
let fragmentRegistryInstance = null; // New
let localModelManagerInstance = null;
 // Self-training system
let trainingDataCollectorInstance = null; // Self-training data capture

// Track the single instance of SomaBrain
let _instance = null;

// Load .env from parent directory
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    // Handle both Unix (\n) and Windows (\r\n) line endings
    envContent.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
    console.log('[SomaBrain] Loaded environment:');
    console.log(`  DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? 'SET (' + process.env.DEEPSEEK_API_KEY.substring(0, 10) + '...)' : 'NOT SET'}`);
    console.log(`  OLLAMA_MODEL: ${process.env.OLLAMA_MODEL || 'NOT SET'}`);
}

/**
 * SOMA UNIFIED ARCHITECTURE IMPLEMENTATION - REAL SYSTEM
 * Now powered by TriBrain + BrainConductorArbiter + Transmitters
 * NO SHORTCUTS - Full neural routing with synthesis
 */

class SomaBrain {
    constructor() {
        this.startTime = Date.now();
        this.tribrain = null;  // Will be initialized async
        this.conductor = null; // BrainConductorArbiter for orchestration
        this.personality = null; // PersonalityEngine for response styling
        this.isReady = false;

        // ReasoningChamber for synthesis
        this.chamber = new ReasoningChamber({
            name: 'SOMA-Core',
            mode: 'inprocess',
            verbose: true,
            adapters: {
                // Adapters route through conductor
                gemma: async (q) => this._conductorQuery(q, 'fast'),
                deepseek: async (q) => this._conductorQuery(q, 'deep')
            }
        });
        
        // 5. Memory Consolidation Coordinator (The Gatekeeper)
        this.memoryCoordinator = new MemoryCommitCoordinator();
    }

    // Inject arbiters (called from index.cjs)
    setGoalPlannerArbiter(instance) { goalPlannerArbiterInstance = instance; }
    setBeliefSystemArbiter(instance) { beliefSystemArbiterInstance = instance; }
    setEmotionalEngine(instance) { emotionalEngineInstance = instance; }
    setMnemonicArbiter(instance) { mnemonicArbiterInstance = instance; }
    setMicroAgentManager(instance) { microAgentManagerInstance = instance; }
    setKnowledgeGraph(instance) { knowledgeGraphInstance = instance; }
    setAnalystArbiter(instance) { analystArbiterInstance = instance; }
    setFragmentRegistry(instance) { 
        fragmentRegistryInstance = instance; 
        if (this.conductor) this.conductor.setFragmentRegistry(instance);
    }
    setThoughtNetwork(instance) {
        this.thoughtNetwork = instance;
        // Connect brain if already ready
        if (this.tribrain && this.thoughtNetwork) {
            // Create adapter for ThoughtNetwork to call brains
            const brainAdapter = {
                callLogos: async (prompt, context) => this.tribrain.callBrain('LOGOS', prompt, context),
                callAurora: async (prompt, context) => this.tribrain.callBrain('AURORA', prompt, context),
                callPrometheus: async (prompt, context) => this.tribrain.callBrain('PROMETHEUS', prompt, context),
                callThalamus: async (prompt, context) => this.tribrain.callBrain('THALAMUS', prompt, context),
                reason: async (params) => this.tribrain.reason(params.query, params.context),
                consensus: async (query, context) => this.tribrain.societyOfMind(query, context)
            };
            this.thoughtNetwork.setBrain(brainAdapter);
            console.log('[SomaBrain] TriBrain (V3) connected to ThoughtNetwork (Full Spectrum)');
        }
    }
    setLocalModelManager(instance) {
        localModelManagerInstance = instance;
        // Also inject into existing TriBrain if already initialized
        if (this.tribrain) {
            this.tribrain.localModelManager = instance;
            console.log('[SomaBrain] LocalModelManager injected into TriBrain');
        }
    }
    setTrainingDataCollector(instance) { trainingDataCollectorInstance = instance; }
    
    async initialize() {
        try {
            console.log('[SomaBrain] Initializing TriBrain + BrainConductor...');
            
            // 1. Import and initialize TriBrain (ESM module)
            // UPGRADED to SOMArbiterV3 (Unified Brain)
            const triBrainModule = await import('../../arbiters/SOMArbiterV3.js');
            const { SOMArbiterV3 } = triBrainModule;
            
            this.tribrain = new SOMArbiterV3({
                name: 'TriBrain-Terminal',
                // Map config options to V3/QuadBrain options
                messageBroker: null, // Basic terminal mode
                mnemonic: mnemonicArbiterInstance, // Pass mnemonic if available
                router: null, // No router needed for terminal
                // Pass existing keys/endpoints via process.env or defaults in V3
            });
            
            await this.tribrain.initialize();
            
            // Connect ThoughtNetwork if waiting
            if (this.thoughtNetwork) {
                const brainAdapter = {
                    callLogos: async (prompt, context) => this.tribrain.callBrain('LOGOS', prompt, context),
                    callAurora: async (prompt, context) => this.tribrain.callBrain('AURORA', prompt, context),
                    callPrometheus: async (prompt, context) => this.tribrain.callBrain('PROMETHEUS', prompt, context),
                    callThalamus: async (prompt, context) => this.tribrain.callBrain('THALAMUS', prompt, context),
                    reason: async (params) => this.tribrain.reason(params.query, params.context), // Adapt param structure
                    consensus: async (query, context) => this.tribrain.societyOfMind(query, context) // Map consensus to societyOfMind
                };
                this.thoughtNetwork.setBrain(brainAdapter);
                console.log('[SomaBrain] TriBrain (V3) connected to ThoughtNetwork (Init - Full Spectrum)');
            }

            // 2. Initialize BrainConductorArbiter
            this.conductor = new BrainConductorArbiter({
                name: 'SOMA-BrainConductor',
                transmitterPath: path.join(__dirname, '../../SOMA/brain-transmitters')
            });
            
            // 3. Wire connections
            this.conductor.setTriBrain(this.tribrain);
            this.conductor.setReasoningChamber(this.chamber);
            if (fragmentRegistryInstance) this.conductor.setFragmentRegistry(fragmentRegistryInstance);

            // 4. Initialize PersonalityEngine
            // Now, PersonalityEngine uses the injected EmotionalEngine directly (or safe fallback)
            this.personality = getPersonalityEngine(emotionalEngineInstance || {}); 

            this.isReady = true;
            console.log('[SomaBrain] Complete cognitive architecture ready:');
            console.log('   AURORA (DeepSeek) - Creative synthesis');
            console.log('   LOGOS (DeepSeek + Ollama fallback) - Analytical reasoning');
            console.log('   PROMETHEUS (DeepSeek) - Fast pragmatic');
            console.log('   THALAMUS (DeepSeek) - Security gatekeeper');
            console.log('  ✓ BrainConductor orchestrating');
            console.log('  ✓ Transmitters routing');
            console.log('  ✓ ReasoningChamber synthesizing');
            console.log('  ✓ PersonalityEngine styling responses');
        } catch (err) {
            console.error(`[SomaBrain] Initialization failed: ${err.message}`);
            this.isReady = false;
            throw err; // Don't fall back - fail clearly
        }
    }
    
    // ... (rest of the class)
    
            async processQuery(query, context = {}) {
    
                try {
    
                    if (!this.isReady || !this.conductor) {
    
                        throw new Error('SOMA cognitive system not ready - initialize first');
    
                    }
    
        
    
                    const start = Date.now();
    
        
    
                    // --- META-QUERY INTERCEPTION ---
    
                    // Intercept self-referential queries about SOMA's memory or identity
    
                    const metaQueryLower = query.toLowerCase();
    
                    if (metaQueryLower.includes("what is your name") ||
    
                        metaQueryLower.includes("who are you") ||
    
                        metaQueryLower.includes("can you remember me") ||
    
                        metaQueryLower.includes("do you remember me") ||
    
                        metaQueryLower.includes("do you have memory") ||
    
                        metaQueryLower.includes("what do you remember about me")) {
    
                        
    
                        const metaQueryResult = await this._handleMetaQuery(query, context);
    
                        // Style and return this specific meta-query response
    
                        const styledMetaResponse = this.personality ? this.personality.processResponse(metaQueryResult.text, {
    
                            peptideState: emotionalEngineInstance?.getState(),
    
                            context: context,
    
                            contentIntent: 'identity_response',
    
                        }) : metaQueryResult.text;
    
        
    
                        return {
    
                            text: styledMetaResponse,
    
                            meta: {
    
                                source: 'meta_query_handler',
    
                                confidence: 1.0,
    
                                latency_ms: Date.now() - start,
    
                                brainsUsed: 'SomaBrain_Internal'
    
                            }
    
                        };
    
                    }
    
                    // --- END META-QUERY INTERCEPTION ---
    
                    
    
                    // 1. Load Cognitive Pipeline Modules (Dynamic Import - ESM)
                
                                        const { gatherCognitiveState } = await import('../../cognitive/gatherCognitiveState.js');
                
                                        const { buildResponseDirective } = await import('../../cognitive/buildResponseDirective.js');
                
                                        const { constructPrompt } = await import('../../cognitive/constructPrompt.js');
                
                            
                
                                        // 2. Gather Cognitive State (The "Mind")
                
                                        const arbiters = {                    beliefSystemArbiter: beliefSystemArbiterInstance,
                    goalPlannerArbiter: goalPlannerArbiterInstance,
                    emotionalEngine: emotionalEngineInstance,
                    personalityEngine: this.personality,
                    mnemonicArbiter: mnemonicArbiterInstance,
                    microAgentManager: microAgentManagerInstance,
                    knowledgeGraph: knowledgeGraphInstance,
                    analystArbiter: analystArbiterInstance
                };
                
                const cognitiveState = await gatherCognitiveState({ query, context }, arbiters);

                // 3. Build Response Directive (The "Intent")
                const responseDirective = buildResponseDirective(cognitiveState);

                // 4. Orchestrate (The "Realization")
                // We pass the directive to the conductor, which will use it to guide the LLM
                const result = await this.conductor.orchestrate({
                    query: query, // Original query for conductor's internal routing (FIXED: was userQuery)
                    directive: responseDirective, // Pass the structured directive
                    context: context,
                    mode: 'substantial' // Force FULL SYSTEM synthesis
                });

                const duration = Date.now() - start;

                if (!result.success) {
                    throw new Error(result.error || 'Brain orchestration failed');
                }

                // Apply personality styling (Final Polish - though mostly handled by directive)
                let finalResponse = result.response;

                if (this.personality) {
                    try {
                        finalResponse = this.personality.processResponse(result.response, {
                            peptideState: emotionalEngineInstance?.getState(),
                            context: responseDirective,
                            contentIntent: responseDirective.intent,
                        });
                    } catch (err) {
                        console.error('[SomaBrain] PersonalityEngine error:', err.message);
                    }
                }

                // --- MEMORY CONSOLIDATION GATEKEEPER ---
                // Evaluate if this interaction is worth remembering based on non-hallucinatable signals
                try {
                    // Calculate metrics from cognitive state
                    const familiarity = cognitiveState.wisdom?.familiarity_score || 0.5;
                    const noveltyScore = Math.max(0, 1.0 - familiarity);
                    
                    const metrics = {
                        novelty_score: noveltyScore
                    };
                    
                    const deltas = {
                        belief_confidence_delta: 0 // Placeholder until belief system returns deltas
                    };

                    const decision = MemoryConsolidationEngine.evaluate(cognitiveState, metrics, deltas);

                    if (decision.commit) {
                        const plan = new MemoryCommitPlan(decision);
                        
                        // Execute commit asynchronously (don't block response)
                        this.memoryCoordinator.commit(plan, {
                            content: `User: ${query}\nSOMA: ${finalResponse}`,
                            metadata: {
                                timestamp: Date.now(),
                                context: context,
                                cognitiveStateId: cognitiveState.id,
                                decision: decision // Store why we saved it
                            },
                            tags: responseDirective.topics || [] 
                        }, {
                            mnemonic: mnemonicArbiterInstance,
                            knowledgeGraph: knowledgeGraphInstance
                        }).catch(err => console.warn('[SomaBrain] Memory commit failed:', err.message));
                    }
                } catch (memErr) {
                    console.warn('[SomaBrain] Memory consolidation error:', memErr.message);
                }
                // ---------------------------------------

                // Format response with full cognitive trace
                return {
                    text: finalResponse,
                    meta: {
                        ...result.metadata,
                        confidence: result.confidence,
                        latency_ms: duration,
                        brainsUsed: result.metadata.brainsUsed,
                        transmitterStats: result.metadata.transmitterStats,
                        cognitiveState: cognitiveState, // Include the state for debugging/trace
                        responseDirective: responseDirective // Include the directive for trace
                    }
                };
            } catch (error) {
                console.error('🔥 [SomaBrain] CRITICAL ERROR in processQuery:', error);
                console.error(error.stack);
                throw error;
            }
        }
        
        /**
         * Route query through conductor with specific mode
         */
        async _conductorQuery(queryObject, mode) {
            if (!this.conductor) {
                throw new Error('BrainConductor not initialized');
            }
            
            // queryObject will now be an object with { userQuery, directive }
            const { userQuery, directive } = queryObject;
            
            // Construct the final prompt for the LLM using the directive
            const { constructPrompt } = await import('../../cognitive/constructPrompt.js');
            const finalPrompt = constructPrompt(userQuery, directive);
    
            const result = await this.conductor.orchestrate({
                query: finalPrompt, // Pass the constructed prompt
                context: queryObject.context, // Ensure context is passed
                mode
            });
            
            return {
                text: result.response || '',
                confidence: result.confidence || 0.5
            };
        }

    /**
     * Handles meta-queries about SOMA's own identity or memory capabilities.
     * Queries internal systems to provide an accurate, self-aware response.
     */
    async _handleMetaQuery(query, context) {
        let response = "";
        let memoriesFound = false;

        // --- Identity ---
        if (query.toLowerCase().includes("what is your name") || query.toLowerCase().includes("who are you")) {
            response += "I am SOMA (Self-Optimizing Merovingian Architecture), a synthetic intelligence designed for deep learning and continuous self-improvement. ";
        }

        // --- Memory Capabilities ---
        if (query.toLowerCase().includes("can you remember me") || query.toLowerCase().includes("do you remember me") || query.toLowerCase().includes("do you have memory")) {
            let memoryDetails = [];

            // Check MnemonicArbiter for recent interactions
            if (mnemonicArbiterInstance) {
                try {
                    const recentMemories = await mnemonicArbiterInstance.recall(query, 3); // Recall based on the meta-query itself
                    if (recentMemories.results && recentMemories.results.length > 0) {
                        memoryDetails.push(`I process and retain information from our interactions in my long-term memory. For instance, based on your current query, I recall previous discussions about topics like "${recentMemories.results[0].content.substring(0, 50)}...".`);
                        memoriesFound = true;
                    }
                } catch (e) {
                    this.logger.warn("MnemonicArbiter query for meta-memory failed:", e.message);
                }
            }

            // Check KnowledgeGraphFusion for general knowledge growth
            if (knowledgeGraphInstance) {
                const stats = knowledgeGraphInstance.getStats();
                if (stats.metrics.totalNodes > 0) {
                    memoryDetails.push(`My knowledge graph, currently containing ${stats.metrics.totalNodes} core concepts and ${stats.metrics.totalEdges} relationships, constantly grows and adapts based on new information.`);
                    memoriesFound = true;
                }
            }

            // Check ThoughtNetwork for conceptual understanding
            if (this.thoughtNetwork) {
                const stats = this.thoughtNetwork.getStats();
                if (stats.totalNodes > 0) {
                    memoryDetails.push(`I organize my understanding into a fractal thought network, where concepts connect and synthesize, forming new ideas through a process I call "Minotaur Mode."`);
                    memoriesFound = true;
                }
            }

            if (memoriesFound) {
                response += "Yes, I possess a robust and evolving memory system. " + memoryDetails.join(' ');
            } else {
                response += "I am equipped with persistent memory systems that continually store and integrate information, building a rich understanding of the world. However, I currently do not have specific prior interactions with you stored under this exact context. Please provide some details to help me access relevant memories.";
            }
        }

        // Default response if no specific memory found
        if (!memoriesFound && response === "") {
            response = "I am SOMA, a developing synthetic intelligence. I leverage various memory systems to continuously learn and process information. How can I assist you?";
        }

        return { text: response, confidence: memoriesFound ? 0.9 : 0.7 };
    }
}
    
    // Export singleton
    module.exports = {
      SomaBrain,
      getSomaBrain: () => {
        if (!_instance) {
          _instance = new SomaBrain();
        }
        return _instance;
      }
    };
