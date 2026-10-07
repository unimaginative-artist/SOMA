// ═══════════════════════════════════════════════════════════
// SOMA UNIFIED BACKEND SERVER
// Connects: Cognitive Terminal ↔ ASI Systems ↔ Tri-Brain
// ═══════════════════════════════════════════════════════════

const http = require('http');
const { Server } = require('socket.io');
const ASIOrchestrator = require('../arbiters/ASIOrchestrator.cjs');
const LearningVelocityTracker = require('../arbiters/LearningVelocityTracker.cjs');
const EdgeWorkerOrchestrator = require('../arbiters/EdgeWorkerOrchestrator.cjs');
const SelfModificationArbiter = require('../arbiters/SelfModificationArbiter.cjs');
const TimekeeperArbiter = require('../arbiters/TimekeeperArbiter.cjs');
const UniversalImpulser = require('../arbiters/UniversalImpulser.cjs');
const SyntheticLayeredCortex = require('../cognitive/SyntheticLayeredCortex.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const BlackAgent = require('../microagents/BlackAgent.cjs');
const JetstreamAgent = require('../microagents/JetstreamAgent.cjs');
const KuzeAgent = require('../microagents/KuzeAgent.cjs');
const BatouAgent = require('../microagents/BatouAgent.cjs');
const microAgentBridge = require('../core/MicroAgentBridge.cjs');

const PORT = process.env.PORT || 3001;

console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                     SOMA UNIFIED BACKEND SERVER                                ║');
console.log('║            Cognitive Terminal + ASI Systems + Tri-Brain                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
console.log('');

class SomaUnifiedBackend {
  constructor() {
    this.systems = {
      timekeeper: null,
      impulser: null,
      velocityTracker: null,
      edgeWorker: null,
      black: null,
      jetstream: null,
      kuze: null,
      batou: null,
      selfMod: null,
      orchestrator: null,
      triBrain: null
    };
    
    this.io = null;
    this.isInitialized = false;
  }

  async initialize() {
    console.log('🚀 Initializing SOMA Systems...\n');

    try {
      // Initialize Tri-Brain (LLaMA → DeepSeek → Gemini/GPT)
      console.log('[1/10] 🧠 Initializing Tri-Brain Cortex...');
      this.systems.triBrain = new SyntheticLayeredCortex(messageBroker, {
        name: 'TriBrain',
        llama: {
          endpoint: process.env.LLAMA_ENDPOINT || 'http://localhost:11434',
          model: 'llama3.2'
        },
        deepseek: {
          apiKey: process.env.DEEPSEEK_API_KEY,
          endpoint: 'https://api.deepseek.com/v1'
        },
        gemini: {
          apiKey: process.env.GEMINI_API_KEY
        },
        gpt: {
          apiKey: process.env.OPENAI_API_KEY,
          model: 'gpt-4'
        }
      });
      await this.systems.triBrain.initialize();
      console.log('  ✅ Tri-Brain online (LLaMA → DeepSeek → Gemini)\n');

      // Initialize Support Systems
      console.log('[2/10] ⏰ Initializing Support Systems...');
      this.systems.timekeeper = new TimekeeperArbiter({ name: 'TimekeeperArbiter' });
      await this.systems.timekeeper.initialize();
      
      this.systems.impulser = new UniversalImpulser({ 
        name: 'UniversalImpulser',
        maxConcurrent: 10,
        maxQueue: 1000
      });
      await this.systems.impulser.initialize();
      console.log('  ✅ Support systems online\n');

      // Initialize Learning Systems
      console.log('[3/10] 📚 Initializing Learning Systems...');
      this.systems.velocityTracker = new LearningVelocityTracker({ name: 'LearningVelocityTracker' });
      await this.systems.velocityTracker.initialize();
      
      this.systems.edgeWorker = new EdgeWorkerOrchestrator({ 
        name: 'EdgeWorkerOrchestrator',
        maxWorkers: 8
      });
      await this.systems.edgeWorker.initialize();
      console.log('  ✅ Learning systems online\n');

      // Initialize Agents with Tri-Brain
      console.log('[4/10] 🤖 Initializing Agent Swarm...');
      this.systems.black = new BlackAgent({ name: 'BlackAgent', triBrain: this.systems.triBrain });
      await this.systems.black.initialize();
      microAgentBridge.registerAgent('BlackAgent', this.systems.black);
      
      this.systems.jetstream = new JetstreamAgent({ name: 'JetstreamAgent', triBrain: this.systems.triBrain });
      await this.systems.jetstream.initialize();
      microAgentBridge.registerAgent('JetstreamAgent', this.systems.jetstream);
      
      this.systems.kuze = new KuzeAgent({ name: 'KuzeAgent', triBrain: this.systems.triBrain });
      await this.systems.kuze.initialize();
      microAgentBridge.registerAgent('KuzeAgent', this.systems.kuze);
      
      this.systems.batou = new BatouAgent({ name: 'BatouAgent', triBrain: this.systems.triBrain });
      await this.systems.batou.initialize();
      microAgentBridge.registerAgent('BatouAgent', this.systems.batou);
      console.log('  ✅ Agent swarm online\n');

      // Initialize Meta-Systems
      console.log('[5/10] 🧬 Initializing Meta-Systems...');
      this.systems.selfMod = new SelfModificationArbiter({ 
        name: 'SelfModificationArbiter',
        sandboxMode: true,
        requireApproval: false
      });
      await this.systems.selfMod.initialize();
      
      this.systems.orchestrator = new ASIOrchestrator({ name: 'ASIOrchestrator' });
      await this.systems.orchestrator.initialize();
      console.log('  o. Meta-systems online\n');

      // Integrate Systems
      console.log('[6/10] 🔗 Integrating ASI Systems...');
      const integration = await this.systems.orchestrator.handleMessage({
        type: 'start_integration',
        payload: {}
      });
      console.log(`  ✅ ${integration.systemsOnline}/9 systems integrated\n`);

      this.isInitialized = true;
      console.log('✅ SOMA Backend fully operational!\n');
      
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      throw error;
    }
  }

  setupSocketHandlers(io) {
    this.io = io; // Assign io to instance for later use in plan_updated broadcast

    io.on('connection', (socket) => {
      console.log(`✅ Client connected: ${socket.id}`);

      // Chat with Tri-Brain
      socket.on('chat', async (data) => {
        try {
          const { message, history } = data;
          console.log(`💬 Chat: "${message.substring(0, 50)}..."`);

          // Use tri-brain thought flow: LLaMA → DeepSeek → Gemini
          const response = await this.systems.triBrain.processQuery(message, {
            history,
            useThoughtFlow: true
          });

          socket.emit('chat:response', {
            success: true,
            response: response.finalAnswer,
            thoughtProcess: response.thoughtProcess,
            brainA: response.brainA,
            brainB: response.brainB,
            brainC: response.brainC
          });
        } catch (error) {
          socket.emit('chat:response', {
            success: false,
            error: error.message
          });
        }
      });

      // Learn about topic (deploy learning task)
      socket.on('learn', async (data) => {
        try {
          const { topic } = data;
          console.log(`📚 Learn: "${topic}"`);

          // Deploy learning task to edge workers
          const result = await this.systems.edgeWorker.handleMessage({
            type: 'deploy_learning_task',
            payload: {
              taskId: `learn_${Date.now()}`,
              type: 'knowledge_acquisition',
              topic: topic,
              priority: 'high'
            }
          });

          socket.emit('learn:started', {
            success: true,
            taskId: result.taskId,
            message: `Learning about ${topic}...`
          });

          // Stream progress updates
          // TODO: Add progress streaming

        } catch (error) {
          socket.emit('learn:error', {
            success: false,
            error: error.message
          });
        }
      });

      // Agent task execution
      socket.on('agent:execute', async (data) => {
        try {
          const { agentName, taskType, payload } = data;
          console.log(`🤖 Agent ${agentName}: ${taskType}`);

          const agent = this.systems[agentName.toLowerCase()];
          if (!agent) {
            throw new Error(`Agent ${agentName} not found`);
          }

          const result = await agent.executeTask({
            type: taskType,
            payload: payload
          });

          socket.emit('agent:result', {
            success: true,
            agent: agentName,
            result: result
          });
        } catch (error) {
          socket.emit('agent:error', {
            success: false,
            agent: data.agentName,
            error: error.message
          });
        }
      });

      // System status
      socket.on('status', async () => {
        try {
          const report = await this.systems.orchestrator.handleMessage({
            type: 'performance_report',
            payload: {}
          });

          socket.emit('status:response', {
            success: true,
            systems: {
              online: report.asi.systemsOnline,
              total: 9,
              health: report.performance.systemHealth,
              velocity: report.performance.learningVelocity,
              optimizations: report.performance.codeOptimizations
            },
            synergies: report.synergies,
            uptime: report.asi.uptime
          });
        } catch (error) {
          socket.emit('status:response', {
            success: false,
            error: error.message
          });
        }
      });

      // EdgeWorker crawl
      socket.on('crawl:start', async (data) => {
        try {
          const { url } = data;
          console.log(`🕷️ Crawl: ${url}`);

          // TODO: Implement actual crawling with edge workers
          // For now, simulate progress
          socket.emit('crawl:progress', {
            url: url,
            status: 'started',
            message: 'Crawl initiated...'
          });

          setTimeout(() => {
            socket.emit('crawl:complete', {
              url: url,
              pagesScanned: 5,
              knowledgeAdded: 3
            });
          }, 2000);

        } catch (error) {
          socket.emit('crawl:error', {
            success: false,
            error: error.message
          });
        }
      });

      // Self-optimization
      socket.on('optimize', async () => {
        try {
          console.log('🧬 Self-optimization requested');

          const result = await this.systems.selfMod.handleMessage({
            type: 'analyze_performance',
            payload: {
              filepath: 'arbiters/LearningVelocityTracker.cjs',
              functionName: 'consolidateKnowledge'
            }
          });

          socket.emit('optimize:result', {
            success: true,
            opportunities: result.opportunities,
            baseline: result.baseline
          });
        } catch (error) {
          socket.emit('optimize:error', {
            success: false,
            error: error.message
          });
        }
      });

      // Plan fetch
      socket.on('plan:fetch', async () => {
        try {
          console.log('📋 Plan fetch requested');
          const response = await messageBroker.sendMessage({
            from: 'SomaUnifiedBackend',
            to: 'GoalPlannerArbiter',
            type: 'query_plan',
            payload: {}
          });
          socket.emit('plan:response', { success: true, plan: response.plan, updatedAt: response.updatedAt });
        } catch (error) {
          console.error('Failed to fetch plan:', error.message);
          socket.emit('plan:response', { success: false, error: error.message });
        }
      });

      socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
      });
    }); // This closes io.on('connection')

    // Listen for plan updates from GoalPlannerArbiter and broadcast to all clients
    // This should be outside the io.on('connection') block
    messageBroker.subscribe('SomaUnifiedBackend', 'plan_updated');
    messageBroker.on('plan_updated', (payload) => {
      console.log('📢 Broadcasting plan update to clients');
      this.io.emit('plan:updated', payload.payload); // Use this.io to broadcast to all
    });
  }
  async start() {
    const server = http.createServer((req, res) => {
      // Basic HTTP endpoint for health checks
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok', 
          initialized: this.isInitialized,
          timestamp: new Date().toISOString()
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupSocketHandlers(io);

    server.listen(PORT, () => {
      console.log('════════════════════════════════════════════════════════════════════════════════');
      console.log(`🌐 SOMA Backend listening on http://localhost:${PORT}`);
      console.log(`🔌 WebSocket ready for connections`);
      console.log('════════════════════════════════════════════════════════════════════════════════');
      console.log('');
    });
  }

  async shutdown() {
    console.log('\n🛑 Shutting down SOMA Backend...\n');

    if (this.systems.orchestrator) await this.systems.orchestrator.shutdown();
    if (this.systems.selfMod) await this.systems.selfMod.shutdown();
    
    microAgentBridge.unregisterAll();
    for (const agent of [this.systems.black, this.systems.jetstream, this.systems.kuze, this.systems.batou]) {
      if (agent) await agent.terminate('shutdown');
    }

    for (const system of [this.systems.timekeeper, this.systems.impulser, this.systems.velocityTracker, this.systems.edgeWorker]) {
      if (system) await system.shutdown();
    }

    console.log('✅ SOMA Backend shutdown complete\n');
    process.exit(0);
  }
}

// Start the server
const backend = new SomaUnifiedBackend();

backend.initialize().then(() => {
  backend.start();
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => backend.shutdown());
process.on('SIGTERM', () => backend.shutdown());

module.exports = SomaUnifiedBackend;
