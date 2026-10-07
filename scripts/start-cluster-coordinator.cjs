#!/usr/bin/env node
// start-cluster-coordinator.cjs
// Starts the coordinator node - brain of the cluster (for iMac)

const { ClusterIntegration } = require('../cluster/ClusterIntegration.cjs');
const AutoSpawner = require('../cluster/AutoSpawner.cjs');
const os = require('os');

async function main() {
  // Configuration
  const config = {
    nodeId: `coordinator_${os.hostname()}_${Date.now()}`,
    nodeName: os.hostname() + '-Brain',
    role: 'coordinator',
    port: 4200,
    
    // Coordinator actively searches for known workers
    discoveryHosts: [
      '192.168.1.250:4201', // Gaming PC
      '192.168.1.159:4201'  // MacBook Pro
    ],
    
    heartbeatInterval: 15000, // 15 seconds (faster reconnection)
    syncInterval: 60000, // 1 minute transmitter sync
    minParticipants: 1, // Minimum nodes for federated learning
    aggressiveDiscovery: true, // Auto-reconnect to known nodes
    persistenceFile: './cluster-nodes.json', // Save known nodes
    
    logger: console
  };
  
  console.log('='.repeat(60));
  console.log('🧠 SOMA Cluster COORDINATOR Starting...');
  console.log('='.repeat(60));
  console.log(`Node Name: ${config.nodeName}`);
  console.log(`Role: ${config.role}`);
  console.log(`Port: ${config.port}`);
  console.log('='.repeat(60));
  
  // Create cluster integration
  const cluster = new ClusterIntegration(config);
  
  // Create auto-spawner for UnifiedMemory agents
  const autoSpawner = new AutoSpawner({
    memoryHubHost: '192.168.1.251',
    memoryHubPort: 3001,
    somaApiPort: 4000,
    spawnOnConnect: true,
    logger: console
  });
  
  // Set up event handlers
  cluster.on('started', async () => {
    console.log('\n✅ Coordinator is ONLINE and waiting for workers!');
    console.log('\n📡 Workers should connect to this node\'s IP');
    console.log(`   IP Address: ${getLocalIP()}`);
    
    // Check memory hub status
    await autoSpawner.checkMemoryHub();
  });
  
  cluster.on('sync_complete', (data) => {
    console.log(`\n🔄 Transmitter sync: ${data.synced} nodes synced`);
  });
  
  cluster.on('ready_to_aggregate', (data) => {
    console.log(`\n🤖 Ready to aggregate: ${data.updates} model updates received`);
    
    // Auto-aggregate when ready
    setTimeout(async () => {
      try {
        const model = await cluster.aggregateModels('federated_averaging');
        console.log(`✅ Model aggregated for round ${model.round}`);
      } catch (err) {
        console.error('❌ Aggregation failed:', err.message);
      }
    }, 2000);
  });
  
  cluster.on('aggregation_complete', (data) => {
    console.log(`\n✅ Aggregation complete for round ${data.round}`);
  });
  
  // Auto-spawn memory agents when workers join
  cluster.on('node_discovered', async (nodeInfo) => {
    console.log(`\n🔍 Node discovered: ${nodeInfo.nodeName} (${nodeInfo.role})`);
    await autoSpawner.onNodeDiscovered(nodeInfo);
  });
  
  // Initialize and start
  await cluster.initialize();
  await cluster.start();
  
  console.log(`\n📊 Health: http://localhost:${config.port}/health`);
  console.log(`🌐 Cluster: http://localhost:${config.port}/cluster/status`);
  console.log(`📋 Nodes: http://localhost:${config.port}/cluster/nodes`);
  console.log(`🧠 Transmitter Sync: http://localhost:${config.port}/transmitter/sync`);
  console.log(`🤖 Federated Learning: http://localhost:${config.port}/federated/model\n`);
  
  // Display diagnostics every 30 seconds
  setInterval(() => {
    const diag = cluster.getDiagnostics();
    const workers = cluster.getWorkers();
    
    console.log(`\n[${new Date().toISOString()}] Coordinator Status:`);
    console.log(`  Connected Workers: ${workers.length}`);
    console.log(`  Total Nodes: ${diag.cluster.nodes}`);
    console.log(`  Uptime: ${Math.floor(diag.uptime / 1000)}s`);
    console.log(`  Training Round: ${diag.federated.currentRound}`);
    console.log(`  Has Global Model: ${diag.federated.hasGlobalModel ? 'Yes' : 'No'}`);
    
    if (workers.length > 0) {
      console.log(`\n  Workers:`);
      workers.forEach(w => {
        console.log(`    - ${w.nodeName} (${w.host})`);
      });
    }
  }, 30000);
  
  // Periodic cluster health check
  setInterval(async () => {
    const health = await cluster.performHealthCheck();
    if (health.unhealthy > 0) {
      console.warn(`\n⚠️  Unhealthy nodes detected: ${health.unhealthy}/${health.total}`);
    }
  }, 60000);
  
  // Handle shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down coordinator...');
    await cluster.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'localhost';
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
