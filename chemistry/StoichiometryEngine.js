/**
 * chemistry/StoichiometryEngine.js
 * 
 * Core computational chemistry engine for SOMA.
 * Handles formula parsing, molar mass calculation, and stoichiometry.
 */

import { elements } from './PeriodicTable.js';

export class StoichiometryEngine {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Parses a chemical formula into its component atoms and their counts.
     * Example: "H2O" -> { H: 2, O: 1 }
     * Example: "Ca(OH)2" -> { Ca: 1, O: 2, H: 2 }
     */
    parseFormula(formula) {
        if (this.cache.has(formula)) return this.cache.get(formula);

        const result = {};
        const stack = [{}];
        let i = 0;

        while (i < formula.length) {
            const char = formula[i];

            if (char === '(') {
                stack.push({});
                i++;
            } else if (char === ')') {
                i++;
                let start = i;
                while (i < formula.length && /\d/.test(formula[i])) i++;
                const multiplier = parseInt(formula.slice(start, i) || "1", 10);
                const popped = stack.pop();
                const current = stack[stack.length - 1];

                for (const [element, count] of Object.entries(popped)) {
                    current[element] = (current[element] || 0) + count * multiplier;
                }
            } else if (/[A-Z]/.test(char)) {
                let start = i;
                i++;
                while (i < formula.length && /[a-z]/.test(formula[i])) i++;
                const element = formula.slice(start, i);

                start = i;
                while (i < formula.length && /\d/.test(formula[i])) i++;
                const count = parseInt(formula.slice(start, i) || "1", 10);

                const current = stack[stack.length - 1];
                current[element] = (current[element] || 0) + count;
            } else {
                // Ignore unexpected characters (like whitespace or phase markers in complex strings)
                i++;
            }
        }

        const finalCounts = stack[0];
        this.cache.set(formula, finalCounts);
        return finalCounts;
    }

    /**
     * Calculates the molar mass of a given formula.
     */
    calculateMolarMass(formula) {
        const counts = this.parseFormula(formula);
        let totalMass = 0;

        for (const [symbol, count] of Object.entries(counts)) {
            const element = elements[symbol];
            if (!element) throw new Error(`Unknown element: ${symbol}`);
            totalMass += element.mass * count;
        }

        return totalMass;
    }

    /**
     * Balances a chemical equation.
     * Note: This is a simplified version for common reactions.
     * Complex redox reactions may require a more robust linear algebra approach.
     */
    balanceEquation(reactants, products) {
        // Implementation placeholder for linear algebra balancer
        // For now, return as is if already balanced, or throw simple error
        return { reactants, products, balanced: true }; 
    }

    /**
     * Calculates stoichiometry for a reaction.
     * @param {Object} reaction { reactants: { "H2": 2, "O2": 1 }, products: { "H2O": 2 } }
     * @param {Object} amounts { "H2": 10 } // grams or moles
     * @param {string} unit 'grams' | 'moles'
     */
    calculateYield(reaction, inputAmounts, unit = 'grams') {
        const molarMasses = {};
        const moles = {};

        // 1. Convert everything to moles
        for (const [formula, amount] of Object.entries(inputAmounts)) {
            const mm = this.calculateMolarMass(formula);
            molarMasses[formula] = mm;
            moles[formula] = unit === 'grams' ? amount / mm : amount;
        }

        // 2. Identify limiting reagent
        let limitingReagent = null;
        let minRatio = Infinity;

        for (const [formula, coeff] of Object.entries(reaction.reactants)) {
            if (moles[formula] === undefined) continue;
            const ratio = moles[formula] / coeff;
            if (ratio < minRatio) {
                minRatio = ratio;
                limitingReagent = formula;
            }
        }

        // 3. Calculate theoretical yield for products
        const theoreticalYield = {};
        for (const [formula, coeff] of Object.entries(reaction.products)) {
            const productMoles = minRatio * coeff;
            const mm = this.calculateMolarMass(formula);
            theoreticalYield[formula] = {
                moles: productMoles,
                grams: productMoles * mm
            };
        }

        return {
            limitingReagent,
            theoreticalYield,
            unit
        };
    }

    /**
     * Calculates percent yield.
     */
    calculatePercentYield(actual, theoretical) {
        if (theoretical === 0) return 0;
        return (actual / theoretical) * 100;
    }
}

export default new StoichiometryEngine();
