/**
 * KnowledgeGraphFusion.js - Unified Knowledge Graph
 *
 * The Knowledge Graph Fusion Engine unifies all fragment knowledge into a coherent
 * semantic network, enabling cross-domain reasoning and knowledge transfer.
 *
 * Instead of fragments having isolated knowledge silos, this engine fuses their knowledge
 * into a unified graph where concepts connect across domains.
 *
 * Key Capabilities:
 * 1. Cross-Domain Linking: Connect related concepts across fragments
 *    - "blockchain" (tech) ↔ "distributed ledger" (finance)
 *    - "neural network" (AI) ↔ "synapse" (biology)
 *
 * 2. Semantic Reasoning: Infer new knowledge from existing connections
 *    - If A→B and B→C, then infer A→C
 *
 * 3. Knowledge Transfer: Use knowledge from one domain to solve problems in another
 *    - Medical diagnosis patterns → Bug diagnosis patterns
 *
 * 4. Contradiction Detection: Find and resolve conflicting knowledge
 *
 * 5. Concept Clustering: Group related concepts for better organization
 *
 * 6. Knowledge Importance Ranking: Identify key concepts vs peripheral ones
 *
 * Graph Structure:
 * - Nodes: Concepts (e.g., "photosynthesis", "machine learning", "contract law")
 * - Edges: Relationships (e.g., "is-a", "related-to", "causes", "enables")
 * - Metadata: Source fragment, confidence, usage count, timestamp
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class KnowledgeGraphFusion extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'KnowledgeGraphFusion';

    // Dependencies
    this.fragmentRegistry = opts.fragmentRegistry;
    this.learningPipeline = opts.learningPipeline;
    this.messageBroker = opts.messageBroker;
    this.mnemonic = opts.mnemonic;
    this.savePath = opts.savePath || path.join(process.cwd(), 'SOMA', 'soma-knowledge-graph.json');

    // Knowledge graph storage
    this.nodes = new Map(); // conceptId -> Node
    this.edges = new Map(); // edgeId -> Edge
    this.conceptIndex = new Map(); // concept_name -> conceptId (for fast lookup)
    this.domainClusters = new Map(); // domain -> Set<conceptId>

    // Cross-domain connections (the magic happens here)
    this.crossDomainLinks = new Map(); // "domainA->domainB" -> [edges]

    // Inference cache
    this.inferencedFacts = new Map(); // "A->C" -> confidence
    this.contradictions = new Map(); // "concept" -> [conflicting statements]

    // Graph metrics
    this.metrics = {
      totalNodes: 0,
      totalEdges: 0,
      crossDomainEdges: 0,
      avgDegree: 0.0, // Average connections per node
      density: 0.0, // How connected is the graph
      largestCluster: 0,
      inferredFacts: 0,
      contradictionsFound: 0
    };

    // Stats
    this.stats = {
      knowledgeFusions: 0,
      crossDomainConnections: 0,
      inferencesGenerated: 0,
      contradictionsResolved: 0,
      transferLearnings: 0,
      graphUpdates: 0
    };

    // Configuration
    this.config = {
      minSimilarityForLink: opts.minSimilarityForLink || 0.7,
      inferenceConfidenceThreshold: opts.inferenceConfidenceThreshold || 0.6,
      maxInferenceDepth: opts.maxInferenceDepth || 3,
      contradictionThreshold: opts.contradictionThreshold || 0.8
    };

    this.graphifyArbiter = opts.graphifyArbiter || null;

    console.log(`[${this.name}] Initialized - knowledge fusion enabled`);
  }

  /**
   * Initialize knowledge graph fusion
   */
  async initialize() {
    console.log(`[${this.name}] 🕸️  Initializing Knowledge Graph Fusion Engine...`);

    // Load persisted graph
    await this.load();

    // Ingest Repograph (Self-Awareness)
    await this.ingestRepograph();

    // Build initial knowledge graph from fragments (if any)
    await this.buildInitialGraph();

    // Find cross-domain connections
    await this.linkCrossDomainConcepts();

    // Subscribe to events
    if (this.messageBroker) {
      this.messageBroker.registerArbiter(this.name, {
          instance: this,
          type: 'knowledge-graph',
          capabilities: ['knowledge_storage', 'knowledge_retrieval', 'inference']
      });
      this.messageBroker.subscribe('knowledge:add', this._handleKnowledgeAddition.bind(this));
      this.messageBroker.subscribe('knowledge:query', this._handleKnowledgeQuery.bind(this));
      console.log(`[${this.name}]    Subscribed to MessageBroker events`);
    }

    // Start periodic graph maintenance
    this.startGraphMaintenance();

    console.log(`[${this.name}] ✅ Knowledge Graph Fusion ready`);
    console.log(`[${this.name}]    Nodes: ${this.nodes.size}, Edges: ${this.edges.size}`);
    console.log(`[${this.name}]    Cross-domain links: ${this.stats.crossDomainConnections}`);
  }

  /**
   * Ingest Repograph data (Self-Awareness of codebase)
   */
  async ingestRepograph() {
    console.log(`[${this.name}] 🤖 Ingesting Repograph (Codebase Self-Awareness)...`);

    try {
        const repoDomain = 'SOMA_ARCHITECTURE';
        if (!this.domainClusters.has(repoDomain)) {
            this.domainClusters.set(repoDomain, new Set());
        }

        // Add core architectural nodes
        const coreConcepts = [
            { name: 'SomaBrain', type: 'class', role: 'Cognitive Core' },
            { name: 'TriBrain', type: 'system', role: 'Multimodal Reasoning' },
            { name: 'MnemonicArbiter', type: 'class', role: 'Memory System' },
            { name: 'MessageBroker', type: 'class', role: 'Communication Substrate' },
            { name: 'FragmentRegistry', type: 'class', role: 'Expert Domain Manager' },
            { name: 'GraphifyArbiter', type: 'class', role: 'Repograph Bridge' }
        ];

        for (const concept of coreConcepts) {
            const conceptId = await this.addConcept(concept.name, {
                domain: repoDomain,
                type: concept.type,
                role: concept.role,
                confidence: 1.0
            });
            this.domainClusters.get(repoDomain).add(conceptId);
        }

        // If Graphify is available, link it
        if (this.graphifyArbiter) {
            console.log(`[${this.name}]    Linking GraphifyArbiter for multi-hop codebase queries.`);
        }
        
    } catch (e) {
        console.warn(`[${this.name}] Repograph ingest failed: ${e.message}`);
    }
  }

  async load() {
    try {
        await fs.access(this.savePath); // Check existence
        const content = await fs.readFile(this.savePath, 'utf8');
        if (!content || content.trim().length === 0) return;
        
        const rawData = JSON.parse(content);
        
        // Handle different data structures (robust loading)
        const data = rawData.nodes ? rawData : (rawData.knowledge || rawData.knowledgeMesh || { nodes: [], edges: [] });
        
        if (!data.nodes || !Array.isArray(data.nodes)) {
            console.log(`[${this.name}] ⚠️ No valid nodes array found in graph file.`);
            return;
        }

        // Rehydrate nodes
        for (const node of data.nodes) {
            this.nodes.set(node.id, node);
            this.conceptIndex.set((node.name || node.label || '').toLowerCase(), node.id);
            
            // Rebuild domain clusters
            if (!this.domainClusters.has(node.domain)) {
                this.domainClusters.set(node.domain, new Set());
            }
            this.domainClusters.get(node.domain).add(node.id);
        }

        // Rehydrate edges
        if (data.edges && Array.isArray(data.edges)) {
            for (const edge of data.edges) {
                this.edges.set(edge.id, edge);
            }
        }

        // Rehydrate metrics
        if (rawData.metrics) this.metrics = { ...this.metrics, ...rawData.metrics };
        if (rawData.stats) this.stats = { ...this.stats, ...rawData.stats };

        console.log(`[${this.name}] 📥 Loaded ${this.nodes.size} nodes and ${this.edges.size} edges from disk`);
        console.log(`[${this.name}]    Path: ${this.savePath}`);
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.warn(`[${this.name}] ⚠️ Failed to load graph: ${e.message}`);
        } else {
            console.log(`[${this.name}] 🆕 No existing graph found. Starting fresh.`);
        }
    }
  }

  async save() {
    try {
        const data = {
            nodes: Array.from(this.nodes.values()),
            edges: Array.from(this.edges.values()),
            metrics: this.metrics,
            stats: this.stats,
            savedAt: Date.now()
        };
        
        // Ensure dir exists
        await fs.mkdir(path.dirname(this.savePath), { recursive: true });
        
        // Atomic write
        const tempPath = `${this.savePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
        await fs.rename(tempPath, this.savePath);
        
        console.log(`[${this.name}] 💾 Saved graph (${this.nodes.size} nodes) to disk`);
    } catch (e) {
        console.error(`[${this.name}] ❌ Failed to save graph: ${e.message}`);
    }
  }

  /**
   * Build initial knowledge graph from fragment knowledge
   */
  async buildInitialGraph() {
    if (!this.fragmentRegistry) return;

    const fragments = this.fragmentRegistry.listFragments();
    console.log(`[${this.name}]    Building graph from ${fragments.length} fragments...`);

    for (const fragment of fragments) {
      // Add fragment's domain as a concept cluster
      if (!this.domainClusters.has(fragment.domain)) {
        this.domainClusters.set(fragment.domain, new Set());
      }

      // Extract concepts from fragment keywords
      for (const keyword of fragment.keywords || []) {
        const conceptId = await this.addConcept(keyword, {
          domain: fragment.domain,
          source: fragment.id,
          type: 'keyword',
          confidence: fragment.expertiseLevel || 0.5
        });

        this.domainClusters.get(fragment.domain).add(conceptId);
      }

      // Link fragment's domain concepts together
      const domainConcepts = Array.from(this.domainClusters.get(fragment.domain));
      for (let i = 0; i < domainConcepts.length - 1; i++) {
        for (let j = i + 1; j < domainConcepts.length; j++) {
          await this.addEdge(domainConcepts[i], domainConcepts[j], {
            relationship: 'related_in_domain',
            domain: fragment.domain,
            confidence: 0.6
          });
        }
      }
    }

    this.updateMetrics();
  }

  /**
   * Add a concept to the knowledge graph
   */
  async addConcept(name, metadata = {}) {
    const nameLower = name.toLowerCase();

    // Check if concept already exists
    if (this.conceptIndex.has(nameLower)) {
      const existingId = this.conceptIndex.get(nameLower);
      const existing = this.nodes.get(existingId);

      // Update usage count and metadata
      existing.usageCount++;
      existing.lastSeen = Date.now();
      if (metadata.confidence && metadata.confidence > existing.confidence) {
        existing.confidence = metadata.confidence;
      }

      return existingId;
    }

    // Create new concept
    const conceptId = `concept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const concept = {
      id: conceptId,
      name,
      domain: metadata.domain || 'general',
      type: metadata.type || 'concept',
      source: metadata.source || 'unknown',
      confidence: metadata.confidence || 0.5,
      usageCount: 1,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      metadata
    };

    this.nodes.set(conceptId, concept);
    this.conceptIndex.set(nameLower, conceptId);
    this.metrics.totalNodes++;

    this.emit('concept:added', concept);
    return conceptId;
  }

  /**
   * Add an edge between two concepts
   */
  async addEdge(fromId, toId, metadata = {}) {
    // Check if nodes exist
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) {
      return null;
    }

    // Create edge ID (bidirectional)
    const edgeId = [fromId, toId].sort().join('->');

    // Check if edge already exists
    if (this.edges.has(edgeId)) {
      const existing = this.edges.get(edgeId);
      existing.usageCount++;
      existing.confidence = Math.max(existing.confidence, metadata.confidence || 0.5);
      return edgeId;
    }

    // Create new edge
    const edge = {
      id: edgeId,
      from: fromId,
      to: toId,
      relationship: metadata.relationship || 'related_to',
      domain: metadata.domain || 'cross_domain',
      confidence: metadata.confidence || 0.5,
      usageCount: 1,
      createdAt: Date.now(),
      metadata
    };

    this.edges.set(edgeId, edge);
    this.metrics.totalEdges++;

    // Track cross-domain edges
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (fromNode.domain !== toNode.domain) {
      this.metrics.crossDomainEdges++;
      this.stats.crossDomainConnections++;

      const linkKey = [fromNode.domain, toNode.domain].sort().join('->');
      if (!this.crossDomainLinks.has(linkKey)) {
        this.crossDomainLinks.set(linkKey, []);
      }
      this.crossDomainLinks.get(linkKey).push(edgeId);
    }

    this.emit('edge:added', edge);
    return edgeId;
  }

  /**
   * Add a verified biomedical triple to the knowledge graph
   */
  async addBiomedicalTriple(subjectName, relation, objectName, metadata = {}) {
    if (!subjectName || !objectName || !relation) return null;

    const subId = await this.addConcept(subjectName, {
      domain: metadata.domainA || metadata.domain || 'biomedical',
      confidence: metadata.confidence || 0.85,
      type: metadata.subjectType || 'entity',
      source: metadata.pmid ? `PMID:${metadata.pmid}` : (metadata.source || 'literature')
    });

    const objId = await this.addConcept(objectName, {
      domain: metadata.domainB || metadata.domain || 'biomedical',
      confidence: metadata.confidence || 0.85,
      type: metadata.objectType || 'mechanism',
      source: metadata.pmid ? `PMID:${metadata.pmid}` : (metadata.source || 'literature')
    });

    const edgeId = await this.addEdge(subId, objId, {
      relationship: relation,
      confidence: metadata.confidence || 0.85,
      domain: metadata.domain || 'biomedical',
      pmid: metadata.pmid || null,
      title: metadata.title || null,
      journal: metadata.journal || null,
      evidenceSnippet: metadata.evidenceSnippet || null
    });

    return { subId, objId, edgeId };
  }

  /**
   * Swanson Literature-Based Discovery: Find unlinked entities that share common intermediate mechanisms
   */
  findSwansonBridges(entityA, entityB) {
    const idA = this.conceptIndex.get(String(entityA || '').toLowerCase());
    const idB = this.conceptIndex.get(String(entityB || '').toLowerCase());
    if (!idA || !idB) return [];

    const directEdge = [idA, idB].sort().join('->');
    const isDirectlyLinked = this.edges.has(directEdge);

    // Find all neighbors of A
    const neighborsA = new Map();
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.from === idA) neighborsA.set(edge.to, edge);
      else if (edge.to === idA) neighborsA.set(edge.from, edge);
    }

    // Check which neighbors of A are also neighbors of B
    const bridges = [];
    for (const [edgeId, edge] of this.edges.entries()) {
      const neighborId = edge.from === idB ? edge.to : (edge.to === idB ? edge.from : null);
      if (neighborId && neighborsA.has(neighborId)) {
        const bridgeNode = this.nodes.get(neighborId);
        const edgeA = neighborsA.get(neighborId);
        const edgeB = edge;
        bridges.push({
          bridgeNode: bridgeNode?.name || neighborId,
          bridgeDomain: bridgeNode?.domain || 'biomedical',
          relationA: edgeA.relationship,
          relationB: edgeB.relationship,
          confidence: Math.min(edgeA.confidence, edgeB.confidence),
          isDirectlyLinked,
          citationsA: edgeA.metadata?.pmid ? [edgeA.metadata.pmid] : [],
          citationsB: edgeB.metadata?.pmid ? [edgeB.metadata.pmid] : []
        });
      }
    }

    return bridges;
  }

  /**
   * Prune weak connections to reduce graph noise (Synaptic Pruning)
   */
  async pruneWeakConnections(threshold = 0.2) {
    console.log(`[${this.name}] ✂️  Pruning weak connections (threshold: ${threshold})...`);
    
    let prunedCount = 0;
    const initialSize = this.edges.size;

    for (const [edgeId, edge] of this.edges.entries()) {
      // Don't prune edges that have been reinforced recently (last 24h)
      const isRecent = (Date.now() - edge.createdAt) < 86400000;
      
      if (edge.confidence < threshold && !isRecent) {
        this.edges.delete(edgeId);
        prunedCount++;
        
        // Also remove from cross-domain links if applicable
        if (edge.domain === 'cross_domain') {
            // This is a bit expensive to find in the map, but pruning is rare
            for (const [key, links] of this.crossDomainLinks.entries()) {
                const index = links.indexOf(edgeId);
                if (index !== -1) {
                    links.splice(index, 1);
                    if (links.length === 0) this.crossDomainLinks.delete(key);
                    break;
                }
            }
        }
      }
    }

    this.metrics.totalEdges = this.edges.size;
    console.log(`[${this.name}]    Pruned ${prunedCount} weak edges (New total: ${this.edges.size})`);
    
    return { pruned: prunedCount, initialSize, finalSize: this.edges.size };
  }

  /**
   * Merge highly similar concepts (Concept Consolidation)
   */
  async mergeSimilarConcepts(threshold = 0.95) {
    console.log(`[${this.name}] 🔄 Merging similar concepts (threshold: ${threshold})...`);
    
    let mergedCount = 0;
    const nodesArr = Array.from(this.nodes.values());
    const toRemove = new Set();

    // Naive O(N^2) comparison - acceptable for "dreaming" phase (offline)
    // In production, use LSH (Locality Sensitive Hashing) or vector clustering
    for (let i = 0; i < nodesArr.length; i++) {
        if (toRemove.has(nodesArr[i].id)) continue;
        
        for (let j = i + 1; j < nodesArr.length; j++) {
            if (toRemove.has(nodesArr[j].id)) continue;
            
            const nodeA = nodesArr[i];
            const nodeB = nodesArr[j];
            
            // Skip if different domains (usually we don't merge across domains automatically)
            if (nodeA.domain !== nodeB.domain) continue;

            const similarity = await this._calculateSimilarity(nodeA.name, nodeB.name);
            
            if (similarity >= threshold) {
                // Merge B into A
                await this._performMerge(nodeA, nodeB);
                toRemove.add(nodeB.id);
                mergedCount++;
            }
        }
    }

    // Cleanup removed nodes
    for (const nodeId of toRemove) {
        this.nodes.delete(nodeId);
        // Remove from index
        for (const [name, id] of this.conceptIndex.entries()) {
            if (id === nodeId) this.conceptIndex.delete(name);
        }
    }

    this.metrics.totalNodes = this.nodes.size;
    console.log(`[${this.name}]    Merged ${mergedCount} duplicate concepts`);
    
    return { merged: mergedCount };
  }

  /**
   * Execute merge of Source -> Target
   */
  async _performMerge(target, source) {
      // 1. Move all edges from Source to Target
      for (const [edgeId, edge] of this.edges.entries()) {
          let modified = false;
          let otherNode = null;
          let direction = null; // 'from' or 'to'

          if (edge.from === source.id) {
              otherNode = edge.to;
              direction = 'from';
          } else if (edge.to === source.id) {
              otherNode = edge.from;
              direction = 'to';
          }

          if (otherNode) {
              // Avoid self-loops
              if (otherNode === target.id) {
                  this.edges.delete(edgeId); // Delete the edge between them
                  continue;
              }

              // Check if connection already exists on target
              const targetEdgeId = direction === 'from' 
                  ? [target.id, otherNode].sort().join('->')
                  : [otherNode, target.id].sort().join('->');

              if (this.edges.has(targetEdgeId)) {
                  // Reinforce existing edge
                  const existing = this.edges.get(targetEdgeId);
                  existing.confidence = Math.min(1.0, existing.confidence + (edge.confidence * 0.5));
                  existing.usageCount += edge.usageCount;
                  this.edges.delete(edgeId); // Remove old edge
              } else {
                  // Move edge to target
                  if (direction === 'from') edge.from = target.id;
                  else edge.to = target.id;
                  
                  // Update ID
                  const newId = [edge.from, edge.to].sort().join('->');
                  edge.id = newId;
                  this.edges.delete(edgeId);
                  this.edges.set(newId, edge);
              }
          }
      }

      // 2. Merge metadata
      target.usageCount += source.usageCount;
      target.confidence = Math.max(target.confidence, source.confidence);
      
      // Keep track of merged aliases
      if (!target.metadata.aliases) target.metadata.aliases = [];
      target.metadata.aliases.push(source.name);
  }

  /**
   * Link related concepts across different domains
   */
  async linkCrossDomainConcepts() {
    console.log(`[${this.name}]    Finding cross-domain connections...`);

    const conceptArray = Array.from(this.nodes.values());

    // Use embeddings if available
    if (this.mnemonic && this.mnemonic.embedder) {
      for (let i = 0; i < conceptArray.length; i++) {
        for (let j = i + 1; j < conceptArray.length; j++) {
          const conceptA = conceptArray[i];
          const conceptB = conceptArray[j];

          // Skip if same domain
          if (conceptA.domain === conceptB.domain) continue;

          // Calculate semantic similarity
          const similarity = await this._calculateSimilarity(conceptA.name, conceptB.name);

          if (similarity >= this.config.minSimilarityForLink) {
            await this.addEdge(conceptA.id, conceptB.id, {
              relationship: 'semantically_similar',
              domain: 'cross_domain',
              confidence: similarity
            });
          }
        }
      }
    } else {
      // Fallback: simple keyword matching
      for (let i = 0; i < conceptArray.length; i++) {
        for (let j = i + 1; j < conceptArray.length; j++) {
          const conceptA = conceptArray[i];
          const conceptB = conceptArray[j];

          if (conceptA.domain === conceptB.domain) continue;

          // Simple overlap check
          const wordsA = new Set(conceptA.name.toLowerCase().split(/\s+/));
          const wordsB = new Set(conceptB.name.toLowerCase().split(/\s+/));
          const overlap = [...wordsA].filter(w => wordsB.has(w)).length;

          if (overlap > 0) {
            const similarity = (overlap * 2) / (wordsA.size + wordsB.size);
            if (similarity >= 0.5) {
              await this.addEdge(conceptA.id, conceptB.id, {
                relationship: 'keyword_overlap',
                domain: 'cross_domain',
                confidence: similarity
              });
            }
          }
        }
      }
    }

    this.updateMetrics();
  }

  /**
   * Calculate semantic similarity between two concepts
   */
  async _calculateSimilarity(nameA, nameB) {
    try {
      if (!this.mnemonic || !this.mnemonic.embedder) {
        return 0.0;
      }

      const embeddingA = await this.mnemonic.embed(nameA);
      const embeddingB = await this.mnemonic.embed(nameB);

      // Cosine similarity
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < Math.min(embeddingA.length, embeddingB.length); i++) {
        dotProduct += embeddingA[i] * embeddingB[i];
        normA += embeddingA[i] ** 2;
        normB += embeddingB[i] ** 2;
      }

      if (normA === 0 || normB === 0) return 0.0;

      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    } catch (error) {
      return 0.0;
    }
  }

  /**
   * Query the knowledge graph
   */
  async query(conceptName, options = {}) {
    const { maxDepth = 2, minConfidence = 0.5, includeCrossDomain = true } = options;

    const conceptId = this.conceptIndex.get(conceptName.toLowerCase());
    if (!conceptId) {
      return {
        found: false,
        concept: null,
        related: []
      };
    }

    const concept = this.nodes.get(conceptId);
    const related = this._getRelatedConcepts(conceptId, maxDepth, minConfidence, includeCrossDomain);

    return {
      found: true,
      concept,
      related,
      crossDomainLinks: related.filter(r => r.domain !== concept.domain).length
    };
  }

  /**
   * Get related concepts (BFS traversal)
   */
  _getRelatedConcepts(startId, maxDepth, minConfidence, includeCrossDomain) {
    const related = [];
    const visited = new Set([startId]);
    const queue = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();

      if (depth >= maxDepth) continue;

      const startNode = this.nodes.get(startId);

      // Find all edges involving this node
      for (const [edgeId, edge] of this.edges) {
        if (edge.confidence < minConfidence) continue;

        let neighborId = null;
        if (edge.from === id) neighborId = edge.to;
        else if (edge.to === id) neighborId = edge.from;

        if (!neighborId || visited.has(neighborId)) continue;

        const neighbor = this.nodes.get(neighborId);

        // Check cross-domain filter
        if (!includeCrossDomain && neighbor.domain !== startNode.domain) {
          continue;
        }

        visited.add(neighborId);
        related.push({
          ...neighbor,
          relationship: edge.relationship,
          confidence: edge.confidence,
          depth: depth + 1
        });

        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }

    return related.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Perform inference to generate new knowledge
   */
  async performInference() {
    console.log(`[${this.name}] 🧠 Performing knowledge inference...`);

    let newFacts = 0;

    // Transitive inference: If A→B and B→C, then infer A→C
    for (const [edgeId1, edge1] of this.edges) {
      for (const [edgeId2, edge2] of this.edges) {
        // Check if edge1.to === edge2.from (transitivity)
        if (edge1.to === edge2.from) {
          const inferredId = `${edge1.from}->${edge2.to}`;

          // Check if this inference already exists
          if (this.inferencedFacts.has(inferredId)) continue;

          // Calculate confidence of inference
          const confidence = edge1.confidence * edge2.confidence;

          if (confidence >= this.config.inferenceConfidenceThreshold) {
            this.inferencedFacts.set(inferredId, confidence);
            newFacts++;

            // Optionally add as actual edge
            await this.addEdge(edge1.from, edge2.to, {
              relationship: 'inferred_from',
              confidence,
              metadata: {
                inferredFrom: [edgeId1, edgeId2]
              }
            });
          }
        }
      }
    }

    this.stats.inferencesGenerated += newFacts;
    this.metrics.inferredFacts = this.inferencedFacts.size;

    console.log(`[${this.name}]    Generated ${newFacts} new inferred facts`);
  }

  /**
   * Detect contradictions in the knowledge graph
   */
  async detectContradictions() {
    // Placeholder: In a real implementation, this would use formal logic
    // to detect contradictory statements
    console.log(`[${this.name}] 🔍 Detecting contradictions...`);

    // Example: If concept A has edges saying both "is X" and "is not X"
    // This is simplified - real contradiction detection is more complex

    for (const [conceptId, concept] of this.nodes) {
      const conflicting = [];
      const relatedEdges = [];

      // Find all edges involving this concept
      for (const [edgeId, edge] of this.edges) {
        if (edge.from === conceptId || edge.to === conceptId) {
          relatedEdges.push(edge);
        }
      }

      // Check for contradictory relationships
      // This is a simplified example
      for (let i = 0; i < relatedEdges.length; i++) {
        for (let j = i + 1; j < relatedEdges.length; j++) {
          const rel1 = relatedEdges[i].relationship;
          const rel2 = relatedEdges[j].relationship;

          if (rel1.startsWith('is_') && rel2.startsWith('is_not_')) {
            conflicting.push([relatedEdges[i], relatedEdges[j]]);
          }
        }
      }

      if (conflicting.length > 0) {
        this.contradictions.set(conceptId, conflicting);
        this.metrics.contradictionsFound++;
      }
    }

    console.log(`[${this.name}]    Found ${this.contradictions.size} potential contradictions`);
  }

  /**
   * Update graph metrics
   */
  updateMetrics() {
    this.metrics.totalNodes = this.nodes.size;
    this.metrics.totalEdges = this.edges.size;

    if (this.nodes.size > 0) {
      this.metrics.avgDegree = (2 * this.edges.size) / this.nodes.size;
      const maxPossibleEdges = (this.nodes.size * (this.nodes.size - 1)) / 2;
      this.metrics.density = maxPossibleEdges > 0 ? this.edges.size / maxPossibleEdges : 0;
    }

    // Find largest cluster
    let maxClusterSize = 0;
    for (const [domain, cluster] of this.domainClusters) {
      maxClusterSize = Math.max(maxClusterSize, cluster.size);
    }
    this.metrics.largestCluster = maxClusterSize;
  }

  /**
   * MessageBroker event handlers
   */
  async _handleKnowledgeAddition(data) {
    const { concept, domain, confidence } = data;
    const conceptId = await this.addConcept(concept, { domain, confidence });

    // Link to existing concepts
    await this.linkCrossDomainConcepts();

    this.stats.graphUpdates++;
  }

  async _handleKnowledgeQuery(data) {
    const { query, options } = data;
    const result = await this.query(query, options);

    if (this.messageBroker) {
      this.messageBroker.publish('knowledge:query:response', {
        query,
        result,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Start periodic graph maintenance
   */
  startGraphMaintenance() {
    // Periodic inference
    setInterval(async () => {
      if (this.nodes.size > 10) {
        await this.performInference();
      }
    }, 300000); // Every 5 minutes

    // Periodic contradiction detection
    setInterval(async () => {
      if (this.nodes.size > 10) {
        await this.detectContradictions();
      }
    }, 600000); // Every 10 minutes

    // Periodic metrics update
    setInterval(() => {
      this.updateMetrics();
    }, 60000); // Every minute

    // Periodic Save (Every 2 minutes)
    setInterval(async () => {
        if (this.nodes.size > 0) {
            await this.save();
        }
    }, 120000);
  }

  /**
   * Get knowledge graph statistics
   */
  getStats() {
    return {
      ...this.stats,
      metrics: { ...this.metrics },
      domains: this.domainClusters.size,
      crossDomainLinkTypes: this.crossDomainLinks.size
    };
  }

  /**
   * Generate Visual Graph (Mermaid.js) - Visual Proprioception
   * SOMA can "see" her own mind structure.
   */
  generateVisualGraph() {
    let mermaid = 'graph TD\n';
    
    // Add Subgraphs for Domains
    for (const [domain, nodes] of this.domainClusters) {
        mermaid += `  subgraph ${domain}\n`;
        for (const nodeId of nodes) {
            const node = this.nodes.get(nodeId);
            if (node) {
                // Sanitize name for ID
                const safeId = nodeId.replace(/[^a-zA-Z0-9]/g, '');
                const safeLabel = node.name.replace(/["']/g, '');
                mermaid += `    ${safeId}("${safeLabel}")\n`;
            }
        }
        mermaid += `  end\n`;
    }

    // Add Edges
    // Limit edges to prevent visual chaos (Top 50 by confidence)
    const sortedEdges = Array.from(this.edges.values())
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 50);

    for (const edge of sortedEdges) {
        const fromSafe = edge.from.replace(/[^a-zA-Z0-9]/g, '');
        const toSafe = edge.to.replace(/[^a-zA-Z0-9]/g, '');
        // Thickness based on confidence
        const arrow = edge.confidence > 0.8 ? '==>' : '-->';
        mermaid += `  ${fromSafe} ${arrow}|${edge.relationship}| ${toSafe}\n`;
    }

    return mermaid;
  }

  /**
   * Export knowledge graph (for visualization or persistence)
   */
  exportGraph() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      metrics: this.metrics,
      timestamp: Date.now()
    };
  }
}

export default KnowledgeGraphFusion;
