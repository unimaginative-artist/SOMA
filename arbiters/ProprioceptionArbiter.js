/**
 * ProprioceptionArbiter.js
 * 
 * Provides SOMA with "Body Awareness" of her own cognitive state.
 * It analyzes the Knowledge Graph and Memory Tiers to identify:
 * - Knowledge Silos: Domains that aren't connecting to others.
 * - Cognitive Weakness: Domains with low node density.
 * - Memory Saturation: Tiers that are reaching capacity.
 */

import BaseArbiter, { ArbiterRole, ArbiterCapability } from '../core/BaseArbiter.js';

export class ProprioceptionArbiter extends BaseArbiter {
    constructor(opts = {}) {
        super({
            name: 'SOMA-Proprioception',
            role: ArbiterRole.ANALYST,
            capabilities: [ArbiterCapability.ANALYZE_DATA],
            ...opts
        });

        this.kg = opts.knowledgeGraph || null;
        this.mnemonic = opts.mnemonic || null;
        this.lastSelfScan = null;
    }

    async analyzeCognitiveState() {
        this.log('info', '🧘 Initiating cognitive proprioception scan...');
        
        const report = {
            timestamp: Date.now(),
            graphHealth: this._analyzeGraphHealth(),
            memoryHealth: await this._analyzeMemoryHealth(),
            recommendations: []
        };

        // Generate Recommendations
        if (report.graphHealth.silos.length > 0) {
            report.recommendations.push({
                priority: 'medium',
                action: 'CROSS_DOMAIN_SYNTHESIS',
                target: report.graphHealth.silos[0],
                reason: 'Domain is isolated from the rest of the mind.'
            });
        }

        if (report.memoryHealth.pressure > 0.8) {
            report.recommendations.push({
                priority: 'high',
                action: 'DEEP_DREAM_CONSOLIDATION',
                reason: 'Memory tiers are reaching saturation.'
            });
        }

        this.lastSelfScan = report;
        this.emit('proprioception:report', report);
        return report;
    }

    _analyzeGraphHealth() {
        if (!this.kg) return { status: 'unknown' };
        
        const stats = this.kg.getStats();
        const density = stats.metrics.density;
        const silos = [];

        // Identify silos (domains with 0 cross-domain links)
        for (const [domain, nodes] of this.kg.domainClusters.entries()) {
            let hasCrossLink = false;
            for (const [linkKey, links] of this.kg.crossDomainLinks.entries()) {
                if (linkKey.includes(domain)) {
                    hasCrossLink = true;
                    break;
                }
            }
            if (!hasCrossLink && nodes.size > 2) silos.push(domain);
        }

        return {
            totalConcepts: stats.metrics.totalNodes,
            crossDomainLinks: stats.crossDomainConnections,
            density: density.toFixed(4),
            silos: silos,
            status: density > 0.01 ? 'optimal' : 'fragmented'
        };
    }

    async _analyzeMemoryHealth() {
        if (!this.mnemonic) return { status: 'unknown' };

        const stats = this.mnemonic.getMemoryStats ? this.mnemonic.getMemoryStats() : {};
        const pressurePercent = Number(stats.memoryPressure);
        const pressure = Number.isFinite(pressurePercent)
            ? Math.max(0, Math.min(1, pressurePercent / 100))
            : null;
        const tierDistribution = {
            hot: stats.hot || null,
            warm: stats.warm || null,
            cold: stats.cold || null
        };

        return {
            hotTierActive: stats.hot?.status === 'connected',
            tierDistribution,
            pressure,
            status: pressure == null ? 'unknown' : pressure >= 0.9 ? 'critical' : pressure >= 0.8 ? 'pressured' : 'stable'
        };
    }

    async execute(task) {
        if (task.query === 'scan') {
            const report = await this.analyzeCognitiveState();
            return { success: true, data: report };
        }
        return { success: false, error: 'Unknown command' };
    }
}

export default ProprioceptionArbiter;
