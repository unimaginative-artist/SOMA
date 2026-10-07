// transmitter-server.cjs
// Standalone server for Transmitter storage layer with REST API

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { TransmitterManager } = require('../transmitters/TransmitterManager.cjs');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Initialize TransmitterManager
let transmitterManager = null;

async function initializeTransmitters() {
  console.log('[Transmitter Server] Initializing Transmitter network...');
  
  try {
    transmitterManager = new TransmitterManager(
      path.join(__dirname, '..', 'SOMA', 'transmitters'),
      {
        logging: true,
        enable_compression: true,
        link_discovery_enabled: true,
        hybrid_retrieval: true,
        // Production settings
        tn_capacity_estimate: 1_000_000,
        global_max_tns: 10000,
        decay_half_life_days: 100
      }
    );
    
    console.log('[Transmitter Server] ✅ Transmitter network initialized');
    
    // Start periodic maintenance
    startMaintenance();
    
    return transmitterManager;
  } catch (error) {
    console.error('[Transmitter Server] Failed to initialize:', error);
    throw error;
  }
}

function startMaintenance() {
  // Run maintenance every hour
  setInterval(async () => {
    try {
      console.log('[Transmitter Server] 🔧 Running maintenance...');
      await transmitterManager.maintenanceTick();
      console.log('[Transmitter Server] Maintenance complete');
    } catch (err) {
      console.error('[Transmitter Server] Maintenance error:', err.message);
    }
  }, 3600000); // 1 hour
}

// ========== REST API ENDPOINTS ==========

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    transmitters: transmitterManager ? 'active' : 'inactive',
    version: '1.0.0'
  });
});

// Get network statistics
app.get('/stats', (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  res.json(transmitterManager.stats());
});

// Get detailed status
app.get('/status', (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  res.json(transmitterManager.status());
});

// Store item (add to network)
app.post('/store', async (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  try {
    const { item } = req.body;
    
    if (!item || !item.embedding || !Array.isArray(item.embedding)) {
      return res.status(400).json({ 
        error: 'Invalid item: must include embedding array' 
      });
    }
    
    const result = await transmitterManager.addItemToBest({
      ...item,
      timestamp: item.timestamp || Date.now(),
      source: item.source || 'api'
    });
    
    res.json({ 
      success: true, 
      result,
      message: 'Item stored in Transmitter network'
    });
  } catch (error) {
    console.error('[Transmitter Server] Store error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Hybrid search
app.post('/search', async (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  try {
    const { queryEmbedding, topK = 10 } = req.body;
    
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      return res.status(400).json({ 
        error: 'Invalid query: must include queryEmbedding array' 
      });
    }
    
    const results = await transmitterManager.hybridSearch(queryEmbedding, topK);
    
    res.json({ 
      success: true, 
      results,
      count: results.length
    });
  } catch (error) {
    console.error('[Transmitter Server] Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route query (find best transmitters for a query embedding)
app.post('/route', async (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  try {
    const { queryEmbedding, topK = 6 } = req.body;
    
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      return res.status(400).json({ 
        error: 'Invalid query: must include queryEmbedding array' 
      });
    }
    
    const candidates = await transmitterManager.routeQueryEmb(queryEmbedding, topK);
    
    res.json({ 
      success: true, 
      candidates,
      count: candidates.length
    });
  } catch (error) {
    console.error('[Transmitter Server] Route error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch store (store multiple items)
app.post('/store/batch', async (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  try {
    const { items } = req.body;
    
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Invalid items: must be an array' });
    }
    
    const results = [];
    for (const item of items) {
      if (item.embedding && Array.isArray(item.embedding)) {
        const result = await transmitterManager.addItemToBest({
          ...item,
          timestamp: item.timestamp || Date.now(),
          source: item.source || 'api-batch'
        });
        results.push({ success: true, item: item.id, result });
      } else {
        results.push({ success: false, item: item.id, error: 'missing embedding' });
      }
    }
    
    res.json({ 
      success: true, 
      stored: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results 
    });
  } catch (error) {
    console.error('[Transmitter Server] Batch store error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual maintenance trigger
app.post('/maintenance', async (req, res) => {
  if (!transmitterManager) {
    return res.status(503).json({ error: 'Transmitter network not initialized' });
  }
  
  try {
    await transmitterManager.maintenanceTick();
    const stats = transmitterManager.stats();
    
    res.json({ 
      success: true, 
      message: 'Maintenance completed',
      stats 
    });
  } catch (error) {
    console.error('[Transmitter Server] Maintenance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== START SERVER ==========

const PORT = process.env.TRANSMITTER_PORT || 4001;

server.listen(PORT, async () => {
  console.log(`[Transmitter Server] Running on port ${PORT}`);
  console.log(`[Transmitter Server] REST API: http://localhost:${PORT}`);
  
  try {
    await initializeTransmitters();
    console.log('[Transmitter Server] 🚀 Ready to serve!');
    console.log('[Transmitter Server] Endpoints:');
    console.log('  GET  /health         - Health check');
    console.log('  GET  /stats          - Network statistics');
    console.log('  GET  /status         - Detailed status');
    console.log('  POST /store          - Store item');
    console.log('  POST /search         - Hybrid search');
    console.log('  POST /route          - Route query');
    console.log('  POST /store/batch    - Batch store');
    console.log('  POST /maintenance    - Manual maintenance');
  } catch (err) {
    console.error('[Transmitter Server] Initialization failed:', err);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Transmitter Server] Shutting down gracefully...');
  
  server.close(() => {
    console.log('[Transmitter Server] Server closed');
    process.exit(0);
  });
});

module.exports = { app, transmitterManager };
