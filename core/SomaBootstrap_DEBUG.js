import {
  join
} from 'path';
import {
  pipeline
} from '@xenova/transformers';

export class SomaBootstrap {
  constructor(rootPath, config) {
    this.rootPath = rootPath;
    this.config = config;
    this.system = {};
  }

  async initialize() {
    console.log('📦 Loading SOMA components (Bootstrap Mode)...');
    
    // Dynamic Imports (Minimal set for debug)
    const MnemonicArbiterModule = await import('../arbiters/MnemonicArbiter.js');
    const MessageBrokerModule = await import('./MessageBroker.js');
    const { SOMArbiterV3 } = await import('../arbiters/SOMArbiterV3.js');


    // CJS Imports setup
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);

    console.log('   ✅ All components imported');

    // Initialize Embedding Pipeline
    console.log('   🧠 Loading embedding model for IdeaCaptureArbiter (Xenova Transformers)...');
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('   ✅ Embedding model loaded.');

    console.log('\n🚀 Initializing SOMA QuadBrain System...');

    // MessageBroker
    this.system.messageBroker = MessageBrokerModule.default || MessageBrokerModule;
    console.log('   ✅ MessageBroker ready');

    // Mnemonic
    const MnemonicArbiter = MnemonicArbiterModule.default || MnemonicArbiterModule.MnemonicArbiter;
    this.system.mnemonic = new MnemonicArbiter({ name: 'MnemonicArbiter', redisUrl: process.env.REDIS_URL || 'redis://localhost:6379' });
    await new Promise(resolve => this.system.mnemonic.once('initialized', resolve));
    console.log('   ✅ MnemonicArbiter ready');

    // --- START: Merged Legacy Arbiters (Soul & Infrastructure) ---
    console.log('   🧩 Merging Legacy Arbiters (Soul & Infrastructure)...');
    
    const TimekeeperArbiter = require('../arbiters/TimekeeperArbiter.cjs');
    const EmotionalEngine = require('../cognitive/EmotionalEngine.cjs');
    const PersonalityEngine = require('../cognitive/PersonalityEngine.cjs');
    
    this.system.timekeeper = new TimekeeperArbiter({ name: 'TimekeeperArbiter' });
    await this.system.timekeeper.initialize();
    console.log('   ✅ TimekeeperArbiter ready (Merged)');

    this.system.emotional = new EmotionalEngine({ name: 'EmotionalEngine' });
    await this.system.emotional.initialize();
    console.log('   ✅ EmotionalEngine ready (Merged)');

    this.system.personality = new PersonalityEngine(this.system.emotional);
    await this.system.personality.initialize();
    console.log('   ✅ PersonalityEngine ready (Merged)');
    // --- END: Merged Legacy Arbiters ---

    // QuadBrain (Now with Soul!)
    this.system.quadBrain = new SOMArbiterV3({
        name: 'QuadBrain',
        router: null, // No router for minimal test
        mnemonic: this.system.mnemonic,
        messageBroker: this.system.messageBroker,
        learningPipeline: null, // No pipeline for minimal test
        fragmentRegistry: null, // No registry for minimal test
        emotionalEngine: this.system.emotional,  // INJECTED SOUL
        personalityEngine: this.system.personality // INJECTED PERSONALITY
    });
    console.log('   ✅ QuadBrain ready (SOMArbiterV3 - with integrated Emotional/Personality core)');

    console.log('\n🎉 SOMA Bootstrap (DEBUG) Complete!\n');
    return this.system;
  }

  getHealth() {
    const health = {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        components: {}
    };

    if (this.system.mnemonic) {
        health.components.mnemonic = { status: 'active' };
    }
    if (this.system.quadBrain) {
        health.components.quadBrain = { status: 'active', activeBrains: Object.keys(this.system.quadBrain.BRAINS || {}).length };
    }
    return health;
  }
}
