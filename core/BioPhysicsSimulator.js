/**
 * ============================================================
 * SOMA BIOPHYSICS SIMULATOR FRAMEWORK
 * ============================================================
 *
 * PURPOSE:
 * A lightweight, structure-aware docking filter that screens
 * molecules before expensive modeling or statistical analysis.
 *
 * PRIMARY ROLE:
 * Filter weak or impossible molecules early in the pipeline.
 *
 * ============================================================
 */

import path from 'path';

export class BioPhysicsSimulator {
    constructor(config = {}) {
        this.name = "BioPhysicsSimulator";
        this.config = {
            rotations: config.rotations || 1000,
            bindingThreshold: config.bindingThreshold || -5.0,
            confidenceScale: config.confidenceScale || 15.0
        };

        /**
         * MEMORY STORAGE
         * Stores previously successful interactions.
         */
        this.memory = [];
    }

    /**
     * MOLECULAR FEATURE EXTRACTION
     *
     * Accepts three input styles:
     *   1. SMILES string (e.g. "CCOc1ccc(NC(=O)...)") — count actual atoms
     *   2. Drug name (e.g. "imatinib", "BI-3406") — use lookup table
     *   3. target_strand_probe fallback — derive from string hash for determinism
     */
    extractFeatures(molecule) {
        // Known drug → approximate feature profiles
        const DRUG_PROFILES = {
            imatinib:      { donors: 2, acceptors: 7, hydrophobicGroups: 6, rotatableBonds: 7,  aromaticRings: 3, molecularWeight: 493 },
            gefitinib:     { donors: 1, acceptors: 7, hydrophobicGroups: 5, rotatableBonds: 6,  aromaticRings: 2, molecularWeight: 446 },
            erlotinib:     { donors: 1, acceptors: 6, hydrophobicGroups: 5, rotatableBonds: 6,  aromaticRings: 2, molecularWeight: 393 },
            pembrolizumab: { donors: 4, acceptors: 8, hydrophobicGroups: 3, rotatableBonds: 12, aromaticRings: 0, molecularWeight: 146000 },
            atorvastatin:  { donors: 2, acceptors: 5, hydrophobicGroups: 4, rotatableBonds: 9,  aromaticRings: 2, molecularWeight: 558 },
        };

        const lc = molecule.toLowerCase().replace(/[-_\s]/g, '');
        for (const [name, profile] of Object.entries(DRUG_PROFILES)) {
            if (lc.includes(name)) return profile;
        }

        // SMILES detection: has lowercase aromatic atoms or = / # bonds
        const isSmiles = /[a-z]|[=#@\/\\]|\[/.test(molecule);
        if (isSmiles) {
            return {
                donors:           (molecule.match(/[NO]/g) || []).length,
                acceptors:        (molecule.match(/[NOF]/g) || []).length,
                hydrophobicGroups:(molecule.match(/C/g) || []).length,
                rotatableBonds:   Math.floor(molecule.length / 5),
                aromaticRings:    (molecule.match(/c/g) || []).length,
                molecularWeight:  molecule.length * 12,
            };
        }

        // Deterministic hash for probe strings (target_strand_probe)
        // Ensures same probe always gets same features (reproducible physics)
        let hash = 0;
        for (let i = 0; i < molecule.length; i++) hash = (hash * 31 + molecule.charCodeAt(i)) >>> 0;
        return {
            donors:           1 + (hash % 3),
            acceptors:        1 + ((hash >> 2) % 4),
            hydrophobicGroups:2 + ((hash >> 4) % 5),
            rotatableBonds:   2 + ((hash >> 6) % 6),
            aromaticRings:    (hash >> 8) % 3,
            molecularWeight:  200 + (hash % 400),
        };
    }

    /**
     * TARGET POCKET NORMALIZATION
     */
    normalizeTarget(target) {
        return {
            name: target.name || target.id || "Unknown",
            size: target.size || 12,
            polarity: target.polarity || 0.5,
            preferredDonors: target.preferredDonors || 2,
            preferredAcceptors: target.preferredAcceptors || 2
        };
    }

    /**
     * MEMORY BIASING SYSTEM
     */
    applyMemoryBias(features) {
        let bonus = 0;
        for (const record of this.memory) {
            if (record.features.donors === features.donors) bonus -= 0.5;
            if (record.features.acceptors === features.acceptors) bonus -= 0.5;
        }
        return bonus;
    }

    /**
     * CORE DOCKING SIMULATION
     */
    async simulateDocking(molecule, targetInput) {
        const pocket = this.normalizeTarget(targetInput);
        console.log(`🧬 [Physics] Simulating Docking: ${molecule} ➔ ${pocket.name}`);

        const features = this.extractFeatures(molecule);
        let bindingEnergy = -2.0;

        /**
         * Monte Carlo Orientation Search
         */
        for (let i = 0; i < this.config.rotations; i++) {
            let fitScore = Math.random() * -2.0;

            // Hydrogen Bond Bonus
            fitScore -= features.donors * 0.5;
            fitScore -= features.acceptors * 0.4;

            // Hydrophobic Bonus
            fitScore -= features.hydrophobicGroups * 0.1;

            // Flexibility Penalty
            fitScore += features.rotatableBonds * 0.2;

            // Pocket Compatibility
            if (features.acceptors === pocket.preferredAcceptors) fitScore -= 1.2;
            if (features.donors === pocket.preferredDonors) fitScore -= 1.0;

            // MEMORY BIAS
            fitScore += this.applyMemoryBias(features);

            if (fitScore < bindingEnergy) {
                bindingEnergy = fitScore;
            }
        }

        // COMPLEXITY PENALTY
        if (molecule.length > 20) bindingEnergy += 1.5;

        const passed = bindingEnergy < this.config.bindingThreshold;

        // CONFIDENCE SCALING
        const confidence = Math.max(0.1, 1.0 - (Math.abs(bindingEnergy) / this.config.confidenceScale));

        const result = {
            affinity: parseFloat(bindingEnergy.toFixed(2)),
            unit: "kcal/mol",
            passed,
            confidence: parseFloat(confidence.toFixed(2)),
            features,
            reasoning: passed 
                ? `Strong compatibility detected in ${pocket.name}.` 
                : `Weak compatibility or steric mismatch in ${pocket.name}.`
        };

        if (passed) {
            this.memory.push({ molecule, target: pocket.name, affinity: bindingEnergy, features });
        }

        return result;
    }
}

/**
 * TARGET LIBRARY SYSTEM
 */
export const TargetLibrary = {
    TP53: { name: "TP53", preferredDonors: 2, preferredAcceptors: 2, polarity: 0.4 },
    KRAS: { name: "KRAS", preferredDonors: 1, preferredAcceptors: 3, polarity: 0.3 },
    PCSK9: { name: "PCSK9", preferredDonors: 3, preferredAcceptors: 2, polarity: 0.6 },
    APP: { name: "APP", preferredDonors: 2, preferredAcceptors: 1, polarity: 0.5 },
    EGFR: { name: "EGFR", preferredDonors: 2, preferredAcceptors: 3, polarity: 0.6 },
    ACE2: { name: "ACE2", preferredDonors: 1, preferredAcceptors: 2 },
    VEGFR: { name: "VEGFR", preferredDonors: 2, preferredAcceptors: 2 }
};

export default BioPhysicsSimulator;
