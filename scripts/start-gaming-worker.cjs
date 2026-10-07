#!/usr/bin/env node
// start-gaming-worker.cjs
// Start Gaming PC as cluster worker with tri-brain SLC access

const { ClusterNode } = require('../cluster/ClusterNode.cjs');
const http = require('http');
const https = require('https');

// Configuration
const IMAC_COORDINATOR = '192.168.1.251:4200';
const GAMING_PC_IP = '192.168.1.250';
const WORKER_PORT = 4201;

console.log('🎮 Starting Gaming PC Cluster Worker...');
console.log(`📍 Local IP: ${GAMING_PC_IP}`);
console.log(`🔗 Coordinator: ${IMAC_COORDINATOR}`);
console.log(`🧠 Tri-Brain Access: http://192.168.1.251:4000/api/slc/query`);

// Create cluster node
const node = new ClusterNode({
  nodeId: `gaming_${require('os').hostname()}_${Date.now()}`,
  nodeName: `Gaming-Laptop-GPU`,
  port: WORKER_PORT,
  role: 'worker',
  discoveryHosts: [IMAC_COORDINATOR],
  heartbeatInterval: 15000, // 15 seconds
  logger: console
});

// Add SLC query endpoint to the worker
node.app.post('/api/slc/query', async (req, res) => {
  const { query, context } = req.body;
  
  console.log(`[Gaming Worker] SLC Query: ${query}`);
  
  try {
    // Forward to iMac coordinator's SLC system
    const response = await fetch('http://192.168.1.251:4000/api/slc/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        context: {
          ...context,
          source: 'gaming-pc-worker',
          timestamp: Date.now()
        }
      }),
      timeout: 30000
    });
    
    const result = await response.json();
    
    console.log(`[Gaming Worker] SLC Response received (${result.totalThinkingTime}ms)`);
    
    res.json(result);
  } catch (error) {
    console.error(`[Gaming Worker] SLC Query failed:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
});

// Add local Ollama query endpoint (Brain A - Prometheus)
node.app.post('/api/brain/prometheus', async (req, res) => {
  const { prompt } = req.body;
  
  console.log(`[Gaming Worker] Local Prometheus query`);
  
  try {
    const ollamaReq = https.request({
      hostname: 'localhost',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      rejectUnauthorized: false
    }, (ollamaRes) => {
      let data = '';
      ollamaRes.on('data', chunk => data += chunk);
      ollamaRes.on('end', () => {
        try {
          const lines = data.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const parsed = JSON.parse(lastLine);
          
          res.json({
            success: true,
            response: parsed.response,
            model: 'gemma3:4b',
            brain: 'Prometheus',
            timestamp: Date.now()
          });
        } catch (e) {
          res.status(500).json({ success: false, error: e.message });
        }
      });
    });
    
    ollamaReq.on('error', (error) => {
      console.error(`[Gaming Worker] Ollama error:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    });
    
    ollamaReq.write(JSON.stringify({
      model: 'gemma3:4b',
      prompt,
      stream: true
    }));
    
    ollamaReq.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the worker
node.start()
  .then(() => {
    console.log('✅ Gaming PC Worker started successfully');
    console.log(`🌐 Worker API: http://${GAMING_PC_IP}:${WORKER_PORT}`);
    console.log(`🧠 Local Prometheus: http://localhost:11434`);
    console.log(`📡 Tri-Brain SLC: POST http://${GAMING_PC_IP}:${WORKER_PORT}/api/slc/query`);
    console.log(`⚡ Brain A (Prometheus): POST http://${GAMING_PC_IP}:${WORKER_PORT}/api/brain/prometheus`);
    console.log('\n🔄 Discovering coordinator nodes...');
  })
  .catch((error) => {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Gaming PC worker...');
  await node.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await node.shutdown();
  process.exit(0);
});
