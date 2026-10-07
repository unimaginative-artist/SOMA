import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import crypto from 'crypto';

// ============================================================
// PRIMITIVE TRANSFORM REGISTRY
// ============================================================

class Payload {
    constructor(data, context) {
        this.data = data;
        this.context = context;
    }
}

class PrimitiveRegistry {
    static _registry = new Map();
    static _sealed = false;

    static register(name, fn) {
        if (this._sealed) {
            throw new Error("Registry is sealed");
        }
        if (typeof fn !== 'function') {
            throw new Error(`Primitive ${name} must be a function`);
        }
        this._registry.set(name, fn);
        return fn;
    }

    static seal() {
        this._sealed = true;
    }

    static get(name) {
        return this._registry.get(name);
    }

    static all() {
        return new Map(this._registry);
    }
    
    static has(name) {
        return this._registry.has(name);
    }
    
    static getNames() {
        return Array.from(this._registry.keys());
    }
}

// ============================================================
// BOOTSTRAP PRIMITIVES
// ============================================================

PrimitiveRegistry.register("normalize", (payload) => {
    return new Payload(String(payload.data), payload.context);
});

PrimitiveRegistry.register("partition", (payload) => {
    if (Array.isArray(payload.data)) {
        return payload.data.map(x => new Payload(x, payload.context));
    }
    return payload;
});

PrimitiveRegistry.register("hash", (payload) => {
    // Simple hash for demo purposes
    let h = 0;
    const str = String(payload.data);
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return new Payload(Math.abs(h), payload.context);
});

PrimitiveRegistry.register("emit", (payload) => {
    return payload;
});

PrimitiveRegistry.register("upper", (payload) => {
    if (typeof payload.data === 'string') {
        return new Payload(payload.data.toUpperCase(), payload.context);
    }
    return payload;
});

PrimitiveRegistry.register("double", (payload) => {
    if (typeof payload.data === 'number') {
        return new Payload(payload.data * 2, payload.context);
    }
    return payload;
});

PrimitiveRegistry.register("add_one", (payload) => {
    if (typeof payload.data === 'number') {
        return new Payload(payload.data + 1, payload.context);
    }
    return payload;
});

PrimitiveRegistry.register("is_numeric", (payload) => {
    const isNum = !isNaN(parseFloat(payload.data)) && isFinite(payload.data);
    return new Payload(isNum, payload.context);
});

// Seal after primitives registered
PrimitiveRegistry.seal();

// ============================================================
// COMPOSITION CELL
// ============================================================

class CompositionCell {
    constructor(primitiveNames, maxTimeMs = 1000) {
        this.chain = [...primitiveNames];
        this.maxTimeMs = maxTimeMs;
        // Generate a deterministic signature
        const hash = crypto.createHash('sha256');
        hash.update(this.chain.join('|'));
        this.signature = hash.digest('hex');
    }

    execute(payload) {
        const start = performance.now();
        try {
            let current = payload;
            for (const primName of this.chain) {
                if (performance.now() - start > this.maxTimeMs) {
                    throw new Error("Timeout");
                }
                const fn = PrimitiveRegistry.get(primName);
                if (!fn) throw new Error(`Unknown primitive: ${primName}`);
                
                current = fn(current);
                
                // If a primitive returns null/undefined (or explicitly signals failure), abort
                if (current === null || current === undefined) {
                    return null;
                }
                // Handle list expansion (primitive returning array of Payloads) - simplified for now
                // In Python code: partition returns list of Payloads. 
                // The loop expects single payload. 
                // We'll support single-path execution for now. 
                // If list is returned, we might stop or fork (not implemented in simple version).
                if (Array.isArray(current)) {
                     // If it's an array of Payloads, we just return it as the result of the chain?
                     // Or do we map subsequent functions over it? 
                     // For this "Reflex" version, let's say if it branches, we stop processing chain 
                     // on the list itself and return the list.
                     return current;
                }
            }
            return current;
        } catch (err) {
            return null;
        }
    }
}

// ============================================================
// STRUCTURAL MUTATION
// ============================================================

class StructuralMutation {
    static extend(chain, primitiveName) {
        return new CompositionCell([...chain.chain, primitiveName]);
    }

    static splice(chainA, chainB) {
        return new CompositionCell([...chainA.chain, ...chainB.chain]);
    }

    static truncate(chain, keep = null) {
        if (keep === null) {
            keep = Math.floor(Math.random() * chain.chain.length) + 1;
        }
        return new CompositionCell(chain.chain.slice(0, keep));
    }

