// start-cluster-worker.cjs
// Starts this Windows PC as a cluster worker node with full SOMA integration

const { ClusterIntegration } = require('../cluster/ClusterIntegration.cjs');
const os = require('os');

async function main() {
  // Configuration
  const config = {
    nodeId: `windows_${os.hostname()}_${Date.now()}`,
    nodeName: os.hostname(),
    role: 'worker',
    port: 5000,
    
    // Add your iMac's IP address here
    discoveryHosts: [
      '192.168.1.100',  // Replace with your iMac's actual IP
      // Add other nodes here as needed
    ],
    
    heartbeatInterval: 30000, // 30 seconds
    syncInterval: 60000, // 1 minute transmitter sync
    minParticipants: 1, // Minimum nodes for federated learning
    
    logger: console
  };
  
  console.log('='.repeat(60));
  console.log('🚀 SOMA Cluster Worker Node Starting...');
  console.log('='.repeat(60));
  console.log(`Node Name: ${config.nodeName}`);
  console.log(`Role: ${config.role}`);
  console.log(`Port: ${config.port}`);
  console.log(`Discovery Hosts: ${config.discoveryHosts.join(', ')}`);
  console.log('='.repeat(60));
  
  // Create cluster integration
  const cluster = new ClusterIntegration(config);
  
  // Initialize and start
  await cluster.initialize();
  await cluster.start();
  
  console.log('\n✅ Worker node is online and ready!');
  console.log(`\n📊 Health: http://localhost:${config.port}/health`);
  console.log(`🌐 Cluster: http://localhost:${config.port}/cluster/status`);
  console.log(`📋 Nodes: http://localhost:${config.port}/cluster/nodes`);
  console.log(`🧠 Transmitter Sync: http://localhost:${config.port}/transmitter/sync`);
  console.log(`🤖 Federated Learning: http://localhost:${config.port}/federated/model\n`);
  
  // Display diagnostics every 30 seconds
  setInterval(() => {
    const diag = cluster.getDiagnostics();
    console.log(`\n[${new Date().toISOString()}] Worker Status:`);
    console.log(`  Cluster Nodes: ${diag.cluster.nodes}`);
    console.log(`  Uptime: ${Math.floor(diag.uptime / 1000)}s`);
    console.log(`  Training Round: ${diag.federated.currentRound}`);
  }, 30000);
  
  // Handle shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down worker node...');
    await cluster.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
