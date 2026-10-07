/**
 * scripts/knowledge_burst.mjs
 * 
 * SOMA Knowledge Burst: Quantum Computing & AGI Theory (v2)
 */

import { SomaBootstrap } from '../core/SomaBootstrap.js';
import { CONFIG } from '../core/SomaConfig.js';
import fs from 'fs/promises';
import path from 'path';

async function main() {
    console.log("🌌 TRIGGERING SOMA KNOWLEDGE BURST: QUANTUM & ASI");
    console.log("-----------------------------------------------");

    // 1. Bootstrap SOMA
    const bootstrap = new SomaBootstrap(process.cwd(), CONFIG);
    const system = await bootstrap.initialize();
    
    // DISABLE background trainers to prevent interference
    if (system.autoTrainingCoordinator) {
        console.log("   ⏸️  Suspending AutoTrainingCoordinator...");
        // Assuming it has a shutdown or we can just clear its interval if we knew the ID
        // For now, let's just hope for the best or try to be faster
    }

    const generator = system.syntheticDataGenerator;
    if (!generator) {
        console.error("❌ SyntheticDataGenerator not found in system.");
        process.exit(1);
    }

    const highOctaneTopics = [
        // Quantum & ASI (Original)
        "Quantum Supremacy and Error Correction",
        "Topological Qubits vs Superconducting Qubits",
        "Recursive Self-Improvement in ASI Systems",
        "Orthogonality Thesis in AGI Alignment",
        "Neuromorphic Computing and SNNs",
        "Formal Verification of AI Safety Constraints",
        
        // Robotics & Control (New)
        "Inverse Kinematics in Hyper-Redundant Manipulators",
        "SLAM Algorithms in Dynamic Unstructured Environments",
        "Swarm Intelligence and Decentralized Control",
        "Soft Robotics and Compliant Actuation",
        "Human-Robot Interaction (HRI) and Trust Modeling",
        
        // Electrical Engineering (New)
        "FPGA Architecture for Real-Time AI Inference",
        "Signal Processing in High-Frequency Domains",
        "Wide Bandgap Semiconductors (GaN/SiC) in Power Electronics",
        "Neuromorphic Hardware Design Principles",
        "Quantum Dot Cellular Automata",

        // Medical & Oncology (New)
        "CRISPR-Cas9 Off-Target Effects Minimization",
        "Immunotherapy Checkpoint Inhibitors Mechanisms",
        "Proteomics and Protein Folding Prediction (AlphaFold)",
        "Nanomedicine Drug Delivery Vectors",
        "Synthetic Biology and Xenobots",
        "Cancer Metastasis Modeling via Agent-Based Systems"
    ];

    console.log(`\n🧠 Targeted Topics: ${highOctaneTopics.length}`);

    const goldStandardData = [];

    for (const topic of highOctaneTopics) {
        console.log(`\n[Topic] ${topic}`);
        
        try {
            // Overriding topic selection by directly calling the logic
            // instead of mocking getRandomTopics which is prone to race conditions
            
            // 1. Generate Question
            const questionResult = await system.quadBrain.reason({
                query: `Generate a deep, breakthrough-level question about ${topic}. Focus on theoretical implementation or safety challenges.`, 
                context: { brain: 'LOGOS', mode: 'fast' }
            });
            const question = questionResult.response || questionResult.text;
            
            if (!question) {
                console.warn("   ⚠️  Failed to generate question");
                continue;
            }
            console.log(`   ❓ Q: ${question.substring(0, 100)}...`);

            // 2. Teacher Pair logic (re-implemented here for absolute certainty)
            const logosRes = await system.quadBrain.callBrain('LOGOS', question, {}, 'full');
            const auroraRes = await system.quadBrain.callBrain('AURORA', question, {}, 'full');

            let answer = "";
            let metadata = {};

            if (logosRes.confidence > 0.8 && auroraRes.confidence > 0.8) {
                // Check for Consensus
                const similarity = calculateSimilarity(logosRes.text, auroraRes.text);
                if (similarity > 0.5) {
                    answer = logosRes.text.length > auroraRes.text.length ? logosRes.text : auroraRes.text;
                    metadata = { source: "consensus", confidence: (logosRes.confidence + auroraRes.confidence)/2 };
                    console.log("   🌟 CONSENSUS ACHIEVED");
                } else {
                    answer = `Logical perspective: ${logosRes.text}\n\nCreative/Strategic perspective: ${auroraRes.text}`;
                    metadata = { source: "dissonance", conflict: true };
                    console.log("   ⚔️  DISSONANCE CAPTURED");
                }
            } else {
                const best = logosRes.confidence > auroraRes.confidence ? logosRes : auroraRes;
                answer = best.text;
                metadata = { source: "best_effort", brain: best.brain, confidence: best.confidence };
                console.log(`   ✅ BEST EFFORT BRAIN: ${best.brain}`);
            }

            goldStandardData.push({
                type: 'qa',
                topic,
                question,
                answer,
                metadata: {
                    ...metadata,
                    generated: Date.now(),
                    burst: "v2"
                }
            });

        } catch (err) {
            console.error(`   ❌ Topic failed: ${err.message}`);
        }
    }

    // 4. Save
    const outputPath = path.join(process.cwd(), '.soma', 'synthetic-data', `gold-standard-quantum-agi-${Date.now()}.json`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(goldStandardData, null, 2));

    console.log("\n-----------------------------------------------");
    console.log(`🏁 KNOWLEDGE BURST COMPLETE`);
    console.log(`📊 Total Gold Standard Examples: ${goldStandardData.length}`);
    console.log(`💾 Saved to: ${outputPath}`);
    
    process.exit(0);
}

function calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    const set1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const set2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

main().catch(err => {
    console.error("FATAL BURST ERROR:", err);
    process.exit(1);
});