const os = require('os');
const { ClusterIntegration } = require('../cluster/ClusterIntegration.cjs');

const cfg = {
  nodeId: `macbook_${os.hostname()}_${Date.now()}`,
  nodeName: os.hostname(),
  role: 'worker',
  port: 4201,
  discoveryHosts: ['192.168.1.251:4200'],
  heartbeatInterval: 30000,
  syncInterval: 60000,
  minParticipants: 1,
  logger: console,
};

(async () => {
  const cluster = new ClusterIntegration(cfg);
  await cluster.initialize();
  await cluster.start();
  console.log('\n✅ Worker node is online and ready!\n');
  console.log(`Health: http://localhost:${cfg.port}/health`);
  console.log(`Cluster: http://localhost:${cfg.port}/cluster/status`);
})();
