/**
 * SimulationArbiter.js
 *
 * SOMA's Physical Playground.
 * Enables embodiment and physics-based learning without a physical robot.
 *
 * Core Capabilities:
 * - Runs a real physics engine (Matter.js)
 * - Simulates a 2D "Block World"
 * - Provides a "Body" for SOMA to control (actuators, sensors)
 * - Streams visual state to a frontend for user observation
 * - Grounds "Text Thoughts" into "Physical Consequences"
 */

import { EventEmitter } from 'events';
import Matter from 'matter-js';
import { WebSocketServer } from 'ws';

export class SimulationArbiter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = 'SimulationArbiter';
    this.port = config.port || 8081;
    this.headless = config.headless !== false;

    // Physics Engine Components
    this.engine = null;
    this.world = null;
    this.runner = null;

    // SOMA's "Body" in the simulation
    this.agentBody = null;
    
    // WebSocket Server for visualization
    this.wss = null;
    this.clients = new Set();

    // Simulation State
    this.isRunning = false;
    this.lastUpdate = 0;
    
    // Gamification & Scoring
    this.score = 0;
    this.highScore = 0;
    this.currentTask = 'explore'; // 'explore', 'touch_green', 'touch_blue'
    this.episodeStart = Date.now();
    this.lastWin = 0;

    // Metrics
    this.stats = {
      framesSimulated: 0,
      actionsTaken: 0,
      collisions: 0,
      tasksCompleted: 0,
      totalScore: 0
    };

    console.log(`[${this.name}] 🏗️  Physics Simulation Environment initializing...`);
  }

  async initialize() {
    console.log(`[${this.name}]    Setting up Matter.js physics engine...`);

    // 1. Setup Physics Engine
    this.engine = Matter.Engine.create();
    this.world = this.engine.world;
    this.world.gravity.y = 1; // Standard gravity

    // 2. Setup the "World" (Walls, Floor)
    this._createEnvironment();

    // 3. Setup SOMA's Agent (A simple interactive block for now)
    this._createAgent();

    // 4. Setup WebSocket Server for viewing
    this._setupWebSocket();

    // 5. Start Simulation Loop
    this.startSimulation();

    // 6. Listen for collision events (Sensory Input)
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      this._handleCollisions(event);
    });

    // 7. Start Game Logic (Scoring)
    this.startNewEpisode('touch_green');

    console.log(`[${this.name}] ✅ Physics Engine Ready`);
    console.log(`[${this.name}] 📡 Visualization Server running on port ${this.port}`);
    
    return { success: true };
  }

  startNewEpisode(taskType = 'push_cargo') {
    this.currentTask = taskType;
    this.score = 0;
    this.episodeStart = Date.now();
    
    // Clear dynamic bodies
    const bodies = Matter.Composite.allBodies(this.world);
    const dynamicBodies = bodies.filter(b => 
        ['cargo', 'target_zone', 'soma_agent'].includes(b.label)
    );
    Matter.Composite.remove(this.world, dynamicBodies);

    // Reset Agent
    this._createAgent();
    
    // Spawn Cargo (Blue Block)
    const { Bodies, Composite } = Matter;
    this.cargoBody = Bodies.rectangle(300, 300, 40, 40, { 
        label: 'cargo',
        frictionAir: 0.02,
        render: { fillStyle: '#3333cc' },
        density: 0.005 // Slightly heavy
    });
    Composite.add(this.world, this.cargoBody);

    // Spawn First Target
    this._spawnTarget();
    
    console.log(`[${this.name}] 🎮 New Episode Started: ${taskType}`);
  }

  _spawnTarget() {
    // Remove old target if exists
    const oldTarget = Matter.Composite.allBodies(this.world).find(b => b.label === 'target_zone');
    if (oldTarget) Matter.Composite.remove(this.world, oldTarget);

    const { Bodies, Composite } = Matter;
    
    // Random position (avoiding walls)
    // Map size is approx 800x600. Keep within 100-700 x, 100-500 y
    const tx = 100 + Math.random() * 600;
    const ty = 100 + Math.random() * 400;

    this.targetBody = Bodies.rectangle(tx, ty, 60, 60, { 
        label: 'target_zone',
        isSensor: true, // Don't collide physically, just detect overlap
        isStatic: true,
        render: { fillStyle: 'rgba(51, 204, 51, 0.5)' } // Transparent green
    });
    
    Composite.add(this.world, this.targetBody);
    console.log(`[${this.name}] 🎯 New Target at (${tx.toFixed(0)}, ${ty.toFixed(0)})`);
  }

  _calculateReward() {
    if (!this.agentBody || !this.cargoBody || !this.targetBody) return;
    
    // 1. Distance from Cargo to Target (Primary Goal)
    const dx = this.cargoBody.position.x - this.targetBody.position.x;
    const dy = this.cargoBody.position.y - this.targetBody.position.y;
    const distCargoTarget = Math.sqrt(dx*dx + dy*dy);
    
    // 2. Distance from Agent to Cargo (Secondary Goal - must touch to push)
    const adx = this.agentBody.position.x - this.cargoBody.position.x;
    const ady = this.agentBody.position.y - this.cargoBody.position.y;
    const distAgentCargo = Math.sqrt(adx*adx + ady*ady);

    // Reward Shaping:
    // Large reward for Cargo being close to Target
    // Small reward for Agent being close to Cargo
    
    const cargoReward = Math.max(0, (600 - distCargoTarget) / 600);
    const contactReward = Math.max(0, (200 - distAgentCargo) / 200);
    
    this.score += (cargoReward * 0.1) + (contactReward * 0.01);

    // Check Win Condition (Overlap)
    // Distance 80 = (40 radius + 40 radius) approx touching
    if (distCargoTarget < 80 && Date.now() - this.lastWin > 2000) { 
        this._handleWin();
    }
  }

  _handleWin() {
      console.log(`[${this.name}] 🎉 GOAL REACHED! (+1000 points)`);
      this.score += 1000;
      this.stats.tasksCompleted++;
      this.lastWin = Date.now();
      
      // Emit event for systems and frontend
      this.emit('task_complete', { task: this.currentTask, score: this.score });
      this._broadcastEvent('win', { score: this.score });
      
      // Move target to new random location
      this._spawnTarget();
  }

  _createEnvironment() {
    const { Bodies, Composite } = Matter;
    
    // Clear existing
    Composite.clear(this.world);
    this.engine.events = {}; // clear events

    // Walls (Border)
    const ground = Bodies.rectangle(400, 610, 810, 60, { isStatic: true, label: 'ground', render: { fillStyle: '#444' } });
    const ceiling = Bodies.rectangle(400, -10, 810, 60, { isStatic: true, label: 'ceiling', render: { fillStyle: '#444' } });
    const leftWall = Bodies.rectangle(0, 300, 60, 600, { isStatic: true, label: 'wall_left', render: { fillStyle: '#444' } });
    const rightWall = Bodies.rectangle(800, 300, 60, 600, { isStatic: true, label: 'wall_right', render: { fillStyle: '#444' } });

    // Level Design: "Platforms & Pits"
    // 1. Central Platform
    const platform = Bodies.rectangle(400, 400, 300, 20, { 
        isStatic: true, 
        label: 'platform', 
        render: { fillStyle: '#666' },
        friction: 0.8 
    });

    // 2. High Wall Barrier (Right side) - requires jumping
    const barrier = Bodies.rectangle(600, 500, 20, 160, { 
        isStatic: true, 
        label: 'barrier', 
        render: { fillStyle: '#884444' } 
    });

    // 3. Floating Step (Left side)
    const step = Bodies.rectangle(150, 300, 100, 20, { 
        isStatic: true, 
        label: 'step', 
        render: { fillStyle: '#666' } 
    });

    Composite.add(this.world, [ground, ceiling, leftWall, rightWall, platform, barrier, step]);
  }

  _createAgent() {
    const { Bodies, Composite } = Matter;
    
    // SOMA's "Hand" or "Avatar"
    this.agentBody = Bodies.circle(400, 100, 20, { 
      label: 'soma_agent',
      frictionAir: 0.05, 
      density: 0.01, // Heavier than cargo to push it easily
      restitution: 0.5, // Bouncy
      render: { fillStyle: '#ff0000' }
    });

    Composite.add(this.world, this.agentBody);
  }

  _setupWebSocket() {
    try {
      this.wss = new WebSocketServer({ port: this.port });
      
      this.wss.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.warn(`[${this.name}] ⚠️ Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port = this.port + 1;
          // Retry with incremented port
          setTimeout(() => this._setupWebSocket(), 100);
        } else {
          console.error(`[${this.name}] WebSocket server error:`, error.message);
        }
      });

      this.wss.on('connection', (ws) => {
      console.log(`[${this.name}] 👁️  Viewer connected`);
      this.clients.add(ws);

      // Send initial state
      this._broadcastState();

      ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Handle manual controls from frontend
            if (data.type === 'control') {
                this.actApplyForce(data.x || 0, data.y || 0);
            }
            
            // Handle reset request
            if (data.type === 'reset') {
                this.startNewEpisode(data.task || 'push_cargo');
            }

        } catch (err) {
            console.warn(`[${this.name}] Failed to process viewer message:`, err.message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
    } catch (error) {
      console.error(`[${this.name}] Failed to setup WebSocket:`, error.message);
      console.warn(`[${this.name}] Simulation will run without visualization`);
    }
  }

  startSimulation() {
    this.isRunning = true;
    
    // Run physics update loop at 60fps
    const updateInterval = 1000 / 60;
    
    this.runner = setInterval(() => {
      if (!this.isRunning) return;

      Matter.Engine.update(this.engine, updateInterval);
      this.stats.framesSimulated++;
      
      // Calculate continuous rewards
      this._calculateReward();

      // Broadcast state to viewers every frame (or every N frames for optimization)
      this._broadcastState();

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
      vertices: b.vertices.map(v => ({ x: v.x, y: v.y })) // Send vertices for drawing
    }));

    const state = JSON.stringify({
      type: 'world_update',
      timestamp: Date.now(),
      score: Math.floor(this.score),
      task: this.currentTask,
      bodies
    });

    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(state);
      }
    }
  }

  _handleCollisions(event) {
    const pairs = event.pairs;
    
    for (const pair of pairs) {
      // Check if SOMA's agent hit something
      if (pair.bodyA === this.agentBody || pair.bodyB === this.agentBody) {
        const otherBody = pair.bodyA === this.agentBody ? pair.bodyB : pair.bodyA;
        
        this.stats.collisions++;
        
        // Emit sensory event
        this.emit('sensation:collision', {
          object: otherBody.label,
          impact: 1.0 
        });
        
        // Broadcast event to viewers
        if (!otherBody.isSensor) { // Don't broadcast target overlap as collision
            this._broadcastEvent('collision', { 
              target: otherBody.label 
            });
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
   * ACTUATOR: Apply force to the agent
   * SOMA calls this to "move"
   * @param {number} x - Force in X direction
   * @param {number} y - Force in Y direction
   */
  actApplyForce(x, y) {
    if (!this.agentBody) return;
    
    // Tighter clamping for smooth control
    const clampedX = Math.max(-0.05, Math.min(0.05, x));
    const clampedY = Math.max(-0.05, Math.min(0.05, y));

    // console.log(`[${this.name}] 💪 Applying Force: ${clampedX.toFixed(4)}, ${clampedY.toFixed(4)}`);

    Matter.Body.applyForce(this.agentBody, this.agentBody.position, { x: clampedX, y: clampedY });
    
    this.stats.actionsTaken++;
    return { success: true, applied: { x: clampedX, y: clampedY } };
  }

  /**
   * SENSOR: Get current world state
   */
  senseWorld() {
    if (!this.agentBody) return null;

    // Calculate distances for reward shaping
    let distanceCargoToTarget = Infinity;
    if (this.cargoBody && this.targetBody) {
      const dx = this.cargoBody.position.x - this.targetBody.position.x;
      const dy = this.cargoBody.position.y - this.targetBody.position.y;
      distanceCargoToTarget = Math.sqrt(dx * dx + dy * dy);
    }

    return {
      agent: {
        x: this.agentBody.position.x,
        y: this.agentBody.position.y,
        position: this.agentBody.position,
        velocity: this.agentBody.velocity
      },
      cargo: this.cargoBody ? {
        x: this.cargoBody.position.x,
        y: this.cargoBody.position.y,
        position: this.cargoBody.position
      } : { x: 400, y: 300, position: { x: 400, y: 300 } },
      target: this.targetBody ? {
        x: this.targetBody.position.x,
        y: this.targetBody.position.y,
        position: this.targetBody.position
      } : { x: 400, y: 200, position: { x: 400, y: 200 } },
      distanceCargoToTarget,
      objects: Matter.Composite.allBodies(this.world)
        .filter(b => b !== this.agentBody && !b.isStatic)
        .map(b => ({ label: b.label, position: b.position }))
    };
  }

  getStatus() {
    return {
      running: this.isRunning,
      viewers: this.clients.size,
      stats: this.stats
    };
  }

  async shutdown() {
    this.stopSimulation();
    if (this.wss) this.wss.close();
    console.log(`[${this.name}] 🛑 Simulation stopped`);
  }
}

export default SimulationArbiter;
