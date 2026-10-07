// ════════════════════════════════════════════════════════════════════════════
// SimulationArbiter - SOMA's Physical Playground
// ════════════════════════════════════════════════════════════════════════════
// Enables embodiment and physics-based learning without a physical robot
// - Runs Matter.js physics engine (real 2D physics)
// - Provides actuators (apply force) and sensors (world state)
// - Streams visual state to frontend for observation
// - Grounds abstract reasoning in physical consequences
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const Matter = require('matter-js');
const { WebSocketServer } = require('ws');

class SimulationArbiter extends BaseArbiter {
  constructor(config = {}) {
    super(config);

    this.config = {
      port: config.port || 8081,
      headless: config.headless !== false,
      updateRate: config.updateRate || 30, // FPS (Lowered to reduce CPU load)
      rewardShaping: config.rewardShaping !== false,
      ...config
    };

    // Physics Engine Components
    this.engine = null;
    this.world = null;
    this.runner = null;

    // SOMA's "Body" in the simulation
    this.agentBody = null;
    this.cargoBody = null;
    this.targetBody = null;

    // WebSocket Server for visualization
    this.wss = null;
    this.clients = new Set();

    // Simulation State
    this.isRunning = false;
    this.lastUpdate = 0;

    // Gamification & Scoring
    this.score = 0;
    this.highScore = 0;
    this.currentTask = 'push_cargo'; // 'push_cargo', 'explore', 'navigate'
    this.episodeStart = Date.now();
    this.lastWin = 0;
    this.episodeCount = 0;

    // Interactive Learning State
    this.currentMode = 'watch'; // 'user', 'soma', 'watch'
    this.demonstrations = []; // Stores user demonstrations for imitation learning
    this.currentDemonstration = null; // Current episode demonstration buffer
    this.demonstrationCount = 0;

    // Learning Metrics
    this.stats = {
      framesSimulated: 0,
      actionsTaken: 0,
      collisions: 0,
      tasksCompleted: 0,
      totalScore: 0,
      episodesCompleted: 0,
      averageEpisodeScore: 0,
      successRate: 0
    };

    // Last observation for RL
    this.lastObservation = null;
    this.lastReward = 0;

    console.log(`[${this.name}] 🏗️  Physics Simulation Environment initializing...`);
  }

