// ════════════════════════════════════════════════════════════════════════════
// SOMA Backend Server — Express + WebSocket
// ════════════════════════════════════════════════════════════════════════════
// Serves dashboard stats including emotional states, arbiter population, and
// system health via REST API and WebSocket live updates
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const ArbiterOrchestrator = require('../core/ArbiterOrchestrator.cjs');
const SteveArbiter = require('../arbiters/SteveArbiter.cjs');

class SOMAServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 3001,
      updateInterval: config.updateInterval || 1000,
      ...config
    };

    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });

    this.orchestrator = null;
    this.clients = new Set();
  }

  async initialize() {
    console.log('🚀 Initializing SOMA Server...');

    // Middleware - CORS with explicit configuration
    this.app.use(cors({
      origin: '*', // Allow all origins in development
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Setup WebSocket
    this.setupWebSocket();

    // Initialize orchestrator (lightweight, non-blocking)
    this.orchestrator = new ArbiterOrchestrator();
    await this.orchestrator.initialize();

    // Setup routes (depends on orchestrator)
    await this.setupRoutes();

    // Mount dynamic ESM routes
    try {
        const scannerRoutes = (await import('./finance/scannerRoutes.js')).default;
        this.app.use('/api/scanner', scannerRoutes);
        console.log('    📡 Mounted /api/scanner routes');
        
        const notificationRoutes = (await import('./routes/notificationRoutes.js')).default;
        this.app.use('/api/notifications', notificationRoutes);
        console.log('    📡 Mounted /api/notifications routes');
        
        // Mount MAX bidirectional control channel
        const maxControlChannel = require('./routes/maxControlChannel.js')(this.orchestrator);
        this.app.use('/api/max', maxControlChannel);
        console.log('    📡 Mounted /api/max bidirectional control channel');
    } catch (e) {
        console.warn('    ⚠️ Failed to mount dynamic routes:', e.message);
    }

    // Subscribe to workflow updates
    if (this.orchestrator.broker) {
      this.orchestrator.broker.subscribe('workflow_update', (message) => {
        const data = message.payload || message;
        this.broadcast({
          type: 'workflow_update',
          data: data
        });
      });
    }

    console.log('✅ SOMA Server initialized (orchestrator population will spawn in background)');
  }

  async initializePopulation() {
    // Spawn population in background (non-blocking)
    console.log('🔄 Starting arbiter population spawn (this may take a moment)...');
    try {
      await this.orchestrator.spawnPopulation({
        enableUnifiedMemory: true,  // Enable UnifiedMemoryArbiter for production
        productionMode: true         // Enable all production features
      });

      // Start broadcast loop after population is ready
      this.startBroadcast();

      console.log('✅ Arbiter population fully spawned and active');
    } catch (error) {
      console.error('❌ Error spawning population:', error);
      console.log('⚠️  Server will continue with limited functionality');
    }
  }

  async setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: Date.now() });
    });

    // System status
    this.app.get('/api/status', (req, res) => {
      const status = this.orchestrator.getSystemStatus();
      res.json(status);
    });

    // Population stats
    this.app.get('/api/population', (req, res) => {
      const stats = this.orchestrator.getPopulationStats();
      res.json(stats);
    });

    // Health report
    this.app.get('/api/health', (req, res) => {
      const report = this.orchestrator.getHealthReport();
      res.json(report);
    });

    // Memory tier status (from StorageArbiter)
    this.app.get('/api/memory/status', (req, res) => {
      try {
        const storageArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'StorageArbiter');

        if (!storageArbiter) {
          // Graceful degradation - return default values
          return res.json({
            success: true,
            tiers: {
              hot: { size: 0, hitRate: 0 },
              warm: { size: 0, hitRate: 0 },
              cold: { size: 0, hitRate: 0 }
            }
          });
        }

        // Get actual memory tier data from StorageArbiter
        const stats = storageArbiter.getStats ? storageArbiter.getStats() : {};
        res.json({
          success: true,
          tiers: stats.tiers || {
            hot: { size: 0, hitRate: 0 },
            warm: { size: 0, hitRate: 0 },
            cold: { size: 0, hitRate: 0 }
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Reasoning endpoint - Multi-arbiter orchestration
    this.app.post('/api/reason', async (req, res) => {
      try {
        const { query, context, mode } = req.body;

        if (!query) {
          return res.status(400).json({
            success: false,
            error: 'query is required'
          });
        }

        // Get ConductorArbiter for task orchestration
        const conductor = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'ConductorArbiter');

        if (!conductor) {
          return res.status(503).json({
            success: false,
            error: 'ConductorArbiter not available'
          });
        }

        // Execute reasoning with tree tracking
        const result = await conductor.executeTask({
          query,
          context: context || {},
          mode: mode || 'balanced', // fast, balanced, deep
          requiresTree: true
        });

        res.json({
          success: true,
          response: result.response,
          tree: result.tree, // Reasoning tree structure
          arbiters: result.arbitersUsed,
          confidence: result.confidence,
          metadata: result.metadata
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Coding task endpoint - ConductorArbiter orchestrates coding arbiters
    this.app.post('/api/code/task', async (req, res) => {
      try {
        const { task, files, language, testRequirements } = req.body;

        if (!task) {
          return res.status(400).json({
            success: false,
            error: 'task is required'
          });
        }

        const conductor = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'ConductorArbiter');

        if (!conductor) {
          return res.status(503).json({
            success: false,
            error: 'ConductorArbiter not available'
          });
        }

        // Decompose and execute coding task
        const result = await conductor.executeCodeTask({
          task,
          files: files || [],
          language: language || 'detect',
          testRequirements: testRequirements || null
        });

        res.json({
          success: true,
          code: result.code,
          explanation: result.explanation,
          tests: result.tests,
          tree: result.tree,
          arbiters: result.arbitersUsed
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // File system endpoints for context injection
    this.app.post('/api/fs/read', async (req, res) => {
      try {
        const { path: filePath } = req.body;

        if (!filePath) {
          return res.status(400).json({
            success: false,
            error: 'path is required'
          });
        }

        const fs = require('fs').promises;
        const path = require('path');
        const resolvedPath = path.resolve(filePath);
        const content = await fs.readFile(resolvedPath, 'utf8');

        res.json({ success: true, content, path: resolvedPath });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/fs/write', async (req, res) => {
      try {
        const { path: filePath, content } = req.body;

        if (!filePath || content === undefined) {
          return res.status(400).json({
            success: false,
            error: 'path and content are required'
          });
        }

        const fs = require('fs').promises;
        const path = require('path');
        const resolvedPath = path.resolve(filePath);
        await fs.writeFile(resolvedPath, content, 'utf8');

        res.json({ success: true, path: resolvedPath });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/fs/list', async (req, res) => {
      try {
        const { path: dirPath } = req.query;

        if (!dirPath) {
          return res.status(400).json({
            success: false,
            error: 'path is required'
          });
        }

        const fs = require('fs').promises;
        const path = require('path');
        const resolvedPath = path.resolve(dirPath);
        const files = await fs.readdir(resolvedPath, { withFileTypes: true });

        const fileList = files.map(f => ({
          name: f.name,
          isDirectory: f.isDirectory(),
          isFile: f.isFile()
        }));

        res.json({ success: true, files: fileList, path: resolvedPath });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/fs/search', async (req, res) => {
      try {
        const { query, rootPath = '.', extensions = [] } = req.body;

        if (!query && extensions.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'query or extensions required'
          });
        }

        const fs = require('fs').promises;
        const path = require('path');
        const baseDir = path.resolve(rootPath);
        const results = [];

        async function searchRecursively(currentPath) {
          try {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
              const fullPath = path.join(currentPath, entry.name);
              const relativePath = path.relative(baseDir, fullPath);

              // Skip hidden folders and node_modules
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

              const ext = path.extname(entry.name).toLowerCase().replace('.', '');
              const matchesExt = extensions.length === 0 || extensions.includes(ext);
              const matchesQuery = !query || entry.name.toLowerCase().includes(query.toLowerCase());

              if (matchesExt && matchesQuery) {
                results.push({
                  name: entry.name,
                  path: relativePath,
                  isDirectory: entry.isDirectory(),
                  size: entry.isFile() ? (await fs.stat(fullPath)).size : 0
                });
              }

              if (entry.isDirectory()) {
                await searchRecursively(fullPath);
              }
            }
          } catch (e) {
            // Ignore access errors
          }
        }

        await searchRecursively(baseDir);

        // Limit results
        res.json({ success: true, results: results.slice(0, 100) });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/fs/operate', async (req, res) => {
      try {
        const { operation, source, destination } = req.body;
        const fs = require('fs').promises;
        const path = require('path');

        if (!source || !destination) {
          return res.status(400).json({ success: false, error: 'Source and destination required' });
        }

        const srcPath = path.resolve(source);
        const destPath = path.resolve(destination);

        // Basic safety check: Ensure not leaving CWD if strict mode (omitted for local tool power)

        if (operation === 'move') {
          await fs.rename(srcPath, destPath);
        } else if (operation === 'copy') {
          const stat = await fs.stat(srcPath);
          if (stat.isDirectory()) {
            // Recursive copy function
            async function copyDir(src, dest) {
              await fs.mkdir(dest, { recursive: true });
              const entries = await fs.readdir(src, { withFileTypes: true });
              for (const entry of entries) {
                const srcChild = path.join(src, entry.name);
                const destChild = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                  await copyDir(srcChild, destChild);
                } else {
                  await fs.copyFile(srcChild, destChild);
                }
              }
            }
            await copyDir(srcPath, destPath);
          } else {
            await fs.copyFile(srcPath, destPath);
          }
        } else {
          return res.status(400).json({ success: false, error: 'Invalid operation' });
        }

        res.json({ success: true, operation, source, destination });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Emotional state (from EmotionalEngine)
    this.app.get('/api/emotions', (req, res) => {
      const emotionalState = this.getEmotionalState();
      res.json(emotionalState);
    });

    // Personality state (from PersonalityEngine)
    this.app.get('/api/personality', (req, res) => {
      const personality = this.getPersonalityState();
      res.json(personality);
    });

    // Arbiter control
    this.app.post('/api/arbiter/spawn', async (req, res) => {
      try {
        const { type, config } = req.body;
        const arbiterId = await this.orchestrator.spawn(type, config);
        res.json({ success: true, arbiterId });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/arbiter/terminate', async (req, res) => {
      try {
        const { arbiterId } = req.body;
        await this.orchestrator.terminate(arbiterId);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // AGI System endpoints
    this.app.get('/api/agi/status', (req, res) => {
      try {
        const { getAGIIntegration } = require('../core/AGI-Integration.cjs');
        const agi = getAGIIntegration();
        res.json(agi.getStatus());
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/agi/metrics', (req, res) => {
      try {
        const { getAGIIntegration } = require('../core/AGI-Integration.cjs');
        const agi = getAGIIntegration();
        res.json(agi.getMetrics());
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Audio Processing endpoints
    this.app.post('/api/audio/transcribe', async (req, res) => {
      try {
        const { audioPath, options = {} } = req.body;

        if (!audioPath) {
          return res.status(400).json({
            success: false,
            error: 'audioPath is required'
          });
        }

        // Get AudioProcessingArbiter
        const audioArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'AudioProcessingArbiter');

        if (!audioArbiter) {
          return res.status(503).json({
            success: false,
            error: 'AudioProcessingArbiter not available'
          });
        }

        // Transcribe audio
        const result = await audioArbiter.transcribeSpeech(audioPath, options);

        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/audio/stats', (req, res) => {
      try {
        // Get AudioProcessingArbiter
        const audioArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'AudioProcessingArbiter');

        if (!audioArbiter) {
          return res.status(503).json({
            success: false,
            error: 'AudioProcessingArbiter not available'
          });
        }

        const stats = audioArbiter.getStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // User message endpoint (for orb integration)
    this.app.post('/api/user/message', async (req, res) => {
      try {
        const { userId, message, context = {} } = req.body;

        if (!message) {
          return res.status(400).json({
            success: false,
            error: 'message is required'
          });
        }

        // Get TheoryOfMindArbiter
        const tomArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'TheoryOfMindArbiter');

        if (!tomArbiter) {
          return res.status(503).json({
            success: false,
            error: 'TheoryOfMindArbiter not available'
          });
        }

        // Analyze intent
        const intent = await tomArbiter.inferUserIntent({
          userId: userId || 'unknown',
          message,
          context
        });

        // Get knowledge level
        const knowledge = await tomArbiter.modelUserKnowledge(userId || 'unknown');

        // Return analysis
        res.json({
          success: true,
          message,
          intent: {
            primary: intent.primary,
            confidence: intent.confidence,
            alternatives: intent.alternatives
          },
          knowledge: {
            level: knowledge.level,
            confidence: knowledge.confidence
          },
          timestamp: Date.now()
        });

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Vision Processing endpoints
    this.app.post('/api/vision/analyze', async (req, res) => {
      try {
        const { imageData, mimeType, prompt, options = {} } = req.body;

        if (!imageData) {
          return res.status(400).json({
            success: false,
            error: 'imageData is required'
          });
        }

        if (!mimeType) {
          return res.status(400).json({
            success: false,
            error: 'mimeType is required'
          });
        }

        // Get VisionProcessingArbiter
        const visionArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'VisionProcessingArbiter');

        if (!visionArbiter) {
          return res.status(503).json({
            success: false,
            error: 'VisionProcessingArbiter not available'
          });
        }

        // Analyze image
        const result = await visionArbiter.analyzeImage(imageData, mimeType, {
          prompt,
          ...options
        });

        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Objective-based browsing (WebScraperDendrite)
    this.app.post('/api/browse/objective', async (req, res) => {
      try {
        if (process.env.SOMA_LOCAL_ONLY === 'true') {
          return res.status(403).json({ success: false, error: 'Local-only mode enabled: web access blocked' });
        }

        const {
          objective,
          seedUrls,
          allowedDomains,
          maxPages,
          extractors,
          timeoutMs,
          allowUnsafe,
          captureScreenshot,
          includeHtml
        } = req.body || {};

        if (!objective && (!Array.isArray(seedUrls) || seedUrls.length === 0)) {
          return res.status(400).json({
            success: false,
            error: 'objective or seedUrls required'
          });
        }

        const webScraper = this.system?.webScraperDendrite;
        if (!webScraper || !webScraper.browseObjective) {
          return res.status(503).json({
            success: false,
            error: 'WebScraperDendrite not available'
          });
        }

        const result = await webScraper.browseObjective({
          objective,
          seedUrls,
          allowedDomains,
          maxPages,
          extractors,
          timeoutMs,
          allowUnsafe,
          captureScreenshot,
          includeHtml
        });

        return res.json(result);
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/vision/stats', (req, res) => {
      try {
        // Get VisionProcessingArbiter
        const visionArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'VisionProcessingArbiter');

        if (!visionArbiter) {
          return res.status(503).json({
            success: false,
            error: 'VisionProcessingArbiter not available'
          });
        }

        const stats = visionArbiter.getStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Simulation endpoints
    this.app.get('/api/simulation/stats', (req, res) => {
      try {
        const simArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'SimulationArbiter');
        const controllerArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'SimulationControllerArbiter');

        if (!simArbiter || !controllerArbiter) {
          return res.status(503).json({
            success: false,
            error: 'Simulation arbiters not available'
          });
        }

        res.json({
          success: true,
          simulation: simArbiter.getStats(),
          controller: controllerArbiter.getStats()
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/simulation/status', (req, res) => {
      try {
        const simArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'SimulationArbiter');

        if (!simArbiter) {
          return res.status(503).json({
            success: false,
            error: 'SimulationArbiter not available'
          });
        }

        res.json({
          success: true,
          isRunning: simArbiter.isRunning,
          currentEpisode: simArbiter.episodeCount,
          currentScore: Math.floor(simArbiter.score),
          viewerPort: simArbiter.config.port
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Knowledge Management endpoints
    this.app.get('/api/knowledge/stats', (req, res) => {
      try {
        // Calculate knowledge statistics
        const stats = {
          totalConnections: 0,
          avgStrength: 0.7,
          nodeCount: 0
        };

        res.json({ success: true, stats });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/knowledge/activity', (req, res) => {
      try {
        // Return recent knowledge activity
        const activities = [];

        res.json({ success: true, activities });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/knowledge/add', async (req, res) => {
      try {
        const nodeData = req.body;

        // Add knowledge node logic here
        // For now, just acknowledge

        res.json({ success: true, id: `node_${Date.now()}` });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.delete('/api/knowledge/delete/:nodeId', async (req, res) => {
      try {
        const { nodeId } = req.params;

        // Delete knowledge node logic here

        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/knowledge/consolidate', async (req, res) => {
      try {
        // Memory consolidation logic here

        res.json({
          success: true,
          merged: 0,
          strengthened: 0
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Belief Network endpoint
    this.app.get('/api/belief-network', (req, res) => {
      try {
        const cogBridge = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'CognitiveBridge');

        if (cogBridge && cogBridge.getBeliefNetwork) {
          res.json({ success: true, network: cogBridge.getBeliefNetwork() });
        } else {
          res.json({ success: true, network: { nodes: [], edges: [] } });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Theory of Mind endpoint
    this.app.get('/api/theory-of-mind/insights', (req, res) => {
      try {
        const tomArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'TheoryOfMindArbiter');

        if (tomArbiter && (tomArbiter.getInsights || tomArbiter.getUserModel)) {
          const userId = req.query.userId || 'default_user';
          const model = tomArbiter.getInsights ? tomArbiter.getInsights(userId) : tomArbiter.getUserModel(userId);
          res.json({ success: true, insights: model || {} });
        } else {
          res.json({ success: true, insights: {} });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Analytics endpoints
    this.app.get('/api/analytics/learning-metrics', (req, res) => {
      try {
        const velocityTracker = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'LearningVelocityTracker');

        if (velocityTracker && velocityTracker.getMetrics) {
          res.json({ success: true, metrics: velocityTracker.getMetrics() });
        } else {
          res.json({ success: true, metrics: { velocity: 1.0, acceleration: 0, trends: [] } });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/analytics/performance', (req, res) => {
      try {
        const stats = this.orchestrator.getPopulationStats();
        res.json({ success: true, performance: stats });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/analytics/summary', (req, res) => {
      try {
        const status = this.orchestrator.getSystemStatus();
        res.json({ success: true, summary: status });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/analytics/memory-usage', (req, res) => {
      try {
        const storageArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'StorageArbiter');

        if (storageArbiter && storageArbiter.getStats) {
          res.json({ success: true, usage: storageArbiter.getStats() });
        } else {
          res.json({ success: true, usage: { total: 0, used: 0, tiers: {} } });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/analytics/arbiter-activity', (req, res) => {
      try {
        const activity = Array.from(this.orchestrator.population.values()).map(arbiter => ({
          id: arbiter.id || arbiter.name,
          name: arbiter.constructor.name,
          state: arbiter.state || 'active',
          lastActivity: arbiter.lastActivity || Date.now()
        }));
        res.json({ success: true, activity });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Learning Velocity endpoint
    this.app.get('/api/velocity/status', (req, res) => {
      try {
        const velocityTracker = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'LearningVelocityTracker');

        if (velocityTracker && velocityTracker.getStatus) {
          res.json({ success: true, ...velocityTracker.getStatus() });
        } else {
          res.json({
            success: true,
            velocity: 1.0,
            target: 2.0,
            progress: 0,
            trends: []
          });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/velocity/metrics', (req, res) => {
      try {
        const velocityTracker = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'LearningVelocityTracker');

        if (velocityTracker && velocityTracker.getMetrics) {
          res.json({ success: true, metrics: velocityTracker.getMetrics() });
        } else {
          res.json({ success: true, metrics: [] });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // STEVE & WORKFLOW STUDIO ENDPOINTS
    // ==========================================

    // ... [existing code] ...

    // Initialize Steve with full system access
    this.steve = new SteveArbiter(this.orchestrator.broker, {
      kevinManager: this.kevinManager,
      orchestrator: this.orchestrator,
      // Assuming SOMAServer instance has access to learningPipeline via global scope or passed config
      // In the current file structure, learningPipeline is a global variable in soma-server.js but not necessarily here.
      // We will try to attach it if available on the orchestrator or global scope.
      learningPipeline: this.orchestrator.learningPipeline || (global.SOMA ? global.SOMA.learningPipeline : null)
    });
    await this.steve.initialize();

    // Register STEVE with MessageBroker for cross-arbiter communication
    if (this.orchestrator.broker) {
      this.orchestrator.broker.registerArbiter('SteveArbiter', {
        role: 'specialist',
        version: '1.0.0',
        instance: this.steve
      });
      console.log('[SOMAServer] ✅ SteveArbiter registered with MessageBroker');
    }

    // STEVE Chat Interface
    this.app.post('/api/steve/chat', async (req, res) => {
      try {
        const { message, context = {} } = req.body;

        if (!this.steve) {
          return res.status(503).json({ success: false, error: 'STEVE Core not initialized' });
        }

        const response = await this.steve.processChat(message, context);

        res.json({
          success: true,
          response: response,
          agent: {
            name: 'STEVE',
            role: 'Agent Architect',
            id: 'steve-001'
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Pulse API Proxy Endpoints
    this.app.post('/api/pulse/generate', async (req, res) => {
      try {
        const { prompt } = req.body;
        const soma = Array.from(this.orchestrator.population.values()).find(a => a.constructor.name === 'SOMArbiterV3' || a.constructor.name === 'SOMArbiterV2');

        if (!soma) return res.status(503).json({ error: 'SOMA Brain offline' });

        // Use AURORA (Gemini) for blueprint synthesis
        const result = await soma.callAURORA(
          `You are the Pulse Synthesis Engine. Generate a complete code blueprint for: "${prompt}". 
                Important: Provide a working web implementation.
                Output a JSON object with:
                - explanation: A brief summary of what was built.
                - files: An array of objects { path, content, language }. 
                  Include index.html, styles.css, and app.js (or app.tsx).
                Use modern, clean, and beautiful UI principles.
                
                Respond ONLY with valid JSON.`,
          { temperature: 0.7 }
        );

        // Clean result
        let cleanJson = result.response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        res.json(JSON.parse(cleanJson));
      } catch (e) {
        res.status(500).json({ error: e.message, explanation: "Synthesis failed.", files: [] });
      }
    });

    this.app.post('/api/pulse/assist', async (req, res) => {
      try {
        const { input, context } = req.body;
        const soma = Array.from(this.orchestrator.population.values()).find(a => a.constructor.name === 'SOMArbiterV3' || a.constructor.name === 'SOMArbiterV2');

        if (!soma) return res.status(503).json({ error: 'SOMA Brain offline' });

        const result = await soma.callAURORA(
          `Terminal assistant for Pulse Terminal. Input: "${input}". Path: "${context}". 
                If the user wants to "make", "create", or "build" a website/app, respond with a JSON indicating a "blueprint_intent".
                Otherwise, provide standard terminal help.
                Output JSON:
                - intent: "help" | "blueprint_intent"
                - suggestion: brief text
                - explanation: detailed text
                - code: if relevant
                - language: string
                
                Respond ONLY with valid JSON.`,
          { temperature: 0.5 }
        );

        let cleanJson = result.response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        res.json(JSON.parse(cleanJson));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    this.app.post('/api/pulse/steve', async (req, res) => {
      try {
        const { message, history, context } = req.body;

        if (!this.steve) return res.status(503).json({ error: 'Steve Architect offline' });

        // SteveArbiter.processChat now handles RAG + AURORA calls internally
        const response = await this.steve.processChat(message, { history, ...context });

        res.json({ response });
      } catch (e) {
        res.status(500).json({ error: e.message, response: "Steve offline.", updatedFiles: [] });
      }
    });

    // Vision to Blueprint Endpoint
    this.app.post('/api/pulse/vision-blueprint', async (req, res) => {
      try {
        const { imageData, mimeType, prompt } = req.body;

        const visionArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'VisionProcessingArbiter');

        const soma = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'SOMArbiterV3' || a.constructor.name === 'SOMArbiterV2');

        if (!visionArbiter || !soma) {
          return res.status(503).json({ error: 'Vision or Brain systems offline' });
        }

        console.log('[Pulse] 👁️ Analyzing UI screenshot...');

        // 1. Analyze the UI with Vision Arbiter
        const visionResult = await visionArbiter.analyzeImage(imageData, mimeType, {
          prompt: "Describe this user interface in extreme technical detail. List layout, components, colors, fonts, and functional elements. If there is text, transcribe it. Format as a technical spec for a React developer."
        });

        const uiSpec = visionResult.analysis;

        // 2. Synthesize Blueprint from the Vision Spec
        console.log('[Pulse] 🛠️ Synthesizing blueprint from vision spec...');
        const synthesis = await soma.callAURORA(
          `You are the Pulse Synthesis Engine. Convert this UI specification into a complete functional React blueprint. 
                UI SPEC: ${uiSpec}
                
                Important: Provide a working implementation.
                Output a JSON object with:
                - explanation: Summary of the visual-to-code translation.
                - files: Array of { path, content, language }. 
                Include index.html, styles.css, and app.js (or app.tsx).
                
                Respond ONLY with valid JSON.`,
          { temperature: 0.7 }
        );

        let cleanJson = synthesis.response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        res.json(JSON.parse(cleanJson));

      } catch (e) {
        console.error('[Pulse] Vision-to-Blueprint failed:', e);
        res.status(500).json({ error: e.message });
      }
    });

    // Self-Healing Endpoint
    this.app.post('/api/pulse/heal', async (req, res) => {
      try {
        const { errorContext, blueprint } = req.body;

        const soma = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'SOMArbiterV3' || a.constructor.name === 'SOMArbiterV2');

        if (!soma) return res.status(503).json({ error: 'SOMA Brain offline' });

        console.log('[Pulse] 🩹 Healing runtime error:', errorContext.message);

        const result = await soma.callAURORA(
          `You are the SOMA Immune System. A Pulse blueprint has failed with a runtime error.
                
                ERROR: ${JSON.stringify(errorContext)}
                CURRENT BLUEPRINT: ${JSON.stringify(blueprint)}
                
                Identify the bug and return the FULL corrected blueprint. 
                Output a JSON object with:
                - explanation: Description of the fix.
                - files: Array of { path, content, language }.
                
                Respond ONLY with valid JSON.`,
          { temperature: 0.3 } // Lower temperature for precision fixes
        );

        let cleanJson = result.response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        res.json(JSON.parse(cleanJson));

      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // UI Control Endpoint
    this.app.post('/api/ui/trigger', async (req, res) => {
      try {
        const { action, component, params } = req.body;

        if (action === 'open' && component === 'Pulse') {
          this.broadcast({
            type: 'ui.modal',
            payload: { modal: 'Pulse', action: 'open', params }
          });
          res.json({ success: true, message: 'Pulse Interface opened' });
        } else {
          res.status(400).json({ success: false, error: 'Unknown UI action' });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Workflow Execution
    this.app.post('/api/execute-workflow', async (req, res) => {
      try {
        const workflow = req.body;
        console.log(`[Server] 🚀 Initiating Workflow Execution: ${workflow.name}`);

        // For now, we'll route this to the Conductor to plan the execution
        const conductor = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'ConductorArbiter');

        if (!conductor) return res.status(503).json({ success: false, error: 'Orchestration Swarm not available' });

        // Execute workflow via Conductor
        const logs = await conductor.executeWorkflow(workflow);

        res.json({ success: true, logs });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Goals endpoints
    this.app.get('/api/goals/active', (req, res) => {
      try {
        const goalPlanner = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'GoalPlannerArbiter');

        if (goalPlanner && goalPlanner.getActiveGoals) {
          const result = goalPlanner.getActiveGoals();
          // Extract the nested goals array if result is an object with goals property
          const goalsArray = result?.goals || (Array.isArray(result) ? result : []);
          res.json({ success: true, goals: goalsArray });
        } else {
          res.json({ success: true, goals: [] });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/goals/stats', (req, res) => {
      try {
        const goalPlanner = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'GoalPlannerArbiter');

        if (goalPlanner && goalPlanner.getStats) {
          res.json({ success: true, stats: goalPlanner.getStats() });
        } else {
          res.json({ success: true, stats: { total: 0, completed: 0, active: 0 } });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Belief endpoints
    this.app.get('/api/beliefs', (req, res) => {
      try {
        const cogBridge = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'CognitiveBridge');

        if (cogBridge && cogBridge.getBeliefs) {
          res.json({ success: true, beliefs: cogBridge.getBeliefs() });
        } else {
          res.json({ success: true, beliefs: [] });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/beliefs/contradictions', (req, res) => {
      try {
        const cogBridge = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'CognitiveBridge');

        if (cogBridge && cogBridge.getContradictions) {
          res.json({ success: true, contradictions: cogBridge.getContradictions() });
        } else {
          res.json({ success: true, contradictions: [] });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Dream endpoints
    this.app.get('/api/dream/insights', (req, res) => {
      try {
        const dreamArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'DreamArbiter');

        if (dreamArbiter && dreamArbiter.getInsights) {
          res.json({ success: true, insights: dreamArbiter.getInsights() });
        } else {
          res.json({ success: true, insights: [] });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Muse endpoints
    this.app.get('/api/muse/sparks', (req, res) => {
      try {
        const curiosityEngine = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'CuriosityEngine');

        if (curiosityEngine && curiosityEngine.getSparks) {
          res.json({ success: true, sparks: curiosityEngine.getSparks() });
        } else {
          res.json({ success: true, sparks: [] });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Knowledge endpoints
    this.app.get('/api/knowledge/load', (req, res) => {
      try {
        const edgeWorker = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'EdgeWorkerArbiter');

        if (edgeWorker && edgeWorker.getKnowledgeGraph) {
          res.json({ success: true, knowledge: edgeWorker.getKnowledgeGraph() });
        } else {
          res.json({ success: true, knowledge: { nodes: [], edges: [] } });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Marketplace Endpoints
    this.app.post('/api/marketplace/install', async (req, res) => {
      try {
        const { id } = req.body;
        console.log(`[Marketplace] 📦 Installing module: ${id}`);

        // In a real implementation, this would:
        // 1. Download the tool/agent code from a repo
        // 2. Register it with the Orchestrator
        // 3. Update the config file

        // For now, we simulate success
        res.json({ success: true, id, status: 'installed' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Chat endpoint for Cognitive Terminal
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { message, context = {} } = req.body;

        if (!message) {
          return res.status(400).json({ success: false, error: 'Message is required' });
        }

        // Find SOMArbiter (V3 or V2) to process the chat
        const somaArbiter = Array.from(this.orchestrator.population.values())
          .find(a => a.constructor.name === 'SOMArbiterV3' || a.constructor.name === 'SOMArbiterV2');

        if (somaArbiter && somaArbiter.processUserMessage) {
          const response = await somaArbiter.processUserMessage(message, context);
          res.json({
            success: true,
            response: response.text || response.response || response,
            metadata: response.metadata || {}
          });
        } else {
          // Fallback response if SOMA arbiter not available
          res.json({
            success: true,
            response: `Received: ${message}`,
            metadata: { fallback: true }
          });
        }
      } catch (error) {
        console.error('[Chat API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // KEVIN Chat endpoint - Sandboxed personality engine
    this.app.post('/api/kevin/chat', async (req, res) => {
      try {
        const { message, context = {} } = req.body;

        if (!message) {
          return res.status(400).json({
            success: false,
            error: 'Message is required, dude!'
          });
        }

        // Get KEVINManager - check multiple sources
        let kevinManager = this.kevinManager || this.orchestrator.kevinManager;

        // If not found, try to get from global SOMA system
        if (!kevinManager && global.SOMA && global.SOMA.kevinManager) {
          kevinManager = global.SOMA.kevinManager;
        }

        if (!kevinManager) {
          return res.status(503).json({
            success: false,
            error: 'KEVIN personality engine not available. Is KEVIN started?'
          });
        }

        // Chat with Kevin's personality engine (stateless, sandboxed)
        const response = await kevinManager.chat(message, context);

        res.json({
          success: true,
          ...response
        });

      } catch (error) {
        console.error('[KEVIN Chat API] Error:', error);
        res.status(500).json({
          success: false,
          error: error.message,
          fallback: 'Whoa dude! Something went wrong on my end!'
        });
      }
    });

    // KEVIN Status endpoint
    this.app.get('/api/kevin/personality', (req, res) => {
      try {
        // Get KEVINManager - check multiple sources
        let kevinManager = this.kevinManager || this.orchestrator.kevinManager;

        // If not found, try to get from global SOMA system
        if (!kevinManager && global.SOMA && global.SOMA.kevinManager) {
          kevinManager = global.SOMA.kevinManager;
        }

        if (!kevinManager) {
          return res.status(503).json({
            success: false,
            error: 'KEVIN not available'
          });
        }

        const personality = kevinManager.getPersonality();
        res.json({ success: true, personality });

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // KEVIN System Status endpoint
    this.app.get('/api/kevin/status', (req, res) => {
      try {
        let kevinManager = this.kevinManager || this.orchestrator.kevinManager;

        if (!kevinManager && global.SOMA && global.SOMA.kevinManager) {
          kevinManager = global.SOMA.kevinManager;
        }

        const isOnline = kevinManager ? kevinManager.isRunning() : false;

        res.json({
          success: true,
          status: {
            online: isOnline,
            mood: isOnline ? (kevinManager.currentMood || 'idle') : 'offline',
            stats: isOnline ? kevinManager.getStats() : {
              scanned: 0,
              threats: 0,
              spam: 0,
              uptime: '0h 0m',
              hiveMind: { active: false, sharedThreats: 0, nodes: 0 },
              draftedReplies: 0,
              actionsExtracted: 0,
              prioritizedEmails: 0,
              timeSaved: '0h 0m'
            }
          }
        });

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // KEVIN Scan Log endpoint
    this.app.get('/api/kevin/scan-log', (req, res) => {
      try {
        let kevinManager = this.kevinManager || this.orchestrator.kevinManager;

        if (!kevinManager && global.SOMA && global.SOMA.kevinManager) {
          kevinManager = global.SOMA.kevinManager;
        }

        const logs = kevinManager ? kevinManager.getScanLog() : [];

        res.json({
          success: true,
          logs
        });

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // KEVIN Toggle (Start/Stop) endpoint
    this.app.post('/api/kevin/toggle', async (req, res) => {
      try {
        let kevinManager = this.kevinManager || this.orchestrator.kevinManager;

        if (!kevinManager && global.SOMA && global.SOMA.kevinManager) {
          kevinManager = global.SOMA.kevinManager;
        }

        if (!kevinManager) {
          return res.status(503).json({
            success: false,
            error: 'KEVIN manager not initialized'
          });
        }

        const isCurrentlyRunning = kevinManager.isRunning();

        if (isCurrentlyRunning) {
          await kevinManager.stop();
          res.json({ success: true, status: 'stopped' });
        } else {
          await kevinManager.start();
          res.json({ success: true, status: 'started' });
        }

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // KEVIN Configuration endpoint
    this.app.post('/api/kevin/config', async (req, res) => {
      try {
        const { thresholds, monitored_accounts, protocols } = req.body;

        let kevinManager = this.kevinManager || this.orchestrator.kevinManager;

        if (!kevinManager && global.SOMA && global.SOMA.kevinManager) {
          kevinManager = global.SOMA.kevinManager;
        }

        if (!kevinManager) {
          return res.status(503).json({
            success: false,
            error: 'KEVIN manager not initialized'
          });
        }

        // Update Kevin's configuration
        await kevinManager.updateConfig({
          thresholds,
          monitored_accounts,
          protocols
        });

        res.json({
          success: true,
          message: 'Configuration updated successfully'
        });

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    console.log('📡 REST API routes configured (including AGI + Audio + Vision + User + Simulation + Knowledge + Chat + KEVIN endpoints)');
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('🔌 Client connected');
      this.clients.add(ws);

      // Send initial state
      this.sendToClient(ws, {
        type: 'initial',
        data: {
          status: this.orchestrator.getSystemStatus(),
          population: this.orchestrator.getPopulationStats(),
          emotions: this.getEmotionalState(),
          personality: this.getPersonalityState()
        }
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(ws, data);
        } catch (error) {
          console.error('Error parsing client message:', error);
        }
      });

      ws.on('close', () => {
        console.log('🔌 Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    console.log('🔌 WebSocket server configured');
  }

  handleClientMessage(ws, data) {
    switch (data.type) {
      case 'ping':
        this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
        break;

      case 'subscribe':
        // Client subscribes to specific updates
        ws.subscriptions = data.channels || ['all'];
        break;

      case 'command':
        // Execute command
        this.executeCommand(data.command, data.params);
        break;

      case 'steve.observe':
        // 🔥 Direct line to STEVE Arbiter for real-time observation
        if (this.orchestrator && this.orchestrator.population) {
          const steve = Array.from(this.orchestrator.population.values()).find(a => a.name === 'SteveArbiter');
          if (steve) {
            steve.handleWorkflowStep(data.params || data);
          }
        }
        break;

      case 'register':
        // Client registration (e.g., simulation viewer, monitoring tools)
        ws.clientId = data.clientId || `client_${Date.now()}`;
        ws.clientType = data.clientType || 'unknown';
        console.log(`[Server] Client registered: ${ws.clientId} (${ws.clientType})`);
        this.sendToClient(ws, { type: 'registered', clientId: ws.clientId });
        break;

      case 'share_to_marketplace':
        // 1. Log the submission
        console.log(`[Marketplace] 📤 Submission received: ${data.payload.name}`);

        // 2. Trigger Guardian Scan (Simulation)
        // In a real system, this would queue a job for the GuardianArbiter
        setTimeout(() => {
          const passed = Math.random() > 0.1; // 90% pass rate
          if (passed) {
            console.log(`[Guardian] ✅ Scan complete. No threats detected in ${data.payload.name}.`);
            // Add to pending marketplace list
            // broadcast success
          } else {
            console.warn(`[Guardian] 🛡️ THREAT DETECTED. Submission ${data.payload.name} quarantined.`);
          }
        }, 2000);
        break;

      default:
        console.warn('Unknown message type:', data.type);
    }
  }

  async executeCommand(command, params) {
    switch (command) {
      case 'spawn':
        await this.orchestrator.spawn(params.type, params.config);
        break;

      case 'terminate':
        await this.orchestrator.terminate(params.arbiterId);
        break;

      case 'restart':
        await this.orchestrator.restart(params.arbiterId);
        break;

      default:
        console.warn('Unknown command:', command);
    }
  }

  startBroadcast() {
    setInterval(() => {
      const update = {
        type: 'update',
        timestamp: Date.now(),
        data: {
          status: this.orchestrator.getSystemStatus(),
          population: this.orchestrator.getPopulationStats(),
          emotions: this.getEmotionalState(),
          personality: this.getPersonalityState()
        }
      };

      this.broadcast(update);
    }, this.config.updateInterval);

    console.log(`📢 Broadcasting every ${this.config.updateInterval}ms`);
  }

  broadcast(message) {
    const payload = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  sendToClient(client, message) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  getEmotionalState() {
    // Find EmotionalEngine arbiter
    const emotionalEngine = Array.from(this.orchestrator.population.values())
      .find(a => a.constructor.name === 'EmotionalEngine');

    if (!emotionalEngine) {
      return {
        available: false,
        message: 'EmotionalEngine not running'
      };
    }

    // Get current emotional state
    return {
      available: true,
      peptides: emotionalEngine.peptides || {},
      dominantEmotion: emotionalEngine.getDominantEmotion?.() || 'calm',
      valence: emotionalEngine.valence || 0,
      arousal: emotionalEngine.arousal || 0,
      timestamp: Date.now()
    };
  }

  getPersonalityState() {
    // Find PersonalityEngine arbiter
    const personalityEngine = Array.from(this.orchestrator.population.values())
      .find(a => a.constructor.name === 'PersonalityEngine');

    if (!personalityEngine) {
      return {
        available: false,
        message: 'PersonalityEngine not running'
      };
    }

    return {
      available: true,
      traits: personalityEngine.traits || {},
      coherence: personalityEngine.coherence || 0,
      timestamp: Date.now()
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVER LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        console.log(`\n✨ SOMA Server running on port ${this.config.port}`);
        console.log(`   REST API: http://localhost:${this.config.port}/api`);
        console.log(`   WebSocket: ws://localhost:${this.config.port}`);
        console.log(`   Dashboard: http://localhost:${this.config.port}\n`);
        resolve();
      });
    });
  }

  async shutdown() {
    console.log('\n🛑 Shutting down SOMA Server...');

    // Close WebSocket connections
    this.clients.forEach(client => client.close());

    // Shutdown orchestrator
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
    }

    // Close HTTP server
    await new Promise((resolve) => {
      this.server.close(resolve);
    });

    console.log('✅ SOMA Server shut down\n');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const server = new SOMAServer({
    port: process.env.PORT || 3001,
    updateInterval: 1000
  });

  await server.initialize();
  await server.start();

  // Initialize population in background (non-blocking)
  server.initializePopulation().catch(err => {
    console.error('Background population initialization failed:', err);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
  });
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = SOMAServer;
