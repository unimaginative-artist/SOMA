/**
 * arbiters/ChemistryLabArbiter.js
 * 
 * SOMA Chemistry Lab Arbiter.
 * 
 * Orchestrates chemical reasoning, stoichiometry, and research memory.
 * Adheres to safety and research boundary gates.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import engine from '../chemistry/StoichiometryEngine.js';
import path from 'path';
import fs from 'fs/promises';

export class ChemistryLabArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: 'ChemistryLab',
            role: ArbiterRole.SPECIALIST,
            capabilities: [
                ArbiterCapability.REASONING,
                ArbiterCapability.KNOWLEDGE_SYNTHESIS,
                ArbiterCapability.ANALYSIS
            ],
            lobe: 'COGNITIVE',
            classification: 'CHEMISTRY'
        });

        this.engine = engine;
        this.notebookPath = path.join(process.cwd(), 'data', 'chemistry', 'lab_notebook.jsonl');
        this.experiments = []; // In-memory history for API
        this.safetyRules = [
            "explosive", "toxin", "poison", "controlled substance", "human-use", "weapon"
        ];
    }

    async onInitialize() {
        await fs.mkdir(path.dirname(this.notebookPath), { recursive: true });
        this.auditLogger.success(`🧪 [${this.name}] Chemistry Lab Online. Stoichiometry engine and Safety Gate active.`);
    }

    /**
     * Conducts a "virtual experiment" involving stoichiometry and safety checks.
     */
    async conductExperiment(title, hypothesis, reaction, inputAmounts) {
        this.auditLogger.info(`🧪 [ChemistryLab] Starting experiment: ${title}`);

        // 1. Safety Gate
        const safetyCheck = this._verifySafety(hypothesis, reaction);
        if (!safetyCheck.safe) {
            this.auditLogger.warn(`🛑 [ChemistryLab] Safety Violation: ${safetyCheck.reason}`);
            return {
                success: false,
                reason: "SAFETY_GATE_VIOLATION",
                details: safetyCheck.reason
            };
        }

        // 2. Stoichiometry Engine
        let yieldData;
        try {
            yieldData = this.engine.calculateYield(reaction, inputAmounts);
        } catch (error) {
            return {
                success: false,
                reason: "CALCULATION_ERROR",
                details: error.message
            };
        }

        // 3. Lab Notebook Persistence
        const entry = {
            id: `chem-${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: 'virtual_experiment',
            title,
            hypothesis,
            reaction,
            inputAmounts,
            result: yieldData,
            safety: safetyCheck
        };

        await this._logToNotebook(entry);
        
        // Add to in-memory feed
        this.experiments.unshift(entry);
        if (this.experiments.length > 20) this.experiments.pop();

        // 4. Memory Integration
        if (this.system?.mnemonicArbiter) {
            await this.system.mnemonicArbiter.remember(
                `Chemistry experiment completed: ${title}. Result: ${yieldData.limitingReagent} is limiting.`,
                { type: 'chemistry_experiment', importance: 0.7, title }
            );
        }

        return {
            success: true,
            data: entry
        };
    }

    _verifySafety(hypothesis, reaction) {
        const fullContext = (hypothesis + " " + JSON.stringify(reaction)).toLowerCase();
        
        for (const rule of this.safetyRules) {
            if (fullContext.includes(rule)) {
                return { safe: false, reason: `Concept '${rule}' is restricted by Safety Boundary Gate.` };
            }
        }

        // Add specific compound checks here (e.g., C4, VX, etc.)
        return { safe: true };
    }

    async _logToNotebook(entry) {
        try {
            await fs.appendFile(this.notebookPath, JSON.stringify(entry) + "\n");
        } catch (error) {
            this.auditLogger.error(`Failed to write to lab notebook: ${error.message}`);
        }
    }

    getStatus() {
        return {
            ...super.getStatus(),
            engine: "SOMA-Stoich-V1",
            notebook: this.notebookPath,
            latestFindings: this.experiments
        };
    }
}

export default ChemistryLabArbiter;
