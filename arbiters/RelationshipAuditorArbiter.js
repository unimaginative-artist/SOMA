/**
 * arbiters/RelationshipAuditorArbiter.js
 * 
 * The Causal Graph Lobe: Detects "Triangles of Fraud" using graph topology.
 * Analyzes relationships between Employees, Vendors, and Transactions 
 * to find conflicts of interest or shell company patterns.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

export class RelationshipAuditorArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: 'RelationshipAuditor',
            role: ArbiterRole.OBSERVER,
            capabilities: [ArbiterCapability.KNOWLEDGE_SYNTHESIS, ArbiterCapability.REASONING],
        });
        
        this.graphPath = path.join(process.cwd(), 'graphify-out', 'graph.json');
    }

    async initialize() {
        this.auditLogger.success(`🕸️ [${this.name}] Relationship Auditor online. Topology analysis active.`);
    }

    /**
     * Audits the graph for a specific entity (e.g., a Vendor or Employee).
     */
    async auditEntityRelationships(entityName) {
        this.auditLogger.info(`🕸️ [Auditor] Analyzing topology for: ${entityName}`);
        
        try {
            const data = await fs.readFile(this.graphPath, 'utf8');
            const graph = JSON.parse(data);
            
            const nodes = graph.nodes || [];
            const links = graph.links || graph.edges || [];

            // 1. Find the target node
            const targetNode = nodes.find(n => n.id?.toLowerCase().includes(entityName.toLowerCase()) || n.label?.toLowerCase().includes(entityName.toLowerCase()));
            
            if (!targetNode) {
                return { success: false, error: "Entity not found in graph topology." };
            }

            // 2. Find immediate neighbors (Degree 1)
            const neighbors = links.filter(l => l.source === targetNode.id || l.target === targetNode.id)
                                  .map(l => l.source === targetNode.id ? l.target : l.source);

            // 3. Look for "Shared Connectivity" (The Triangle)
            // Pattern: Target -> X -> Y <- Target
            const conflicts = [];
            
            for (const neighborId of neighbors) {
                const neighborLinks = links.filter(l => l.source === neighborId || l.target === neighborId);
                for (const nl of neighborLinks) {
                    const farNodeId = nl.source === neighborId ? nl.target : nl.source;
                    if (farNodeId === targetNode.id) continue;

                    // Is this "far node" also connected to target directly?
                    const directLink = links.find(l => 
                        (l.source === targetNode.id && l.target === farNodeId) || 
                        (l.target === targetNode.id && l.source === farNodeId)
                    );

                    if (directLink) {
                        const farNode = nodes.find(n => n.id === farNodeId);
                        conflicts.push({
                            pattern: "Circular Relationship / Triangle",
                            nodes: [targetNode.id, neighborId, farNodeId],
                            description: `Entity ${targetNode.id} is connected to ${farNodeId} both directly and via ${neighborId}.`
                        });
                    }
                }
            }

            return {
                success: true,
                entity: targetNode.id,
                risk_level: conflicts.length > 0 ? "HIGH" : "LOW",
                findings: conflicts,
                metadata: {
                    neighbor_count: neighbors.length,
                    links_analyzed: links.length
                }
            };

        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    getStatus() {
        return {
            name: this.name,
            ready: true
        };
    }
}

export default RelationshipAuditorArbiter;
