import dotenv from 'dotenv';
import { GitHarvesterArbiter } from '../arbiters/GitHarvesterArbiter.js';
import { OllamaAutoTrainer } from '../core/OllamaAutoTrainer.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Save original CWD and override it to temp directory for 100% isolation
const originalCwd = process.cwd;
const tempDir = path.join(originalCwd(), 'tests', 'temp-neural-sandbox');
process.cwd = () => tempDir;

// Mock global fetch
const originalFetch = global.fetch;
global.fetch = async (url) => {
    console.log(`   [Mock Fetch] Intercepted URL: ${url}`);
    if (url.includes('/git/trees/')) {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                tree: [
                    { path: 'src/math-helpers.js', type: 'blob' }
                ]
            })
        };
    }
    if (url.includes('raw.githubusercontent.com')) {
        return {
            ok: true,
            status: 200,
            text: async () => `
                // This is a math helpers library designed for SOMA verification tests.
                // It provides basic mathematical operations in a clean format.
                // Let's add some more characters to satisfy the minimum length check of 100 bytes.
                export function add(a, b) { 
                    return a + b; 
                }
            `
        };
    }
    return { ok: false, status: 404 };
};

// Mock QuadBrain with dual prompt support
const mockQuadBrain = {
    reason: async (prompt) => {
        if (prompt.includes('neural training data generator')) {
            // Distillation prompt
            return {
                text: `
                {"messages":[{"role":"system","content":"You are SOMA, an advanced AI system."},{"role":"user","content":"How do I add?"},{"role":"assistant","content":"Use import { add } from 'math-helpers.js';"}]}
                {"messages":[{"role":"system","content":"You are SOMA, an advanced AI system."},{"role":"user","content":"How to sum numbers?"},{"role":"assistant","content":"Call add(1, 2);"}]}
                {"messages":[{"role":"system","content":"You are SOMA, an advanced AI system."},{"role":"user","content":"What does add do?"},{"role":"assistant","content":"It returns sum."}]}
                `
            };
        } else {
            // Code clean prompt
            return {
                text: `
\`\`\`javascript
export function add(a, b) {
    return a + b;
}
\`\`\`
                `
            };
        }
    }
};

async function runTest() {
    console.log('🧪 Starting Autonomous Neural Upgrade Loop (Phase 13) Verification Test...\n');

    try {
        // Prepare sandboxed dirs
        await fs.mkdir(tempDir, { recursive: true });
        const trainingDir = path.join(tempDir, 'data', 'training');
        await fs.mkdir(trainingDir, { recursive: true });
        
        // Write mock pre-existing domain files so merge doesn't fail on missing files
        await fs.writeFile(path.join(trainingDir, 'medical_lora_distilled.jsonl'), '{"messages":[]}\n', 'utf8');
        await fs.writeFile(path.join(trainingDir, 'soma_knowledge.jsonl'), '{"messages":[]}\n', 'utf8');

        // Initialize GitHarvesterArbiter
        console.log('1️⃣ Initializing GitHarvesterArbiter with mock CWD...');
        const harvester = new GitHarvesterArbiter({
            rootPath: tempDir,
            quadBrain: mockQuadBrain
        });
        await harvester.initialize();
        console.log('   GitHarvesterArbiter ready.');

        // Run crawlAndHarvest to trigger distillation
        console.log('\n2️⃣ Running crawlAndHarvest to trigger code cleaning & training distillation...');
        const harvested = await harvester.crawlAndHarvest('soma-dev', 'mock-math-repo', 'main');
        console.log(`   Harvested: ${harvested.length} file(s)`);
        
        if (harvested.length === 0) {
            throw new Error('Crawl failed to harvest utility file');
        }

        // Verify distilled jsonl file was created
        const distilledFile = path.join(trainingDir, 'harvested_libraries_distilled.jsonl');
        console.log(`\n3️⃣ Verifying distilled output file: ${distilledFile}`);
        const distilledContent = await fs.readFile(distilledFile, 'utf8');
        console.log(`📄 Distilled File Content:\n${distilledContent}`);

        const lines = distilledContent.trim().split('\n');
        if (lines.length !== 3) {
            throw new Error(`Expected exactly 3 distilled training examples, but got: ${lines.length}`);
        }

        // Parse and check each line structure
        for (const line of lines) {
            const parsed = JSON.parse(line);
            if (!parsed.messages || parsed.messages.length !== 3) {
                throw new Error('Distilled item does not match standard chat template messages structure');
            }
            if (parsed.messages[0].role !== 'system' || parsed.messages[1].role !== 'user' || parsed.messages[2].role !== 'assistant') {
                throw new Error('Messages role sequence is invalid');
            }
        }
        console.log('✅ Distillation verification passed');

        // Test OllamaAutoTrainer dataset merging
        console.log('\n4️⃣ Testing OllamaAutoTrainer dataset merge integration...');
        
        // Create mock synthetic and conversation paths
        const syntheticPath = path.join(tempDir, 'synthetic.jsonl');
        const conversationsPath = path.join(tempDir, 'conversations.jsonl');
        await fs.writeFile(syntheticPath, '{"synthetic": true}\n', 'utf8');
        await fs.writeFile(conversationsPath, '{"conversation": true}\n', 'utf8');

        // Set training dir env var for auto trainer
        const trainingDataDir = path.join(tempDir, 'SOMA', 'training-data');
        await fs.mkdir(trainingDataDir, { recursive: true });
        process.env.SOMA_TRAINING_DATA_DIR = trainingDataDir;

        const trainer = new OllamaAutoTrainer({ enabled: false });
        console.log('   Merging datasets...');
        const mergedPath = await trainer.mergeDatasets(syntheticPath, conversationsPath);
        console.log(`   Merged dataset output file: ${mergedPath}`);

        const mergedContent = await fs.readFile(mergedPath, 'utf8');
        if (!mergedContent.includes('How to sum numbers?')) {
            throw new Error('Merged dataset does not contain distilled harvested library examples!');
        }
        if (!mergedContent.includes('{"synthetic": true}') || !mergedContent.includes('{"conversation": true}')) {
            throw new Error('Merged dataset missing synthetic or conversation records');
        }

        console.log('✅ Dataset merging integration passed');

        console.log('\n🎉 ALL PHASE 13 TESTS PASSED YAY!');
        
        // Cleanup CWD override and temp directory
        process.cwd = originalCwd;
        await fs.rm(tempDir, { recursive: true, force: true });
        global.fetch = originalFetch;
        process.exit(0);

    } catch (error) {
        console.error('\n❌ TEST SUITE FAILED:', error.message);
        console.error(error.stack);
        process.cwd = originalCwd;
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        global.fetch = originalFetch;
        process.exit(1);
    }
}

runTest();