    static swap(chain, idx, newPrimitive) {
        const newChain = [...chain.chain];
        newChain[idx] = newPrimitive;
        return new CompositionCell(newChain);
    }
}

// ============================================================
// ENVIRONMENT
// ============================================================

class ReflexEnvironment {
    constructor(maxCompositions = 50) {
        this.compositions = new Set();
        // Initialize with single primitives
        for (const name of PrimitiveRegistry.getNames()) {
            this.compositions.add(new CompositionCell([name]));
        }
        
        this.maxCompositions = maxCompositions;
        this.metrics = new Map(); // context -> Map<signature, score>
        this.executionCosts = new Map(); // signature -> [times]
        this.outputDiversity = new Map(); // signature -> Set<hash>
        this.lineage = new Map(); // signature -> Set<signature>
    }

    getComposition(signature) {
        for (const c of this.compositions) {
            if (c.signature === signature) return c;
        }
        return null;
    }

    inject(composition, payload) {
        const start = performance.now();
        const result = composition.execute(payload);
        const execTime = performance.now() - start;

        if (result === null) {
            this.updateScore(payload.context, composition, -2.0);
        } else {
            this.score(composition, payload.context, result, execTime);
        }

        return result;
    }

    updateScore(context, composition, delta) {
        if (!this.metrics.has(context)) {
            this.metrics.set(context, new Map());
        }
        const ctxMetrics = this.metrics.get(context);
        const current = ctxMetrics.get(composition.signature) || 0;
        ctxMetrics.set(composition.signature, current + delta);
    }

    score(composition, context, output, execTime) {
        const base = this.utility(output);
        
        if (!this.executionCosts.has(composition.signature)) {
            this.executionCosts.set(composition.signature, []);
        }
        this.executionCosts.get(composition.signature).push(execTime);
        
        const costPenalty = Math.min(execTime / 50.0, 2.0); // 50ms target

        const outHash = this.hashOutput(output);
        if (!this.outputDiversity.has(composition.signature)) {
            this.outputDiversity.set(composition.signature, new Set());
        }
        const diversitySet = this.outputDiversity.get(composition.signature);
        diversitySet.add(outHash);
        
        const diversityBonus = diversitySet.size * 0.01;

        const score = (base / Math.max(costPenalty, 0.1)) + diversityBonus;
        this.updateScore(context, composition, score);
    }

    utility(output) {
        if (output === null) return -1.0;
        if (output instanceof Payload) return 1.0;
        if (Array.isArray(output)) return output.length * 0.5;
        return 0.5;
    }
    
    hashOutput(output) {
        // Simple hash of output for diversity tracking
        if (output instanceof Payload) return String(output.data);
        if (Array.isArray(output)) return "List:" + output.length;
        return String(output);
    }

    spawnVariant(base) {
        if (this.compositions.size >= this.maxCompositions) {
            this._cullWeakest();
        }

        const types = ["extend", "splice", "truncate", "swap"];
        const mutationType = types[Math.floor(Math.random() * types.length)];
        
        try {
            let variant = null;
            const primKeys = PrimitiveRegistry.getNames();

            if (mutationType === "extend") {
                const prim = primKeys[Math.floor(Math.random() * primKeys.length)];
                variant = StructuralMutation.extend(base, prim);
            } else if (mutationType === "splice") {
                const others = Array.from(this.compositions).filter(c => c !== base);
                if (others.length > 0) {
                    const partner = others[Math.floor(Math.random() * others.length)];
                    variant = StructuralMutation.splice(base, partner);
                }
            } else if (mutationType === "truncate") {
                if (base.chain.length > 1) {
                    variant = StructuralMutation.truncate(base);
                }
            } else if (mutationType === "swap") {
                if (base.chain.length > 0) {
                    const idx = Math.floor(Math.random() * base.chain.length);
                    const prim = primKeys[Math.floor(Math.random() * primKeys.length)];
                    variant = StructuralMutation.swap(base, idx, prim);
                }
            }

            if (variant) {
                // Check if already exists
                let exists = false;
                for(const c of this.compositions) {
                    if (c.signature === variant.signature) {
                        exists = true;
                        break;
                    }
                }
                
                if (!exists) {
                    this.compositions.add(variant);
                    if (!this.lineage.has(variant.signature)) {
                        this.lineage.set(variant.signature, new Set());
                    }
                    this.lineage.get(variant.signature).add(base.signature);
                    return variant;
                }
            }
            return null;

        } catch (err) {
            return null;
        }
    }

