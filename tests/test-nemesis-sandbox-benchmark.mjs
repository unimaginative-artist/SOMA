import dotenv from 'dotenv';
import { NemesisArbiter } from '../arbiters/NemesisArbiter.js';
import path from 'path';

dotenv.config();

async function testNemesisSandboxBenchmark() {
    console.log('🧪 Testing NemesisArbiter run_sandboxed_benchmark tool directly...\n');

    try {
        const nemesis = new NemesisArbiter({
            rootPath: process.cwd(),
            maxSteps: 5
        });

        const tool = nemesis._tools.run_sandboxed_benchmark;
        if (!tool) {
            throw new Error('run_sandboxed_benchmark tool is not defined in NemesisArbiter');
        }

        console.log('🚀 Running sandboxed benchmark tool against arbiters/test_sandbox_target.js...');
        console.log('   (This spins up SOMA in test mode and executes tasks — please wait ~15s)\n');

        const result = await tool.execute({ filepath: 'arbiters/test_sandbox_target.js' });
        
        console.log('📊 Result received:');
        console.log(JSON.stringify(result, null, 2));

        if (result.success && result.benchmark) {
            console.log('\n🎉 SUCCESS: Sandbox benchmark tool executed and returned valid JSON metrics!');
            console.log(`   - Average Latency: ${result.benchmark.avgLatencyMs.toFixed(2)}ms`);
            console.log(`   - Average Nemesis Score: ${result.benchmark.avgNemesisScore.toFixed(2)}`);
            console.log(`   - Memory Delta: ${result.benchmark.memoryDeltaBytes} bytes`);
            console.log(`   - Hallucinations Detected: ${result.benchmark.hallucinationsDetected}`);
            process.exit(0);
        } else {
            console.error('\n❌ FAILURE: Sandbox benchmark tool failed to return valid metrics:', result.error || 'Unknown error');
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testNemesisSandboxBenchmark();
