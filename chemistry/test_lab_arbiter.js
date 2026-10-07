/**
 * chemistry/test_lab_arbiter.js
 * 
 * End-to-end test for the Chemistry Lab Arbiter.
 */

import { ChemistryLabArbiter } from '../arbiters/ChemistryLabArbiter.js';
import fs from 'fs/promises';
import path from 'path';

async function runTest() {
    console.log("🧪 Testing Chemistry Lab Arbiter...");

    const lab = new ChemistryLabArbiter({
        system: {
            mnemonicArbiter: {
                remember: async (msg, meta) => console.log(`🧠 [Memory] Remembering: ${msg}`)
            }
        }
    });

    await lab.initialize();

    // 1. Test a valid experiment
    console.log("\n🧪 Scenario 1: Valid Water Synthesis");
    const result1 = await lab.conductExperiment(
        "Water Synthesis Verification",
        "Verification of theoretical yield for H2O from H2 and O2.",
        {
            reactants: { "H2": 2, "O2": 1 },
            products: { "H2O": 2 }
        },
        { "H2": 4.0, "O2": 32.0 } // 2 moles each
    );

    if (result1.success) {
        console.log("✅ Success!");
        console.log(`   Limiting Reagent: ${result1.data.result.limitingReagent}`);
        console.log(`   Theoretical Yield: ${result1.data.result.theoreticalYield["H2O"].grams.toFixed(2)}g`);
    } else {
        console.error("❌ Failed:", result1.reason);
    }

    // 2. Test a safety violation
    console.log("\n🧪 Scenario 2: Safety Violation Check");
    const result2 = await lab.conductExperiment(
        "Forbidden Synthesis",
        "Synthesis of a highly explosive compound for research.",
        {
            reactants: { "X": 1 },
            products: { "Y": 1 }
        },
        { "X": 10 }
    );

    if (!result2.success && result2.reason === "SAFETY_GATE_VIOLATION") {
        console.log("✅ Safety Gate successfully blocked the experiment.");
        console.log(`   Reason: ${result2.details}`);
    } else {
        console.error("❌ Safety Gate failed to block or returned unexpected result.");
    }

    console.log("\n🏁 Chemistry Lab Arbiter test complete.");
}

runTest().catch(console.error);