    _cullWeakest() {
        // Calculate total score for each composition across all contexts
        const scores = new Map();
        for (const c of this.compositions) {
            let total = 0;
            for (const ctxMap of this.metrics.values()) {
                total += (ctxMap.get(c.signature) || 0);
            }
            scores.set(c, total);
        }

        // Find min
        let minScore = Infinity;
        let weakest = null;
        for (const [c, s] of scores) {
            if (s < minScore) {
                minScore = s;
                weakest = c;
            }
        }

        if (weakest) {
            this.kill(weakest);
        }
    }

    kill(composition) {
        this.compositions.delete(composition);
        this.executionCosts.delete(composition.signature);
        this.outputDiversity.delete(composition.signature);
        this.lineage.delete(composition.signature);
        for (const map of this.metrics.values()) {
            map.delete(composition.signature);
        }
    }
}

// ============================================================
// REFLEX ARBITER
// ============================================================

export class ReflexArbiter extends BaseArbiterV4 {
    constructor() {
        super({
            id: 'reflex_arbiter',
            role: ArbiterRole.ENGINEER, // Acting as an engineer of functions
            capabilities: [ArbiterCapability.CODE_GENERATION, ArbiterCapability.ANALYSIS],
            dependencies: []
        });

        this.env = new ReflexEnvironment(100);
    }

    async initialize() {
        await super.initialize();
        this.log("Reflex Engine Initialized. Primitives sealed.");
        this.startBackgroundEvolution();
    }

    startBackgroundEvolution() {
        // Every 30 seconds, pick a random context and evolve something new
        setInterval(() => {
            const contexts = Array.from(this.env.metrics.keys());
            if (contexts.length === 0) return;

            const context = contexts[Math.floor(Math.random() * contexts.length)];
            const comps = Array.from(this.env.compositions);
            if (comps.length > 0) {
                const base = comps[Math.floor(Math.random() * comps.length)];
                this.env.spawnVariant(base);
                this.log(`[Reflex] Background mutation in context: ${context}`);
            }
        }, 30000);
    }

    async handleMessage(message) {
        if (message.type === 'EVOLVE_CHAIN') {
            return this.handleEvolve(message.payload);
        }
        if (message.type === 'EXECUTE_CHAIN') {
            return this.handleExecute(message.payload);
        }
        return super.handleMessage(message);
    }

    /**
     * Evolve a chain for a specific task
     * payload: { 
     *   input: any, 
     *   expectedOutput: any (optional, for scoring), 
     *   context: string,
     *   iterations: number
     * }
     */
    async handleEvolve(payload) {
        const { input, expectedOutput, context, iterations = 10 } = payload;
        const wrappedInput = new Payload(input, context);
        
        let bestChain = null;
        let bestScore = -Infinity;

        // Run iterations
        for (let i = 0; i < iterations; i++) {
            // Pick a random existing composition to execute/mutate
            const comps = Array.from(this.env.compositions);
            if (comps.length === 0) break;
            
            const candidate = comps[Math.floor(Math.random() * comps.length)];
            
            // Execute
            const result = this.env.inject(candidate, wrappedInput);
            
            // External validation score (if expectedOutput provided)
            if (expectedOutput !== undefined && result && result.data === expectedOutput) {
                this.env.updateScore(context, candidate, 100.0); // Big bonus for exact match
            }

            // Spawn a variant from this candidate
            this.env.spawnVariant(candidate);
        }

        // Find best for this context
        if (this.env.metrics.has(context)) {
            const ctxMetrics = this.env.metrics.get(context);
            for (const [sig, score] of ctxMetrics) {
                if (score > bestScore) {
                    bestScore = score;
                    bestChain = this.env.getComposition(sig);
                }
            }
        }

        if (bestChain) {
            return {
                status: 'success',
                chain: bestChain.chain,
                signature: bestChain.signature,
                score: bestScore
            };
        }
        
        return { status: 'exploring', message: 'No clear winner yet' };
    }

    async handleExecute(payload) {
        const { chain, input, context } = payload;
        
        // Reconstruct or find chain
        let comp = null;
        // Try to find by signature if provided
        // Otherwise build temporary
        const tempComp = new CompositionCell(chain);
        
        const wrappedInput = new Payload(input, context || 'exec');
        const result = tempComp.execute(wrappedInput);
        
        return {
            status: result ? 'success' : 'failure',
            output: result ? result.data : null
        };
    }
}
