import dotenv from 'dotenv';
import { EngineeringSwarmArbiter } from '../arbiters/EngineeringSwarmArbiter.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

dotenv.config();

// Sandboxed test directories
const originalCwd = process.cwd;
const tempDir = path.join(originalCwd(), 'tests', 'temp-bench-sandbox');
process.cwd = () => tempDir;

// Mock QuadBrain that generates a tailormade benchmark script
const mockQuadBrain = {
    reason: async (prompt) => {
        if (prompt.includes('empirical benchmarking generator')) {
            // Return a Node script that imports `calculate` and runs it in a loop
            return {
                text: `
\`\`\`javascript
import { calculate } from './tests/temp-target.js';
import { performance } from 'perf_hooks';

const t0 = performance.now();
let result = 0;
for (let i = 0; i < 10000; i++) {
    result = calculate(i, i + 1);
}
const t1 = performance.now();

console.log(JSON.stringify({
    latencyMs: t1 - t0,
    memoryBytes: process.memoryUsage().heapUsed
}));
\`\`\`
                `
            };
        }
        return { text: '' };
    }
};

async function runTest() {
    console.log('🧪 Starting Swarm Upgrade Phase 2 (Empirical Benchmarking) Verification Test...\n');

    const targetFile = 'tests/temp-target.js';
    const absoluteTargetFile = path.join(tempDir, targetFile);

    try {
        // Prepare directories
        await fs.mkdir(path.dirname(absoluteTargetFile), { recursive: true });

        // 1. Write baseline (fast) code
        const baselineCode = `
            export function calculate(a, b) {
                return a + b;
            }
        `;
        await fs.writeFile(absoluteTargetFile, baselineCode, 'utf8');

        const swarm = new EngineeringSwarmArbiter({
            quadBrain: mockQuadBrain,
            rootPath: tempDir
        });

        console.log('1️⃣ Initializing benchmark on baseline code...');
        const helper = await swarm.runSwarmBenchmark(targetFile, baselineCode);
        if (!helper || !helper.tempBenchPath) {
            throw new Error('Benchmark helper initialization failed');
        }
        console.log(`   Benchmark script generated at: ${helper.tempBenchPath}`);
        if (!existsSync(helper.tempBenchPath)) {
            throw new Error('Benchmark script file was not written to disk');
        }

        // 2. Modify the target file to be deliberately slow (introducing a heavy loop)
        console.log('\n2️⃣ Modifying target file to introduce latency regression...');
        const regressionCode = `
            export function calculate(a, b) {
                let sum = 0;
                for (let i = 0; i < 50000; i++) {
                    sum += i;
                }
                return a + b + sum;
            }
        `;
        await fs.writeFile(absoluteTargetFile, regressionCode, 'utf8');

        console.log('\n3️⃣ Executing experimental run and comparing performance...');
        const metrics = await helper.runExperimental();
        
        if (!metrics) {
            throw new Error('Empirical benchmark failed to return metrics comparison');
        }

        console.log(`📊 Swarm Benchmark comparison:
   - Baseline Latency: ${metrics.baseline.latencyMs.toFixed(3)}ms
   - Experimental Latency: ${metrics.experimental.latencyMs.toFixed(3)}ms
   - Latency Delta: ${metrics.latencyDeltaPercent.toFixed(1)}%
   - Memory Delta: ${metrics.memoryDeltaBytes} bytes`);

        if (metrics.latencyDeltaPercent <= 10) {
            throw new Error(`Expected significant latency regression, but got delta: ${metrics.latencyDeltaPercent.toFixed(1)}%`);
        }
        console.log('✅ Latency regression detected successfully!');

        if (existsSync(helper.tempBenchPath)) {
            throw new Error('Benchmark script was not cleaned up after run');
        }
        console.log('✅ Temporary benchmark script cleaned up successfully');

        console.log('\n🎉 ALL PHASE 2 TESTS PASSED YAY!');
        
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
