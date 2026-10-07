# SOMA Cluster Federation

Distributed autonomous AI across your network! Connect Windows PCs, iMacs, and other devices into a unified SOMA cluster.

## 🌟 Features

- **Auto-Discovery**: Nodes find each other automatically
- **Work Distribution**: Tasks route to least-busy node
- **Transmitter Sync**: Federated knowledge sharing across nodes
- **Federated Learning**: Distributed model training and aggregation
- **Health Monitoring**: Automatic heartbeat and stale node removal
- **RESTful API**: Full HTTP API for all operations

## 📦 Components

### 1. ClusterNode
Core networking and node management
- Node discovery and registration
- Heartbeat monitoring
- Task distribution
- RESTful API endpoints

### 2. TransmitterSync
Federated knowledge sharing
- Automatic memory synchronization
- Distributed query across cluster
- Version control and conflict resolution
- Push/pull memory operations

### 3. FederatedLearning
Distributed model training
- Coordinator/worker architecture
- Model aggregation (federated averaging, weighted averaging)
- Training round orchestration
- History tracking and metrics

### 4. ClusterIntegration
Unified orchestration layer
- Combines all components
- Event-driven architecture
- Health checks and diagnostics
- Simplified API

## 🚀 Quick Start

### Worker Node (Windows PC)

1. **Edit configuration** in `start-cluster-worker.cjs`:
   ```javascript
   discoveryHosts: [
     '192.168.1.100',  // Your iMac's IP
     // Add other nodes
   ]
   ```

2. **Start the worker**:
   ```bash
   node start-cluster-worker.cjs
   ```

### Coordinator Node (iMac)

1. **Create coordinator script** (`start-cluster-coordinator.cjs`):
   ```javascript
   const { ClusterIntegration } = require('./cluster/ClusterIntegration.cjs');
   
   async function main() {
     const cluster = new ClusterIntegration({
       nodeId: 'coordinator_imac',
       nodeName: 'iMac-Brain',
       role: 'coordinator',
       port: 5000,
       discoveryHosts: [],  // Coordinator waits for workers
       heartbeatInterval: 30000,
       syncInterval: 60000
     });
     
     await cluster.initialize();
     await cluster.start();
     
     console.log('✅ Coordinator online!');
   }
   
   main().catch(console.error);
   ```

2. **Start the coordinator**:
   ```bash
   node start-cluster-coordinator.cjs
   ```

## 🔌 API Endpoints

### Core Endpoints
- `GET /health` - Node health check
- `GET /node/info` - Node information
- `POST /node/discover` - Node discovery
- `GET /cluster/status` - Cluster status
- `GET /cluster/nodes` - List all nodes
- `POST /task/execute` - Execute task

### Transmitter Sync
- `POST /transmitter/sync` - Sync memories
- `POST /transmitter/push` - Push memories
- `POST /transmitter/query` - Query memories

### Federated Learning
- `POST /federated/train` - Request training
- `POST /federated/submit` - Submit model update
- `GET /federated/model` - Get global model

## 💻 Usage Examples

### Distribute Task
```javascript
const result = await cluster.distributeTask(
  'analyze',
  { data: 'some data' },
  { priority: 'high' }
);
```

### Sync Transmitters
```javascript
await cluster.syncTransmitters();
```

### Query Cluster Knowledge
```javascript
const results = await cluster.queryCluster(
  'machine learning concepts',
  { limit: 20 }
);
```

### Initiate Training Round (Coordinator only)
```javascript
const round = await cluster.initiateTrainingRound({
  epochs: 5,
  batchSize: 32,
  learningRate: 0.01
});
```

### Aggregate Models (Coordinator only)
```javascript
const globalModel = await cluster.aggregateModels('federated_averaging');
```

## 📊 Monitoring

### Get Cluster Status
```javascript
const status = cluster.getClusterStatus();
console.log(`Cluster Size: ${status.clusterSize}`);
console.log(`Coordinator: ${status.coordinator}`);
console.log(`Workers: ${status.workers}`);
```

### Get Diagnostics
```javascript
const diag = cluster.getDiagnostics();
console.log(diag);
```

### Health Check
```javascript
const health = await cluster.performHealthCheck();
console.log(`Healthy: ${health.healthy}/${health.total}`);
```

## 🔧 Configuration

### Node Configuration
```javascript
{
  nodeId: 'unique-node-id',
  nodeName: 'My-Computer',
  role: 'worker', // or 'coordinator'
  port: 5000,
  discoveryHosts: ['192.168.1.100'], // Other node IPs
  heartbeatInterval: 30000, // 30 seconds
  syncInterval: 60000, // 1 minute
  minParticipants: 1, // For federated learning
  logger: console
}
```

## 🌐 Network Requirements

- All nodes must be on the same network
- Port 5000 (default) must be accessible
- Windows Firewall: Allow Node.js through firewall
- macOS Firewall: Allow incoming connections

### Check Connectivity
```bash
# From Windows PC, test connection to iMac
ping 192.168.1.100
curl http://192.168.1.100:5000/health
```

## 🛠️ Troubleshooting

### Node not discovered
- Check IP addresses in `discoveryHosts`
- Verify firewall settings
- Ensure both nodes are running
- Check port availability: `netstat -an | findstr 5000`

### Sync not working
- Verify transmitter is configured
- Check network connectivity
- Review logs for errors

### Training round fails
- Ensure coordinator role is set
- Check minimum participants requirement
- Verify all workers are online

## 📈 Advanced Features

### Custom Message Broadcasting
```javascript
await cluster.broadcastMessage(
  { type: 'custom', data: 'hello' },
  'workers' // or 'all' or specific node
);
```

### Event Handling
```javascript
cluster.on('started', (data) => {
  console.log('Cluster started:', data);
});

cluster.on('sync_complete', (data) => {
  console.log('Sync complete:', data);
});

cluster.on('training_complete', (data) => {
  console.log('Training complete:', data);
});

cluster.on('aggregation_complete', (data) => {
  console.log('Model aggregated:', data);
});
```

## 🎯 Architecture

```
┌─────────────────────────────────────────────┐
│          ClusterIntegration                 │
│  (Unified orchestration & event handling)   │
└───────────┬───────────────────┬─────────────┘
            │                   │
    ┌───────▼────────┐   ┌──────▼──────┐
    │  ClusterNode   │   │ TransSync   │
    │  - Discovery   │   │ - Memory    │
    │  - Heartbeat   │   │ - Query     │
    │  - Tasks       │   │ - Version   │
    └────────────────┘   └─────────────┘
            │
    ┌───────▼────────┐
    │  FedLearn      │
    │  - Training    │
    │  - Aggregate   │
    │  - Coordinate  │
    └────────────────┘
```

## 🚦 Status Indicators

- **Green**: Node healthy and connected
- **Yellow**: Node discovered but not responding
- **Red**: Node offline or unreachable

Check status anytime:
```bash
curl http://localhost:5000/cluster/status | json_pp
```

## 📝 License

MIT - Build your distributed AI empire! 🚀
