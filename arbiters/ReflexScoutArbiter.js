/**
 * ReflexScoutArbiter.js
 * 
 * "The Muscle Memory Trainer"
 * 
 * Watches the ConversationHistory for repeated patterns.
 * When a pattern is detected (e.g., "Convert X to Y" happens 5 times),
 * it extracts the Input/Output examples and asks ReflexArbiter to evolve 
 * a token-free function chain for it.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class ReflexScoutArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            id: 'reflex_scout',
            role: ArbiterRole.SCOUT,
            capabilities: [
                ArbiterCapability.PATTERN_RECOGNITION, 
                ArbiterCapability.TRAINING_INITIATION
            ],
            dependencies: ['ConversationHistoryArbiter', 'ReflexArbiter']
        });

        this.conversationHistory = config.conversationHistory;
        this.reflexArbiter = config.reflexArbiter;
        this.mnemonic = config.mnemonic; // For semantic clustering (Senior feature)
        
        this.scanInterval = config.scanInterval || 300000; // Check every 5 mins
        this.minOccurrences = config.minOccurrences || 3; // Lower threshold for demo
        this.confidenceThreshold = 0.85;

        // "Intents" we are tracking
        this.intentClusters = new Map(); // intent_hash -> { count, examples: [] }
    }

    async initialize() {
        await super.initialize();
        this.startScanning();
        this.log("Reflex Scout online. Watching for muscle memory opportunities.");
    }

    startScanning() {
        setInterval(() => this.scanHistory(), this.scanInterval);
    }

    async scanHistory() {
        if (!this.conversationHistory) return;

        // Get last 50 messages
        const recent = await this.conversationHistory.getRecentMessages(50);
        if (!recent || recent.length === 0) return;

        // Simple Heuristic: Look for "Command -> Result" pairs
        // In a real system, we'd use semantic embedding clustering here.
        // For this implementation, we'll use a text-based heuristic.

        for (let i = 0; i < recent.length - 1; i++) {
            const msg = recent[i];
            const next = recent[i+1];

            if (msg.role === 'user' && next.role === 'assistant') {
                await this.analyzePair(msg.content, next.content);
            }
        }
        
        await this.processClusters();
    }

    async analyzePair(input, output) {
        // Normalize input to find pattern
        // e.g. "Convert 50 to binary" -> "convert_NUM_to_binary"
        
        const pattern = this.extractPattern(input);
        if (!pattern) return;

        if (!this.intentClusters.has(pattern)) {
            this.intentClusters.set(pattern, { count: 0, examples: [] });
        }

        const cluster = this.intentClusters.get(pattern);
        
        // Avoid duplicate examples
        if (!cluster.examples.some(e => e.input === input)) {
            cluster.count++;
            cluster.examples.push({ input, output });
            
            // Extract the variable part for training
            // "Convert 50" -> var: 50
            const variable = this.extractVariable(input);
            if (variable) {
                cluster.examples[cluster.examples.length - 1].trainingInput = variable;
            }
        }
    }

    extractPattern(text) {
        // Naive pattern extractor: Replace numbers with NUM
        if (/\d+/.test(text)) {
            return text.replace(/\d+/g, 'NUM').toLowerCase().trim();
        }
        return null; // Ignore non-numeric patterns for now (Reflex primitives are mostly math/string)
    }

    extractVariable(text) {
        // Extract the first number
        const match = text.match(/(\d+)/);
        return match ? parseFloat(match[1]) : null;
    }

    async processClusters() {
        if (!this.reflexArbiter) return;

        for (const [pattern, cluster] of this.intentClusters.entries()) {
            if (cluster.count >= this.minOccurrences && !cluster.trainingStarted) {
                this.log(`[Scout] 🎯 Detected pattern "${pattern}" (${cluster.count} occurrences). Initiating Reflex Training...`);
                
                cluster.trainingStarted = true;
                
                // Trigger Evolution for each example
                // We hope one chain solves all
                // Ideally we'd evolve one chain against ALL examples, but ReflexArbiter interface is per-input currently.
                // We'll try to evolve a chain for the first example and test it on others.
                
                const primaryExample = cluster.examples[0];
                if (!primaryExample.trainingInput) continue; // Can't train without extracted var

                const result = await this.reflexArbiter.handleMessage({
                    type: 'EVOLVE_CHAIN',
                    payload: {
                        input: primaryExample.trainingInput,
                        expectedOutput: primaryExample.output, // This assumes exact match output from LLM, which might be noisy.
                        // In reality, we'd need to extract the "answer" from the LLM text.
                        // For now, this works for pure tool outputs like "122".
                        context: pattern,
                        iterations: 50
                    }
                });

                if (result.status === 'success') {
                    this.log(`[Scout] ✅ Evolved Reflex Chain for "${pattern}": ${result.chain.join(' -> ')}`);
                    // Here we would persist this chain to a "ReflexRegistry" for auto-execution next time
                } else {
                    this.log(`[Scout] ⚠️ Failed to evolve chain for "${pattern}"`);
                }
            }
        }
    }
}
