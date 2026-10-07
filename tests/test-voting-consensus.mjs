import dotenv from 'dotenv';
import { EngineeringSwarmArbiter } from '../arbiters/EngineeringSwarmArbiter.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

dotenv.config();

// Sandboxed test directories
const originalCwd = process.cwd;
const tempDir = path.join(originalCwd(), 'tests', 'temp-voting-sandbox');
process.cwd = () => tempDir;

// State to toggle mock voting behavior
let shouldApprove = true;

// Mock QuadBrain
const mockQuadBrain = {
    reason: async (prompt) => {
        // 1. Planner
        if (prompt.includes('RALPH VERIFIER')) {
            return {
                text: `[ { "command": "node --check tests/temp-target.js" } ]`
            };
        }
        // 2. Debate Turn 1 (Kuze)
        if (prompt.includes('You are KUZE') && prompt.includes('propose the technical architecture')) {
            return { text: 'Mock Kuze architecture recommendations.' };
        }
        // 3. Debate Turn 2 (Batou)
        if (prompt.includes('You are BATOU') && prompt.includes('security, safety, and risk')) {
            return { text: 'Mock Batou security audit findings.' };
        }
        // 4. Debate Turn 3 (Consensus)
        if (prompt.includes('Build a consensus resolution')) {
            return {
                text: JSON.stringify({
                    architect: "Use standard arithmetic addition.",
                    maintainer: "Maintain simple function interface.",
                    security: "No dangerous inputs handled.",
                    consensus: "Replace addition with direct return."
                })
            };
        }
        // 5. Synthesis
        if (prompt.includes('Produce final code patch')) {
            return {
                text: JSON.stringify({
                    patch: {
                        files: [
                            {
                                path: "tests/temp-target.js",
                                edits: [
                                    {
                                        old: "export function calculate(a, b) {\n                return a + b;\n            }",
                                        new: "export function calculate(a, b) {\n                return a + b; // modified by swarm\n            }"
                                    }
                                ]
                            }
                        ]
                    }
                })
            };
        }
        // 6. Empirical Benchmarking
        if (prompt.includes('empirical benchmarking generator')) {
            return {
                text: `
\`\`\`javascript
import { calculate } from './tests/temp-target.js';
console.log(JSON.stringify({ latencyMs: 0.05, memoryBytes: 100 }));
\`\`\`
                `
            };
        }
        // 7. Voting consensus
        if (prompt.includes('cast your vote')) {
            if (shouldApprove) {
                return {
                    text: JSON.stringify({
                        vote: "Approve",
                        reason: "Verification passed, metrics look stable."
                    })
                };
            } else {
                // Return Rejections / Request Changes depending on voter
                if (prompt.includes('KUZE')) {
                    return {
                        text: JSON.stringify({
                            vote: "Reject",
                            reason: "Performance regression observed."
                        })
                    };
                } else if (prompt.includes('BATOU')) {
                    return {
                        text: JSON.stringify({
                            vote: "Request Changes",
                            reason: "Insufficient validation."
                        })
                    };
                } else {
                    return {
                        text: JSON.stringify({
                            vote: "Reject",
                            reason: "Code style issues."
                        })
                    };
                }
            }
        }
        return { text: '' };
    }
};

async function runTest() {
    console.log('🧪 Starting Swarm Upgrade Phase 3 (Voting Matrix) Verification Test...\n');

    const targetFile = 'tests/temp-target.js';
    const absoluteTargetFile = path.join(tempDir, targetFile);

    try {
        // 1. Setup sandbox environment
        await fs.mkdir(path.dirname(absoluteTargetFile), { recursive: true });

        const initialCode = `
            export function calculate(a, b) {
                return a + b;
            }
        `;

        const swarm = new EngineeringSwarmArbiter({
            quadBrain: mockQuadBrain,
            rootPath: tempDir
        });
        // This test exercises autonomous consensus, not the UI approval flow.
        swarm.system = { commandBridgeSettings: { authority: { humanInLoopOverride: false } } };
        await fs.writeFile(path.join(tempDir, 'smoke.mjs'), 'console.log("swarm smoke passed");\n', 'utf8');
        await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({
            type: 'module',
            scripts: { 'soma:test': 'node smoke.mjs' }
        }), 'utf8');

        // ==========================================
        // TEST CASE 1: Successful Vote (Approvals = 3/3)
        // ==========================================
        console.log('1️⃣ Running Test Case 1: All sub-agents vote Approve...');
        await fs.writeFile(absoluteTargetFile, initialCode, 'utf8');
        shouldApprove = true;

        const res1 = await swarm.modifyCode(targetFile, 'Refactor target file');
        console.log('Result:', JSON.stringify(res1));

        if (!res1.success) {
            throw new Error(`Test Case 1 failed: Expected success, but got failure: ${res1.error}`);
        }
        console.log('✅ Test Case 1 passed: Modify succeeded with 3 approvals.');

        // Verify the file was actually written to disk
        const content1 = await fs.readFile(absoluteTargetFile, 'utf8');
        if (!content1.includes('// modified by swarm')) {
            throw new Error(`Test Case 1 failed: File contents not updated! Found: "${content1}"`);
        }
        console.log('✅ Test Case 1 verified: File modified on disk.');

        // ==========================================
        // TEST CASE 2: Rejected Vote (Approvals = 0/3)
        // ==========================================
        console.log('\n2️⃣ Running Test Case 2: Sub-agents vote Reject/Request Changes...');
        // Reset code to initialCode
        await fs.writeFile(absoluteTargetFile, initialCode, 'utf8');
        shouldApprove = false;

        const res2 = await swarm.modifyCode(targetFile, 'Refactor target file');
        console.log('Result:', JSON.stringify(res2));

        if (res2.success) {
            throw new Error(`Test Case 2 failed: Expected failure due to rejections, but got success!`);
        }
        if (!res2.error.includes('Decentralized Swarm Consensus rejected this patch')) {
            throw new Error(`Test Case 2 failed: Expected error to contain voting rejection, but got: "${res2.error}"`);
        }
        console.log('✅ Test Case 2 passed: Modify failed with voting rejection.');

        // Verify the file was rolled back and contains the initialCode
        const content2 = await fs.readFile(absoluteTargetFile, 'utf8');
        if (content2.includes('// modified by swarm')) {
            throw new Error(`Test Case 2 failed: File was NOT rolled back! Found: "${content2}"`);
        }
        console.log('✅ Test Case 2 verified: File rolled back to baseline.');

        console.log('\n🎉 ALL PHASE 3 VOTING CONSENSUS TESTS PASSED YAY!');

        // Cleanup
        process.cwd = originalCwd;
        await fs.rm(tempDir, { recursive: true, force: true });
        process.exit(0);

    } catch (error) {
        console.error('\n❌ TEST SUITE FAILED:', error.message);
        console.error(error.stack);
        process.cwd = originalCwd;
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        process.exit(1);
    }
}

runTest();
