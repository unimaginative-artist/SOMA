/**
 * scripts/prepare_training.mjs
 * 
 * Prepares the Knowledge Burst data for fine-tuning. (v2 - Messages Format)
 */

import fs from 'fs/promises';
import path from 'path';

async function main() {
    console.log("🛠️ PREPARING SOMA TRAINING DATA (MESSAGES FORMAT)");
    console.log("-----------------------------------------------");

    const dataDir = path.join(process.cwd(), '.soma', 'synthetic-data');
    const files = await fs.readdir(dataDir);
    const goldFiles = files.filter(f => f.startsWith('gold-standard-quantum-agi-') && f.endsWith('.json')).sort().reverse();

    if (goldFiles.length === 0) {
        console.error("❌ No gold standard files found.");
        process.exit(1);
    }

    const latestFile = path.join(dataDir, goldFiles[0]);
    console.log(`📂 Processing: ${latestFile}`);

    const rawData = JSON.parse(await fs.readFile(latestFile, 'utf8'));
    
    const messagesDataset = rawData.map(item => {
        return {
            messages: [
                { role: "system", content: "You are SOMA, a self-organizing meta-intelligence specializing in Quantum Computing and ASI Theory." },
                { role: "user", content: item.question },
                { role: "assistant", content: item.answer }
            ]
        };
    });

    const outputPath = path.join(process.cwd(), 'SOMA', 'training-data', `soma-training-burst-${Date.now()}.jsonl`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const jsonlContent = messagesDataset.map(item => JSON.stringify(item)).join('\n');
    await fs.writeFile(outputPath, jsonlContent);

    console.log("\n-----------------------------------------------");
    console.log(`🏁 DATA PREPARATION COMPLETE`);
    console.log(`📊 Examples prepared: ${messagesDataset.length}`);
    console.log(`📦 Final Dataset: ${path.basename(outputPath)}`);
    console.log(`✅ Ready for: python scripts/finetune_gemma3.py`);

    process.exit(0);
}

main().catch(err => {
    console.error("FATAL PREP ERROR:", err);
    process.exit(1);
});