  async initialize() {
    await super.initialize();

    console.log(`[${this.name}]    Setting up Matter.js physics engine...`);

    // 1. Setup Physics Engine
    this.engine = Matter.Engine.create();
    this.world = this.engine.world;
    this.world.gravity.y = 1; // Standard gravity

    // 2. Setup the "World" (Walls, Floor, Platforms)
    this._createEnvironment();

    // 3. Setup SOMA's Agent (interactive body)
    this._createAgent();

    // 4. Setup WebSocket Server for viewing
    await this._setupWebSocket();

    // 5. Start Simulation Loop
    this.startSimulation();

    // 6. Listen for collision events (Sensory Input)
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      this._handleCollisions(event);
    });

    // 7. Start first episode
    this.startNewEpisode('push_cargo');

    // 8. Subscribe to control events from SimulationControllerArbiter
    if (this.broker) {
      await this.broker.subscribe('simulation_action', this.handleAction.bind(this));
    }

    console.log(`[${this.name}] ✅ Physics Engine Ready`);
    console.log(`[${this.name}] 📡 Visualization Server running on port ${this.config.port}`);
    console.log(`[${this.name}] 🎮 Open simulation_viewer.html to watch SOMA learn!`);

    return { success: true };
  }

  /**
   * Handle action from controller
   */
  async handleAction(message) {
    const { forceX, forceY } = message;
    this.actApplyForce(forceX, forceY);
  }

  /**
   * Start new learning episode
   */
  startNewEpisode(taskType = 'navigate') {
    this.currentTask = taskType;
    this.score = 0;
    this.episodeStart = Date.now();
    this.episodeCount++;

    // Clear dynamic bodies
    const bodies = Matter.Composite.allBodies(this.world);
    const dynamicBodies = bodies.filter(b =>
        ['cargo', 'target_zone', 'soma_agent'].includes(b.label)
    );
    Matter.Composite.remove(this.world, dynamicBodies);

    // Reset Agent position to random start
    this._createAgent();

    // Spawn Target (no cargo - just navigation task)
    this._spawnTarget();

    // Emit episode start event
    if (this.broker) {
      this.broker.publish('simulation_episode_start', {
        episode: this.episodeCount,
        task: taskType,
        timestamp: Date.now()
      });
    }

    console.log(`[${this.name}] 🎮 Episode ${this.episodeCount} Started: ${taskType}`);
  }

  _spawnTarget() {
    // Remove old target if exists
    const oldTarget = Matter.Composite.allBodies(this.world).find(b => b.label === 'target_zone');
    if (oldTarget) Matter.Composite.remove(this.world, oldTarget);

    const { Bodies, Composite } = Matter;

    // Random position (avoiding walls, ensuring distance from agent)
    let tx, ty, attempts = 0;
    const agentX = this.agentBody ? this.agentBody.position.x : 400;
    const agentY = this.agentBody ? this.agentBody.position.y : 100;

    // Ensure target spawns at least 150 pixels away from agent
    do {
      tx = 100 + Math.random() * 600;
      ty = 100 + Math.random() * 400;
      const dist = Math.sqrt((tx - agentX)**2 + (ty - agentY)**2);
      if (dist > 150) break; // Good distance
      attempts++;
    } while (attempts < 50);

    this.targetBody = Bodies.rectangle(tx, ty, 50, 50, {
        label: 'target_zone',
        isSensor: true,
        isStatic: true,
        render: { fillStyle: 'rgba(51, 204, 51, 0.7)' }
    });

    Composite.add(this.world, this.targetBody);
    
    // Reset episode distance tracker for shaping reward
    this.minDistThisEpisode = Infinity;
  }

  /**
   * Calculate reward signal for RL
   */
  _calculateReward() {
    if (!this.agentBody || !this.targetBody) return 0;

    const agentPos = this.agentBody.position;
    const targetPos = this.targetBody.position;

    // Calculate distance
    const dx = agentPos.x - targetPos.x;
    const dy = agentPos.y - targetPos.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    let reward = 0;

    // 1. Time penalty (only in SOMA/Watch modes - not during user control)
    // This incentivizes the AI to learn fast solutions, but we don't penalize the user
    if (this.currentMode !== 'user') {
      reward = -0.05;
    }

    // 2. Win Condition: Reaching target
    if (distToTarget < 40 && Date.now() - this.lastWin > 2000) {
        this._handleWin();
        return 100.0; // Large sparse reward
    }

    // 3. Shaping: ONLY reward if we are significantly closer than ever before in this episode
    // (Prevents "roomba" looping to farm proximity rewards)
    if (!this.minDistThisEpisode) this.minDistThisEpisode = Infinity;

    if (distToTarget < this.minDistThisEpisode - 10) { // 10px buffer
       reward += 1.0; // Small milestone reward
       this.minDistThisEpisode = distToTarget;
    }

    this.score += reward;
    return reward;
  }

  _handleWin() {
      console.log(`[${this.name}] 🎉 TARGET REACHED! (+100 points)`);
      this.score += 100;
      this.stats.tasksCompleted++;
      this.lastWin = Date.now();

      // Update success rate
      this.stats.successRate = this.stats.tasksCompleted / this.episodeCount;

      // Save demonstration if in user mode
      if (this.currentMode === 'user' && this.currentDemonstration) {
        this._saveDemonstration();
      }

      // Emit task complete event
      if (this.broker) {
        this.broker.publish('simulation_task_complete', {
          task: this.currentTask,
          score: this.score,
          episode: this.episodeCount,
          timestamp: Date.now()
        });
      }

      this._broadcastEvent('win', { score: this.score });

      // Move target to new location
      this._spawnTarget();
  }

  _createEnvironment() {
    const { Bodies, Composite } = Matter;

    Composite.clear(this.world);
    this.engine.events = {};

    // Walls (Border) - 800x600 world
    const ground = Bodies.rectangle(400, 610, 810, 60, {
      isStatic: true,
      label: 'ground',
      render: { fillStyle: '#444' }
    });
    const ceiling = Bodies.rectangle(400, -10, 810, 60, {
      isStatic: true,
      label: 'ceiling',
      render: { fillStyle: '#444' }
    });
    const leftWall = Bodies.rectangle(0, 300, 60, 600, {
      isStatic: true,
      label: 'wall_left',
      render: { fillStyle: '#444' }
    });
    const rightWall = Bodies.rectangle(800, 300, 60, 600, {
      isStatic: true,
      label: 'wall_right',
      render: { fillStyle: '#444' }
    });

    // Level Design: Platforms & Obstacles
    const platform = Bodies.rectangle(400, 400, 300, 20, {
        isStatic: true,
        label: 'platform',
        render: { fillStyle: '#666' },
        friction: 0.8
    });

    const barrier = Bodies.rectangle(600, 500, 20, 160, {
        isStatic: true,
        label: 'barrier',
        render: { fillStyle: '#884444' }
    });

    const step = Bodies.rectangle(150, 300, 100, 20, {
        isStatic: true,
        label: 'step',
        render: { fillStyle: '#666' }
    });

    Composite.add(this.world, [ground, ceiling, leftWall, rightWall, platform, barrier, step]);
  }

  _createAgent() {
    const { Bodies, Composite } = Matter;

    // Remove old agent if exists
    if (this.agentBody) {
      Matter.Composite.remove(this.world, this.agentBody);
    }

    // SOMA's controllable body - optimized for navigation
    this.agentBody = Bodies.circle(400, 100, 20, {
      label: 'soma_agent',
      frictionAir: 0.15,      // Higher air resistance for better control
      friction: 0.8,          // Good ground friction
      density: 0.01,
      restitution: 0.1,       // Low bounce for predictable movement
      render: { fillStyle: '#ff0000' }
    });

    Composite.add(this.world, this.agentBody);
  }

  async _setupWebSocket() {
    // Try to create WebSocket server with automatic port retry
    let portToTry = this.config.port;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const success = await new Promise((resolve) => {
        try {
          const server = new WebSocketServer({ port: portToTry });
          
          server.on('listening', () => {
            this.wss = server;
            this.config.port = portToTry;
            resolve(true);
          });

          server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
              console.log(`[${this.name}] ⚠️  Port ${portToTry} in use, trying next...`);
              server.close();
              resolve(false);
            } else {
              console.error(`[${this.name}] ❌ WebSocket error:`, error.message);
              resolve(false);
            }
          });
        } catch (err) {
          resolve(false);
        }
      });

      if (success) break;
      
      attempts++;
      portToTry++;
      
      if (attempts >= maxAttempts) {
        throw new Error(`Failed to bind WebSocket server after ${maxAttempts} attempts.`);
      }
    }

    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      console.log(`[${this.name}] 👁️  Viewer connected`);
      this.clients.add(ws);

      // Send initial state
      this._broadcastState();

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);

          // Handle viewer messages
          if (data.type === 'register') {
            console.log(`[${this.name}] Viewer registered:`, data.viewerId || 'unknown');
          }

          // Handle user actions (keyboard input)
          if (data.type === 'user_action') {
            this._handleUserAction(data);
          }

          // Handle mode changes
          if (data.type === 'mode_change') {
            this._handleModeChange(data.mode);
          }
        } catch (error) {
          console.error(`[${this.name}] Error parsing viewer message:`, error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  startSimulation() {
    this.isRunning = true;

    const updateInterval = 1000 / this.config.updateRate;

    this.runner = setInterval(() => {
      if (!this.isRunning) return;

      Matter.Engine.update(this.engine, updateInterval);
      this.stats.framesSimulated++;

      // Calculate reward
      this.lastReward = this._calculateReward();

      // Broadcast state to viewers
      if (this.stats.framesSimulated % 2 === 0) { // Every 2 frames for optimization
        this._broadcastState();
      }

      // Emit observation for RL agent every frame
      if (this.broker && this.stats.framesSimulated % 5 === 0) {
        const obs = this.senseWorld();
        this.broker.publish('simulation_observation', {
          observation: obs,
          reward: this.lastReward,
          episode: this.episodeCount,
          frame: this.stats.framesSimulated,
          timestamp: Date.now()
        });
      }

    }, updateInterval);
  }

  stopSimulation() {
    this.isRunning = false;
    clearInterval(this.runner);
  }

  _broadcastState() {
    if (this.clients.size === 0) return;

    const bodies = Matter.Composite.allBodies(this.world).map(b => ({
      id: b.id,
      label: b.label,
      position: b.position,
      angle: b.angle,
      velocity: b.velocity,
      vertices: b.vertices.map(v => ({ x: v.x, y: v.y }))
    }));

    const state = JSON.stringify({
      type: 'world_update',
      timestamp: Date.now(),
      score: Math.floor(this.score),
      task: this.currentTask,
      episode: this.episodeCount,
      bodies
    });

    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(state);
      }
    }
  }

  _handleCollisions(event) {
    const pairs = event.pairs;

    for (const pair of pairs) {
      if (pair.bodyA === this.agentBody || pair.bodyB === this.agentBody) {
        const otherBody = pair.bodyA === this.agentBody ? pair.bodyB : pair.bodyA;

        this.stats.collisions++;

        // Emit collision event
        if (this.broker) {
          this.broker.publish('simulation_collision', {
            object: otherBody.label,
            impact: 1.0,
            position: this.agentBody.position,
            timestamp: Date.now()
          });
        }

        // Broadcast to viewers
        if (!otherBody.isSensor) {
            this._broadcastEvent('collision', { target: otherBody.label });
        }
      }
    }
  }

  _broadcastEvent(type, data) {
    const msg = JSON.stringify({ type: 'event', eventType: type, data });
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  /**
   * ACTUATOR: Apply force to agent (SOMA controls this)
   */
  actApplyForce(x, y) {
    if (!this.agentBody) return { success: false, error: 'No agent body' };

    const clampedX = Math.max(-2.0, Math.min(2.0, x));
    const clampedY = Math.max(-2.0, Math.min(2.0, y));

    Matter.Body.applyForce(this.agentBody, this.agentBody.position, {
      x: clampedX,
      y: clampedY
    });

    this.stats.actionsTaken++;
    return { success: true, applied: { x: clampedX, y: clampedY } };
  }

  /**
   * SENSOR: Get current world state (for RL observation)
   */
  senseWorld() {
    if (!this.agentBody) return null;

    return {
      agent: {
        position: this.agentBody.position,
        velocity: this.agentBody.velocity,
        angle: this.agentBody.angle
      },
      target: this.targetBody ? {
        position: this.targetBody.position
      } : null,
      score: this.score,
      episode: this.episodeCount,
      task: this.currentTask
    };
  }

  /**
   * Handle user action from interactive viewer
   */
  _handleUserAction(data) {
    if (this.currentMode !== 'user') return;

    const { forceX, forceY, timestamp, keys } = data;

    // Apply the force
    this.actApplyForce(forceX, forceY);

    // Record this state-action pair for demonstration learning
    if (!this.currentDemonstration) {
      this.currentDemonstration = {
        episode: this.episodeCount,
        startTime: Date.now(),
        stateActionPairs: [],
        finalScore: 0,
        success: false
      };
    }

    const currentState = this.senseWorld();
    this.currentDemonstration.stateActionPairs.push({
      state: currentState,
      action: { forceX, forceY },
      keys: keys,
      timestamp: timestamp
    });

    console.log(`[${this.name}] 🎮 User action: forceX=${forceX.toFixed(3)}, forceY=${forceY.toFixed(3)}`);
  }

  /**
   * Handle mode change
   */
  _handleModeChange(mode) {
    const oldMode = this.currentMode;
    this.currentMode = mode;

    console.log(`[${this.name}] 🔄 Mode changed: ${oldMode} → ${mode}`);

    // Save current demonstration if we're switching away from user mode
    if (oldMode === 'user' && this.currentDemonstration) {
      this._saveDemonstration();
    }

    // Broadcast mode change event
    if (this.broker) {
      this.broker.publish('simulation_mode_change', {
        oldMode,
        newMode: mode,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Save demonstration to learning buffer
   */
  _saveDemonstration() {
    if (!this.currentDemonstration || this.currentDemonstration.stateActionPairs.length === 0) {
      this.currentDemonstration = null;
      return;
    }

    this.currentDemonstration.finalScore = this.score;
    this.currentDemonstration.success = this.score > 50; // Consider successful if scored well
    this.currentDemonstration.endTime = Date.now();

    this.demonstrations.push(this.currentDemonstration);
    this.demonstrationCount++;

    console.log(`[${this.name}] 📝 Demonstration saved: ${this.currentDemonstration.stateActionPairs.length} actions, score: ${Math.floor(this.score)}`);

    // Broadcast demonstration count update
    this._broadcastEvent('demonstration_recorded', {
      count: this.demonstrationCount,
      score: Math.floor(this.score),
      success: this.currentDemonstration.success
    });

    // Broadcast to Training Collector/Distillation
    if (this.currentDemonstration.success && this.broker) {
      this.broker.publish('SIMULATION_TRAJECTORY_SUCCESS', {
          score: Math.floor(this.score),
          stateActionPairs: this.currentDemonstration.stateActionPairs,
          duration: this.currentDemonstration.endTime - this.currentDemonstration.startTime
      });
    }

    // Emit to broker for other arbiters to learn from
    if (this.broker) {
      this.broker.publish('simulation_demonstration', {
        demonstration: this.currentDemonstration,
        count: this.demonstrationCount,
        timestamp: Date.now()
      });
    }

    this.currentDemonstration = null;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      viewers: this.clients.size,
      currentEpisode: this.episodeCount,
      currentScore: Math.floor(this.score),
      highScore: Math.floor(this.highScore),
      averageEpisodeScore: this.episodeCount > 0
        ? Math.floor(this.stats.totalScore / this.episodeCount)
        : 0,
      currentMode: this.currentMode,
      demonstrationCount: this.demonstrationCount
    };
  }

  async shutdown() {
    console.log(`[${this.name}] 🛑 Shutting down simulation...`);

    this.stopSimulation();

    if (this.wss) {
      try {
        // Close all client connections
        this.clients.forEach(client => {
          try {
            if (client.readyState === 1) {
              client.close();
            }
          } catch (err) {
            console.warn(`[${this.name}] Error closing client:`, err.message);
          }
        });
        this.clients.clear();

        // Close WebSocket server
        await new Promise((resolve) => {
          this.wss.close((err) => {
            if (err) console.warn(`[${this.name}] Error closing WebSocket server:`, err.message);
            resolve();
          });
        });

        this.wss = null;
        console.log(`[${this.name}] ✅ WebSocket server closed (port ${this.config.port} freed)`);
      } catch (error) {
        console.error(`[${this.name}] Error during WebSocket cleanup:`, error.message);
      }
    }

    await super.shutdown();
    console.log(`[${this.name}] ✅ Simulation stopped`);
  }
}

module.exports = SimulationArbiter;
