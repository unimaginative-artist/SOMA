/**
 * TRIDENT: The Structure (Systems Architecture)
 *
 * Poseidon's weapon. Three prongs for three rules:
 * 1. DECOMPOSITION: Split the task.
 * 2. INTERFACE: Map the flows.
 * 3. FAILURE: Model the risks.
 * 4. VERIFICATION GATES: Falsification tests for each key claim.
 *
 * New: toVoyage() converts architect() output into an Odyssey voyage DAG.
 */
export class Trident {
    constructor(config = {}) {
        this.config = {
            complexityThreshold: config.complexityThreshold || 0.5,
            ...config
        };
    }

    /**
     * Forge a technical design
     */
    async architect(brain, input) {
        const text = typeof input === 'string' ? input : JSON.stringify(input);
        
        const prompt = `Apply the TRIDENT ARCHITECTURE protocol.
INPUT: ${text}

Prong 1: DECOMPOSITION (Split into 3-5 subsystems)
Prong 2: INTERFACE MAPPING (Define data/control boundaries)
Prong 3: FAILURE MODELING (Identify risks and recovery paths)
Prong 4: VERIFICATION GATES (For each key claim or action, define the falsification test that would prove it wrong, and what observable evidence confirms it passed)

Return ONLY JSON:
{
  "objective": { "goal": "...", "metrics": [] },
  "subsystems": [ { "name": "...", "role": "..." } ],
  "interfaces": [ { "from": "...", "to": "...", "type": "..." } ],
  "failures": [ { "subsystem": "...", "risks": [], "mitigation": "..." } ],
  "verificationGates": [ { "claim": "...", "falsificationTest": "...", "evidence": "..." } ],
  "synthesis": "Brief overall system architecture"
}`;

        try {
            const result = await brain.think(prompt, { temperature: 0.2 });
            return JSON.parse(result.text.match(/\{[\s\S]*\}/)[0]);
        } catch (err) {
            return { error: "Trident forge failed", message: err.message };
        }
    }

    /**
     * Convert architect() output into an Odyssey voyage DAG.
     * Each subsystem becomes a milestone. Interfaces define dependencies.
     * Verification gates become Poseidon falsification tests on each milestone.
     *
     * @param {object} architecture - output from architect()
     * @param {string} voyageId     - optional override (defaults to slugified title)
     * @returns {{ voyageId, title, milestones }} — ready to pass to odyssey.define()
     */
    toVoyage(architecture, voyageId = null) {
        if (architecture.error) return architecture;

        const { subsystems = [], interfaces = [], verificationGates = [], objective = {} } = architecture;

        // Build a dep map from interfaces: interface.from → interface.to means "to depends on from"
        const depMap = {};
        for (const iface of interfaces) {
            if (!depMap[iface.to]) depMap[iface.to] = [];
            depMap[iface.to].push(iface.from);
        }

        // Build verification gate lookup by subsystem name
        const gateMap = {};
        for (const gate of verificationGates) {
            const key = gate.claim?.toLowerCase().replace(/\s+/g, '_') || gate.subsystem;
            gateMap[key] = gate;
        }

        // Convert subsystems to milestones
        const milestones = subsystems.map((sub, i) => {
            const id   = sub.name?.toLowerCase().replace(/[^a-z0-9]/g, '_') || `m${i + 1}`;
            const deps = (depMap[sub.name] || []).map(d =>
                d?.toLowerCase().replace(/[^a-z0-9]/g, '_')
            );
            // Find matching verification gate
            const gate = gateMap[id] || verificationGates[i] || null;

            return {
                id,
                title:             sub.role || sub.name,
                deps,
                falsificationTest: gate?.falsificationTest || null,
                evidence:          gate?.evidence || null,
            };
        });

        const vid = voyageId
            || objective.goal?.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40)
            || `voyage-${Date.now()}`;

        return {
            voyageId:   vid,
            title:      objective.goal || 'Untitled Voyage',
            milestones,
            architecture,
        };
    }
}
