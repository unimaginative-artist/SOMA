import { createHash } from 'node:crypto';

const clean = (value, max = 5000) => String(value ?? '').replace(/\0/g, '').trim().slice(0, max);

function memoryRows(payload) {
    const rows = payload?.results || (Array.isArray(payload) ? payload : []);
    return rows.slice(0, 5).map((row, index) => ({
        id: row?.id || `memory-${index + 1}`,
        content: clean(row?.content || row, 1800),
        source: 'MnemonicArbiter',
        kind: 'retrieved_memory',
        confidence: Number(row?.similarity ?? row?.score ?? 0.5)
    })).filter(row => row.content);
}

/** Builds one immutable evidence package shared by every council seat. */
export class CouncilEvidenceProvider {
    constructor({ mnemonic = null, graph = null, operationalState = null, logger = console } = {}) {
        this.mnemonic = mnemonic;
        this.graph = graph;
        this.operationalState = operationalState;
        this.logger = logger;
    }

    async build(question, context = {}) {
        const facts = [];
        const sources = [];
        const operational = clean(context.operationalContext || await this.operationalState?.(context), 7000);
        if (operational) {
            facts.push({ kind: 'operational_snapshot', source: 'SOMA runtime', content: operational, confidence: 1 });
            sources.push({ type: 'runtime', id: 'current-operational-context' });
        }

        if (this.mnemonic?.recall) {
            try {
                const recalled = await Promise.race([
                    this.mnemonic.recall(question, 5),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('memory timeout')), 5000))
                ]);
                for (const row of memoryRows(recalled)) {
                    facts.push(row);
                    sources.push({ type: 'memory', id: row.id });
                }
            } catch (error) {
                this.logger.warn?.(`[CouncilEvidence] Memory retrieval unavailable: ${error.message}`);
            }
        }

        if (this.graph?.retrieve) {
            try {
                const graph = await Promise.race([
                    this.graph.retrieve(question, { forceGraphRetrieval: true, limit: 8 }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('graph timeout')), 6000))
                ]);
                if (graph?.used && graph.context) {
                    facts.push({ kind: 'knowledge_graph', source: 'GraphCognitiveSubstrate', content: clean(graph.context, 7000), confidence: 0.8 });
                    sources.push(...(graph.sources || []).map(source => ({ type: 'graph', ...source })));
                }
            } catch (error) {
                this.logger.warn?.(`[CouncilEvidence] Graph retrieval unavailable: ${error.message}`);
            }
        }

        for (const item of Array.isArray(context.externalEvidence) ? context.externalEvidence.slice(0, 12) : []) {
            const content = clean(item?.content || item, 2500);
            if (!content) continue;
            facts.push({ kind: item.kind || 'external_evidence', source: clean(item.source || item.url || 'provided', 500), content, confidence: Number(item.confidence ?? 0.7) });
            sources.push({ type: 'external', id: item.url || item.source || `external-${sources.length + 1}` });
        }

        const text = facts.length
            ? facts.map((fact, index) => `[E${index + 1}] ${fact.kind} | source=${fact.source} | confidence=${fact.confidence}\n${fact.content}`).join('\n\n')
            : '[NO RETRIEVED EVIDENCE] Treat unsupported claims as unknown and request verification.';
        const digest = createHash('sha256').update(text).digest('hex');
        return { version: 1, createdAt: new Date().toISOString(), digest, facts, sources, text: clean(text, 20_000) };
    }
}

export default CouncilEvidenceProvider;
