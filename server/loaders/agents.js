

/**
 * loaders/agents.js - PRODUCTION READY
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BlackAgent = require('../../microagents/BlackAgent.cjs');
const KuzeAgent = require('../../microagents/KuzeAgent.cjs');

import { MicroAgentPool } from '../../arbiters/MicroAgentPool.js';

export async function loadAgents(cognitiveContext) {
    console.log('\n[Loader] 🤖 Initializing Production Agent Systems...');

    const microAgentPool = new MicroAgentPool({
        systemContext: cognitiveContext
    });

    // Register Core Microagents
    microAgentPool.registerAgentType('black', BlackAgent);
    microAgentPool.registerAgentType('kuze', KuzeAgent);

    // Spawn instances immediately
    await microAgentPool.spawnAgent('black', { name: 'BlackAgent' });
    await microAgentPool.spawnAgent('kuze', { name: 'KuzeAgent' });

    await microAgentPool.initialize();
    console.log('      ✅ MicroAgentPool active (BlackAgent & KuzeAgent online)');

    return {
        microAgentPool
    };
}

