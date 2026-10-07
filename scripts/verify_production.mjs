import { SomaBootstrap } from '../core/SomaBootstrap.js';
import { CONFIG } from '../core/SomaConfig.js';

async function verify() {
  console.log('🧪 SOMA PRODUCTION VERIFICATION');
  console.log('===============================');

  try {
    const bootstrap = new SomaBootstrap(process.cwd(), CONFIG);
    
    // We only want to instantiate, not fully start everything if it has side effects (like API servers)
    // But initialize() sets up the arbiters.
    
    console.log('1. Testing Bootstrap Initialization...');
    await bootstrap.initialize();
    
    console.log('\n2. Verifying Core Components...');
    const checks = [
      ['QuadBrain', bootstrap.system.quadBrain],
      ['ASIOrchestrator', bootstrap.system.asiOrchestrator],
      ['EmotionalEngine', bootstrap.system.emotional],
      ['PersonalityEngine', bootstrap.system.personality],
      ['StrategyOptimizer', bootstrap.system.strategyOptimizer],
      ['TreeSearch (via Reasoning)', bootstrap.system.reasoning?.strategies?.treeSearch],
      ['UnifiedMemory', bootstrap.system.unifiedMemory],
      ['Timekeeper', bootstrap.system.timekeeper]
    ];

    let missing = 0;
    checks.forEach(([name, component]) => {
      if (component) {
        console.log(`   ✅ ${name}: ONLINE`);
      } else {
        console.log(`   ❌ ${name}: MISSING`);
        missing++;
      }
    });

    if (missing > 0) {
      console.error(`\n❌ VERIFICATION FAILED: ${missing} components missing.`);
      process.exit(1);
    }

    // Check Brain <-> Soul connection
    console.log('\n3. Verifying Brain-Soul Integration...');
    if (bootstrap.system.quadBrain.emotionalEngine === bootstrap.system.emotional) {
      console.log('   ✅ Emotional Engine injected into QuadBrain');
    } else {
      console.log('   ❌ Emotional Engine injection FAILED');
      process.exit(1);
    }

    console.log('\n✨ SOMA IS PRODUCTION READY ✨');
    
    // Shutdown to clean up
    console.log('\nCleaning up...');
    if (bootstrap.system.timekeeper) await bootstrap.system.timekeeper.shutdown();
    if (bootstrap.system.quadBrain) await bootstrap.system.quadBrain.shutdown();
    // ... add others if needed, but script exit will kill them usually.
    
    process.exit(0);

  } catch (error) {
    console.error('\n💥 FATAL ERROR during verification:', error);
    process.exit(1);
  }
}

verify();
