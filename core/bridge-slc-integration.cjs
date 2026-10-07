#!/usr/bin/env node
// bridge-slc-integration.cjs - Integrate SLC with SOMA Command Bridge
require('dotenv').config();
const messageBroker = require('./core/MessageBroker.cjs');

// Command Bridge SLC Integration
class SLCCommandBridge {
  constructor(slcArbiter) {
    this.slc = slcArbiter;
    this.setupCommands();
  }

  setupCommands() {
    // Subscribe to command bridge requests
    messageBroker.subscribe('command.query', async (event) => {
      console.log(`\n🎯 Command Bridge: "${event.query}"`);
      
      try {
        const result = await this.slc.processQuery(event.query, event.context || {});
        
        messageBroker.publish('command.response', {
          requestId: event.requestId,
          query: event.query,
          response: result.result,
          confidence: result.confidence,
          brains: result.provenance.responses.length,
          reflectionLoops: result.provenance.reflectionLoops,
          timestamp: result.timestamp
        });
        
      } catch (error) {
        messageBroker.publish('command.error', {
          requestId: event.requestId,
          error: error.message
        });
      }
    });

    // Brain status command
    messageBroker.subscribe('command.brain.status', (event) => {
      const status = {
        brains: {
          prometheus: {
            name: 'Brain A - Prometheus',
            type: 'Divergent/Creative',
            backend: 'Gemma3:4b @ 192.168.1.250:11434',
            status: 'online'
          },
          aurora: {
            name: 'Brain B - Aurora',
            type: 'Synthetic/Exploratory',
            backend: 'DeepSeek API',
            status: 'online'
          },
          logos: {
            name: 'Brain C - Logos',
            type: 'Convergent/Analytical',
            backend: 'Gemini 2.5 Flash API',
            status: 'online'
          }
        },
        metrics: this.slc.metrics,
        thoughtHistory: this.slc.thoughtHistory.length
      };

      messageBroker.publish('command.brain.status.response', {
        requestId: event.requestId,
        status
      });
    });

    console.log('🌉 SLC Command Bridge: Listening on message broker');
    console.log('   📨 command.query - Send query to tri-brain');
    console.log('   📨 command.brain.status - Get brain status');
  }

  // Direct query method for external use
  async query(text, context = {}) {
    return await this.slc.processQuery(text, context);
  }
}

module.exports = SLCCommandBridge;

// ═══════════════════════════════════════════════════════════
// USAGE EXAMPLE
// ═══════════════════════════════════════════════════════════

if (require.main === module) {
  const SyntheticLayeredCortex = require('./cognitive/SyntheticLayeredCortex.cjs');
  
  async function demo() {
    console.log('🧠 SLC Command Bridge Demo\n');
    
    // Initialize SLC
    const slc = new SyntheticLayeredCortex(messageBroker, {
      reflectionEnabled: true,
      routerMaxIter: 2
    });
    await slc.initialize();
    
    // Create bridge
    const bridge = new SLCCommandBridge(slc);
    
    // Test query via message broker
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📨 Sending test query via command bridge...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Listen for response
    messageBroker.subscribe('command.response', (response) => {
      console.log('\n✅ Response received!');
      console.log(`   Confidence: ${(response.confidence * 100).toFixed(1)}%`);
      console.log(`   Brains: ${response.brains}`);
      console.log(`   Reflection Loops: ${response.reflectionLoops}`);
      console.log(`\n   Answer:\n   ${response.response.substring(0, 200)}...`);
    });

    // Send query
    messageBroker.publish('command.query', {
      requestId: 'test-001',
      query: 'What is consciousness?',
      context: { source: 'command-bridge-demo' }
    });

    // Wait for response
    await new Promise(r => setTimeout(r, 20000));
  }

  demo().catch(console.error);
}
