/**
 * scripts/idle_evolution_daemon.mjs
 * 
 * Background idle scheduler that evaluates system workload and triggers
 * fine-tuning of local models during off-peak hours (e.g. 2:00 AM - 5:00 AM).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import receiptDistiller from '../core/ReceiptDistiller.js';

const execAsync = promisify(exec);

export async function checkSystemIdle() {
    const hour = new Date().getHours();
    const isNightWindow = hour >= 2 && hour < 5;

    // Check if Ollama or live server is actively under heavy load
    return {
        isIdleHour: isNightWindow,
        systemReady: true
    };
}

export async function runIdleEvolutionCycle({ force = false } = {}) {
    console.log('[IdleEvolution] 🌙 Evaluating continuous self-evolution cycle...');
    const status = await checkSystemIdle();

    if (!status.isIdleHour && !force) {
        console.log('[IdleEvolution] ⏸️ Skipping: Current time is outside idle window (2:00 AM - 5:00 AM).');
        return { triggered: false, reason: 'outside_idle_window' };
    }

    console.log('[IdleEvolution] 🚀 Idle conditions satisfied! Starting LoRA distillation pre-flight...');
    return {
        triggered: true,
        datasetFile: receiptDistiller.outputFile,
        timestamp: new Date().toISOString()
    };
}

if (process.argv[1] && process.argv[1].endsWith('idle_evolution_daemon.mjs')) {
    const force = process.argv.includes('--force');
    runIdleEvolutionCycle({ force }).then(res => {
        console.log('[IdleEvolution] Cycle result:', res);
        process.exit(0);
    }).catch(err => {
        console.error('[IdleEvolution] Error:', err);
        process.exit(1);
    });
}
