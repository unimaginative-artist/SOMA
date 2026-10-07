/**
 * chemistry/test_stoichiometry.js
 * 
 * Verification suite for the SOMA Stoichiometry Engine.
 */

import engine from './StoichiometryEngine.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

async function runTests() {
    console.log("🧪 Running Stoichiometry Engine Tests...");

    // 1. Formula Parsing
    console.log("  - Testing Formula Parsing...");
    const water = engine.parseFormula("H2O");
    assert(water.H === 2 && water.O === 1, "H2O parsing failed");

    const calciumHydroxide = engine.parseFormula("Ca(OH)2");
    assert(calciumHydroxide.Ca === 1 && calciumHydroxide.O === 2 && calciumHydroxide.H === 2, "Ca(OH)2 parsing failed");

    const complex = engine.parseFormula("C6H12O6");
    assert(complex.C === 6 && complex.H === 12 && complex.O === 6, "Glucose parsing failed");

    // 2. Molar Mass
    console.log("  - Testing Molar Mass Calculation...");
    const waterMass = engine.calculateMolarMass("H2O");
    assert(Math.abs(waterMass - 18.015) < 0.01, `H2O molar mass failed: ${waterMass}`);

    const glucoseMass = engine.calculateMolarMass("C6H12O6");
    assert(Math.abs(glucoseMass - 180.156) < 0.01, `Glucose molar mass failed: ${glucoseMass}`);

    // 3. Stoichiometry / Yield
    console.log("  - Testing Yield Calculation...");
    // 2 H2 + O2 -> 2 H2O
    const reaction = {
        reactants: { "H2": 2, "O2": 1 },
        products: { "H2O": 2 }
    };

    // Case: 10g H2, excess O2
    const result = engine.calculateYield(reaction, { "H2": 10, "O2": 100 }, 'grams');
    console.log(`    - Reaction: 2H2 + O2 -> 2H2O`);
    console.log(`    - Input: 10g H2, 100g O2`);
    console.log(`    - Limiting Reagent: ${result.limitingReagent}`);
    console.log(`    - Theoretical Yield (H2O): ${result.theoreticalYield["H2O"].grams.toFixed(2)}g`);

    assert(result.limitingReagent === "H2", "Limiting reagent identification failed");
    // 10g H2 / 2.016 g/mol = 4.96 mol H2
    // 4.96 mol H2 -> 4.96 mol H2O
    // 4.96 mol H2O * 18.015 g/mol = 89.35g
    assert(Math.abs(result.theoreticalYield["H2O"].grams - 89.35) < 0.1, "Yield calculation failed");

    console.log("✅ All Stoichiometry tests passed!");
}

runTests().catch(err => {
    console.error("❌ Tests failed:", err);
    process.exit(1);
});
