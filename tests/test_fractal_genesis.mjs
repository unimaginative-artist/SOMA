import { FragmentRegistry } from '../arbiters/FragmentRegistry.js';
import { SOMArbiterV3 } from '../arbiters/SOMArbiterV3.js';

// Mock learning pipeline for the test
const mockLearningPipeline = {
  logInteraction: async (data) => console.log(`[Pipeline] Logged: ${data.type}`)
};

// Mock Mnemonic
const mockMnemonic = {
  remember: async () => ({ stored: true })
};

async function testFractalEvolution() {
  console.log('🧬 STARTING FRACTAL BRAIN EVOLUTION TEST');
  console.log('=======================================');

  // 1. Initialize QuadBrain (Mocked for speed/cost, or real if keys present)
  // We'll mock the reasoning to force a specific Genesis outcome for the test
  const mockQuadBrain = {
    callBrain: async (brain, prompt, opts, mode) => {
      console.log(`[QuadBrain] ${brain} received prompt request...`);
      
      if (brain === 'PROMETHEUS' && prompt.includes('design a specialized')) {
        return {
          text: JSON.stringify({
            domain: "quantum_biology",
            specialization: "quantum_tunneling_analyst",
            keywords: ["tunneling", "enzyme", "coherence", "photosynthesis", "quantum"],
            description: "Specialist in quantum effects within biological systems",
            temperature: 0.3
          })
        };
      }
      
      if (brain === 'AURORA' && prompt.includes('Write a system prompt')) {
        return {
          text: "You are a Quantum Biology Expert. Analyze biological processes through the lens of quantum mechanics."
        };
      }
      
      return { text: "Generic response" };
    }
  };

  // 2. Initialize Registry
  const registry = new FragmentRegistry({
    quadBrain: mockQuadBrain,
    learningPipeline: mockLearningPipeline,
    mnemonic: mockMnemonic,
    genesisThreshold: 3 // Low threshold for immediate testing
  });

  await registry.initialize();

  // 3. Simulate "Unknown Topic" Pressure
  const topic = "How does quantum tunneling affect enzyme catalysis?";
  console.log(`\n🔍 Simulating user interest in: "${topic}"`);

  // Query 1: Miss
  console.log('\n--- Query 1 ---');
  await registry.routeToFragment(topic, 'LOGOS');
  
  // Query 2: Miss
  console.log('\n--- Query 2 ---');
  await registry.routeToFragment(topic, 'LOGOS');
  
  // Query 3: Genesis Trigger!
  console.log('\n--- Query 3 (Triggering Genesis) ---');
  await registry.routeToFragment(topic, 'LOGOS');

  // 4. Verify Creation
  console.log('\n🔍 Verifying Genesis...');
  const fragments = registry.listFragments('LOGOS');
  const newFrag = fragments.find(f => f.domain === 'quantum_biology');

  if (newFrag) {
    console.log(`\n✅ SUCCESS: Fractal Genesis occurred!`);
    console.log(`   New Fragment ID: ${newFrag.id}`);
    console.log(`   Specialization: ${newFrag.specialization}`);
    console.log(`   Expertise Level: ${newFrag.expertiseLevel}`);
  } else {
    console.log('\n❌ FAILURE: No new fragment spawned.');
  }
}

testFractalEvolution().catch(console.error);
