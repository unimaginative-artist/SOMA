import { DiscoveryGradeMedicalCortex } from '../arbiters/DiscoveryGradeMedicalCortex.js';
import { KnowledgeGraphFusion } from '../arbiters/KnowledgeGraphFusion.js';
import medicalBreakthroughLedger from '../server/research/MedicalBreakthroughLedger.js';

async function main() {
  console.log('🔬 Initializing KnowledgeGraphFusion and DiscoveryGradeMedicalCortex...');
  const kg = new KnowledgeGraphFusion();
  await kg.load().catch(() => {});

  const cortex = new DiscoveryGradeMedicalCortex({
    knowledgeGraph: kg
  });

  console.log('📚 Running Swanson Literature-Based Discovery Cycle...');
  const result = await cortex.runDiscoveryMission({
    entityA: 'KRAS G12D inhibitor resistance',
    entityB: 'Ferroptosis SLC7A11',
    domainA: 'Oncology',
    domainB: 'Cellular Metabolism',
    humanNeed: 'overcoming target resistance in refractory pancreatic and colorectal cancer'
  });

  console.log('\n✅ DISCOVERY RESULT:');
  console.log('Success:', result.success);
  console.log('Total papers analyzed:', result.totalPapersAnalyzed);
  console.log('Prior literature co-occurrences:', result.cooccurrences);
  
  const bt = result.breakthrough;
  console.log('\n🧬 NOVEL BREAKTHROUGH CANDIDATE:');
  console.log('Entity A:', bt.entityA);
  console.log('Bridge Mechanism:', bt.bridgeMechanism);
  console.log('Entity B:', bt.entityB);
  console.log('Discovery Score:', bt.discoveryScore);
  console.log('Novelty Score:', bt.noveltyScore);
  console.log('Hypothesis:', bt.hypothesis);
  console.log('Proposed Falsification Experiment:', JSON.stringify(bt.proposedExperiment, null, 2));
  console.log('Citations:', bt.citations);
  console.log('Graph Node / Edge IDs:', bt.graphNodeIds);

  console.log('\n📊 Ledger Summary:', medicalBreakthroughLedger.summary());

  console.log('\n🕸️ Testing Knowledge Graph Query for Entity A:');
  const queryRes = await kg.query('KRAS G12D inhibitor resistance');
  console.log('Graph query results for Entity A:', queryRes?.concept?.name, 'Related count:', queryRes?.related?.length || 0);
  if (queryRes?.related?.length) {
    for (const r of queryRes.related) {
      console.log(`  -> ${r.relationship} -> ${r.concept?.name} (confidence: ${r.confidence})`);
    }
  }

  console.log('\n✨ Medical discovery test completed successfully.');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
