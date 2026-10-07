#!/usr/bin/env node
// test-unified-memory.cjs - Quick test of distributed memory pooling
const WebSocket = require('ws');
const os = require('os');

const HUB_URL = 'ws://localhost:3001';
const nodeId = `test_${os.hostname()}_${Date.now()}`;

console.log('🧪 Testing Unified Memory Across Cluster\n');

const ws = new WebSocket(HUB_URL);

ws.on('open', () => {
  console.log('✅ Connected to memory hub');
  
  // Register this node
  ws.send(JSON.stringify({ type: 'register', nodeId }));
  
  setTimeout(() => {
    // Simulate allocating a 100MB tensor
    console.log('\n📦 Allocating 100MB tensor across cluster...');
    ws.send(JSON.stringify({
      type: 'allocate',
      chunkId: 'test_tensor_001',
      nodeId,
      size: 100 * 1024 * 1024,
      compressed: true
    }));
  }, 500);
  
  setTimeout(() => {
    // Check status
    ws.send(JSON.stringify({ type: 'status' }));
  }, 1000);
  
  setTimeout(() => {
    console.log('\n✅ Test complete - hub is working!');
    console.log('📊 Check status: curl http://localhost:3001/status\n');
    ws.close();
    process.exit(0);
  }, 1500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log(`📨 ${msg.type}:`, msg);
});

ws.on('error', (err) => {
  console.error('❌ Connection failed:', err.message);
  console.log('💡 Make sure memory hub is running: node ~/Desktop/soma-dashboard/memory-hub.cjs');
  process.exit(1);
});
