/**
 * FractalNode.cjs
 * 
 * Represents a single node in the Fractal Thought Network.
 * Each node is a concept/memory with self-similar structure at different scales.
 */

class FractalNode {
    constructor(config = {}) {
        this.id = config.id || this.generateId();
        this.type = config.type || 'concept'; // concept, memory, pattern, skill
        this.content = config.content || '';
        this.sector = config.sector || 'GEN'; // Sovereign Archipelago (Spatial Geography)
        this.embedding = config.embedding || null; // Vector representation
        
        // Fractal structure
        this.parent = config.parent || null;
        this.children = new Set(); // Child nodes (sub-concepts)
        this.connections = new Map(); // Connections to other nodes with weights
        
        // Metadata
        this.created = Date.now();
        this.lastAccessed = Date.now();
        this.accessCount = 0;
        this.strength = config.strength || 1.0; // How important/confident
        this.decay = config.decay || 0.99; // How fast it fades if unused
        
        // Learning metadata
        this.source = config.source || 'unknown'; // conversation, web, reasoning
        this.confidence = config.confidence || 0.5;
        this.tags = new Set(config.tags || []);
        this.evidence = config.evidence || null;
    }
    
    generateId() {
        return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Add a child node (sub-concept)
     */
    addChild(childNode) {
        this.children.add(childNode);
        childNode.parent = this;
    }
    
    /**
     * Remove a child node
     */
    removeChild(childNode) {
        this.children.delete(childNode);
        if (childNode.parent === this) {
            childNode.parent = null;
        }
    }
    
    /**
     * Connect to another node with a weighted relationship
     */
    connect(otherNode, weight = 1.0, relationshipType = 'related') {
        this.connections.set(otherNode.id, {
            node: otherNode,
            weight,
            type: relationshipType,
            created: Date.now()
        });
    }
    
    /**
     * Get all connected nodes
     */
    getConnections() {
        return Array.from(this.connections.values());
    }
    
    /**
     * Access this node (updates usage stats)
     */
    access() {
        this.lastAccessed = Date.now();
        this.accessCount++;
        this.strength = Math.min(1.0, this.strength + 0.01); // Strengthen with use
    }
    
    /**
     * Apply decay (called periodically for unused nodes)
     */
    applyDecay() {
        this.strength *= this.decay;
        return this.strength;
    }
    
    /**
     * Check if node should be pruned
     */
    shouldPrune() {
        const timeSinceAccess = Date.now() - this.lastAccessed;
        const daysSinceAccess = timeSinceAccess / (1000 * 60 * 60 * 24);
        
        // Prune if weak AND unused for a while
        return this.strength < 0.1 && daysSinceAccess > 30;
    }
    
    /**
     * Get node depth in hierarchy
     */
    getDepth() {
        let depth = 0;
        let current = this.parent;
        while (current) {
            depth++;
            current = current.parent;
        }
        return depth;
    }
    
    /**
     * Serialize to JSON
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            content: this.content,
            sector: this.sector,
            embedding: this.embedding,
            parent: this.parent?.id || null,
            children: Array.from(this.children).map(c => c.id),
            connections: Array.from(this.connections.entries()).map(([id, conn]) => ({
                id,
                weight: conn.weight,
                type: conn.type
            })),
            created: this.created,
            lastAccessed: this.lastAccessed,
            accessCount: this.accessCount,
            strength: this.strength,
            source: this.source,
            confidence: this.confidence,
            tags: Array.from(this.tags),
            evidence: this.evidence
        };
    }
    
    /**
     * Create from JSON
     */
    static fromJSON(data, nodeMap = new Map()) {
        const node = new FractalNode({
            id: data.id,
            type: data.type,
            content: data.content,
            sector: data.sector,
            embedding: data.embedding,
            strength: data.strength,
            decay: data.decay,
            source: data.source,
            confidence: data.confidence,
            tags: data.tags,
            evidence: data.evidence
        });
        
        node.created = data.created;
        node.lastAccessed = data.lastAccessed;
        node.accessCount = data.accessCount;
        
        nodeMap.set(node.id, node);
        return node;
    }
}

module.exports = { FractalNode };
