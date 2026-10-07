#!/usr/bin/env node
// test-slc-thinking.cjs - Test SLC dual-brain thinking
const SyntheticLayeredCortex = require('../cognitive/SyntheticLayeredCortex.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

// Load API keys
require('dotenv').config({ path: '../config/api-keys.env' });

async function testSLC() {
  console.log('🧠 Initializing Synthetic Layered Cortex...\n');
  
  const slc = new SyntheticLayeredCortex(messageBroker, {
    name: 'SLC_Test',
    reflectionEnabled: true,
    routerMaxIter: 2,
    confidenceFinalize: 0.85
  });
  
  await slc.initialize();
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 TEST QUERY: "Explain quantum entanglement creatively"');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const result = await slc.processQuery('Explain quantum entanglement creatively');
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 RESULT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n✨ Final Answer:\n${result.result}\n`);
    console.log(`🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`🔄 Reflection Loops: ${result.provenance.reflectionLoops}`);
    console.log(`🧠 Brains Consulted: ${result.provenance.responses.length}`);
    console.log(`\n📝 Provenance:`);
    result.provenance.responses.forEach(r => {
      console.log(`   ${r.source}: ${r.confidence.toFixed(2)} - "${r.snippet}..."`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 SLC Metrics:');
    console.log(`   Queries Processed: ${slc.metrics.queriesProcessed}`);
    console.log(`   Reflection Loops: ${slc.metrics.reflectionLoops}`);
    console.log(`   Avg Confidence: ${(slc.metrics.avgConfidence * 100).toFixed(1)}%`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testSLC().catch(console.error);
